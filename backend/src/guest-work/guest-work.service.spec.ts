import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { GuestWorkService } from './guest-work.service';
import {
  GuestWorkTask,
  WorkTaskType,
  WorkTaskStatus,
  WorkTaskPriority,
} from './entities/guest-work-task.entity';
import {
  GuestWorkEvent,
} from './entities/guest-work-event.entity';
import {
  GuestWorkEvidence,
} from './entities/guest-work-evidence.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';
import { BookingCoverageService } from '../booking-coverage/booking-coverage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

describe('GuestWorkService (Đợt 4 - Task Coordination, Evidence & SLA)', () => {
  let service: GuestWorkService;
  let mockTaskRepo: any;
  let mockEventRepo: any;
  let mockEvidenceRepo: any;
  let mockBookingRepo: any;
  let mockStaffAvailService: any;
  let mockCoverageService: any;
  let mockRealtimeGateway: any;
  let mockDataSource: any;

  beforeEach(async () => {
    mockTaskRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto) => ({ ...dto, id: 'task-1', version: 1 })),
      save: jest.fn((t) => Promise.resolve(t)),
    };

    mockEventRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'event-1' })),
      save: jest.fn((e) => Promise.resolve(e)),
      find: jest.fn().mockResolvedValue([]),
    };

    mockEvidenceRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'evi-1' })),
      save: jest.fn((e) => Promise.resolve(e)),
    };

    mockBookingRepo = {
      findOne: jest.fn(),
    };

    mockStaffAvailService = {
      checkStaffAvailabilityOnInterval: jest.fn().mockResolvedValue(true),
      isManagerAtHotel: jest.fn().mockResolvedValue(true),
    };

    mockCoverageService = {
      isStaffCoveringTask: jest.fn().mockResolvedValue(true),
    };

    mockRealtimeGateway = {
      emitSystemNotification: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn(async (cb) => {
        const mockManager = {
          findOne: (entity: any, opts: any) => {
            if (entity === GuestWorkTask) return mockTaskRepo.findOne(opts);
            if (entity === Booking) return mockBookingRepo.findOne(opts);
            return null;
          },
          find: (entity: any, opts: any) => {
            if (entity === GuestWorkTask) return mockTaskRepo.find(opts);
            return [];
          },
          create: (entity: any, dto: any) => {
            if (entity === GuestWorkTask) return mockTaskRepo.create(dto);
            if (entity === GuestWorkEvent) return mockEventRepo.create(dto);
            if (entity === GuestWorkEvidence) return mockEvidenceRepo.create(dto);
            return dto;
          },
          save: (entity: any, val: any) => {
            if (entity === GuestWorkTask || val?.status) return mockTaskRepo.save(val);
            if (entity === GuestWorkEvent || val?.eventType) return mockEventRepo.save(val);
            if (entity === GuestWorkEvidence) return mockEvidenceRepo.save(val);
            return Promise.resolve(val);
          },
        };
        return cb(mockManager);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestWorkService,
        {
          provide: getRepositoryToken(GuestWorkTask),
          useValue: mockTaskRepo,
        },
        {
          provide: getRepositoryToken(GuestWorkEvent),
          useValue: mockEventRepo,
        },
        {
          provide: getRepositoryToken(GuestWorkEvidence),
          useValue: mockEvidenceRepo,
        },
        {
          provide: getRepositoryToken(Booking),
          useValue: mockBookingRepo,
        },
        {
          provide: StaffAvailabilityService,
          useValue: mockStaffAvailService,
        },
        {
          provide: BookingCoverageService,
          useValue: mockCoverageService,
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

    service = module.get<GuestWorkService>(GuestWorkService);
  });

  describe('createTask (Tạo nhiệm vụ)', () => {
    it('1. Tạo task thành công và lưu sự kiện TASK_CREATED', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '10',
        hotelId: '100',
        handledBy: '1',
      });

      const res = await service.createTask({
        hotelId: '100',
        bookingId: '10',
        type: WorkTaskType.SERVICE_REQUEST,
        priority: WorkTaskPriority.NORMAL,
        description: 'Dọn phòng khách yêu cầu',
      });

      expect(res).toBeDefined();
      expect(mockTaskRepo.save).toHaveBeenCalled();
    });

    it('2. Chặn gán nhân sự cho task nếu nhân sự đó đang nghỉ (block availability)', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '10',
        hotelId: '100',
      });
      mockStaffAvailService.checkStaffAvailabilityOnInterval.mockResolvedValue(false);

      await expect(
        service.createTask({
          hotelId: '100',
          bookingId: '10',
          type: WorkTaskType.SERVICE_REQUEST,
          assignedStaffId: '2',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('startTask & completeTask (Vòng đời hoàn tất task)', () => {
    it('1. Cho phép nhân viên bắt đầu task và chuyển trạng thái sang IN_PROGRESS', async () => {
      mockTaskRepo.findOne.mockResolvedValue({
        id: 'task-1',
        bookingId: '10',
        hotelId: '100',
        assignedStaffId: '1',
        status: WorkTaskStatus.ASSIGNED,
        version: 1,
      });

      const res = await service.startTask('task-1', { id: '1', role: 'EMPLOYEE' });
      expect(res.status).toBe(WorkTaskStatus.IN_PROGRESS);
    });

    it('2. Hoàn tất task và chuyển trạng thái sang COMPLETED', async () => {
      mockTaskRepo.findOne.mockResolvedValue({
        id: 'task-1',
        bookingId: '10',
        hotelId: '100',
        assignedStaffId: '1',
        status: WorkTaskStatus.IN_PROGRESS,
        version: 2,
      });

      const res = await service.completeTask('task-1', { id: '1', role: 'EMPLOYEE' }, {
        evidenceRef: 'Đã giao thêm gối cho phòng 302',
      });
      expect(res.status).toBe(WorkTaskStatus.COMPLETED);
    });
  });

  describe('verifyTask (Nghiệm thu task - 4-Eyes Principle)', () => {
    it('1. Chặn người trực tiếp thực hiện tự nghiệm thu task của mình', async () => {
      mockTaskRepo.findOne.mockResolvedValue({
        id: 'task-1',
        bookingId: '10',
        hotelId: '100',
        assignedStaffId: '1',
        status: WorkTaskStatus.COMPLETED,
        version: 3,
      });

      await expect(
        service.verifyTask('task-1', { id: '1', role: 'EMPLOYEE' }, {
          decision: 'VERIFIED',
          note: 'Tự duyệt',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('2. Quản lý hoặc nhân sự khác có quyền nghiệm thu thành công', async () => {
      mockTaskRepo.findOne.mockResolvedValue({
        id: 'task-1',
        bookingId: '10',
        hotelId: '100',
        assignedStaffId: '1',
        status: WorkTaskStatus.COMPLETED,
        version: 3,
      });

      const res = await service.verifyTask('task-1', { id: '2', role: 'ADMIN' }, {
        decision: 'VERIFIED',
        note: 'Đã kiểm tra chất lượng đạt yêu cầu',
      });
      expect(res.status).toBe(WorkTaskStatus.VERIFIED);
    });
  });
});
