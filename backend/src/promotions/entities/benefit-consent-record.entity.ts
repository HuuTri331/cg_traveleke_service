import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('benefit_consent_records')
@Index('ix_benefit_consent_account', ['accountId'])
@Index('ix_benefit_consent_booking', ['bookingId'])
export class BenefitConsentRecord {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'account_id', type: 'bigint', unsigned: true })
  accountId!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'guest_user_id', type: 'bigint', unsigned: true })
  guestUserId!: string;

  @Column({ type: 'varchar', length: 30, default: 'CUSTOMER_APP' })
  channel!: string;

  @Column({ name: 'terms_version', type: 'varchar', length: 20, default: 'v1.0' })
  termsVersion!: string;

  @Column({ name: 'evidence_ref', type: 'varchar', length: 255, nullable: true })
  evidenceRef!: string | null;

  @CreateDateColumn({ name: 'consented_at' })
  consentedAt!: Date;
}
