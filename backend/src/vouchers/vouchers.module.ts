import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingPriceQuote } from '../promotions/entities/booking-price-quote.entity';
import { VoucherCode, VoucherReservation } from './entities/voucher-code.entity';
import { VoucherController } from './voucher.controller';
import { VoucherService } from './voucher.service';

@Module({
  imports: [TypeOrmModule.forFeature([VoucherCode, VoucherReservation, BookingPriceQuote])],
  controllers: [VoucherController],
  providers: [VoucherService],
  exports: [VoucherService],
})
export class VouchersModule {}
