export interface NormalizedPagination {
  page: number;
  limit: number;
  skip: number;
  perPage: number;
}

export interface PaginationMeta {
  // Legacy / Frontend compatible fields
  page: number;
  perPage: number;
  total: number;
  totalPages: number;

  // Enterprise Standard metadata (theo chuẩn tài liệu tối ưu Pagination TypeORM)
  totalItems: number;
  itemCount: number;
  itemsPerPage: number;
  currentPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * Chuẩn hóa tham số phân trang từ Request Client:
 * 1. Không tin tưởng dữ liệu client (chặn số âm, số 0, NaN, chuỗi bậy bạ).
 * 2. Fallback giá trị mặc định nếu client không truyền.
 * 3. Chặn giới hạn tối đa (maxLimit) tránh tấn công cạn kiệt tài nguyên / Memory Leak.
 * 4. Tính toán chính xác offset / skip theo công thức: skip = (page - 1) * limit
 */
export function normalizePagination(
  query?: { page?: any; perPage?: any; limit?: any },
  defaultPerPage = 20,
  maxLimit = 100,
): NormalizedPagination {
  const parsedPage = Number(query?.page);
  const page =
    !isNaN(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;

  const rawLimit = query?.perPage !== undefined ? query.perPage : query?.limit;
  const parsedLimit = Number(rawLimit);
  const requestedLimit =
    !isNaN(parsedLimit) && parsedLimit > 0
      ? Math.floor(parsedLimit)
      : defaultPerPage;

  const limit = Math.min(Math.max(requestedLimit, 1), maxLimit);
  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip,
    perPage: limit,
  };
}

/**
 * Xây dựng cấu trúc Metadata chuẩn hóa theo chuẩn kiến trúc Enterprise:
 * - Bảo đảm tương thích 100% với giao diện hiện tại: `page`, `perPage`, `total`, `totalPages`.
 * - Bổ sung các trường chuyên nghiệp: `totalItems`, `itemCount`, `itemsPerPage`, `currentPage`, `hasNextPage`, `hasPreviousPage`.
 */
export function buildPaginationMeta(params: {
  page: number;
  limit: number;
  total: number;
  dataLength: number;
}): PaginationMeta {
  const { page, limit, total, dataLength } = params;
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

  return {
    // Tương thích frontend cũ
    page,
    perPage: limit,
    total,
    totalPages,

    // Chuẩn doanh nghiệp
    totalItems: total,
    itemCount: dataLength,
    itemsPerPage: limit,
    currentPage: page,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}
