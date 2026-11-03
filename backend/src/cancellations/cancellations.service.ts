import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  BookingCancellationRequest,
  CancellationRequestStatus,
  CancellationRequesterType,
} from './entities/booking-cancellation-request.entity';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { BookingStatusLog } from '../bookings/entities/booking-status-log.entity';
import {
  PaymentTransaction,
  PaymentTransactionStatus,
} from '../payments/entities/payment-transaction.entity';
import { User } from '../users/entities/user.entity';
import { InventoryService } from '../inventory/inventory.service';
import { OutboxService } from '../outbox/outbox.service';
import { BookingAccessService } from '../bookings/services/booking-access.service';
import { CreateCancellationRequestDto } from './dto/create-cancellation-request.dto';
import { ReviewCancellationRequestDto } from './dto/review-cancellation-request.dto';
import { runWithDeadlockRetry } from '../common/database/transaction-retry.helper';
import {
  BenefitAccountStatus,
  BookingBenefitAccount,
} from '../promotions/entities/booking-benefit-account.entity';
import {
  BenefitLedgerEntryType,
  BookingBenefitLedger,
} from '../promotions/entities/booking-benefit-ledger.entity';
import { PromotionCampaign } from '../promotions/entities/promotion-campaign.entity';

@Injectable()
export class CancellationsService {
  private readonly logger = new Logger(CancellationsService.name);

  constructor(
    @InjectRepository(BookingCancellationRequest)
    private readonly requestRepo: Repository<BookingCancellationRequest>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(PaymentTransaction)
    private readonly paymentRepo: Repository<PaymentTransaction>,
    private readonly dataSource: DataSource,
    private readonly inventoryService: InventoryService,
    private readonly outboxService: OutboxService,
    private readonly bookingAccessService: BookingAccessService,
  ) {}

  /**
   * Tạo yêu cầu hủy đơn đặt phòng (Khách hàng hoặc Nhân viên)
   * Section 6: Luật thời gian hủy — Chỉ được tạo khi NOW < checkInAt
   */
  async createRequest(dto: CreateCancellationRequestDto, user: User) {
    const booking = await this.bookingRepo.findOne({
      where: { id: dto.bookingId },
    });

    if (!booking) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng.');
    }

    // Kiểm tra quyền xem / yêu cầu trên booking
    await this.bookingAccessService.assertCanView(booking, user);

    // Chỉ áp dụng cho đơn đã thanh toán (PENDING hoặc CONFIRMED)
    if (
      booking.status !== BookingStatus.PENDING &&
      booking.status !== BookingStatus.CONFIRMED
    ) {
      throw new BadRequestException(
        `Không thể gửi yêu cầu hủy cho đơn ở trạng thái "${booking.status}". Chỉ hỗ trợ đơn đã thanh toán thành công (PENDING / CONFIRMED).`,
      );
    }

    // Section 6: LUẬT THỜI GIAN HỦY
    // Chỉ được tạo request khi NOW < booking.checkInAt
    const now = new Date();
    const checkInDate = new Date(booking.checkInAt);
    if (now >= checkInDate) {
      throw new ConflictException(
        'Đơn đã đến hoặc qua giờ nhận phòng nên không thể yêu cầu hủy/hoàn.',
      );
    }

    // Kiểm tra xem đã có yêu cầu PENDING nào chưa
    const existingPending = await this.requestRepo.findOne({
      where: {
        bookingId: booking.id,
        status: CancellationRequestStatus.PENDING,
      },
    });

    if (existingPending) {
      throw new ConflictException(
        'Đã có yêu cầu hủy đang chờ xử lý cho đơn đặt phòng này.',
      );
    }

    const requesterType =
      user.role === 'ADMIN'
        ? CancellationRequesterType.ADMIN
        : user.role === 'EMPLOYEE'
          ? CancellationRequesterType.STAFF
          : CancellationRequesterType.CUSTOMER;

    const request = this.requestRepo.create({
      bookingId: booking.id,
      requestedBy: user.id,
      requesterType,
      reason: dto.reason,
      status: CancellationRequestStatus.PENDING,
      refundAmount: booking.estimatedTotal,
    });

    const savedRequest = await this.requestRepo.save(request);

    this.logger.log(
      `[Cancellation] User ${user.id} đã tạo yêu cầu hủy #${savedRequest.id} cho booking ${booking.id}`,
    );

