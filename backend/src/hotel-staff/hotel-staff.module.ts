import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HotelStaff } from './entities/hotel-staff.entity';
import { SkillCategory } from './entities/skill-category.entity';
import { StaffSkill } from './entities/staff-skill.entity';
import { StaffLanguageSkill } from './entities/staff-language-skill.entity';
import { StaffEligibilityRule } from './entities/staff-eligibility-rule.entity';

import { HotelStaffController } from './hotel-staff.controller';
import { HotelStaffService } from './hotel-staff.service';

import { StaffSkillsController } from './staff-skills.controller';
import { StaffSkillsService } from './staff-skills.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HotelStaff,
      SkillCategory,
      StaffSkill,
      StaffLanguageSkill,
      StaffEligibilityRule,
    ]),
  ],
  controllers: [HotelStaffController, StaffSkillsController],
  providers: [HotelStaffService, StaffSkillsService],
  exports: [HotelStaffService, StaffSkillsService],
})
export class HotelStaffModule {}
