import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SkillCategory } from './skill-category.entity';

export enum StaffEligibilityLevel {
  TRAINING = 'TRAINING',
  STANDARD = 'STANDARD',
  SENIOR = 'SENIOR',
  VIP = 'VIP',
  COMPLEX = 'COMPLEX',
}

@Entity('staff_skills')
export class StaffSkill {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId: number;

  @Column({ name: 'skill_id', type: 'bigint', unsigned: true })
  skillId: number;

  @Column({ type: 'tinyint', unsigned: true, default: 1 })
  level: number; // 1-5

  @Column({ name: 'years_exp', type: 'decimal', precision: 4, scale: 1, nullable: true })
  yearsExp: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  certificate: string | null;

  @Column({ name: 'certificate_expiry', type: 'date', nullable: true })
  certificateExpiry: Date | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'verified_by', type: 'bigint', unsigned: true, nullable: true })
  verifiedBy: number | null;

  @Column({ name: 'verified_at', type: 'datetime', nullable: true })
  verifiedAt: Date | null;

  // Shadow mode: nhân viên đang học việc dưới sự giám sát
  @Column({ name: 'is_shadow', type: 'tinyint', default: 0 })
  isShadow: boolean;

  @Column({ name: 'shadow_mentor_id', type: 'bigint', unsigned: true, nullable: true })
  shadowMentorId: number | null;

  // Mức độ eligibility cho loại case
  @Column({ name: 'eligibility_level', type: 'varchar', length: 20, default: StaffEligibilityLevel.STANDARD })
  eligibilityLevel: StaffEligibilityLevel;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => SkillCategory, (cat: SkillCategory) => cat.staffSkills)
  @JoinColumn({ name: 'skill_id' })
  skill: SkillCategory;
}
