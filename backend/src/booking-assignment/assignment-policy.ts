import { RoomServiceTier } from '../rooms/entities/room.entity';
import { FreshnessBucket } from './entities/booking-assignment.entity';

export interface StaffCandidate {
  staffUserId: string;
  staffName: string;
  staffEmail: string;
  staffRole: string; // 'EMPLOYEE' (receptionist) hoặc 'MANAGER'
  userActive: boolean;
  hotelStaffActive: boolean;
  onDutyShift?: boolean; // P1-01: Có ca trực ACTIVE hợp lệ tại thời điểm phân công
  isAbsent: boolean; // Có availability block nào đang hiệu lực tại thời điểm xét duyệt không
  isBusyNow?: boolean; // Đang trực tiếp thực hiện tác vụ độc quyền IN_PROGRESS tại chính thời điểm T
  hasVerifiedSkill?: boolean; // Đáp ứng yêu cầu kỹ năng xác minh (nếu khách sạn cấu hình)
  eligibleByRule?: boolean; // Bắt buộc đạt quy tắc kỹ năng/ngoại ngữ/kinh nghiệm trước khi xếp hạng
  skillLevel: number; // 1 - 5
  yearsExp: number;
  completedCount: number;
  activeLoad: number; // Tổng booking PENDING/CONFIRMED + task đang mở
  lastAssignedAt: Date | null;
}

export interface DecisionContext {
  bookingId: string;
  hotelId: string;
  serviceTier: RoomServiceTier;
  now: Date;
  candidates: StaffCandidate[];
  managers: StaffCandidate[];
}

export interface AssignmentDecision {
  outcome: 'ASSIGNED' | 'MANAGER_FALLBACK' | 'UNASSIGNED_CRITICAL';
  chosenCandidate: StaffCandidate | null;
  competencyLevel: string | null; // M1, M2, M3, M4, MANAGER
  freshnessBucket: FreshnessBucket | null;
  reason: string;
}

/**
 * Đánh giá bucket công bằng theo cửa sổ trượt:
 * - Dưới 40 phút (< 40m): HARD_COOLDOWN (loại cứng khỏi phân công tự động)
 * - Từ 40 đến dưới 120 phút (40m - <120m): SOFT_RECENT (ưu tiên thấp)
 * - Từ 120 phút trở lên (>= 120m) hoặc chưa từng được giao: FRESH (ưu tiên cao)
 */
export function evaluateFreshnessBucket(
  now: Date,
  lastAssignedAt: Date | null,
): FreshnessBucket {
  if (!lastAssignedAt) {
    return FreshnessBucket.FRESH;
  }

  const diffMs = now.getTime() - lastAssignedAt.getTime();
  if (diffMs < 0) {
    // Clock skew / timestamp trong tương lai
    return FreshnessBucket.HARD_COOLDOWN;
  }

  const diffMinutes = diffMs / 60000;

  if (diffMinutes < 40) {
    return FreshnessBucket.HARD_COOLDOWN;
  }
  if (diffMinutes < 120) {
    return FreshnessBucket.SOFT_RECENT;
  }
  return FreshnessBucket.FRESH;
}

/**
 * Kiểm tra xem ứng viên có đáp ứng mức năng lực (M1 -> M4) theo phân hạng phòng không
 */
export function checkCompetencyLevel(
  candidate: StaffCandidate,
  level: 'M1' | 'M2' | 'M3' | 'M4',
  serviceTier: RoomServiceTier,
): boolean {
  const { skillLevel, yearsExp, completedCount, hasVerifiedSkill } = candidate;

  if (serviceTier === RoomServiceTier.VIP) {
    if (hasVerifiedSkill === false) {
      return false;
    }
    switch (level) {
      case 'M1':
        return skillLevel >= 4 && (yearsExp >= 4 || completedCount >= 40);
      case 'M2':
        return skillLevel >= 3 && (yearsExp >= 2 || completedCount >= 20);
      case 'M3':
        return skillLevel >= 2 && (yearsExp >= 1 || completedCount >= 10);
      case 'M4':
        // Ngưỡng an toàn tối thiểu cho VIP: Có ít nhất 1 năm kinh nghiệm VÀ kỹ năng >= 2
        return yearsExp >= 1 && skillLevel >= 2;
    }
  }

  // STANDARD & ECONOMY: Phân bậc thực chất M1 -> M4 để chọn đúng người theo từng tầng
  switch (level) {
    case 'M1':
      return skillLevel >= 4 || (skillLevel >= 3 && (yearsExp >= 2 || completedCount >= 20));
    case 'M2':
      return skillLevel >= 3 || (skillLevel >= 2 && (yearsExp >= 1 || completedCount >= 10));
    case 'M3':
      return skillLevel >= 2 || yearsExp >= 0.5 || completedCount >= 5;
    case 'M4':
      // Mọi lễ tân hợp lệ đạt ngưỡng cơ bản
      return true;
  }
}

