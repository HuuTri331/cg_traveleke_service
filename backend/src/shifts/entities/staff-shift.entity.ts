import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ShiftStatus {
  SCHEDULED = 'SCHEDULED',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Entity({ name: 'staff_shifts' })
export class StaffShift {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'staff_user_id', type: 'bigint', unsigned: true })
  staffUserId!: string;

  @Column({ name: 'shift_name', type: 'varchar', length: 100 })
  shiftName!: string;

  @Column({ name: 'shift_date', type: 'date' })
  shiftDate!: string;

  @Column({ name: 'start_time', type: 'datetime', nullable: true })
  startTime!: Date | null;

  @Column({ name: 'end_time', type: 'datetime', nullable: true })
  endTime!: Date | null;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 30,
    default: ShiftStatus.SCHEDULED,
  })
  status!: ShiftStatus;

  @Column({
    name: 'opening_cash_float',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: '0.00',
  })
  openingCashFloat!: string;

  @Column({
    name: 'closing_cash_counted',
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  closingCashCounted!: string | null;

  @Column({
    name: 'cash_variance',
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  cashVariance!: string | null;

  @Column({ name: 'handover_note', type: 'text', nullable: true })
  handoverNote!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
