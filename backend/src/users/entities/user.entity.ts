import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type UserGender = 'MALE' | 'FEMALE' | 'OTHER';

export type UserRole = 'CUSTOMER' | 'EMPLOYEE' | 'ADMIN';

export type UserStatus = 'ACTIVE' | 'BLOCKED' | 'INACTIVE';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn({
    type: 'bigint',
    unsigned: true,
  })
  id!: string;

  @Column({
    name: 'full_name',
    type: 'varchar',
    length: 150,
  })
  fullName!: string;

  @Column({
    type: 'varchar',
    length: 255,
  })
  email!: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  phone!: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    select: false,
  })
  password!: string;

  @Column({
    name: 'avatar_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  avatarUrl!: string | null;

  @Column({
    name: 'date_of_birth',
    type: 'date',
    nullable: true,
  })
  dateOfBirth!: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  gender!: UserGender | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'CUSTOMER',
  })
  role!: UserRole;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'ACTIVE',
  })
  status!: UserStatus;

  @Column({
    name: 'email_verified_at',
    type: 'datetime',
    nullable: true,
  })
  emailVerifiedAt!: Date | null;

  @Column({
    name: 'last_login_at',
    type: 'datetime',
    nullable: true,
  })
  lastLoginAt!: Date | null;

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
}
