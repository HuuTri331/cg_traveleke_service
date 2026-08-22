import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum HotelStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity({ name: 'hotels' })
export class Hotel {
  @PrimaryGeneratedColumn({
    type: 'bigint',
    unsigned: true,
  })
  id!: string;

  @Column({
    name: 'hotel_type_id',
    type: 'bigint',
    unsigned: true,
  })
  hotelTypeId!: string;

  @Column({
    name: 'location_id',
    type: 'bigint',
    unsigned: true,
  })
  locationId!: string;

  @Column({
    name: 'created_by',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  createdBy!: string | null;

  @Column({
    type: 'varchar',
    length: 200,
  })
  name!: string;

  @Column({
    type: 'varchar',
    length: 220,
    unique: true,
  })
  slug!: string;

  @Column({
    type: 'longtext',
    nullable: true,
  })
  description!: string | null;

  @Column({
    name: 'star_rating',
    type: 'tinyint',
    unsigned: true,
    nullable: true,
  })
  starRating!: number | null;

  @Column({
    type: 'varchar',
    length: 255,
  })
  address!: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
  })
  latitude!: string | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
  })
  longitude!: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  phone!: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  email!: string | null;

  @Column({
    name: 'check_in_time',
    type: 'time',
    default: '14:00:00',
  })
  checkInTime!: string;

  @Column({
    name: 'check_out_time',
    type: 'time',
    default: '12:00:00',
  })
  checkOutTime!: string;

  @Column({
    name: 'cover_image_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  coverImageUrl!: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: HotelStatus.DRAFT,
  })
  status!: HotelStatus;

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

  @DeleteDateColumn({
    name: 'deleted_at',
    type: 'datetime',
    nullable: true,
  })
  deletedAt!: Date | null;

  @OneToMany('HotelImage', 'hotel')
  images?: any[];
}
