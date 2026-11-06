import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RoomIncidentStatus {
  OPEN = 'OPEN',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  OPTION_PROPOSED = 'OPTION_PROPOSED',
  CUSTOMER_ACCEPTED = 'CUSTOMER_ACCEPTED',
  CUSTOMER_REJECTED = 'CUSTOMER_REJECTED',
  RESOLVED = 'RESOLVED',
  ESCALATED = 'ESCALATED',
}

export enum RoomIncidentResolutionType {
  SAME_TYPE_REASSIGN = 'SAME_TYPE_REASSIGN',
  WAIT_FOR_CLEANING = 'WAIT_FOR_CLEANING',
  COMPLIMENTARY_UPGRADE = 'COMPLIMENTARY_UPGRADE',
  RELOCATION = 'RELOCATION',
}

@Entity('room_incidents')
export class RoomIncident {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'booking_id', type: 'bigint', unsigned: true })
  bookingId!: string;

  @Column({ name: 'hotel_id', type: 'bigint', unsigned: true })
  hotelId!: string;

  @Column({ name: 'room_type_id', type: 'bigint', unsigned: true })
  roomTypeId!: string;

  @Column({ name: 'affected_unit_id', type: 'bigint', unsigned: true, nullable: true })
  affectedUnitId!: string | null;

  @Column({ name: 'incident_type', type: 'varchar', length: 40, default: 'ROOM_NOT_READY' })
  incidentType!: string;

  @Column({ name: 'severity', type: 'varchar', length: 20, default: 'HIGH' })
  severity!: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 30,
    default: RoomIncidentStatus.OPEN,
  })
  status!: RoomIncidentStatus;

  @Column({ name: 'owner_user_id', type: 'bigint', unsigned: true })
  ownerUserId!: string;

  @Column({ name: 'manager_user_id', type: 'bigint', unsigned: true, nullable: true })
  managerUserId!: string | null;

  @Column({ name: 'sla_due_at', type: 'datetime' })
  slaDueAt!: Date;

  @Column({ name: 'resolution_type', type: 'varchar', length: 40, nullable: true })
  resolutionType!: RoomIncidentResolutionType | null;

  @Column({ name: 'proposed_unit_id', type: 'bigint', unsigned: true, nullable: true })
  proposedUnitId!: string | null;

  @Column({ name: 'proposed_room_type_id', type: 'bigint', unsigned: true, nullable: true })
  proposedRoomTypeId!: string | null;

  @Column({ name: 'compensation_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  compensationVnd!: number;

  @Column({ name: 'customer_consent_at', type: 'datetime', nullable: true })
  customerConsentAt!: Date | null;

  @Column({ name: 'resolved_at', type: 'datetime', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'resolved_by', type: 'bigint', unsigned: true, nullable: true })
  resolvedBy!: string | null;

  @Column({ name: 'source_key', type: 'varchar', length: 120, unique: true })
  sourceKey!: string;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'version', type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}

@Entity('incident_actions')
export class IncidentAction {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'incident_id', type: 'bigint', unsigned: true })
  incidentId!: string;

  @Column({ name: 'action_type', type: 'varchar', length: 40 })
  actionType!: string;

  @Column({ name: 'from_status', type: 'varchar', length: 30, nullable: true })
  fromStatus!: string | null;

  @Column({ name: 'to_status', type: 'varchar', length: 30 })
  toStatus!: string;

  @Column({ name: 'actor_id', type: 'bigint', unsigned: true })
  actorId!: string;

  @Column({ name: 'payload_json', type: 'json', nullable: true })
  payloadJson!: Record<string, any> | null;

  @Column({ name: 'note', type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'command_id', type: 'varchar', length: 100, nullable: true })
  commandId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
