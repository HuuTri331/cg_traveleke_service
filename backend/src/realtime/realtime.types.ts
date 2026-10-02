/**
 * Realtime Event Names & Payload Definitions for Traveleke
 * Phục vụ đồng bộ tức thời giữa Khách hàng, Nhân viên Lễ tân và Quản lý khách sạn.
 */

export const REALTIME_EVENTS = {
  // Booking events
  BOOKING_CREATED: 'booking.created',
  BOOKING_STATUS_CHANGED: 'booking.status_changed',

  // Room service request events
  SERVICE_REQUESTED: 'service.requested',

  // General system notification
  SYSTEM_NOTIFICATION: 'system.notification',
} as const;

export type RealtimeEventName =
  (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

/**
 * Payload khi khách hàng hoàn tất đặt phòng mới
 */
export interface BookingCreatedPayload {
  id: string;
  bookingCode: string;
  hotelId: string | number;
  hotelName?: string;
  userId?: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  checkInAt: string;
  checkOutAt: string;
  roomName?: string;
  roomCount: number;
  estimatedTotal: string;
  createdAt: string;
}

/**
 * Payload khi lễ tân hoặc quản lý cập nhật trạng thái đơn đặt phòng
 * (PENDING -> CONFIRMED -> CHECKED_IN -> COMPLETED / CANCELLED / REJECTED)
 */
export interface BookingStatusChangedPayload {
  id: string;
  bookingCode: string;
  hotelId: string | number;
  userId?: string | null;
  oldStatus: string;
  newStatus: string;
  changedAt: string;
  note?: string;
  changedByName?: string;
}

/**
 * Payload khi khách gửi yêu cầu dịch vụ phòng (dọn phòng, khăn tắm, nước uống, đồ ăn)
 */
export interface ServiceRequestedPayload {
  id: number;
  bookingId: string | number;
  hotelId?: string | number;
  serviceName: string;
  quantity: number;
  totalPrice: number;
  note?: string;
  requestedAt: string;
}

/**
 * Payload thông báo chung toàn hệ thống
 */
export interface SystemNotificationPayload {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: string;
  data?: Record<string, any>;
}
