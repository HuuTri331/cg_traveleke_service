import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { KpiCalculationService, DEFAULT_KPI_WEIGHTS } from './kpi-calculation.service';
import {
  StaffKpiPeriodScore,
  KpiPeriodStatus,
} from './entities/staff-kpi-period-score.entity';
import { StaffKpiMetricScore } from './entities/staff-kpi-metric-score.entity';
import { StaffKpiAdjustment, AdjustmentStatus } from './entities/staff-kpi-adjustment.entity';
import { GuestStaffReview } from './entities/guest-staff-review.entity';
import { GuestWorkEvent } from '../guest-work/entities/guest-work-event.entity';
import { GuestWorkTask } from '../guest-work/entities/guest-work-task.entity';
import { BookingPresenceEvent } from '../booking-presence/entities/booking-presence-event.entity';
import { StaffAvailabilityService } from '../staff-availability/staff-availability.service';

describe('KpiCalculationService (Đợt 5 - Staff KPI & Weight Rebalancing)', () => {
  let service: KpiCalculationService;
  let mockPeriodScoreRepo: any;
  let mockMetricScoreRepo: any;
  let mockAdjustmentRepo: any;
  let mockReviewRepo: any;
  let mockWorkEventRepo: any;
  let mockTaskRepo: any;
  let mockPresenceEventRepo: any;
  let mockStaffAvailService: any;

  beforeEach(async () => {
    mockPeriodScoreRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto) => ({ ...dto, id: 'period-1' })),
      save: jest.fn((p) => Promise.resolve(p)),
    };

    mockMetricScoreRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'metric-1' })),
      save: jest.fn((m) => Promise.resolve(m)),
      find: jest.fn().mockResolvedValue([]),
    };

    mockAdjustmentRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'adj-1' })),
      save: jest.fn((a) => Promise.resolve(a)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };

    mockReviewRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    mockWorkEventRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    mockTaskRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    mockPresenceEventRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    mockStaffAvailService = {
      isManagerAtHotel: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KpiCalculationService,
        {
          provide: getRepositoryToken(StaffKpiPeriodScore),
          useValue: mockPeriodScoreRepo,
        },
        {
          provide: getRepositoryToken(StaffKpiMetricScore),
          useValue: mockMetricScoreRepo,
        },
        {
          provide: getRepositoryToken(StaffKpiAdjustment),
          useValue: mockAdjustmentRepo,
        },
        {
          provide: getRepositoryToken(GuestStaffReview),
          useValue: mockReviewRepo,
        },
        {
          provide: getRepositoryToken(GuestWorkEvent),
          useValue: mockWorkEventRepo,
        },
        {
          provide: getRepositoryToken(GuestWorkTask),
          useValue: mockTaskRepo,
        },
        {
          provide: getRepositoryToken(BookingPresenceEvent),
          useValue: mockPresenceEventRepo,
        },
        {
          provide: StaffAvailabilityService,
          useValue: mockStaffAvailService,
        },
      ],
    }).compile();

    service = module.get<KpiCalculationService>(KpiCalculationService);
  });

  describe('calculatePeriodScore', () => {
    it('1. Tính điểm chu kỳ thành công và tự động tái cân bằng trọng số', async () => {
      mockPeriodScoreRepo.findOne.mockResolvedValue(null);
      // Giả lập có 3 reviews khách 5 sao
      mockReviewRepo.find.mockResolvedValue([
        { stars: 5 },
        { stars: 5 },
        { stars: 5 },
      ]);

      const result = await service.calculatePeriodScore('100', '1', '2026-10');
      expect(result).toBeDefined();
      expect(result.periodKey).toBe('2026-10');
      expect(result.totalScore).toBeGreaterThan(0);
      expect(mockPeriodScoreRepo.save).toHaveBeenCalled();
      expect(mockMetricScoreRepo.save).toHaveBeenCalled();
    });

    it('2. Ghi nhận số mẫu sampleCount chính xác', async () => {
      mockPeriodScoreRepo.findOne.mockResolvedValue(null);
      mockReviewRepo.find.mockResolvedValue([
        { stars: 5 },
      ]);

      const result = await service.calculatePeriodScore('100', '1', '2026-10');
      expect(result.sampleCount).toBe(1);
    });
  });

  describe('requestAdjustment (Điều chỉnh KPI bởi Quản lý)', () => {
    it('1. Cho phép Quản lý gửi đề xuất điều chỉnh điểm kèm lý do và minh chứng', async () => {
      mockStaffAvailService.isManagerAtHotel.mockResolvedValue(true);
      mockPeriodScoreRepo.findOne.mockResolvedValue(null);

      const adj = await service.requestAdjustment('100', 'manager-1', {
        staffUserId: '1',
        periodKey: '2026-10',
        metricCode: 'GUEST_RATING',
        delta: 2,
        reason: 'Khách khiếu nại thời tiết mưa bão ngoài tầm kiểm soát',
        evidenceRef: 'https://cdn.traveleke.com/evidence/weather-log.pdf',
      });

      expect(adj).toBeDefined();
      expect(mockAdjustmentRepo.save).toHaveBeenCalled();
    });

    it('2. Chặn điều chỉnh nếu không phải Quản lý khách sạn', async () => {
      mockStaffAvailService.isManagerAtHotel.mockResolvedValue(false);

      await expect(
        service.requestAdjustment('100', 'staff-1', {
          staffUserId: '1',
          periodKey: '2026-10',
          metricCode: 'GUEST_RATING',
          delta: 2,
          reason: 'Tự điều chỉnh',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
