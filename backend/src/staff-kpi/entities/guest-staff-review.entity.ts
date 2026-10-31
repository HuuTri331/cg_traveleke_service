import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ReviewStage {
  PRE_ARRIVAL = 'PRE_ARRIVAL',
  CHECK_IN = 'CHECK_IN',
  IN_STAY = 'IN_STAY',
  CHECK_OUT = 'CHECK_OUT',
}

@Entity('guest_staff_reviews')
@Index('ux_review_booking_staff_stage_user', ['bookingId', 'staffUserId', 'stage', 'reviewerUserId'], { unique: true })
@Index('ix_review_staff_stage', ['staffUserId', 'stage'])
export class GuestStaffReview {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'reviewer_user_id', type: 'bigint', unsigned: true })
  reviewerUserId!: string;

  @Column({ name: 'staff_user_id', type: 'bigint', unsigned: true })
  staffUserId!: string;

  @Column({
    type: 'varchar',
    length: 30,
  })
  stage!: ReviewStage;

  @Column({ type: 'int', unsigned: true })
  stars!: number;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'FLAGGED' | 'ARCHIVED';

  @Column({ name: 'current_revision', type: 'int', unsigned: true, default: 1 })
  currentRevision!: number;

  @CreateDateColumn({ name: 'submitted_at' })
  submittedAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

