import { RoomServiceTier } from '../rooms/entities/room.entity';
import {
  evaluateFreshnessBucket,
  pickReceptionist,
  checkCompetencyLevel,
  StaffCandidate,
} from './assignment-policy';
import { FreshnessBucket } from './entities/booking-assignment.entity';

describe('assignment-policy (Cửa sổ trượt 40/120 & Năng lực M1-M4)', () => {
  const baseTime = new Date('2026-11-02T10:00:00.000Z');

  describe('evaluateFreshnessBucket', () => {
    it('Chưa từng nhận phân công (null) -> FRESH', () => {
      expect(evaluateFreshnessBucket(baseTime, null)).toBe(FreshnessBucket.FRESH);
    });

    it('Dưới 40 phút (39 phút 59 giây) -> HARD_COOLDOWN (bị loại cứng)', () => {
      const assignedAt = new Date(baseTime.getTime() - (39 * 60 + 59) * 1000);
      expect(evaluateFreshnessBucket(baseTime, assignedAt)).toBe(
        FreshnessBucket.HARD_COOLDOWN,
      );
    });

    it('Đúng 40 phút -> SOFT_RECENT (cho phép xét nhưng ưu tiên thấp)', () => {
      const assignedAt = new Date(baseTime.getTime() - 40 * 60 * 1000);
      expect(evaluateFreshnessBucket(baseTime, assignedAt)).toBe(
        FreshnessBucket.SOFT_RECENT,
      );
    });

    it('119 phút 59 giây -> SOFT_RECENT', () => {
      const assignedAt = new Date(baseTime.getTime() - (119 * 60 + 59) * 1000);
      expect(evaluateFreshnessBucket(baseTime, assignedAt)).toBe(
        FreshnessBucket.SOFT_RECENT,
      );
    });

    it('Đúng 120 phút trở lên -> FRESH (ưu tiên cao)', () => {
      const assignedAt = new Date(baseTime.getTime() - 120 * 60 * 1000);
      expect(evaluateFreshnessBucket(baseTime, assignedAt)).toBe(
        FreshnessBucket.FRESH,
      );

      const assignedLongAgo = new Date(baseTime.getTime() - 300 * 60 * 1000);
      expect(evaluateFreshnessBucket(baseTime, assignedLongAgo)).toBe(
        FreshnessBucket.FRESH,
      );
    });
  });

  describe('pickReceptionist', () => {
    const makeCandidate = (
      id: string,
      name: string,
      skillLevel: number,
      yearsExp: number,
      completedCount: number,
      activeLoad: number,
      minutesAgo: number | null,
      isAbsent = false,
      role = 'EMPLOYEE',
    ): StaffCandidate => ({
      staffUserId: id,
      staffName: name,
      staffEmail: `${id}@traveleke.com`,
      staffRole: role,
      userActive: true,
      hotelStaffActive: true,
      isAbsent,
      skillLevel,
      yearsExp,
      completedCount,
      activeLoad,
      lastAssignedAt:
        minutesAgo !== null
          ? new Date(baseTime.getTime() - minutesAgo * 60 * 1000)
          : null,
    });

    it('Tình huống 1: A nhận 25 phút trước (<40m) bị loại cứng, ưu tiên B', () => {
      const candidateA = makeCandidate('1', 'Lễ tân A (Giỏi)', 5, 5, 50, 1, 25);
      const candidateB = makeCandidate('2', 'Lễ tân B (Khá)', 4, 3, 25, 0, 150);

      const decision = pickReceptionist({
        bookingId: '101',
        hotelId: '1',
        serviceTier: RoomServiceTier.VIP,
        now: baseTime,
        candidates: [candidateA, candidateB],
        managers: [],
      });

      expect(decision.outcome).toBe('ASSIGNED');
      expect(decision.chosenCandidate?.staffUserId).toBe('2');
      expect(decision.freshnessBucket).toBe(FreshnessBucket.FRESH);
    });

    it('Tình huống 2: Người trong FRESH ở mức năng lực an toàn (C) được ưu tiên trước người SOFT_RECENT giỏi hơn (A vừa nhận 50 phút)', () => {
      // A giỏi nhất nhưng mới nhận 50 phút trước (SOFT_RECENT)
      const candidateA = makeCandidate('1', 'Lễ tân A (VIP M1)', 5, 5, 50, 1, 50);
      // C năng lực M3/M4 đủ an toàn nhưng chưa nhận booking trong 120 phút (FRESH)
      const candidateC = makeCandidate('3', 'Lễ tân C (Đủ an toàn)', 3, 2, 20, 0, 180);

      const decision = pickReceptionist({
        bookingId: '102',
        hotelId: '1',
        serviceTier: RoomServiceTier.VIP,
        now: baseTime,
        candidates: [candidateA, candidateC],
        managers: [],
      });

      expect(decision.outcome).toBe('ASSIGNED');
      expect(decision.chosenCandidate?.staffUserId).toBe('3');
      expect(decision.freshnessBucket).toBe(FreshnessBucket.FRESH);
    });

    it('Tình huống 3: Lễ tân gửi đơn xin đi muộn/nghỉ đã được duyệt (isAbsent = true) không được phân công', () => {
      const candidateA = makeCandidate('1', 'Lễ tân A (Đi muộn)', 5, 5, 50, 0, null, true);
      const candidateB = makeCandidate('2', 'Lễ tân B (Có mặt)', 3, 1, 10, 0, null, false);

      const decision = pickReceptionist({
        bookingId: '103',
        hotelId: '1',
        serviceTier: RoomServiceTier.STANDARD,
        now: baseTime,
        candidates: [candidateA, candidateB],
        managers: [],
      });

      expect(decision.outcome).toBe('ASSIGNED');
      expect(decision.chosenCandidate?.staffUserId).toBe('2');
    });

    it('Tình huống 4: Toàn bộ lễ tân bị < 40 phút hoặc vắng mặt -> Fallback Quản lý khách sạn', () => {
      const candidateA = makeCandidate('1', 'Lễ tân A', 4, 3, 30, 2, 20); // < 40m
      const managerM = makeCandidate('99', 'Quản lý Khách Sạn', 5, 8, 100, 0, null, false, 'MANAGER');

      const decision = pickReceptionist({
        bookingId: '104',
        hotelId: '1',
        serviceTier: RoomServiceTier.STANDARD,
        now: baseTime,
        candidates: [candidateA],
        managers: [managerM],
      });

      expect(decision.outcome).toBe('MANAGER_FALLBACK');
      expect(decision.chosenCandidate?.staffUserId).toBe('99');
      expect(decision.competencyLevel).toBe('MANAGER');
    });

    it('Tình huống 5: Không có cả lễ tân lẫn quản lý -> UNASSIGNED_CRITICAL', () => {
      const candidateA = makeCandidate('1', 'Lễ tân A', 4, 3, 30, 2, 15); // < 40m

      const decision = pickReceptionist({
        bookingId: '105',
        hotelId: '1',
        serviceTier: RoomServiceTier.STANDARD,
        now: baseTime,
        candidates: [candidateA],
        managers: [],
      });

      expect(decision.outcome).toBe('UNASSIGNED_CRITICAL');
      expect(decision.chosenCandidate).toBeNull();
    });

    it('P1-12: M4 cho VIP bắt buộc có ít nhất 1 năm kinh nghiệm VÀ kỹ năng >= 2', () => {
      // Ứng viên 0 năm kinh nghiệm nhưng level 2 skill -> KHÔNG đạt M4 VIP
      const candidate0Years = makeCandidate('4', 'Lễ tân mới (0 năm)', 2, 0, 0, 0, null);
      expect(checkCompetencyLevel(candidate0Years, 'M4', RoomServiceTier.VIP)).toBe(false);

      // Ứng viên 1 năm kinh nghiệm và level 2 skill -> Đạt M4 VIP
      const candidate1Year = makeCandidate('5', 'Lễ tân 1 năm', 2, 1, 5, 0, null);
      expect(checkCompetencyLevel(candidate1Year, 'M4', RoomServiceTier.VIP)).toBe(true);
    });

    it('Tính tất định (deterministic): Khi cùng mọi chỉ số, sắp xếp theo ID ổn định', () => {
      const candidate10 = makeCandidate('10', 'Nhân viên 10', 4, 2, 20, 0, null);
      const candidate05 = makeCandidate('5', 'Nhân viên 05', 4, 2, 20, 0, null);

      const decision = pickReceptionist({
        bookingId: '106',
        hotelId: '1',
        serviceTier: RoomServiceTier.STANDARD,
        now: baseTime,
        candidates: [candidate10, candidate05],
        managers: [],
      });

      expect(decision.chosenCandidate?.staffUserId).toBe('5');
    });
  });
});
