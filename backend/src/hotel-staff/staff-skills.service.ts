import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { SkillCategory } from './entities/skill-category.entity';
import { StaffSkill } from './entities/staff-skill.entity';
import {
  StaffLanguageSkill,
  LanguageLevel,
} from './entities/staff-language-skill.entity';
import {
  StaffEligibilityRule,
  CaseComplexity,
} from './entities/staff-eligibility-rule.entity';

export * from './dto/staff-skills.dto';
import {
  UpsertStaffSkillDto,
  UpdateStaffSkillDto,
  UpsertLanguageSkillDto,
  CreateSkillCategoryDto,
  UpdateSkillCategoryDto,
} from './dto/staff-skills.dto';

@Injectable()
export class StaffSkillsService {
  constructor(
    @InjectRepository(SkillCategory)
    private readonly skillCategoryRepo: Repository<SkillCategory>,

    @InjectRepository(StaffSkill)
    private readonly staffSkillRepo: Repository<StaffSkill>,

    @InjectRepository(StaffLanguageSkill)
    private readonly languageSkillRepo: Repository<StaffLanguageSkill>,

    @InjectRepository(StaffEligibilityRule)
    private readonly eligibilityRuleRepo: Repository<StaffEligibilityRule>,

    private readonly dataSource: DataSource,
  ) {}

  // ============================================================
  // SKILL CATEGORIES
  // ============================================================

  async getAllSkillCategories(
    includeInactive = false,
  ): Promise<SkillCategory[]> {
    const where = includeInactive ? {} : { status: 'ACTIVE' as const };
    return this.skillCategoryRepo.find({
      where,
      order: { name: 'ASC' },
    });
  }

  async createSkillCategory(data: {
    code: string;
    name: string;
    description?: string;
    department?: string;
  }): Promise<SkillCategory> {
    const cat = this.skillCategoryRepo.create({
      code: data.code.toUpperCase().replace(/\s+/g, '_'),
      name: data.name,
      description: data.description ?? null,
      department: data.department ?? null,
      status: 'ACTIVE',
    });
    return this.skillCategoryRepo.save(cat);
  }

  async updateSkillCategory(
    id: number,
    data: {
      name?: string;
      description?: string;
      department?: string;
      status?: 'ACTIVE' | 'INACTIVE';
    },
  ): Promise<SkillCategory> {
    const cat = await this.skillCategoryRepo.findOne({ where: { id } });
    if (!cat)
      throw new NotFoundException(`Danh mục kỹ năng #${id} không tồn tại`);
    Object.assign(cat, data);
    return this.skillCategoryRepo.save(cat);
  }

  // ============================================================
  // STAFF SKILLS – Skill Map per nhân viên
  // ============================================================

  async getSkillsByUser(userId: number): Promise<StaffSkill[]> {
    return this.staffSkillRepo.find({
      where: { userId },
      relations: ['skill'],
      order: { skill: { name: 'ASC' } },
    });
  }

  async upsertSkill(
    userId: number,
    dto: UpsertStaffSkillDto,
  ): Promise<StaffSkill> {
    // Kiểm tra kỹ năng tồn tại
    const skillCat = await this.skillCategoryRepo.findOne({
      where: { id: dto.skillId },
    });
    if (!skillCat)
      throw new NotFoundException(`Kỹ năng #${dto.skillId} không tồn tại`);

    if (dto.level < 1 || dto.level > 5) {
      throw new Error('Level kỹ năng phải từ 1 đến 5');
    }

    // Tìm bản ghi cũ nếu có (upsert)
    const existing = await this.staffSkillRepo.findOne({
      where: { userId, skillId: dto.skillId },
    });

    if (existing) {
      existing.level = dto.level;
      if (dto.yearsExp !== undefined) existing.yearsExp = dto.yearsExp;
      if (dto.certificate !== undefined) existing.certificate = dto.certificate;
      if (dto.note !== undefined) existing.note = dto.note;
      return this.staffSkillRepo.save(existing);
    }

    const newSkill = this.staffSkillRepo.create({
      userId,
      skillId: dto.skillId,
      level: dto.level,
      yearsExp: dto.yearsExp ?? null,
      certificate: dto.certificate ?? null,
      note: dto.note ?? null,
    });
    return this.staffSkillRepo.save(newSkill);
  }

