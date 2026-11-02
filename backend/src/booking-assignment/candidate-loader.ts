import { ServiceUnavailableException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { RoomServiceTier } from '../rooms/entities/room.entity';
import { StaffCandidate } from './assignment-policy';

export interface EligibilityRule {
  requiredSkillCodes: string[] | string | null;
  requiredLanguageCodes: string[] | string | null;
  minSkillLevel: number;
  minYearsExperience: number;
  minCasesCompleted: number;
  excludeShadowMode: number;
  requireVerifiedSkills: number;
}
export interface SkillEvidence {
  staffUserId: string;
  code: string;
  department: string;
  level: number;
  yearsExp: number | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  isShadow: number;
}
function codes(value: string[] | string | null): string[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value || [];
  if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== 'string')) {
    throw new ServiceUnavailableException('Cấu hình kỹ năng không hợp lệ.');
  }
  return parsed.map((v: string) => v.toUpperCase());
}

/** All active rules for the complexity apply; never choose an arbitrary latest rule. */
export function evaluateSkillEvidence(
  skills: SkillEvidence[], rules: EligibilityRule[], completed: number,
  languages: string[], vip: boolean,
): { skillLevel: number; yearsExp: number; hasVerifiedSkill: boolean } {
  if (!rules.length) throw new ServiceUnavailableException('Chưa cấu hình quy tắc phân công.');
  const required = [...new Set(rules.flatMap((r) => codes(r.requiredSkillCodes)))];
  // In MySQL, hotel_staff.staff_role is CHECK ('MANAGER','EMPLOYEE'). A receptionist is an
  // EMPLOYEE with a verified non-shadow FRONT_DESK skill, not housekeeping/maintenance.
  const hasVerifiedFrontDeskCapability = skills.some((s) =>
    s.department === 'FRONT_DESK' && Boolean(s.verifiedBy && s.verifiedAt) && !Number(s.isShadow));
  const relevant = skills.filter((s) => required.length
    ? required.includes(s.code.toUpperCase()) : s.department === 'FRONT_DESK');
  const verified = relevant.filter((s) => s.verifiedBy && s.verifiedAt && !Number(s.isShadow));
  const hasVerifiedSkill = hasVerifiedFrontDeskCapability && verified.length > 0 && rules.every((r) => {
    const wanted = codes(r.requiredSkillCodes);
    const usable = relevant.filter((s) =>
      (!(vip || Number(r.requireVerifiedSkills)) || (s.verifiedBy && s.verifiedAt)) &&
      (!Number(r.excludeShadowMode) || !Number(s.isShadow)) &&
      Number(s.level) >= Number(r.minSkillLevel) &&
      Number(s.yearsExp || 0) >= Number(r.minYearsExperience));
    return (wanted.length ? wanted.every((c) => usable.some((s) => s.code.toUpperCase() === c)) : usable.length > 0) &&
      completed >= Number(r.minCasesCompleted) &&
      codes(r.requiredLanguageCodes).every((c) => languages.includes(c));
  });
  // Weakest required skill limits the booking; never combine MAX from unrelated records.
  const selected = required.length ? required.map((code) => verified
    .filter((s) => s.code.toUpperCase() === code)
    .sort((a, b) => Number(b.level) - Number(a.level) || Number(b.yearsExp) - Number(a.yearsExp))[0]) : verified;
  return {
    hasVerifiedSkill,
    skillLevel: selected.length && selected.every(Boolean) ? Math.min(...selected.map((s) => Number(s.level))) : 0,
    yearsExp: selected.length && selected.every(Boolean) ? Math.min(...selected.map((s) => Number(s.yearsExp || 0))) : 0,
  };
}


