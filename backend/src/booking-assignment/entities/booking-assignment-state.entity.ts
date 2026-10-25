import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';

export enum AssignmentStateStatus {
  ASSIGNED = 'ASSIGNED',
  UNASSIGNED_CRITICAL = 'UNASSIGNED_CRITICAL',
  REPAIR_PENDING = 'REPAIR_PENDING',
}

@Entity('booking_assignment_state')
export class BookingAssignmentState {
  @PrimaryColumn({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({
    name: 'current_assignment_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  currentAssignmentId!: string | null;

  @Column({
    name: 'current_staff_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  currentStaffId!: string | null;

  @Column({
    type: 'varchar',
    length: 30,
    default: AssignmentStateStatus.ASSIGNED,
  })
  status!: AssignmentStateStatus;

  @Column({ type: 'int', unsigned: true, default: 1 })
  version!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
