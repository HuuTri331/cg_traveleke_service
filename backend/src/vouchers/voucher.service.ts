import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BookingPriceQuote } from '../promotions/entities/booking-price-quote.entity';
import { VoucherCode, VoucherReservation } from './entities/voucher-code.entity';

@Injectable()
export class VoucherService {
  constructor(
    @InjectRepository(VoucherCode) private readonly voucherRepo: Repository<VoucherCode>,
    @InjectRepository(VoucherReservation) private readonly reservationRepo: Repository<VoucherReservation>,
    private readonly dataSource: DataSource,
  ) {}

  async applyVoucherToQuote(params: {
    quoteId: string;
    code: string;
    userId: string;
    now?: Date;
  }) {
    const normalizedCode = (params.code || '').trim().toUpperCase();
    if (!normalizedCode) throw new BadRequestException('Mã voucher không được để trống.');
    const now = params.now || new Date();

    return this.dataSource.transaction(async (em) => {
      const quote = await em
        .getRepository(BookingPriceQuote)
        .createQueryBuilder('q')
        .setLock('pessimistic_write')
        .where('q.id = :id', { id: String(params.quoteId) })
        .getOne();
      if (!quote) throw new NotFoundException(`Quote #${params.quoteId} không tồn tại.`);
      if (String(quote.userId) !== String(params.userId)) {
        throw new ForbiddenException('Bạn không sở hữu báo giá (quote) này.');
      }
      if (new Date(quote.expiresAt).getTime() <= now.getTime()) {
        throw new ConflictException('Báo giá đã hết hạn, vui lòng tạo lại báo giá mới.');
      }

      const existingRes = await em.getRepository(VoucherReservation).findOne({
        where: { quoteId: String(quote.id), code: normalizedCode },
      });
      if (existingRes && existingRes.status === 'RESERVED') {
        return { quote, reservation: existingRes };
      }

      const voucher = await em
        .getRepository(VoucherCode)
        .createQueryBuilder('v')
        .setLock('pessimistic_write')
        .where('v.hotel_id = :hotelId AND v.code = :code', {
          hotelId: String(quote.hotelId),
          code: normalizedCode,
        })
        .getOne();

      if (!voucher || voucher.status !== 'ACTIVE') {
        throw new NotFoundException(`Mã voucher "${normalizedCode}" không tồn tại tại khách sạn này.`);
      }
      if (now < new Date(voucher.validFrom) || now > new Date(voucher.validTo)) {
        throw new BadRequestException(`Mã voucher "${normalizedCode}" nằm ngoài thời hạn sử dụng.`);
      }

      const hasCampaignDiscount = Number((quote as any).discountTotal ?? (quote as any).totalDiscount ?? 0) > 0;
      if (hasCampaignDiscount && !voucher.allowStackWithCampaign) {
        throw new ConflictException(
          `VOUCHER_STACKING_NOT_ALLOWED: Mã "${normalizedCode}" không áp dụng đồng thời với chương trình khuyến mãi đã chọn.`,
        );
      }

      const activeReservations = await em.getRepository(VoucherReservation).find({
        where: { voucherId: String(voucher.id), status: 'RESERVED' },
      });
      const unexpiredResCount = activeReservations.filter(
        (r) => new Date(r.expiresAt).getTime() > now.getTime(),
      ).length;

      if (Number(voucher.usedCount) + unexpiredResCount >= Number(voucher.maxUsesTotal)) {
        throw new ConflictException(`VOUCHER_QUOTA_EXHAUSTED: Mã "${normalizedCode}" đã hết lượt sử dụng.`);
      }

      const currentPayable = Math.round(Number(quote.payableTotal || 0));
      if (currentPayable < Number(voucher.minSpendVnd || 0)) {
        throw new BadRequestException(
          `Đơn đặt phòng chưa đạt giá trị tối thiểu ${voucher.minSpendVnd} VND để áp dụng mã "${normalizedCode}".`,
        );
      }

      let voucherDiscount =
        voucher.discountType === 'PERCENT'
          ? Math.round((currentPayable * Number(voucher.discountValue)) / 100)
          : Math.round(Number(voucher.discountValue));
      if (voucher.maxDiscountVnd !== null && voucher.maxDiscountVnd !== undefined) {
        voucherDiscount = Math.min(voucherDiscount, Math.round(Number(voucher.maxDiscountVnd)));
      }
      voucherDiscount = Math.min(currentPayable, Math.max(0, voucherDiscount));

      const newPayable = Math.max(0, currentPayable - voucherDiscount);
      (quote as any).discountTotal = Number((quote as any).discountTotal || 0) + voucherDiscount;
      quote.payableTotal = newPayable;
      quote.priceHash = createHash('sha256')
        .update(`${quote.priceHash}:VOUCHER:${normalizedCode}:${voucherDiscount}:${newPayable}`)
        .digest('hex');
      await em.getRepository(BookingPriceQuote).save(quote);

      const reservation = await em.getRepository(VoucherReservation).save(
        em.getRepository(VoucherReservation).create({
          voucherId: String(voucher.id),
          quoteId: String(quote.id),
          bookingId: null,
          userId: String(params.userId),
          code: normalizedCode,
          discountVnd: voucherDiscount,
          status: 'RESERVED',
          expiresAt: new Date(quote.expiresAt),
        }),
      );

      return { quote, reservation };
    });
  }

  async consumeVoucherOnce(bookingId: string, quoteId: string): Promise<boolean> {
    return this.dataSource.transaction(async (em) => {
      const res = await em.getRepository(VoucherReservation).findOne({
        where: { quoteId: String(quoteId) },
      });
      if (!res) return false;
      if (res.status === 'CONSUMED') return true;
      if (res.status !== 'RESERVED') return false;

      res.status = 'CONSUMED';
      res.bookingId = String(bookingId);
      res.consumedAt = new Date();
      await em.getRepository(VoucherReservation).save(res);

      await em
        .getRepository(VoucherCode)
        .increment({ id: String(res.voucherId) }, 'usedCount', 1);
      return true;
    });
  }
}
