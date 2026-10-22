import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum HandoverStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

@Entity({ name: 'shift_handovers' })
export class ShiftHandover {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'shift_id', type: 'bigint', unsigned: true })
  shiftId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'from_staff_id', type: 'bigint', unsigned: true })
  fromStaffId!: string;

  @Column({ name: 'to_staff_id', type: 'bigint', unsigned: true })
  toStaffId!: string;

  @Column({ name: 'pending_tasks', type: 'text', nullable: true })
  pendingTasks!: string | null;

  @Column({
    name: 'cash_amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: '0.00',
  })
  cashAmount!: string;

  @Column({ name: 'special_notes', type: 'text', nullable: true })
  specialNotes!: string | null;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 30,
    default: HandoverStatus.PENDING,
  })
  status!: HandoverStatus;

  @Column({ name: 'accepted_at', type: 'datetime', nullable: true })
  acceptedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
