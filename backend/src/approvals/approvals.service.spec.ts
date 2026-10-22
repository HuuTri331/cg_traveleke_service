import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalRequestType, ApprovalStatus } from './entities/approval-request.entity';

describe('ApprovalsService - Maker-Checker & Manager Scoping', () => {
  let service: ApprovalsService;
  let mockRepo: any;
  let mockDataSource: any;

  beforeEach(() => {
    mockRepo = {
      findOne: jest.fn(),
      save: jest.fn((entity) => Promise.resolve(entity)),
      create: jest.fn((dto) => ({ ...dto, id: '1' })),
    };
    mockDataSource = {
      query: jest.fn(),
    };
    service = new ApprovalsService(mockRepo, mockDataSource);
  });

  describe('decide', () => {
    it('should throw ForbiddenException if reviewer is the requester (Maker-Checker violation)', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: '1',
        hotelId: '10',
        requestedBy: '5',
        status: ApprovalStatus.PENDING,
      });

      const reviewer: any = { id: '5', role: 'ADMIN' };
      const dto: any = {
        decision: ApprovalStatus.APPROVED,
        reviewNote: 'Self approve',
      };

      await expect(service.decide('1', dto, reviewer)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException if reviewer is EMPLOYEE but not MANAGER of the hotel', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: '1',
        hotelId: '10',
        requestedBy: '6',
        status: ApprovalStatus.PENDING,
      });

      // Query returns empty (reviewer is not manager of hotel 10)
      mockDataSource.query.mockResolvedValueOnce([]);

      const reviewer: any = { id: '8', role: 'EMPLOYEE' };
      const dto: any = {
        decision: ApprovalStatus.APPROVED,
        reviewNote: 'Approve refund',
      };

      await expect(service.decide('1', dto, reviewer)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should approve successfully when reviewer is authorized manager and not requester', async () => {
      const requestObj = {
        id: '1',
        hotelId: '10',
        requestedBy: '6',
        status: ApprovalStatus.PENDING,
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
      };
      mockRepo.findOne.mockResolvedValue(requestObj);

      // Reviewer is active manager
      mockDataSource.query.mockResolvedValueOnce([{ id: '1' }]);

      const reviewer: any = { id: '8', role: 'EMPLOYEE' };
      const dto: any = {
        decision: ApprovalStatus.APPROVED,
        reviewNote: 'Hợp lệ theo chính sách khách sạn',
      };

      const result = await service.decide('1', dto, reviewer);
      expect(result.success).toBe(true);
      expect(requestObj.status).toBe(ApprovalStatus.APPROVED);
      expect(requestObj.reviewedBy).toBe('8');
      expect(requestObj.reviewNote).toBe('Hợp lệ theo chính sách khách sạn');
    });
  });
});
