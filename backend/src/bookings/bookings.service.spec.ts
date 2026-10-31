import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { Booking, BookingStatus } from './entities/booking.entity';

describe('BookingsService - Scoping, Fallback & Front Desk Direct Booking', () => {
  let service: BookingsService;
  let mockBookingRepo: any;
  let mockRoomRepo: any;
  let mockDataSource: any;
  let mockIdGen: any;

  beforeEach(() => {
    mockBookingRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn((dto) => ({ ...dto, id: '101' })),
    };
    mockRoomRepo = {
      findOne: jest.fn(),
    };
    mockDataSource = {
      query: jest.fn(),
      createQueryBuilder: jest.fn(),
      transaction: jest.fn(async (cb) => {
        const mockManager = {
          getRepository: (entity: any) => {
            if (entity === Booking) return mockBookingRepo;
            return {
              create: jest.fn((dto) => dto),
              save: jest.fn((dto) => Promise.resolve(dto)),
              findOne: jest.fn().mockResolvedValue(null),
            };
          },
        };
        return cb(mockManager);
      }),
    };
    mockIdGen = {
      generateBookingCode: jest.fn(() => 'BKG-2026-TEST'),
    };

    service = new BookingsService(
      mockBookingRepo,
      {} as any, // bookingRoomRepository
      {} as any, // bookingStatusLogRepository
      mockRoomRepo,
      mockDataSource,
      mockIdGen,
      {} as any, // realtimeGateway
      {} as any, // redisClient
      {} as any, // redisLockService
      {} as any, // bookingAccessService
      {} as any, // inventoryService
    );
  });

  describe('reassignStaff', () => {
    it('should throw ForbiddenException if actor is EMPLOYEE but not MANAGER of the hotel', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '1',
        hotelId: '10',
        status: BookingStatus.PENDING,
      });

      // Query returns empty (actor is not manager of hotel 10)
      mockDataSource.query.mockResolvedValueOnce([]);

      const actor: any = { id: '5', role: 'EMPLOYEE' };

      await expect(
        service.reassignStaff('1', '7', '5', 'Reassign note', actor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if target staff is not active at booking hotel', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '1',
        hotelId: '10',
        status: BookingStatus.PENDING,
      });

      const actor: any = { id: '1', role: 'ADMIN' };

      // Query for target staff membership returns empty
      mockDataSource.query.mockResolvedValueOnce([]);

      await expect(
        service.reassignStaff('1', '99', '1', 'Reassign note', actor),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createFrontDeskBooking', () => {
    it('should throw ForbiddenException if staff does not belong to room hotel', async () => {
      mockRoomRepo.findOne.mockResolvedValue({
        id: '1',
        hotelId: '10',
        pricePerNight: '1500000',
        availableRooms: 5,
      });

      // Staff query returns empty
      mockDataSource.query.mockResolvedValueOnce([]);

      const staffUser: any = { id: '5', role: 'EMPLOYEE', fullName: 'Receptionist A' };
      const dto: any = {
        roomId: '1',
        bookingSource: 'WALK_IN',
        checkInAt: '2026-10-25T14:00:00Z',
        checkOutAt: '2026-10-26T12:00:00Z',
        totalGuests: 2,
        roomCount: 1,
        contactName: 'Nguyen Van A',
        contactEmail: 'vana@gmail.com',
        contactPhone: '0901234567',
      };

      await expect(
        service.createFrontDeskBooking(dto, staffUser, '127.0.0.1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateStatus & Presence Invariants (FIX-04)', () => {
    it('should throw ConflictException if PATCH NO_SHOW before grace period ends', async () => {
      const now = new Date();
      mockBookingRepo.findOne.mockResolvedValue({
        id: '1',
        hotelId: '10',
        status: BookingStatus.CONFIRMED,
        actualCheckInAt: null,
        checkInAt: new Date(now.getTime() - 2 * 3600 * 1000), // Mới 2 tiếng trước (< 6 tiếng grace)
        checkOutAt: new Date(now.getTime() + 24 * 3600 * 1000),
        noShowGraceMinutes: 360,
      });

      await expect(
        service.updateStatus('1', { status: 'NO_SHOW' as any }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if PATCH COMPLETED without actualCheckInAt', async () => {
      const now = new Date();
      mockBookingRepo.findOne.mockResolvedValue({
        id: '2',
        hotelId: '10',
        status: BookingStatus.CHECKED_IN,
        actualCheckInAt: null, // Chưa từng check-in!
        checkInAt: new Date(now.getTime() - 2 * 3600 * 1000),
        checkOutAt: new Date(now.getTime() + 24 * 3600 * 1000),
      });

      await expect(
        service.updateStatus('2', { status: 'COMPLETED' as any }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
