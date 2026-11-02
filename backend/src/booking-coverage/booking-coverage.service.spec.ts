import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BookingCoverageService } from './booking-coverage.service';
import {
  BookingCoverageGrant,
  CoverageGrantStatus,
  CoverageTaskType,
} from './entities/booking-coverage-grant.entity';
import {
  BookingCoverageEvent,
  CoverageEventType,
} from './entities/booking-coverage-event.entity';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity';
import { BookingAssignment } from '../booking-assignment/entities/booking-assignment.entity';
import { BookingAssignmentState } from '../booking-assignment/entities/booking-assignment-state.entity';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

describe('BookingCoverageService (Đợt 3 - Temporary Coverage & Permanent Transfer)', () => {
  let service: BookingCoverageService;
  let mockGrantRepo: any;
  let mockEventRepo: any;
  let mockBookingRepo: any;
  let mockAssignmentRepo: any;
  let mockStateRepo: any;
  let mockStaffAvailService: any;
  let mockRealtimeGateway: any;
  let mockDataSource: any;
  let ownerStillActive = false;

  beforeEach(async () => {
    ownerStillActive = false;
    mockGrantRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto) => ({ ...dto, id: 'grant-1', version: 1 })),
      save: jest.fn((g) => Promise.resolve(g)),
      createQueryBuilder: jest.fn(() => ({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn(() => mockGrantRepo.find()),
      })),
    };
    mockGrantRepo.manager = {
      getRepository: () => mockGrantRepo,
      query: jest.fn().mockResolvedValue([]),
    };

    mockEventRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'event-1' })),
      save: jest.fn((e) => Promise.resolve(e)),
      find: jest.fn().mockResolvedValue([]),
    };

    mockBookingRepo = {
      findOne: jest.fn(),
      save: jest.fn((b) => Promise.resolve(b)),
      createQueryBuilder: jest.fn(),
    };

    mockAssignmentRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto) => ({ ...dto, id: 'assign-1' })),
      save: jest.fn((a) => Promise.resolve(a)),
    };

    mockStateRepo = {
      findOne: jest.fn(),
      save: jest.fn((s) => Promise.resolve(s)),
    };

    mockStaffAvailService = {
      checkStaffAvailabilityOnInterval: jest.fn().mockResolvedValue(true),
      isManagerAtHotel: jest.fn().mockResolvedValue(true),
      isStaffAtHotel: jest.fn().mockResolvedValue(true),
      isStaffAvailableAt: jest.fn().mockResolvedValue({ available: true }),
    };

    mockRealtimeGateway = {
      emitSystemNotification: jest.fn(),
    };

    const createMockManager = () => {
      const mgr: any = {
        query: jest.fn(async (sql: string, params?: any[]) => {
          if (sql.includes('SELECT hs.status AS staffStatus')) {
            return ownerStillActive ? [{ staffStatus: 'ACTIVE', userStatus: 'ACTIVE', deletedAt: null }] : [];
          }
          if (sql.includes('SELECT hs.staff_role AS staffRole FROM hotel_staff')) {
            const staffId = String(params?.[1] || '');
            if (staffId === '2') {
              const ok = await mockStaffAvailService.isStaffAtHotel();
              return ok ? [{ staffRole: 'EMPLOYEE' }] : [];
            }
            const isMgr = await mockStaffAvailService.isManagerAtHotel();
            return isMgr ? [{ staffRole: 'MANAGER' }] : [{ staffRole: 'EMPLOYEE' }];
          }
          if (sql.includes('EXISTS(SELECT 1 FROM staff_availability_blocks')) {
            return [{ absent: 0, busy: 0, activeLoad: 0, completedCount: 5, lastAssignedAt: null }];
          }
          if (sql.includes('FROM staff_availability_blocks')) {
            const avail = await mockStaffAvailService.checkStaffAvailabilityOnInterval();
            return avail ? [] : [{ id: 'block-1' }];
          }
          if (sql.includes('FROM booking_rooms')) return [{ difficulty: 1 }];
          if (sql.includes('FROM staff_eligibility_rules')) {
            return [{ requiredSkillCodes: null, requiredLanguageCodes: null, minSkillLevel: 1, minYearsExperience: 0, minCasesCompleted: 0, excludeShadowMode: 1, requireVerifiedSkills: 0 }];
          }
          if (sql.includes('FROM hotel_staff hs JOIN users u')) {
            return [{ staffUserId: '2', staffRole: 'EMPLOYEE', staffName: 'Staff 2', staffEmail: 's2@test.com' }];
          }
          if (sql.includes('FROM staff_skills ss')) {
            return [{ staffUserId: '2', code: 'FRONT_DESK', department: 'FRONT_DESK', level: 3, yearsExp: 2, verifiedBy: '1', verifiedAt: new Date(), isShadow: 0 }];
          }
          if (sql.includes('FROM staff_language_skills')) return [];
          if (sql.includes('EXISTS(SELECT 1 FROM staff_availability_blocks')) {
            return [{ absent: 0, busy: 0, activeLoad: 0, completedCount: 5, lastAssignedAt: null }];
          }
          return [];
        }),
        findOne: async (entity: any, opts: any) => {
          if (entity === Booking) {
            const b = await mockBookingRepo.findOne(opts);
            return b ? { status: BookingStatus.CONFIRMED, checkOutAt: new Date(Date.now() + 7 * 86400000), ...b } : null;
          }
          if (entity === BookingCoverageGrant) return mockGrantRepo.findOne(opts);
          if (entity === BookingAssignmentState) return mockStateRepo.findOne(opts);
          if (entity === BookingAssignment) return mockAssignmentRepo.findOne(opts);
          return null;
        },
        find: (entity: any, opts: any) => {
          if (entity === BookingCoverageGrant) return mockGrantRepo.find(opts);
          return [];
        },
        create: (entity: any, dto: any) => {
          if (entity === BookingCoverageGrant) return mockGrantRepo.create(dto);
          if (entity === BookingCoverageEvent) return mockEventRepo.create(dto);
          if (entity === BookingAssignment) return mockAssignmentRepo.create(dto);
          return dto;
        },
        save: (entity: any, val: any) => {
          if (entity === BookingCoverageGrant || val instanceof BookingCoverageGrant || val?.taskType) {
            return mockGrantRepo.save(val);
          }
          if (entity === BookingCoverageEvent || val instanceof BookingCoverageEvent) {
            return mockEventRepo.save(val);
          }
          if (entity === Booking) return mockBookingRepo.save(val);
          if (entity === BookingAssignment) return mockAssignmentRepo.save(val);
          if (entity === BookingAssignmentState) return mockStateRepo.save(val);
          return Promise.resolve(val);
        },
        getRepository: (entity: any) => {
          if (entity === Booking) return mockBookingRepo;
          if (entity === BookingCoverageGrant) return mockGrantRepo;
          if (entity === BookingCoverageEvent) return mockEventRepo;
          if (entity === BookingAssignment) return mockAssignmentRepo;
          if (entity === BookingAssignmentState) return mockStateRepo;
          return {
            ...mgr,
            createQueryBuilder: () => ({
              setLock: () => ({ where: () => ({ orderBy: () => ({ getMany: () => Promise.resolve([]) }) }) }),
            }),
          };
        },
      };
      return mgr;
    };

    mockDataSource = {
      transaction: jest.fn(async (cb) => {
        return cb(createMockManager());
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingCoverageService,
        {
          provide: getRepositoryToken(BookingCoverageGrant),
          useValue: mockGrantRepo,
        },
        {
          provide: getRepositoryToken(BookingCoverageEvent),
          useValue: mockEventRepo,
        },
        {
          provide: getRepositoryToken(Booking),
          useValue: mockBookingRepo,
        },
        {
          provide: getRepositoryToken(BookingAssignment),
          useValue: mockAssignmentRepo,
        },
        {
          provide: getRepositoryToken(BookingAssignmentState),
          useValue: mockStateRepo,
        },
        {
          provide: StaffAvailabilityService,
          useValue: mockStaffAvailService,
        },
        {
          provide: RealtimeGateway,
          useValue: mockRealtimeGateway,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<BookingCoverageService>(BookingCoverageService);
  });

  describe('createTemporary (Cấp quyền hỗ trợ tạm thời)', () => {
    it('1. Chặn cấp quyền nếu không tìm thấy đơn đặt phòng', async () => {
      mockBookingRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createTemporary('999', { id: '1', role: 'EMPLOYEE' }, {
          delegateStaffUserId: '2',
          startAt: new Date().toISOString(),
          endAt: new Date(Date.now() + 60000).toISOString(),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('2. Chặn cấp quyền nếu thời lượng ngoài khoảng 15 - 1440 phút', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '10',
        hotelId: '100',
        handledBy: '1',
      });
      const now = Date.now();

      // Dưới 15 phút (5 phút)
      await expect(
        service.createTemporary('10', { id: '1', role: 'EMPLOYEE' }, {
          delegateStaffUserId: '2',
          startAt: new Date(now).toISOString(),
          endAt: new Date(now + 5 * 60 * 1000).toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);

      // Quá 24 giờ (25 giờ)
      await expect(
        service.createTemporary('10', { id: '1', role: 'EMPLOYEE' }, {
          delegateStaffUserId: '2',
          startAt: new Date(now).toISOString(),
          endAt: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('3. Chặn nếu nhân viên ủy quyền không có quyền quản lý khách sạn', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '10',
        hotelId: '100',
        handledBy: '5',
      });
      mockStaffAvailService.isManagerAtHotel.mockResolvedValue(false);
      const now = Date.now();

      await expect(
        service.createTemporary('10', { id: '9', role: 'EMPLOYEE' }, {
          delegateStaffUserId: '2',
          startAt: new Date(now).toISOString(),
          endAt: new Date(now + 60 * 60 * 1000).toISOString(),
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('4. Chặn cấp ủy quyền nếu nhân sự nhận ủy quyền đang có block nghỉ đã duyệt', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '10',
        hotelId: '100',
        handledBy: '1',
      });
      mockStaffAvailService.isManagerAtHotel.mockResolvedValue(true);
      mockStaffAvailService.isStaffAtHotel.mockResolvedValue(true);
      mockStaffAvailService.checkStaffAvailabilityOnInterval.mockResolvedValue(false);
      const now = Date.now();

      await expect(
        service.createTemporary('10', { id: '1', role: 'EMPLOYEE' }, {
          delegateStaffUserId: '2',
          startAt: new Date(now).toISOString(),
          endAt: new Date(now + 60 * 60 * 1000).toISOString(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('5. Cấp quyền thành công khi hợp lệ, ghi nhận grant và phát sự kiện', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '10',
        hotelId: '100',
        handledBy: '1',
      });
      mockGrantRepo.findOne.mockResolvedValue(null);
      mockStaffAvailService.isManagerAtHotel.mockResolvedValue(true);
      mockStaffAvailService.isStaffAtHotel.mockResolvedValue(true);
      mockStaffAvailService.checkStaffAvailabilityOnInterval.mockResolvedValue(true);
      const now = Date.now();

      const result = await service.createTemporary('10', { id: '1', role: 'EMPLOYEE' }, {
        delegateStaffUserId: '2',
        startAt: new Date(now).toISOString(),
        endAt: new Date(now + 120 * 60 * 1000).toISOString(),
        allowedTaskTypes: [CoverageTaskType.CHECK_IN],
        reason: 'Hỗ trợ đón khách check-in',
      });

      expect(result).toBeDefined();
      expect(mockGrantRepo.save).toHaveBeenCalled();
      expect(mockEventRepo.save).toHaveBeenCalled();
    });
  });

  describe('isStaffCoveringTask (Kiểm tra quyền xử lý nhiệm vụ)', () => {
    it('1. Trả về true nếu nhân sự có grant ACTIVE còn hiệu lực khớp taskType', async () => {
      mockGrantRepo.find.mockResolvedValue([
        {
          id: 'grant-1',
          bookingId: '10',
          delegateStaffId: '2',
          allowedTaskTypes: [CoverageTaskType.ALL_SERVICE_TASKS],
          status: CoverageGrantStatus.ACTIVE,
        },
      ]);

      const allowed = await service.isStaffCoveringTask('10', '2', CoverageTaskType.SERVICE_RESPONSE);
      expect(allowed).toBe(true);
    });

    it('2. Trả về false nếu không có grant hợp lệ', async () => {
      mockGrantRepo.find.mockResolvedValue([]);

      const allowed = await service.isStaffCoveringTask('10', '99', CoverageTaskType.ALL_SERVICE_TASKS);
      expect(allowed).toBe(false);
    });
  });

  describe('transferPermanent (Bàn giao trách nhiệm chính)', () => {
    it('1. Bàn giao trách nhiệm chính cập nhật handledBy và thu hồi grants cũ', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '10',
        hotelId: '100',
        handledBy: '1',
        status: BookingStatus.CONFIRMED,
      });
      mockGrantRepo.find.mockResolvedValue([
        { id: 'grant-old', status: CoverageGrantStatus.ACTIVE },
      ]);
      mockStateRepo.findOne.mockResolvedValue({
        bookingId: '10',
        assignedStaffId: '1',
      });

      const res = await service.transferPermanent('10', { id: '1', role: 'EMPLOYEE' }, {
        toStaffUserId: '2',
        reasonCode: 'EMPLOYMENT_ENDED',
        reason: 'Nhân sự 1 đã nghỉ việc hẳn',
      });

      expect(res.message).toContain('thành công');
      expect(mockBookingRepo.save).toHaveBeenCalled();
      expect(mockAssignmentRepo.save).toHaveBeenCalled();
      expect(mockEventRepo.save).toHaveBeenCalled();
    });

    it('2. AB-07: Từ chối Permanent Transfer nếu nhân sự phụ trách chính vẫn đang ACTIVE tại khách sạn (đề nghị dùng TEMPORARY)', async () => {
      ownerStillActive = true;
      mockBookingRepo.findOne.mockResolvedValue({
        id: '10',
        hotelId: '100',
        handledBy: '1',
        status: BookingStatus.CONFIRMED,
      });

      await expect(
        service.transferPermanent('10', { id: '1', role: 'EMPLOYEE' }, {
          toStaffUserId: '2',
          reasonCode: 'EMPLOYMENT_ENDED',
          reason: 'A chỉ nghỉ phép 2 ngày',
        }),
      ).rejects.toThrow(ConflictException);
      ownerStillActive = false;
    });
  });
});
