import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  PaymentTransaction,
  PaymentTransactionStatus,
} from './entities/payment-transaction.entity';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { BookingStatusLog } from '../bookings/entities/booking-status-log.entity';
import { BookingRoom } from '../bookings/entities/booking-room.entity';
import { Room, RoomStatus } from '../rooms/entities/room.entity';
import { VnpayService } from './vnpay.service';
import { InventoryService } from '../inventory/inventory.service';
import { OutboxService } from '../outbox/outbox.service';
import { BookingsService } from '../bookings/bookings.service';
import { IdGeneratorService } from '../common/id/id-generator.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RedisLockService } from '../redis/redis-lock.service';
import { runWithDeadlockRetry } from '../common/database/transaction-retry.helper';
import { CheckoutSessionDto } from './dto/checkout-session.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly idGen = new IdGeneratorService();

  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly paymentRepo: Repository<PaymentTransaction>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingStatusLog)
    private readonly statusLogRepo: Repository<BookingStatusLog>,
    @InjectRepository(BookingRoom)
    private readonly bookingRoomRepo: Repository<BookingRoom>,
    @InjectRepository(Room)
    private readonly roomRepo: Repository<Room>,
    private readonly dataSource: DataSource,
    private readonly vnpayService: VnpayService,
    private readonly inventoryService: InventoryService,
    private readonly outboxService: OutboxService,
    @Inject(forwardRef(() => BookingsService))
    private readonly bookingsService: BookingsService,
    @Optional()
    private readonly realtimeGateway?: RealtimeGateway,
    @Optional()
    private readonly redisLockService?: RedisLockService,
  ) {}

  /**
   * Tạo Checkout Session + Giữ phòng (HOLD) + Tạo Booking (PAYMENT_PENDING) + Tạo VNPay URL
   * Section 16 & 17: Database Commit xong mới trả URL redirect cho client
   */
  async createCheckoutSession(
    dto: CheckoutSessionDto,
    userId: string,
    clientIp = '127.0.0.1',
  ) {
    const checkIn = new Date(dto.checkInAt);
    const checkOut = new Date(dto.checkOutAt);

    if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
      throw new BadRequestException('Ngày nhận hoặc trả phòng không hợp lệ.');
    }
    if (checkOut <= checkIn) {
      throw new BadRequestException(
        'Thời gian trả phòng phải sau thời gian nhận phòng.',
      );
    }
    if (dto.roomCount <= 0) {
      throw new BadRequestException('Số lượng phòng phải lớn hơn hoặc bằng 1.');
    }

    // Lấy thông tin phòng trực tiếp từ Database (không tin cậy giá từ frontend)
    const room = await this.roomRepo.findOne({
      where: { id: dto.roomId },
    });
    if (!room) {
      throw new NotFoundException('Không tìm thấy thông tin phòng.');
    }
    if (room.status !== RoomStatus.AVAILABLE) {
      throw new ConflictException('Loại phòng này hiện không khả dụng để đặt.');
    }

    // Tính toán số đêm và tổng tiền
    const diffTime = checkOut.getTime() - checkIn.getTime();
    const nights = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const pricePerNight = Number(room.pricePerNight);
    const subtotal = pricePerNight * nights * dto.roomCount;

    const bookingCode = this.idGen.generateBookingCode();

    // Thực hiện DB Transaction bảo vệ bởi Deadlock Retry
    const sessionResult = await runWithDeadlockRetry(
      this.dataSource,
      async (manager: EntityManager) => {
        const bookingRepo = manager.getRepository(Booking);
        const bookingRoomRepo = manager.getRepository(BookingRoom);
        const paymentRepo = manager.getRepository(PaymentTransaction);

        // 1. Tạo Booking ở trạng thái PAYMENT_PENDING (chưa trừ inventory thật)
        const booking = bookingRepo.create({
          bookingCode,
          userId,
          hotelId: room.hotelId,
          tripPlanId: null,
          handledBy: null,
          assignmentType: 'AUTO',
          contactName: dto.contactName,
          contactEmail: dto.contactEmail,
          contactPhone: dto.contactPhone,
          checkInAt: checkIn,
          checkOutAt: checkOut,
          totalGuests: dto.totalGuests || 1,
          requestedRoomCount: dto.roomCount,
          estimatedTotal: subtotal.toFixed(2),
          status: BookingStatus.PAYMENT_PENDING,
          specialRequest: dto.specialRequest ?? null,
        });

        const savedBooking = await bookingRepo.save(booking);

        // 2. Snapshot phòng đặt
        const bookingRoom = bookingRoomRepo.create({
          bookingId: savedBooking.id,
          roomId: room.id,
          quantity: dto.roomCount,
          pricePerNight: pricePerNight.toFixed(2),
          nights,
          subtotal: subtotal.toFixed(2),
        });
        await bookingRoomRepo.save(bookingRoom);

        // 3. Log trạng thái ban đầu PAYMENT_PENDING
        await manager.getRepository(BookingStatusLog).save(
          manager.getRepository(BookingStatusLog).create({
            bookingId: savedBooking.id,
            oldStatus: null,
            newStatus: BookingStatus.PAYMENT_PENDING,
            changedBy: userId,
            note: 'Khởi tạo phiên thanh toán VNPay',
          }),
        );

        // 4. Giữ phòng tạm thời (BookingHold = HELD) trong khoảng [checkIn, checkOut)
        // Hard hold expiry = 15 phút (Section 27)
        const hold = await this.inventoryService.reserveHold(
          {
            bookingId: savedBooking.id,
            roomId: room.id,
            quantity: dto.roomCount,
            checkInAt: checkIn,
            checkOutAt: checkOut,
            holdMinutes: 15,
          },
          manager,
        );

        // 5. Tạo PaymentTransaction (Attempt 1)
        const txnRef = `${savedBooking.bookingCode}-A01`;
        const vnpayUrlData = this.vnpayService.buildPaymentUrl({
          txnRef,
          amount: subtotal,
          orderInfo: `Thanh toan don hang ${savedBooking.bookingCode}`,
          ipAddr: clientIp,
          cutoffMinutes: 13.916, // 13 phút 55 giây
          createDate: new Date(),
        });

        const payment = paymentRepo.create({
          bookingId: savedBooking.id,
          provider: 'VNPAY',
          attemptNo: 1,
          txnRef,
          amount: subtotal.toFixed(2),
          currency: 'VND',
          status: PaymentTransactionStatus.PENDING,
          gatewayExpireAt: vnpayUrlData.paymentCutoffAt,
        });
        const savedPayment = await paymentRepo.save(payment);

        // 6. Ghi Outbox event khởi tạo checkout
        await this.outboxService.addEvent(
          manager,
          'checkout.created',
          'Booking',
          savedBooking.id,
          {
            bookingId: savedBooking.id,
            bookingCode: savedBooking.bookingCode,
            paymentId: savedPayment.id,
            txnRef,
            amount: subtotal,
            holdExpiresAt: hold.holdExpiresAt,
            paymentCutoffAt: vnpayUrlData.paymentCutoffAt,
          },
        );

        return {
          booking: savedBooking,
          payment: savedPayment,
          paymentUrl: vnpayUrlData.paymentUrl,
          paymentCutoffAt: vnpayUrlData.paymentCutoffAt,
          holdExpiresAt: hold.holdExpiresAt,
        };
      },
      { contextName: 'PaymentsService.createCheckoutSession' },
    );

    return {
      bookingId: sessionResult.booking.id,
      bookingCode: sessionResult.booking.bookingCode,
      paymentId: sessionResult.payment.id,
      paymentUrl: sessionResult.paymentUrl,
      paymentExpiresAt: sessionResult.paymentCutoffAt.toISOString(),
      holdExpiresAt: sessionResult.holdExpiresAt.toISOString(),
      amount: subtotal,
    };
  }

  /**
   * Xử lý VNPay IPN (Server-to-Server)
   * Phải IDEMPOTENT và sử dụng SELECT FOR UPDATE (Section 22 & 23)
   */
  async processVnpayIpn(queryParams: Record<string, any>) {
    this.logger.log(
      `[VNPay IPN] Nhận callback IPN: ${JSON.stringify(queryParams)}`,
    );

    // 1. Kiểm tra chữ ký bảo mật HMAC-SHA512
    const isValidSignature = this.vnpayService.verifySignature(queryParams);
    if (!isValidSignature) {
      this.logger.warn(`[VNPay IPN] Chữ ký không hợp lệ!`);
      return { RspCode: '97', Message: 'Checksum failed' };
    }

    const txnRef = queryParams['vnp_TxnRef'];
    const vnpAmountRaw = Number(queryParams['vnp_Amount']);
    const vnpAmount = vnpAmountRaw / 100; // VNPay nhân 100
    const vnpResponseCode = queryParams['vnp_ResponseCode'];
    const vnpTransactionStatus = queryParams['vnp_TransactionStatus'];
    const vnpTransactionNo = queryParams['vnp_TransactionNo'];
    const vnpBankCode = queryParams['vnp_BankCode'];
    const vnpCardType = queryParams['vnp_CardType'];
    const vnpPayDateStr = queryParams['vnp_PayDate'];

    return await runWithDeadlockRetry(
      this.dataSource,
      async (manager: EntityManager) => {
        // 2. Row Lock payment transaction FOR UPDATE
        const payment = await manager.getRepository(PaymentTransaction).findOne({
          where: { txnRef },
          lock: { mode: 'pessimistic_write' },
        });

        if (!payment) {
          this.logger.warn(`[VNPay IPN] Không tìm thấy giao dịch: ${txnRef}`);
          return { RspCode: '01', Message: 'Order not found' };
        }

        // 3. Kiểm tra số tiền
        if (Math.abs(Number(payment.amount) - vnpAmount) > 1) {
          this.logger.warn(
            `[VNPay IPN] Sai lệch số tiền: DB=${payment.amount}, IPN=${vnpAmount}`,
          );
          return { RspCode: '04', Message: 'Invalid amount' };
        }

        // 4. Kiểm tra Idempotency: nếu đã PAID thì trả về đã xử lý
        if (payment.status === PaymentTransactionStatus.PAID) {
          this.logger.log(
            `[VNPay IPN] Giao dịch ${txnRef} đã được xử lý thành công trước đó (Idempotent OK).`,
          );
          return { RspCode: '02', Message: 'Order already confirmed' };
        }

        // 5. Tìm booking liên quan
        const booking = await manager.getRepository(Booking).findOne({
          where: { id: payment.bookingId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!booking) {
          return { RspCode: '01', Message: 'Order not found' };
        }

        // Parse ngày thanh toán nếu có
        let payDate: Date | null = null;
        if (vnpPayDateStr && vnpPayDateStr.length === 14) {
          const y = Number(vnpPayDateStr.slice(0, 4));
          const m = Number(vnpPayDateStr.slice(4, 6)) - 1;
          const d = Number(vnpPayDateStr.slice(6, 8));
          const h = Number(vnpPayDateStr.slice(8, 10));
          const min = Number(vnpPayDateStr.slice(10, 12));
          const s = Number(vnpPayDateStr.slice(12, 14));
          payDate = new Date(Date.UTC(y, m, d, h - 7, min, s));
        }

        // ========================================================
        // 6. XỬ LÝ THANH TOÁN THÀNH CÔNG (vnp_ResponseCode === '00')
        // ========================================================
        if (vnpResponseCode === '00' && vnpTransactionStatus === '00') {
          // Thử Commit Hold: HELD -> COMMITTED
          let holdCommitted = await this.inventoryService.commitHold(
            booking.id,
            manager,
          );

          // Nếu hold đã bị release (Late IPN case - Section 33)
          if (!holdCommitted) {
            this.logger.warn(
              `[VNPay IPN] Hold của booking ${booking.id} không còn ở trạng thái HELD. Thử reacquire inventory...`,
            );
            const reacquireResult =
              await this.inventoryService.reacquireInventory(
                booking.id,
                manager,
              );

            if (reacquireResult.success) {
              holdCommitted = reacquireResult.hold!;
              this.logger.log(
                `[VNPay IPN] Reacquire inventory thành công cho booking ${booking.id}!`,
              );
            } else {
              // Overbooking prevented! Cần chuyển sang review/refund
              this.logger.error(
                `[VNPay IPN] Overbooking prevented! Late IPN cho booking ${booking.id} nhưng phòng đã hết. Đánh dấu PAID_REQUIRES_REVIEW.`,
              );

              payment.status = PaymentTransactionStatus.PAID_REQUIRES_REVIEW;
              payment.responseCode = vnpResponseCode;
              payment.transactionStatus = vnpTransactionStatus;
              payment.vnpTransactionNo = vnpTransactionNo;
              payment.bankCode = vnpBankCode;
              payment.cardType = vnpCardType;
              payment.payDate = payDate || new Date();
              payment.paidAt = new Date();
              payment.rawIpnResponse = queryParams;
              await manager.getRepository(PaymentTransaction).save(payment);

              booking.status = BookingStatus.PAYMENT_REVIEW;
              await manager.getRepository(Booking).save(booking);

              await manager.getRepository(BookingStatusLog).save(
                manager.getRepository(BookingStatusLog).create({
                  bookingId: booking.id,
                  oldStatus: booking.status,
                  newStatus: BookingStatus.PAYMENT_REVIEW,
                  changedBy: booking.userId || '1',
                  note:
                    'Thanh toán thành công nhưng inventory đã hết (Late IPN) - Cần hoàn tiền hoặc xếp phòng thủ công',
                }),
              );

              // Đưa vào Outbox để worker/admin xử lý hoàn tiền
              await this.outboxService.addEvent(
                manager,
                'refund.requested',
                'PaymentTransaction',
                payment.id,
                {
                  bookingId: booking.id,
                  paymentId: payment.id,
                  amount: payment.amount,
                  reason: 'Overbooking prevented on late IPN',
                },
              );

              return { RspCode: '00', Message: 'Confirm Success' };
            }
          }

          // Cập nhật Payment -> PAID
          payment.status = PaymentTransactionStatus.PAID;
          payment.responseCode = vnpResponseCode;
          payment.transactionStatus = vnpTransactionStatus;
          payment.vnpTransactionNo = vnpTransactionNo;
          payment.bankCode = vnpBankCode;
          payment.cardType = vnpCardType;
          payment.payDate = payDate || new Date();
          payment.paidAt = new Date();
          payment.rawIpnResponse = queryParams;
          await manager.getRepository(PaymentTransaction).save(payment);

          // Cập nhật Booking -> PENDING (chờ khách sạn xác nhận)
          const oldBookingStatus = booking.status;
          booking.status = BookingStatus.PENDING;
          await manager.getRepository(Booking).save(booking);

          // Ghi Status Log
          await manager.getRepository(BookingStatusLog).save(
            manager.getRepository(BookingStatusLog).create({
              bookingId: booking.id,
              oldStatus: oldBookingStatus,
              newStatus: BookingStatus.PENDING,
              changedBy: booking.userId || '1',
              note: `Thanh toán VNPay thành công (Mã GD: ${vnpTransactionNo})`,
            }),
          );

          // Section 41: Auto assign nhân viên chỉ sau khi thanh toán thành công
          await this.bookingsService.autoAssignStaffForPaidBooking(
            booking.id,
            manager,
          );

          // Section 14: Thêm Outbox events (Email và Socket realtime xử lý sau DB commit)
          await this.outboxService.addEvent(
            manager,
            'payment.paid',
            'Booking',
            booking.id,
            {
              bookingId: booking.id,
              bookingCode: booking.bookingCode,
              paymentId: payment.id,
              vnpTransactionNo,
              amount: payment.amount,
              hotelId: booking.hotelId,
              userId: booking.userId,
            },
          );

          await this.outboxService.addEvent(
            manager,
            'mail.payment_success',
            'Booking',
            booking.id,
            {
              bookingId: booking.id,
              bookingCode: booking.bookingCode,
              contactEmail: booking.contactEmail,
              contactName: booking.contactName,
              amount: payment.amount,
              vnpTransactionNo,
              paidAt: payment.paidAt,
              checkInAt: booking.checkInAt,
              checkOutAt: booking.checkOutAt,
            },
          );

          return { RspCode: '00', Message: 'Confirm Success' };
        }

        // ========================================================
        // 7. THANH TOÁN THẤT BẠI HOẶC BỊ HỦY
        // ========================================================
        payment.status = PaymentTransactionStatus.FAILED;
        payment.responseCode = vnpResponseCode;
        payment.transactionStatus = vnpTransactionStatus;
        payment.failedAt = new Date();
        payment.rawIpnResponse = queryParams;
        await manager.getRepository(PaymentTransaction).save(payment);

        // Giải phóng hold phòng
        await this.inventoryService.releaseHold(
          booking.id,
          `Thanh toán VNPay thất bại hoặc bị hủy (Code: ${vnpResponseCode})`,
          manager,
        );

        await this.outboxService.addEvent(
          manager,
          'payment.failed',
          'Booking',
          booking.id,
          {
            bookingId: booking.id,
            bookingCode: booking.bookingCode,
            paymentId: payment.id,
            responseCode: vnpResponseCode,
            userId: booking.userId,
          },
        );

        return { RspCode: '00', Message: 'Confirm Success' };
      },
      { contextName: 'PaymentsService.processVnpayIpn' },
    );
  }

  /**
   * Lấy trạng thái thanh toán của booking (phục vụ Polling / Kết quả thanh toán)
   */
  async getPaymentStatus(bookingId: string, currentUserId?: string) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng.');
    }

    if (currentUserId && booking.userId !== currentUserId) {
      throw new ForbiddenException('Bạn không có quyền xem đơn đặt phòng này.');
    }

    const latestPayment = await this.paymentRepo.findOne({
      where: { bookingId },
      order: { attemptNo: 'DESC' },
    });

    return {
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      bookingStatus: booking.status,
      estimatedTotal: booking.estimatedTotal,
      payment: latestPayment
        ? {
            id: latestPayment.id,
            status: latestPayment.status,
            amount: latestPayment.amount,
            attemptNo: latestPayment.attemptNo,
            txnRef: latestPayment.txnRef,
            vnpTransactionNo: latestPayment.vnpTransactionNo,
            paidAt: latestPayment.paidAt,
            failedAt: latestPayment.failedAt,
            gatewayExpireAt: latestPayment.gatewayExpireAt,
          }
        : null,
    };
  }

  /**
   * Lấy trạng thái thanh toán theo txnRef (dành cho màn hình kết quả Return URL của VNPay)
   */
  async getPaymentStatusByTxnRef(txnRef: string) {
    const payment = await this.paymentRepo.findOne({
      where: { txnRef },
    });
    if (!payment) {
      throw new NotFoundException('Không tìm thấy giao dịch.');
    }

    const booking = await this.bookingRepo.findOne({
      where: { id: payment.bookingId },
    });

    return {
      bookingId: payment.bookingId,
      bookingCode: booking?.bookingCode || '',
      bookingStatus: booking?.status || '',
      estimatedTotal: booking?.estimatedTotal || payment.amount,
      hotelId: booking?.hotelId,
      payment: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        attemptNo: payment.attemptNo,
        txnRef: payment.txnRef,
        vnpTransactionNo: payment.vnpTransactionNo,
        paidAt: payment.paidAt,
        failedAt: payment.failedAt,
        gatewayExpireAt: payment.gatewayExpireAt,
      },
    };
  }

  /**
   * Thử lại thanh toán (Payment Retry - Section 31)
   * POST /bookings/:bookingId/payment-attempts
   */
  async retryPayment(bookingId: string, userId: string, clientIp = '127.0.0.1') {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng.');
    }
    if (booking.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền thao tác trên đơn này.');
    }
    if (booking.status === BookingStatus.CONFIRMED || booking.status === BookingStatus.PENDING) {
      throw new BadRequestException('Đơn hàng này đã được thanh toán thành công.');
    }
    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.REJECTED) {
      throw new BadRequestException('Đơn hàng đã bị hủy, không thể thanh toán lại.');
    }

    return await runWithDeadlockRetry(
      this.dataSource,
      async (manager: EntityManager) => {
        const paymentRepo = manager.getRepository(PaymentTransaction);

        // Đếm số lần attempt trước đó
        const pastAttempts = await paymentRepo.count({
          where: { bookingId },
        });
        const newAttemptNo = pastAttempts + 1;
        const newTxnRef = `${booking.bookingCode}-A${String(newAttemptNo).padStart(2, '0')}`;

        // Kiểm tra xem hold hiện tại có còn hợp lệ không
        const currentOccupied = await this.inventoryService.getOccupiedRooms(
          '', // will check via room repo inside transaction
          booking.checkInAt,
          booking.checkOutAt,
          manager,
        );

        // Lấy room info từ booking_room
        const bookingRoom = await manager.getRepository(BookingRoom).findOne({
          where: { bookingId },
        });
        if (!bookingRoom) {
          throw new NotFoundException('Không tìm thấy chi tiết phòng của đơn đặt.');
        }

        // Tạo hoặc gia hạn BookingHold
        await this.inventoryService.reserveHold(
          {
            bookingId: booking.id,
            roomId: bookingRoom.roomId,
            quantity: booking.requestedRoomCount,
            checkInAt: booking.checkInAt,
            checkOutAt: booking.checkOutAt,
            holdMinutes: 15,
          },
          manager,
        );

        // Tạo VNPay URL mới
        const amountNumber = Number(booking.estimatedTotal);
        const vnpayUrlData = this.vnpayService.buildPaymentUrl({
          txnRef: newTxnRef,
          amount: amountNumber,
          orderInfo: `Thanh toan lai don hang ${booking.bookingCode}`,
          ipAddr: clientIp,
          cutoffMinutes: 13.916,
        });

        const newPayment = paymentRepo.create({
          bookingId: booking.id,
          provider: 'VNPAY',
          attemptNo: newAttemptNo,
          txnRef: newTxnRef,
          amount: booking.estimatedTotal,
          currency: 'VND',
          status: PaymentTransactionStatus.PENDING,
          gatewayExpireAt: vnpayUrlData.paymentCutoffAt,
        });
        await paymentRepo.save(newPayment);

        return {
          bookingId: booking.id,
          bookingCode: booking.bookingCode,
          attemptNo: newAttemptNo,
          paymentUrl: vnpayUrlData.paymentUrl,
          paymentExpiresAt: vnpayUrlData.paymentCutoffAt.toISOString(),
          holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        };
      },
      { contextName: 'PaymentsService.retryPayment' },
    );
  }

  /**
   * Đối soát trạng thái thanh toán thật với VNPay qua QueryDr (Section 34)
   */
  async reconcilePayment(bookingId: string) {
    const payment = await this.paymentRepo.findOne({
      where: { bookingId, status: PaymentTransactionStatus.PENDING },
      order: { attemptNo: 'DESC' },
    });

    if (!payment) {
      return { message: 'Không có giao dịch PENDING cần đối soát.' };
    }

    try {
      const qdrResult = await this.vnpayService.queryDr({
        txnRef: payment.txnRef,
        transactionDate: payment.createdAt,
      });

      this.logger.log(
        `[QueryDr Reconcile] Kết quả QueryDr cho ${payment.txnRef}: ${JSON.stringify(qdrResult)}`,
      );

      // Nếu VNPay xác nhận đã thanh toán thành công (00)
      if (
        qdrResult.vnp_ResponseCode === '00' &&
        qdrResult.vnp_TransactionStatus === '00'
      ) {
        await this.processVnpayIpn({
          vnp_TxnRef: payment.txnRef,
          vnp_Amount: Number(payment.amount) * 100,
          vnp_ResponseCode: '00',
          vnp_TransactionStatus: '00',
          vnp_TransactionNo: qdrResult.vnp_TransactionNo || 'QDR_RESOLVED',
          vnp_PayDate: qdrResult.vnp_PayDate,
          vnp_BankCode: qdrResult.vnp_BankCode,
          vnp_CardType: qdrResult.vnp_CardType,
          vnp_SecureHash: 'INTERNAL_QUERYDR_VALIDATED', // bypass check because queryDr verified server-to-server
        });
        return { reconciled: true, status: 'PAID', qdrResult };
      }

      return { reconciled: false, qdrResult };
    } catch (err: any) {
      this.logger.error(
        `[QueryDr Reconcile] Lỗi đối soát: ${err.message}`,
        err.stack,
      );
      return { reconciled: false, error: err.message };
    }
  }

  /**
   * Yêu cầu hoàn tiền (Refund - Section 35)
   */
  async requestRefund(
    bookingId: string,
    amount: number,
    reason: string,
    adminId: string,
  ) {
    const payment = await this.paymentRepo.findOne({
      where: { bookingId, status: PaymentTransactionStatus.PAID },
    });
    if (!payment) {
      throw new NotFoundException('Không tìm thấy giao dịch đã thanh toán.');
    }

    return await this.dataSource.transaction(async (manager) => {
      payment.status = PaymentTransactionStatus.REFUND_PENDING;
      payment.refundAmount = amount.toFixed(2);
      payment.refundNote = reason;
      await manager.getRepository(PaymentTransaction).save(payment);

      // Đưa job refund vào Outbox
      await this.outboxService.addEvent(
        manager,
        'refund.process',
        'PaymentTransaction',
        payment.id,
        {
          paymentId: payment.id,
          txnRef: payment.txnRef,
          transactionNo: payment.vnpTransactionNo,
          amount,
          reason,
          adminId,
          transactionDate: payment.paidAt || payment.createdAt,
        },
      );

      return {
        message: 'Yêu cầu hoàn tiền đã được tiếp nhận và xử lý ngầm.',
        paymentId: payment.id,
        status: PaymentTransactionStatus.REFUND_PENDING,
      };
    });
  }
}
