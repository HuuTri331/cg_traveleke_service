import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { Booking } from '../bookings/entities/booking.entity';
import {
  assertBookingOperator,
  assertCommittedEntitlement,
} from '../bookings/services/booking-operation-policy';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import {
  BookingGuestOccupant,
  PrecheckinSubmission,
  PrecheckinToken,
} from './entities/precheckin.entity';

@Injectable()
export class PrecheckinService {
  constructor(
    @InjectRepository(PrecheckinSubmission)
    private readonly submissionRepo: Repository<PrecheckinSubmission>,
    @InjectRepository(PrecheckinToken)
    private readonly tokenRepo: Repository<PrecheckinToken>,
    @InjectRepository(BookingGuestOccupant)
    private readonly occupantRepo: Repository<BookingGuestOccupant>,
    private readonly dataSource: DataSource,
    @Optional() private readonly staffAvailabilityService?: StaffAvailabilityService,
    @Optional() private readonly coverageService?: BookingCoverageService,
  ) {}

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken.trim()).digest('hex');
  }

  async createInviteToken(bookingId: string, actor: { id: string; role: string }) {
    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);
    await assertCommittedEntitlement(this.dataSource.manager, booking);

    if (String(booking.userId) !== String(actor.id)) {
      await assertBookingOperator(
        this.dataSource.manager,
        booking,
        actor,
        'PRECHECKIN',
      );
    }

    const opaqueToken = `pci_${randomBytes(24).toString('hex')}`;
    const tokenHash = this.hashToken(opaqueToken);
    const expiresAt = new Date(new Date(booking.checkOutAt).getTime());

    await this.tokenRepo.save(
      this.tokenRepo.create({
        bookingId: String(booking.id),
        tokenHash,
        expiresAt,
      }),
    );

    return { bookingId: String(booking.id), opaqueToken, tokenHash, expiresAt };
  }

  async submitByToken(
    opaqueToken: string,
    dto: {
      eta?: string;
      arrivalTransport?: string;
      bedPreference?: string;
      specialRequests?: string;
      guestDataMinimal?: Record<string, any>;
      commandId?: string;
    },
  ): Promise<PrecheckinSubmission> {
    const tokenHash = this.hashToken(opaqueToken || '');
    const tokenRow = await this.tokenRepo.findOne({ where: { tokenHash } });
    if (!tokenRow || tokenRow.revokedAt) {
      throw new ForbiddenException('PRECHECKIN_TOKEN_INVALID: Mã liên kết Pre-check-in không hợp lệ hoặc đã bị thu hồi.');
    }
    if (new Date(tokenRow.expiresAt).getTime() <= Date.now()) {
      throw new ForbiddenException('PRECHECKIN_TOKEN_EXPIRED: Mã liên kết Pre-check-in đã hết hạn.');
    }

    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(tokenRow.bookingId) },
    });
    if (!booking) throw new NotFoundException('Booking không tồn tại.');

    if (dto.eta) {
      const etaDate = new Date(dto.eta);
      if (etaDate.getTime() >= new Date(booking.checkOutAt).getTime()) {
        throw new BadRequestException('ETA_AFTER_CHECKOUT: Giờ dự kiến đến (ETA) không được sau thời điểm trả phòng.');
      }
    }

    let sub = await this.submissionRepo.findOne({ where: { bookingId: String(booking.id) } });
    if (!sub) {
      sub = this.submissionRepo.create({
        bookingId: String(booking.id),
        hotelId: String(booking.hotelId),
        currentVersion: 1,
      });
    } else {
      sub.currentVersion += 1;
    }

    sub.status = 'SUBMITTED';
    sub.eta = dto.eta ? new Date(dto.eta) : sub.eta;
    sub.arrivalTransport = dto.arrivalTransport ?? sub.arrivalTransport;
    sub.bedPreference = dto.bedPreference ?? sub.bedPreference;
    sub.specialRequests = dto.specialRequests ?? sub.specialRequests;
    sub.guestDataMinimalJson = dto.guestDataMinimal ?? sub.guestDataMinimalJson;
    sub.submittedAt = new Date();
    sub.commandId = dto.commandId || null;

    tokenRow.usedAt = new Date();
    await this.tokenRepo.save(tokenRow);

    return this.submissionRepo.save(sub);
  }

  async reviewPrecheckin(
    bookingId: string,
    dto: { approved: boolean; note?: string },
    actor: { id: string; role: string },
  ): Promise<PrecheckinSubmission> {
    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);

    await assertBookingOperator(
      this.dataSource.manager,
      booking,
      actor,
      'PRECHECKIN_REVIEW',
    );

    const sub = await this.submissionRepo.findOne({ where: { bookingId: String(bookingId) } });
    if (!sub) throw new NotFoundException('Chưa có hồ sơ Pre-check-in cho booking này.');

    sub.status = dto.approved ? 'REVIEWED' : 'REJECTED';
    sub.reviewedBy = String(actor.id);
    sub.reviewedAt = new Date();
    sub.reviewNote = dto.note || null;
    sub.currentVersion += 1;
    return this.submissionRepo.save(sub);
  }

  async upsertOccupants(
    bookingId: string,
    dto: {
      occupants: Array<{
        fullName: string;
        contactRole?: 'BOOKER' | 'PAYER' | 'LEAD_GUEST' | 'OCCUPANT';
        isAdult?: boolean;
        childAge?: number;
        phone?: string;
        leadGuest?: boolean;
      }>;
      commandId: string;
      expectedVersion?: number;
    },
    actor: { id: string; role: string },
  ): Promise<BookingGuestOccupant[]> {
    if (!dto.commandId || !dto.commandId.trim()) {
      throw new BadRequestException('commandId là bắt buộc khi cập nhật danh sách khách lưu trú.');
    }
    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);

    if (String(booking.userId) !== String(actor.id)) {
      await assertBookingOperator(
        this.dataSource.manager,
        booking,
        actor,
        'OCCUPANT_UPDATE',
      );
    }

    const list = dto.occupants || [];
    if (list.length === 0) {
      throw new BadRequestException('Danh sách khách lưu trú không được rỗng.');
    }
    const maxCapacity = Math.max(Number(booking.totalGuests || 2), Number(booking.requestedRoomCount || 1) * 4);
    if (list.length > maxCapacity) {
      throw new BadRequestException(
        `OCCUPANT_CAPACITY_EXCEEDED: Số lượng người lưu trú (${list.length}) vượt quá sức chứa tối đa (${maxCapacity}).`,
      );
    }

    await this.occupantRepo.delete({ bookingId: String(booking.id) });
    const saved: BookingGuestOccupant[] = [];
    for (const item of list) {
      saved.push(
        await this.occupantRepo.save(
          this.occupantRepo.create({
            bookingId: String(booking.id),
            hotelId: String(booking.hotelId),
            contactRole: item.contactRole || (item.leadGuest ? 'LEAD_GUEST' : 'OCCUPANT'),
            fullName: item.fullName.trim(),
            isAdult: item.isAdult ?? true,
            childAge: item.childAge ?? null,
            phone: item.phone || null,
            leadGuest: Boolean(item.leadGuest),
            version: (dto.expectedVersion || 0) + 1,
          }),
        ),
      );
    }
    return saved;
  }
}
