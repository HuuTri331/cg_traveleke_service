import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { StaffAvailabilityService } from './staff-availability.service';
import { AbsenceRequestStatus, AbsenceRequestType } from './entities/staff-absence-request.entity';
import { User } from '../users/entities/user.entity';

describe('StaffAvailabilityService', () => {
  let service: StaffAvailabilityService;
  let mockDataSource: any;
  let mockAbsenceRequestRepo: any;
  let mockAbsenceEventRepo: any;
  let mockAvailabilityBlockRepo: any;
  let mockHotelStaffRepo: any;

  const mockStaffUser = { id: '10', role: 'EMPLOYEE', email: 'staff@hotel.com' } as unknown as User;
  const mockManagerUser = { id: '99', role: 'EMPLOYEE', email: 'manager@hotel.com' } as unknown as User;

  beforeEach(() => {
    mockAbsenceRequestRepo = {
      create: jest.fn((dto) => ({ id: '1', ...dto })),
      save: jest.fn((entity) => Promise.resolve({ id: '1', ...entity })),
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    mockAbsenceEventRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    mockAvailabilityBlockRepo = {
      create: jest.fn((dto) => ({ id: 'block-1', ...dto })),
      save: jest.fn((entity) => Promise.resolve({ id: 'block-1', ...entity })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };

    mockHotelStaffRepo = {
      findOne: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn(async (cb) => {
        const mockManager = {
          getRepository: jest.fn((entityClass) => {
            if (entityClass.name === 'StaffAbsenceRequest') return mockAbsenceRequestRepo;
            if (entityClass.name === 'StaffAbsenceRequestEvent') return mockAbsenceEventRepo;
            if (entityClass.name === 'StaffAvailabilityBlock') return mockAvailabilityBlockRepo;
            if (entityClass.name === 'HotelStaff') return mockHotelStaffRepo;
            return {};
          }),
        };
        return cb(mockManager);
      }),
    };

    service = new StaffAvailabilityService(
      mockDataSource,
      mockAbsenceRequestRepo,
      mockAbsenceEventRepo,
      mockAvailabilityBlockRepo,
      mockHotelStaffRepo,
    );
  });

  describe('submitRequest', () => {
    it('Lỗi nếu nhân viên không thuộc khách sạn', async () => {
      mockHotelStaffRepo.findOne.mockResolvedValue(null);

      await expect(
        service.submitRequest(mockStaffUser, {
          hotelId: '1',
          requestType: AbsenceRequestType.LATE_ARRIVAL,
          startAt: '2026-11-02T08:00:00.000Z',
          endAt: '2026-11-02T10:00:00.000Z',
          reason: 'Bận việc riêng',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Lỗi nếu startAt >= endAt', async () => {
      mockHotelStaffRepo.findOne.mockResolvedValue({ id: '1', staffUserId: '10', status: 'ACTIVE' });

      await expect(
        service.submitRequest(mockStaffUser, {
          hotelId: '1',
          requestType: AbsenceRequestType.LATE_ARRIVAL,
          startAt: '2026-11-02T10:00:00.000Z',
          endAt: '2026-11-02T08:00:00.000Z',
          reason: 'Bận việc riêng',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Lỗi nếu có đơn trùng lặp khoảng thời gian', async () => {
      mockHotelStaffRepo.findOne.mockResolvedValue({ id: '1', staffUserId: '10', status: 'ACTIVE' });

      mockAbsenceRequestRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'existing-1' }),
      });

      await expect(
        service.submitRequest(mockStaffUser, {
          hotelId: '1',
          requestType: AbsenceRequestType.LEAVE,
          startAt: '2026-11-02T08:00:00.000Z',
          endAt: '2026-11-02T18:00:00.000Z',
          reason: 'Xin nghỉ phép',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('Nộp đơn thành công lưu status PENDING và ghi audit event', async () => {
      mockHotelStaffRepo.findOne.mockResolvedValue({ id: '1', staffUserId: '10', status: 'ACTIVE' });
      mockAbsenceRequestRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      const result = await service.submitRequest(mockStaffUser, {
        hotelId: '1',
        requestType: AbsenceRequestType.LATE_ARRIVAL,
        startAt: '2026-11-02T08:00:00.000Z',
        endAt: '2026-11-02T10:00:00.000Z',
        reason: 'Xin đi muộn 2 tiếng',
      });

      expect(result.status).toBe(AbsenceRequestStatus.PENDING);
      expect(mockAbsenceRequestRepo.save).toHaveBeenCalled();
      expect(mockAbsenceEventRepo.save).toHaveBeenCalled();
    });
  });

  describe('decideRequest', () => {
    it('Chặn: Quản lý không được tự duyệt đơn của chính mình', async () => {
      mockAbsenceRequestRepo.findOne.mockResolvedValue({
        id: '1',
        hotelId: '1',
        staffUserId: '99', // Trùng actor.id
        status: AbsenceRequestStatus.PENDING,
        version: 1,
      });

      mockHotelStaffRepo.findOne.mockResolvedValue({
        hotelId: '1',
        staffUserId: '99',
        staffRole: 'MANAGER',
        status: 'ACTIVE',
      });

      await expect(
        service.decideRequest(mockManagerUser, '1', { decision: 'APPROVE' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Duyệt APPROVE: Chuyển status APPROVED và tạo AvailabilityBlock', async () => {
      const request = {
        id: '1',
        hotelId: '1',
        staffUserId: '10',
        requestType: AbsenceRequestType.LATE_ARRIVAL,
        startAt: new Date('2026-11-02T08:00:00.000Z'),
        endAt: new Date('2026-11-02T10:00:00.000Z'),
        reason: 'Khám bệnh',
        status: AbsenceRequestStatus.PENDING,
        version: 1,
      };

      mockAbsenceRequestRepo.findOne.mockResolvedValue(request);
      mockHotelStaffRepo.findOne.mockResolvedValue({
        hotelId: '1',
        staffUserId: '99',
        staffRole: 'MANAGER',
        status: 'ACTIVE',
      });

      const updated = await service.decideRequest(mockManagerUser, '1', {
        decision: 'APPROVE',
        reviewNote: 'Đồng ý cho đi muộn',
      });

      expect(updated.status).toBe(AbsenceRequestStatus.APPROVED);
      expect(mockAvailabilityBlockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          hotelId: '1',
          staffUserId: '10',
          active: 1,
        }),
      );
    });

    it('Từ chối REJECT: Chuyển status REJECTED và không tạo AvailabilityBlock', async () => {
      const request = {
        id: '1',
        hotelId: '1',
        staffUserId: '10',
        requestType: AbsenceRequestType.LEAVE,
        startAt: new Date('2026-11-02T08:00:00.000Z'),
        endAt: new Date('2026-11-02T18:00:00.000Z'),
        reason: 'Việc bận',
        status: AbsenceRequestStatus.PENDING,
        version: 1,
      };

      mockAbsenceRequestRepo.findOne.mockResolvedValue(request);
      mockHotelStaffRepo.findOne.mockResolvedValue({
        hotelId: '1',
        staffUserId: '99',
        staffRole: 'MANAGER',
        status: 'ACTIVE',
      });

      const updated = await service.decideRequest(mockManagerUser, '1', {
        decision: 'REJECT',
        reviewNote: 'Khách sạn đang đông khách, không thể duyệt',
      });

      expect(updated.status).toBe(AbsenceRequestStatus.REJECTED);
      expect(mockAvailabilityBlockRepo.save).not.toHaveBeenCalled();
    });
  });
});
