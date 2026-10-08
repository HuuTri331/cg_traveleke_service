import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { CheckoutSessionDto } from '../dto/checkout-session.dto';
import { Booking, BookingStatus } from '../../bookings/entities/booking.entity';
import { BookingRoom } from '../../bookings/entities/booking-room.entity';
import { BookingStatusLog } from '../../bookings/entities/booking-status-log.entity';
import { Room, RoomStatus } from '../../rooms/entities/room.entity';
import {
  PaymentTransaction,
  PaymentTransactionStatus,
} from '../entities/payment-transaction.entity';
import { BookingHold } from '../../inventory/entities/booking-hold.entity';
import { VnpayService } from '../vnpay.service';
import { InventoryService } from '../../inventory/inventory.service';
import { OutboxService } from '../../outbox/outbox.service';
import { IdGeneratorService } from '../../common/id/id-generator.service';
import { runWithDeadlockRetry } from '../../common/database/transaction-retry.helper';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  private readonly idGen = new IdGeneratorService();

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(PaymentTransaction)
    private readonly paymentRepo: Repository<PaymentTransaction>,
    @InjectRepository(Room)
    private readonly roomRepo: Repository<Room>,
    @InjectRepository(BookingHold)
    private readonly holdRepo: Repository<BookingHold>,
    private readonly dataSource: DataSource,
    private readonly vnpayService: VnpayService,
    private readonly inventoryService: InventoryService,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Tính toán hash SHA-256 từ thông tin cốt lõi của checkout request
   */
  computeRequestHash(dto: CheckoutSessionDto, userId: string): string {
    const payload = `${userId}:${dto.roomId}:${dto.checkInAt}:${dto.checkOutAt}:${dto.roomCount}:${dto.totalGuests}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Tạo Checkout Session với Idempotency check đầy đủ
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

    const requestHash = this.computeRequestHash(dto, userId);

    // ========================================================
    // 1. IDEMPOTENCY CHECK TRÊN DATABASE
    // ========================================================
    if (dto.idempotencyKey) {
      const existingBooking = await this.bookingRepo.findOne({
        where: { checkoutIdempotencyKey: dto.idempotencyKey },
      });

      if (existingBooking) {
        // Cùng user và cùng request hash -> Trả về checkout session đã có (Idempotent return)
        if (
          existingBooking.userId === userId &&
          existingBooking.checkoutRequestHash === requestHash
        ) {
          this.logger.log(
            `[CheckoutIdempotency] Idempotency hit cho key "${dto.idempotencyKey}" (Booking ${existingBooking.id}). Trả về phiên hiện tại.`,
          );

          const existingPayment = await this.paymentRepo.findOne({
            where: { bookingId: existingBooking.id },
            order: { attemptNo: 'DESC' },
          });

          const hold = await this.holdRepo.findOne({
            where: { bookingId: existingBooking.id },
          });

          if (existingPayment) {
            const vnpayUrlData = this.vnpayService.buildPaymentUrl({
              txnRef: existingPayment.txnRef,
              amount: Number(existingBooking.estimatedTotal),
              orderInfo: `Thanh toan don hang ${existingBooking.bookingCode}`,
              ipAddr: clientIp,
              createDate: existingPayment.createdAt,
            });

            return {
              bookingId: existingBooking.id,
              bookingCode: existingBooking.bookingCode,
              paymentId: existingPayment.id,
              txnRef: existingPayment.txnRef,
              paymentUrl: vnpayUrlData.paymentUrl,
              paymentExpiresAt:
                existingPayment.gatewayExpireAt?.toISOString() ||
                vnpayUrlData.paymentCutoffAt.toISOString(),
              holdExpiresAt:
                hold?.holdExpiresAt?.toISOString() ||
                new Date(Date.now() + 15 * 60 * 1000).toISOString(),
              amount: Number(existingBooking.estimatedTotal),
              isIdempotentReplay: true,
            };
          }
        }

        // Khác payload hoặc khác user -> 409 Conflict
        throw new ConflictException(
          'Idempotency key này đã được sử dụng với thông tin đặt phòng khác.',
        );
      }
    }

    // ========================================================
    // 2. TẠO MỚI CHECKOUT SESSION TRONG TRANSACTION
    // ========================================================
    const room = await this.roomRepo.findOne({
      where: { id: dto.roomId },
    });
    if (!room) {
      throw new NotFoundException('Không tìm thấy thông tin phòng.');
    }
    if (room.status !== RoomStatus.AVAILABLE) {
      throw new ConflictException('Loại phòng này hiện không khả dụng để đặt.');
    }

    const diffTime = checkOut.getTime() - checkIn.getTime();
    const nights = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const pricePerNight = Number(room.pricePerNight);
    const subtotal = pricePerNight * nights * dto.roomCount;
    const bookingCode = this.idGen.generateBookingCode();

    const sessionResult = await runWithDeadlockRetry(
      this.dataSource,
      async (manager: EntityManager) => {
        const bookingRepo = manager.getRepository(Booking);
        const bookingRoomRepo = manager.getRepository(BookingRoom);
        const paymentRepo = manager.getRepository(PaymentTransaction);

        // Tạo Booking ở trạng thái PAYMENT_PENDING
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
          checkoutIdempotencyKey: dto.idempotencyKey || null,
          checkoutRequestHash: requestHash,
        });

        const savedBooking = await bookingRepo.save(booking);

        // Snapshot phòng đặt
        const bookingRoom = bookingRoomRepo.create({
          bookingId: savedBooking.id,
          roomId: room.id,
          quantity: dto.roomCount,
          pricePerNight: pricePerNight.toFixed(2),
          nights,
          subtotal: subtotal.toFixed(2),
        });
        await bookingRoomRepo.save(bookingRoom);

        // Log trạng thái ban đầu PAYMENT_PENDING
        await manager.getRepository(BookingStatusLog).save(
          manager.getRepository(BookingStatusLog).create({
            bookingId: savedBooking.id,
            oldStatus: null,
            newStatus: BookingStatus.PAYMENT_PENDING,
            changedBy: userId,
            note: 'Khởi tạo phiên thanh toán VNPay',
          }),
        );

        // Giữ phòng (duy nhất 1 hold row)
        const hold = await this.inventoryService.createInitialHold(
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

        // Tạo PaymentTransaction Attempt 1
        const txnRef = `${savedBooking.bookingCode}-A01`;
        const vnpayUrlData = this.vnpayService.buildPaymentUrl({
          txnRef,
          amount: subtotal,
          orderInfo: `Thanh toan don hang ${savedBooking.bookingCode}`,
          ipAddr: clientIp,
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

        // Outbox event
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
      { contextName: 'CheckoutService.createCheckoutSession' },
    );

    return {
      bookingId: sessionResult.booking.id,
      bookingCode: sessionResult.booking.bookingCode,
      paymentId: sessionResult.payment.id,
      txnRef: sessionResult.payment.txnRef,
      paymentUrl: sessionResult.paymentUrl,
      paymentExpiresAt: sessionResult.paymentCutoffAt.toISOString(),
      holdExpiresAt: sessionResult.holdExpiresAt.toISOString(),
      amount: subtotal,
      isIdempotentReplay: false,
    };
  }
}
