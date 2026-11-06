import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum BookingDocumentType {
  PAYMENT_RECEIPT = 'PAYMENT_RECEIPT',
  FOLIO_STATEMENT = 'FOLIO_STATEMENT',
  REFUND_CREDIT_NOTE = 'REFUND_CREDIT_NOTE',
}

@Entity('booking_documents')
export class BookingDocument {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'folio_id', type: 'bigint', unsigned: true, nullable: true })
  folioId!: string | null;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'document_number', type: 'varchar', length: 50, unique: true })
  documentNumber!: string;

  @Column({ name: 'type', type: 'varchar', length: 30 })
  type!: BookingDocumentType;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'ISSUED' })
  status!: 'ISSUED' | 'VOIDED';

  @Column({ name: 'version', type: 'int', unsigned: true, default: 1 })
  version!: number;

  @Column({ name: 'amount_vnd', type: 'decimal', precision: 15, scale: 2 })
  amountVnd!: number;

  @Column({ name: 'buyer_info_json', type: 'json', nullable: true })
  buyerInfoJson!: Record<string, any> | null;

  @Column({ name: 'source_folio_snapshot', type: 'json' })
  sourceFolioSnapshot!: Record<string, any>;

  @Column({ name: 'storage_key', type: 'varchar', length: 255 })
  storageKey!: string;

  @Column({ name: 'sha256', type: 'char', length: 64 })
  sha256!: string;

  @Column({ name: 'issued_by', type: 'bigint', unsigned: true, nullable: true })
  issuedBy!: string | null;

  @CreateDateColumn({ name: 'issued_at', type: 'datetime' })
  issuedAt!: Date;

  @Column({ name: 'voided_at', type: 'datetime', nullable: true })
  voidedAt!: Date | null;

  @Column({ name: 'void_reason', type: 'varchar', length: 255, nullable: true })
  voidReason!: string | null;

  @Column({ name: 'command_id', type: 'varchar', length: 100, unique: true })
  commandId!: string;
}
