import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GuestWorkService } from './guest-work.service';
import {
  CreateWorkTaskDto,
  ClaimTaskDto,
  CompleteTaskDto,
  VerifyTaskDto,
  CreateOfflineWorkLogDto,
} from './dto/work-task.dto';
import { WorkTaskStatus } from './entities/guest-work-task.entity';

@Controller('guest-work')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GuestWorkController {
  constructor(private readonly guestWorkService: GuestWorkService) {}

  @Get('me')
  @Roles('ADMIN', 'EMPLOYEE')
  async getMyTasks(
    @CurrentUser() user: { id: string },
    @Query('status') status?: WorkTaskStatus,
  ) {
    return await this.guestWorkService.getTasksForStaff(user.id, status);
  }

  @Get('booking/:bookingId')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async getTasksForBooking(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.guestWorkService.getTasksForBooking(bookingId, user);
  }

  @Get(':taskId/timeline')
  @Roles('ADMIN', 'EMPLOYEE')
  async getTaskTimeline(
    @Param('taskId') taskId: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.guestWorkService.getTaskTimeline(taskId, user);
  }

  @Post('offline-log')
  @Roles('ADMIN', 'EMPLOYEE')
  async createOfflineLog(
    @Body() dto: CreateOfflineWorkLogDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.guestWorkService.createOfflineWorkLog(user, dto);
  }

  @Post()
  @Roles('ADMIN', 'EMPLOYEE')
  async createTask(
    @Body() dto: CreateWorkTaskDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return await this.guestWorkService.createTask(dto, user);
  }

  @Post(':taskId/accept')
  @Roles('ADMIN', 'EMPLOYEE')
  async acceptTask(
    @Param('taskId') taskId: string,
    @CurrentUser() user: { id: string; role: string },
    @Body() dto?: ClaimTaskDto,
  ) {
    return await this.guestWorkService.acceptTask(taskId, user, dto);
  }

  @Post(':taskId/start')
  @Roles('ADMIN', 'EMPLOYEE')
  async startTask(
    @Param('taskId') taskId: string,
    @CurrentUser() user: { id: string; role: string },
    @Body() dto?: ClaimTaskDto,
  ) {
    return await this.guestWorkService.startTask(taskId, user, dto);
  }

  @Post(':taskId/complete')
  @Roles('ADMIN', 'EMPLOYEE')
  async completeTask(
    @Param('taskId') taskId: string,
    @CurrentUser() user: { id: string; role: string },
    @Body() dto: CompleteTaskDto,
  ) {
    return await this.guestWorkService.completeTask(taskId, user, dto);
  }

  @Post(':taskId/verify')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async verifyTask(
    @Param('taskId') taskId: string,
    @CurrentUser() user: { id: string; role: string },
    @Body() dto: VerifyTaskDto,
  ) {
    return await this.guestWorkService.verifyTask(taskId, user, dto);
  }
}

