import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';

@Entity('hotel_assignment_dispatch_locks')
export class HotelAssignmentDispatchLock {
  @PrimaryColumn({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ type: 'bigint', unsigned: true, default: 0 })
  version!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
