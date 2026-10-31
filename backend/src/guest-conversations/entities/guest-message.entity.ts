import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum MessageSenderRole {
  CUSTOMER = 'CUSTOMER',
  EMPLOYEE = 'EMPLOYEE',
  SYSTEM = 'SYSTEM',
}

@Entity('guest_messages')
@Index('ix_messages_conversation', ['conversationId', 'sentAt'])
export class GuestMessage {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'conversation_id', type: 'bigint', unsigned: true })
  conversationId!: string;

  @Column({ name: 'sender_user_id', type: 'bigint', unsigned: true })
  senderUserId!: string;

  @Column({
    name: 'sender_role',
    type: 'varchar',
    length: 20,
    default: MessageSenderRole.CUSTOMER,
  })
  senderRole!: MessageSenderRole;

  @Column({ type: 'text' })
  body!: string;

  @Column({ name: 'client_msg_id', type: 'varchar', length: 128, nullable: true })
  clientMsgId!: string | null;

  @CreateDateColumn({ name: 'sent_at' })
  sentAt!: Date;
}

