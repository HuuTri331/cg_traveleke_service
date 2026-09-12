import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'roles' })
export class Role {
  @PrimaryGeneratedColumn({
    type: 'bigint',
    unsigned: true,
  })
  id!: string;

  @Column({
    type: 'varchar',
    length: 50,
  })
  name!: string;  // 'ADMIN' | 'EMPLOYEE' | 'CUSTOMER'

  @Column({
    name: 'display_name',
    type: 'varchar',
    length: 100,
    default: '',
  })
  displayName!: string;

  @Column({
    type: 'text',
    nullable: true,
  })
  description!: string | null;

  @Column({
    name: 'is_system',
    type: 'tinyint',
    unsigned: true,
    default: 0,
  })
  isSystem!: number;

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