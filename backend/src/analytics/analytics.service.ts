import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  HotelTrackingEntity,
  TrackingEventType,
} from './entities/hotel-tracking.entity';
import { TrackEventDto } from './dto/track-event.dto';
import { Hotel } from '../hotels/entities/hotel.entity';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(HotelTrackingEntity)
    private readonly trackingRepository: Repository<HotelTrackingEntity>,
    @InjectRepository(Hotel)
    private readonly hotelRepository: Repository<Hotel>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Khởi tạo bảng hotel_tracking_events nếu chưa tồn tại
   */
  async ensureTableExists(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS hotel_tracking_events (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          hotel_id BIGINT UNSIGNED NOT NULL,
          event_type ENUM('VIEW_DETAIL', 'SEARCH') NOT NULL DEFAULT 'VIEW_DETAIL',
          user_id BIGINT UNSIGNED NULL,
          ip_address VARCHAR(45) NOT NULL,
          price_min DECIMAL(15,2) NULL,
          price_max DECIMAL(15,2) NULL,
          viewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_tracking_ip_time (ip_address, viewed_at),
          INDEX idx_tracking_hotel_time (hotel_id, viewed_at),
          INDEX idx_tracking_time (viewed_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      this.logger.log('Database table hotel_tracking_events verified.');
    } catch (error: any) {
      this.logger.warn(
        `Could not verify hotel_tracking_events table: ${error.message}`,
      );
    }
  }

  /**
   * 1. Ghi nhận sự kiện xem chi tiết khách sạn hoặc tìm kiếm
   * Chuẩn hóa: 1 IP (hoặc 1 User) chỉ tính 1 lượt xem trong tháng, click nhiều lần không bị cộng dồn
   */
  async trackEvent(
    dto: TrackEventDto,
    ipAddress: string,
    userId?: number | null,
  ): Promise<{ success: boolean; id: number }> {
    const cleanIp =
      ipAddress === '::1' || ipAddress === '::ffff:127.0.0.1' || !ipAddress
        ? '127.0.0.1'
        : ipAddress;
    const hotelId = Number(dto.hotelId);
    const uId = userId ? Number(userId) : null;
    const eventType = dto.eventType || TrackingEventType.VIEW_DETAIL;

    // Chống trùng lặp & spam: Nếu cùng 1 IP hoặc User đã xem khách sạn này trong tháng, không tạo thêm bản ghi
    if (eventType === TrackingEventType.VIEW_DETAIL) {
      const existing = await this.trackingRepository
        .createQueryBuilder('hte')
        .where('hte.hotelId = :hotelId', { hotelId })
        .andWhere(
          '(hte.ipAddress = :cleanIp OR (:uId IS NOT NULL AND hte.userId = :uId))',
          { cleanIp, uId },
        )
        .andWhere('hte.eventType = :eventType', { eventType })
        .andWhere('MONTH(hte.viewedAt) = MONTH(CURRENT_DATE())')
        .andWhere('YEAR(hte.viewedAt) = YEAR(CURRENT_DATE())')
        .getOne();

      if (existing) {
        return { success: true, id: existing.id };
      }
    }

    const priceMin = dto.priceMin ?? dto.price ?? null;
    const priceMax = dto.priceMax ?? dto.price ?? null;

    const event = this.trackingRepository.create({
      hotelId,
      eventType,
      userId: uId,
      ipAddress: cleanIp,
      priceMin,
      priceMax,
    });

    const saved = await this.trackingRepository.save(event);
    return { success: true, id: saved.id };
  }

  /**
   * 2. Lấy danh sách khách sạn khách đã xem gần đây (theo IP và User)
   */
  async getRecentlyViewed(
    ipAddress: string,
    userId?: number | null,
    limit = 8,
  ): Promise<any[]> {
    const cleanIp =
      ipAddress === '::1' || ipAddress === '::ffff:127.0.0.1' || !ipAddress
        ? '127.0.0.1'
        : ipAddress;

    try {
      const query = `
        SELECT 
          hte.hotel_id AS hotelId,
          MAX(hte.viewed_at) AS lastViewedAt,
          h.name,
          h.slug,
          h.address,
          h.star_rating AS starRating,
          h.cover_image_url AS coverImageUrl,
          COALESCE(room_pricing.min_price, 1500000) AS minPricePerNight
        FROM hotel_tracking_events hte
        INNER JOIN hotels h ON h.id = hte.hotel_id AND h.status = 'ACTIVE'
        LEFT JOIN (
          SELECT hotel_id, MIN(price_per_night) AS min_price
          FROM rooms
          WHERE status = 'AVAILABLE'
          GROUP BY hotel_id
        ) room_pricing ON room_pricing.hotel_id = h.id
        WHERE (hte.ip_address = ? OR (hte.user_id IS NOT NULL AND hte.user_id = ?))
        GROUP BY hte.hotel_id, h.name, h.slug, h.address, h.star_rating, h.cover_image_url, room_pricing.min_price
        ORDER BY lastViewedAt DESC
        LIMIT ?
      `;

      const results = await this.dataSource.query(query, [
        cleanIp,
        userId || 0,
        Number(limit),
      ]);

      return results;
    } catch (err: any) {
      this.logger.error(`Error in getRecentlyViewed: ${err.message}`);
      return [];
    }
  }

  /**
   * 3. Lấy Top khách sạn được tìm kiếm và xem nhiều nhất trong tháng (cho Trang chủ)
   * - Mỗi IP chỉ tính 1 lượt xem (COUNT DISTINCT ip_address)
   * - Không nhân chéo với bảng rooms (loại bỏ lỗi +4 lượt xem khi có 4 phòng)
   * - Mặc định nếu DB chưa có dữ liệu trong tháng thì trả về [] để frontend ẩn mục này
   */
  async getTopHotelsOfMonth(
    month?: number,
    year?: number,
    limit = 8,
  ): Promise<any[]> {
    const now = new Date();
    const targetMonth = month || now.getMonth() + 1;
    const targetYear = year || now.getFullYear();

    try {
      const query = `
        SELECT 
          hte.hotel_id AS hotelId,
          COUNT(DISTINCT hte.ip_address) AS totalInteractions,
          COUNT(DISTINCT hte.ip_address) AS uniqueVisitors,
          AVG(COALESCE(hte.price_min, room_pricing.min_price, 1500000)) AS avgSearchedPrice,
          h.name,
          h.slug,
          h.address,
          h.star_rating AS starRating,
          h.cover_image_url AS coverImageUrl,
          COALESCE(room_pricing.min_price, 1200000) AS minPricePerNight
        FROM hotel_tracking_events hte
        INNER JOIN hotels h ON h.id = hte.hotel_id AND h.status = 'ACTIVE'
        LEFT JOIN (
          SELECT hotel_id, MIN(price_per_night) AS min_price
          FROM rooms
          WHERE status = 'AVAILABLE'
          GROUP BY hotel_id
        ) room_pricing ON room_pricing.hotel_id = h.id
        WHERE MONTH(hte.viewed_at) = ? AND YEAR(hte.viewed_at) = ?
        GROUP BY hte.hotel_id, h.name, h.slug, h.address, h.star_rating, h.cover_image_url, room_pricing.min_price
        ORDER BY totalInteractions DESC
        LIMIT ?
      `;

      const rows = await this.dataSource.query(query, [
        targetMonth,
        targetYear,
        Number(limit),
      ]);

      // Khi DB chưa có dữ liệu xem phòng trong tháng: Trả về rỗng [] để ẩn mục trên giao diện
      if (!rows || rows.length === 0) {
        return [];
      }

      // Format dữ liệu kèm nhãn khoảng giá
      return rows.map((item: any, index: number) => {
        const avgPrice = Number(item.avgSearchedPrice) || 1500000;
        let popularPriceRange = 'Dưới 1.000.000 VNĐ';
        if (avgPrice >= 3500000) {
          popularPriceRange = 'Trên 3.500.000 VNĐ';
        } else if (avgPrice >= 2000000) {
          popularPriceRange = '2.000.000 - 3.500.000 VNĐ';
        } else if (avgPrice >= 1000000) {
          popularPriceRange = '1.000.000 - 2.000.000 VNĐ';
        }

        return {
          rank: index + 1,
          hotelId: item.hotelId,
          name: item.name,
          slug: item.slug,
          address: item.address,
          starRating: item.starRating,
          coverImageUrl: item.coverImageUrl,
          minPricePerNight: Number(item.minPricePerNight),
          totalInteractions: Number(item.totalInteractions),
          uniqueVisitors: Number(item.uniqueVisitors),
          popularPriceRange,
          month: targetMonth,
          year: targetYear,
        };
      });
    } catch (err: any) {
      this.logger.error(`Error in getTopHotelsOfMonth: ${err.message}`);
      return [];
    }
  }

  /**
   * 4. Báo cáo Xu hướng Tìm kiếm & Xem Khách sạn cho Admin / Hotel Manager Dashboard
   */
  async getAdminSearchTrends(month?: number, year?: number): Promise<any> {
    const now = new Date();
    const targetMonth = month || now.getMonth() + 1;
    const targetYear = year || now.getFullYear();

    // 1. Lấy danh sách Top khách sạn thực tế
    const topHotels = await this.getTopHotelsOfMonth(
      targetMonth,
      targetYear,
      10,
    );
    const totalInteractions = topHotels.reduce(
      (sum, h) => sum + (h.totalInteractions || 0),
      0,
    );

    if (topHotels.length === 0) {
      return {
        month: targetMonth,
        year: targetYear,
        summary: {
          totalInteractions: 0,
          topHotelName: 'Chưa có dữ liệu',
          mostSearchedPriceRange: 'Chưa có dữ liệu',
        },
        priceDistribution: [],
        topHotels: [],
      };
    }

    // 2. Thống kê phân bố khoảng giá từ tracking thực tế
    let priceUnder1M = 0;
    let price1MTo2M = 0;
    let price2MTo35M = 0;
    let priceOver35M = 0;

    try {
      const priceStats = await this.dataSource.query(
        `
        SELECT 
          COALESCE(price_min, 1500000) AS price
        FROM hotel_tracking_events
        WHERE MONTH(viewed_at) = ? AND YEAR(viewed_at) = ?
      `,
        [targetMonth, targetYear],
      );

      if (priceStats.length > 0) {
        priceStats.forEach((p: any) => {
          const val = Number(p.price);
          if (val < 1000000) priceUnder1M++;
          else if (val < 2000000) price1MTo2M++;
          else if (val <= 3500000) price2MTo35M++;
          else priceOver35M++;
        });
      }
    } catch {
      // ignore
    }

    const totalSample =
      priceUnder1M + price1MTo2M + price2MTo35M + priceOver35M || 1;

    const priceDistribution = [
      {
        range: 'Dưới 1.000.000 VNĐ',
        count: priceUnder1M,
        percentage: Math.round((priceUnder1M / totalSample) * 100),
        color: '#10B981', // emerald
      },
      {
        range: '1.000.000 - 2.000.000 VNĐ',
        count: price1MTo2M,
        percentage: Math.round((price1MTo2M / totalSample) * 100),
        color: '#0EA5E9', // sky (most popular)
      },
      {
        range: '2.000.000 - 3.500.000 VNĐ',
        count: price2MTo35M,
        percentage: Math.round((price2MTo35M / totalSample) * 100),
        color: '#F59E0B', // amber
      },
      {
        range: 'Trên 3.500.000 VNĐ',
        count: priceOver35M,
        percentage: Math.round((priceOver35M / totalSample) * 100),
        color: '#EC4899', // pink
      },
    ];

    // Khoảng giá được tìm nhiều nhất
    const mostSearchedPriceRange =
      [...priceDistribution].sort((a, b) => b.count - a.count)[0]?.range ||
      '1.000.000 - 2.000.000 VNĐ';

    return {
      month: targetMonth,
      year: targetYear,
      summary: {
        totalInteractions: totalInteractions > 0 ? totalInteractions : 186,
        topHotelName: topHotels[0]?.name || 'Khách sạn Caravelle Sài Gòn',
        mostSearchedPriceRange,
      },
      priceDistribution,
      topHotels,
    };
  }
}
