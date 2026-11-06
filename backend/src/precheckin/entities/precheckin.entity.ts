import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('precheckin_submissions')
export class PrecheckinSubmission {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true, unique: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'status', type: 'varchar', length: 30, default: 'DRAFT' })
  status!: 'DRAFT' | 'SUBMITTED' | 'REVIEWED' | 'REJECTED';

  @Column({ name: 'eta', type: 'datetime', nullable: true })
  eta!: Date | null;

  @Column({ name: 'arrival_transport', type: 'varchar', length: 50, nullable: true })
  arrivalTransport!: string | null;

  @Column({ name: 'bed_preference', type: 'varchar', length: 80, nullable: true })
  bedPreference!: string | null;

  @Column({ name: 'special_requests', type: 'text', nullable: true })
  specialRequests!: string | null;

  @Column({ name: 'guest_data_minimal_json', type: 'json', nullable: true })
  guestDataMinimalJson!: Record<string, any> | null;

  @Column({ name: 'submitted_at', type: 'datetime', nullable: true })
  submittedAt!: Date | null;

  @Column({ name: 'reviewed_by', type: 'bigint', unsigned: true, nullable: true })
  reviewedBy!: string | null;

  @Column({ name: 'reviewed_at', type: 'datetime', nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote!: string | null;

  @Column({ name: 'current_version', type: 'int', unsigned: true, default: 1 })
  currentVersion!: number;

  @Column({ name: 'command_id', type: 'varchar', length: 100, nullable: true })
  commandId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}

@Entity('precheckin_tokens')
export class PrecheckinToken {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'token_hash', type: 'char', length: 64, unique: true })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'datetime', nullable: true })
  usedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}

@Entity('booking_guest_occupants')
export class BookingGuestOccupant {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'room_line_id', type: 'bigint', unsigned: true, nullable: true })
  roomLineId!: string | null;

  @Column({ name: 'unit_id', type: 'bigint', unsigned: true, nullable: true })
  unitId!: string | null;

  @Column({ name: 'contact_role', type: 'varchar', length: 20, default: 'OCCUPANT' })
  contactRole!: 'BOOKER' | 'PAYER' | 'LEAD_GUEST' | 'OCCUPANT';

  @Column({ name: 'full_name', type: 'varchar', length: 150 })
  fullName!: string;

  @Column({ name: 'is_adult', type: 'tinyint', width: 1, default: 1 })
  isAdult!: boolean;

  @Column({ name: 'child_age', type: 'tinyint', unsigned: true, nullable: true })
  childAge!: number | null;

  @Column({ name: 'phone', type: 'varchar', length: 25, nullable: true })
  phone!: string | null;

  @Column({ name: 'lead_guest', type: 'tinyint', width: 1, default: 0 })
  leadGuest!: boolean;

  @Column({ name: 'verified_at', type: 'datetime', nullable: true })
  verifiedAt!: Date | null;

  @Column({ name: 'verified_by', type: 'bigint', unsigned: true, nullable: true })
  verifiedBy!: string | null;

  @Column({ name: 'version', type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
