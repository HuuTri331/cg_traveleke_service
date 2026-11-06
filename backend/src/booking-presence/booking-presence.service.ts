import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { assertCommittedEntitlement, assertBookingOperator } from '../bookings/services/booking-operation-policy';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import {
  BookingPresenceEvent,
  PresenceActorType,
  PresenceEventType,
} from './entities/booking-presence-event.entity';
import { BookingStatusLog } from '../bookings/entities/booking-status-log.entity';
import { HotelStaff } from '../hotel-staff/entities/hotel-staff.entity';
import { User } from '../users/entities/user.entity';
import { ConfirmArrivalDto } from './dto/confirm-arrival.dto';
import { ConfirmDepartureDto } from './dto/confirm-departure.dto';
import { LateArrivalNoticeDto } from './dto/late-arrival-notice.dto';
import {
  BenefitAccountStatus,
  BookingBenefitAccount,
} from '../promotions/entities/booking-benefit-account.entity';
import {
  BenefitLedgerEntryType,
  BookingBenefitLedger,
} from '../promotions/entities/booking-benefit-ledger.entity';
import { BenefitKind } from '../promotions/entities/promotion-campaign.entity';
import { computeServiceReceivableProjection } from '../promotions/service-receivable-projection';
import { ServiceRequest, ServiceRequestStatus } from '../services/entities/service-request.entity';
import { GuestWorkTask, WorkTaskPriority, WorkTaskStatus, WorkTaskType } from '../guest-work/entities/guest-work-task.entity';
import { GuestWorkEvent, WorkEventType, WorkEvidenceType } from '../guest-work/entities/guest-work-event.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { runWithDeadlockRetry } from '../common/database/transaction-retry.helper';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { FeatureFlagsService } from '../property-settings/feature-flags.service';
import { HotelFeatureFlagKey } from '../property-settings/entities/hotel-feature-flag.entity';
import { RoomAllocationService } from '../room-units/room-allocation.service';
import { FolioService } from '../folio/folio.service';
import { OutboxService } from '../outbox/outbox.service';
import { BOOKING_DOMAIN_EVENTS } from '../common/events/booking-domain-event-registry';

@Injectable()
export class BookingPresenceService {
  private readonly logger = new Logger(BookingPresenceService.name);

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,

    @InjectRepository(BookingPresenceEvent)
    private readonly presenceEventRepo: Repository<BookingPresenceEvent>,

    @InjectRepository(BookingStatusLog)
    private readonly statusLogRepo: Repository<BookingStatusLog>,

    @InjectRepository(HotelStaff)
    private readonly hotelStaffRepo: Repository<HotelStaff>,

    private readonly dataSource: DataSource,

    @Optional()
    private readonly realtimeGateway?: RealtimeGateway,

    @Optional()
    private readonly coverageService?: BookingCoverageService,

    @Optional()
    private readonly featureFlags?: FeatureFlagsService,

    @Optional()
    private readonly roomAllocationService?: RoomAllocationService,

    @Optional()
    private readonly folioService?: FolioService,

