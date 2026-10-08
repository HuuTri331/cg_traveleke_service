import {
  BadGatewayException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  Hotel,
  HotelStatus,
} from '../hotels/entities/hotel.entity';

import {
  Room,
  RoomStatus,
} from '../rooms/entities/room.entity';

export interface HotelSearchIntent {
  intent: 'hotel_search' | 'general';
  location: string | null;
  starRating: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  adults: number | null;
  children: number | null;
  checkIn: string | null;
  checkOut: string | null;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly configService: ConfigService,

    @InjectRepository(Room)
    private readonly roomsRepository: Repository<Room>,
  ) {}

  /**
   * API chính của Chatbox.
   *
   * Luồng:
   * User message
   * -> Qwen phân tích
   * -> Backend lấy filter
   * -> MySQL tìm dữ liệu thật
   * -> Backend trả kết quả
   */
  async chat(message: string) {
    // 1. Dùng AI để hiểu yêu cầu người dùng
    const filters =
      await this.parseHotelSearchIntent(message);

    // 2. Không phải yêu cầu tìm khách sạn/phòng
    if (filters.intent !== 'hotel_search') {
      return {
        success: true,
        userMessage: message,
        filters,
        reply:
          'Tôi có thể hỗ trợ bạn tìm khách sạn và phòng phù hợp.',
        results: [],
      };
    }

    // 3. Kiểm tra cặp ngày nếu người dùng có nhập
    if (
      (filters.checkIn && !filters.checkOut) ||
      (!filters.checkIn && filters.checkOut)
    ) {
      return {
        success: true,
        userMessage: message,
        filters,
        reply:
          'Bạn vui lòng cung cấp đầy đủ ngày nhận phòng và ngày trả phòng.',
        results: [],
      };
    }

    // 4. Tìm dữ liệu thật trong MySQL
    const results =
      await this.searchHotels(filters);

    // 5. Trả kết quả
    return {
      success: true,
      userMessage: message,
      filters,
      reply:
        results.length > 0
          ? filters.checkIn && filters.checkOut
            ? `Tìm thấy ${results.length} phòng còn trống phù hợp trong khoảng ${filters.checkIn} đến ${filters.checkOut}.`
            : `Tìm thấy ${results.length} phòng phù hợp.`
          : filters.checkIn && filters.checkOut
            ? 'Không tìm thấy phòng còn trống phù hợp trong khoảng thời gian đã chọn.'
            : 'Không tìm thấy khách sạn hoặc phòng phù hợp với yêu cầu.',
      results,
    };
  }

  /**
   * Chuẩn hóa chuỗi.
   *
   * Ví dụ:
   * Đà Nẵng -> da nang
   * Hà Nội -> ha noi
   * Sài Gòn -> sai gon
   */
  private normalizeText(
    value: string,
  ): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[.\-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Chuyển tên địa điểm người dùng nhập
   * về code đang có trong bảng locations.
   *
   * Database:
   * HCM -> TP. Hồ Chí Minh
   * HN  -> Hà Nội
   * DN  -> Đà Nẵng
   */
  private normalizeLocation(
    value: string,
  ): string {
    const normalized =
      this.normalizeText(value);

    const aliases: Record<
      string,
      string
    > = {
      // TP. Hồ Chí Minh
      hcm: 'HCM',
      tphcm: 'HCM',
      'tp hcm': 'HCM',
      'tp ho chi minh': 'HCM',
      'thanh pho ho chi minh': 'HCM',
      'ho chi minh': 'HCM',
      'sai gon': 'HCM',

      // Hà Nội
      hn: 'HN',
      'ha noi': 'HN',

      // Đà Nẵng
      dn: 'DN',
      'da nang': 'DN',
    };

    return (
      aliases[normalized] ??
      normalized
    );
  }

  /**
   * Kiểm tra chuỗi ngày YYYY-MM-DD.
   */
  private isValidDateString(
    value: string,
  ): boolean {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        value,
      )
    ) {
      return false;
    }

    const date = new Date(
      `${value}T00:00:00`,
    );

    return !Number.isNaN(
      date.getTime(),
    );
  }

  /**
   * Tìm khách sạn/phòng thật trong MySQL.
   *
   * Nếu có checkIn/checkOut:
   * remainingRooms =
   * totalRooms - số phòng bị booking trùng ngày.
   *
   * Booking giữ phòng:
   * - PENDING
   * - CONFIRMED
   * - CHECKED_IN
   */
  private async searchHotels(
    filters: HotelSearchIntent,
  ) {
    const qb =
      this.roomsRepository
        .createQueryBuilder('room')

        // Room -> Hotel
        .innerJoin(
          Hotel,
          'hotel',
          'hotel.id = room.hotel_id',
        )

        // Hotel -> Location
        .innerJoin(
          'locations',
          'location',
          'location.id = hotel.location_id',
        )

        // Dữ liệu trả về cho Chatbox
        .select([
          'hotel.id AS hotelId',
          'hotel.name AS hotelName',
          'hotel.star_rating AS starRating',
          'hotel.address AS address',
          'hotel.cover_image_url AS hotelImage',

          'location.id AS locationId',
          'location.code AS locationCode',
          'location.name AS locationName',

          'room.id AS roomId',
          'room.name AS roomName',
          'room.price_per_night AS pricePerNight',
          'room.max_adults AS maxAdults',
          'room.max_children AS maxChildren',
          'room.total_rooms AS totalRooms',
          'room.rating AS roomRating',
          'room.cover_image_url AS roomImage',
        ])

        // Không lấy dữ liệu soft delete
        .where(
          'hotel.deleted_at IS NULL',
        )
        .andWhere(
          'room.deleted_at IS NULL',
        )

        // Khách sạn phải ACTIVE
        .andWhere(
          'hotel.status = :hotelStatus',
          {
            hotelStatus:
              HotelStatus.ACTIVE,
          },
        )

        // Room phải AVAILABLE
        .andWhere(
          'room.status = :roomStatus',
          {
            roomStatus:
              RoomStatus.AVAILABLE,
          },
        );

    /**
     * LOCATION
     */
    if (filters.location) {
      const locationCode =
        this.normalizeLocation(
          filters.location,
        );

      qb.andWhere(
        `(
          location.code = :locationCode
          OR location.name LIKE :originalLocation
          OR hotel.address LIKE :originalLocation
        )`,
        {
          locationCode,
          originalLocation:
            `%${filters.location}%`,
        },
      );
    }

    /**
     * SỐ SAO
     */
    if (
      filters.starRating !== null
    ) {
      qb.andWhere(
        'hotel.star_rating = :starRating',
        {
          starRating:
            filters.starRating,
        },
      );
    }

    /**
     * GIÁ TỐI THIỂU
     */
    if (
      filters.minPrice !== null
    ) {
      qb.andWhere(
        'room.price_per_night >= :minPrice',
        {
          minPrice:
            filters.minPrice,
        },
      );
    }

    /**
     * GIÁ TỐI ĐA
     */
    if (
      filters.maxPrice !== null
    ) {
      qb.andWhere(
        'room.price_per_night <= :maxPrice',
        {
          maxPrice:
            filters.maxPrice,
        },
      );
    }

    /**
     * SỐ NGƯỜI LỚN
     */
    if (
      filters.adults !== null
    ) {
      qb.andWhere(
        'room.max_adults >= :adults',
        {
          adults:
            filters.adults,
        },
      );
    }

    /**
     * SỐ TRẺ EM
     */
    if (
      filters.children !== null
    ) {
      qb.andWhere(
        'room.max_children >= :children',
        {
          children:
            filters.children,
        },
      );
    }

    /**
     * AVAILABILITY THEO NGÀY
     */
    if (
      filters.checkIn &&
      filters.checkOut
    ) {
      if (
        !this.isValidDateString(
          filters.checkIn,
        ) ||
        !this.isValidDateString(
          filters.checkOut,
        )
      ) {
        return [];
      }

      /**
       * Theo dữ liệu hiện tại:
       * check-in  = 14:00
       * check-out = 12:00
       */
      const checkIn = new Date(
        `${filters.checkIn}T14:00:00`,
      );

      const checkOut = new Date(
        `${filters.checkOut}T12:00:00`,
      );

      if (checkOut <= checkIn) {
        return [];
      }

      /**
       * Tính tổng số phòng đã được giữ
       * trong khoảng thời gian yêu cầu.
       *
       * Overlap:
       *
       * booking.check_in_at < checkOut
       * AND
       * booking.check_out_at > checkIn
       */
      const bookedRoomsSubQuery =
        qb
          .subQuery()
          .select(
            'COALESCE(SUM(br.quantity), 0)',
          )
          .from(
            'booking_rooms',
            'br',
          )
          .innerJoin(
            'bookings',
            'b',
            'b.id = br.booking_id',
          )
          .where(
            'br.room_id = room.id',
          )
          .andWhere(
            `b.status IN (
              'PENDING',
              'CONFIRMED',
              'CHECKED_IN'
            )`,
          )
          .andWhere(
            'b.check_in_at < :checkOut',
          )
          .andWhere(
            'b.check_out_at > :checkIn',
          )
          .getQuery();

      /**
       * Chỉ lấy room còn ít nhất
       * 1 phòng trong khoảng ngày.
       */
      qb.andWhere(
        `room.total_rooms - (${bookedRoomsSubQuery}) > 0`,
      );

      /**
       * Trả số phòng thực tế còn lại.
       */
      qb.addSelect(
        `room.total_rooms - (${bookedRoomsSubQuery})`,
        'remainingRooms',
      );

      qb.setParameters({
        checkIn,
        checkOut,
      });
    } else {
      /**
       * Không có ngày:
       *
       * Không thể xác định booking overlap,
       * nên không khẳng định availability
       * theo khoảng thời gian.
       */
      qb.andWhere(
        'room.total_rooms > 0',
      );

      qb.addSelect(
        'room.total_rooms',
        'remainingRooms',
      );
    }

    // Phòng rẻ nhất lên trước
    qb.orderBy(
      'room.price_per_night',
      'ASC',
    );

    // Giới hạn kết quả Chatbox
    qb.limit(10);

    return qb.getRawMany();
  }

  /**
   * Gửi câu người dùng cho Qwen3 qua Ollama
   * và chuyển thành HotelSearchIntent.
   */
  private async parseHotelSearchIntent(
    message: string,
  ): Promise<HotelSearchIntent> {
    const ollamaUrl =
      this.configService.get<string>(
        'OLLAMA_URL',
      ) ??
      'http://localhost:11434';

    const model =
      this.configService.get<string>(
        'OLLAMA_MODEL',
      ) ?? 'qwen3:4b';

    const systemPrompt = `
Bạn là bộ phân tích yêu cầu tìm khách sạn cho hệ thống Traveleke.

Nhiệm vụ:
Chuyển câu tiếng Việt của người dùng thành JSON để backend tìm khách sạn.

Chỉ sử dụng 2 intent:
- hotel_search: người dùng muốn tìm khách sạn hoặc phòng.
- general: câu hỏi không liên quan đến tìm khách sạn/phòng.

JSON phải có đúng các trường:
{
  "intent": "hotel_search hoặc general",
  "location": null,
  "starRating": null,
  "minPrice": null,
  "maxPrice": null,
  "adults": null,
  "children": null,
  "checkIn": null,
  "checkOut": null
}

Quy tắc:
- location: tên địa điểm người dùng yêu cầu.
- starRating: số sao khách sạn.
- minPrice: giá tối thiểu mỗi đêm.
- maxPrice: giá tối đa mỗi đêm.
- adults: số người lớn.
- children: số trẻ em.
- checkIn: ngày nhận phòng, định dạng YYYY-MM-DD.
- checkOut: ngày trả phòng, định dạng YYYY-MM-DD.

Quy tắc về ngày:
- Chỉ lấy ngày nếu người dùng thực sự cung cấp ngày.
- Nếu không có ngày nhận phòng thì checkIn = null.
- Nếu không có ngày trả phòng thì checkOut = null.
- Không tự suy đoán ngày chưa được cung cấp.
- Ngày trả về phải có định dạng YYYY-MM-DD.
- Với câu "từ ngày A đến ngày B", A là checkIn và B là checkOut.

Ví dụ:
"từ 10/10/2026 đến 12/10/2026"

=> checkIn = "2026-10-10"
=> checkOut = "2026-10-12"

Quy đổi giá:
- "2 triệu" = 2000000.
- "1 triệu" = 1000000.
- "500 nghìn" = 500000.
- "500k" = 500000.

Ví dụ:
"dưới 2 triệu"
=> maxPrice = 2000000

"trên 1 triệu"
=> minPrice = 1000000

"từ 1 triệu đến 2 triệu"
=> minPrice = 1000000
=> maxPrice = 2000000

Ví dụ đầy đủ:

"Tìm khách sạn 5 sao ở Đà Nẵng từ 10/10/2026 đến 12/10/2026 dưới 3 triệu cho 2 người lớn và 1 trẻ em"

Kết quả:
{
  "intent": "hotel_search",
  "location": "Đà Nẵng",
  "starRating": 5,
  "minPrice": null,
  "maxPrice": 3000000,
  "adults": 2,
  "children": 1,
  "checkIn": "2026-10-10",
  "checkOut": "2026-10-12"
}

Quy tắc bắt buộc:
- Nếu người dùng không cung cấp thông tin thì trả null.
- Không tự suy đoán thông tin chưa được cung cấp.
- Không tự tạo khách sạn.
- Không tự tạo giá phòng.
- Không tự tạo địa điểm.
- Không tự tạo ngày.
- Không trả Markdown.
- Không giải thích.
- Chỉ trả một JSON object hợp lệ.
`.trim();

    try {
      const response =
        await fetch(
          `${ollamaUrl}/api/chat`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body: JSON.stringify({
              model,
              stream: false,
              format: 'json',

              messages: [
                {
                  role: 'system',
                  content:
                    systemPrompt,
                },
                {
                  role: 'user',
                  content: message,
                },
              ],
            }),
          },
        );

      if (!response.ok) {
        throw new Error(
          `Ollama returned HTTP ${response.status}`,
        );
      }

      const data =
        (await response.json()) as {
          message?: {
            content?: string;
          };
        };

      const content =
        data.message?.content;

      if (!content) {
        throw new Error(
          'Ollama không trả về nội dung.',
        );
      }

      const parsed =
        JSON.parse(
          content,
        ) as HotelSearchIntent;

      /**
       * Không tin trực tiếp dữ liệu AI.
       * Kiểm tra lại kiểu dữ liệu trước khi sử dụng.
       */
      return {
        intent:
          parsed.intent ===
          'hotel_search'
            ? 'hotel_search'
            : 'general',

        location:
          typeof parsed.location ===
          'string'
            ? parsed.location
            : null,

        starRating:
          typeof parsed.starRating ===
          'number'
            ? parsed.starRating
            : null,

        minPrice:
          typeof parsed.minPrice ===
          'number'
            ? parsed.minPrice
            : null,

        maxPrice:
          typeof parsed.maxPrice ===
          'number'
            ? parsed.maxPrice
            : null,

        adults:
          typeof parsed.adults ===
          'number'
            ? parsed.adults
            : null,

        children:
          typeof parsed.children ===
          'number'
            ? parsed.children
            : null,

        checkIn:
          typeof parsed.checkIn ===
          'string'
            ? parsed.checkIn
            : null,

        checkOut:
          typeof parsed.checkOut ===
          'string'
            ? parsed.checkOut
            : null,
      };
    } catch (error) {
      console.error(
        'Ollama error:',
        error,
      );

      throw new BadGatewayException(
        'Không thể kết nối tới AI local.',
      );
    }
  }
}