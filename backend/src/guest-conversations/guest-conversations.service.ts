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
import { assertBookingOperator } from '../bookings/services/booking-operation-policy';
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

    await assertBookingOperator(
      this.bookingRepo.manager,
      booking,
      actor,
      actor.role !== 'CUSTOMER' ? 'MESSAGE' : undefined,
    );
    const isAuthorizedStaff = actor.role !== 'CUSTOMER';

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

    // P1-11: Tin nhắn khách tự động gắn/mở case SLA; phản hồi của lễ tân tự động liên kết case để ghi nhận First Response SLA
    if (senderRole === MessageSenderRole.CUSTOMER) {
      try {
        await this.guestWorkService.ensureCustomerMessageCase(
          booking,
          String(conv.id),
          String(saved.id),
          dto.body,
          saved.sentAt,
        );
      } catch (err: any) {
        this.logger.warn(`Failed to create/link customer message case for booking #${bookingId}: ${err?.message}`);
      }
    } else if (senderRole === MessageSenderRole.EMPLOYEE) {
      try {
        await this.guestWorkService.recordFirstResponse(
          bookingId,
          actor.id,
          saved.sentAt,
          dto.taskId,
          String(saved.id),
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

    await assertBookingOperator(this.bookingRepo.manager, booking, actor);

    const conv = await this.convRepo.findOne({ where: { bookingId } });
    if (!conv) return [];

    return await this.msgRepo.find({
      where: { conversationId: conv.id },
      order: { sentAt: 'ASC' },
    });
  }
}
