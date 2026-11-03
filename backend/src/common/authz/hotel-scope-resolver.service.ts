import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

@Injectable()
export class HotelScopeResolver {
  constructor(private readonly dataSource: DataSource) {}

  private getExecutor(em?: EntityManager | any) {
    if (em && typeof em.query === 'function') return em;
    return this.dataSource;
  }

  async assertActiveHotel(hotelId: string | number, em?: EntityManager | any): Promise<{ id: string; status: string }> {
    const hid = String(hotelId || '').trim();
    if (!hid) {
      throw new BadRequestException('Không xác định được khách sạn (hotelId) của tài nguyên.');
    }
    const exec = this.getExecutor(em);
    if (typeof exec?.query !== 'function') {
      return { id: hid, status: 'ACTIVE' };
    }
    const rows = await exec.query(
      `SELECT id, status FROM hotels WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [hid],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new NotFoundException(`Không tìm thấy khách sạn #${hid}.`);
    }
    const hotel = rows[0];
    if (hotel.status && String(hotel.status) !== 'ACTIVE') {
      throw new ForbiddenException(`Khách sạn #${hid} hiện không ở trạng thái hoạt động (ACTIVE).`);
    }
    return { id: String(hotel.id), status: String(hotel.status || 'ACTIVE') };
  }

  async resolveFromBooking(
    bookingId: string | number,
    expectedHotelId?: string | number | null,
    em?: EntityManager | any,
  ) {
    const exec = this.getExecutor(em);
    const rows = await exec.query(
      `SELECT b.id AS id, b.hotel_id AS hotelId, b.user_id AS userId, b.handled_by AS handledBy, b.status AS status,
              h.status AS hotelStatus, h.deleted_at AS hotelDeletedAt
       FROM bookings b
       LEFT JOIN hotels h ON h.id = b.hotel_id
       WHERE b.id = ? LIMIT 1`,
      [bookingId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}.`);
    }
    const row = rows[0];
    if (row.hotelDeletedAt || (row.hotelStatus && String(row.hotelStatus) !== 'ACTIVE')) {
      throw new ForbiddenException(`Khách sạn #${row.hotelId} của đơn đặt phòng hiện không hoạt động.`);
    }
    if (
      expectedHotelId !== undefined &&
      expectedHotelId !== null &&
      String(expectedHotelId).trim() !== '' &&
      String(expectedHotelId) !== String(row.hotelId)
    ) {
      throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn thực tế sở hữu đơn đặt phòng.');
    }
    return {
      id: String(row.id),
      hotelId: String(row.hotelId),
      userId: String(row.userId),
      handledBy: row.handledBy ? String(row.handledBy) : null,
      status: String(row.status),
    };
  }

