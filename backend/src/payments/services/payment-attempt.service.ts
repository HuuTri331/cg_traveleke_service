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
  PaymentTransaction,
  PaymentTransactionStatus,
} from '../entities/payment-transaction.entity';
import { Booking, BookingStatus } from '../../bookings/entities/booking.entity';
import { BookingRoom } from '../../bookings/entities/booking-room.entity';
import { VnpayService } from '../vnpay.service';
import { InventoryService } from '../../inventory/inventory.service';
import { runWithDeadlockRetry } from '../../common/database/transaction-retry.helper';

@Injectable()
export class PaymentAttemptService {
  private readonly logger = new Logger(PaymentAttemptService.name);

  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly paymentRepo: Repository<PaymentTransaction>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly dataSource: DataSource,
    private readonly vnpayService: VnpayService,
    private readonly inventoryService: InventoryService,
  ) {}

  /**
   * Lấy attempt thanh toán mới nhất của booking
   */
  async getLatestAttempt(
    bookingId: string,
    manager?: EntityManager,
  ): Promise<PaymentTransaction | null> {
    const repo = manager
      ? manager.getRepository(PaymentTransaction)
      : this.paymentRepo;
    return await repo.findOne({
      where: { bookingId },
      order: { attemptNo: 'DESC' },
    });
  }

  /**
   * Lấy active PENDING attempt (nếu còn)
   */
  async getActiveAttempt(
    bookingId: string,
    manager?: EntityManager,
  ): Promise<PaymentTransaction | null> {
    const repo = manager
      ? manager.getRepository(PaymentTransaction)
      : this.paymentRepo;
    return await repo.findOne({
      where: {
        bookingId,
        status: PaymentTransactionStatus.PENDING,
      },
      order: { attemptNo: 'DESC' },
    });
  }

  /**
   * Quy tắc vàng: Một booking tối đa 1 active PENDING payment attempt.
   * Xử lý retry payment an toàn:
   * - Nếu latest attempt đang PENDING và chưa hết hạn gateway: reuse attempt hiện tại!
   * - Nếu latest attempt đang PENDING và đã quá hạn: QueryDr trước!
   *   + Nếu VNPay PAID -> báo đã thanh toán
   *   + Nếu chưa trả -> đánh dấu EXPIRED, sau đó mới cho tạo attempt mới.
   */
  async retryPayment(
    bookingId: string,
    userId: string,
    clientIp = '127.0.0.1',
    finalizePaymentFn?: (txnRef: string, queryDrResult: any) => Promise<any>,
  ) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng.');
    }
    if (booking.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền thao tác trên đơn này.');
    }
    if (
      booking.status === BookingStatus.CONFIRMED ||
      booking.status === BookingStatus.PENDING
    ) {
      throw new BadRequestException('Đơn hàng này đã được thanh toán thành công.');
    }
    if (
      booking.status === BookingStatus.CANCELLED ||
      booking.status === BookingStatus.REJECTED
    ) {
      throw new BadRequestException('Đơn hàng đã bị hủy, không thể thanh toán lại.');
    }

    return await runWithDeadlockRetry(
      this.dataSource,
      async (manager: EntityManager) => {
        const paymentRepo = manager.getRepository(PaymentTransaction);

        // Khóa booking row
        await manager.getRepository(Booking).findOne({
          where: { id: bookingId },
          lock: { mode: 'pessimistic_write' },
        });

        const latestAttempt = await paymentRepo.findOne({
          where: { bookingId },
          order: { attemptNo: 'DESC' },
          lock: { mode: 'pessimistic_write' },
        });

        const now = new Date();

        // 1. Nếu có attempt đang PENDING và chưa hết hạn gateway: Reuse attempt hiện tại!
        if (
          latestAttempt &&
          latestAttempt.status === PaymentTransactionStatus.PENDING &&
          latestAttempt.gatewayExpireAt &&
          latestAttempt.gatewayExpireAt > now
        ) {
          this.logger.log(
            `[PaymentAttempt] Booking ${bookingId} tái sử dụng active attempt ${latestAttempt.txnRef} (còn hạn đến ${latestAttempt.gatewayExpireAt.toISOString()})`,
          );

          // Tái sử dụng hoặc gia hạn BookingHold row duy nhất
          const hold = await this.inventoryService.reuseOrReacquireHold(
            booking.id,
            manager,
          );

          // Tạo URL thanh toán VNPay tương ứng với txnRef hiện tại
          const vnpayUrlData = this.vnpayService.buildPaymentUrl({
            txnRef: latestAttempt.txnRef,
            amount: Number(booking.estimatedTotal),
            orderInfo: `Thanh toan don hang ${booking.bookingCode}`,
            ipAddr: clientIp,
            createDate: latestAttempt.createdAt,
          });

          return {
            bookingId: booking.id,
            bookingCode: booking.bookingCode,
            attemptNo: latestAttempt.attemptNo,
            txnRef: latestAttempt.txnRef,
            paymentUrl: vnpayUrlData.paymentUrl,
            paymentExpiresAt: latestAttempt.gatewayExpireAt.toISOString(),
            holdExpiresAt: hold.holdExpiresAt.toISOString(),
            reused: true,
          };
        }

        // 2. Nếu latest attempt đang PENDING nhưng đã quá hạn gateway: QueryDr trước!
        if (
          latestAttempt &&
          latestAttempt.status === PaymentTransactionStatus.PENDING &&
          latestAttempt.gatewayExpireAt &&
          latestAttempt.gatewayExpireAt <= now
        ) {
          this.logger.log(
            `[PaymentAttempt] Latest attempt ${latestAttempt.txnRef} đã quá hạn gateway. Kiểm tra QueryDr trước khi cho phép retry...`,
          );

          try {
            const queryDrResult = await this.vnpayService.queryDr({
              txnRef: latestAttempt.txnRef,
              transactionDate: latestAttempt.createdAt,
              ipAddr: clientIp,
            });

            if (
              queryDrResult?.vnp_ResponseCode === '00' &&
              queryDrResult?.vnp_TransactionStatus === '00'
            ) {
              if (finalizePaymentFn) {
                await finalizePaymentFn(latestAttempt.txnRef, queryDrResult);
              } else {
                latestAttempt.status = PaymentTransactionStatus.PAID;
                latestAttempt.paidAt = new Date();
                await paymentRepo.save(latestAttempt);
              }
              throw new BadRequestException(
                'Đơn hàng này vừa được xác nhận thanh toán thành công qua VNPay.',
              );
            }
          } catch (err: any) {
            if (err instanceof BadRequestException) throw err;
            this.logger.warn(
              `[PaymentAttempt] QueryDr kiểm tra thất bại: ${err.message}. Tiếp tục đánh dấu EXPIRED.`,
            );
          }

          // VNPay chưa trả -> đánh dấu EXPIRED
          latestAttempt.status = PaymentTransactionStatus.EXPIRED;
          latestAttempt.expiredAt = new Date();
          await paymentRepo.save(latestAttempt);
        }

        // 3. Tái sử dụng hoặc reacquire lại hold trên CÙNG 1 ROW (không insert duplicate hold)
        const hold = await this.inventoryService.reuseOrReacquireHold(
          booking.id,
          manager,
        );

        // 4. Tạo attempt mới (chỉ khi latest attempt đã FAILED hoặc EXPIRED)
        const pastAttempts = await paymentRepo.count({
          where: { bookingId },
        });
        const newAttemptNo = pastAttempts + 1;
        const newTxnRef = `${booking.bookingCode}-A${String(newAttemptNo).padStart(2, '0')}`;

        const vnpayUrlData = this.vnpayService.buildPaymentUrl({
          txnRef: newTxnRef,
          amount: Number(booking.estimatedTotal),
          orderInfo: `Thanh toan lai don hang ${booking.bookingCode}`,
          ipAddr: clientIp,
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
          txnRef: newTxnRef,
          paymentUrl: vnpayUrlData.paymentUrl,
          paymentExpiresAt: vnpayUrlData.paymentCutoffAt.toISOString(),
          holdExpiresAt: hold.holdExpiresAt.toISOString(),
          reused: false,
        };
      },
      { contextName: 'PaymentAttemptService.retryPayment' },
    );
  }
}
