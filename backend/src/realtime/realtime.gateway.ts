import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import {
  REALTIME_EVENTS,
  BookingCreatedPayload,
  BookingStatusChangedPayload,
  ServiceRequestedPayload,
  SystemNotificationPayload,
} from './realtime.types';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger('RealtimeGateway');

  @WebSocketServer()
  server: Server;

  afterInit(server: Server) {
    this.logger.log('🚀 [RealtimeGateway] WebSocket server initialized successfully.');
  }

  handleConnection(client: Socket) {
    this.logger.log(`🔌 Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`❌ Client disconnected: ${client.id}`);
  }

  // ============================================================
  // ROOM SUBSCRIPTION HANDLERS
  // ============================================================

  /**
   * Lễ tân / Quản lý tham gia room khách sạn tương ứng
   * Channel format: hotel:<hotelId>
   */
  @SubscribeMessage('subscribe:hotel')
  handleSubscribeHotel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { hotelId: number | string },
  ) {
    if (!data?.hotelId) return;
    const room = `hotel:${data.hotelId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);
    return { event: 'subscribed', room };
  }

  @SubscribeMessage('unsubscribe:hotel')
  handleUnsubscribeHotel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { hotelId: number | string },
  ) {
    if (!data?.hotelId) return;
    const room = `hotel:${data.hotelId}`;
    client.leave(room);
    this.logger.log(`Client ${client.id} left room ${room}`);
    return { event: 'unsubscribed', room };
  }

  /**
   * Khách hàng tham gia room cá nhân của mình để nhận trạng thái đơn đặt phòng
   * Channel format: user:<userId>
   */
  @SubscribeMessage('subscribe:user')
  handleSubscribeUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string | number },
  ) {
    if (!data?.userId) return;
    const room = `user:${data.userId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined personal room ${room}`);
    return { event: 'subscribed', room };
  }

  @SubscribeMessage('unsubscribe:user')
  handleUnsubscribeUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string | number },
  ) {
    if (!data?.userId) return;
    const room = `user:${data.userId}`;
    client.leave(room);
    this.logger.log(`Client ${client.id} left personal room ${room}`);
    return { event: 'unsubscribed', room };
  }

  /**
   * Nhân viên nội bộ / Lễ tân / Admin lắng nghe kênh thông báo chung của toàn bộ nhân viên
   * Channel format: staff:notifications
   */
  @SubscribeMessage('subscribe:staff')
  handleSubscribeStaff(@ConnectedSocket() client: Socket) {
    const room = 'staff:notifications';
    client.join(room);
    this.logger.log(`Client ${client.id} joined staff channel ${room}`);
    return { event: 'subscribed', room };
  }

  // ============================================================
  // SERVER-SIDE EMITTERS
  // ============================================================

  /**
   * Phát sự kiện khi khách hàng đặt phòng mới:
   * Gửi tới:
   * 1. hotel:<hotelId> (cho Lễ tân/Quản lý của khách sạn đó)
   * 2. staff:notifications (cho Dashboard chung)
   */
  emitBookingCreated(payload: BookingCreatedPayload) {
    if (!this.server) {
      this.logger.warn('Socket.IO server instance is not yet ready to emit');
      return;
    }

    const hotelRoom = `hotel:${payload.hotelId}`;
    this.server.to(hotelRoom).to('staff:notifications').emit(REALTIME_EVENTS.BOOKING_CREATED, payload);

    this.logger.log(
      `[Realtime] Emitted ${REALTIME_EVENTS.BOOKING_CREATED} for booking ${payload.bookingCode} to ${hotelRoom} & staff:notifications`,
    );
  }

  /**
   * Phát sự kiện khi trạng thái đơn đặt phòng thay đổi (CONFIRMED, CHECKED_IN, etc.):
   * Gửi tới:
   * 1. user:<userId> (Khách hàng nhận thông báo tức thì)
   * 2. hotel:<hotelId> (Lễ tân/Quản lý)
   * 3. staff:notifications (Hệ thống điều phối)
   */
  emitBookingStatusChanged(payload: BookingStatusChangedPayload) {
    if (!this.server) {
      this.logger.warn('Socket.IO server instance is not yet ready to emit');
      return;
    }

    const hotelRoom = `hotel:${payload.hotelId}`;
    let emitter = this.server.to(hotelRoom).to('staff:notifications');

    if (payload.userId) {
      emitter = emitter.to(`user:${payload.userId}`);
    }

    emitter.emit(REALTIME_EVENTS.BOOKING_STATUS_CHANGED, payload);

    this.logger.log(
      `[Realtime] Emitted ${REALTIME_EVENTS.BOOKING_STATUS_CHANGED} for booking ${payload.bookingCode} (${payload.oldStatus} -> ${payload.newStatus})`,
    );
  }

  /**
   * Phát sự kiện khi có yêu cầu dịch vụ phòng mới:
   * Gửi tới Lễ tân phụ trách khách sạn và kênh nhân viên.
   */
  emitServiceRequested(payload: ServiceRequestedPayload) {
    if (!this.server) return;

    let emitter = this.server.to('staff:notifications');
    if (payload.hotelId) {
      emitter = emitter.to(`hotel:${payload.hotelId}`);
    }

    emitter.emit(REALTIME_EVENTS.SERVICE_REQUESTED, payload);
    this.logger.log(
      `[Realtime] Emitted ${REALTIME_EVENTS.SERVICE_REQUESTED} for booking ${payload.bookingId} - Service: ${payload.serviceName}`,
    );
  }

  /**
   * Phát thông báo chung toàn hệ thống
   */
  emitSystemNotification(
    payload: SystemNotificationPayload,
    targetRoom?: string,
  ) {
    if (!this.server) return;

    if (targetRoom) {
      this.server.to(targetRoom).emit(REALTIME_EVENTS.SYSTEM_NOTIFICATION, payload);
    } else {
      this.server.emit(REALTIME_EVENTS.SYSTEM_NOTIFICATION, payload);
    }

    this.logger.log(`[Realtime] Emitted system notification: ${payload.title}`);
  }
}
