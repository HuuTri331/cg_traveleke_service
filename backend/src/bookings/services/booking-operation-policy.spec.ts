import { ConflictException, ForbiddenException } from '@nestjs/common';
import { BookingStatus } from '../entities/booking.entity';
import { BookingHold, BookingHoldStatus } from '../../inventory/entities/booking-hold.entity';
import { BookingRoom } from '../entities/booking-room.entity';
import { PaymentTransaction, PaymentTransactionStatus } from '../../payments/entities/payment-transaction.entity';
import { assertBookingOperator, assertCommittedEntitlement, coverageAllows } from './booking-operation-policy';

describe('booking-operation-policy (P0-05/P0-07/P1-05)', () => {
  const booking: any = {
    id: '10', userId: '99', hotelId: '1', handledBy: '1', status: BookingStatus.CONFIRMED,
    bookingSource: 'WEBSITE', requestedRoomCount: 2,
    checkInAt: new Date('2026-08-15T17:00:00Z'), checkOutAt: new Date('2026-08-19T17:00:00Z'),
  };

  it('rejects website check-in when hold is HELD, missing, mismatched, or payment is not PAID', async () => {
    const makeEm = (holdStatus: BookingHoldStatus | null, paid: boolean, qty = 2): any => ({
      getRepository: (ent: any) => ({
        findOne: async () => ent === BookingHold
          ? (holdStatus ? { roomId: '5', quantity: qty, status: holdStatus, checkInAt: booking.checkInAt, checkOutAt: booking.checkOutAt } : null)
          : (ent === PaymentTransaction && paid ? { status: PaymentTransactionStatus.PAID } : null),
        find: async () => ent === BookingRoom ? [{ roomId: '5', quantity: 2 }] : [],
      }),
    });
    await expect(assertCommittedEntitlement(makeEm(BookingHoldStatus.HELD, true), booking)).rejects.toThrow(ConflictException);
    await expect(assertCommittedEntitlement(makeEm(null, true), booking)).rejects.toThrow(ConflictException);
    await expect(assertCommittedEntitlement(makeEm(BookingHoldStatus.COMMITTED, false), booking)).rejects.toThrow(ConflictException);
    await expect(assertCommittedEntitlement(makeEm(BookingHoldStatus.COMMITTED, true, 1), booking)).rejects.toThrow(ConflictException);
    await expect(assertCommittedEntitlement(makeEm(BookingHoldStatus.COMMITTED, true), booking)).resolves.toBeUndefined();
  });

  it('fails closed on SQL error or cross-hotel employee; ALL_SERVICE_TASKS never covers CHECK_IN', async () => {
    const failingEm: any = { query: async () => { throw new Error('DB down'); } };
    await expect(assertBookingOperator(failingEm, booking, { id: '2', role: 'EMPLOYEE' })).rejects.toThrow('DB down');
    const crossHotelEm: any = {
      query: async (sql: string) => sql.includes('FROM users') ? [{ id: '2' }] : [],
    };
    await expect(assertBookingOperator(crossHotelEm, booking, { id: '2', role: 'EMPLOYEE' })).rejects.toThrow(ForbiddenException);
    expect(coverageAllows(['ALL_SERVICE_TASKS'], 'SERVICE_REQUEST')).toBe(true);
    expect(coverageAllows(['ALL_SERVICE_TASKS'], 'COMPLAINT_HANDLE')).toBe(false);
    expect(coverageAllows(['ALL_SERVICE_TASKS'], 'CHECK_IN')).toBe(false);
    expect(coverageAllows(['ALL_SERVICE_TASKS'], 'CHECK_OUT')).toBe(false);
  });
});
