import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BookingPresenceService } from './booking-presence.service';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import {
  BookingPresenceEvent,
  PresenceEventType,
} from './entities/booking-presence-event.entity';
import { BookingStatusLog } from '../bookings/entities/booking-status-log.entity';
import { HotelStaff } from '../hotel-staff/entities/hotel-staff.entity';
import { BookingHold, BookingHoldStatus } from '../inventory/entities/booking-hold.entity';
import { BookingRoom } from '../bookings/entities/booking-room.entity';
import { PaymentTransaction, PaymentTransactionStatus } from '../payments/entities/payment-transaction.entity';

describe('BookingPresenceService (Đợt 2 - No-Show & Late Check-In Recovery)', () => {
  let service: BookingPresenceService;
  let mockBookingRepo: any;
  let mockPresenceRepo: any;
  let mockStatusLogRepo: any;
  let mockHotelStaffRepo: any;
  let mockDataSource: any;
  let currentBooking: any;

  beforeEach(async () => {
    mockBookingRepo = {
      findOne: jest.fn(),
      save: jest.fn((b) => Promise.resolve(b)),
      createQueryBuilder: jest.fn(),
    };

    mockPresenceRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'event-1' })),
      save: jest.fn((e) => Promise.resolve(e)),
      find: jest.fn().mockResolvedValue([]),
    };

    mockStatusLogRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'log-1' })),
      save: jest.fn((l) => Promise.resolve(l)),
    };

    mockHotelStaffRepo = {
      findOne: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn(async (cb) => {
        const mockManager = {
          query: jest.fn(async (sql: string) => {
            if (sql.includes('FROM users')) return [{ id: '1' }];
            if (sql.includes('FROM hotel_staff')) {
              const rel = await mockHotelStaffRepo.findOne();
              return rel ? [{ staffRole: rel.staffRole || 'MANAGER' }] : [];
            }
            return [];
          }),
          getRepository: (entity: any) => {
            if (entity === Booking) return mockBookingRepo;
            if (entity === BookingPresenceEvent) return mockPresenceRepo;
            if (entity === BookingStatusLog) return mockStatusLogRepo;
            if (entity === HotelStaff) return mockHotelStaffRepo;
            if (entity === BookingHold) {
              return { findOne: jest.fn(async () => ({
                roomId: '1', quantity: Number(currentBooking?.requestedRoomCount || 1),
                status: BookingHoldStatus.COMMITTED,
                checkInAt: currentBooking?.checkInAt, checkOutAt: currentBooking?.checkOutAt,
              })) };
            }
            if (entity === BookingRoom) {
              return { find: jest.fn(async () => [{ roomId: '1', quantity: Number(currentBooking?.requestedRoomCount || 1) }]) };
            }
            if (entity === PaymentTransaction) {
              return { findOne: jest.fn(async () => ({ status: PaymentTransactionStatus.PAID })) };
            }
            return {};
          },
        };
        return cb(mockManager);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingPresenceService,
        {
          provide: getRepositoryToken(Booking),
          useValue: mockBookingRepo,
        },
        {
          provide: getRepositoryToken(BookingPresenceEvent),
          useValue: mockPresenceRepo,
        },
        {
          provide: getRepositoryToken(BookingStatusLog),
          useValue: mockStatusLogRepo,
        },
        {
          provide: getRepositoryToken(HotelStaff),
          useValue: mockHotelStaffRepo,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<BookingPresenceService>(BookingPresenceService);
  });

  const setupMockBookingQuery = (bookingData: Partial<Booking> | null) => {
    currentBooking = bookingData && { requestedRoomCount: 1, checkInAt: new Date(), checkOutAt: new Date(Date.now() + 86400000), ...bookingData };
    mockBookingRepo.createQueryBuilder.mockReturnValue({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(currentBooking),
    });
  };

  describe('confirmArrival (Xác nhận nhận phòng tại quầy)', () => {
    it('1. Cho phép check-in thành công khi trạng thái là CONFIRMED và còn trong kỳ', async () => {
      const now = new Date();
      const mockBooking: Partial<Booking> = {
        id: '101',
        bookingCode: 'BK101',
        hotelId: '10',
        userId: '5',
        status: BookingStatus.CONFIRMED,
        checkInAt: new Date(now.getTime() - 2 * 3600 * 1000), // 2 tiếng trước
        checkOutAt: new Date(now.getTime() + 48 * 3600 * 1000), // 2 ngày sau
        presenceVersion: 1,
      };
      setupMockBookingQuery(mockBooking);
      mockHotelStaffRepo.findOne.mockResolvedValue({ id: '1', status: 'ACTIVE' });

      const result = await service.confirmArrival('101', 'staff-9', 'EMPLOYEE', {
        note: 'Khách đến quầy làm thủ tục',
      });

      expect(result.booking.status).toBe(BookingStatus.CHECKED_IN);
      expect(result.booking.actualCheckInAt).toBeDefined();
      expect(result.booking.checkInConfirmedBy).toBe('staff-9');
      expect(result.isFromNoShow).toBe(false);
      expect(mockPresenceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: PresenceEventType.ARRIVAL_CONFIRMED,
          fromStatus: BookingStatus.CONFIRMED,
          toStatus: BookingStatus.CHECKED_IN,
        }),
      );
    });

    it('2. Khôi phục nhận phòng muộn thành công từ NO_SHOW khi còn trong kỳ lưu trú (now < checkOutAt)', async () => {
      const now = new Date();
      const mockBooking: Partial<Booking> = {
        id: '102',
        bookingCode: 'BK102',
        hotelId: '10',
        userId: '5',
        status: BookingStatus.NO_SHOW,
        checkInAt: new Date(now.getTime() - 24 * 3600 * 1000), // Hôm qua
        checkOutAt: new Date(now.getTime() + 24 * 3600 * 1000), // Ngày mai
        presenceVersion: 2,
      };
      setupMockBookingQuery(mockBooking);
      mockHotelStaffRepo.findOne.mockResolvedValue({ id: '1', status: 'ACTIVE' });

      const result = await service.confirmArrival('102', 'staff-9', 'EMPLOYEE', {});

      expect(result.booking.status).toBe(BookingStatus.CHECKED_IN);
      expect(result.booking.lateCheckInRecoveredAt).toBeDefined();
      expect(result.isFromNoShow).toBe(true);
      expect(mockPresenceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: PresenceEventType.LATE_CHECK_IN_RECOVERED,
          fromStatus: BookingStatus.NO_SHOW,
          toStatus: BookingStatus.CHECKED_IN,
        }),
      );
    });

    it('3. Từ chối check-in và ném ConflictException khi đã quá giờ trả phòng (now >= checkOutAt)', async () => {
      const now = new Date();
      const mockBooking: Partial<Booking> = {
        id: '103',
        bookingCode: 'BK103',
        hotelId: '10',
        status: BookingStatus.NO_SHOW,
        checkInAt: new Date(now.getTime() - 48 * 3600 * 1000),
        checkOutAt: new Date(now.getTime() - 1000), // Đã hết hạn trả phòng 1 giây trước
      };
      setupMockBookingQuery(mockBooking);
      mockHotelStaffRepo.findOne.mockResolvedValue({ id: '1', status: 'ACTIVE' });

      await expect(
        service.confirmArrival('103', 'staff-9', 'EMPLOYEE', {}),
      ).rejects.toThrow(ConflictException);
    });

    it('4. Đảm bảo tính Idempotent: Nếu đã CHECKED_IN thì trả về kết quả an toàn không tạo duplicate event', async () => {
      const now = new Date();
      const mockBooking: Partial<Booking> = {
        id: '104',
        hotelId: '10',
        status: BookingStatus.CHECKED_IN,
        actualCheckInAt: new Date(now.getTime() - 10000),
        checkOutAt: new Date(now.getTime() + 24 * 3600 * 1000),
      };
      setupMockBookingQuery(mockBooking);
      mockHotelStaffRepo.findOne.mockResolvedValue({ id: '1', status: 'ACTIVE' });

      const result = await service.confirmArrival('104', 'staff-9', 'EMPLOYEE', {});
      expect(result.alreadyCheckedIn).toBe(true);
      expect(mockPresenceRepo.save).not.toHaveBeenCalled();
    });

    it('5. Từ chối nhận phòng nếu nhân viên không thuộc khách sạn đó', async () => {
      const mockBooking: Partial<Booking> = {
        id: '105',
        hotelId: '10',
        status: BookingStatus.CONFIRMED,
        checkOutAt: new Date(Date.now() + 100000),
      };
      setupMockBookingQuery(mockBooking);
      mockHotelStaffRepo.findOne.mockResolvedValue(null); // Không có quyền

      await expect(
        service.confirmArrival('105', 'staff-stranger', 'EMPLOYEE', {}),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('confirmDeparture (Xác nhận trả phòng)', () => {
    it('1. Hoàn tất trả phòng thành công khi trạng thái là CHECKED_IN', async () => {
      const mockBooking: Partial<Booking> = {
        id: '201',
        hotelId: '10',
        status: BookingStatus.CHECKED_IN,
        actualCheckInAt: new Date(),
        presenceVersion: 2,
      };
      setupMockBookingQuery(mockBooking);
      mockHotelStaffRepo.findOne.mockResolvedValue({ id: '1', status: 'ACTIVE' });

      const result = await service.confirmDeparture('201', 'staff-9', 'EMPLOYEE', {});
      expect(result.booking.status).toBe(BookingStatus.COMPLETED);
      expect(result.booking.actualCheckOutAt).toBeDefined();
      expect(mockPresenceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: PresenceEventType.DEPARTURE_CONFIRMED,
          toStatus: BookingStatus.COMPLETED,
        }),
      );
    });

    it('2. Ném BadRequestException nếu chưa CHECKED_IN mà đòi trả phòng', async () => {
      const mockBooking: Partial<Booking> = {
        id: '202',
        hotelId: '10',
        status: BookingStatus.CONFIRMED, // Khách chưa nhận phòng!
      };
      setupMockBookingQuery(mockBooking);
      mockHotelStaffRepo.findOne.mockResolvedValue({ id: '1', status: 'ACTIVE' });

      await expect(
        service.confirmDeparture('202', 'staff-9', 'EMPLOYEE', {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('markNoShowIfEligible & closeExpiredNoShow (Scheduler & No-Show Lifecycle)', () => {
    it('1. Đánh dấu NO_SHOW khi quá thời gian ân hạn (360 phút) và chưa nhận phòng', async () => {
      const now = new Date();
      const mockBooking: Partial<Booking> = {
        id: '301',
        bookingCode: 'BK301',
        hotelId: '10',
        status: BookingStatus.CONFIRMED,
        actualCheckInAt: null,
        checkInAt: new Date(now.getTime() - 7 * 3600 * 1000), // Đã quá 7 tiếng (> 360 phút)
        checkOutAt: new Date(now.getTime() + 24 * 3600 * 1000), // Chưa qua checkout
        noShowGraceMinutes: 360,
      };
      setupMockBookingQuery(mockBooking);

      const result = await service.markNoShowIfEligible('301');
      expect(result).not.toBeNull();
      expect(result!.status).toBe(BookingStatus.NO_SHOW);
      expect(result!.noShowAt).toBeDefined();
      expect(mockPresenceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: PresenceEventType.NO_SHOW_MARKED,
          toStatus: BookingStatus.NO_SHOW,
        }),
      );
      // FIX-01: Xác minh changedBy là NULL và actorType là SYSTEM khi hệ thống tự động chạy
      expect(mockStatusLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          changedBy: null,
          actorType: 'SYSTEM',
          newStatus: BookingStatus.NO_SHOW,
        }),
      );
    });

    it('2. KHÔNG đánh dấu NO_SHOW nếu chưa quá ân hạn 360 phút', async () => {
      const now = new Date();
      const mockBooking: Partial<Booking> = {
        id: '302',
        status: BookingStatus.CONFIRMED,
        actualCheckInAt: null,
        checkInAt: new Date(now.getTime() - 2 * 3600 * 1000), // Mới quá 2 tiếng (< 6 tiếng)
        checkOutAt: new Date(now.getTime() + 24 * 3600 * 1000),
        noShowGraceMinutes: 360,
      };
      setupMockBookingQuery(mockBooking);

      const result = await service.markNoShowIfEligible('302');
      expect(result).not.toBeNull();
      expect(result!.status).toBe(BookingStatus.CONFIRMED); // Vẫn giữ CONFIRMED
      expect(mockPresenceRepo.save).not.toHaveBeenCalled();
    });

    it('3. Đóng NO_SHOW thành CLOSED_NO_SHOW khi thời gian hiện tại đã qua check_out_at', async () => {
      const now = new Date();
      const mockBooking: Partial<Booking> = {
        id: '303',
        bookingCode: 'BK303',
        hotelId: '10',
        status: BookingStatus.NO_SHOW,
        checkOutAt: new Date(now.getTime() - 3600 * 1000), // Đã qua giờ check-out 1 tiếng
      };
      setupMockBookingQuery(mockBooking);

      const result = await service.closeExpiredNoShow('303');
      expect(result).not.toBeNull();
      expect(result!.status).toBe(BookingStatus.CLOSED_NO_SHOW);
      expect(result!.noShowClosedAt).toBeDefined();
      expect(mockPresenceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: PresenceEventType.NO_SHOW_CLOSED,
          toStatus: BookingStatus.CLOSED_NO_SHOW,
        }),
      );
      // FIX-01: Xác minh changedBy là NULL và actorType là SYSTEM khi đóng No-Show hết kỳ
      expect(mockStatusLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          changedBy: null,
          actorType: 'SYSTEM',
          newStatus: BookingStatus.CLOSED_NO_SHOW,
        }),
      );
    });

    it('4. Ném ConflictException khi Quản lý đánh dấu No-Show thủ công trước hạn ân hạn', async () => {
      const now = new Date();
      const mockBooking: Partial<Booking> = {
        id: '304',
        status: BookingStatus.CONFIRMED,
        actualCheckInAt: null,
        checkInAt: new Date(now.getTime() - 2 * 3600 * 1000), // Mới quá 2 tiếng (< 6 tiếng)
        checkOutAt: new Date(now.getTime() + 24 * 3600 * 1000),
        noShowGraceMinutes: 360,
      };
      setupMockBookingQuery(mockBooking);

      await expect(
        service.markNoShowIfEligible(
          '304',
          'Quản lý kiểm tra thủ công',
          { id: 'mgr-1', role: 'EMPLOYEE' },
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('5. Lưu changedBy và actorType USER khi Quản lý đánh dấu No-Show thủ công hợp lệ', async () => {
      const now = new Date();
      const mockBooking: Partial<Booking> = {
        id: '305',
        bookingCode: 'BK305',
        hotelId: '10',
        status: BookingStatus.CONFIRMED,
        actualCheckInAt: null,
        checkInAt: new Date(now.getTime() - 7 * 3600 * 1000), // Đã quá 7 tiếng (> 6 tiếng)
        checkOutAt: new Date(now.getTime() + 24 * 3600 * 1000),
        noShowGraceMinutes: 360,
      };
      setupMockBookingQuery(mockBooking);

      const result = await service.markNoShowIfEligible(
        '305',
        'Quản lý kiểm tra thủ công',
        { id: 'mgr-1', role: 'EMPLOYEE' },
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(BookingStatus.NO_SHOW);
      expect(mockStatusLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          changedBy: 'mgr-1',
          actorType: 'USER',
          newStatus: BookingStatus.NO_SHOW,
        }),
      );
    });
  });

  describe('getPresenceTimeline & Permissions (FIX-03)', () => {
    it('Ném ForbiddenException nếu CUSTOMER xem timeline của đơn không thuộc về mình', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '999',
        userId: '10', // Chủ đơn là user 10
        hotelId: '1',
      });

      const customerOtherUser: any = { id: '99', role: 'CUSTOMER' };

      await expect(
        service.getPresenceTimeline('999', customerOtherUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Cho phép CUSTOMER xem timeline của chính đơn mình đặt', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '999',
        userId: '10',
        hotelId: '1',
      });
      mockPresenceRepo.find.mockResolvedValue([
        { id: '1', eventType: PresenceEventType.ARRIVAL_CONFIRMED },
      ]);

      const customerOwner: any = { id: '10', role: 'CUSTOMER' };
      const res = await service.getPresenceTimeline('999', customerOwner);
      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
    });
  });
});
