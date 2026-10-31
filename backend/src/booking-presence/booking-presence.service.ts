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
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { runWithDeadlockRetry } from '../common/database/transaction-retry.helper';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';

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

        // Cập nhật booking
        booking.status = BookingStatus.CHECKED_IN;
        booking.actualCheckInAt = now;
        booking.checkInConfirmedBy = actorUserId;
        booking.presenceVersion = (booking.presenceVersion || 1) + 1;

        if (isFromNoShow) {
          booking.lateCheckInRecoveredAt = now;
        }

        const savedBooking = await bookingRepo.save(booking);

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
          reason:
            dto.note ||
            (isFromNoShow
              ? `Khôi phục nhận phòng muộn sau No-Show (${lateMinutes} phút sau giờ nhận phòng)`
              : `Khách nhận phòng tại quầy (${lateMinutes} phút)`),
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

        const now = new Date();
        const fromStatus = booking.status;

        booking.status = BookingStatus.COMPLETED;
        booking.actualCheckOutAt = now;
        booking.checkOutConfirmedBy = actorUserId;
        booking.presenceVersion = (booking.presenceVersion || 1) + 1;

        const savedBooking = await bookingRepo.save(booking);

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

        return {
          booking: savedBooking,
          presenceEvent,
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
  async closeExpiredNoShow(bookingId: string) {
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
          return booking; // Vẫn còn trong kỳ lưu trú
        }

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

    return {
      success: true,
      data: {
        todayArrivals,
        activeNoShows,
        counts: {
          todayArrivalsCount: todayArrivals.length,
          activeNoShowsCount: activeNoShows.length,
          inHouseCount,
        },
      },
    };
  }
}
