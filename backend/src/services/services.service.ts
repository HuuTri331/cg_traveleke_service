import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { RoomService, ServiceType } from './entities/room-service.entity';
import {
  ServiceRequest,
  ServiceRequestStatus,
} from './entities/service-request.entity';
import { BookingServiceSnapshot } from './entities/booking-service-snapshot.entity';
import {
  ServiceRecoveryLog,
  RecoveryType,
} from './entities/service-recovery-log.entity';
import {
  CreateServiceCategoryDto,
  UpdateServiceCategoryDto,
  CreateRoomServiceDto,
  UpdateRoomServiceDto,
  CreateServiceRequestDto,
  UpdateServiceRequestDto,
  CreateBookingSnapshotDto,
  CreateServiceRecoveryLogDto,
  ApproveRecoveryDto,
} from './dto/services.dto';
import { OutboxService } from '../outbox/outbox.service';
import { GuestWorkService } from '../guest-work/guest-work.service';
import { PromotionCampaign, PromotionCampaignStatus } from '../promotions/entities/promotion-campaign.entity';
import { BenefitAccountStatus, BookingBenefitAccount } from '../promotions/entities/booking-benefit-account.entity';
import { BenefitLedgerEntryType, BookingBenefitLedger } from '../promotions/entities/booking-benefit-ledger.entity';
import { computeServiceItemPricing } from '../promotions/promotion-engine';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(ServiceCategory)
    private readonly categoryRepo: Repository<ServiceCategory>,

    @InjectRepository(RoomService)
    private readonly roomServiceRepo: Repository<RoomService>,

    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepo: Repository<ServiceRequest>,

    @InjectRepository(BookingServiceSnapshot)
    private readonly snapshotRepo: Repository<BookingServiceSnapshot>,

    @InjectRepository(ServiceRecoveryLog)
    private readonly recoveryLogRepo: Repository<ServiceRecoveryLog>,

    private readonly dataSource: DataSource,

    @Optional()
    private readonly realtimeGateway?: RealtimeGateway,

    @Optional()
    private readonly guestWorkService?: GuestWorkService,
    @Optional()
    private readonly outboxService?: OutboxService,
  ) {}

  // ============================================================
  // SERVICE CATEGORIES
  // ============================================================

  async getAllCategories(includeInactive = false): Promise<ServiceCategory[]> {
    const where = includeInactive ? {} : { status: 'ACTIVE' as const };
    return this.categoryRepo.find({
      where,
      order: { sortOrder: 'ASC', name: 'ASC' },
      relations: ['services'],
    });
  }

  async getCategoryById(id: number): Promise<ServiceCategory> {
    const cat = await this.categoryRepo.findOne({
      where: { id },
      relations: ['services'],
    });
    if (!cat)
      throw new NotFoundException(`Danh mục dịch vụ #${id} không tồn tại`);
    return cat;
  }

  async isHotelManager(
    userId: string | number,
    hotelId: string | number,
  ): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND staff_role = 'MANAGER' AND status = 'ACTIVE' LIMIT 1`,
      [userId, hotelId],
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  async createCategory(
    dto: CreateServiceCategoryDto,
  ): Promise<ServiceCategory> {
    const cat = this.categoryRepo.create({
      code: dto.code.toUpperCase().replace(/\s+/g, '_'),
      name: dto.name,
      description: dto.description,
      icon: dto.icon,
      sortOrder: dto.sortOrder ?? 0,
      status: 'ACTIVE',
    });
    return this.categoryRepo.save(cat);
  }

  async updateCategory(
    id: number,
    dto: UpdateServiceCategoryDto,
  ): Promise<ServiceCategory> {
    const cat = await this.getCategoryById(id);
    Object.assign(cat, dto);
    return this.categoryRepo.save(cat);
  }

  async deleteCategory(id: number): Promise<{ message: string }> {
    const cat = await this.getCategoryById(id);
    await this.categoryRepo.remove(cat);
    return { message: `Đã xoá danh mục "${cat.name}"` };
  }

  // ============================================================
  // ROOM SERVICES
  // ============================================================

  async getAllRoomServices(
    hotelId?: number,
    categoryId?: number,
  ): Promise<RoomService[]> {
    const qb = this.roomServiceRepo
      .createQueryBuilder('rs')
      .leftJoinAndSelect('rs.category', 'cat')
      .where('rs.status = :status', { status: 'ACTIVE' });

    if (hotelId) {
      qb.andWhere('(rs.hotelId = :hotelId OR rs.hotelId IS NULL)', { hotelId });
    }
    if (categoryId) {
      qb.andWhere('rs.categoryId = :categoryId', { categoryId });
    }

    return qb
      .orderBy('cat.sortOrder', 'ASC')
      .addOrderBy('rs.name', 'ASC')
      .getMany();
  }

  async getRoomServiceById(id: number): Promise<RoomService> {
    const svc = await this.roomServiceRepo.findOne({
      where: { id },
      relations: ['category'],
    });
    if (!svc) throw new NotFoundException(`Dịch vụ #${id} không tồn tại`);
    return svc;
  }

  async createRoomService(dto: CreateRoomServiceDto): Promise<RoomService> {
    const svc = this.roomServiceRepo.create({
      categoryId: dto.categoryId,
      hotelId: dto.hotelId ?? null,
      roomTypeId: dto.roomTypeId ?? null,
      name: dto.name,
      description: dto.description,
      unit: dto.unit ?? 'lần',
      basePrice: dto.basePrice ?? 0,
      isComplimentary: dto.isComplimentary ?? false,
      serviceType: dto.serviceType ?? ServiceType.ADD_ON,
      quotaPerBooking: dto.quotaPerBooking ?? null,
      quotaPerNight: dto.quotaPerNight ?? null,
      maxQuantity: dto.maxQuantity ?? null,
      slaMinutes: dto.slaMinutes ?? 30,
      capacityPerHour: dto.capacityPerHour ?? null,
      leadTimeHours: dto.leadTimeHours ?? 0,
      requiresApproval: dto.requiresApproval ?? false,
      departmentOwner: dto.departmentOwner ?? null,
      status: 'ACTIVE',
    });
    return this.roomServiceRepo.save(svc);
  }

  async updateRoomService(
    id: number,
    dto: UpdateRoomServiceDto,
  ): Promise<RoomService> {
    const svc = await this.getRoomServiceById(id);
    Object.assign(svc, dto);
    return this.roomServiceRepo.save(svc);
  }

  async deleteRoomService(id: number): Promise<{ message: string }> {
    const svc = await this.getRoomServiceById(id);
    await this.roomServiceRepo.remove(svc);
    return { message: `Đã xoá dịch vụ "${svc.name}"` };
  }

  // ============================================================
  // SERVICE REQUESTS & LIFECYCLE WORKFLOW
  // Lifecycle: PENDING -> ACCEPTED -> ASSIGNED -> IN_PROGRESS -> COMPLETED -> CONFIRMED
  //                                                          -> FAILED -> RECOVERY
  // ============================================================

  async getServiceRequestsByBooking(
    bookingId: number,
    user?: User,
  ): Promise<ServiceRequest[]> {
    if (user && user.role !== 'ADMIN') {
      const [booking] = await this.dataSource.query(
        'SELECT id, user_id AS userId, hotel_id AS hotelId FROM bookings WHERE id = ? LIMIT 1',
        [bookingId],
      );
      if (!booking) {
        throw new NotFoundException(`Booking #${bookingId} không tồn tại`);
      }
      if (user.role === 'CUSTOMER' && String(booking.userId) !== String(user.id)) {
        throw new ForbiddenException(
          'Bạn không có quyền truy cập yêu cầu dịch vụ của booking này.',
        );
      }
      if (user.role === 'EMPLOYEE') {
        const [staff] = await this.dataSource.query(
          'SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = "ACTIVE" LIMIT 1',
          [user.id, booking.hotelId],
        );
        if (!staff) {
          throw new ForbiddenException(
            'Bạn không có quyền quản lý dịch vụ tại khách sạn của booking này.',
          );
        }
      }
    }

    return this.serviceRequestRepo.find({
      where: { bookingId },
      relations: ['service', 'service.category'],
      order: { createdAt: 'DESC' },
    });
  }

  async getAllServiceRequests(
    filters?: {
      status?: string;
      assignedTo?: number;
      hotelId?: number;
    },
    actor?: User,
  ): Promise<ServiceRequest[]> {
    const qb = this.serviceRequestRepo
      .createQueryBuilder('sr')
      .leftJoinAndSelect('sr.service', 'svc')
      .leftJoinAndSelect('svc.category', 'cat')
      .leftJoin('bookings', 'b', 'b.id = sr.booking_id');

    if (filters?.status) {
      qb.andWhere('sr.status = :status', { status: filters.status });
    }
    if (filters?.assignedTo) {
      qb.andWhere('sr.assignedTo = :assignedTo', {
        assignedTo: filters.assignedTo,
      });
    }
    if (filters?.hotelId) {
      qb.andWhere('(svc.hotelId = :hotelId OR b.hotel_id = :hotelId)', {
        hotelId: filters.hotelId,
      });
    }

    if (actor && actor.role === 'EMPLOYEE') {
      qb.andWhere(
        '(svc.hotelId IN (SELECT hotel_id FROM hotel_staff WHERE staff_user_id = :staffUserId AND status = "ACTIVE") OR b.hotel_id IN (SELECT hotel_id FROM hotel_staff WHERE staff_user_id = :staffUserId AND status = "ACTIVE"))',
        { staffUserId: actor.id },
      );
    }

    return qb.orderBy('sr.createdAt', 'DESC').getMany();
  }

  async createServiceRequest(
    dto: CreateServiceRequestDto,
    user?: User,
  ): Promise<ServiceRequest> {
    const service = await this.getRoomServiceById(dto.serviceId);

    // Verify booking exists and authorization
    const [booking] = await this.dataSource.query(
      'SELECT id, user_id AS userId, hotel_id AS hotelId FROM bookings WHERE id = ? LIMIT 1',
      [dto.bookingId],
    );
    if (!booking) {
      throw new NotFoundException(`Booking #${dto.bookingId} không tồn tại`);
    }

    if (user && user.role !== 'ADMIN') {
      if (user.role === 'CUSTOMER' && String(booking.userId) !== String(user.id)) {
        throw new ForbiddenException(
          'Bạn không thể tạo yêu cầu dịch vụ cho đơn đặt phòng của khách khác.',
        );
      }
      if (user.role === 'EMPLOYEE') {
        const [staff] = await this.dataSource.query(
          'SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = "ACTIVE" LIMIT 1',
          [user.id, booking.hotelId],
        );
        if (!staff) {
          throw new ForbiddenException(
            'Nhân viên không thuộc khách sạn của booking này.',
          );
        }
      }
    }

    // Verify service belongs to this hotel (or is a general hotel service)
    if (service.hotelId && String(service.hotelId) !== String(booking.hotelId)) {
      throw new BadRequestException('Dịch vụ này không thuộc khách sạn của booking.');
    }

    const quantity = dto.quantity ?? 1;
    const scheduledAt = dto.scheduledAt
      ? new Date(dto.scheduledAt)
      : new Date();

    // PP-P1-02 / PIT-16: Tính giảm giá dịch vụ theo khung giờ (VD: Spa 14:00-17:00 giảm 20%)
    let totalPrice = service.isComplimentary
      ? 0
      : Number(service.basePrice) * quantity;
    let promoNoteSuffix = '';
    if (!service.isComplimentary && typeof this.dataSource.getRepository === 'function') {
      try {
        const promoRepo = this.dataSource.getRepository(PromotionCampaign);
        if (promoRepo && typeof promoRepo.find === 'function') {
          const activeCampaigns = await promoRepo.find({
            where: { hotelId: String(booking.hotelId), status: PromotionCampaignStatus.ACTIVE },
          });
          const priced = computeServiceItemPricing({
            hotelId: String(booking.hotelId),
            serviceId: String(dto.serviceId),
            baseUnitPrice: Number(service.basePrice),
            quantity,
            usageAt: scheduledAt,
            activeCampaigns,
          });
          totalPrice = priced.netTotal;
          if (priced.discountAmount > 0 && priced.appliedCampaign) {
            promoNoteSuffix = ` [KM ${priced.appliedCampaign.code}: -${priced.discountAmount.toLocaleString('vi-VN')}đ]`;
          }
        }
      } catch {}
    }

    const slaMinutes = service.slaMinutes ?? 30;
    const slaDueAt = new Date(scheduledAt.getTime() + slaMinutes * 60 * 1000);

    const saved = await this.dataSource.transaction(async (em) => {
      const created = await em.getRepository(ServiceRequest).save(em.getRepository(ServiceRequest).create({
        bookingId: dto.bookingId, serviceId: dto.serviceId, serviceName: service.name,
        unitPrice: service.basePrice, quantity, totalPrice,
        note: dto.note ? `${dto.note}${promoNoteSuffix}` : promoNoteSuffix ? promoNoteSuffix.trim() : null,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        slaDueAt, isSlaBreahed: false, status: ServiceRequestStatus.PENDING,
      }));
      const taskPayload = {
        id: String(created.id), hotelId: String(booking.hotelId), bookingId: String(created.bookingId),
        serviceName: created.serviceName, note: created.note ?? undefined,
        actor: user ? { id: String(user.id), role: user.role } : undefined,
      };
      if (this.guestWorkService) {
        await this.guestWorkService.createTaskFromServiceRequest(taskPayload, taskPayload.actor, em);
      }
      if (this.outboxService) {
        await this.outboxService.addEvent(em, 'service_request.created', 'ServiceRequest', String(created.id), taskPayload);
      }
      return created;
    });

    // Phát realtime notification tới Lễ tân
    try {
      this.realtimeGateway?.emitServiceRequested({
        id: saved.id,
        bookingId: saved.bookingId,
        serviceName: saved.serviceName,
        quantity: saved.quantity,
        totalPrice: Number(saved.totalPrice),
        note: saved.note ?? undefined,
        requestedAt: new Date().toISOString(),
      });
    } catch {
      // Fail-safe
    }

    return saved;
  }

  async updateServiceRequest(
    id: number,
    dto: UpdateServiceRequestDto,
  ): Promise<ServiceRequest> {
    const req = await this.serviceRequestRepo.findOne({ where: { id } });
    if (!req)
      throw new NotFoundException(`Yêu cầu dịch vụ #${id} không tồn tại`);

    if (dto.status) req.status = dto.status;
    if (dto.assignedTo !== undefined) req.assignedTo = dto.assignedTo;
    if (dto.note !== undefined) req.note = dto.note;
    if (dto.completedAt) req.completedAt = new Date(dto.completedAt);
    if (dto.confirmedAt) req.confirmedAt = new Date(dto.confirmedAt);
    if (dto.failureReason) req.failureReason = dto.failureReason;
    if (dto.recoveryAction) req.recoveryAction = dto.recoveryAction;
    if (dto.recoveryApprovedBy) req.recoveryApprovedBy = dto.recoveryApprovedBy;
    if (dto.recoveryCost !== undefined) req.recoveryCost = dto.recoveryCost;

    return this.serviceRequestRepo.save(req);
  }

  async updateServiceRequestStatus(
    id: number,
    targetStatus: ServiceRequestStatus,
    payload?: {
      assignedTo?: number;
      failureReason?: string;
      note?: string;
    },
  ): Promise<ServiceRequest> {
    const req = await this.serviceRequestRepo.findOne({
      where: { id },
      relations: ['service'],
    });
    if (!req)
      throw new NotFoundException(`Yêu cầu dịch vụ #${id} không tồn tại`);

    const now = new Date();

    // Check SLA breach
    if (
      req.slaDueAt &&
      now > req.slaDueAt &&
      targetStatus !== ServiceRequestStatus.COMPLETED &&
      targetStatus !== ServiceRequestStatus.CONFIRMED
    ) {
      req.isSlaBreahed = true;
    }

    req.status = targetStatus;

    switch (targetStatus) {
      case ServiceRequestStatus.ACCEPTED:
        req.acceptedAt = now;
        break;
      case ServiceRequestStatus.ASSIGNED:
        if (payload?.assignedTo) req.assignedTo = payload.assignedTo;
        break;
      case ServiceRequestStatus.IN_PROGRESS:
        req.startedAt = now;
        break;
      case ServiceRequestStatus.COMPLETED:
        req.completedAt = now;
        if (req.slaDueAt && now > req.slaDueAt) {
          req.isSlaBreahed = true;
        }
        break;
      case ServiceRequestStatus.CONFIRMED:
        req.confirmedAt = now;
        break;
      case ServiceRequestStatus.FAILED:
        req.failureReason =
          payload?.failureReason ?? 'Dịch vụ gặp sự cố không hoàn tất';
        break;
      case ServiceRequestStatus.CANCELLED:
        if (payload?.note) req.note = payload.note;
        break;
    }

    if (payload?.note) req.note = payload.note;
    if (payload?.assignedTo !== undefined) req.assignedTo = payload.assignedTo;

    const savedReq = await this.serviceRequestRepo.save(req);

    // PP-P1-15 / PIT-18 / B27 / B42: Khi hủy hoặc dịch vụ thất bại, tự động đảo (REVERSAL) các bút toán đã cấn trừ credit
    if (
      targetStatus === ServiceRequestStatus.CANCELLED ||
      targetStatus === ServiceRequestStatus.FAILED
    ) {
      await this.autoReverseServiceBenefitRedemptions(savedReq);
    }

    return savedReq;
  }

  private async autoReverseServiceBenefitRedemptions(req: ServiceRequest): Promise<void> {
    if (!this.dataSource?.transaction) return;
    try {
      await this.dataSource.transaction(async (em) => {
        const redeems = await em.find(BookingBenefitLedger, {
          where: {
            bookingId: String(req.bookingId),
            serviceRequestId: String(req.id),
            entryType: BenefitLedgerEntryType.REDEEM,
          },
        });
        for (const red of redeems) {
          const revKey = `reversal:ledger:${red.id}`;
          const existingRev = await em.findOne(BookingBenefitLedger, {
            where: { idempotencyKey: revKey },
          });
          if (existingRev) continue;

          const acc = await em.findOne(BookingBenefitAccount, {
            where: { id: red.accountId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!acc) continue;

          const restoreAmt = Math.abs(Math.round(Number(red.amountDelta || 0)));
          const restoreQ = Math.abs(Math.round(Number(red.quotaDelta || 0)));
          acc.reversedAmount = Number(acc.reversedAmount || 0) + restoreAmt;
          acc.redeemedAmount = Math.max(0, Number(acc.redeemedAmount || 0) - restoreAmt);
          acc.availableAmount = Number(acc.availableAmount || 0) + restoreAmt;
          acc.usedQuota = Math.max(0, Number(acc.usedQuota || 0) - restoreQ);
          acc.availableQuota = Number(acc.availableQuota || 0) + restoreQ;
          if (acc.status === BenefitAccountStatus.SETTLED && (acc.availableAmount > 0 || acc.availableQuota > 0)) {
            acc.status = BenefitAccountStatus.APPROVED;
          }
          acc.version += 1;
          await em.save(BookingBenefitAccount, acc);

          await em.save(
            BookingBenefitLedger,
            em.create(BookingBenefitLedger, {
              accountId: acc.id,
              bookingId: String(req.bookingId),
              hotelId: red.hotelId,
              campaignId: acc.campaignId,
              entryType: BenefitLedgerEntryType.REVERSAL,
              amountDelta: restoreAmt,
              balanceAfter: acc.availableAmount,
              quotaDelta: restoreQ,
              quotaAfter: acc.availableQuota,
              serviceRequestId: String(req.id),
              referenceEntryId: red.id,
              performedBy: req.assignedTo ? String(req.assignedTo) : null,
              idempotencyKey: revKey,
              reason: `Tự động hoàn lại tín dụng do dịch vụ #${req.id} chuyển sang trạng thái ${req.status}`,
            }),
          );
        }
      });
    } catch {}
  }

  // ============================================================
  // BOOKING SERVICE SNAPSHOTS (Quyền lợi booking đã chốt)
  // ============================================================

  async createBookingSnapshots(
    bookingId: number,
    roomTypeId?: number,
    hotelId?: number,
    user?: User,
  ): Promise<BookingServiceSnapshot[]> {
    const [booking] = await this.dataSource.query(
      'SELECT id, hotel_id AS hotelId FROM bookings WHERE id = ? LIMIT 1',
      [bookingId],
    );
    if (!booking) {
      throw new NotFoundException(`Booking #${bookingId} không tồn tại`);
    }

    const targetHotelId = hotelId ?? booking.hotelId;

    if (user && user.role !== 'ADMIN') {
      const [staff] = await this.dataSource.query(
        'SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = "ACTIVE" LIMIT 1',
        [user.id, targetHotelId],
      );
      if (!staff) {
        throw new ForbiddenException(
          'Nhân viên không có quyền tạo snapshot quyền lợi cho khách sạn này.',
        );
      }
    }

    const qb = this.roomServiceRepo
      .createQueryBuilder('rs')
      .leftJoinAndSelect('rs.category', 'cat')
      .where('rs.status = :status', { status: 'ACTIVE' })
      .andWhere('rs.serviceType IN (:...types)', {
        types: [ServiceType.INCLUDED, ServiceType.QUOTA],
      });

    if (roomTypeId) {
      qb.andWhere('(rs.roomTypeId = :roomTypeId OR rs.roomTypeId IS NULL)', {
        roomTypeId,
      });
    }
    if (targetHotelId) {
      qb.andWhere('(rs.hotelId = :hotelId OR rs.hotelId IS NULL)', { hotelId: targetHotelId });
    }

    const services = await qb.getMany();
    const snapshots: BookingServiceSnapshot[] = [];

    for (const svc of services) {
      const existing = await this.snapshotRepo.findOne({
        where: { bookingId, serviceId: svc.id },
      });
      if (!existing) {
        const snap = this.snapshotRepo.create({
          bookingId,
          serviceId: svc.id,
          serviceName: svc.name,
          serviceType: svc.serviceType,
          categoryName: svc.category?.name ?? null,
          unit: svc.unit,
          basePrice: svc.basePrice,
          isComplimentary: svc.isComplimentary,
          quotaIncluded: svc.quotaPerBooking ?? 0,
          quotaPerNight: svc.quotaPerNight ?? null,
        });
        snapshots.push(await this.snapshotRepo.save(snap));
      }
    }

    return snapshots;
  }

  async getBookingSnapshots(
    bookingId: number,
    user?: User,
  ): Promise<BookingServiceSnapshot[]> {
    if (user && user.role !== 'ADMIN') {
      const [booking] = await this.dataSource.query(
        'SELECT id, user_id AS userId, hotel_id AS hotelId FROM bookings WHERE id = ? LIMIT 1',
        [bookingId],
      );
      if (!booking) {
        throw new NotFoundException(`Booking #${bookingId} không tồn tại`);
      }
      if (user.role === 'CUSTOMER' && String(booking.userId) !== String(user.id)) {
        throw new ForbiddenException(
          'Bạn không có quyền xem quyền lợi dịch vụ của booking này.',
        );
      }
      if (user.role === 'EMPLOYEE') {
        const [staff] = await this.dataSource.query(
          'SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = "ACTIVE" LIMIT 1',
          [user.id, booking.hotelId],
        );
        if (!staff) {
          throw new ForbiddenException(
            'Bạn không thuộc khách sạn của booking này.',
          );
        }
      }
    }

    return this.snapshotRepo.find({
      where: { bookingId },
      order: { createdAt: 'ASC' },
    });
  }

  // ============================================================
  // SERVICE FAILURE & RECOVERY (Bù đắp sai lỗi dịch vụ)
  // ============================================================

  async createRecoveryLog(
    dto: CreateServiceRecoveryLogDto,
  ): Promise<ServiceRecoveryLog> {
    const log = this.recoveryLogRepo.create({
      serviceRequestId: dto.serviceRequestId ?? null,
      bookingId: dto.bookingId,
      reportedBy: dto.reportedBy,
      recoveryType: dto.recoveryType,
      reason: dto.reason,
      actionTaken: dto.actionTaken,
      costIncurred: dto.costIncurred ?? 0,
      status: 'PENDING',
    });
    const saved = await this.recoveryLogRepo.save(log);

    if (dto.serviceRequestId) {
      const req = await this.serviceRequestRepo.findOne({
        where: { id: dto.serviceRequestId },
      });
      if (req) {
        req.status = ServiceRequestStatus.FAILED;
        req.recoveryAction = `${dto.recoveryType}: ${dto.actionTaken}`;
        req.recoveryCost = dto.costIncurred ?? 0;
        await this.serviceRequestRepo.save(req);
      }
    }

    return saved;
  }

  async approveRecoveryLog(
    id: number,
    dto: ApproveRecoveryDto,
    actor?: User,
  ): Promise<ServiceRecoveryLog> {
    const log = await this.recoveryLogRepo.findOne({ where: { id } });
    if (!log)
      throw new NotFoundException(`Biên bản recovery #${id} không tồn tại`);

    if (actor) {
      // Maker-Checker (Section 02.5 & 20.3): Không tự duyệt biên bản đền bù do chính mình lập
      if (log.reportedBy && Number(log.reportedBy) === Number(actor.id)) {
        throw new ForbiddenException(
          'Không thể tự phê duyệt biên bản đền bù do chính mình lập (Nguyên tắc Maker-Checker).',
        );
      }

      if (actor.role === 'EMPLOYEE') {
        const [booking] = await this.dataSource.query(
          'SELECT hotel_id AS hotelId FROM bookings WHERE id = ? LIMIT 1',
          [log.bookingId],
        );
        if (!booking) {
          throw new NotFoundException('Không tìm thấy booking tương ứng với biên bản đền bù.');
        }
        const isManager = await this.isHotelManager(actor.id, booking.hotelId);
        if (!isManager) {
          throw new ForbiddenException(
            'Chỉ Quản lý khách sạn (MANAGER) của cơ sở này hoặc Quản trị viên mới có quyền phê duyệt biên bản đền bù.',
          );
        }
      }
    }

    log.approvedBy = dto.approvedBy ?? (actor ? Number(actor.id) : undefined);
    log.status = dto.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    return this.recoveryLogRepo.save(log);
  }

  async getRecoveryLogs(bookingId?: number): Promise<ServiceRecoveryLog[]> {
    const where = bookingId ? { bookingId } : {};
    return this.recoveryLogRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  // ============================================================
  // STATISTICS
  // ============================================================

  async getServiceStats(): Promise<{
    totalCategories: number;
    totalServices: number;
    totalRequests: number;
    pendingRequests: number;
    completedRequests: number;
    breachedSlaRequests: number;
  }> {
    const [
      totalCategories,
      totalServices,
      totalRequests,
      pendingRequests,
      completedRequests,
      breachedSlaRequests,
    ] = await Promise.all([
      this.categoryRepo.count({ where: { status: 'ACTIVE' } }),
      this.roomServiceRepo.count({ where: { status: 'ACTIVE' } }),
      this.serviceRequestRepo.count(),
      this.serviceRequestRepo.count({
        where: { status: ServiceRequestStatus.PENDING },
      }),
      this.serviceRequestRepo.count({
        where: { status: ServiceRequestStatus.COMPLETED },
      }),
      this.serviceRequestRepo.count({ where: { isSlaBreahed: true } }),
    ]);

    return {
      totalCategories,
      totalServices,
      totalRequests,
      pendingRequests,
      completedRequests,
      breachedSlaRequests,
    };
  }
}