  async removeSkill(
    userId: number,
    skillId: number,
  ): Promise<{ message: string }> {
    const existing = await this.staffSkillRepo.findOne({
      where: { userId, skillId },
    });
    if (!existing)
      throw new NotFoundException('Kỹ năng này chưa được gán cho nhân viên');
    await this.staffSkillRepo.remove(existing);
    return { message: 'Đã xoá kỹ năng khỏi hồ sơ nhân viên' };
  }

  /**
   * Kiểm tra xem managerUserId có phải là Quản lý (MANAGER) tại khách sạn mà targetUserId đang công tác
   * (Section 02.3 & 04.6)
   */
  async isManagerOfUser(managerUserId: number, targetUserId: number): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT m.id 
       FROM hotel_staff m
       INNER JOIN hotel_staff s ON s.hotel_id = m.hotel_id
       WHERE m.staff_user_id = ? AND m.staff_role = 'MANAGER' AND m.status = 'ACTIVE'
         AND s.staff_user_id = ? AND s.status = 'ACTIVE'
       LIMIT 1`,
      [managerUserId, targetUserId],
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  async assertCanViewSkills(actor: User | { id: string | number; role: string }, targetUserId: number): Promise<void> {
    if (!actor || actor.role === 'ADMIN') return;
    if (Number(actor.id) === Number(targetUserId)) return;

    const sharedHotelRows = await this.dataSource.query(
      `SELECT a.id
       FROM hotel_staff a
       INNER JOIN hotel_staff b ON b.hotel_id = a.hotel_id
       WHERE a.staff_user_id = ? AND a.status = 'ACTIVE'
         AND b.staff_user_id = ? AND b.status = 'ACTIVE'
       LIMIT 1`,
      [actor.id, targetUserId],
    );
    if (!Array.isArray(sharedHotelRows) || sharedHotelRows.length === 0) {
      throw new ForbiddenException(
        'CROSS_HOTEL_SKILL_ACCESS_DENIED: Bạn không thuộc cùng khách sạn để xem hồ sơ kỹ năng của nhân sự này.',
      );
    }
  }

  /**
   * Phân quyền sửa hồ sơ năng lực:
   * - Nhân viên tự sửa hồ sơ của CHÍNH MÌNH (self-declaration)
   * - Quản lý trực tiếp (MANAGER) sửa hồ sơ người thuộc đội mình
   * - Quản trị viên (ADMIN)
   * - Nhân viên đồng cấp TUYỆT ĐỐI không sửa người khác (Section 02.3)
   */
  async assertCanModifySkills(actor: User, targetUserId: number): Promise<void> {
    if (actor.role === 'ADMIN') return;
    if (Number(actor.id) === Number(targetUserId)) return;

    const isManager = await this.isManagerOfUser(Number(actor.id), targetUserId);
    if (!isManager) {
      throw new ForbiddenException(
        'Bạn chỉ có quyền chỉnh sửa hồ sơ kỹ năng của chính mình, hoặc bạn phải là Quản lý trực tiếp (MANAGER) của nhân viên này.',
      );
    }
  }

  async verifySkill(
    skillEntryId: number,
    verifiedBy: number,
    actor?: User,
  ): Promise<StaffSkill> {
    const entry = await this.staffSkillRepo.findOne({
      where: { id: skillEntryId },
    });
    if (!entry)
      throw new NotFoundException(`Mục kỹ năng #${skillEntryId} không tồn tại`);

    // Ngăn chặn tự xác minh kỹ năng của chính mình (Maker-Checker, Section 02.3 & 15.2)
    if (Number(verifiedBy) === Number(entry.userId)) {
      throw new ForbiddenException(
        'Không thể tự xác minh kỹ năng của chính mình (Nguyên tắc Maker-Checker).',
      );
    }

    if (actor && actor.role !== 'ADMIN') {
      const isManager = await this.isManagerOfUser(Number(verifiedBy), Number(entry.userId));
      if (!isManager) {
        throw new ForbiddenException(
          'Chỉ Quản lý trực tiếp (MANAGER) của khách sạn hoặc Quản trị viên mới có quyền xác minh kỹ năng này.',
        );
      }
    }

