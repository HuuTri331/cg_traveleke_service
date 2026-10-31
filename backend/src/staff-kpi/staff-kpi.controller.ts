import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { KpiCalculationService } from './kpi-calculation.service';
import { RequestKpiAdjustmentDto, RecalculateKpiDto } from './dto/kpi.dto';

@Controller('staff-kpi')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaffKpiController {
  constructor(private readonly kpiService: KpiCalculationService) {}

  @Get('me')
  @Roles('ADMIN', 'EMPLOYEE')
  async getMyKpi(
    @CurrentUser() user: { id: string },
    @Query('hotelId') hotelId: string,
    @Query('period') period?: string,
  ) {
    const currentPeriod = period || new Date().toISOString().slice(0, 7);
    return await this.kpiService.getStaffPeriodScore(hotelId, user.id, currentPeriod);
  }

  @Get('hotels/:hotelId')
  @Roles('ADMIN', 'EMPLOYEE')
  async getHotelKpis(
    @Param('hotelId') hotelId: string,
    @Query('period') period?: string,
  ) {
    const currentPeriod = period || new Date().toISOString().slice(0, 7);
    return await this.kpiService.getHotelPeriodScores(hotelId, currentPeriod);
  }

  @Get('hotels/:hotelId/staff/:staffId')
  @Roles('ADMIN', 'EMPLOYEE')
  async getStaffKpi(
    @Param('hotelId') hotelId: string,
    @Param('staffId') staffId: string,
    @Query('period') period?: string,
  ) {
    const currentPeriod = period || new Date().toISOString().slice(0, 7);
    return await this.kpiService.getStaffPeriodScore(hotelId, staffId, currentPeriod);
  }

  @Post('periods/:period/recalculate')
  @Roles('ADMIN', 'EMPLOYEE')
  async recalculate(
    @Param('period') period: string,
    @Query('hotelId') hotelId: string,
    @Body() dto: RecalculateKpiDto,
  ) {
    if (dto.staffUserId) {
      return await this.kpiService.calculatePeriodScore(hotelId, dto.staffUserId, period);
    }
    return { message: 'Đã nhận yêu cầu tính toán lại' };
  }

  @Post('periods/:period/approve')
  @Roles('ADMIN', 'EMPLOYEE')
  async approvePeriod(
    @Param('period') period: string,
    @Query('hotelId') hotelId: string,
    @CurrentUser() user: { id: string },
    @Body('reviewNote') reviewNote?: string,
  ) {
    const count = await this.kpiService.approvePeriod(hotelId, period, user.id, reviewNote);
    return { message: `Đã phê duyệt ${count} bản ghi điểm KPI cho kỳ ${period}` };
  }

  @Post('adjustments')
  @Roles('ADMIN', 'EMPLOYEE')
  async requestAdjustment(
    @Query('hotelId') hotelId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: RequestKpiAdjustmentDto,
  ) {
    return await this.kpiService.requestAdjustment(hotelId, user.id, dto);
  }
}

