import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { BookingRoom } from '../bookings/entities/booking-room.entity';
import {
  assertBookingOperator,
  assertCommittedEntitlement,
} from '../bookings/services/booking-operation-policy';
import { PropertyClockService } from '../property-settings/property-clock.service';
import { PropertySettingsService } from '../property-settings/property-settings.service';
import { Room } from '../rooms/entities/room.entity';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import {
  AmendmentHoldItem,
  BookingAmendment,
  BookingAmendmentStatus,
} from './entities/booking-amendment.entity';

export interface RequestBookingAmendmentDto {
  newCheckInAt: string;
  newCheckOutAt: string;
  newRoomTypeId?: string;
  newQuantity?: number;
  penaltyFeeVnd?: number;
  commandKey: string;
}

@Injectable()
export class BookingAmendmentsService {
  constructor(
    @InjectRepository(BookingAmendment)
    private readonly amendmentRepo: Repository<BookingAmendment>,
    @InjectRepository(AmendmentHoldItem)
    private readonly holdItemRepo: Repository<AmendmentHoldItem>,
    private readonly dataSource: DataSource,
    private readonly propertyClock: PropertyClockService,
    private readonly propertySettings: PropertySettingsService,
    @Optional() private readonly staffAvailabilityService?: StaffAvailabilityService,
    @Optional() private readonly coverageService?: BookingCoverageService,
  ) {}

  private async verifyActorCanAmend(
    em: any,
    booking: Booking,
    actor: { id: string; role: string },
  ): Promise<void> {
    if (String(booking.userId) === String(actor.id)) return;
    await assertBookingOperator(
      em.manager || em,
      booking,
      actor,
      'AMEND_BOOKING',
    );
  }

  async quoteAmendment(
    bookingId: string,
    dto: Omit<RequestBookingAmendmentDto, 'commandKey'>,
    actor: { id: string; role: string },
  ) {
    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);

    await this.verifyActorCanAmend(this.dataSource.manager, booking, actor);
    await assertCommittedEntitlement(this.dataSource.manager, booking);

    const settings = await this.propertySettings.getHotelSettings(booking.hotelId);
    const oldNights = this.propertyClock.enumerateStayNights(
      booking.checkInAt,
      booking.checkOutAt,
      settings.ianaTimezone,
    );
    const newNights = this.propertyClock.enumerateStayNights(
      dto.newCheckInAt,
      dto.newCheckOutAt,
      settings.ianaTimezone,
    );

    const bookingRooms = await this.dataSource.getRepository(BookingRoom).find({
      where: { bookingId: String(booking.id) },
    });
    const currentRoomTypeId = dto.newRoomTypeId || (bookingRooms[0]?.roomId ? String(bookingRooms[0].roomId) : '1');
    const room = await this.dataSource.getRepository(Room).findOne({
      where: { id: String(currentRoomTypeId) },
    });
    const pricePerNight = Number(room?.pricePerNight ?? 500000);
    const newQty = Number(dto.newQuantity || booking.requestedRoomCount || 1);

    const oldTotalVnd = Math.round(Number(booking.estimatedTotal || oldNights.length * pricePerNight));
    const penaltyFeeVnd = Math.round(Number(dto.penaltyFeeVnd || 0));
    const newTotalVnd = Math.round(newNights.length * pricePerNight * newQty + penaltyFeeVnd);
    const deltaVnd = newTotalVnd - oldTotalVnd;

    const quoteHash = createHash('sha256')
      .update(
        JSON.stringify({
          bookingId: booking.id,
          newNights,
          currentRoomTypeId,
          newQty,
          oldTotalVnd,
          newTotalVnd,
          deltaVnd,
        }),
      )
      .digest('hex');

