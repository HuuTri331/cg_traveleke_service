import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Role } from './role.entity';

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

  /**
   * User có thể có nhiều Role.
   *
   * users
   *   ↓
   * users_roles
   *   ↓
   * roles
   */
  @ManyToMany(() => Role, { eager: true })
  @JoinTable({
    name: 'users_roles',

    joinColumn: {
      name: 'user_id',
      referencedColumnName: 'id',
    },

    inverseJoinColumn: {
      name: 'role_id',
      referencedColumnName: 'id',
    },
  })
  roles!: Role[];

  /**
   * Role ưu tiên:
   *
   * ADMIN > EMPLOYEE > CUSTOMER
   *
   * Getter này không tạo cột role trong database.
   */
  get role(): UserRole {
    if (!this.roles || this.roles.length === 0) {
      return 'CUSTOMER';
    }

    const priority: UserRole[] = [
      'ADMIN',
      'EMPLOYEE',
      'CUSTOMER',
    ];

    for (const role of priority) {
      if (this.roles.some((r) => r.name === role)) {
        return role;
      }
    }

    return 'CUSTOMER';
  }
}