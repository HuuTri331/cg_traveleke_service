import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CaseComplexity {
  STANDARD = 'STANDARD',
  PREMIUM = 'PREMIUM',
  VIP = 'VIP',
  COMPLEX = 'COMPLEX',
}

/**
 * StaffEligibilityRule
 * Quy tắc điều kiện tối thiểu để nhân viên nhận một loại case.
 * Theo tài liệu nghiệp vụ: "lọc đủ điều kiện bắt buộc trước, rồi mới so sánh tải/điểm"
 *
 * Flow phân công:
 * 1. Xác định case_complexity của booking/request
 * 2. Lấy rule tương ứng
 * 3. Lọc nhân viên: role + property + ca + skill + ngôn ngữ + no conflict + level >= min
 * 4. Từ danh sách eligible → chọn người phù hợp nhất (score, workload, continuity)
 * 5. Nếu không có ai đủ điều kiện → escalate theo escalation_role
 */
@Entity('staff_eligibility_rules')
export class StaffEligibilityRule {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'rule_code', type: 'varchar', length: 60, unique: true })
  ruleCode: string;

  @Column({ name: 'case_complexity', type: 'varchar', length: 20, default: 'STANDARD' })
  caseComplexity: CaseComplexity;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // ---- YÊU CẦU KỸ NĂNG ----
  @Column({ name: 'min_skill_level', type: 'tinyint', unsigned: true, default: 1 })
  minSkillLevel: number; // 1-5

  @Column({ name: 'required_skill_codes', type: 'json', nullable: true })
  requiredSkillCodes: string[] | null; // VD: ["FRONT_DESK", "VIP_HANDLING"]

  @Column({ name: 'required_language_codes', type: 'json', nullable: true })
  requiredLanguageCodes: string[] | null; // VD: ["en", "ja"]

  // ---- YÊU CẦU KINH NGHIỆM ----
  @Column({ name: 'min_years_experience', type: 'decimal', precision: 4, scale: 1, default: 0 })
  minYearsExperience: number;

  @Column({ name: 'min_cases_completed', type: 'smallint', unsigned: true, default: 0 })
  minCasesCompleted: number;

  // ---- ĐIỀU KIỆN LOẠI TRỪ ----
  @Column({ name: 'exclude_shadow_mode', type: 'tinyint', default: 1 })
  excludeShadowMode: boolean; // Không cho shadow mode nhận case

  @Column({ name: 'require_verified_skills', type: 'tinyint', default: 0 })
  requireVerifiedSkills: boolean; // Kỹ năng phải được Admin verify

  // ---- ESCALATION ----
  @Column({ name: 'escalation_role', type: 'varchar', length: 30, nullable: true })
  escalationRole: string | null; // Role phải xử lý nếu không có người đủ điều kiện

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: 'ACTIVE' | 'INACTIVE';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
