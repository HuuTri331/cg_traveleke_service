import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import type { Request } from 'express';
import { AnalyticsService } from './analytics.service';
import { TrackEventDto } from './dto/track-event.dto';
import { RateLimiterGuard } from '../rate-limit/rate-limiter.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Trích xuất địa chỉ IP thực tế của Client (hỗ trợ reverse proxy / load balancer)
   */
  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    let ip = '';
    if (typeof forwarded === 'string') {
      ip = forwarded.split(',')[0].trim();
    } else if (Array.isArray(forwarded)) {
      ip = forwarded[0].trim();
    } else {
      ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    }

    if (ip === '::1' || ip === '::ffff:127.0.0.1' || !ip) {
      return '127.0.0.1';
    }
    return ip;
  }

  /**
   * POST /api/analytics/track
   * Ghi nhận lượt xem chi tiết khách sạn hoặc thao tác tìm kiếm
   */
  @Post('track')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimiterGuard)
  @RateLimit({
    slidingWindow: {
      limit: 120,
      windowMs: 60_000,
    },
  })
  async trackEvent(@Body() dto: TrackEventDto, @Req() req: Request) {
    const ip = this.getClientIp(req);
    const user = (req as any).user;
    const userId = user?.id ?? user?.sub ?? null;

    return this.analyticsService.trackEvent(dto, ip, userId);
  }

  /**
   * GET /api/analytics/recently-viewed
   * Lấy danh sách khách sạn khách đã xem gần đây theo IP / User
   */
  @Get('recently-viewed')
  async getRecentlyViewed(@Req() req: Request, @Query('limit') limit?: number) {
    const ip = this.getClientIp(req);
    const user = (req as any).user;
    const userId = user?.id ?? user?.sub ?? null;

    const hotels = await this.analyticsService.getRecentlyViewed(
      ip,
      userId,
      limit ? Number(limit) : 8,
    );

    return {
      success: true,
      data: hotels,
    };
  }

  /**
   * GET /api/analytics/top-hotels-of-month
   * Lấy Top khách sạn được xem và tìm kiếm nhiều nhất trong tháng (cho Trang chủ)
   */
  @Get('top-hotels-of-month')
  async getTopHotelsOfMonth(
    @Query('month') month?: number,
    @Query('year') year?: number,
    @Query('limit') limit?: number,
  ) {
    const hotels = await this.analyticsService.getTopHotelsOfMonth(
      month ? Number(month) : undefined,
      year ? Number(year) : undefined,
      limit ? Number(limit) : 8,
    );

    return {
      success: true,
      data: hotels,
    };
  }

  /**
   * GET /api/analytics/admin/search-trends
   * Báo cáo xu hướng tìm kiếm và khoảng giá được quan tâm cho Admin Dashboard
   */
  @Get('admin/search-trends')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  async getAdminSearchTrends(
    @Query('month') month?: number,
    @Query('year') year?: number,
  ) {
    const report = await this.analyticsService.getAdminSearchTrends(
      month ? Number(month) : undefined,
      year ? Number(year) : undefined,
    );

    return {
      success: true,
      data: report,
    };
  }
}
