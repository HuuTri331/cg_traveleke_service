import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HousekeepingTaskStatus } from './entities/housekeeping-task.entity';
import { HousekeepingService } from './housekeeping.service';

export class HousekeepingCommandDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  commandId?: string;
}

export class CompleteHousekeepingTaskDto extends HousekeepingCommandDto {
  @IsOptional()
  @IsObject()
  checklistJson?: Record<string, any>;
}

export class InspectHousekeepingTaskDto extends HousekeepingCommandDto {
  @IsBoolean()
  approved!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ReportHousekeepingIssueDto extends HousekeepingCommandDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  issueNote!: string;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class HousekeepingController {
  constructor(private readonly housekeepingService: HousekeepingService) {}

  private extractActor(req: any) {
    return {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'STAFF'),
    };
  }

  @Get('hotels/:id/housekeeping/tasks')
  async listTasks(
    @Param('id') hotelId: string,
    @Query('status') status?: HousekeepingTaskStatus,
    @Req() req?: any,
  ) {
    return this.housekeepingService.listHotelTasks(
      hotelId,
      this.extractActor(req),
      status,
    );
  }

  @Post('housekeeping/tasks/:id/start')
  async startTask(
    @Param('id') taskId: string,
    @Body() body: HousekeepingCommandDto,
    @Req() req: any,
  ) {
    return this.housekeepingService.startTask(
      taskId,
      this.extractActor(req),
      body?.commandId,
    );
  }

  @Post('housekeeping/tasks/:id/complete')
  async completeTask(
    @Param('id') taskId: string,
    @Body() body: CompleteHousekeepingTaskDto,
    @Req() req: any,
  ) {
    return this.housekeepingService.completeTask(
      taskId,
      body?.checklistJson || null,
      this.extractActor(req),
      body?.commandId,
    );
  }

  @Post('housekeeping/tasks/:id/inspect')
  async inspectTask(
    @Param('id') taskId: string,
    @Body() body: InspectHousekeepingTaskDto,
    @Req() req: any,
  ) {
    return this.housekeepingService.inspectTask(
      taskId,
      Boolean(body?.approved ?? true),
      body?.note,
      this.extractActor(req),
      body?.commandId,
    );
  }

  @Post('housekeeping/tasks/:id/report-issue')
  async reportIssue(
    @Param('id') taskId: string,
    @Body() body: ReportHousekeepingIssueDto,
    @Req() req: any,
  ) {
    return this.housekeepingService.reportIssue(
      taskId,
      body?.issueNote,
      this.extractActor(req),
      body?.commandId,
    );
  }
}
