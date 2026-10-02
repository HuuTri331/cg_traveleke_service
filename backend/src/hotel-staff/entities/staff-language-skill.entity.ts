import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum LanguageLevel {
  BASIC = 'BASIC',
  INTERMEDIATE = 'INTERMEDIATE',
  ADVANCED = 'ADVANCED',
  NATIVE = 'NATIVE',
}

/**
 * StaffLanguageSkill
 * Ngoại ngữ của nhân viên – bắt buộc khi phân công tour quốc tế hoặc khách VIP.
 * Theo tài liệu nghiệp vụ:
 * - "Ngôn ngữ bắt buộc" là một trong các điều kiện lọc phân công
 * - "Chứng chỉ có hạn" (IELTS, TOEIC, HSK) phải kiểm tra expiry trước khi dùng
 */
@Entity('staff_language_skills')
export class StaffLanguageSkill {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId: number;

  @Column({ name: 'language_code', type: 'varchar', length: 10 })
  languageCode: string; // vi, en, zh, ja, ko, fr, de...

  @Column({ name: 'language_name', type: 'varchar', length: 60 })
  languageName: string;

  @Column({ type: 'varchar', length: 20, default: 'BASIC' })
  level: LanguageLevel;

  @Column({ type: 'varchar', length: 200, nullable: true })
  certificate: string | null; // IELTS 7.0, TOEIC 850, HSK 5...

  @Column({ name: 'certificate_expiry', type: 'date', nullable: true })
  certificateExpiry: Date | null;

  @Column({
    name: 'verified_by',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  verifiedBy: number | null;

  @Column({ name: 'verified_at', type: 'datetime', nullable: true })
  verifiedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
