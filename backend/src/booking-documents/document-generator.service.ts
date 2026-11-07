import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { Booking } from '../bookings/entities/booking.entity';
import { assertBookingOperator } from '../bookings/services/booking-operation-policy';
import { FolioService } from '../folio/folio.service';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import {
  BookingDocument,
  BookingDocumentType,
} from './entities/booking-document.entity';

@Injectable()
export class DocumentGeneratorService {
  constructor(
    @InjectRepository(BookingDocument)
    private readonly docRepo: Repository<BookingDocument>,
    private readonly dataSource: DataSource,
    private readonly folioService: FolioService,
    @Optional() private readonly staffAvailabilityService?: StaffAvailabilityService,
    @Optional() private readonly coverageService?: BookingCoverageService,
  ) {}

  private async verifyAccess(booking: Booking, actor: { id: string; role: string }): Promise<void> {
    if (String(booking.userId) === String(actor.id) || actor.role === 'ADMIN') return;
    await assertBookingOperator(
      this.dataSource.manager,
      booking,
      actor,
      'BOOKING_DOCUMENT',
    );
  }

  async listDocuments(bookingId: string, actor: { id: string; role: string }): Promise<BookingDocument[]> {
    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);
    await this.verifyAccess(booking, actor);
    return this.docRepo.find({
      where: { bookingId: String(bookingId) },
      order: { version: 'ASC', id: 'ASC' },
    });
  }

  async issueDocument(
    bookingId: string,
    dto: {
      type: BookingDocumentType;
      amountVnd?: number;
      buyerInfoJson?: Record<string, any>;
      commandId: string;
    },
    actor: { id: string; role: string },
  ): Promise<BookingDocument> {
    const cmdId = (dto.commandId || '').trim();
    if (!cmdId) throw new BadRequestException('commandId là bắt buộc khi phát hành chứng từ.');

    const existingCmd = await this.docRepo.findOne({ where: { commandId: cmdId } });
    if (existingCmd) return existingCmd;

    const booking = await this.dataSource.getRepository(Booking).findOne({
      where: { id: String(bookingId) },
    });
    if (!booking) throw new NotFoundException(`Booking #${bookingId} không tồn tại.`);
    await this.verifyAccess(booking, actor);

    const folio = await this.folioService.getOrCreateFolio(booking.id, booking.hotelId);
    const existingDocsOfType = await this.docRepo.find({
      where: { bookingId: String(booking.id), type: dto.type },
      order: { version: 'DESC' },
    });
    const nextVersion = existingDocsOfType.length > 0 ? Number(existingDocsOfType[0].version) + 1 : 1;
    const amountVnd = Math.round(
      Number(dto.amountVnd ?? folio.totalPaymentVnd ?? booking.estimatedTotal ?? 0),
    );

    const snapshotPayload = {
      bookingId: booking.id,
      folioId: folio.id,
      type: dto.type,
      version: nextVersion,
      amountVnd,
      folioBalances: {
        totalDebitVnd: folio.totalDebitVnd,
        totalPaymentVnd: folio.totalPaymentVnd,
        totalCreditVnd: folio.totalCreditVnd,
        totalRefundVnd: folio.totalRefundVnd,
        outstandingBalanceVnd: folio.outstandingBalanceVnd,
      },
      disclaimer: 'Chứng từ biên nhận / bảng kê nội bộ Traveleke (không thay thế Hóa đơn GTGT điện tử cơ quan thuế).',
    };

    const sha256 = createHash('sha256').update(JSON.stringify(snapshotPayload)).digest('hex');
    const docNumber = `DOC-${booking.hotelId}-${booking.id}-${dto.type.slice(0, 3)}-V${nextVersion}`;

    return this.docRepo.save(
      this.docRepo.create({
        bookingId: String(booking.id),
        folioId: String(folio.id),
        hotelId: String(booking.hotelId),
        documentNumber: docNumber,
        type: dto.type,
        status: 'ISSUED',
        version: nextVersion,
        amountVnd,
        buyerInfoJson: dto.buyerInfoJson || null,
        sourceFolioSnapshot: snapshotPayload,
        storageKey: `private/bookings/${booking.id}/${docNumber}.pdf`,
        sha256,
        issuedBy: String(actor.id),
        commandId: cmdId,
      }),
    );
  }
}
