import { normalizePagination, buildPaginationMeta } from './pagination.helper';

describe('PaginationHelper', () => {
  describe('normalizePagination', () => {
    it('should use default values when query is empty', () => {
      const result = normalizePagination({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.perPage).toBe(20);
      expect(result.skip).toBe(0);
    });

    it('should calculate correct skip for page 3 with limit 10', () => {
      const result = normalizePagination({ page: 3, perPage: 10 });
      expect(result.page).toBe(3);
      expect(result.limit).toBe(10);
      expect(result.skip).toBe(20); // (3 - 1) * 10
    });

    it('should normalize negative or zero page to 1', () => {
      expect(normalizePagination({ page: -5 }).page).toBe(1);
      expect(normalizePagination({ page: 0 }).page).toBe(1);
      expect(normalizePagination({ page: -100 }).skip).toBe(0);
    });

    it('should clamp limit to maxLimit (default 100) when requested limit is too large', () => {
      const result = normalizePagination({ perPage: 50000 });
      expect(result.limit).toBe(100);
      expect(result.perPage).toBe(100);
    });

    it('should support limit parameter as alias for perPage', () => {
      const result = normalizePagination({ page: 2, limit: 15 });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(15);
      expect(result.skip).toBe(15);
    });

    it('should normalize non-numeric string values safely', () => {
      const result = normalizePagination({
        page: 'abc' as any,
        perPage: 'xyz' as any,
      });
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.skip).toBe(0);
    });
  });

  describe('buildPaginationMeta', () => {
    it('should build correct metadata for middle page', () => {
      const meta = buildPaginationMeta({
        page: 2,
        limit: 10,
        total: 25,
        dataLength: 10,
      });

      // Legacy fields
      expect(meta.page).toBe(2);
      expect(meta.perPage).toBe(10);
      expect(meta.total).toBe(25);
      expect(meta.totalPages).toBe(3);

      // Enterprise standard fields
      expect(meta.totalItems).toBe(25);
      expect(meta.itemCount).toBe(10);
      expect(meta.itemsPerPage).toBe(10);
      expect(meta.currentPage).toBe(2);
      expect(meta.hasNextPage).toBe(true);
      expect(meta.hasPreviousPage).toBe(true);
    });

    it('should build correct metadata for first page', () => {
      const meta = buildPaginationMeta({
        page: 1,
        limit: 10,
        total: 25,
        dataLength: 10,
      });

      expect(meta.hasNextPage).toBe(true);
      expect(meta.hasPreviousPage).toBe(false);
    });

    it('should build correct metadata for last page', () => {
      const meta = buildPaginationMeta({
        page: 3,
        limit: 10,
        total: 25,
        dataLength: 5,
      });

      expect(meta.itemCount).toBe(5);
      expect(meta.hasNextPage).toBe(false);
      expect(meta.hasPreviousPage).toBe(true);
    });

    it('should handle zero total items gracefully', () => {
      const meta = buildPaginationMeta({
        page: 1,
        limit: 10,
        total: 0,
        dataLength: 0,
      });

      expect(meta.totalPages).toBe(0);
      expect(meta.totalItems).toBe(0);
      expect(meta.itemCount).toBe(0);
      expect(meta.hasNextPage).toBe(false);
      expect(meta.hasPreviousPage).toBe(false);
    });
  });
});
