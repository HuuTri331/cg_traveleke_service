import { evaluateSkillEvidence } from './candidate-loader';

describe('evaluateSkillEvidence (P0-01/P0-02/D1-04)', () => {
  const verifiedAt = new Date('2026-10-01T00:00:00Z');
  const vipRule = [{
    requiredSkillCodes: ['VIP_HANDLING'], requiredLanguageCodes: ['en'],
    minSkillLevel: 3, minYearsExperience: 2, minCasesCompleted: 20,
    excludeShadowMode: 1, requireVerifiedSkills: 1,
  }];

  it('rejects unverified, shadow, or non-matching skills for VIP', () => {
    expect(evaluateSkillEvidence([
      { staffUserId: '1', code: 'COOKING', department: 'F&B', level: 5, yearsExp: 8, verifiedBy: '9', verifiedAt, isShadow: 0 },
      { staffUserId: '1', code: 'VIP_HANDLING', department: 'FRONT_DESK', level: 5, yearsExp: 5, verifiedBy: null, verifiedAt: null, isShadow: 0 },
    ], vipRule, 30, ['EN'], true).hasVerifiedSkill).toBe(false);
    expect(evaluateSkillEvidence([
      { staffUserId: '1', code: 'VIP_HANDLING', department: 'FRONT_DESK', level: 5, yearsExp: 5, verifiedBy: '9', verifiedAt, isShadow: 1 },
    ], vipRule, 30, ['EN'], true).hasVerifiedSkill).toBe(false);
  });

  it('never combines level from one skill with years from another skill', () => {
    const rule = [{
      requiredSkillCodes: ['FRONT_DESK', 'VIP_HANDLING'], requiredLanguageCodes: [],
      minSkillLevel: 3, minYearsExperience: 2, minCasesCompleted: 0,
      excludeShadowMode: 1, requireVerifiedSkills: 1,
    }];
    const res = evaluateSkillEvidence([
      { staffUserId: '1', code: 'FRONT_DESK', department: 'FRONT_DESK', level: 5, yearsExp: 2, verifiedBy: '9', verifiedAt, isShadow: 0 },
      { staffUserId: '1', code: 'VIP_HANDLING', department: 'FRONT_DESK', level: 3, yearsExp: 6, verifiedBy: '9', verifiedAt, isShadow: 0 },
    ], rule, 0, [], true);
    expect(res).toEqual({ hasVerifiedSkill: true, skillLevel: 3, yearsExp: 2 });
  });
});
