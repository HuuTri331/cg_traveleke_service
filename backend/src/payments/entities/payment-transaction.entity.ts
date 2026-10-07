import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PaymentTransactionStatus {
  CREATED = 'CREATED',
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  PAID_REQUIRES_REVIEW = 'PAID_REQUIRES_REVIEW',
  REFUND_PENDING = 'REFUND_PENDING',
  REFUNDED = 'REFUNDED',
}

@Entity('payment_transactions')
export class PaymentTransaction {
  @PrimaryGeneratedColumn({
    type: 'bigint',
    unsigned: true,
  })
  id!: string;

  @Column({
    name: 'booking_id',
    type: 'bigint',
    unsigned: true,
  })
  bookingId!: string;

  @Column({
    type: 'varchar',
    length: 30,
    default: 'VNPAY',
  })
  provider!: string;

  @Column({
    name: 'attempt_no',
    type: 'int',
    unsigned: true,
    default: 1,
  })
  attemptNo!: number;

  @Column({
    name: 'txn_ref',
    length: 100,
    unique: true,
  })
  txnRef!: string;

  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  amount!: string;

  @Column({
    type: 'varchar',
    length: 10,
    default: 'VND',
  })
  currency!: string;

  @Column({
    type: 'varchar',
    length: 30,
    default: PaymentTransactionStatus.CREATED,
  })
  status!: PaymentTransactionStatus;

  @Column({
    name: 'response_code',
    length: 20,
    nullable: true,
  })
  responseCode!: string | null;

  @Column({
    name: 'transaction_status',
    length: 20,
    nullable: true,
  })
  transactionStatus!: string | null;

  @Column({
    name: 'vnp_transaction_no',
    length: 50,
    nullable: true,
  })
  vnpTransactionNo!: string | null;

  @Column({
    name: 'bank_code',
    length: 30,
    nullable: true,
  })
  bankCode!: string | null;

  @Column({
    name: 'card_type',
    length: 30,
    nullable: true,
  })
  cardType!: string | null;

  @Column({
    name: 'pay_date',
    type: 'datetime',
    nullable: true,
  })
  payDate!: Date | null;

  @Column({
    name: 'gateway_expire_at',
    type: 'datetime',
    nullable: true,
  })
  gatewayExpireAt!: Date | null;

  @Column({
    name: 'paid_at',
    type: 'datetime',
    nullable: true,
  })
  paidAt!: Date | null;

  @Column({
    name: 'failed_at',
    type: 'datetime',
    nullable: true,
  })
  failedAt!: Date | null;

  @Column({
    name: 'expired_at',
    type: 'datetime',
    nullable: true,
  })
  expiredAt!: Date | null;

  @Column({
    name: 'refund_amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  refundAmount!: string;

  @Column({
    name: 'refunded_at',
    type: 'datetime',
    nullable: true,
  })
  refundedAt!: Date | null;

  @Column({
    name: 'refund_note',
    type: 'text',
    nullable: true,
  })
  refundNote!: string | null;

  @Column({
    name: 'raw_ipn_response',
    type: 'json',
    nullable: true,
  })
  rawIpnResponse!: any | null;

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