    @Optional()
    private readonly outboxService?: OutboxService,
  ) {}

  /**
   * Kiểm tra quyền của nhân viên/quản lý đối với khách sạn của đơn booking
   */
  async validateStaffHotelAccess(
    staffUserId: string,
    hotelId: string,
    userRole?: string,
  ): Promise<boolean> {
    if (userRole === 'ADMIN') return true;

    const relation = await this.hotelStaffRepo.findOne({
      where: {
        staffUserId,
        hotelId,
        status: 'ACTIVE',
      },
    });

    return !!relation;
  }

  /**
   * Kiểm tra quyền Quản lý (MANAGER) hoặc ADMIN của nhân viên tại khách sạn
   */
  async validateManagerHotelAccess(
    staffUserId: string,
    hotelId: string,
    userRole?: string,
  ): Promise<boolean> {
    if (userRole === 'ADMIN') return true;

    const relation = await this.hotelStaffRepo.findOne({
      where: {
        staffUserId,
        hotelId,
        status: 'ACTIVE',
      },
    });

    return !!relation && relation.staffRole === 'MANAGER';
  }

  async getBookingById(bookingId: string): Promise<Booking | null> {
    return this.bookingRepo.findOne({ where: { id: bookingId } });
  }

  /**
   * Xác nhận khách có mặt tại quầy (Check-in)
   * Xử lý cả 2 tình huống:
   *  1. Đến đúng hạn hoặc trước ngưỡng No-show: CONFIRMED -> CHECKED_IN
   *  2. Đến muộn sau khi đã bị No-show: NO_SHOW -> CHECKED_IN (Khôi phục nhận phòng muộn)
   *
   * Bất biến quan trọng (INV-03): KHÔNG đụng đến hold COMMITTED, KHÔNG trừ tồn phòng lần 2.
   */
  async confirmArrival(
    bookingId: string,
    actorUserId: string,
    actorRole: string,
    dto: ConfirmArrivalDto,
  ) {
    const result = await runWithDeadlockRetry(
      this.dataSource,
      async (manager: EntityManager) => {
        const bookingRepo = manager.getRepository(Booking);
        const presenceRepo = manager.getRepository(BookingPresenceEvent);
        const logRepo = manager.getRepository(BookingStatusLog);

        // Khóa bi quan hàng booking để tránh race condition giữa lễ tân & scheduler No-show
        const booking = await bookingRepo
          .createQueryBuilder('booking')
          .setLock('pessimistic_write')
          .where('booking.id = :id', { id: bookingId })
          .getOne();

        if (!booking) {
          throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
        }

        // Kiểm tra quyền hạn của nhân viên tại khách sạn
        const hasAccess = await this.validateStaffHotelAccess(
          actorUserId,
          booking.hotelId,
          actorRole,
        );
        if (!hasAccess) {
          throw new ForbiddenException(
            'Bạn không có quyền thực hiện xác nhận nhận phòng tại khách sạn này.',
          );
        }

        // Kiểm tra hủy / hoàn tiền
        if (booking.status === BookingStatus.CANCELLED) {
          throw new ConflictException(
            'Đơn đặt phòng này đã bị hủy. Không thể thực hiện nhận phòng.',
          );
        }

        const now = new Date();

        // Kiểm tra mô hình thời gian nửa mở: [checkInAt, checkOutAt)
        // Nếu now >= checkOutAt: Từ chối check-in vì kỳ lưu trú đã hết hạn
        if (now >= new Date(booking.checkOutAt)) {
          throw new ConflictException(
            `Kỳ lưu trú đã kết thúc vào lúc ${new Date(booking.checkOutAt).toLocaleString('vi-VN')}. ` +
              'Không thể thực hiện nhận phòng muộn sau khi kỳ lưu trú đã kết thúc.',
          );
        }

        // Tính chất Idempotent: Nếu đã CHECKED_IN thì trả về thành công an toàn
        if (booking.status === BookingStatus.CHECKED_IN) {
          return {
            booking,
            alreadyCheckedIn: true,
            message: 'Đơn đặt phòng này đã được xác nhận nhận phòng trước đó.',
          };
        }

        // Các trạng thái hợp lệ để tiếp nhận check-in: CONFIRMED, PENDING, NO_SHOW
        const validStates: string[] = [
          BookingStatus.CONFIRMED,
          BookingStatus.PENDING,
          BookingStatus.NO_SHOW,
        ];

        if (!validStates.includes(booking.status)) {
          throw new BadRequestException(
            `Không thể thực hiện nhận phòng từ trạng thái "${booking.status}". ` +
              `Trạng thái phải là: [${validStates.join(', ')}].`,
          );
        }

        await assertCommittedEntitlement(manager, booking);
        await assertBookingOperator(manager, booking, { id: actorUserId, role: actorRole }, 'CHECK_IN', now);

        // IMP-01 / GAP-01: Nếu khách sạn bật cờ ROOM_UNIT_CHECKIN_REQUIRED, kiểm tra phòng vật lý đã gán & READY
        if (this.featureFlags && this.roomAllocationService) {
          const requireUnitReady = await this.featureFlags.isEnabled(
            booking.hotelId,
            HotelFeatureFlagKey.ROOM_UNIT_CHECKIN_REQUIRED,
            manager,
          );
          if (requireUnitReady) {
            await this.roomAllocationService.assertBookingRoomReady(booking.id, manager);
          }
        }

        const actingPrefix = '';

        const fromStatus = booking.status;
        const isFromNoShow = fromStatus === BookingStatus.NO_SHOW;
        const eventType = isFromNoShow
          ? PresenceEventType.LATE_CHECK_IN_RECOVERED
          : PresenceEventType.ARRIVAL_CONFIRMED;

        // Tính số phút muộn so với checkInAt tiêu chuẩn
        const checkInTime = new Date(booking.checkInAt).getTime();
        const currentTime = now.getTime();
        const lateMinutes =
          currentTime > checkInTime
            ? Math.floor((currentTime - checkInTime) / 60000)
            : 0;

        // Cập nhật booking (Giữ nguyên booking.handledBy = A, chỉ ghi checkInConfirmedBy = B)
        booking.status = BookingStatus.CHECKED_IN;
        booking.actualCheckInAt = now;
        booking.checkInConfirmedBy = actorUserId;
        booking.presenceVersion = (booking.presenceVersion || 1) + 1;

        if (isFromNoShow) {
          booking.lateCheckInRecoveredAt = now;
        }

        const savedBooking = await bookingRepo.save(booking);

        const defaultReason = isFromNoShow
          ? `Khôi phục nhận phòng muộn sau No-Show (${lateMinutes} phút sau giờ nhận phòng)`
          : `Khách nhận phòng tại quầy (${lateMinutes} phút)`;

        // Lưu bản ghi sự kiện hiện diện
        const presenceEvent = presenceRepo.create({
          bookingId: booking.id,
          hotelId: booking.hotelId,
          fromStatus,
          toStatus: BookingStatus.CHECKED_IN,
          actorType: PresenceActorType.USER,
          actorId: actorUserId,
          eventType,
          lateMinutes,
          reason: `${actingPrefix}${dto.note || defaultReason}`.trim(),
          idempotencyKey: dto.commandId || null,
          occurredAt: now,
        });
        await presenceRepo.save(presenceEvent);

        // Lưu nhật ký trạng thái
        const statusLog = logRepo.create({
          bookingId: booking.id,
          changedBy: actorUserId,
          actorType: 'USER',
          oldStatus: fromStatus,
          newStatus: BookingStatus.CHECKED_IN,
          note:
            dto.note ||
            (isFromNoShow
              ? 'Khôi phục nhận phòng muộn sau khi khách bị đánh dấu No-Show'
              : 'Xác nhận khách nhận phòng thực tế tại quầy lễ tân'),
        });
        await logRepo.save(statusLog);

        // P1-12: Tự động liên kết / hoàn tất checklist GuestWorkTask CHECK_IN gắn với sự kiện nhận phòng để chấm KPI M3 đúng actor
        await this.ensurePresenceChecklistTask(
          manager,
          booking,
          WorkTaskType.CHECK_IN,
          actorUserId,
          now,
          dto.note || 'Hoàn tất quy trình nhận phòng tại quầy',
        );

        return {
          booking: savedBooking,
          presenceEvent,
          fromStatus,
          isFromNoShow,
          lateMinutes,
          alreadyCheckedIn: false,
          message: isFromNoShow
            ? 'Khôi phục nhận phòng muộn thành công! Suất phòng đã được kích hoạt sử dụng.'
            : 'Xác nhận nhận phòng tại quầy thành công!',
        };
      },
      {
        contextName: 'BookingPresenceService.confirmArrival',
        maxRetries: 3,
        baseDelayMs: 50,
      },
    );

    // Gửi realtime thông báo ngoài transaction
    if (this.realtimeGateway && result.booking && !result.alreadyCheckedIn) {
      try {
        this.realtimeGateway.emitBookingStatusChanged({
          id: result.booking.id,
          bookingCode: result.booking.bookingCode,
          hotelId: result.booking.hotelId,
          userId: result.booking.userId,
          oldStatus: result.fromStatus || (result.isFromNoShow
            ? BookingStatus.NO_SHOW
            : BookingStatus.CONFIRMED),
          newStatus: BookingStatus.CHECKED_IN,
          changedAt: result.booking.actualCheckInAt?.toISOString() || new Date().toISOString(),
          note: result.isFromNoShow
            ? 'Khôi phục nhận phòng muộn sau No-show thành công'
            : 'Xác nhận nhận phòng tại quầy thành công',
        });
      } catch (err) {
        this.logger.warn(`Failed to emit checkin realtime: ${(err as any)?.message}`);
      }
    }

    return result;
  }

  /**
   * Xác nhận khách trả phòng (Check-out)
   * CHECKED_IN -> COMPLETED
   */
  async confirmDeparture(
    bookingId: string,
    actorUserId: string,
    actorRole: string,
    dto: ConfirmDepartureDto,
  ) {
    const result = await runWithDeadlockRetry(
      this.dataSource,
      async (manager: EntityManager) => {
        const bookingRepo = manager.getRepository(Booking);
        const presenceRepo = manager.getRepository(BookingPresenceEvent);
        const logRepo = manager.getRepository(BookingStatusLog);

        const booking = await bookingRepo
          .createQueryBuilder('booking')
          .setLock('pessimistic_write')
          .where('booking.id = :id', { id: bookingId })
          .getOne();

        if (!booking) {
          throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
        }

        const hasAccess = await this.validateStaffHotelAccess(
          actorUserId,
          booking.hotelId,
          actorRole,
        );
        if (!hasAccess) {
          throw new ForbiddenException(
            'Bạn không có quyền thực hiện xác nhận trả phòng tại khách sạn này.',
          );
        }

        if (booking.status === BookingStatus.COMPLETED) {
          return {
            booking,
            alreadyCompleted: true,
            message: 'Đơn đặt phòng này đã hoàn tất trả phòng trước đó.',
          };
        }

        if (booking.status !== BookingStatus.CHECKED_IN) {
          throw new BadRequestException(
            `Chỉ có thể làm thủ tục trả phòng khi đơn ở trạng thái đã nhận phòng (CHECKED_IN). ` +
              `Trạng thái hiện tại: "${booking.status}".`,
          );
        }

        if (!booking.actualCheckInAt) {
          throw new ConflictException('Đơn đặt phòng chưa được làm thủ tục nhận phòng thực tế, không thể xác nhận trả phòng.');
        }
        await assertBookingOperator(manager, booking, { id: actorUserId, role: actorRole }, 'CHECK_OUT');

        // Lỗi 23 & Kịch bản LIFE-01: Trước khi đóng kỳ lưu trú (COMPLETED), kiểm tra các phiếu dịch vụ đang mở/chưa hoàn tất,
        // các khoản hoàn tiền giảm giá phòng chưa lập phương án xử lý, giữ nguyên các khoản REFUND_PENDING với owner & SLA,
        // và đóng (EXPIRE) các tín dụng dịch vụ/quota hết hạn lúc check-out.
        const openRefundLiabilities: Array<{
          accountId: string;
          bookingId: string;
          availableAmount: number;
          status: string;
          followUpOwnerId: string;
          slaDueAt: string;
        }> = [];
        const serviceReceivables: Array<{
          serviceRequestId: string;
          serviceName: string;
          netTotal: number;
          redeemedAmount: number;
          redeemedQuota: number;
          remainingPayable: number;
          status: string;
        }> = [];
        if (typeof manager.getRepository === 'function') {
          const srRepo = manager.getRepository(ServiceRequest);
          const ledgerRepo = manager.getRepository(BookingBenefitLedger);
          if (srRepo && typeof srRepo.find === 'function') {
            const activeServiceRequests = await srRepo.find({
              where: { bookingId: Number(booking.id) },
            });
            const unfinishedServices = (activeServiceRequests || []).filter((sr) =>
              [
                ServiceRequestStatus.PENDING,
                ServiceRequestStatus.ACCEPTED,
                ServiceRequestStatus.ASSIGNED,
                ServiceRequestStatus.IN_PROGRESS,
              ].includes(sr.status),
            );
            if (unfinishedServices.length > 0) {
              throw new ConflictException(
                `Chưa thể hoàn tất trả phòng: Còn ${unfinishedServices.length} phiếu dịch vụ đang xử lý (${unfinishedServices.map((s) => `#${s.id} ${s.serviceName}`).join(', ')}). Vui lòng hoàn tất hoặc hủy phiếu trước khi check-out.`,
              );
            }

            // Lỗi 23: Kiểm tra công nợ các phiếu dịch vụ đã hoàn tất (COMPLETED/CONFIRMED) so với sổ cấn trừ (BookingBenefitLedger)
            const completedServices = (activeServiceRequests || []).filter((sr) =>
              [ServiceRequestStatus.COMPLETED, ServiceRequestStatus.CONFIRMED].includes(sr.status),
            );
            if (completedServices.length > 0) {
              let bookingLedgers: BookingBenefitLedger[] = [];
              if (ledgerRepo && typeof ledgerRepo.find === 'function') {
                bookingLedgers =
                  (await ledgerRepo.find({
                    where: { bookingId: String(booking.id) },
                  })) || [];
              }
              const hasVerifiedPaymentReceipt = Boolean(
                dto.servicePaymentReceiptRef && dto.servicePaymentReceiptRef.trim().length >= 3,
              );
              for (const sr of completedServices) {
                const proj = computeServiceReceivableProjection(sr, bookingLedgers);
                const remainingPayable = proj.remainingPayable;
                // P0-06: Không coi acknowledgeServiceReceivables=true là đã tất toán (SETTLED_AT_CHECKOUT);
                // chỉ SETTLED_AT_CHECKOUT khi có chứng từ biên lai thu tiền hợp lệ (servicePaymentReceiptRef).
                // Nếu được duyệt trả phòng còn nợ bằng acknowledgeServiceReceivables thì giữ trạng thái OPEN_RECEIVABLE.
                serviceReceivables.push({
                  serviceRequestId: proj.serviceRequestId,
                  serviceName: proj.serviceName,
                  netTotal: proj.netTotal,
                  redeemedAmount: proj.redeemedAmount,
                  redeemedQuota: proj.redeemedQuota,
                  remainingPayable,
                  status:
                    remainingPayable === 0
                      ? 'SETTLED'
                      : hasVerifiedPaymentReceipt
                        ? 'SETTLED_AT_CHECKOUT'
                        : dto.acknowledgeServiceReceivables
                          ? 'OPEN_RECEIVABLE'
                          : 'UNPAID',
                });
              }

              const unpaidServices = serviceReceivables.filter((s) => s.remainingPayable > 0);
              const totalUnpaidServiceAmount = unpaidServices.reduce((s, i) => s + i.remainingPayable, 0);
              if (totalUnpaidServiceAmount > 0 && !hasVerifiedPaymentReceipt) {
                if (!dto.acknowledgeServiceReceivables) {
                  throw new ConflictException(
                    `Chưa thể hoàn tất trả phòng: Đơn còn ${unpaidServices.length} phiếu dịch vụ đã thực hiện nhưng chưa tất toán/cấn trừ hết (${totalUnpaidServiceAmount.toLocaleString('vi-VN')}đ). Vui lòng cấn trừ quyền lợi hoặc xác nhận thu tiền dịch vụ trước khi check-out.`,
                  );
                }
                // P0-06: Chỉ Quản lý khách sạn (MANAGER) hoặc ADMIN mới được duyệt cho trả phòng khi còn công nợ mở (OPEN_RECEIVABLE)
                if (actorRole !== 'ADMIN') {
                  const [mgrRow] =
                    typeof manager.query === 'function'
                      ? await manager.query(
                          `SELECT staff_role AS staffRole FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
                          [booking.hotelId, actorUserId],
                        )
                      : [];
                  if (!mgrRow || mgrRow.staffRole !== 'MANAGER') {
                    throw new ConflictException(
                      `UNPAID_SERVICE_RECEIVABLE: Còn nợ dịch vụ ${totalUnpaidServiceAmount.toLocaleString('vi-VN')}đ. Lễ tân bắt buộc nhập mã biên lai thu tiền (servicePaymentReceiptRef) hoặc cần Quản lý khách sạn phê duyệt công nợ mở.`,
                    );
                  }
                }
              }
            }
          }

          const accRepo = manager.getRepository(BookingBenefitAccount);
          if (accRepo && typeof accRepo.find === 'function') {
            const openBenefitAccounts = await accRepo.find({
              where: { bookingId: String(booking.id) },
            });
            for (const acc of openBenefitAccounts || []) {
              const availAmt = Math.max(0, Math.round(Number(acc.availableAmount || 0)));
              const availQuota = Math.max(0, Math.round(Number(acc.availableQuota || 0)));

              // Nếu còn khoản giảm giá phòng phải hoàn khách (ROOM_PRICE_ADJUSTMENT) đang mở (APPROVED) chưa chọn phương án hoàn -> chặn check-out
              if (
                acc.benefitKind === BenefitKind.ROOM_PRICE_ADJUSTMENT &&
                acc.status === BenefitAccountStatus.APPROVED &&
                availAmt > 0
              ) {
                throw new ConflictException(
                  `Chưa thể hoàn tất trả phòng: Đơn còn khoản giảm giá phòng phải hoàn ${availAmt.toLocaleString('vi-VN')}đ (trạng thái: APPROVED) chưa lập lệnh hoàn hoặc cấn trừ trong Sổ quyền lợi (Folio).`,
                );
              }

              // LIFE-01: Nếu khoản ROOM_PRICE_ADJUSTMENT đã lập lệnh hoàn và đang REFUND_PENDING -> cho phép check-out nhưng giữ nguyên open liability, gán owner & SLA 24h
              if (
                acc.benefitKind === BenefitKind.ROOM_PRICE_ADJUSTMENT &&
                acc.status === BenefitAccountStatus.REFUND_PENDING &&
                availAmt > 0
              ) {
                openRefundLiabilities.push({
                  accountId: String(acc.id),
                  bookingId: String(booking.id),
                  availableAmount: availAmt,
                  status: String(acc.status),
                  followUpOwnerId: String(booking.handledBy || actorUserId),
                  slaDueAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
                });
              }

              // Đóng các tài khoản SERVICE_BENEFIT_CREDIT / INCLUDED_QUOTA hết hạn tại thời điểm trả phòng
              if (acc.status === BenefitAccountStatus.APPROVED && acc.benefitKind !== BenefitKind.ROOM_PRICE_ADJUSTMENT) {
                acc.availableAmount = 0;
                acc.availableQuota = 0;
                acc.status = BenefitAccountStatus.EXPIRED;
                acc.version = Number(acc.version || 1) + 1;
                await accRepo.save(acc);

                if ((availAmt > 0 || availQuota > 0) && ledgerRepo && typeof ledgerRepo.save === 'function') {
                  const expKey = `expire:checkout:${booking.id}:acc:${acc.id}`;
                  const existingExp =
                    typeof ledgerRepo.findOne === 'function'
                      ? await ledgerRepo.findOne({ where: { idempotencyKey: expKey } })
                      : null;
                  if (!existingExp) {
                    await ledgerRepo.save(
                      ledgerRepo.create({
                        accountId: acc.id,
                        bookingId: String(booking.id),
                        hotelId: String(booking.hotelId),
                        campaignId: acc.campaignId,
                        entryType: BenefitLedgerEntryType.EXPIRE,
                        amountDelta: -availAmt,
                        balanceAfter: 0,
                        quotaDelta: -availQuota,
                        quotaAfter: 0,
                        performedBy: actorUserId,
                        idempotencyKey: expKey,
                        reason: 'Đóng quyền lợi dịch vụ/suất gói còn dư khi khách hoàn tất trả phòng (Check-out)',
                      }),
                    );
                  }
                }
              }
            }
          }
        }

        const now = new Date();
        const fromStatus = booking.status;

        booking.status = BookingStatus.COMPLETED;
        booking.actualCheckOutAt = now;
        booking.checkOutConfirmedBy = actorUserId;
        booking.presenceVersion = (booking.presenceVersion || 1) + 1;

        // IMP-12: Nếu bật cờ FF_FOLIO_LEDGER, kiểm tra sổ tiền Folio không còn công nợ trước khi checkout
        if (this.featureFlags && this.folioService) {
          const folioEnabled = await this.featureFlags.isEnabled(
            booking.hotelId,
            HotelFeatureFlagKey.FF_FOLIO_LEDGER,
            manager,
          );
          if (folioEnabled) {
            await this.folioService.assertCheckoutAllowed(booking.id, manager);
          }
        }

        const savedBooking = await bookingRepo.save(booking);

        // IMP-01 & IMP-02: Giải phóng stay-slots của phòng vật lý, chuyển sang DIRTY và phát sự kiện room.checkout.confirmed.v1
        if (this.roomAllocationService) {
          const checkedOutUnitIds = await this.roomAllocationService.completeCheckoutAndMarkDirty(
            booking.id,
            manager,
          );
          if (this.outboxService && checkedOutUnitIds.length > 0) {
            for (const unitId of checkedOutUnitIds) {
              await this.outboxService.addEvent(
                manager,
                BOOKING_DOMAIN_EVENTS.ROOM_CHECKOUT_CONFIRMED_V1,
                'BOOKING',
                String(booking.id),
                {
                  hotelId: booking.hotelId,
                  bookingId: booking.id,
                  unitId,
                  checkedOutAt: now.toISOString(),
                },
              );
            }
          }
        }

        const presenceEvent = presenceRepo.create({
          bookingId: booking.id,
          hotelId: booking.hotelId,
          fromStatus,
          toStatus: BookingStatus.COMPLETED,
          actorType: PresenceActorType.USER,
          actorId: actorUserId,
          eventType: PresenceEventType.DEPARTURE_CONFIRMED,
          reason: dto.note || 'Khách hoàn tất trả phòng tại quầy lễ tân',
          idempotencyKey: dto.commandId || null,
          occurredAt: now,
        });
        await presenceRepo.save(presenceEvent);

        const statusLog = logRepo.create({
          bookingId: booking.id,
          changedBy: actorUserId,
          actorType: 'USER',
          oldStatus: fromStatus,
          newStatus: BookingStatus.COMPLETED,
          note: dto.note || 'Xác nhận khách trả phòng thành công',
        });
        await logRepo.save(statusLog);

        // P1-12: Tự động liên kết / hoàn tất checklist GuestWorkTask CHECK_OUT gắn với sự kiện trả phòng để chấm KPI M3 đúng actor
        await this.ensurePresenceChecklistTask(
          manager,
          booking,
          WorkTaskType.CHECK_OUT,
          actorUserId,
          now,
          dto.note || 'Hoàn tất quy trình trả phòng tại quầy',
        );

        return {
          booking: savedBooking,
          presenceEvent,
          openRefundLiabilities,
          serviceReceivables,
          alreadyCompleted: false,
          message: 'Thủ tục trả phòng đã được xác nhận thành công!',
        };
      },
      {
        contextName: 'BookingPresenceService.confirmDeparture',
        maxRetries: 3,
        baseDelayMs: 50,
      },
    );

    // Gửi realtime thông báo sau commit (P1-25)
    if (this.realtimeGateway && result.booking && !result.alreadyCompleted) {
      try {
        this.realtimeGateway.emitBookingStatusChanged({
          id: result.booking.id,
          bookingCode: result.booking.bookingCode,
          hotelId: result.booking.hotelId,
          userId: result.booking.userId,
          oldStatus: BookingStatus.CHECKED_IN,
          newStatus: BookingStatus.COMPLETED,
          changedAt: result.booking.actualCheckOutAt?.toISOString() || new Date().toISOString(),
          note: dto.note || 'Khách đã hoàn tất thủ tục trả phòng',
        });
      } catch (err) {
        this.logger.warn(`Failed to emit departure realtime: ${(err as any)?.message}`);
      }
    }

    return result;
  }

  /**
   * Đánh dấu No-show cho booking nếu thỏa mãn thời gian ân hạn
   * Được gọi bởi PresenceScheduler hoặc quản lý kiểm tra
   *
   * Điều kiện:
   *  - Trạng thái là CONFIRMED hoặc PENDING (đã thanh toán)
   *  - actual_check_in_at IS NULL (khách chưa có mặt)
   *  - NOW >= check_in_at + grace_minutes (mặc định 360 phút = 6 giờ)
   *  - NOW < check_out_at (chưa hết kỳ lưu trú)
   *
   * Bất biến quan trọng (INV-03):
   *  - Giữ nguyên hold COMMITTED! KHÔNG nhả phòng cho người khác.
   */
  async markNoShowIfEligible(
    bookingId: string,
    customReason?: string,
    actor?: { id: string; role: string },
  ) {
    const result = await runWithDeadlockRetry(
      this.dataSource,
      async (manager: EntityManager) => {
        const bookingRepo = manager.getRepository(Booking);
        const presenceRepo = manager.getRepository(BookingPresenceEvent);
        const logRepo = manager.getRepository(BookingStatusLog);

        const booking = await bookingRepo
          .createQueryBuilder('booking')
          .setLock('pessimistic_write')
          .where('booking.id = :id', { id: bookingId })
          .getOne();

        if (!booking) return null;

        // Nếu khách đã nhận phòng hoặc đã là NO_SHOW thì bỏ qua (Idempotent)
        if (
          booking.status === BookingStatus.CHECKED_IN ||
          booking.status === BookingStatus.NO_SHOW ||
          booking.status === BookingStatus.CLOSED_NO_SHOW ||
          booking.status === BookingStatus.CANCELLED ||
          booking.actualCheckInAt !== null
        ) {
          return booking;
        }

        const now = new Date();
        const graceMinutes = booking.noShowGraceMinutes ?? 360;
        const checkInTime = new Date(booking.checkInAt).getTime();
        const noShowThreshold = checkInTime + graceMinutes * 60 * 1000;

        // Chưa tới hạn ân hạn No-show
        if (now.getTime() < noShowThreshold) {
          if (actor) {
            const remainingMinutes = Math.ceil((noShowThreshold - now.getTime()) / 60000);
            throw new ConflictException(
              `Chưa hết thời gian gia hạn chờ nhận phòng (còn ${remainingMinutes} phút). Chưa đủ điều kiện đánh dấu No-Show.`,
            );
          }
          return booking;
        }

        // Đã quá giờ check-out -> để closeExpiredNoShow xử lý
        if (now.getTime() >= new Date(booking.checkOutAt).getTime()) {
          if (actor) {
            throw new ConflictException(
              'Booking đã quá thời hạn trả phòng (checkOutAt). Vui lòng sử dụng trạng thái CLOSED_NO_SHOW.',
            );
          }
          return booking;
        }

        if (![BookingStatus.PENDING, BookingStatus.CONFIRMED].includes(booking.status as BookingStatus)) return null;
        await assertCommittedEntitlement(manager, booking);
        const fromStatus = booking.status;
        booking.status = BookingStatus.NO_SHOW;
        booking.noShowAt = now;
        booking.presenceVersion = (booking.presenceVersion || 1) + 1;

        const savedBooking = await bookingRepo.save(booking);

        const presenceEvent = presenceRepo.create({
          bookingId: booking.id,
          hotelId: booking.hotelId,
          fromStatus,
          toStatus: BookingStatus.NO_SHOW,
          actorType: actor ? PresenceActorType.USER : PresenceActorType.SYSTEM,
          actorId: actor ? actor.id : null,
          eventType: PresenceEventType.NO_SHOW_MARKED,
          reason:
            customReason ||
            (actor
              ? 'Quản lý kiểm tra và đánh dấu No-Show thủ công tại quầy'
              : `Quá hạn ân hạn ${graceMinutes} phút mà chưa có xác nhận nhận phòng thực tế tại quầy lễ tân. Suất phòng tiếp tục được bảo lưu đến khi trả phòng.`),
          occurredAt: now,
        });
        await presenceRepo.save(presenceEvent);

        const statusLog = logRepo.create({
          bookingId: booking.id,
          changedBy: actor ? actor.id : null,
          actorType: actor ? 'USER' : 'SYSTEM',
          oldStatus: fromStatus,
          newStatus: BookingStatus.NO_SHOW,
          note:
            customReason ||
            (actor
              ? 'Quản lý đánh dấu No-Show thủ công tại quầy'
              : `Hệ thống tự động chuyển sang NO_SHOW do quá thời gian ân hạn ${graceMinutes} phút`),
        });
        await logRepo.save(statusLog);

        this.logger.log(
          `[Presence] Booking #${booking.bookingCode} (ID: ${booking.id}) chuyển sang NO_SHOW (ân hạn ${graceMinutes}p, actor: ${actor ? actor.id : 'SYSTEM'})`,
        );

        return Object.assign(savedBooking, { oldStatus: fromStatus });
      },
      {
        contextName: 'BookingPresenceService.markNoShowIfEligible',
        maxRetries: 3,
        baseDelayMs: 50,
      },
    );

    if (result && this.realtimeGateway) {
      try {
        this.realtimeGateway.emitBookingStatusChanged({
          id: result.id,
          bookingCode: result.bookingCode,
          hotelId: result.hotelId,
          userId: result.userId,
          oldStatus: (result as any).oldStatus || BookingStatus.CONFIRMED,
          newStatus: BookingStatus.NO_SHOW,
          changedAt: result.noShowAt?.toISOString() || new Date().toISOString(),
          note: 'Đơn đặt phòng đã được ghi nhận No-Show (quá hạn ân hạn nhận phòng)',
        });
      } catch (err) {
        this.logger.warn(`Failed to emit socket for No-Show: ${(err as any)?.message}`);
      }
    }

    return result;
  }

  /**
   * Đóng kỳ No-show khi đã qua giờ trả phòng (check_out_at)
   * NO_SHOW -> CLOSED_NO_SHOW
   *
   * Bất biến quan trọng (INV-03, INV-04):
   *  - Kỳ đã qua, điều kiện overlap tự loại trừ, không gọi release hold.
   *  - Không tự động hoàn tiền (refund), không gọi CancellationsService.
   */
  async closeExpiredNoShow(bookingId: string, strict = false) {
    const result = await runWithDeadlockRetry(
      this.dataSource,
      async (manager: EntityManager) => {
        const bookingRepo = manager.getRepository(Booking);
        const presenceRepo = manager.getRepository(BookingPresenceEvent);
        const logRepo = manager.getRepository(BookingStatusLog);

        const booking = await bookingRepo
          .createQueryBuilder('booking')
          .setLock('pessimistic_write')
          .where('booking.id = :id', { id: bookingId })
          .getOne();

        if (!booking) return null;

        if (booking.status !== BookingStatus.NO_SHOW) {
          return booking;
        }

        const now = new Date();
        if (now.getTime() < new Date(booking.checkOutAt).getTime()) {
          if (strict) throw new ConflictException('Chưa kết thúc kỳ lưu trú. Không thể đóng No-Show trước hạn.');
          return booking;
        }

        await assertCommittedEntitlement(manager, booking);
        const fromStatus = booking.status;
        booking.status = BookingStatus.CLOSED_NO_SHOW;
        booking.noShowClosedAt = now;
        booking.presenceVersion = (booking.presenceVersion || 1) + 1;

        const savedBooking = await bookingRepo.save(booking);

        const presenceEvent = presenceRepo.create({
          bookingId: booking.id,
          hotelId: booking.hotelId,
          fromStatus,
          toStatus: BookingStatus.CLOSED_NO_SHOW,
          actorType: PresenceActorType.SYSTEM,
          actorId: null,
          eventType: PresenceEventType.NO_SHOW_CLOSED,
          reason: `Đã kết thúc thời hạn lưu trú (${new Date(booking.checkOutAt).toLocaleString('vi-VN')}) mà khách không tới nhận phòng. Đóng kỳ đặt No-Show.`,
          occurredAt: now,
        });
        await presenceRepo.save(presenceEvent);

        const statusLog = logRepo.create({
          bookingId: booking.id,
          changedBy: null,
          actorType: 'SYSTEM',
          oldStatus: fromStatus,
          newStatus: BookingStatus.CLOSED_NO_SHOW,
          note: 'Hết thời gian lưu trú mà khách không nhận phòng -> CLOSED_NO_SHOW',
        });
        await logRepo.save(statusLog);

        this.logger.log(
          `[Presence] Booking #${booking.bookingCode} đóng No-Show (CLOSED_NO_SHOW)`,
        );

        return savedBooking;
      },
      {
        contextName: 'BookingPresenceService.closeExpiredNoShow',
        maxRetries: 3,
        baseDelayMs: 50,
      },
    );

    if (result && this.realtimeGateway) {
      try {
        this.realtimeGateway.emitBookingStatusChanged({
          id: result.id,
          bookingCode: result.bookingCode,
          hotelId: result.hotelId,
          userId: result.userId,
          oldStatus: BookingStatus.NO_SHOW,
          newStatus: BookingStatus.CLOSED_NO_SHOW,
          changedAt: result.noShowClosedAt?.toISOString() || new Date().toISOString(),
          note: 'Đơn đặt phòng đã đóng kỳ lưu trú No-Show',
        });
      } catch (err) {
        this.logger.warn(`Failed to emit socket for Closed No-Show: ${(err as any)?.message}`);
      }
    }

    return result;
  }

  /**
   * D2-04: Đối soát đóng các đơn PENDING/CONFIRMED đã quá hạn trả phòng (checkOutAt <= now)
   * mà chưa từng nhận phòng thực tế (actualCheckInAt IS NULL) do scheduler từng bị gián đoạn.
   * Chuyển trực tiếp sang CLOSED_NO_SHOW kèm sự kiện kiểm toán rõ ràng, không tạo sự kiện check-in giả,
   * không tự hoàn tiền hay giải phóng hold.
   */
  async reconcileOverdueNeverCheckedIn(bookingId: string) {
    const result = await runWithDeadlockRetry(
      this.dataSource,
      async (manager: EntityManager) => {
        const bookingRepo = manager.getRepository(Booking);
        const presenceRepo = manager.getRepository(BookingPresenceEvent);
        const logRepo = manager.getRepository(BookingStatusLog);

        const booking = await bookingRepo
          .createQueryBuilder('booking')
          .setLock('pessimistic_write')
          .where('booking.id = :id', { id: bookingId })
          .getOne();

        if (!booking) return null;

        if (
          booking.actualCheckInAt !== null ||
          (booking.status !== BookingStatus.PENDING &&
            booking.status !== BookingStatus.CONFIRMED)
        ) {
          return booking;
        }

        const now = new Date();
        if (now.getTime() < new Date(booking.checkOutAt).getTime()) {
          return booking;
        }

        await assertCommittedEntitlement(manager, booking);
        const fromStatus = booking.status;
        booking.status = BookingStatus.CLOSED_NO_SHOW;
        // Do not invent a past noShowAt: this transition is observed now.
        booking.noShowClosedAt = now;
        booking.presenceVersion = (booking.presenceVersion || 1) + 1;

        const savedBooking = await bookingRepo.save(booking);

        const presenceEvent = presenceRepo.create({
          bookingId: booking.id,
          hotelId: booking.hotelId,
          fromStatus,
          toStatus: BookingStatus.CLOSED_NO_SHOW,
          actorType: PresenceActorType.SYSTEM,
          actorId: null,
          eventType: PresenceEventType.NO_SHOW_CLOSED,
          reason: `Đối soát tự động sau khi kết thúc kỳ lưu trú (${new Date(booking.checkOutAt).toLocaleString('vi-VN')}): Khách chưa từng nhận phòng thực tế -> CLOSED_NO_SHOW.`,
          occurredAt: now,
        });
        await presenceRepo.save(presenceEvent);

        const statusLog = logRepo.create({
          bookingId: booking.id,
          changedBy: null,
          actorType: 'SYSTEM',
          oldStatus: fromStatus,
          newStatus: BookingStatus.CLOSED_NO_SHOW,
          note: 'Đối soát tự động đơn quá hạn trả phòng chưa từng nhận phòng -> CLOSED_NO_SHOW',
        });
        await logRepo.save(statusLog);

        this.logger.log(
          `[Presence] Reconciled overdue never-checked-in booking #${booking.bookingCode} (${fromStatus} -> CLOSED_NO_SHOW)`,
        );

        return Object.assign(savedBooking, { oldStatus: fromStatus });
      },
      {
        contextName: 'BookingPresenceService.reconcileOverdueNeverCheckedIn',
        maxRetries: 3,
        baseDelayMs: 50,
      },
    );

    if (result && (result as any).oldStatus && this.realtimeGateway) {
      try {
        this.realtimeGateway.emitBookingStatusChanged({
          id: result.id,
          bookingCode: result.bookingCode,
          hotelId: result.hotelId,
          userId: result.userId,
          oldStatus: (result as any).oldStatus,
          newStatus: BookingStatus.CLOSED_NO_SHOW,
          changedAt: result.noShowClosedAt?.toISOString() || new Date().toISOString(),
          note: 'Đối soát tự động: Kỳ lưu trú đã kết thúc mà khách chưa từng nhận phòng (CLOSED_NO_SHOW)',
        });
      } catch (err) {
        this.logger.warn(`Failed to emit socket for Reconciled No-Show: ${(err as any)?.message}`);
      }
    }

    return result;
  }

  /**
   * Khách hàng gửi thông báo "Tôi dự kiến đến muộn"
   * Chỉ ghi nhận ý định và thời gian dự kiến (ARRIVAL_INTENT), KHÔNG phải là nhận phòng tự động!
   */
  async recordLateArrivalNotice(
    bookingId: string,
    customerUserId: string,
    dto: LateArrivalNoticeDto,
  ) {
    return await runWithDeadlockRetry(
      this.dataSource,
      async (manager: EntityManager) => {
        const bookingRepo = manager.getRepository(Booking);
        const eventRepo = manager.getRepository(BookingPresenceEvent);

        const booking = await bookingRepo.findOne({
          where: { id: bookingId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!booking) {
          throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
        }

        if (String(booking.userId) !== String(customerUserId)) {
          throw new ForbiddenException('Bạn không phải là chủ sở hữu của đơn đặt phòng này.');
        }

        if (
          booking.status === BookingStatus.CANCELLED ||
          booking.status === BookingStatus.REJECTED ||
          booking.status === BookingStatus.COMPLETED ||
          booking.status === BookingStatus.CLOSED_NO_SHOW ||
          booking.status === BookingStatus.PAYMENT_EXPIRED ||
          booking.actualCheckInAt !== null
        ) {
          throw new ConflictException(
            `Không thể gửi thông báo đến muộn cho đơn đặt phòng ở trạng thái "${booking.status}" hoặc đã nhận phòng.`,
          );
        }

        const expectedDate = new Date(dto.expectedArrivalAt);
        const checkInDate = new Date(booking.checkInAt);
        const checkOutDate = new Date(booking.checkOutAt);

        if (expectedDate < checkInDate || expectedDate >= checkOutDate) {
          throw new BadRequestException(
            `Thời gian dự kiến đến (${expectedDate.toLocaleString('vi-VN')}) phải nằm trong khoảng thời gian lưu trú ` +
              `từ ${checkInDate.toLocaleString('vi-VN')} đến ${checkOutDate.toLocaleString('vi-VN')}.`,
          );
        }

        const note = dto.note?.trim() || 'Khách báo dự kiến đến muộn';
        booking.lateArrivalExpectedAt = expectedDate;
        booking.lateArrivalNote = note;
        await bookingRepo.save(booking);

        const now = new Date();
        const event = eventRepo.create({
          bookingId: booking.id,
          hotelId: booking.hotelId,
          fromStatus: booking.status,
          toStatus: booking.status,
          actorType: PresenceActorType.USER,
          actorId: customerUserId,
          eventType: PresenceEventType.LATE_ARRIVAL_NOTICED,
          reason: `Khách báo dự kiến đến lúc ${expectedDate.toLocaleString('vi-VN')}. Lý do: ${note}`,
          occurredAt: now,
        });
        await eventRepo.save(event);

        // P1-30: Giao/cập nhật nhiệm vụ theo dõi khách đến muộn cho lễ tân đang trực hoặc nhận ủy quyền B
        await this.ensureLateArrivalFollowUpTask(manager, booking, expectedDate, note, now);

        return {
          success: true,
          data: {
            lateArrivalExpectedAt: booking.lateArrivalExpectedAt,
            lateArrivalNote: booking.lateArrivalNote,
          },
          message: 'Đã gửi thông báo dự kiến đến muộn tới khách sạn thành công!',
        };
      },
      {
        contextName: 'BookingPresenceService.recordLateArrivalNotice',
        maxRetries: 3,
        baseDelayMs: 50,
      },
    );
  }

  /**
   * Lấy dòng thời gian hiện diện (Presence Timeline) của đơn đặt phòng
   */
  async getPresenceTimeline(bookingId: string, actor?: User) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
    }

    if (actor) {
      if (actor.role === 'CUSTOMER') {
        if (String(booking.userId) !== String(actor.id)) {
          throw new ForbiddenException('Bạn không có quyền xem thông tin dòng thời gian của đơn này.');
        }
      } else if (actor.role === 'EMPLOYEE') {
        const hasAccess = await this.validateStaffHotelAccess(String(actor.id), String(booking.hotelId));
        if (!hasAccess) {
          throw new ForbiddenException('Bạn không có quyền xem thông tin đơn tại khách sạn này.');
        }
      }
    }

    const events = await this.presenceEventRepo.find({
      where: { bookingId },
      order: { occurredAt: 'ASC' },
    });

    return {
      success: true,
      data: events,
    };
  }

  private async ensurePresenceChecklistTask(
    manager: EntityManager,
    booking: Booking,
    phase: WorkTaskType.CHECK_IN | WorkTaskType.CHECK_OUT,
    actorUserId: string,
    occurredAt: Date,
    note: string,
  ): Promise<void> {
    if (typeof manager?.getRepository !== 'function') return;
    try {
      const taskRepo = manager.getRepository(GuestWorkTask);
      const eventRepo = manager.getRepository(GuestWorkEvent);
      if (!taskRepo || typeof taskRepo.save !== 'function') return;

      const sourceKey = `${booking.id}:${phase}`;
      let task =
        typeof taskRepo.findOne === 'function'
          ? await taskRepo.findOne({
              where: { sourceTable: 'booking_presence', sourceId: sourceKey },
            })
          : null;

      if (!task && typeof taskRepo.create === 'function') {
        task = await taskRepo.save(
          taskRepo.create({
            hotelId: String(booking.hotelId),
            bookingId: String(booking.id),
            type: phase,
            sourceTable: 'booking_presence',
            sourceId: sourceKey,
            assignedStaffId: String(booking.handledBy || actorUserId),
            activeExecutorId: String(actorUserId),
            ownerAtCreate: booking.handledBy ? String(booking.handledBy) : null,
            status: WorkTaskStatus.COMPLETED,
            priority: WorkTaskPriority.HIGH,
            title:
              phase === WorkTaskType.CHECK_IN
                ? `Thủ tục nhận phòng (#${booking.bookingCode || booking.id})`
                : `Thủ tục trả phòng (#${booking.bookingCode || booking.id})`,
            description: note,
            startedAt: occurredAt,
            completedAt: occurredAt,
            version: 1,
          }),
        );
      } else if (task) {
        task.status = WorkTaskStatus.COMPLETED;
        task.activeExecutorId = String(actorUserId);
        task.completedAt = task.completedAt || occurredAt;
        task.version = Number(task.version || 1) + 1;
        task = await taskRepo.save(task);
      }

      if (task?.id && eventRepo && typeof eventRepo.save === 'function' && typeof eventRepo.create === 'function') {
        const idemKey = `presence_checklist:${booking.id}:${phase}`;
        const existingEvt =
          typeof eventRepo.findOne === 'function'
            ? await eventRepo.findOne({ where: { idempotencyKey: idemKey } })
            : null;
        if (!existingEvt) {
          await eventRepo.save(
            eventRepo.create({
              taskId: String(task.id),
              bookingId: String(booking.id),
              hotelId: String(booking.hotelId),
              actorType: 'USER',
              actorStaffId: String(actorUserId),
              eventType: WorkEventType.TASK_COMPLETED,
              fromStatus: WorkTaskStatus.IN_PROGRESS,
              toStatus: WorkTaskStatus.COMPLETED,
              occurredAt,
              evidenceType: WorkEvidenceType.SYSTEM_LOG,
              evidenceRef: `${phase}:${booking.id}`,
              idempotencyKey: idemKey,
            }),
          );
        }
      }
    } catch {}
  }

  private async ensureLateArrivalFollowUpTask(
    manager: EntityManager,
    booking: Booking,
    expectedArrivalAt: Date,
    note: string,
    occurredAt: Date,
  ): Promise<void> {
    if (typeof manager?.getRepository !== 'function') return;
    try {
      const taskRepo = manager.getRepository(GuestWorkTask);
      const eventRepo = manager.getRepository(GuestWorkEvent);
      if (!taskRepo || typeof taskRepo.save !== 'function' || typeof taskRepo.create !== 'function') return;

      let effectiveAssignee = booking.handledBy ? String(booking.handledBy) : null;
      let activeExecutorId: string | null = null;
      let coverageGrantId: string | null = null;
      if (typeof manager.query === 'function') {
        const activeGrants = await manager.query(
          `SELECT id, delegate_staff_id AS delegateStaffId
           FROM booking_coverage_grants
           WHERE booking_id = ? AND status = 'ACTIVE' AND start_at <= ? AND end_at > ?
           ORDER BY id ASC LIMIT 1`,
          [booking.id, occurredAt, occurredAt],
        );
        if (Array.isArray(activeGrants) && activeGrants.length > 0) {
          effectiveAssignee = String(activeGrants[0].delegateStaffId);
          activeExecutorId = String(activeGrants[0].delegateStaffId);
          coverageGrantId = String(activeGrants[0].id);
        }
      }

      const sourceKey = `late_arrival:${booking.id}`;
      const existing =
        typeof taskRepo.findOne === 'function'
          ? await taskRepo.findOne({
              where: { sourceTable: 'late_arrival_notice', sourceId: sourceKey },
            })
          : null;

      const title = `Theo dõi khách báo đến muộn (#${booking.bookingCode || booking.id})`;
      const desc = `Khách báo dự kiến đến lúc ${expectedArrivalAt.toLocaleString('vi-VN')}. Ghi chú: ${note}`;

      if (existing) {
        existing.assignedStaffId = effectiveAssignee;
        existing.activeExecutorId = activeExecutorId;
        existing.coverageGrantId = coverageGrantId;
        existing.title = title;
        existing.description = desc;
        existing.resolutionSlaDueAt = expectedArrivalAt;
        if ([WorkTaskStatus.CANCELLED, WorkTaskStatus.COMPLETED].includes(existing.status)) {
          existing.status = effectiveAssignee ? WorkTaskStatus.ASSIGNED : WorkTaskStatus.CREATED;
        }
        existing.version = Number(existing.version || 1) + 1;
        await taskRepo.save(existing);
      } else {
        const created = await taskRepo.save(
          taskRepo.create({
            hotelId: String(booking.hotelId),
            bookingId: String(booking.id),
            type: WorkTaskType.PRE_ARRIVAL_CONTACT,
            sourceTable: 'late_arrival_notice',
            sourceId: sourceKey,
            assignedStaffId: effectiveAssignee,
            activeExecutorId,
            coverageGrantId,
            ownerAtCreate: booking.handledBy ? String(booking.handledBy) : null,
            status: effectiveAssignee ? WorkTaskStatus.ASSIGNED : WorkTaskStatus.CREATED,
            priority: WorkTaskPriority.HIGH,
            title,
            description: desc,
            responseSlaDueAt: new Date(occurredAt.getTime() + 30 * 60000),
            resolutionSlaDueAt: expectedArrivalAt,
            version: 1,
          }),
        );
        if (created?.id && eventRepo && typeof eventRepo.save === 'function' && typeof eventRepo.create === 'function') {
          await eventRepo.save(
            eventRepo.create({
              taskId: String(created.id),
              bookingId: String(booking.id),
              hotelId: String(booking.hotelId),
              actorType: 'USER',
              actorStaffId: effectiveAssignee,
              eventType: WorkEventType.TASK_CREATED,
              fromStatus: null,
              toStatus: created.status,
              occurredAt,
              evidenceType: WorkEvidenceType.SYSTEM_LOG,
              evidenceRef: sourceKey,
            }),
          );
        }
      }
    } catch {}
  }

  /**
   * Thống kê danh sách đến trong ngày, no-show, đã nhận phòng tại khách sạn
   */
  async getArrivalsSummary(hotelId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const qb = this.bookingRepo
      .createQueryBuilder('b')
      .where('b.hotelId = :hotelId', { hotelId });

    // Đơn nhận phòng hôm nay
    const todayArrivals = await qb
      .clone()
      .andWhere('b.checkInAt >= :todayStart AND b.checkInAt <= :todayEnd', {
        todayStart,
        todayEnd,
      })
      .orderBy('b.checkInAt', 'ASC')
      .getMany();

    // Đơn No-show đang bảo lưu phòng
    const activeNoShows = await qb
      .clone()
      .andWhere('b.status = :noShow', { noShow: BookingStatus.NO_SHOW })
      .andWhere('b.checkOutAt > :now', { now: new Date() })
      .orderBy('b.checkOutAt', 'ASC')
      .getMany();

    // Đơn đang lưu trú (In-house)
    const inHouseCount = await qb
      .clone()
      .andWhere('b.status = :checkedIn', { checkedIn: BookingStatus.CHECKED_IN })
      .getCount();

    // A.3 / D2-03: Thống kê tách biệt 3 con số phòng tại khách sạn:
    // 1. inHouseRooms (Số phòng đang có khách thực tế CHECKED_IN)
    // 2. reservedOrCommittedRooms (Số suất phòng đã bán/giữ trong ngày, gồm cả NO_SHOW đang bảo lưu)
    // 3. sellableRooms (Số phòng còn được phép bán thêm = totalRooms - reservedOrCommittedRooms)
    let totalRooms = 0;
    let inHouseRooms = inHouseCount;
    let reservedOrCommittedRooms = inHouseCount + activeNoShows.length;
    let noShowCommittedRooms = activeNoShows.length;

    try {
      const now = new Date();
      const roomRows = await this.dataSource.query(
        `SELECT COALESCE(SUM(total_rooms), 0) AS totalRooms FROM rooms WHERE hotel_id = ?`,
        [hotelId],
      );
      totalRooms = Number(roomRows?.[0]?.totalRooms ?? 0);

      const occRows = await this.dataSource.query(
        `
        SELECT
          COALESCE(SUM(CASE WHEN b.status = 'CHECKED_IN' THEN br.quantity ELSE 0 END), 0) AS inHouseRooms,
          COALESCE(SUM(CASE WHEN b.status = 'NO_SHOW' THEN br.quantity ELSE 0 END), 0) AS noShowCommittedRooms,
          COALESCE(SUM(CASE WHEN b.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'NO_SHOW') THEN br.quantity ELSE 0 END), 0) AS reservedRooms
        FROM bookings b
        INNER JOIN booking_rooms br ON br.booking_id = b.id
        WHERE b.hotel_id = ?
          AND b.check_in_at <= ?
          AND b.check_out_at > ?
        `,
        [hotelId, todayEnd, now],
      );
      if (occRows && occRows.length > 0) {
        inHouseRooms = Number(occRows[0].inHouseRooms ?? inHouseCount);
        noShowCommittedRooms = Number(occRows[0].noShowCommittedRooms ?? activeNoShows.length);
        reservedOrCommittedRooms = Number(occRows[0].reservedRooms ?? inHouseRooms + noShowCommittedRooms);
      }
    } catch {
      // Fallback sang counts cơ bản nếu môi trường test không hỗ trợ raw query
    }

    const sellableRooms = Math.max(0, totalRooms - reservedOrCommittedRooms);

    return {
      success: true,
      data: {
        todayArrivals,
        activeNoShows,
        counts: {
          todayArrivalsCount: todayArrivals.length,
          activeNoShowsCount: activeNoShows.length,
          inHouseCount,
          totalRooms,
          inHouseRooms,
          noShowCommittedRooms,
          reservedOrCommittedRooms,
          sellableRooms,
        },
      },
    };
  }
}
