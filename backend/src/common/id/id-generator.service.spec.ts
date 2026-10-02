import { Test, TestingModule } from '@nestjs/testing';
import { IdGeneratorService } from './id-generator.service';

describe('IdGeneratorService', () => {
  let service: IdGeneratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IdGeneratorService],
    }).compile();

    service = module.get<IdGeneratorService>(IdGeneratorService);
  });

  describe('generateUuidV7', () => {
    it('should generate a valid RFC 9562 UUID v7', () => {
      const id = service.generateUuidV7();

      expect(typeof id).toBe('string');
      // UUID format 8-4-4-4-12
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(service.isValidUuid(id)).toBe(true);
    });

    it('should generate time-ordered UUIDs', async () => {
      const id1 = service.generateUuidV7();
      // wait 2ms
      await new Promise((r) => setTimeout(r, 2));
      const id2 = service.generateUuidV7();

      expect(id1.localeCompare(id2)).toBeLessThanOrEqual(0);
    });
  });

  describe('isValidUuid', () => {
    it('should return true for valid UUIDs', () => {
      expect(service.isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(
        true,
      );
      expect(service.isValidUuid(service.generateUuidV7())).toBe(true);
    });

    it('should return false for invalid UUIDs', () => {
      expect(service.isValidUuid('not-a-uuid')).toBe(false);
      expect(service.isValidUuid('12345')).toBe(false);
      expect(service.isValidUuid(null)).toBe(false);
      expect(service.isValidUuid(undefined)).toBe(false);
      expect(service.isValidUuid('')).toBe(false);
    });
  });

  describe('generateBookingCode', () => {
    it('should generate a business-friendly booking code in BK-YYYYMMDD-XXXX format', () => {
      const testDate = new Date(2026, 8, 24); // Month is 0-indexed (8 = September)
      const code = service.generateBookingCode('BK', testDate);

      expect(code).toMatch(/^BK-20260924-[0-9A-Z]{4}$/);
      expect(code.length).toBe(16);
      expect(code.length).toBeLessThanOrEqual(30); // DB column limit
    });

    it('should generate unique codes across consecutive calls', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 50; i++) {
        codes.add(service.generateBookingCode());
      }
      expect(codes.size).toBe(50);
    });
  });
});
