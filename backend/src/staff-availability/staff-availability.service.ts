import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  StaffAbsenceRequest,
  AbsenceRequestStatus,
  AbsenceRequestType,
} from './entities/staff-absence-request.entity';
import { StaffAbsenceRequestEvent } from './entities/staff-absence-request-event.entity';
import {
  StaffAvailabilityBlock,
  AvailabilityBlockSource,
  AvailabilityBlockType,
} from './entities/staff-availability-block.entity';
import { CreateAbsenceRequestDto } from './dto/create-absence-request.dto';
import { DecideAbsenceRequestDto } from './dto/decide-absence-request.dto';
import { WithdrawAbsenceRequestDto } from './dto/withdraw-absence-request.dto';
import { HotelStaff } from '../hotel-staff/entities/hotel-staff.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class StaffAvailabilityService {
  private readonly logger = new Logger(StaffAvailabilityService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(StaffAbsenceRequest)
    private readonly absenceRequestRepo: Repository<StaffAbsenceRequest>,
    @InjectRepository(StaffAbsenceRequestEvent)
    private readonly absenceEventRepo: Repository<StaffAbsenceRequestEvent>,
    @InjectRepository(StaffAvailabilityBlock)
    private readonly availabilityBlockRepo: Repository<StaffAvailabilityBlock>,
    @InjectRepository(HotelStaff)
    private readonly hotelStaffRepo: Repository<HotelStaff>,
  ) {}

  /**
   * Nhân viên lễ tân nộp đơn xin nghỉ/đi muộn
   */
  async submitRequest(
    actor: User,
    dto: CreateAbsenceRequestDto,
  ): Promise<StaffAbsenceRequest> {
    // 1. Kiểm tra nhân viên có thuộc khách sạn và trạng thái ACTIVE không
    const staffRelation = await this.hotelStaffRepo.findOne({
      where: {
        hotelId: dto.hotelId,
        staffUserId: String(actor.id),
        status: 'ACTIVE',
      },
    });

    if (!staffRelation && actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Bạn không phải là nhân viên đang hoạt động tại khách sạn này.',
      );
    }

    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);

    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      throw new BadRequestException('Thời gian bắt đầu hoặc kết thúc không hợp lệ.');
    }

    if (startAt >= endAt) {
      throw new BadRequestException(
        'Thời gian bắt đầu vắng mặt phải trước thời gian kết thúc.',
      );
    }

    // 2. Chống nộp trùng lặp khoảng thời gian với đơn đang PENDING hoặc APPROVED
    const conflictingRequest = await this.absenceRequestRepo
      .createQueryBuilder('req')
      .where('req.hotel_id = :hotelId', { hotelId: dto.hotelId })
      .andWhere('req.staff_user_id = :staffUserId', { staffUserId: actor.id })
      .andWhere('req.status IN (:...activeStatuses)', {
        activeStatuses: [
          AbsenceRequestStatus.PENDING,
          AbsenceRequestStatus.APPROVED,
        ],
      })
      .andWhere('req.start_at < :endAt AND req.end_at > :startAt', {
        startAt,
        endAt,
      })
      .getOne();

    if (conflictingRequest) {
      throw new ConflictException(
        'Bạn đã có đơn xin nghỉ/đi muộn đang chờ duyệt hoặc đã duyệt trong khoảng thời gian này.',
      );
    }

    let expectedArrivalAt: Date | null = null;
    if (dto.expectedArrivalAt) {
      expectedArrivalAt = new Date(dto.expectedArrivalAt);
    } else if (dto.requestType === AbsenceRequestType.LATE_ARRIVAL) {
      expectedArrivalAt = endAt;
    }

    const request = this.absenceRequestRepo.create({
      hotelId: dto.hotelId,
      staffUserId: String(actor.id),
      requestType: dto.requestType,
      startAt,
      endAt,
      expectedArrivalAt,
      reason: dto.reason.trim(),
      contactInfo: dto.contactInfo?.trim() || null,
      evidenceRef: dto.evidenceRef?.trim() || null,
      status: AbsenceRequestStatus.PENDING,
      version: 1,
    });

    const saved = await this.absenceRequestRepo.save(request);

    // Ghi audit event
    await this.absenceEventRepo.save(
      this.absenceEventRepo.create({
        requestId: saved.id,
        oldStatus: null,
        newStatus: AbsenceRequestStatus.PENDING,
        actorId: String(actor.id),
        note: `Nộp đơn ${dto.requestType}: ${dto.reason.trim()}`,
      }),
    );

    this.logger.log(
      `[StaffAvailability] Nhân viên ${actor.id} nộp đơn ${dto.requestType} (#${saved.id}) tại hotel ${dto.hotelId}`,
    );

    return saved;
  }

  /**
   * Quản lý khách sạn xét duyệt đơn xin nghỉ/đi muộn (APPROVE / REJECT)
   */
  async decideRequest(
    actor: User,
    requestId: string,
    dto: DecideAbsenceRequestDto,
  ): Promise<StaffAbsenceRequest> {
    return this.dataSource.transaction(async (manager) => {
      const requestRepo = manager.getRepository(StaffAbsenceRequest);
      const eventRepo = manager.getRepository(StaffAbsenceRequestEvent);
      const blockRepo = manager.getRepository(StaffAvailabilityBlock);
      const staffRepo = manager.getRepository(HotelStaff);

      const request = await requestRepo.findOne({
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!request) {
        throw new NotFoundException(`Không tìm thấy đơn yêu cầu #${requestId}.`);
      }

      // Kiểm tra optimistic lock version
      if (
        dto.expectedVersion !== undefined &&
        request.version !== dto.expectedVersion
      ) {
        throw new ConflictException(
          'Dữ liệu đơn đã bị thay đổi bởi người khác, vui lòng tải lại trang.',
        );
      }

      // Xác minh quyền: Quản lý cùng khách sạn
      const isManager = await staffRepo.findOne({
        where: {
          hotelId: request.hotelId,
          staffUserId: String(actor.id),
          staffRole: 'MANAGER',
          status: 'ACTIVE',
        },
      });

      if (!isManager && actor.role !== 'ADMIN') {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (Hotel Manager) cùng khách sạn mới có quyền duyệt đơn này.',
        );
      }

      // Bất biến: Không được tự duyệt đơn của chính mình!
      if (request.staffUserId === String(actor.id)) {
        throw new BadRequestException(
          'Bạn không được phép tự phê duyệt đơn xin nghỉ/đi muộn của chính mình.',
        );
      }

      if (
        request.status !== AbsenceRequestStatus.PENDING &&
        request.status !== AbsenceRequestStatus.REVOCATION_REQUESTED
      ) {
        throw new ConflictException(
          `Đơn này hiện đang ở trạng thái ${request.status}, không thể thực hiện phê duyệt.`,
        );
      }

      const oldStatus = request.status;
      const isRevocation = oldStatus === AbsenceRequestStatus.REVOCATION_REQUESTED;

      if (dto.decision === 'APPROVE') {
        if (isRevocation) {
          // Duyệt thu hồi/hủy đơn đã được duyệt trước đó
          request.status = AbsenceRequestStatus.REVOKED;
          request.decidedBy = String(actor.id);
          request.decidedAt = new Date();
          request.decisionNote = dto.reviewNote?.trim() || 'Chấp thuận thu hồi đơn';
          request.version += 1;
          await requestRepo.save(request);

          // Hủy kích hoạt block
          await blockRepo.update(
            { requestId: request.id, active: 1 },
            { active: 0, endedBy: String(actor.id) },
          );

          await eventRepo.save(
            eventRepo.create({
              requestId: request.id,
              oldStatus,
              newStatus: AbsenceRequestStatus.REVOKED,
              actorId: String(actor.id),
              note: dto.reviewNote?.trim() || 'Chấp thuận thu hồi đơn vắng mặt',
            }),
          );
        } else {
          // Duyệt chấp thuận đơn vắng mặt
          request.status = AbsenceRequestStatus.APPROVED;
          request.decidedBy = String(actor.id);
          request.decidedAt = new Date();
          request.decisionNote = dto.reviewNote?.trim() || null;
          request.version += 1;
          await requestRepo.save(request);

          // Tạo availability block để chặn phân công tự động trong khoảng thời gian này
          let blockType = AvailabilityBlockType.LEAVE;
          if (request.requestType === AbsenceRequestType.LATE_ARRIVAL) {
            blockType = AvailabilityBlockType.LATE_ARRIVAL;
          } else if (request.requestType === AbsenceRequestType.EARLY_LEAVE) {
            blockType = AvailabilityBlockType.EARLY_LEAVE;
          } else if (request.requestType === AbsenceRequestType.SHORT_ABSENCE) {
            blockType = AvailabilityBlockType.SHORT_ABSENCE;
          }

          const block = blockRepo.create({
            hotelId: request.hotelId,
            staffUserId: request.staffUserId,
            requestId: request.id,
            blockType,
            startAt: request.startAt,
            endAt: request.endAt,
            reason: request.reason,
            active: 1,
            source: AvailabilityBlockSource.APPROVED_REQUEST,
            createdBy: String(actor.id),
          });

          await blockRepo.save(block);

          await eventRepo.save(
            eventRepo.create({
              requestId: request.id,
              oldStatus,
              newStatus: AbsenceRequestStatus.APPROVED,
              actorId: String(actor.id),
              note: dto.reviewNote?.trim() || 'Duyệt chấp thuận đơn vắng mặt',
            }),
          );
        }
      } else {
        // REJECT
        request.status = isRevocation
          ? AbsenceRequestStatus.APPROVED // Không chấp thuận thu hồi, giữ nguyên approved
          : AbsenceRequestStatus.REJECTED;
        request.decidedBy = String(actor.id);
        request.decidedAt = new Date();
        request.decisionNote = dto.reviewNote?.trim() || 'Từ chối yêu cầu';
        request.version += 1;
        await requestRepo.save(request);

        await eventRepo.save(
          eventRepo.create({
            requestId: request.id,
            oldStatus,
            newStatus: request.status,
            actorId: String(actor.id),
            note: dto.reviewNote?.trim() || 'Từ chối đơn',
          }),
        );
      }

      this.logger.log(
        `[StaffAvailability] Quản lý ${actor.id} đã ${dto.decision} đơn #${request.id} -> ${request.status}`,
      );

      return request;
    });
  }

  /**
   * Nhân viên xin rút đơn vắng mặt
   */
  async withdrawRequest(
    actor: User,
    requestId: string,
    dto: WithdrawAbsenceRequestDto,
  ): Promise<StaffAbsenceRequest> {
    const request = await this.absenceRequestRepo.findOne({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException(`Không tìm thấy đơn yêu cầu #${requestId}.`);
    }

    if (request.staffUserId !== String(actor.id) && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Bạn chỉ có thể rút đơn của chính mình.');
    }

    if (
      dto.expectedVersion !== undefined &&
      request.version !== dto.expectedVersion
    ) {
      throw new ConflictException(
        'Dữ liệu đơn đã bị thay đổi, vui lòng tải lại trang.',
      );
    }

    const oldStatus = request.status;

    if (oldStatus === AbsenceRequestStatus.PENDING) {
      // Đơn chưa duyệt thì cho phép rút ngay lập tức
      request.status = AbsenceRequestStatus.WITHDRAWN;
      request.version += 1;
      await this.absenceRequestRepo.save(request);

      await this.absenceEventRepo.save(
        this.absenceEventRepo.create({
          requestId: request.id,
          oldStatus,
          newStatus: AbsenceRequestStatus.WITHDRAWN,
          actorId: String(actor.id),
          note: dto.reason?.trim() || 'Nhân viên chủ động rút đơn khi đang chờ duyệt',
        }),
      );

      return request;
    }

    if (oldStatus === AbsenceRequestStatus.APPROVED) {
      // Đơn đã duyệt: Yêu cầu thu hồi cần quản lý duyệt
      request.status = AbsenceRequestStatus.REVOCATION_REQUESTED;
      request.version += 1;
      await this.absenceRequestRepo.save(request);

      await this.absenceEventRepo.save(
        this.absenceEventRepo.create({
          requestId: request.id,
          oldStatus,
          newStatus: AbsenceRequestStatus.REVOCATION_REQUESTED,
          actorId: String(actor.id),
          note: dto.reason?.trim() || 'Nhân viên yêu cầu thu hồi đơn đã duyệt',
        }),
      );

      return request;
    }

    throw new BadRequestException(
      `Không thể rút đơn ở trạng thái hiện tại (${oldStatus}).`,
    );
  }

  /**
   * Lấy danh sách đơn của chính nhân viên đang đăng nhập
   */
  async getMyRequests(actor: User): Promise<StaffAbsenceRequest[]> {
    return this.absenceRequestRepo.find({
      where: { staffUserId: String(actor.id) },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Quản lý xem danh sách đơn của nhân viên thuộc khách sạn mình quản lý
   */
  async getHotelRequests(
    actor: User,
    hotelId: string,
    status?: AbsenceRequestStatus,
  ): Promise<any[]> {
    // Kiểm tra quyền quản lý tại khách sạn
    const isManager = await this.hotelStaffRepo.findOne({
      where: {
        hotelId,
        staffUserId: String(actor.id),
        staffRole: 'MANAGER',
        status: 'ACTIVE',
      },
    });

    if (!isManager && actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Bạn không có quyền quản lý tại khách sạn này.',
      );
    }

    const qb = this.absenceRequestRepo
      .createQueryBuilder('req')
      .innerJoin(User, 'u', 'u.id = req.staff_user_id')
      .select([
        'req.id AS id',
        'req.hotel_id AS hotelId',
        'req.staff_user_id AS staffUserId',
        'u.full_name AS staffName',
        'u.email AS staffEmail',
        'req.request_type AS requestType',
        'req.start_at AS startAt',
        'req.end_at AS endAt',
        'req.expected_arrival_at AS expectedArrivalAt',
        'req.reason AS reason',
        'req.contact_info AS contactInfo',
        'req.evidence_ref AS evidenceRef',
        'req.status AS status',
        'req.decided_by AS decidedBy',
        'req.decided_at AS decidedAt',
        'req.decision_note AS decisionNote',
        'req.version AS version',
        'req.created_at AS createdAt',
        'req.updated_at AS updatedAt',
      ])
      .where('req.hotel_id = :hotelId', { hotelId });

    if (status) {
      qb.andWhere('req.status = :status', { status });
    }

    qb.orderBy('req.created_at', 'DESC');

    return qb.getRawMany();
  }

  /**
   * Kiểm tra xem nhân viên có đang khả dụng tại thời điểm atDateTime không
   * (Không vướng availability block ACTIVE nào)
   */
  async isStaffAvailableAt(
    hotelId: string,
    staffUserId: string,
    atDateTime: Date = new Date(),
  ): Promise<{ available: boolean; activeBlock?: StaffAvailabilityBlock }> {
    const activeBlock = await this.availabilityBlockRepo
      .createQueryBuilder('b')
      .where('b.hotel_id = :hotelId', { hotelId })
      .andWhere('b.staff_user_id = :staffUserId', { staffUserId })
      .andWhere('b.active = 1')
      .andWhere('b.start_at <= :atDateTime AND b.end_at > :atDateTime', {
        atDateTime,
      })
      .getOne();

    if (activeBlock) {
      return { available: false, activeBlock };
    }

    return { available: true };
  }

  async isStaffAtHotel(staffUserId: string, hotelId: string): Promise<boolean> {
    const staff = await this.hotelStaffRepo.findOne({
      where: {
        hotelId,
        staffUserId,
        status: 'ACTIVE',
      },
    });
    return !!staff;
  }

  async isManagerAtHotel(staffUserId: string, hotelId: string): Promise<boolean> {
    const staff = await this.hotelStaffRepo.findOne({
      where: {
        hotelId,
        staffUserId,
        staffRole: 'MANAGER',
        status: 'ACTIVE',
      },
    });
    return !!staff;
  }

  /**
   * Lấy danh sách ID các nhân viên vắng mặt tại thời điểm chỉ định
   */
  async getUnavailableStaffUserIds(
    hotelId: string,
    atDateTime: Date = new Date(),
  ): Promise<string[]> {
    const blocks = await this.availabilityBlockRepo
      .createQueryBuilder('b')
      .select('DISTINCT b.staff_user_id', 'staffUserId')
      .where('b.hotel_id = :hotelId', { hotelId })
      .andWhere('b.active = 1')
      .andWhere('b.start_at <= :atDateTime AND b.end_at > :atDateTime', {
        atDateTime,
      })
      .getRawMany();

    return blocks.map((row) => String(row.staffUserId));
  }

  /**
   * Kiểm tra xem nhân viên có đang khả dụng trong khoảng thời gian [startAt, endAt] không
   * (Không chồng lấn với bất kỳ block vắng mặt ACTIVE nào)
   */
  async checkStaffAvailabilityOnInterval(
    staffUserId: string,
    hotelId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<boolean> {
    const overlappingBlock = await this.availabilityBlockRepo
      .createQueryBuilder('b')
      .where('b.hotel_id = :hotelId', { hotelId })
      .andWhere('b.staff_user_id = :staffUserId', { staffUserId })
      .andWhere('b.active = 1')
      .andWhere('b.start_at < :endAt AND b.end_at > :startAt', {
        startAt,
        endAt,
      })
      .getOne();

    return !overlappingBlock;
  }
}