    return {
      bookingId: String(booking.id),
      oldNights,
      newNights,
      oldTotalVnd,
      newTotalVnd,
      deltaVnd,
      penaltyFeeVnd,
      quoteHash,
    };
  }

  async createAmendment(
    bookingId: string,
    dto: RequestBookingAmendmentDto,
    actor: { id: string; role: string },
  ): Promise<BookingAmendment> {
    const cmdKey = (dto.commandKey || '').trim();
    if (!cmdKey) throw new BadRequestException('commandKey là bắt buộc khi tạo yêu cầu đổi lịch/phòng.');

    const existing = await this.amendmentRepo.findOne({
      where: { bookingId: String(bookingId), commandKey: cmdKey },
    });
    if (existing) return existing;

    const quote = await this.quoteAmendment(bookingId, dto, actor);

    return this.dataSource.transaction(async (em) => {
      const booking = await em
        .getRepository(Booking)
        .createQueryBuilder('b')
        .setLock('pessimistic_write')
        .where('b.id = :id', { id: String(bookingId) })
        .getOne();
      if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);

      await this.verifyActorCanAmend(em, booking, actor);
      await assertCommittedEntitlement(em, booking);

      const pendingCount = await em.getRepository(BookingAmendment).count({
        where: {
          bookingId: String(booking.id),
          status: In([
            BookingAmendmentStatus.QUOTED,
            BookingAmendmentStatus.AWAITING_CUSTOMER_CONSENT,
            BookingAmendmentStatus.AWAITING_SURCHARGE_PAYMENT,
            BookingAmendmentStatus.READY_TO_COMMIT,
          ]),
        },
      });
      if (pendingCount > 0) {
        throw new ConflictException(
          'CONCURRENT_AMENDMENT_IN_PROGRESS: Booking đang có một yêu cầu sửa đổi khác chưa hoàn tất.',
        );
      }

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      const initialStatus =
        quote.deltaVnd === 0
          ? BookingAmendmentStatus.READY_TO_COMMIT
          : BookingAmendmentStatus.AWAITING_CUSTOMER_CONSENT;

      const amendment = await em.getRepository(BookingAmendment).save(
        em.getRepository(BookingAmendment).create({
          bookingId: String(booking.id),
          hotelId: String(booking.hotelId),
          amendmentVersion: 1,
          amendmentType: dto.newRoomTypeId ? 'ROOM_AND_DATE_CHANGE' : 'DATE_CHANGE',
          status: initialStatus,
          previousSnapshotJson: {
            checkInAt: booking.checkInAt,
            checkOutAt: booking.checkOutAt,
            requestedRoomCount: booking.requestedRoomCount,
            estimatedTotal: booking.estimatedTotal,
          },
          requestedChangeJson: {
            newCheckInAt: dto.newCheckInAt,
            newCheckOutAt: dto.newCheckOutAt,
            newRoomTypeId: dto.newRoomTypeId || null,
            newQuantity: dto.newQuantity || booking.requestedRoomCount || 1,
          },
          quoteHash: quote.quoteHash,
          quoteExpiresAt: expiresAt,
          oldTotalVnd: quote.oldTotalVnd,
          newTotalVnd: quote.newTotalVnd,
          deltaVnd: quote.deltaVnd,
          penaltyFeeVnd: quote.penaltyFeeVnd,
          requestedBy: String(actor.id),
          commandKey: cmdKey,
          version: 1,
        }),
      );

      const oldNightSet = new Set(quote.oldNights);
      const addedNights = quote.newNights.filter((n) => !oldNightSet.has(n));
      for (const stayDate of addedNights) {
        await em.getRepository(AmendmentHoldItem).save(
          em.getRepository(AmendmentHoldItem).create({
            amendmentId: String(amendment.id),
            bookingId: String(booking.id),
            hotelId: String(booking.hotelId),
            roomTypeId: String(dto.newRoomTypeId || '1'),
            stayDate,
            deltaQuantity: Number(dto.newQuantity || booking.requestedRoomCount || 1),
            status: 'HELD',
            expiresAt,
          }),
        );
      }

      return amendment;
    });
  }

  async acceptAmendment(amendmentId: string, actor: { id: string; role: string }) {
    const amendment = await this.amendmentRepo.findOne({ where: { id: String(amendmentId) } });
    if (!amendment) throw new NotFoundException(`Amendment #${amendmentId} không tồn tại.`);

    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(amendment.bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${amendment.bookingId} không tồn tại.`);

    if (String(booking.userId) !== String(actor.id) && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ khách đặt phòng mới có quyền xác nhận đồng ý nghĩa vụ tiền sửa đổi.');
    }

    if (new Date(amendment.quoteExpiresAt).getTime() <= Date.now()) {
      amendment.status = BookingAmendmentStatus.EXPIRED;
      await this.amendmentRepo.save(amendment);
      throw new ConflictException('AMENDMENT_QUOTE_EXPIRED: Báo giá sửa đổi đã hết hạn TTL.');
    }

    amendment.customerConsentAt = new Date();
    if (Number(amendment.deltaVnd) > 0) {
      amendment.status = BookingAmendmentStatus.AWAITING_SURCHARGE_PAYMENT;
      amendment.version += 1;
      await this.amendmentRepo.save(amendment);
      return {
        amendment,
        paymentPurpose: 'AMENDMENT_SURCHARGE',
        payableAmountVnd: Number(amendment.deltaVnd),
      };
    }

    amendment.status = BookingAmendmentStatus.READY_TO_COMMIT;
    amendment.version += 1;
    await this.amendmentRepo.save(amendment);
    return this.commitAmendmentOnce(String(amendment.id));
  }

  async commitAmendmentOnce(
    amendmentId: string,
    paymentMeta?: { paymentTxnId?: string; verifiedAt?: Date },
  ): Promise<BookingAmendment> {
    return this.dataSource.transaction(async (em) => {
      const amendment = await em
        .getRepository(BookingAmendment)
        .createQueryBuilder('a')
        .setLock('pessimistic_write')
        .where('a.id = :id', { id: String(amendmentId) })
        .getOne();
      if (!amendment) throw new NotFoundException(`Amendment #${amendmentId} không tồn tại.`);
      if (amendment.status === BookingAmendmentStatus.COMMITTED) return amendment;

      const booking = await em
        .getRepository(Booking)
        .createQueryBuilder('b')
        .setLock('pessimistic_write')
        .where('b.id = :id', { id: String(amendment.bookingId) })
        .getOne();
      if (!booking) throw new NotFoundException(`Booking #${amendment.bookingId} không tồn tại.`);

      const now = paymentMeta?.verifiedAt || new Date();
      if (new Date(amendment.quoteExpiresAt).getTime() < now.getTime()) {
        amendment.status = BookingAmendmentStatus.RECONCILIATION_REQUIRED;
        amendment.paymentTxnId = paymentMeta?.paymentTxnId || amendment.paymentTxnId;
        amendment.version += 1;
        await em
          .getRepository(AmendmentHoldItem)
          .update({ amendmentId: String(amendment.id) }, { status: 'EXPIRED' });
        return em.getRepository(BookingAmendment).save(amendment);
      }

      const reqChange = amendment.requestedChangeJson as any;
      booking.checkInAt = new Date(reqChange.newCheckInAt);
      booking.checkOutAt = new Date(reqChange.newCheckOutAt);
      if (reqChange.newQuantity) {
        booking.requestedRoomCount = Number(reqChange.newQuantity);
      }
      booking.estimatedTotal = String(amendment.newTotalVnd);
      await em.getRepository(Booking).save(booking);

      amendment.status = BookingAmendmentStatus.COMMITTED;
      amendment.paymentTxnId = paymentMeta?.paymentTxnId || amendment.paymentTxnId;
      amendment.committedAt = new Date();
      amendment.version += 1;

      await em
        .getRepository(AmendmentHoldItem)
        .update({ amendmentId: String(amendment.id) }, { status: 'COMMITTED' });

      return em.getRepository(BookingAmendment).save(amendment);
    });
  }
}
