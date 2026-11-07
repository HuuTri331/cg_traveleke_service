import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  StaffSkillsService,
  UpsertStaffSkillDto,
  UpsertLanguageSkillDto,
  CreateSkillCategoryDto,
  UpdateSkillCategoryDto,
  CheckEligibilityDto,
} from './staff-skills.service';
import { CaseComplexity } from './entities/staff-eligibility-rule.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User } from '../users/entities/user.entity';

@Controller('staff-skills')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'EMPLOYEE')
export class StaffSkillsController {
  constructor(private readonly staffSkillsService: StaffSkillsService) {}

  // ============================================================
  // SKILL CATEGORIES
  // ============================================================

  @Get('categories')
  getAllCategories(@Query('includeInactive') includeInactive?: string) {
    return this.staffSkillsService.getAllSkillCategories(
      includeInactive === 'true',
    );
  }

  @Post('categories')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  createCategory(@Body() body: CreateSkillCategoryDto) {
    return this.staffSkillsService.createSkillCategory(body);
  }

  @Put('categories/:id')
  @Roles('ADMIN')
  updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateSkillCategoryDto,
  ) {
    return this.staffSkillsService.updateSkillCategory(id, body);
  }

  // ============================================================
  // STAFF SKILL MAP
  // ============================================================

  @Get('user/:userId')
  async getSkillsByUser(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() user: User,
  ) {
    await this.staffSkillsService.assertCanViewSkills(user, userId);
    return this.staffSkillsService.getSkillsByUser(userId);
  }

  @Post('user/:userId')
  @HttpCode(HttpStatus.CREATED)
  async upsertSkill(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpsertStaffSkillDto,
    @CurrentUser() user: User,
  ) {
    await this.staffSkillsService.assertCanModifySkills(user, userId);
    return this.staffSkillsService.upsertSkill(userId, dto);
  }

  @Delete('user/:userId/skill/:skillId')
  async removeSkill(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('skillId', ParseIntPipe) skillId: number,
    @CurrentUser() user: User,
  ) {
    await this.staffSkillsService.assertCanModifySkills(user, userId);
    return this.staffSkillsService.removeSkill(userId, skillId);
  }

  @Post('verify/:entryId')
  @Roles('ADMIN', 'EMPLOYEE')
  verifySkill(
    @Param('entryId', ParseIntPipe) entryId: number,
    @CurrentUser() user: User,
  ) {
    return this.staffSkillsService.verifySkill(entryId, Number(user.id), user);
  }

  // ============================================================
  // SMART ASSIGNMENT SUGGESTION
  // ============================================================

  @Get('suggest')
  suggestStaff(
    @Query('skillCode') skillCode: string,
    @Query('level') level: string,
    @Query('hotelId') hotelId?: string,
    @CurrentUser() user?: User,
  ) {
    return this.staffSkillsService.suggestStaffForService(
      skillCode,
      Number(level) || 1,
      hotelId ? Number(hotelId) : undefined,
      user,
    );
  }

  // ============================================================
  // LANGUAGE SKILLS
  // ============================================================

  @Get('user/:userId/languages')
  async getLanguagesByUser(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() user: User,
  ) {
    await this.staffSkillsService.assertCanViewSkills(user, userId);
    return this.staffSkillsService.getLanguagesByUser(userId);
  }

  @Post('user/:userId/languages')
  @HttpCode(HttpStatus.CREATED)
  async upsertLanguage(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpsertLanguageSkillDto,
    @CurrentUser() user: User,
  ) {
    await this.staffSkillsService.assertCanModifySkills(user, userId);
    return this.staffSkillsService.upsertLanguage(userId, dto);
  }

  @Delete('user/:userId/languages/:code')
  async removeLanguage(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('code') code: string,
    @CurrentUser() user: User,
  ) {
    await this.staffSkillsService.assertCanModifySkills(user, userId);
    return this.staffSkillsService.removeLanguage(userId, code);
  }

  // ============================================================
  // ELIGIBILITY RULES
  // ============================================================

  @Get('eligibility-rules')
  getEligibilityRules() {
    return this.staffSkillsService.getEligibilityRules();
  }

  @Post('check-eligibility')
  async checkEligibility(
    @Body() body: CheckEligibilityDto,
    @CurrentUser() user?: User,
  ) {
    if (user) {
      await this.staffSkillsService.assertCanViewSkills(user, body.userId);
    }
    return this.staffSkillsService.checkEligibility(
      body.userId,
      body.caseComplexity,
      body.requiredLanguage,
    );
  }

  // ============================================================
  // STATISTICS
  // ============================================================

  @Get('stats')
  getStats(
    @Query('hotelId') hotelId?: string,
    @CurrentUser() user?: User,
  ) {
    return this.staffSkillsService.getSkillStats(
      hotelId ? Number(hotelId) : undefined,
      user,
    );
  }
}
