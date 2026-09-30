import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import {
  BookingCreatedPayload,
  BookingStatusChangedPayload,
  ServiceRequestedPayload,
  SystemNotificationPayload,
} from './realtime.types';

/**
 * RealtimeEventsService
 * 
 * Đóng vai trò là Application Event Dispatcher / Abstraction Layer (theo nguyên lý EventEmitter).
 * Tách biệt hoàn toàn Business Logic khỏi Socket transport:
 * - Business services (BookingsService, ServicesService, ...) chỉ cần gọi dispatch event
 * - Khi cần đổi cơ chế transport (Socket.IO -> Pusher, Kafka, RabbitMQ, Webhook...),
 *   chỉ cần sửa đổi service này mà không làm ảnh hưởng đến mã nguồn nghiệp vụ lõi.
 */
@Injectable()
export class RealtimeEventsService {
  private readonly logger = new Logger('RealtimeEventsService');

  constructor(private readonly gateway: RealtimeGateway) {}

  /**
   * Phát sự kiện nghiệp vụ khi đơn đặt phòng mới được tạo thành công
   */
  dispatchBookingCreated(payload: BookingCreatedPayload): void {
    try {
      this.gateway.emitBookingCreated(payload);
    } catch (err: any) {
      this.logger.warn(`Failed to dispatch booking.created event: ${err.message}`);
    }
  }

  /**
   * Phát sự kiện nghiệp vụ khi trạng thái đơn đặt phòng thay đổi
   */
  dispatchBookingStatusChanged(payload: BookingStatusChangedPayload): void {
    try {
      this.gateway.emitBookingStatusChanged(payload);
    } catch (err: any) {
      this.logger.warn(`Failed to dispatch booking.status_changed event: ${err.message}`);
    }
  }

  /**
   * Phát sự kiện nghiệp vụ khi có yêu cầu dịch vụ phòng mới
   */
  dispatchServiceRequested(payload: ServiceRequestedPayload): void {
    try {
      this.gateway.emitServiceRequested(payload);
    } catch (err: any) {
      this.logger.warn(`Failed to dispatch service.requested event: ${err.message}`);
    }
  }

  /**
   * Phát thông báo hệ thống chung
   */
  dispatchSystemNotification(
    payload: SystemNotificationPayload,
    targetRoom?: string,
  ): void {
    try {
      this.gateway.emitSystemNotification(payload, targetRoom);
    } catch (err: any) {
      this.logger.warn(`Failed to dispatch system.notification event: ${err.message}`);
    }
  }
}
