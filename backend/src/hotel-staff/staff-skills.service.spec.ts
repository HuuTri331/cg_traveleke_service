import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StaffSkillsService } from './staff-skills.service';
import { CaseComplexity } from './entities/staff-eligibility-rule.entity';

describe('StaffSkillsService - Security, Eligibility & Verification', () => {
  let service: StaffSkillsService;
  let mockCategoryRepo: any;
  let mockStaffSkillRepo: any;
  let mockLanguageSkillRepo: any;
  let mockRuleRepo: any;
  let mockDataSource: any;

  beforeEach(() => {
    mockCategoryRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn(),
    };
    mockStaffSkillRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => dto),
      remove: jest.fn(),
    };
    mockLanguageSkillRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => dto),
      remove: jest.fn(),
    };
    mockRuleRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };
    mockDataSource = {
      query: jest.fn(),
    };

    service = new StaffSkillsService(
      mockCategoryRepo,
      mockStaffSkillRepo,
      mockLanguageSkillRepo,
      mockRuleRepo,
      mockDataSource,
    );
  });

  describe('assertCanModifySkills (Section 02.3 & 04.6)', () => {
    it('should allow user to modify their own skills', async () => {
      const actor: any = { id: '5', role: 'EMPLOYEE' };
      await expect(service.assertCanModifySkills(actor, 5)).resolves.not.toThrow();
    });

    it('should allow ADMIN to modify any staff skills', async () => {
      const actor: any = { id: '1', role: 'ADMIN' };
      await expect(service.assertCanModifySkills(actor, 99)).resolves.not.toThrow();
    });

    it('should allow direct MANAGER to modify subordinate staff skills', async () => {
      const actor: any = { id: '2', role: 'EMPLOYEE' };
      // Manager check returns membership
      mockDataSource.query.mockResolvedValueOnce([{ id: 10 }]);
      await expect(service.assertCanModifySkills(actor, 5)).resolves.not.toThrow();
    });

    it('should throw ForbiddenException if peer employee tries to modify another staff skills', async () => {
      const actor: any = { id: '3', role: 'EMPLOYEE' };
      // Manager check returns empty
      mockDataSource.query.mockResolvedValueOnce([]);
      await expect(service.assertCanModifySkills(actor, 5)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('verifySkill (Maker-Checker - Section 02.3 & 15.2)', () => {
    it('should throw ForbiddenException if user tries to verify their own skill', async () => {
      mockStaffSkillRepo.findOne.mockResolvedValueOnce({
        id: 1,
        userId: 5,
        skillId: 2,
      });

      await expect(service.verifySkill(1, 5)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if non-manager tries to verify', async () => {
      mockStaffSkillRepo.findOne.mockResolvedValueOnce({
        id: 1,
        userId: 5,
        skillId: 2,
      });

      const actor: any = { id: '3', role: 'EMPLOYEE' };
      // Manager query returns empty
      mockDataSource.query.mockResolvedValueOnce([]);

      await expect(service.verifySkill(1, 3, actor)).rejects.toThrow(ForbiddenException);
    });

    it('should successfully verify when actor is valid manager', async () => {
      const entry = {
        id: 1,
        userId: 5,
        skillId: 2,
        verifiedBy: null,
        verifiedAt: null,
      };
      mockStaffSkillRepo.findOne.mockResolvedValueOnce(entry);

      const actor: any = { id: '2', role: 'EMPLOYEE' };
      mockDataSource.query.mockResolvedValueOnce([{ id: 10 }]);

      const result = await service.verifySkill(1, 2, actor);
      expect(result.verifiedBy).toBe(2);
      expect(result.verifiedAt).toBeDefined();
    });
  });

  describe('checkEligibility (Section 15.4)', () => {
    it('should fail-safe reject VIP case when no rule is configured', async () => {
      mockRuleRepo.findOne.mockResolvedValueOnce(null);

      const result = await service.checkEligibility(5, CaseComplexity.VIP);
      expect(result.eligible).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it('should enforce minSkillLevel, minYearsExperience and minCasesCompleted', async () => {
      mockRuleRepo.findOne.mockResolvedValueOnce({
        ruleCode: 'VIP_RULE',
        caseComplexity: CaseComplexity.VIP,
        minSkillLevel: 4,
        minYearsExperience: 3,
        minCasesCompleted: 10,
        requiredSkillCodes: ['FRONT_DESK'],
        requiredLanguageCodes: ['en'],
        excludeShadowMode: false,
        requireVerifiedSkills: false,
      });

      // Staff has level 2, 1 year exp
      mockStaffSkillRepo.find.mockResolvedValueOnce([
        { level: 2, yearsExp: 1, skill: { code: 'FRONT_DESK' }, isShadow: false },
      ]);
      mockLanguageSkillRepo.find.mockResolvedValueOnce([
        { languageCode: 'en' },
      ]);
      // Completed cases = 2
      mockDataSource.query.mockResolvedValueOnce([{ total: 2 }]);

      const result = await service.checkEligibility(5, CaseComplexity.VIP);
      expect(result.eligible).toBe(false);
      expect(result.reasons.some((r) => r.includes('Level kỹ năng'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('Kinh nghiệm'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('Số đơn hoàn thành'))).toBe(true);
    });
  });
});
