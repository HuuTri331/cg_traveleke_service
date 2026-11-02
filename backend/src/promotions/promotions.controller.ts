import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PromotionsService } from './promotions.service';
import {
  AcceptConsentDto,
  CalculateQuoteDto,
  CreatePromotionCampaignDto,
  RedeemBenefitDto,
  SettleRefundDto,
} from './dto/promotions.dto';

@Controller(['promotions', 'pricing-promotions'])
@UseGuards(JwtAuthGuard, RolesGuard)
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get('hotels/:hotelId/active')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async getPublicActive(@Param('hotelId') hotelId: string) {
    return await this.promotionsService.getPublicActiveCampaigns(hotelId);
  }

  @Post('hotels/:hotelId/campaigns')
  @Roles('ADMIN', 'EMPLOYEE')
  async createHotelCampaign(
    @Param('hotelId') hotelId: string,
    @CurrentUser() user: { id: string; role: string },
    @Body() dto: CreatePromotionCampaignDto,
  ) {
    dto.hotelId = hotelId;
    return await this.promotionsService.createCampaign(user, dto);
  }

  @Get('hotels/:hotelId/campaigns')
  @Roles('ADMIN', 'EMPLOYEE')
  async listHotelCampaigns(
    @Param('hotelId') hotelId: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.promotionsService.getHotelCampaigns(hotelId, user);
  }

  @Post('campaigns/:id/preview')
  @Roles('ADMIN', 'EMPLOYEE')
  async previewCampaign(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.promotionsService.previewCampaign(user, id);
  }

  @Post('campaigns/:id/publish')
  @Roles('ADMIN', 'EMPLOYEE')
  async publishCampaign(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.promotionsService.approveAndActivateCampaign(user, id);
  }

  @Get('quotes/:quoteId')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async getQuote(
    @Param('quoteId') quoteId: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.promotionsService.getQuoteById(quoteId, user);
  }

  @Get('bookings/:bookingId/benefits')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async getBookingBenefits(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.promotionsService.getBookingBenefitsAndFolio(bookingId, user);
  }

  @Get('bookings/:bookingId/folio')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async getBookingFolioPlural(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.promotionsService.getBookingBenefitsAndFolio(bookingId, user);
  }

  @Get('hotels/:hotelId/reconciliation')
  @Roles('ADMIN', 'EMPLOYEE')
  async getReconciliation(
    @Param('hotelId') hotelId: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.promotionsService.getHotelReconciliationReport(user, hotelId);
  }

  @Post('campaigns')
  @Roles('ADMIN', 'EMPLOYEE')
  async createCampaign(
    @CurrentUser() user: { id: string; role: string },
    @Body() dto: CreatePromotionCampaignDto,
  ) {
    return await this.promotionsService.createCampaign(user, dto);
  }

  @Post('campaigns/:id/activate')
  @Roles('ADMIN', 'EMPLOYEE')
  async activateCampaign(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.promotionsService.approveAndActivateCampaign(user, id);
  }

  @Post('campaigns/:id/pause')
  @Roles('ADMIN', 'EMPLOYEE')
  async pauseCampaign(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
    @Body('reason') reason?: string,
  ) {
    return await this.promotionsService.pauseCampaign(user, id, reason);
  }

  // PP-P0-05 / PIT-06: Restrict internal campaign list to ADMIN / hotel EMPLOYEE (never CUSTOMER)
  @Get('hotel/:hotelId/campaigns')
  @Roles('ADMIN', 'EMPLOYEE')
  async getHotelCampaigns(
    @Param('hotelId') hotelId: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.promotionsService.getHotelCampaigns(hotelId, user);
  }

  @Post('quotes')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async calculateQuote(
    @Body() dto: CalculateQuoteDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.promotionsService.calculateAndSaveQuote(dto, user);
  }

  @Post('service-quotes')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async calculateServiceQuote(
    @Body()
    dto: {
      hotelId: string;
      serviceId: string;
      baseUnitPrice: number;
      quantity?: number;
      usageAt?: string;
    },
  ) {
    return await this.promotionsService.quoteServiceItem(dto);
  }

  @Post('booking/:bookingId/evaluate-benefits')
  @Roles('ADMIN', 'EMPLOYEE')
  async evaluateBookingBenefits(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.promotionsService.evaluateExistingBookingBenefits(bookingId, user);
  }

  @Post('hotel/:hotelId/evaluate-benefits-batch')
  @Roles('ADMIN', 'EMPLOYEE')
  async evaluateHotelBenefitsBatch(
    @Param('hotelId') hotelId: string,
    @CurrentUser() user: { id: string; role: string },
    @Query('batchSize') batchSize?: string,
    @Query('afterBookingId') afterBookingId?: string,
  ) {
    return await this.promotionsService.evaluateExistingBookingsForHotel(
      hotelId,
      user,
      batchSize ? Number(batchSize) : 50,
      afterBookingId || '0',
    );
  }

  @Get('booking/:bookingId/folio')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async getBookingFolio(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.promotionsService.getBookingBenefitsAndFolio(bookingId, user);
  }

  @Post('booking/:bookingId/accounts/:accountId/accept-credit')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async acceptRoomAdjustmentAsCredit(
    @Param('bookingId') bookingId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: { id: string; role: string },
    @Body() dto?: AcceptConsentDto,
  ) {
    return await this.promotionsService.acceptRoomAdjustmentAsCredit(bookingId, accountId, user, dto);
  }

  @Post('redeem')
  @Roles('ADMIN', 'EMPLOYEE')
  async redeemBenefit(
    @Body() dto: RedeemBenefitDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.promotionsService.redeemBenefitForService(user, dto);
  }

  @Post('booking/:bookingId/service/:serviceRequestId/reverse')
  @Roles('ADMIN', 'EMPLOYEE')
  async reverseRedemption(
    @Param('bookingId') bookingId: string,
    @Param('serviceRequestId') serviceRequestId: string,
    @CurrentUser() user: { id: string; role: string },
    @Body('reason') reason?: string,
  ) {
    return await this.promotionsService.reverseServiceRedemption(user, bookingId, serviceRequestId, reason);
  }

  @Post('booking/:bookingId/accounts/:accountId/settle-refund')
  @Roles('ADMIN', 'EMPLOYEE')
  async settleRefund(
    @Param('bookingId') bookingId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: { id: string; role: string },
    @Body() body?: SettleRefundDto,
  ) {
    return await this.promotionsService.settleRemainingRefundAtCheckout(
      user,
      bookingId,
      accountId,
      body?.idempotencyKey || `settle_${bookingId}_${accountId}`,
      body?.reason,
      body,
    );
  }

  @Post('refund-intents/:intentId/confirm')
  @Roles('ADMIN', 'EMPLOYEE')
  async confirmRefundIntent(
    @Param('intentId') intentId: string,
    @CurrentUser() user: { id: string; role: string },
    @Body() body: { providerRef?: string; payoutReceiptRef?: string },
  ) {
    return await this.promotionsService.confirmRefundIntentSettlement(user, intentId, body);
  }
}
