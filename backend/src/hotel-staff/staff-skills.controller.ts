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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

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
  getSkillsByUser(@Param('userId', ParseIntPipe) userId: number) {
    return this.staffSkillsService.getSkillsByUser(userId);
  }

  @Post('user/:userId')
  @HttpCode(HttpStatus.CREATED)
  upsertSkill(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpsertStaffSkillDto,
  ) {
    return this.staffSkillsService.upsertSkill(userId, dto);
  }

  @Delete('user/:userId/skill/:skillId')
  removeSkill(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('skillId', ParseIntPipe) skillId: number,
  ) {
    return this.staffSkillsService.removeSkill(userId, skillId);
  }

  @Post('verify/:entryId')
  @Roles('ADMIN')
  verifySkill(
    @Param('entryId', ParseIntPipe) entryId: number,
    @Request() req: { user: { id: number } },
  ) {
    return this.staffSkillsService.verifySkill(entryId, req.user.id);
  }

  // ============================================================
  // SMART ASSIGNMENT SUGGESTION
  // ============================================================

  @Get('suggest')
  suggestStaff(
    @Query('skillCode') skillCode: string,
    @Query('level') level: string,
    @Query('hotelId') hotelId?: string,
  ) {
    return this.staffSkillsService.suggestStaffForService(
      skillCode,
      Number(level) || 1,
      hotelId ? Number(hotelId) : undefined,
    );
  }

  // ============================================================
  // LANGUAGE SKILLS
  // ============================================================

  @Get('user/:userId/languages')
  getLanguagesByUser(@Param('userId', ParseIntPipe) userId: number) {
    return this.staffSkillsService.getLanguagesByUser(userId);
  }

  @Post('user/:userId/languages')
  @HttpCode(HttpStatus.CREATED)
  upsertLanguage(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpsertLanguageSkillDto,
  ) {
    return this.staffSkillsService.upsertLanguage(userId, dto);
  }

  @Delete('user/:userId/languages/:code')
  removeLanguage(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('code') code: string,
  ) {
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
  checkEligibility(@Body() body: CheckEligibilityDto) {
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
  getStats() {
    return this.staffSkillsService.getSkillStats();
  }
}
