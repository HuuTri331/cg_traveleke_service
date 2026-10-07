import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeGateway } from './realtime.gateway';
import { REALTIME_EVENTS } from './realtime.types';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;

  const mockSocket = {
    id: 'mock-socket-123',
    data: {
      user: {
        id: 'usr-999',
        sub: 'usr-999',
        role: 'EMPLOYEE',
        hotelId: 5,
      },
    },
    join: jest.fn(),
    leave: jest.fn(),
  };

  const mockServer = {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    use: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RealtimeGateway],
    }).compile();

    gateway = module.get<RealtimeGateway>(RealtimeGateway);
    gateway.server = mockServer as any;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('room subscriptions', () => {
    it('should join hotel room on subscribe:hotel if authorized staff', () => {
      const result = gateway.handleSubscribeHotel(mockSocket as any, {
        hotelId: 5,
      });
      expect(mockSocket.join).toHaveBeenCalledWith('hotel:5');
      expect(result).toEqual({ event: 'subscribed', room: 'hotel:5' });
    });

    it('should reject subscribe:hotel if user is customer', () => {
      const customerSocket = {
        ...mockSocket,
        data: { user: { role: 'CUSTOMER', sub: 'cust-1' } },
      };
      const result = gateway.handleSubscribeHotel(customerSocket as any, {
        hotelId: 5,
      });
      expect(customerSocket.join).not.toHaveBeenCalled();
      expect(result).toEqual({ event: 'error', message: 'Forbidden: Staff access required' });
    });

    it('should leave hotel room on unsubscribe:hotel', () => {
      const result = gateway.handleUnsubscribeHotel(mockSocket as any, {
        hotelId: 5,
      });
      expect(mockSocket.leave).toHaveBeenCalledWith('hotel:5');
      expect(result).toEqual({ event: 'unsubscribed', room: 'hotel:5' });
    });

    it('should join user room on subscribe:user for own id', () => {
      const result = gateway.handleSubscribeUser(mockSocket as any, {
        userId: 'usr-999',
      });
      expect(mockSocket.join).toHaveBeenCalledWith('user:usr-999');
      expect(result).toEqual({ event: 'subscribed', room: 'user:usr-999' });
    });

    it('should reject subscribe:user if user attempts to spy on another user', () => {
      const customerSocket = {
        ...mockSocket,
        data: { user: { role: 'CUSTOMER', sub: 'cust-1' } },
        join: jest.fn(),
      };
      const result = gateway.handleSubscribeUser(customerSocket as any, {
        userId: 'cust-victim-99',
      });
      expect(customerSocket.join).not.toHaveBeenCalled();
      expect(result).toEqual({
        event: 'error',
        message: 'Forbidden: Cannot subscribe to another user room',
      });
    });

    it('should join staff notifications channel on subscribe:staff if staff/admin', () => {
      const result = gateway.handleSubscribeStaff(mockSocket as any);
      expect(mockSocket.join).toHaveBeenCalledWith('staff:notifications');
      expect(result).toEqual({
        event: 'subscribed',
        room: 'staff:notifications',
      });
    });

    it('should reject subscribe:staff if user is not staff or admin', () => {
      const unauthorizedSocket = {
        ...mockSocket,
        data: { user: { role: 'CUSTOMER', sub: 'cust-1' } },
        join: jest.fn(),
      };
      const result = gateway.handleSubscribeStaff(unauthorizedSocket as any);
      expect(unauthorizedSocket.join).not.toHaveBeenCalled();
      expect(result).toEqual({
        event: 'error',
        message: 'Forbidden: Staff access required',
      });
    });
  });

  describe('emitters', () => {
    it('should emit booking.created to hotel room and staff channel', () => {
      const payload = {
        id: 'bk-1',
        bookingCode: 'BK-2026-0001',
        hotelId: 10,
        contactName: 'Nguyen Van A',
        contactPhone: '0901234567',
        contactEmail: 'a@example.com',
        checkInAt: '2026-10-01T14:00:00.000Z',
        checkOutAt: '2026-10-03T12:00:00.000Z',
        roomCount: 1,
        estimatedTotal: '2000000',
        createdAt: '2026-09-25T00:00:00.000Z',
      };

      gateway.emitBookingCreated(payload);
      expect(mockServer.to).toHaveBeenCalledWith('hotel:10');
      expect(mockServer.to).toHaveBeenCalledWith('staff:notifications');
      expect(mockServer.emit).toHaveBeenCalledWith(
        REALTIME_EVENTS.BOOKING_CREATED,
        payload,
      );
    });

    it('should emit booking.status_changed to user room, hotel room, and staff channel', () => {
      const payload = {
        id: 'bk-1',
        bookingCode: 'BK-2026-0001',
        hotelId: 10,
        userId: 'usr-999',
        oldStatus: 'PENDING',
        newStatus: 'CONFIRMED',
        changedAt: '2026-09-25T00:00:00.000Z',
      };

      gateway.emitBookingStatusChanged(payload);
      expect(mockServer.to).toHaveBeenCalledWith('hotel:10');
      expect(mockServer.to).toHaveBeenCalledWith('staff:notifications');
      expect(mockServer.to).toHaveBeenCalledWith('user:usr-999');
      expect(mockServer.emit).toHaveBeenCalledWith(
        REALTIME_EVENTS.BOOKING_STATUS_CHANGED,
        payload,
      );
    });

    it('should emit service.requested to hotel room and staff channel', () => {
      const payload = {
        id: 7,
        bookingId: 'bk-1',
        hotelId: 10,
        serviceName: 'Giặt ủi',
        quantity: 2,
        totalPrice: 100000,
        requestedAt: '2026-09-25T00:00:00.000Z',
      };

      gateway.emitServiceRequested(payload);
      expect(mockServer.to).toHaveBeenCalledWith('staff:notifications');
      expect(mockServer.to).toHaveBeenCalledWith('hotel:10');
      expect(mockServer.emit).toHaveBeenCalledWith(
        REALTIME_EVENTS.SERVICE_REQUESTED,
        payload,
      );
    });
  });
});
