import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('hotel_business_settings')
export class HotelBusinessSetting {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true, unique: true })
  hotelId!: string;

  @Column({ name: 'iana_timezone', type: 'varchar', length: 64, default: 'Asia/Ho_Chi_Minh' })
  ianaTimezone!: string;

  @Column({ name: 'locale', type: 'varchar', length: 16, default: 'vi-VN' })
  locale!: string;

  @Column({ name: 'currency', type: 'char', length: 3, default: 'VND' })
  currency!: string;

  @Column({ name: 'cutoff_time', type: 'time', default: '04:00:00' })
  cutoffTime!: string;

  @Column({ name: 'require_room_inspection', type: 'tinyint', width: 1, default: 1 })
  requireRoomInspection!: boolean;

  @Column({ name: 'allow_guest_room_number_reveal', type: 'tinyint', width: 1, default: 0 })
  allowGuestRoomNumberReveal!: boolean;

  @Column({ name: 'free_early_checkin_minutes', type: 'smallint', unsigned: true, default: 60 })
  freeEarlyCheckinMinutes!: number;

  @Column({ name: 'free_late_checkout_minutes', type: 'smallint', unsigned: true, default: 30 })
  freeLateCheckoutMinutes!: number;

  @Column({ name: 'version', type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
