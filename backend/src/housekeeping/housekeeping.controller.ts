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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HousekeepingTaskStatus } from './entities/housekeeping-task.entity';
import { HousekeepingService } from './housekeeping.service';

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
    @Body() body: { commandId?: string },
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
    @Body() body: { checklistJson?: Record<string, any>; commandId?: string },
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
    @Body() body: { approved: boolean; note?: string; commandId?: string },
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
    @Body() body: { issueNote: string; commandId?: string },
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