/**
 * Xếp hạng tất định (deterministic) giữa các ứng viên trong cùng một nhóm (FRESH hoặc SOFT_RECENT) & cùng tầng (M1..M4):
 * 1. Kỹ năng & kinh nghiệm đã xác minh cao hơn xếp trước (skillLevel DESC, yearsExp DESC, completedCount DESC)
 *    để đảm bảo ở booking đầu tiên hoặc khi cùng nhóm/tầng, người giỏi nhất được ưu tiên có giải thích
 * 2. Tải công việc ít hơn xếp trước (activeLoad ASC) để giảm dồn việc
 * 3. Lần phân công gần nhất xa hơn xếp trước (lastAssignedAt ASC, null xếp đầu)
 * 4. Mã nhân viên (staffUserId ASC) để đảm bảo kết quả luôn duy nhất và ổn định cho test
 */
export function rankCandidates(candidates: StaffCandidate[]): StaffCandidate[] {
  return [...candidates].sort((a, b) => {
    // 1. skillLevel DESC
    if (a.skillLevel !== b.skillLevel) {
      return b.skillLevel - a.skillLevel;
    }

    // 2. yearsExp DESC
    if (a.yearsExp !== b.yearsExp) {
      return b.yearsExp - a.yearsExp;
    }

    // 3. completedCount DESC
    if (a.completedCount !== b.completedCount) {
      return b.completedCount - a.completedCount;
    }

    // 4. activeLoad ASC
    if (a.activeLoad !== b.activeLoad) {
      return a.activeLoad - b.activeLoad;
    }

    // 5. lastAssignedAt ASC (null xếp trước)
    if (!a.lastAssignedAt && b.lastAssignedAt) return -1;
    if (a.lastAssignedAt && !b.lastAssignedAt) return 1;
    if (a.lastAssignedAt && b.lastAssignedAt) {
      const diffTime = a.lastAssignedAt.getTime() - b.lastAssignedAt.getTime();
      if (diffTime !== 0) return diffTime;
    }

    // 6. staffUserId ASC (Deterministic tie-breaker)
    return a.staffUserId.localeCompare(b.staffUserId, undefined, {
      numeric: true,
    });
  });
}

/**
 * Hàm quyết định phân công cốt lõi (Pure Decision Engine)
 */
