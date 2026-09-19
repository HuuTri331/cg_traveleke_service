import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('hotel_staff')
export class HotelStaff {
  @PrimaryGeneratedColumn({
    type: 'bigint',
    unsigned: true,
  })
  id!: string;

  @Column({
    name: 'hotel_id',
    type: 'bigint',
    unsigned: true,
  })
  hotelId!: string;

  @Column({
    name: 'staff_user_id',
    type: 'bigint',
    unsigned: true,
  })
  staffUserId!: string;

  @Column({
    name: 'staff_role',
    type: 'varchar',
    length: 30,
    default: 'EMPLOYEE',
  })
  staffRole!: string;

  @Column({
    name: 'assigned_at',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  assignedAt!: Date;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'ACTIVE',
  })
  status!: string;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'datetime',
  })
  updatedAt!: Date;
}