export async function loadAssignmentCandidates(
  em: EntityManager, hotelId: string, tier: RoomServiceTier, now: Date,
): Promise<StaffCandidate[]> {
  const rules: EligibilityRule[] = await em.query(`SELECT
    required_skill_codes AS requiredSkillCodes, required_language_codes AS requiredLanguageCodes,
    min_skill_level AS minSkillLevel, min_years_experience AS minYearsExperience,
    min_cases_completed AS minCasesCompleted, exclude_shadow_mode AS excludeShadowMode,
    require_verified_skills AS requireVerifiedSkills
    FROM staff_eligibility_rules WHERE case_complexity = ? AND status = 'ACTIVE'`,
    [tier === RoomServiceTier.VIP ? 'VIP' : 'STANDARD']);
  if (!rules.length) throw new ServiceUnavailableException('Chưa cấu hình quy tắc phân công.');
  const staff = await em.query(`SELECT hs.staff_user_id AS staffUserId, hs.staff_role AS staffRole,
    u.full_name AS staffName, u.email AS staffEmail
    FROM hotel_staff hs JOIN users u ON u.id = hs.staff_user_id
    WHERE hs.hotel_id = ? AND hs.status = 'ACTIVE' AND u.status = 'ACTIVE'
      AND u.deleted_at IS NULL AND u.role = 'EMPLOYEE'
      AND hs.staff_role IN ('EMPLOYEE', 'RECEPTIONIST', 'FRONT_DESK', 'MANAGER')`, [hotelId]);
  const skills: SkillEvidence[] = await em.query(`SELECT ss.user_id AS staffUserId,
    sc.code, sc.department, ss.level, ss.years_exp AS yearsExp,
    ss.verified_by AS verifiedBy, ss.verified_at AS verifiedAt, ss.is_shadow AS isShadow
    FROM staff_skills ss JOIN skill_categories sc ON sc.id = ss.skill_id AND sc.status = 'ACTIVE'
    JOIN hotel_staff hs ON hs.staff_user_id = ss.user_id AND hs.hotel_id = ? AND hs.status = 'ACTIVE'
    WHERE ss.certificate_expiry IS NULL OR ss.certificate_expiry >= DATE(?)`, [hotelId, now]);
  const languages = await em.query(`SELECT ls.user_id AS staffUserId, UPPER(ls.language_code) AS code
    FROM staff_language_skills ls JOIN hotel_staff hs ON hs.staff_user_id = ls.user_id AND hs.hotel_id = ?
    WHERE ls.verified_by IS NOT NULL AND ls.verified_at IS NOT NULL
      AND (ls.certificate_expiry IS NULL OR ls.certificate_expiry >= DATE(?))`, [hotelId, now]);
  return Promise.all(staff.map(async (s: { staffUserId: string; staffRole: string; staffName: string; staffEmail: string }): Promise<StaffCandidate> => {
    const [facts] = await em.query(`SELECT
      EXISTS(SELECT 1 FROM staff_availability_blocks WHERE hotel_id = ? AND staff_user_id = ?
        AND active = 1 AND start_at <= ? AND end_at > ?) AS absent,
      EXISTS(SELECT 1 FROM guest_work_tasks WHERE hotel_id = ? AND (assigned_staff_id = ? OR active_executor_id = ?)
        AND status = 'IN_PROGRESS' AND (type IN ('CHECK_IN','CHECK_OUT','COMPLAINT_HANDLE') OR priority = 'URGENT')) AS busy,
      (SELECT COUNT(*) FROM guest_work_tasks WHERE hotel_id = ? AND (assigned_staff_id = ? OR active_executor_id = ?)
        AND status IN ('ASSIGNED','ACCEPTED','IN_PROGRESS')) AS activeLoad,
      (SELECT COUNT(DISTINCT booking_id) FROM booking_presence_events WHERE hotel_id = ? AND actor_id = ?
        AND event_type = 'DEPARTURE_CONFIRMED') AS completedCount,
      (SELECT MAX(assigned_at) FROM booking_assignments WHERE hotel_id = ? AND staff_user_id = ?) AS lastAssignedAt`,
      [hotelId, s.staffUserId, now, now, hotelId, s.staffUserId, s.staffUserId, hotelId, s.staffUserId, s.staffUserId,
        hotelId, s.staffUserId, hotelId, s.staffUserId]);
    return { ...s, staffUserId: String(s.staffUserId), userActive: true, hotelStaffActive: true,
      isAbsent: Boolean(Number(facts.absent)), isBusyNow: Boolean(Number(facts.busy)),
      activeLoad: Number(facts.activeLoad), completedCount: Number(facts.completedCount),
      lastAssignedAt: facts.lastAssignedAt ? new Date(facts.lastAssignedAt) : null,
      ...evaluateSkillEvidence(skills.filter((k) => String(k.staffUserId) === String(s.staffUserId)), rules,
        Number(facts.completedCount),
        languages.filter((l: { staffUserId: string; code: string }) => String(l.staffUserId) === String(s.staffUserId))
          .map((l: { code: string }) => l.code),
        tier === RoomServiceTier.VIP),
    };
  }));
}
