import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsArray,
} from 'class-validator';
import { LanguageLevel } from '../entities/staff-language-skill.entity';
import { CaseComplexity } from '../entities/staff-eligibility-rule.entity';

// ============================================================
// SKILL CATEGORIES DTO
// ============================================================

export class CreateSkillCategoryDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  department?: string;
}

export class UpdateSkillCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

// ============================================================
// STAFF SKILLS DTO
// ============================================================

export class UpsertStaffSkillDto {
  @IsInt()
  skillId: number;

  @IsInt()
  @Min(1)
  @Max(5)
  level: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  yearsExp?: number;

  @IsOptional()
  @IsString()
  certificate?: string;

  @IsOptional()
  @IsString()
  certificateExpiry?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsEnum(['TRAINING', 'STANDARD', 'SENIOR', 'VIP', 'COMPLEX'])
  eligibilityLevel?: 'TRAINING' | 'STANDARD' | 'SENIOR' | 'VIP' | 'COMPLEX';
}

export class UpdateStaffSkillDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  level?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  yearsExp?: number;

  @IsOptional()
  @IsString()
  certificate?: string;

  @IsOptional()
  @IsString()
  certificateExpiry?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsEnum(['TRAINING', 'STANDARD', 'SENIOR', 'VIP', 'COMPLEX'])
  eligibilityLevel?: 'TRAINING' | 'STANDARD' | 'SENIOR' | 'VIP' | 'COMPLEX';
}

// ============================================================
// LANGUAGE SKILLS DTO
// ============================================================

export class UpsertLanguageSkillDto {
  @IsString()
  languageCode: string;

  @IsString()
  languageName: string;

  @IsEnum(['BASIC', 'INTERMEDIATE', 'ADVANCED', 'NATIVE'])
  level: LanguageLevel;

  @IsOptional()
  @IsString()
  certificate?: string;

  @IsOptional()
  @IsString()
  certificateExpiry?: string;
}

// ============================================================
// ELIGIBILITY RULES DTO
// ============================================================

export class CreateEligibilityRuleDto {
  @IsString()
  ruleCode: string;

  @IsEnum(['STANDARD', 'PREMIUM', 'VIP', 'COMPLEX'])
  caseComplexity: CaseComplexity;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  minSkillLevel?: number;

  @IsOptional()
  @IsArray()
  requiredSkillCodes?: string[];

  @IsOptional()
  @IsArray()
  requiredLanguageCodes?: string[];

  @IsOptional()
  @IsNumber()
  minYearsExperience?: number;

  @IsOptional()
  @IsInt()
  minCasesCompleted?: number;

  @IsOptional()
  @IsBoolean()
  excludeShadowMode?: boolean;

  @IsOptional()
  @IsBoolean()
  requireVerifiedSkills?: boolean;

  @IsOptional()
  @IsString()
  escalationRole?: string;
}

export class UpdateEligibilityRuleDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  minSkillLevel?: number;

  @IsOptional()
  @IsArray()
  requiredSkillCodes?: string[];

  @IsOptional()
  @IsArray()
  requiredLanguageCodes?: string[];

  @IsOptional()
  @IsNumber()
  minYearsExperience?: number;

  @IsOptional()
  @IsInt()
  minCasesCompleted?: number;

  @IsOptional()
  @IsBoolean()
  excludeShadowMode?: boolean;

  @IsOptional()
  @IsBoolean()
  requireVerifiedSkills?: boolean;

  @IsOptional()
  @IsString()
  escalationRole?: string;

  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class CheckEligibilityDto {
  @IsInt()
  userId: number;

  @IsEnum(['STANDARD', 'PREMIUM', 'VIP', 'COMPLEX'])
  caseComplexity: CaseComplexity;

  @IsOptional()
  @IsString()
  requiredLanguage?: string;
}
