import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GuestStaffReviewsService } from './guest-staff-reviews.service';
import {
  GuestStaffReview,
  ReviewStage,
} from './entities/guest-staff-review.entity';
import { GuestStaffReviewRevision } from './entities/guest-staff-review-revision.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { GuestWorkEvent } from '../guest-work/entities/guest-work-event.entity';

describe('GuestStaffReviewsService (Đợt 5 - Eligible Review Targets & Rating Control)', () => {
  let service: GuestStaffReviewsService;
  let mockReviewRepo: any;
  let mockRevisionRepo: any;
  let mockBookingRepo: any;
  let mockWorkEventRepo: any;

  beforeEach(async () => {
    mockReviewRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto) => ({ ...dto, id: 'rev-1', version: 1 })),
      save: jest.fn((r) => Promise.resolve(r)),
    };

    mockRevisionRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'revis-1' })),
      save: jest.fn((rv) => Promise.resolve(rv)),
    };

    mockBookingRepo = {
      findOne: jest.fn(),
    };

    mockWorkEventRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestStaffReviewsService,
        {
          provide: getRepositoryToken(GuestStaffReview),
          useValue: mockReviewRepo,
        },
        {
          provide: getRepositoryToken(GuestStaffReviewRevision),
          useValue: mockRevisionRepo,
        },
        {
          provide: getRepositoryToken(Booking),
          useValue: mockBookingRepo,
        },
        {
          provide: getRepositoryToken(GuestWorkEvent),
          useValue: mockWorkEventRepo,
        },
      ],
    }).compile();

    service = module.get<GuestStaffReviewsService>(GuestStaffReviewsService);
  });

  describe('getEligibleReviewTargets (Tìm tập nhân sự đủ điều kiện đánh giá)', () => {
    it('1. Chặn khách truy vấn đơn không phải của mình', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '10',
        userId: '999',
      });

      await expect(
        service.getEligibleReviewTargets('10', '111'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('2. Trả về đúng các đối tượng nhân sự theo từng giai đoạn thực tế', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '10',
        userId: '111',
        handledBy: '5',
        actualCheckInAt: new Date(),
        checkInConfirmedBy: '6',
        actualCheckOutAt: new Date(),
        checkOutConfirmedBy: '7',
      });

      const targets = await service.getEligibleReviewTargets('10', '111');
      expect(targets.length).toBeGreaterThanOrEqual(3);
      expect(targets.some((t) => t.stage === ReviewStage.PRE_ARRIVAL && t.staffUserId === '5')).toBe(true);
      expect(targets.some((t) => t.stage === ReviewStage.CHECK_IN && t.staffUserId === '6')).toBe(true);
      expect(targets.some((t) => t.stage === ReviewStage.CHECK_OUT && t.staffUserId === '7')).toBe(true);
    });
  });

  describe('submitReview (Gửi đánh giá)', () => {
    it('1. Chặn đánh giá nếu không phải chủ sở hữu booking', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '10',
        userId: '999',
        hotelId: '100',
        handledBy: '5',
      });

      await expect(
        service.submitReview('111', {
          bookingId: '10',
          staffUserId: '5',
          stage: ReviewStage.PRE_ARRIVAL,
          stars: 5,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('2. Gửi đánh giá hợp lệ thành công', async () => {
      mockBookingRepo.findOne.mockResolvedValue({
        id: '10',
        userId: '111',
        hotelId: '100',
        handledBy: '5',
      });
      mockReviewRepo.findOne.mockResolvedValue(null);

      const res = await service.submitReview('111', {
        bookingId: '10',
        staffUserId: '5',
        stage: ReviewStage.PRE_ARRIVAL,
        stars: 5,
        comment: 'Nhân viên hỗ trợ nhiệt tình trước khi nhận phòng',
      });

      expect(res).toBeDefined();
      expect(mockReviewRepo.save).toHaveBeenCalled();
    });
  });
});