    return {
      message: 'Gửi yêu cầu hủy đơn thành công. Đang chờ quản lý xét duyệt.',
      data: savedRequest,
    };
  }

  /**
   * Xét duyệt yêu cầu hủy đơn đặt phòng (Manager / Admin)
   * Section 6: Flow DB transaction APPROVE
   * booking -> CANCELLED
   * hold -> RELEASED
   * payment -> REFUND_PENDING
   * request -> APPROVED
   * outbox -> refund.process
   */
  async reviewRequest(
    requestId: string,
    dto: ReviewCancellationRequestDto,
    user: User,
  ) {
    const request = await this.requestRepo.findOne({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Không tìm thấy yêu cầu hủy.');
    }

    if (request.status !== CancellationRequestStatus.PENDING) {
      throw new BadRequestException(
        `Yêu cầu hủy này đã được xử lý trước đó với kết quả "${request.status}".`,
      );
    }

    const booking = await this.bookingRepo.findOne({
      where: { id: request.bookingId },
    });

    if (!booking) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng liên quan.');
    }

    // Quản lý khách sạn (MANAGER) hoặc Admin mới được duyệt yêu cầu hủy/hoàn
    await this.bookingAccessService.assertCanApproveCancellation(booking, user);

    if (dto.action === 'REJECT') {
      request.status = CancellationRequestStatus.REJECTED;
      request.reviewedBy = user.id;
      request.reviewedAt = new Date();
      request.reviewNote = dto.reviewNote || null;
      await this.requestRepo.save(request);

      return {
        message: 'Đã từ chối yêu cầu hủy đơn đặt phòng.',
        data: request,
      };
    }

    // ==========================================
    // ACTION === 'APPROVE'
    // ==========================================
    return await runWithDeadlockRetry(
      this.dataSource,
      async (manager: EntityManager) => {
        const bookingRepo = manager.getRepository(Booking);
        const paymentRepo = manager.getRepository(PaymentTransaction);
        const reqRepo = manager.getRepository(BookingCancellationRequest);

        // 1. Cập nhật booking -> CANCELLED
        const oldStatus = booking.status;
        booking.status = BookingStatus.CANCELLED;
        booking.cancelledAt = new Date();
        await bookingRepo.save(booking);

        // 2. Giải phóng COMMITTED hold -> RELEASED
        await this.inventoryService.releaseCommittedHold(
          booking.id,
          `Cancellation approved: ${dto.reviewNote || 'Approved by Manager'}`,
          manager,
        );

        // 3. Tìm giao dịch thanh toán thành công mới nhất của booking
        const payment = await paymentRepo.findOne({
          where: {
            bookingId: booking.id,
            status: PaymentTransactionStatus.PAID,
          },
          order: { attemptNo: 'DESC' },
        });

        // Lỗi 18 (Section 1.3): Khi hủy booking, khóa các tài khoản quyền lợi mở, ghi bút toán thu hồi (BENEFIT_REVOCATION)
        // vào BookingBenefitLedger để bảo toàn đối soát (ledgerSum == availableAmount == 0) và giải phóng ngân sách campaign.
        const paidAmt = payment ? Number(payment.amount || 0) : Number(booking.estimatedTotal || 0);
        const priorRefundedAmt = payment ? Number(payment.refundAmount || 0) : 0;
        const netRefundableAmt = Math.max(0, paidAmt - priorRefundedAmt);

        if (typeof manager.getRepository === 'function') {
          const accRepo = manager.getRepository(BookingBenefitAccount);
          const ledgerRepo = manager.getRepository(BookingBenefitLedger);
          const campRepo = manager.getRepository(PromotionCampaign);

          if (accRepo && typeof accRepo.find === 'function') {
            const openAccounts = await accRepo.find({
              where: { bookingId: String(booking.id) },
              lock: { mode: 'pessimistic_write' },
            });
            for (const acc of openAccounts) {
              // Section IV: Chỉ thu hồi (BENEFIT_REVOCATION) các quyền lợi chưa phát sinh quyền hưởng (APPROVED / PENDING_REVIEW);
              // tuyệt đối KHÔNG xóa nghĩa vụ của tài khoản đang ở trạng thái REFUND_PENDING!
              if (
                ![
                  BenefitAccountStatus.APPROVED,
                  BenefitAccountStatus.PENDING_REVIEW,
                ].includes(acc.status)
              ) {
                continue;
              }
              const revokeAmt = Math.max(0, Math.round(Number(acc.availableAmount || 0)));
              const revokeQuota = Math.max(0, Math.round(Number(acc.availableQuota || 0)));
              const revKey = `revoke:cancel_booking:${booking.id}:acc:${acc.id}`;

              acc.reversedAmount = Number(acc.reversedAmount || 0) + revokeAmt;
              acc.availableAmount = 0;
              acc.availableQuota = 0;
              acc.status = BenefitAccountStatus.CANCELLED;
              acc.version = Number(acc.version || 1) + 1;
              await accRepo.save(acc);

              if ((revokeAmt > 0 || revokeQuota > 0) && ledgerRepo && typeof ledgerRepo.save === 'function') {
                const existingRev =
                  typeof ledgerRepo.findOne === 'function'
                    ? await ledgerRepo.findOne({ where: { idempotencyKey: revKey } })
                    : null;
                if (!existingRev) {
                  await ledgerRepo.save(
                    ledgerRepo.create({
                      accountId: acc.id,
                      bookingId: String(booking.id),
                      hotelId: String(acc.hotelId || booking.hotelId),
                      campaignId: acc.campaignId,
                      entryType: BenefitLedgerEntryType.BENEFIT_REVOCATION,
                      amountDelta: -revokeAmt,
                      balanceAfter: 0,
                      quotaDelta: -revokeQuota,
                      quotaAfter: 0,
                      performedBy: String(user.id),
                      idempotencyKey: revKey,
                      reason: `Thu hồi quyền lợi chưa sử dụng do hủy đơn đặt phòng #${booking.bookingCode || booking.id}`,
                    }),
                  );
                }
              }

              if (acc.campaignId && revokeAmt > 0 && campRepo && typeof campRepo.findOne === 'function') {
                const lockedCamp = await campRepo.findOne({
                  where: { id: acc.campaignId },
                  lock: { mode: 'pessimistic_write' },
                });
                if (lockedCamp) {
                  if (Number(lockedCamp.budgetReserved || 0) >= revokeAmt) {
                    lockedCamp.budgetReserved = Math.max(0, Number(lockedCamp.budgetReserved || 0) - revokeAmt);
                  } else {
                    lockedCamp.budgetReversed = Number(lockedCamp.budgetReversed || 0) + revokeAmt;
                  }
                  await campRepo.save(lockedCamp);
                }
              }
            }
          }
        }

        if (payment && netRefundableAmt > 0) {
          payment.status = PaymentTransactionStatus.REFUND_PENDING;
          await paymentRepo.save(payment);
        }

        // 4. Cập nhật CancellationRequest -> APPROVED
        request.status = CancellationRequestStatus.APPROVED;
        request.reviewedBy = user.id;
        request.reviewedAt = new Date();
        request.reviewNote = dto.reviewNote || null;
        request.refundAmount = netRefundableAmt.toFixed(2);
        await reqRepo.save(request);

        // 5. Ghi nhật ký trạng thái
        await manager.getRepository(BookingStatusLog).save(
          manager.getRepository(BookingStatusLog).create({
            bookingId: booking.id,
            oldStatus,
            newStatus: BookingStatus.CANCELLED,
            changedBy: user.id,
            note: `Hủy đơn và chấp thuận hoàn tiền (${netRefundableAmt.toLocaleString('vi-VN')}đ): ${dto.reviewNote || ''}`,
          }),
        );

        // 6. Ghi Outbox event command "refund.process" với số tiền hoàn ròng
        if (payment && netRefundableAmt > 0) {
          await this.outboxService.addEvent(
            manager,
            'refund.process',
            'BookingCancellationRequest',
            request.id,
            {
              bookingId: booking.id,
              paymentId: payment.id,
              txnRef: payment.txnRef,
              amount: netRefundableAmt.toFixed(2),
              transactionNo: payment.vnpTransactionNo,
              transactionDate: payment.payDate || payment.paidAt || new Date(),
              requestId: request.id,
              reason: `Customer cancellation approved: ${dto.reviewNote || ''}`,
            },
          );
        }

        return {
          message: 'Đã chấp thuận yêu cầu hủy. Lệnh hoàn tiền tự động đã được đưa vào hàng đợi xử lý.',
          data: {
            request,
            booking,
            payment,
          },
        };
      },
      { contextName: 'CancellationsService.reviewRequest' },
    );
  }

  /**
   * Lấy danh sách yêu cầu hủy theo phân quyền
   */
  async findAll(user: User) {
    if (user.role === 'ADMIN') {
      return await this.requestRepo.find({
        order: { createdAt: 'DESC' },
      });
    }

    if (user.role === 'CUSTOMER') {
      return await this.requestRepo.find({
        where: { requestedBy: user.id },
        order: { createdAt: 'DESC' },
      });
    }

    if (user.role === 'EMPLOYEE') {
      return await this.dataSource.query(
        `
        SELECT
          r.*,
          b.booking_code AS bookingCode,
          b.hotel_id AS hotelId,
          h.name AS hotelName
        FROM booking_cancellation_requests r
        INNER JOIN bookings b ON b.id = r.booking_id
        INNER JOIN hotel_staff hs ON hs.hotel_id = b.hotel_id AND hs.staff_user_id = ? AND hs.status = 'ACTIVE'
        INNER JOIN hotels h ON h.id = b.hotel_id
        ORDER BY r.created_at DESC
        `,
        [user.id],
      );
    }

    return [];
  }

  /**
   * Xem chi tiết yêu cầu hủy
   */
  async findOne(id: string, user: User) {
    const request = await this.requestRepo.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException('Không tìm thấy yêu cầu hủy.');
    }

    const booking = await this.bookingRepo.findOne({ where: { id: request.bookingId } });
    if (booking) {
      await this.bookingAccessService.assertCanView(booking, user);
    }

    return request;
  }
}
