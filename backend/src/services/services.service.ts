import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { assertBookingOperator } from '../bookings/services/booking-operation-policy';
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
import { computeServiceItemPricing, hasRemainingCampaignBudget } from '../promotions/promotion-engine';
import { computeServiceReceivableProjection } from '../promotions/service-receivable-projection';

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

    const list = await this.serviceRequestRepo.find({
      where: { bookingId },
      relations: ['service', 'service.category'],
      order: { createdAt: 'DESC' },
    });
    return this.enrichServiceRequestsWithSettlement(list);
  }

  // Lỗi 14: Nguồn sự thật thống nhất cho số tiền/suất đã cấn trừ và số tiền còn phải thu trên từng ServiceRequest
  private async enrichServiceRequestsWithSettlement(requests: ServiceRequest[]): Promise<ServiceRequest[]> {
    if (!requests.length || typeof this.dataSource?.getRepository !== 'function') return requests;
    const ledgerRepo = this.dataSource.getRepository(BookingBenefitLedger);
    if (!ledgerRepo || typeof ledgerRepo.find !== 'function') return requests;

    const reqIds = requests.map((r) => String(r.id));
    let ledgers: BookingBenefitLedger[] = [];
    try {
      ledgers = await ledgerRepo.find({
        where: {
          serviceRequestId: In(reqIds),
          entryType: In([BenefitLedgerEntryType.REDEEM, BenefitLedgerEntryType.REVERSAL]),
        },
      });
    } catch {
      return requests;
    }

    return requests.map((r) => {
      const proj = computeServiceReceivableProjection(r, ledgers);
      return Object.assign(r, {
        grossTotal: proj.grossTotal,
        directDiscountAmount: proj.directDiscountAmount,
        netTotal: proj.netTotal,
        creditsApplied: proj.creditsApplied,
        redeemedAmount: proj.redeemedAmount,
        redeemedQuota: proj.redeemedQuota,
        cashPaid: proj.cashPaid,
        amountDue: proj.amountDue,
        remainingPayable: proj.remainingPayable,
        settlementStatus: proj.settlementStatus,
      });
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

    const list = await qb.orderBy('sr.createdAt', 'DESC').getMany();
    return this.enrichServiceRequestsWithSettlement(list);
  }

  private async assertServiceRequestOperator(em: any, req: ServiceRequest, actor?: User) {
    if (!actor || actor.role === 'ADMIN') return;
    const queryFn = typeof em?.query === 'function' ? em.query.bind(em) : this.dataSource.query.bind(this.dataSource);
    const [booking] = await queryFn(
      'SELECT id, user_id AS userId, hotel_id AS hotelId, handled_by AS handledBy, status FROM bookings WHERE id = ? LIMIT 1',
      [req.bookingId],
    );
    if (!booking) {
      throw new NotFoundException(`Booking #${req.bookingId} của phiếu dịch vụ không tồn tại`);
    }
    await assertBookingOperator(
      typeof em?.query === 'function' ? em : this.dataSource.manager,
      booking as any,
      { id: String(actor.id), role: actor.role },
      'SERVICE_REQUEST',
    );
  }

  async createServiceRequest(
    dto: CreateServiceRequestDto,
    user?: User,
  ): Promise<ServiceRequest> {
    const service = await this.getRoomServiceById(dto.serviceId);

    // Verify booking exists and authorization (Hotel-First + A->B Task Scope)
    const [booking] = await this.dataSource.query(
      'SELECT id, user_id AS userId, hotel_id AS hotelId, handled_by AS handledBy, status FROM bookings WHERE id = ? LIMIT 1',
      [dto.bookingId],
    );
    if (!booking) {
      throw new NotFoundException(`Booking #${dto.bookingId} không tồn tại`);
    }
    if ((dto as any)?.hotelId !== undefined && String((dto as any).hotelId) !== String(booking.hotelId)) {
      throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn thực tế sở hữu đơn đặt phòng.');
    }
    if (['CANCELLED', 'REJECTED', 'PAYMENT_EXPIRED', 'CLOSED_NO_SHOW', 'COMPLETED'].includes(String(booking.status))) {
      throw new ConflictException(`Không thể tạo yêu cầu dịch vụ cho đơn đặt phòng ở trạng thái ${booking.status}.`);
    }

    if (user && user.role !== 'ADMIN') {
      if (user.role === 'CUSTOMER' && String(booking.userId) !== String(user.id)) {
        throw new ForbiddenException(
          'Bạn không thể tạo yêu cầu dịch vụ cho đơn đặt phòng của khách khác.',
        );
      }
      if (user.role === 'EMPLOYEE') {
        // Lỗi 27: Bắt buộc kiểm tra quyền thao tác booking theo phạm vi công việc SERVICE_REQUEST (A/B coverage hoặc Manager)
        await assertBookingOperator(
          this.dataSource.manager,
          booking as any,
          { id: String(user.id), role: user.role },
          'SERVICE_REQUEST',
        );
      }
    }

    if (service.hotelId && String(service.hotelId) !== String(booking.hotelId)) {
      throw new BadRequestException('Dịch vụ này không thuộc khách sạn của booking.');
    }

    const quantity = dto.quantity ?? 1;
    const scheduledAt = dto.scheduledAt
      ? new Date(dto.scheduledAt)
      : new Date();
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('Thời gian hẹn phục vụ (scheduledAt) không hợp lệ.');
    }

    // Lỗi 12, 13, 24: Fail-closed khi truy vấn khuyến mãi dịch vụ; khóa & tiêu ngân sách campaign trong cùng transaction
    let totalPrice = service.isComplimentary
      ? 0
      : Number(service.basePrice) * quantity;
    let promoNoteSuffix = '';
    let appliedServiceCampaignId: string | null = null;
    let appliedServiceDiscount = 0;

    if (!service.isComplimentary && typeof this.dataSource.getRepository === 'function') {
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
          appliedServiceCampaignId = String(priced.appliedCampaign.id);
          appliedServiceDiscount = priced.discountAmount;
          promoNoteSuffix = ` [KM ${priced.appliedCampaign.code}: -${priced.discountAmount.toLocaleString('vi-VN')}đ]`;
        }
      }
    }

    const slaMinutes = service.slaMinutes ?? 30;
    const slaDueAt = new Date(scheduledAt.getTime() + slaMinutes * 60 * 1000);

    const saved = await this.dataSource.transaction(async (em) => {
      if (appliedServiceCampaignId && appliedServiceDiscount > 0 && typeof em.getRepository === 'function') {
        const campRepoTx = em.getRepository(PromotionCampaign);
        if (campRepoTx && typeof campRepoTx.findOne === 'function') {
          const lockedCamp = await campRepoTx.findOne({
            where: { id: appliedServiceCampaignId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!lockedCamp || lockedCamp.status !== PromotionCampaignStatus.ACTIVE) {
            throw new ConflictException('Chương trình khuyến mãi dịch vụ vừa kết thúc hoặc tạm dừng, vui lòng tạo lại phiếu.');
          }
          if (!hasRemainingCampaignBudget(lockedCamp, appliedServiceDiscount)) {
            throw new ConflictException('PROMO_BUDGET_EXHAUSTED: Ngân sách hoặc số lượt khuyến mãi dịch vụ vừa hết.');
          }
          lockedCamp.budgetConsumed = Number(lockedCamp.budgetConsumed || 0) + appliedServiceDiscount;
          lockedCamp.redemptionsCount = Number(lockedCamp.redemptionsCount || 0) + 1;
          await campRepoTx.save(lockedCamp);
        }
      }

      const created = await em.getRepository(ServiceRequest).save(em.getRepository(ServiceRequest).create({
        bookingId: dto.bookingId, serviceId: dto.serviceId, serviceName: service.name,
        unitPrice: service.basePrice, quantity, totalPrice,
        note: dto.note ? `${dto.note}${promoNoteSuffix}` : promoNoteSuffix ? promoNoteSuffix.trim() : null,
        scheduledAt,
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

    const [enriched] = await this.enrichServiceRequestsWithSettlement([saved]);
    return enriched || saved;
  }

  async updateServiceRequest(
    id: number,
    dto: UpdateServiceRequestDto,
    actor?: User,
  ): Promise<ServiceRequest> {
    if (
      dto.status === ServiceRequestStatus.CANCELLED ||
      dto.status === ServiceRequestStatus.FAILED
    ) {
      return this.updateServiceRequestStatus(
        id,
        dto.status,
        {
          assignedTo: dto.assignedTo,
          failureReason: dto.failureReason,
          note: dto.note,
        },
        actor,
      );
    }

    const runUpdate = async (em?: any) => {
      const reqRepo = em?.getRepository ? em.getRepository(ServiceRequest) : this.serviceRequestRepo;
      const req = await reqRepo.findOne({
        where: { id },
        relations: ['service'],
        ...(em ? { lock: { mode: 'pessimistic_write' } } : {}),
      });
      if (!req)
        throw new NotFoundException(`Yêu cầu dịch vụ #${id} không tồn tại`);

      // Lỗi 05: Kiểm tra quyền thao tác của actor trên booking.hotelId và phạm vi công việc
      await this.assertServiceRequestOperator(em || this.dataSource?.manager, req, actor);

      // Lỗi 24: Khi đổi giờ phục vụ (scheduledAt), kiểm tra trạng thái và tính lại giá theo khung giờ khuyến mãi
      if (dto.scheduledAt !== undefined) {
        if (
          [
            ServiceRequestStatus.IN_PROGRESS,
            ServiceRequestStatus.COMPLETED,
            ServiceRequestStatus.CONFIRMED,
            ServiceRequestStatus.CANCELLED,
            ServiceRequestStatus.FAILED,
          ].includes(req.status)
        ) {
          throw new ConflictException(`Không thể đổi giờ phục vụ khi phiếu dịch vụ đang ở trạng thái ${req.status}.`);
        }
        const nextScheduled = new Date(dto.scheduledAt);
        if (Number.isNaN(nextScheduled.getTime())) {
          throw new BadRequestException('Thời gian hẹn phục vụ (scheduledAt) không hợp lệ.');
        }
        const prevScheduledIso = req.scheduledAt ? new Date(req.scheduledAt).toISOString() : 'none';
        const oldTotalPrice = Math.round(Number(req.totalPrice || 0));
        req.scheduledAt = nextScheduled;
        const slaMinutes = req.service?.slaMinutes ?? 30;
        req.slaDueAt = new Date(nextScheduled.getTime() + slaMinutes * 60 * 1000);

        if (!req.service?.isComplimentary && typeof (em?.getRepository || this.dataSource?.getRepository) === 'function') {
          const queryFn = typeof em?.query === 'function' ? em.query.bind(em) : this.dataSource.query.bind(this.dataSource);
          const [booking] = await queryFn(
            'SELECT hotel_id AS hotelId FROM bookings WHERE id = ? LIMIT 1',
            [req.bookingId],
          );
          if ((dto as any)?.hotelId !== undefined && booking?.hotelId && String((dto as any).hotelId) !== String(booking.hotelId)) {
            throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn thực tế của phiếu dịch vụ.');
          }
          const promoRepo = em?.getRepository
            ? em.getRepository(PromotionCampaign)
            : this.dataSource.getRepository(PromotionCampaign);
          if (booking?.hotelId && promoRepo && typeof promoRepo.find === 'function') {
            const activeCampaigns = await promoRepo.find({
              where: { hotelId: String(booking.hotelId), status: PromotionCampaignStatus.ACTIVE },
            });
            const baseUnit = Number(req.unitPrice || req.service?.basePrice || 0);
            const qty = Number(req.quantity || 1);
            const oldDiscount = Math.max(0, Math.round(baseUnit * qty - oldTotalPrice));
            const repriced = computeServiceItemPricing({
              hotelId: String(booking.hotelId),
              serviceId: String(req.serviceId),
              baseUnitPrice: baseUnit,
              quantity: qty,
              usageAt: nextScheduled,
              activeCampaigns,
            });
            // FIX-24: Nếu đổi lịch do lỗi/điều phối từ phía khách sạn (rescheduleInitiator === 'HOTEL') và giá mới cao hơn giá cũ,
            // bảo lưu mức giá ưu đãi ban đầu cho khách; nếu do khách đổi sang ngoài khung giờ thì tính lại giá và hoàn ngân sách.
            const isHotelInitiated = (dto as any)?.rescheduleInitiator === 'HOTEL';
            if (isHotelInitiated && repriced.netTotal > oldTotalPrice) {
              req.totalPrice = oldTotalPrice;
            } else {
              if (repriced.discountAmount > oldDiscount && repriced.appliedCampaign && typeof promoRepo.findOne === 'function') {
                const deltaDisc = repriced.discountAmount - oldDiscount;
                const lockedCamp = await promoRepo.findOne({
                  where: { id: repriced.appliedCampaign.id },
                  ...(em ? { lock: { mode: 'pessimistic_write' } } : {}),
                });
                if (!lockedCamp || lockedCamp.status !== PromotionCampaignStatus.ACTIVE || !hasRemainingCampaignBudget(lockedCamp, deltaDisc)) {
                  throw new ConflictException('PROMO_BUDGET_EXHAUSTED: Ngân sách khuyến mãi khung giờ mới không còn đủ.');
                }
                lockedCamp.budgetConsumed = Number(lockedCamp.budgetConsumed || 0) + deltaDisc;
                if (oldDiscount === 0) {
                  lockedCamp.redemptionsCount = Number(lockedCamp.redemptionsCount || 0) + 1;
                }
                await promoRepo.save(lockedCamp);
              } else if (repriced.discountAmount < oldDiscount && typeof promoRepo.findOne === 'function') {
                const releaseDisc = oldDiscount - repriced.discountAmount;
                const codeMatch = String(req.note || '').match(/\[KM\s+([A-Z0-9_-]+):/i);
                const matchedCamp = codeMatch
                  ? activeCampaigns.find((c: any) => String(c.code).toUpperCase() === codeMatch[1].toUpperCase())
                  : activeCampaigns[0];
                if (matchedCamp) {
                  const lockedCamp = await promoRepo.findOne({
                    where: { id: matchedCamp.id },
                    ...(em ? { lock: { mode: 'pessimistic_write' } } : {}),
                  });
                  if (lockedCamp) {
                    lockedCamp.budgetConsumed = Math.max(0, Number(lockedCamp.budgetConsumed || 0) - releaseDisc);
                    if (repriced.discountAmount === 0) {
                      lockedCamp.redemptionsCount = Math.max(0, Number(lockedCamp.redemptionsCount || 0) - 1);
                    }
                    await promoRepo.save(lockedCamp);
                  }
                }
              }
              req.totalPrice = repriced.netTotal;
            }
            const historyTag = `[RESCHEDULED ${prevScheduledIso} -> ${nextScheduled.toISOString()} | ${oldTotalPrice}đ -> ${req.totalPrice}đ]`;
            req.note = req.note ? `${req.note} ${historyTag}` : historyTag;
          }
        }
      }

      if (dto.status) req.status = dto.status;
      if (dto.assignedTo !== undefined) req.assignedTo = dto.assignedTo;
      if (dto.note !== undefined) {
        const preservedTags = (String(req.note || '').match(/\[(KM|RESCHEDULED|PROMO_SNAPSHOT)[^\]]*\]/g) || []).join(' ');
        req.note = preservedTags ? `${dto.note} ${preservedTags}`.trim() : dto.note;
      }
      if (dto.completedAt) req.completedAt = new Date(dto.completedAt);
      if (dto.confirmedAt) req.confirmedAt = new Date(dto.confirmedAt);
      if (dto.failureReason) req.failureReason = dto.failureReason;

      // Chặn nhân viên tự ghi đè phê duyệt đền bù (recoveryApprovedBy / recoveryCost) nếu không phải Manager/Admin
      if (
        dto.recoveryAction !== undefined ||
        dto.recoveryApprovedBy !== undefined ||
        dto.recoveryCost !== undefined
      ) {
        if (actor && actor.role !== 'ADMIN') {
          const queryFn = typeof em?.query === 'function' ? em.query.bind(em) : this.dataSource.query.bind(this.dataSource);
          const [booking] = await queryFn(
            'SELECT hotel_id AS hotelId FROM bookings WHERE id = ? LIMIT 1',
            [req.bookingId],
          );
          const isMgr = booking?.hotelId ? await this.isHotelManager(actor.id, booking.hotelId) : false;
          if (!isMgr) {
            throw new ForbiddenException(
              'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới được phép cập nhật thông tin phê duyệt đền bù dịch vụ.',
            );
          }
        }
        if (dto.recoveryAction !== undefined) req.recoveryAction = dto.recoveryAction;
        if (dto.recoveryApprovedBy !== undefined) req.recoveryApprovedBy = dto.recoveryApprovedBy;
        if (dto.recoveryCost !== undefined) req.recoveryCost = dto.recoveryCost;
      }

      const saved = await reqRepo.save(req);
      const [enriched] = await this.enrichServiceRequestsWithSettlement([saved]);
      return enriched || saved;
    };

    if (typeof this.dataSource?.transaction === 'function') {
      return await this.dataSource.transaction(async (em) => runUpdate(em));
    }
    return await runUpdate();
  }

  async updateServiceRequestStatus(
    id: number,
    targetStatus: ServiceRequestStatus,
    payload?: {
      assignedTo?: number;
      failureReason?: string;
      note?: string;
    },
    actor?: User,
  ): Promise<ServiceRequest> {
    const runStatusTransition = async (em?: any) => {
      const reqRepo = em?.getRepository ? em.getRepository(ServiceRequest) : this.serviceRequestRepo;
      const req = await reqRepo.findOne({
        where: { id },
        relations: ['service'],
        ...(em ? { lock: { mode: 'pessimistic_write' } } : {}),
      });
      if (!req)
        throw new NotFoundException(`Yêu cầu dịch vụ #${id} không tồn tại`);

      // Lỗi 05: Bắt buộc kiểm tra quyền của actor trên booking.hotelId
      await this.assertServiceRequestOperator(em, req, actor);

      // Section IV & FIX-05: Dịch vụ đã cung cấp/nghiệm thu (COMPLETED/CONFIRMED) không được chuyển sang CANCELLED/FAILED để đảo tín dụng
      const previousStatus = req.status;
      if (
        (previousStatus === ServiceRequestStatus.COMPLETED ||
          previousStatus === ServiceRequestStatus.CONFIRMED ||
          req.completedAt ||
          req.confirmedAt) &&
        (targetStatus === ServiceRequestStatus.CANCELLED || targetStatus === ServiceRequestStatus.FAILED)
      ) {
        throw new ConflictException(
          `Phiếu dịch vụ #${id} đã hoàn tất (${previousStatus}) nên không thể chuyển sang ${targetStatus} để đảo tín dụng. Nếu dịch vụ có sai sót cần bù đắp, vui lòng lập biên bản Service Recovery có phê duyệt.`,
        );
      }
      if (
        (previousStatus === ServiceRequestStatus.CANCELLED || previousStatus === ServiceRequestStatus.FAILED) &&
        targetStatus !== previousStatus
      ) {
        throw new ConflictException(
          `Phiếu dịch vụ #${id} đã đóng ở trạng thái ${previousStatus}, không thể chuyển tiếp sang ${targetStatus}.`,
        );
      }

      const now = new Date();

      if (
        req.slaDueAt &&
        now > req.slaDueAt &&
        targetStatus !== ServiceRequestStatus.COMPLETED &&
        targetStatus !== ServiceRequestStatus.CONFIRMED
      ) {
        req.isSlaBreahed = true;
      }

      req.status = targetStatus;

      const originalNote = String(req.note || '');
      const preservedAuditTags = (originalNote.match(/\[(KM|RESCHEDULED|PROMO_SNAPSHOT)[^\]]*\]/g) || []).join(' ');

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
          if (payload?.note) {
            req.note = preservedAuditTags ? `${payload.note} ${preservedAuditTags}`.trim() : payload.note;
          }
          break;
      }

      if (payload?.note) {
        req.note = preservedAuditTags ? `${payload.note} ${preservedAuditTags}`.trim() : payload.note;
      }
      if (payload?.assignedTo !== undefined) req.assignedTo = payload.assignedTo;

      const savedReq = await reqRepo.save(req);

      // Lỗi 17 & FIX-12: Đổi trạng thái CANCELLED/FAILED lần đầu, giải phóng ngân sách khuyến mãi dịch vụ trực tiếp và đảo bút toán credit (REVERSAL) trong CÙNG 1 transaction nguyên tử
      const isFirstTimeCancelOrFail =
        previousStatus !== ServiceRequestStatus.CANCELLED &&
        previousStatus !== ServiceRequestStatus.FAILED;
      if (
        targetStatus === ServiceRequestStatus.CANCELLED ||
        targetStatus === ServiceRequestStatus.FAILED
      ) {
        const directDisc = Math.max(
          0,
          Math.round(Number(req.unitPrice || 0) * Math.max(1, Number(req.quantity || 1)) - Number(req.totalPrice || 0)),
        );
        if (isFirstTimeCancelOrFail && directDisc > 0 && typeof em?.getRepository === 'function') {
          const promoRepo = em.getRepository(PromotionCampaign);
          const codeMatch = originalNote.match(/\[KM\s+([A-Z0-9_-]+):/i);
          if (promoRepo && codeMatch && typeof promoRepo.findOne === 'function') {
            let resolvedHotelId = req.service?.hotelId ? String(req.service.hotelId) : undefined;
            if (!resolvedHotelId) {
              const queryFn =
                typeof em?.query === 'function'
                  ? em.query.bind(em)
                  : typeof this.dataSource?.query === 'function'
                    ? this.dataSource.query.bind(this.dataSource)
                    : null;
              if (queryFn) {
                const [bRow] = await queryFn(
                  'SELECT hotel_id AS hotelId FROM bookings WHERE id = ? LIMIT 1',
                  [req.bookingId],
                );
                if (bRow?.hotelId) resolvedHotelId = String(bRow.hotelId);
              }
            }
            const whereClause: Record<string, any> = { code: codeMatch[1].toUpperCase() };
            if (resolvedHotelId) whereClause.hotelId = resolvedHotelId;
            const lockedCamp = await promoRepo.findOne({
              where: whereClause,
              lock: { mode: 'pessimistic_write' },
            });
            if (lockedCamp) {
              lockedCamp.budgetConsumed = Math.max(0, Number(lockedCamp.budgetConsumed || 0) - directDisc);
              lockedCamp.budgetReversed = Number(lockedCamp.budgetReversed || 0) + directDisc;
              lockedCamp.redemptionsCount = Math.max(0, Number(lockedCamp.redemptionsCount || 0) - 1);
              await promoRepo.save(lockedCamp);
            }
          }
        }
        await this.autoReverseServiceBenefitRedemptions(savedReq, em, actor);
      }

      const [enriched] = await this.enrichServiceRequestsWithSettlement([savedReq]);
      return enriched || savedReq;
    };

    if (typeof this.dataSource?.transaction === 'function') {
      return await this.dataSource.transaction(async (em) => runStatusTransition(em));
    }
    return await runStatusTransition();
  }

  private async autoReverseServiceBenefitRedemptions(
    req: ServiceRequest,
    existingEm?: any,
    actor?: User,
  ): Promise<void> {
    const executeReversal = async (em: any) => {
      if (!em || typeof em.find !== 'function') return;
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
        const nextAvailAmt = Number(acc.availableAmount || 0) + restoreAmt;
        const nextAvailQuota = Number(acc.availableQuota || 0) + restoreQ;

        await em.save(
          BookingBenefitLedger,
          em.create(BookingBenefitLedger, {
            accountId: acc.id,
            bookingId: String(req.bookingId),
            hotelId: red.hotelId,
            campaignId: acc.campaignId,
            entryType: BenefitLedgerEntryType.REVERSAL,
            amountDelta: restoreAmt,
            balanceAfter: nextAvailAmt,
            quotaDelta: restoreQ,
            quotaAfter: nextAvailQuota,
            serviceRequestId: String(req.id),
            referenceEntryId: red.id,
            performedBy: actor ? String(actor.id) : req.assignedTo ? String(req.assignedTo) : null,
            idempotencyKey: revKey,
            reason: `Tự động hoàn lại tín dụng do dịch vụ #${req.id} chuyển sang trạng thái ${req.status}`,
          }),
        );

        acc.reversedAmount = Number(acc.reversedAmount || 0) + restoreAmt;
        acc.redeemedAmount = Math.max(0, Number(acc.redeemedAmount || 0) - restoreAmt);
        acc.availableAmount = nextAvailAmt;
        acc.usedQuota = Math.max(0, Number(acc.usedQuota || 0) - restoreQ);
        acc.availableQuota = nextAvailQuota;
        if (acc.status === BenefitAccountStatus.SETTLED && (acc.availableAmount > 0 || acc.availableQuota > 0)) {
          acc.status = BenefitAccountStatus.APPROVED;
        }
        acc.version += 1;
        await em.save(BookingBenefitAccount, acc);
      }
    };

    if (existingEm) {
      await executeReversal(existingEm);
      return;
    }
    if (typeof this.dataSource?.transaction === 'function') {
      await this.dataSource.transaction(async (em) => executeReversal(em));
    }
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
      'SELECT id, user_id AS userId, hotel_id AS hotelId, handled_by AS handledBy, status FROM bookings WHERE id = ? LIMIT 1',
      [bookingId],
    );
    if (!booking) {
      throw new NotFoundException(`Booking #${bookingId} không tồn tại`);
    }

    // Lỗi 26 (Hotel-First): Tuyệt đối không tin hotelId từ client; luôn lấy booking.hotelId thực từ DB
    if (hotelId !== undefined && hotelId !== null && String(hotelId) !== String(booking.hotelId)) {
      throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn thực tế sở hữu booking.');
    }
    const targetHotelId = booking.hotelId;

    if (user && user.role !== 'ADMIN') {
      await assertBookingOperator(
        this.dataSource.manager,
        booking as any,
        { id: String(user.id), role: user.role },
      );
    }

    const qb = this.roomServiceRepo
      .createQueryBuilder('rs')
      .leftJoinAndSelect('rs.category', 'cat')
      .where('rs.status = :status', { status: 'ACTIVE' })
      .andWhere('rs.serviceType IN (:...types)', {
        types: [ServiceType.INCLUDED, ServiceType.QUOTA],
      });

      // Lỗi 26: Nếu client truyền roomTypeId, xác minh phòng đó thuộc đúng khách sạn của booking
      if (roomTypeId !== undefined && roomTypeId !== null) {
        const [roomRow] = await this.dataSource.query(
          'SELECT id, hotel_id AS hotelId FROM rooms WHERE id = ? LIMIT 1',
          [roomTypeId],
        );
        if (roomRow && String(roomRow.hotelId) !== String(targetHotelId)) {
          throw new ForbiddenException('Loại phòng (roomTypeId) truyền lên không thuộc khách sạn của booking.');
        }
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
    actor?: User,
  ): Promise<ServiceRecoveryLog> {
    const [booking] = await this.dataSource.query(
      'SELECT id, user_id AS userId, hotel_id AS hotelId, handled_by AS handledBy, status FROM bookings WHERE id = ? LIMIT 1',
      [dto.bookingId],
    );
    if (!booking) {
      throw new NotFoundException(`Booking #${dto.bookingId} không tồn tại`);
    }
    if ((dto as any)?.hotelId !== undefined && String((dto as any).hotelId) !== String(booking.hotelId)) {
      throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn thực tế sở hữu đơn đặt phòng.');
    }

    // Lỗi 07: Bắt buộc kiểm tra quyền của actor trên booking.hotelId và gán reportedBy từ JWT
    if (actor && actor.role !== 'ADMIN') {
      await assertBookingOperator(
        this.dataSource.manager,
        booking as any,
        { id: String(actor.id), role: actor.role },
        'SERVICE_REQUEST',
      );
    }
    const authoritativeReporter = actor ? Number(actor.id) : Number(dto.reportedBy);

    const runCreateRecovery = async (em?: any) => {
      const recoveryRepo = em?.getRepository ? em.getRepository(ServiceRecoveryLog) : this.recoveryLogRepo;
      const reqRepo = em?.getRepository ? em.getRepository(ServiceRequest) : this.serviceRequestRepo;

      let linkedReq: ServiceRequest | null = null;
      if (dto.serviceRequestId) {
        linkedReq = await reqRepo.findOne({
          where: { id: dto.serviceRequestId },
          ...(em ? { lock: { mode: 'pessimistic_write' } } : {}),
        });
        if (!linkedReq) {
          throw new NotFoundException(`Yêu cầu dịch vụ #${dto.serviceRequestId} không tồn tại`);
        }
        if (String(linkedReq.bookingId) !== String(booking.id)) {
          throw new ForbiddenException(
            `Phiếu dịch vụ #${dto.serviceRequestId} không thuộc booking #${dto.bookingId}.`,
          );
        }
      }

      const log = recoveryRepo.create({
        serviceRequestId: dto.serviceRequestId ?? null,
        bookingId: dto.bookingId,
        reportedBy: authoritativeReporter,
        recoveryType: dto.recoveryType,
        reason: dto.reason,
        actionTaken: dto.actionTaken,
        costIncurred: dto.costIncurred ?? 0,
        status: 'PENDING',
      });
      const saved = await recoveryRepo.save(log);

      if (linkedReq) {
        // FIX-07 & Section IV: Nếu dịch vụ đã hoàn tất (COMPLETED/CONFIRMED), biên bản PENDING chỉ ghi nhận yêu cầu bồi hoàn chờ Manager duyệt,
        // tuyệt đối KHÔNG tự ý hạ trạng thái về FAILED và KHÔNG tự đảo credit như thể dịch vụ chưa từng được cung cấp!
        const isAlreadyProvided =
          linkedReq.status === ServiceRequestStatus.COMPLETED ||
          linkedReq.status === ServiceRequestStatus.CONFIRMED;
        if (!isAlreadyProvided && linkedReq.status !== ServiceRequestStatus.CANCELLED) {
          linkedReq.status = ServiceRequestStatus.FAILED;
          linkedReq.failureReason = dto.reason || linkedReq.failureReason;
          linkedReq.recoveryAction = `${dto.recoveryType}: ${dto.actionTaken}`;
          linkedReq.recoveryCost = dto.costIncurred ?? 0;
          const savedReq = await reqRepo.save(linkedReq);
          await this.autoReverseServiceBenefitRedemptions(savedReq, em, actor);
        } else {
          linkedReq.recoveryAction = `[PENDING_APPROVAL] ${dto.recoveryType}: ${dto.actionTaken}`;
          await reqRepo.save(linkedReq);
        }
      }

      return saved;
    };

    if (typeof this.dataSource?.transaction === 'function') {
      return await this.dataSource.transaction(async (em) => runCreateRecovery(em));
    }
    return await runCreateRecovery();
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

    log.approvedBy = dto.approvedBy ?? (actor ? Number(actor.id) : null);
    log.status = dto.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    return this.recoveryLogRepo.save(log);
  }

  async getRecoveryLogs(bookingId?: number, actor?: User, hotelId?: number): Promise<ServiceRecoveryLog[]> {
    // Lỗi 06: Lọc phạm vi khách sạn cho EMPLOYEE, cấm rò dữ liệu recovery logs xuyên khách sạn
    if (actor && actor.role !== 'ADMIN') {
      if (bookingId) {
        const [booking] = await this.dataSource.query(
          'SELECT id, user_id AS userId, hotel_id AS hotelId FROM bookings WHERE id = ? LIMIT 1',
          [bookingId],
        );
        if (!booking) {
          throw new NotFoundException(`Booking #${bookingId} không tồn tại`);
        }
        if (actor.role === 'CUSTOMER' && String(booking.userId) !== String(actor.id)) {
          throw new ForbiddenException('Bạn không có quyền xem biên bản sự cố của đơn đặt phòng này.');
        }
        if (actor.role === 'EMPLOYEE') {
          const [staff] = await this.dataSource.query(
            'SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = "ACTIVE" LIMIT 1',
            [actor.id, booking.hotelId],
          );
          if (!staff) {
            throw new ForbiddenException('Bạn không thuộc nhân sự khách sạn của đơn đặt phòng này.');
          }
        }
        return this.recoveryLogRepo.find({
          where: { bookingId },
          order: { createdAt: 'DESC' },
        });
      }

      if (actor.role === 'EMPLOYEE') {
        if (hotelId) {
          const [staff] = await this.dataSource.query(
            'SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = "ACTIVE" LIMIT 1',
            [actor.id, hotelId],
          );
          if (!staff) {
            throw new ForbiddenException('Bạn không thuộc nhân sự đang hoạt động tại khách sạn này.');
          }
        }
        const qb = this.recoveryLogRepo
          .createQueryBuilder('rl')
          .innerJoin('bookings', 'b', 'b.id = rl.booking_id')
          .where(
            'b.hotel_id IN (SELECT hotel_id FROM hotel_staff WHERE staff_user_id = :staffUserId AND status = "ACTIVE")',
            { staffUserId: actor.id },
          );
        if (hotelId) {
          qb.andWhere('b.hotel_id = :hotelId', { hotelId });
        }
        return qb.orderBy('rl.createdAt', 'DESC').getMany();
      }

      return [];
    }

    if (hotelId && !bookingId) {
      return this.recoveryLogRepo
        .createQueryBuilder('rl')
        .innerJoin('bookings', 'b', 'b.id = rl.booking_id')
        .where('b.hotel_id = :hotelId', { hotelId })
        .orderBy('rl.createdAt', 'DESC')
        .getMany();
    }

    const where = bookingId ? { bookingId } : {};
    return this.recoveryLogRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  // ============================================================
  // STATISTICS
  // ============================================================

  async getServiceStats(actor?: User, hotelId?: number): Promise<{
    totalCategories: number;
    totalServices: number;
    totalRequests: number;
    pendingRequests: number;
    completedRequests: number;
    breachedSlaRequests: number;
  }> {
    if (actor && actor.role === 'EMPLOYEE') {
      if (hotelId) {
        const [staff] = await this.dataSource.query(
          'SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = "ACTIVE" LIMIT 1',
          [actor.id, hotelId],
        );
        if (!staff) {
          throw new ForbiddenException('Bạn không thuộc nhân sự đang hoạt động tại khách sạn này.');
        }
      }
      const totalCategories = await this.categoryRepo.count({ where: { status: 'ACTIVE' } });
      const svcQb = this.roomServiceRepo
        .createQueryBuilder('rs')
        .where('rs.status = :status', { status: 'ACTIVE' })
        .andWhere(
          '(rs.hotelId IS NULL OR rs.hotelId IN (SELECT hotel_id FROM hotel_staff WHERE staff_user_id = :staffUserId AND status = "ACTIVE"))',
          { staffUserId: actor.id },
        );
      if (hotelId) {
        svcQb.andWhere('(rs.hotelId IS NULL OR rs.hotelId = :hotelId)', { hotelId });
      }

      const buildReqCountQb = () => {
        const qb = this.serviceRequestRepo
          .createQueryBuilder('sr')
          .innerJoin('bookings', 'b', 'b.id = sr.booking_id')
          .where(
            'b.hotel_id IN (SELECT hotel_id FROM hotel_staff WHERE staff_user_id = :staffUserId AND status = "ACTIVE")',
            { staffUserId: actor.id },
          );
        if (hotelId) {
          qb.andWhere('b.hotel_id = :hotelId', { hotelId });
        }
        return qb;
      };

      const [totalServices, totalRequests, pendingRequests, completedRequests, breachedSlaRequests] =
        await Promise.all([
          svcQb.getCount(),
          buildReqCountQb().getCount(),
          buildReqCountQb().andWhere('sr.status = :st', { st: ServiceRequestStatus.PENDING }).getCount(),
          buildReqCountQb().andWhere('sr.status = :st', { st: ServiceRequestStatus.COMPLETED }).getCount(),
          buildReqCountQb().andWhere('sr.isSlaBreahed = :br', { br: true }).getCount(),
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