export function pickReceptionist(ctx: DecisionContext): AssignmentDecision {
  const { serviceTier, now, candidates, managers } = ctx;

  // 1. Bộ lọc cơ bản:
  // - Tài khoản user ACTIVE, hotel_staff ACTIVE
  // - Đúng vai trò lễ tân (EMPLOYEE / RECEPTIONIST / FRONT_DESK)
  // - Không trong khoảng nghỉ/đi muộn đã duyệt (isAbsent = false)
  // - Không đang bận xử lý tác vụ độc quyền IN_PROGRESS tại thời điểm T (isBusyNow = false)
  // - Đáp ứng quy tắc kỹ năng/chứng chỉ xác minh bắt buộc của hạng phòng (hasVerifiedSkill !== false)
  // - Không nằm trong cửa sổ loại trừ cứng (< 40 phút)
  const validReceptionistRoles = new Set(['EMPLOYEE', 'RECEPTIONIST', 'FRONT_DESK']);
  const eligibleCandidates = candidates.filter((c) => {
    if (!c.userActive || !c.hotelStaffActive) return false;
    if (!validReceptionistRoles.has(String(c.staffRole || '').toUpperCase())) return false;
    if (c.onDutyShift === false) return false;
    if (c.isAbsent) return false;
    if (c.isBusyNow) return false;
    if (c.eligibleByRule === false) return false;
    if (c.hasVerifiedSkill === false) return false;

    const freshness = evaluateFreshnessBucket(now, c.lastAssignedAt);
    if (freshness === FreshnessBucket.HARD_COOLDOWN) {
      return false; // Loại cứng dưới 40 phút
    }

    return true;
  });

  // Phân chia theo 2 bucket được phép
  const freshCandidates = eligibleCandidates.filter(
    (c) => evaluateFreshnessBucket(now, c.lastAssignedAt) === FreshnessBucket.FRESH,
  );
  const softRecentCandidates = eligibleCandidates.filter(
    (c) =>
      evaluateFreshnessBucket(now, c.lastAssignedAt) === FreshnessBucket.SOFT_RECENT,
  );

  const competencyLevels: ('M1' | 'M2' | 'M3' | 'M4')[] = ['M1', 'M2', 'M3', 'M4'];

  // 2. Quét ưu tiên theo tài liệu đặc tả:
  // (a) Xét nhóm FRESH (>= 120 phút hoặc chưa từng nhận) từ M1 -> M4
  for (const level of competencyLevels) {
    const matched = freshCandidates.filter((c) =>
      checkCompetencyLevel(c, level, serviceTier),
    );
    if (matched.length > 0) {
      const chosen = rankCandidates(matched)[0];
      const minutesAgo = chosen.lastAssignedAt
        ? Math.round((now.getTime() - chosen.lastAssignedAt.getTime()) / 60000)
        : null;

      return {
        outcome: 'ASSIGNED',
        chosenCandidate: chosen,
        competencyLevel: level,
        freshnessBucket: FreshnessBucket.FRESH,
        reason: `Phân công tự động thành công (Nhóm FRESH, Cấp năng lực ${level}): Nhân viên ${chosen.staffName} (Level ${chosen.skillLevel}, ${chosen.yearsExp} năm KN, Tải hiện tại: ${chosen.activeLoad}, Lần nhận gần nhất: ${minutesAgo !== null ? `${minutesAgo} phút trước` : 'Chưa từng nhận'}).`,
      };
    }
  }

  // (b) Nếu không có ai trong FRESH, xét nhóm SOFT_RECENT (40 - 119 phút) từ M1 -> M4
  for (const level of competencyLevels) {
    const matched = softRecentCandidates.filter((c) =>
      checkCompetencyLevel(c, level, serviceTier),
    );
    if (matched.length > 0) {
      const chosen = rankCandidates(matched)[0];
      const minutesAgo = Math.round(
        (now.getTime() - chosen.lastAssignedAt!.getTime()) / 60000,
      );

      return {
        outcome: 'ASSIGNED',
        chosenCandidate: chosen,
        competencyLevel: level,
        freshnessBucket: FreshnessBucket.SOFT_RECENT,
        reason: `Phân công tự động thành công (Nhóm SOFT_RECENT ${minutesAgo} phút, Cấp năng lực ${level}): Nhân viên ${chosen.staffName} (Level ${chosen.skillLevel}, ${chosen.yearsExp} năm KN, Tải hiện tại: ${chosen.activeLoad}).`,
      };
    }
  }

  // (c) Nhánh Fallback: Không có lễ tân nào khả dụng -> Quản lý khách sạn (MANAGER)
  const availableManagers = managers.filter(
    (m) => m.userActive && m.hotelStaffActive && !m.isAbsent,
  );

  if (availableManagers.length > 0) {
    const chosenManager = rankCandidates(availableManagers)[0];
    return {
      outcome: 'MANAGER_FALLBACK',
      chosenCandidate: chosenManager,
      competencyLevel: 'MANAGER',
      freshnessBucket: FreshnessBucket.OVERRIDE,
      reason: `Fallback Quản lý: Toàn bộ lễ tân đang bận, trong thời gian nghỉ hoặc trong cửa sổ loại trừ 40 phút. Quản lý khách sạn (${chosenManager.staffName}) tạm thời tiếp nhận phụ trách đơn đặt phòng này.`,
    };
  }

  // (d) Nhánh Khẩn cấp: Không có cả quản lý -> UNASSIGNED_CRITICAL
  return {
    outcome: 'UNASSIGNED_CRITICAL',
    chosenCandidate: null,
    competencyLevel: null,
    freshnessBucket: null,
    reason:
      'Cảnh báo khẩn cấp: Khách sạn hiện không có bất kỳ lễ tân hoặc quản lý nào khả dụng. Đơn đặt phòng cần được can thiệp thủ công từ quản lý hoặc quản trị viên.',
  };
}
