import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SkillCategory } from './entities/skill-category.entity';
import { StaffSkill } from './entities/staff-skill.entity';

export class UpsertStaffSkillDto {
  skillId: number;
  level: number; // 1-5
  yearsExp?: number;
  certificate?: string;
  note?: string;
}

export class UpdateStaffSkillDto {
  level?: number;
  yearsExp?: number;
  certificate?: string;
  note?: string;
}

@Injectable()
export class StaffSkillsService {
  constructor(
    @InjectRepository(SkillCategory)
    private readonly skillCategoryRepo: Repository<SkillCategory>,

    @InjectRepository(StaffSkill)
    private readonly staffSkillRepo: Repository<StaffSkill>,

    private readonly dataSource: DataSource,
  ) {}

  // ============================================================
  // SKILL CATEGORIES
  // ============================================================

  async getAllSkillCategories(includeInactive = false): Promise<SkillCategory[]> {
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
    data: { name?: string; description?: string; department?: string; status?: 'ACTIVE' | 'INACTIVE' },
  ): Promise<SkillCategory> {
    const cat = await this.skillCategoryRepo.findOne({ where: { id } });
    if (!cat) throw new NotFoundException(`Danh mục kỹ năng #${id} không tồn tại`);
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

  async upsertSkill(userId: number, dto: UpsertStaffSkillDto): Promise<StaffSkill> {
    // Kiểm tra kỹ năng tồn tại
    const skillCat = await this.skillCategoryRepo.findOne({ where: { id: dto.skillId } });
    if (!skillCat) throw new NotFoundException(`Kỹ năng #${dto.skillId} không tồn tại`);

    if (dto.level < 1 || dto.level > 5) {
      throw new Error('Level kỹ năng phải từ 1 đến 5');
    }

    // Tìm bản ghi cũ nếu có (upsert)
    let existing = await this.staffSkillRepo.findOne({
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

  async removeSkill(userId: number, skillId: number): Promise<{ message: string }> {
    const existing = await this.staffSkillRepo.findOne({
      where: { userId, skillId },
    });
    if (!existing) throw new NotFoundException('Kỹ năng này chưa được gán cho nhân viên');
    await this.staffSkillRepo.remove(existing);
    return { message: 'Đã xoá kỹ năng khỏi hồ sơ nhân viên' };
  }

  async verifySkill(
    skillEntryId: number,
    verifiedBy: number,
  ): Promise<StaffSkill> {
    const entry = await this.staffSkillRepo.findOne({ where: { id: skillEntryId } });
    if (!entry) throw new NotFoundException(`Mục kỹ năng #${skillEntryId} không tồn tại`);
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
  ): Promise<
    Array<{
      userId: number;
      staffName: string;
      staffEmail: string;
      level: number;
      yearsExp: number | null;
      certificate: string | null;
      matchScore: number;
    }>
  > {
    const results = await this.dataSource.query(
      `
      SELECT
        u.id AS userId,
        u.full_name AS staffName,
        u.email AS staffEmail,
        ss.level,
        ss.years_exp AS yearsExp,
        ss.certificate,
        sc.name AS skillName,
        (ss.level * 10 + IFNULL(ss.years_exp, 0)) AS matchScore
      FROM staff_skills ss
      INNER JOIN users u ON u.id = ss.user_id AND u.status = 'ACTIVE'
      INNER JOIN skill_categories sc ON sc.id = ss.skill_id AND sc.code = ?
      ${hotelId ? 'INNER JOIN hotel_staff hs ON hs.staff_user_id = u.id AND hs.hotel_id = ? AND hs.status = \'ACTIVE\'' : ''}
      WHERE ss.level >= ?
      ORDER BY matchScore DESC
      LIMIT 10
      `,
      hotelId ? [skillCategoryCode, hotelId, requiredLevel] : [skillCategoryCode, requiredLevel],
    );

    return results;
  }

  // ============================================================
  // STATISTICS
  // ============================================================

  async getSkillStats(): Promise<{
    totalSkillCategories: number;
    staffWithSkills: number;
    averageSkillLevel: number;
    topSkill: string | null;
  }> {
    const [totalSkillCategories, staffWithSkillsRows, avgRows, topSkillRows] = await Promise.all([
      this.skillCategoryRepo.count({ where: { status: 'ACTIVE' } }),
      this.dataSource.query('SELECT COUNT(DISTINCT user_id) AS cnt FROM staff_skills'),
      this.dataSource.query('SELECT AVG(level) AS avg_level FROM staff_skills'),
      this.dataSource.query(
        `SELECT sc.name, COUNT(ss.id) AS cnt
         FROM staff_skills ss
         INNER JOIN skill_categories sc ON sc.id = ss.skill_id
         GROUP BY sc.id ORDER BY cnt DESC LIMIT 1`,
      ),
    ]);

    return {
      totalSkillCategories,
      staffWithSkills: Number(staffWithSkillsRows[0]?.cnt ?? 0),
      averageSkillLevel: parseFloat((avgRows[0]?.avg_level ?? 0).toFixed(1)),
      topSkill: topSkillRows[0]?.name ?? null,
    };
  }
}
