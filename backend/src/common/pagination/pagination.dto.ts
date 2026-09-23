import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Standard DTO cho query phân trang trong toàn hệ thống Traveleke
 * Tuân thủ chuẩn bảo mật:
 * 1. Luôn normalize dữ liệu từ client
 * 2. Chặn số âm (page >= 1, perPage >= 1)
 * 3. Chặn tấn công làm tràn RAM / quá tải CSDL (perPage tối đa 100)
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số trang (page) phải là số nguyên.' })
  @Min(1, { message: 'Số trang (page) tối thiểu là 1.' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số lượng mỗi trang (perPage) phải là số nguyên.' })
  @Min(1, { message: 'Số lượng mỗi trang (perPage) tối thiểu là 1.' })
  @Max(100, { message: 'Số lượng mỗi trang (perPage) tối đa là 100.' })
  perPage?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Giới hạn số lượng (limit) phải là số nguyên.' })
  @Min(1, { message: 'Giới hạn số lượng (limit) tối thiểu là 1.' })
  @Max(100, { message: 'Giới hạn số lượng (limit) tối đa là 100.' })
  limit?: number;
}
