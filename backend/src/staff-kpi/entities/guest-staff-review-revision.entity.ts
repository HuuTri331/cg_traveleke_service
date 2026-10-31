import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('guest_staff_review_revisions')
@Index('ix_revisions_review', ['reviewId', 'version'])
export class GuestStaffReviewRevision {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'review_id', type: 'bigint', unsigned: true })
  reviewId!: string;

  @Column({ type: 'int', unsigned: true })
  version!: number;

  @Column({ name: 'old_stars', type: 'int', unsigned: true })
  oldStars!: number;

  @Column({ name: 'new_stars', type: 'int', unsigned: true })
  newStars!: number;

  @Column({ name: 'old_comment', type: 'text', nullable: true })
  oldComment!: string | null;

  @Column({ name: 'new_comment', type: 'text', nullable: true })
  newComment!: string | null;

  @Column({ name: 'changed_by', type: 'bigint', unsigned: true })
  changedBy!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'changed_at' })
  changedAt!: Date;
}