    entry.verifiedBy = verifiedBy;
    entry.verifiedAt = new Date();
    return this.staffSkillRepo.save(entry);
  }

  // ============================================================
  // SMART ASSIGNMENT SUGGESTION
  // Gợi ý nhân viên phù hợp theo độ khó dịch vụ
  // ============================================================

  async suggestStaffForService(
    skillCategoryCode: string,
    requiredLevel: number,
    hotelId?: number,
    actor?: User | { id: string | number; role: string },
  ): Promise<
    Array<{
      userId: number;
      staffName: string;
      staffEmail?: string | null;
      level: number;
      yearsExp: number | null;
      certificate: string | null;
      matchScore: number;
    }>
  > {
    const sanitizeRows = (rows: any[]) =>
      (Array.isArray(rows) ? rows : []).map((r) => {
        const copy = { ...r };
        if (actor && actor.role !== 'ADMIN') {
          delete copy.staffEmail;
        }
        return copy;
      });

    if (actor && actor.role !== 'ADMIN') {
      if (hotelId) {
        const memberRows = await this.dataSource.query(
          `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
          [hotelId, actor.id],
        );
        if (!Array.isArray(memberRows) || memberRows.length === 0) {
          throw new ForbiddenException(
            'CROSS_HOTEL_SKILL_ACCESS_DENIED: Bạn không có quyền tra cứu gợi ý nhân sự của khách sạn khác.',
          );
        }
      } else {
        const results = await this.dataSource.query(
          `
          SELECT DISTINCT
            u.id AS userId,
            u.full_name AS staffName,
            ss.level,
            ss.years_exp AS yearsExp,
            ss.certificate,
            sc.name AS skillName,
            (ss.level * 10 + IFNULL(ss.years_exp, 0)) AS matchScore
          FROM staff_skills ss
          INNER JOIN users u ON u.id = ss.user_id AND u.status = 'ACTIVE'
          INNER JOIN skill_categories sc ON sc.id = ss.skill_id AND sc.code = ?
          INNER JOIN hotel_staff hs_target ON hs_target.staff_user_id = u.id AND hs_target.status = 'ACTIVE'
          INNER JOIN hotel_staff hs_actor ON hs_actor.hotel_id = hs_target.hotel_id
            AND hs_actor.staff_user_id = ? AND hs_actor.status = 'ACTIVE'
          WHERE ss.level >= ?
          ORDER BY matchScore DESC
          LIMIT 10
          `,
          [skillCategoryCode, actor.id, requiredLevel],
        );
        return sanitizeRows(results);
      }
    }

    const results = await this.dataSource.query(
      `
      SELECT
        u.id AS userId,
        u.full_name AS staffName,
        ss.level,
        ss.years_exp AS yearsExp,
        ss.certificate,
        sc.name AS skillName,
        (ss.level * 10 + IFNULL(ss.years_exp, 0)) AS matchScore
      FROM staff_skills ss
      INNER JOIN users u ON u.id = ss.user_id AND u.status = 'ACTIVE'
      INNER JOIN skill_categories sc ON sc.id = ss.skill_id AND sc.code = ?
      ${hotelId ? "INNER JOIN hotel_staff hs ON hs.staff_user_id = u.id AND hs.hotel_id = ? AND hs.status = 'ACTIVE'" : ''}
      WHERE ss.level >= ?
      ORDER BY matchScore DESC
      LIMIT 10
      `,
      hotelId
        ? [skillCategoryCode, hotelId, requiredLevel]
        : [skillCategoryCode, requiredLevel],
    );

    return sanitizeRows(results);
  }

  // ============================================================
  // LANGUAGE SKILLS
  // ============================================================

  async getLanguagesByUser(userId: number): Promise<StaffLanguageSkill[]> {
    return this.languageSkillRepo.find({
      where: { userId },
      order: { level: 'DESC' },
    });
  }

  async upsertLanguage(
    userId: number,
    dto: UpsertLanguageSkillDto,
  ): Promise<StaffLanguageSkill> {
    const existing = await this.languageSkillRepo.findOne({
      where: { userId, languageCode: dto.languageCode },
    });

    if (existing) {
      existing.languageName = dto.languageName;
      existing.level = dto.level;
      if (dto.certificate !== undefined)
        existing.certificate = dto.certificate ?? null;
      if (dto.certificateExpiry !== undefined)
        existing.certificateExpiry = dto.certificateExpiry
          ? new Date(dto.certificateExpiry)
          : null;
      return this.languageSkillRepo.save(existing);
    }

    const newLang = this.languageSkillRepo.create({
      userId,
      languageCode: dto.languageCode,
      languageName: dto.languageName,
      level: dto.level,
      certificate: dto.certificate ?? null,
      certificateExpiry: dto.certificateExpiry
        ? new Date(dto.certificateExpiry)
        : null,
    });
    return this.languageSkillRepo.save(newLang);
  }

  async removeLanguage(
    userId: number,
    languageCode: string,
  ): Promise<{ message: string }> {
    const existing = await this.languageSkillRepo.findOne({
      where: { userId, languageCode },
    });
    if (!existing)
      throw new NotFoundException(`Ngoại ngữ ${languageCode} chưa được gán`);
    await this.languageSkillRepo.remove(existing);
    return { message: `Đã xoá ngoại ngữ ${languageCode}` };
  }

  // ============================================================
  // ELIGIBILITY RULES
  // ============================================================

  async getEligibilityRules(): Promise<StaffEligibilityRule[]> {
    return this.eligibilityRuleRepo.find({
      where: { status: 'ACTIVE' },
      order: { caseComplexity: 'ASC' },
    });
  }

  async getRuleByComplexity(
    complexity: CaseComplexity,
  ): Promise<StaffEligibilityRule | null> {
    return this.eligibilityRuleRepo.findOne({
      where: { caseComplexity: complexity, status: 'ACTIVE' },
    });
  }

  /**
   * Smart Eligibility Check
   * Kiểm tra nhân viên có đủ điều kiện nhận case với độ phức tạp nhất định không.
   * Theo tài liệu: lọc điều kiện bắt buộc trước, rồi mới so điểm/tải
   */
  async checkEligibility(
    userId: number,
    caseComplexity: CaseComplexity,
    requiredLanguage?: string,
  ): Promise<{ eligible: boolean; reasons: string[] }> {
    const rule = await this.getRuleByComplexity(caseComplexity);
    if (!rule) {
      // Fail-safe theo Section 15.4: Nếu chưa cấu hình rule cho VIP hoặc COMPLEX thì không được tự ý cho eligible: true
      if (
        caseComplexity === CaseComplexity.VIP ||
        caseComplexity === CaseComplexity.COMPLEX
      ) {
        return {
          eligible: false,
          reasons: [
            `Chưa thiết lập quy tắc năng lực cho trường hợp độ phức tạp ${caseComplexity}. Cần quản lý đánh giá trực tiếp.`,
          ],
        };
      }
      return { eligible: true, reasons: [] };
    }

    const reasons: string[] = [];
    const skills = await this.staffSkillRepo.find({
      where: { userId },
      relations: ['skill'],
    });
    const languages = await this.languageSkillRepo.find({ where: { userId } });

    // 1. Kiểm tra không đang shadow mode (nếu rule yêu cầu)
    if (rule.excludeShadowMode) {
      const hasShadow = skills.some((s) => s.isShadow);
      if (hasShadow) reasons.push('Nhân viên đang ở chế độ shadow/học việc');
    }

    // 2. Kiểm tra level kỹ năng tối thiểu
    const maxLevel = skills.reduce((max, s) => Math.max(max, s.level), 0);
    if (maxLevel < rule.minSkillLevel) {
      reasons.push(
        `Level kỹ năng ${maxLevel}/5 chưa đạt mức tối thiểu ${rule.minSkillLevel}/5`,
      );
    }

    // 3. Kiểm tra kỹ năng bắt buộc
    if (rule.requiredSkillCodes?.length) {
      for (const code of rule.requiredSkillCodes) {
        const has = skills.some((s) => s.skill?.code === code);
        if (!has) reasons.push(`Thiếu kỹ năng bắt buộc: ${code}`);
      }
    }

    // 4. Kiểm tra ngôn ngữ (Sao chép mảng mới để không làm thay đổi trực tiếp thuộc tính entity trong bộ nhớ)
    const langCodes = [...(rule.requiredLanguageCodes ?? [])];
    if (requiredLanguage && !langCodes.includes(requiredLanguage)) {
      langCodes.push(requiredLanguage);
    }
    for (const lang of langCodes) {
      const hasLang = languages.some((l) => l.languageCode === lang);
      if (!hasLang) reasons.push(`Thiếu ngoại ngữ bắt buộc: ${lang}`);
    }

    // 5. Kiểm tra chứng chỉ hết hạn
    const today = new Date();
    const expiredCerts = skills.filter(
      (s) => s.certificateExpiry && new Date(s.certificateExpiry) < today,
    );
    if (expiredCerts.length > 0 && rule.requireVerifiedSkills) {
      reasons.push(`${expiredCerts.length} chứng chỉ đã hết hạn`);
    }

    // 6. Kiểm tra số năm kinh nghiệm tối thiểu (Section 15.4)
    if (rule.minYearsExperience && Number(rule.minYearsExperience) > 0) {
      const maxYearsExp = skills.reduce(
        (max, s) => Math.max(max, Number(s.yearsExp || 0)),
        0,
      );
      if (maxYearsExp < Number(rule.minYearsExperience)) {
        reasons.push(
          `Kinh nghiệm (${maxYearsExp} năm) chưa đạt yêu cầu tối thiểu (${rule.minYearsExperience} năm)`,
        );
      }
    }

    // 7. Kiểm tra số case đã hoàn thành tối thiểu (Section 15.4)
    if (rule.minCasesCompleted && Number(rule.minCasesCompleted) > 0) {
      const [completedCountRow] = await this.dataSource.query(
        `SELECT COUNT(*) AS total FROM bookings WHERE handled_by = ? AND status = 'COMPLETED'`,
        [userId],
      );
      const completedCount = Number(completedCountRow?.total || 0);
      if (completedCount < Number(rule.minCasesCompleted)) {
        reasons.push(
          `Số đơn hoàn thành (${completedCount}) chưa đạt yêu cầu tối thiểu (${rule.minCasesCompleted})`,
        );
      }
    }

    // 8. Kiểm tra kỹ năng đã được quản lý xác minh (Section 15.2 & 15.4)
    if (rule.requireVerifiedSkills) {
      const hasVerified = skills.some((s) => s.verifiedAt !== null);
      if (!hasVerified && skills.length > 0) {
        reasons.push('Nhân viên chưa có kỹ năng nào được quản lý xác minh chính thức');
      }
    }

    return { eligible: reasons.length === 0, reasons };
  }

  // ============================================================
  // STATISTICS (mở rộng)
  // ============================================================

  async getSkillStats(
    hotelId?: number,
    actor?: User | { id: string | number; role: string },
  ): Promise<{
    totalSkillCategories: number;
    staffWithSkills: number;
    averageSkillLevel: number;
    topSkill: string | null;
    staffWithLanguages: number;
    expiringSoonCertificates: number;
  }> {
    let scopedHotelId = hotelId;
    if (actor && actor.role !== 'ADMIN') {
      if (scopedHotelId) {
        const memberRows = await this.dataSource.query(
          `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
          [scopedHotelId, actor.id],
        );
        if (!Array.isArray(memberRows) || memberRows.length === 0) {
          throw new ForbiddenException(
            'CROSS_HOTEL_SKILL_ACCESS_DENIED: Bạn không có quyền xem thống kê kỹ năng của khách sạn khác.',
          );
        }
      } else {
        const actorHotelRows = await this.dataSource.query(
          `SELECT hotel_id AS hotelId FROM hotel_staff WHERE staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
          [actor.id],
        );
        if (!Array.isArray(actorHotelRows) || actorHotelRows.length === 0) {
          throw new ForbiddenException(
            'CROSS_HOTEL_SKILL_ACCESS_DENIED: Nhân viên chưa được phân công khách sạn ACTIVE.',
          );
        }
        scopedHotelId = Number(actorHotelRows[0].hotelId);
      }
    }

    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
    const expiryDateStr = thirtyDaysLater.toISOString().split('T')[0];

    if (scopedHotelId) {
      const [
        totalSkillCategories,
        staffWithSkillsRows,
        avgRows,
        topSkillRows,
        langRows,
        expiringRows,
      ] = await Promise.all([
        this.skillCategoryRepo.count({ where: { status: 'ACTIVE' } }),
        this.dataSource.query(
          `SELECT COUNT(DISTINCT ss.user_id) AS cnt
           FROM staff_skills ss
           INNER JOIN hotel_staff hs ON hs.staff_user_id = ss.user_id AND hs.hotel_id = ? AND hs.status = 'ACTIVE'`,
          [scopedHotelId],
        ),
        this.dataSource.query(
          `SELECT AVG(ss.level) AS avg_level
           FROM staff_skills ss
           INNER JOIN hotel_staff hs ON hs.staff_user_id = ss.user_id AND hs.hotel_id = ? AND hs.status = 'ACTIVE'`,
          [scopedHotelId],
        ),
        this.dataSource.query(
          `SELECT sc.name, COUNT(ss.id) AS cnt
           FROM staff_skills ss
           INNER JOIN skill_categories sc ON sc.id = ss.skill_id
           INNER JOIN hotel_staff hs ON hs.staff_user_id = ss.user_id AND hs.hotel_id = ? AND hs.status = 'ACTIVE'
           GROUP BY sc.id ORDER BY cnt DESC LIMIT 1`,
          [scopedHotelId],
        ),
        this.dataSource.query(
          `SELECT COUNT(DISTINCT sls.user_id) AS cnt
           FROM staff_language_skills sls
           INNER JOIN hotel_staff hs ON hs.staff_user_id = sls.user_id AND hs.hotel_id = ? AND hs.status = 'ACTIVE'`,
          [scopedHotelId],
        ),
        this.dataSource.query(
          `SELECT COUNT(*) AS cnt
           FROM staff_skills ss
           INNER JOIN hotel_staff hs ON hs.staff_user_id = ss.user_id AND hs.hotel_id = ? AND hs.status = 'ACTIVE'
           WHERE ss.certificate_expiry IS NOT NULL AND ss.certificate_expiry <= ?`,
          [scopedHotelId, expiryDateStr],
        ),
      ]);

      return {
        totalSkillCategories,
        staffWithSkills: Number(staffWithSkillsRows[0]?.cnt ?? 0),
        averageSkillLevel: parseFloat(
          (Number(avgRows[0]?.avg_level) || 0).toFixed(1),
        ),
        topSkill: topSkillRows[0]?.name ?? null,
        staffWithLanguages: Number(langRows[0]?.cnt ?? 0),
        expiringSoonCertificates: Number(expiringRows[0]?.cnt ?? 0),
      };
    }

    const [
      totalSkillCategories,
      staffWithSkillsRows,
      avgRows,
      topSkillRows,
      langRows,
      expiringRows,
    ] = await Promise.all([
      this.skillCategoryRepo.count({ where: { status: 'ACTIVE' } }),
      this.dataSource.query(
        'SELECT COUNT(DISTINCT user_id) AS cnt FROM staff_skills',
      ),
      this.dataSource.query('SELECT AVG(level) AS avg_level FROM staff_skills'),
      this.dataSource.query(
        `SELECT sc.name, COUNT(ss.id) AS cnt
         FROM staff_skills ss
         INNER JOIN skill_categories sc ON sc.id = ss.skill_id
         GROUP BY sc.id ORDER BY cnt DESC LIMIT 1`,
      ),
      this.dataSource.query(
        'SELECT COUNT(DISTINCT user_id) AS cnt FROM staff_language_skills',
      ),
      this.dataSource.query(
        'SELECT COUNT(*) AS cnt FROM staff_skills WHERE certificate_expiry IS NOT NULL AND certificate_expiry <= ?',
        [expiryDateStr],
      ),
    ]);

    return {
      totalSkillCategories,
      staffWithSkills: Number(staffWithSkillsRows[0]?.cnt ?? 0),
      averageSkillLevel: parseFloat(
        (Number(avgRows[0]?.avg_level) || 0).toFixed(1),
      ),
      topSkill: topSkillRows[0]?.name ?? null,
      staffWithLanguages: Number(langRows[0]?.cnt ?? 0),
      expiringSoonCertificates: Number(expiringRows[0]?.cnt ?? 0),
    };
  }
}
