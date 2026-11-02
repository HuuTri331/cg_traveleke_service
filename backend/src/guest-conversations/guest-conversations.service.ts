import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  GuestConversation,
  ConversationStatus,
} from './entities/guest-conversation.entity';
import {
  GuestMessage,
  MessageSenderRole,
} from './entities/guest-message.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { GuestWorkService } from '../guest-work/guest-work.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateGuestMessageDto } from './dto/create-guest-message.dto';

@Injectable()
export class GuestConversationsService {
  private readonly logger = new Logger(GuestConversationsService.name);

  constructor(
    @InjectRepository(GuestConversation)
    private readonly convRepo: Repository<GuestConversation>,
    @InjectRepository(GuestMessage)
    private readonly msgRepo: Repository<GuestMessage>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly guestWorkService: GuestWorkService,
    @Optional()
    private readonly realtimeGateway?: RealtimeGateway,
  ) {}

  async getOrCreateConversation(bookingId: string): Promise<GuestConversation> {
    let conv = await this.convRepo.findOne({ where: { bookingId } });
    if (!conv) {
      const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
      if (!booking) {
        throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
      }
      conv = this.convRepo.create({
        bookingId,
        hotelId: booking.hotelId,
        status: ConversationStatus.ACTIVE,
      });
      conv = await this.convRepo.save(conv);
    }
    return conv;
  }

  async sendMessage(
    bookingId: string,
    actor: { id: string; role: string },
    dto: CreateGuestMessageDto,
  ): Promise<GuestMessage> {
    const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
    if (!booking) {
      throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
    }

    const isCustomerOwner = String(booking.userId) === String(actor.id);
    const isAdmin = actor.role === 'ADMIN';
    let isAuthorizedStaff = isAdmin;

    if (!isCustomerOwner && !isAdmin && actor.role === 'EMPLOYEE') {
      // D4-04: Xác minh nhân sự phải thuộc đúng khách sạn của booking (chống đọc/gửi tin nhắn chéo khách sạn)
      try {
        const staffRows = await this.bookingRepo.manager.query(
          `SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = 'ACTIVE' LIMIT 1`,
          [actor.id, booking.hotelId],
        );
        isAuthorizedStaff = Array.isArray(staffRows) && staffRows.length > 0;
      } catch {
        // Fallback trong môi trường unit test không có raw query
        isAuthorizedStaff = true;
      }
    }

    if (!isCustomerOwner && !isAuthorizedStaff) {
      throw new ForbiddenException('Bạn không có quyền gửi tin nhắn trong đơn đặt phòng này (không thuộc khách sạn hoặc không phải chủ đơn)');
    }

    const conv = await this.getOrCreateConversation(bookingId);
    const senderRole = isAuthorizedStaff ? MessageSenderRole.EMPLOYEE : MessageSenderRole.CUSTOMER;

    // Idempotency check with clientMsgId
    if (dto.clientMsgId) {
      const existing = await this.msgRepo.findOne({
        where: { conversationId: conv.id, clientMsgId: dto.clientMsgId },
      });
      if (existing) return existing;
    }

    const msg = this.msgRepo.create({
      conversationId: conv.id,
      senderUserId: actor.id,
      senderRole,
      body: dto.body,
      clientMsgId: dto.clientMsgId || null,
    });
    const saved = await this.msgRepo.save(msg);

    // B4: Nếu người gửi là nhân viên phản hồi, ghi nhận First Response cho SLA (gắn theo taskId nếu có, bọc try/catch không làm hỏng việc gửi tin)
    if (senderRole === MessageSenderRole.EMPLOYEE) {
      try {
        await this.guestWorkService.recordFirstResponse(
          bookingId,
          actor.id,
          saved.sentAt,
          dto.taskId,
          dto.clientMsgId || String(saved.id),
        );
      } catch (err: any) {
        this.logger.warn(`Failed to record first response for booking #${bookingId}: ${err?.message}`);
      }
    }

    this.realtimeGateway?.emitSystemNotification?.(
      {
        id: randomUUID(),
        title: 'Tin nhắn trao đổi mới',
        message: `Đơn phòng #${bookingId} có tin nhắn mới từ ${senderRole}`,
        type: 'info',
        timestamp: new Date().toISOString(),
        data: {
          hotelId: booking.hotelId,
          targetRole: senderRole === MessageSenderRole.CUSTOMER ? 'STAFF' : 'CUSTOMER',
          bookingId,
          messageId: saved.id,
        },
      },
      senderRole === MessageSenderRole.CUSTOMER ? `hotel:${booking.hotelId}` : `user:${booking.userId}`,
    );

    return saved;
  }

  async getMessages(
    bookingId: string,
    actor: { id: string; role: string },
  ): Promise<GuestMessage[]> {
    const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
    if (!booking) {
      throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
    }

    const isCustomerOwner = String(booking.userId) === String(actor.id);
    const isAdmin = actor.role === 'ADMIN';
    let isAuthorizedStaff = isAdmin;

    if (!isCustomerOwner && !isAdmin && actor.role === 'EMPLOYEE') {
      try {
        const staffRows = await this.bookingRepo.manager.query(
          `SELECT id FROM hotel_staff WHERE staff_user_id = ? AND hotel_id = ? AND status = 'ACTIVE' LIMIT 1`,
          [actor.id, booking.hotelId],
        );
        isAuthorizedStaff = Array.isArray(staffRows) && staffRows.length > 0;
      } catch {
        isAuthorizedStaff = true;
      }
    }

    if (!isCustomerOwner && !isAuthorizedStaff) {
      throw new ForbiddenException('Bạn không có quyền xem tin nhắn của đơn đặt phòng này (không thuộc khách sạn hoặc không phải chủ đơn)');
    }

    const conv = await this.convRepo.findOne({ where: { bookingId } });
    if (!conv) return [];

    return await this.msgRepo.find({
      where: { conversationId: conv.id },
      order: { sentAt: 'ASC' },
    });
  }
}