  async resolveFromRoom(
    roomId: string | number,
    expectedHotelId?: string | number | null,
    em?: EntityManager | any,
  ) {
    const exec = this.getExecutor(em);
    const rows = await exec.query(
      `SELECT r.id AS id, r.hotel_id AS hotelId, r.status AS status,
              h.status AS hotelStatus, h.deleted_at AS hotelDeletedAt
       FROM rooms r
       LEFT JOIN hotels h ON h.id = r.hotel_id
       WHERE r.id = ? AND r.deleted_at IS NULL LIMIT 1`,
      [roomId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new NotFoundException(`Không tìm thấy phòng #${roomId}.`);
    }
    const row = rows[0];
    if (row.hotelDeletedAt || (row.hotelStatus && String(row.hotelStatus) !== 'ACTIVE')) {
      throw new ForbiddenException(`Khách sạn #${row.hotelId} của phòng hiện không hoạt động.`);
    }
    if (
      expectedHotelId !== undefined &&
      expectedHotelId !== null &&
      String(expectedHotelId).trim() !== '' &&
      String(expectedHotelId) !== String(row.hotelId)
    ) {
      throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn thực tế sở hữu phòng.');
    }
    return {
      roomId: String(row.id),
      hotelId: String(row.hotelId),
      status: String(row.status || 'AVAILABLE'),
    };
  }

  async resolveFromShift(
    shiftId: string | number,
    expectedHotelId?: string | number | null,
    em?: EntityManager | any,
  ) {
    const exec = this.getExecutor(em);
    const rows = await exec.query(
      `SELECT s.id AS shiftId, s.hotel_id AS hotelId, s.staff_user_id AS staffUserId, s.status AS status,
              h.status AS hotelStatus, h.deleted_at AS hotelDeletedAt
       FROM staff_shifts s
       LEFT JOIN hotels h ON h.id = s.hotel_id
       WHERE s.id = ? LIMIT 1`,
      [shiftId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new NotFoundException(`Không tìm thấy ca trực #${shiftId}.`);
    }
    const row = rows[0];
    if (row.hotelDeletedAt || (row.hotelStatus && String(row.hotelStatus) !== 'ACTIVE')) {
      throw new ForbiddenException(`Khách sạn #${row.hotelId} của ca trực hiện không hoạt động.`);
    }
    if (
      expectedHotelId !== undefined &&
      expectedHotelId !== null &&
      String(expectedHotelId).trim() !== '' &&
      String(expectedHotelId) !== String(row.hotelId)
    ) {
      throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn của ca trực.');
    }
    return {
      shiftId: String(row.shiftId),
      hotelId: String(row.hotelId),
      staffUserId: String(row.staffUserId),
      status: String(row.status),
    };
  }

  async resolveFromServiceRequest(
    serviceRequestId: string | number,
    expectedBookingId?: string | number | null,
    expectedHotelId?: string | number | null,
    em?: EntityManager | any,
  ) {
    const exec = this.getExecutor(em);
    const rows = await exec.query(
      `SELECT sr.id AS serviceRequestId, sr.booking_id AS bookingId, sr.service_id AS serviceId, sr.status AS requestStatus,
              b.hotel_id AS hotelId, b.user_id AS userId, b.handled_by AS handledBy, b.status AS bookingStatus,
              rs.hotel_id AS serviceHotelId
       FROM service_requests sr
       INNER JOIN bookings b ON b.id = sr.booking_id
       LEFT JOIN room_services rs ON rs.id = sr.service_id
       WHERE sr.id = ? LIMIT 1`,
      [serviceRequestId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new NotFoundException(`Không tìm thấy phiếu yêu cầu dịch vụ #${serviceRequestId}.`);
    }
    const row = rows[0];
    if (row.serviceHotelId && String(row.serviceHotelId) !== String(row.hotelId)) {
      throw new ForbiddenException('Dịch vụ trên phiếu không thuộc cùng khách sạn với đơn đặt phòng.');
    }
    if (
      expectedBookingId !== undefined &&
      expectedBookingId !== null &&
      String(expectedBookingId).trim() !== '' &&
      String(expectedBookingId) !== String(row.bookingId)
    ) {
      throw new ForbiddenException('Phiếu yêu cầu dịch vụ không thuộc đơn đặt phòng được chỉ định.');
    }
    if (
      expectedHotelId !== undefined &&
      expectedHotelId !== null &&
      String(expectedHotelId).trim() !== '' &&
      String(expectedHotelId) !== String(row.hotelId)
    ) {
      throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn của phiếu yêu cầu dịch vụ.');
    }
    return {
      serviceRequestId: String(row.serviceRequestId),
      bookingId: String(row.bookingId),
      serviceId: String(row.serviceId),
      hotelId: String(row.hotelId),
      userId: String(row.userId),
      handledBy: row.handledBy ? String(row.handledBy) : null,
      bookingStatus: String(row.bookingStatus),
      requestStatus: String(row.requestStatus),
    };
  }

  async resolveFromBenefitAccount(
    accountId: string | number,
    expectedBookingId?: string | number | null,
    expectedHotelId?: string | number | null,
    em?: EntityManager | any,
  ) {
    const exec = this.getExecutor(em);
    const rows = await exec.query(
      `SELECT a.id AS accountId, a.booking_id AS bookingId, a.hotel_id AS accountHotelId, a.status AS accountStatus,
              b.hotel_id AS bookingHotelId, b.user_id AS userId, b.handled_by AS handledBy
       FROM booking_benefit_accounts a
       INNER JOIN bookings b ON b.id = a.booking_id
       WHERE a.id = ? LIMIT 1`,
      [accountId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new NotFoundException(`Không tìm thấy tài khoản quyền lợi #${accountId}.`);
    }
    const row = rows[0];
    if (String(row.accountHotelId) !== String(row.bookingHotelId)) {
      throw new ForbiddenException('Tài khoản quyền lợi không đồng nhất khách sạn với đơn đặt phòng.');
    }
    if (
      expectedBookingId !== undefined &&
      expectedBookingId !== null &&
      String(expectedBookingId).trim() !== '' &&
      String(expectedBookingId) !== String(row.bookingId)
    ) {
      throw new ForbiddenException('Tài khoản quyền lợi không thuộc đơn đặt phòng được chỉ định.');
    }
    if (
      expectedHotelId !== undefined &&
      expectedHotelId !== null &&
      String(expectedHotelId).trim() !== '' &&
      String(expectedHotelId) !== String(row.bookingHotelId)
    ) {
      throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn của tài khoản quyền lợi.');
    }
    return {
      accountId: String(row.accountId),
      bookingId: String(row.bookingId),
      hotelId: String(row.bookingHotelId),
      userId: String(row.userId),
      handledBy: row.handledBy ? String(row.handledBy) : null,
      status: String(row.accountStatus),
    };
  }

  async resolveFromRefundIntent(
    intentId: string | number,
    expectedHotelId?: string | number | null,
    em?: EntityManager | any,
  ) {
    const exec = this.getExecutor(em);
    const rows = await exec.query(
      `SELECT i.id AS intentId, i.account_id AS accountId, i.booking_id AS intentBookingId, i.hotel_id AS intentHotelId,
              i.channel AS channel, i.status AS status, i.requested_by AS requestedBy,
              a.booking_id AS accountBookingId, a.hotel_id AS accountHotelId,
              b.hotel_id AS bookingHotelId
       FROM promotion_refund_intents i
       INNER JOIN booking_benefit_accounts a ON a.id = i.account_id
       INNER JOIN bookings b ON b.id = a.booking_id
       WHERE i.id = ? LIMIT 1`,
      [intentId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new NotFoundException(`Không tìm thấy yêu cầu hoàn tiền #${intentId}.`);
    }
    const row = rows[0];
    if (
      String(row.intentBookingId) !== String(row.accountBookingId) ||
      String(row.intentHotelId) !== String(row.bookingHotelId) ||
      String(row.accountHotelId) !== String(row.bookingHotelId)
    ) {
      throw new ForbiddenException('Chuỗi sở hữu RefundIntent -> BenefitAccount -> Booking không hợp lệ.');
    }
    if (
      expectedHotelId !== undefined &&
      expectedHotelId !== null &&
      String(expectedHotelId).trim() !== '' &&
      String(expectedHotelId) !== String(row.bookingHotelId)
    ) {
      throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn của yêu cầu hoàn tiền.');
    }
    return {
      intentId: String(row.intentId),
      accountId: String(row.accountId),
      bookingId: String(row.accountBookingId),
      hotelId: String(row.bookingHotelId),
      channel: String(row.channel),
      status: String(row.status),
      requestedBy: row.requestedBy ? String(row.requestedBy) : null,
    };
  }

  async assertTargetsBelongToHotel(
    hotelId: string | number,
    options: { roomIds?: Array<string | number> | null; serviceIds?: Array<string | number> | null },
    em?: EntityManager | any,
  ): Promise<void> {
    const hid = String(hotelId);
    const exec = this.getExecutor(em);
    if (!exec || typeof exec.query !== 'function') return;

    const cleanRoomIds = Array.from(new Set((options.roomIds || []).map((r) => String(r).trim()).filter(Boolean)));
    if (cleanRoomIds.length > 0) {
      const ph = cleanRoomIds.map(() => '?').join(',');
      const rooms = await exec.query(
        `SELECT id, hotel_id AS hotelId FROM rooms WHERE id IN (${ph}) AND deleted_at IS NULL`,
        cleanRoomIds,
      );
      if (Array.isArray(rooms) && rooms.length > 0) {
        const wrong = rooms.find((r: any) => String(r.hotelId) !== hid);
        if (wrong || rooms.length !== cleanRoomIds.length) {
          throw new ForbiddenException('Một hoặc nhiều phòng mục tiêu không tồn tại hoặc không thuộc khách sạn đang thao tác.');
        }
      }
    }

    const cleanSvcIds = Array.from(new Set((options.serviceIds || []).map((s) => String(s).trim()).filter((s) => /^\d+$/.test(s))));
    if (cleanSvcIds.length > 0) {
      const ph = cleanSvcIds.map(() => '?').join(',');
      const services = await exec.query(`SELECT id, hotel_id AS hotelId FROM room_services WHERE id IN (${ph})`, cleanSvcIds);
      if (Array.isArray(services) && services.length > 0) {
        const wrong = services.find((s: any) => s.hotelId !== null && String(s.hotelId) !== hid);
        if (wrong || services.length !== cleanSvcIds.length) {
          throw new ForbiddenException('Một hoặc nhiều dịch vụ mục tiêu không tồn tại hoặc thuộc khách sạn khác.');
        }
      }
    }
  }
}
