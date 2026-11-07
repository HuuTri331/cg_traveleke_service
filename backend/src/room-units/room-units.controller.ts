import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AllocateRoomUnitsDto } from './dto/allocate-room-units.dto';
import {
  CommitRoomMoveDto,
  CreateRoomUnitBodyDto,
  PreviewRoomMoveDto,
  UpdateRoomUnitStateDto,
  VerifyRoomUnitDto,
} from './dto/room-units.dto';
import { RoomAllocationService } from './room-allocation.service';
import { RoomMoveService } from './room-move.service';
import { RoomUnitsService } from './room-units.service';

@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RoomUnitBookingController {
  constructor(private readonly roomAllocation: RoomAllocationService) {}

  @Post(':bookingId/room-unit-allocations')
  @Roles('ADMIN', 'EMPLOYEE')
  async allocate(
    @Param('bookingId') bookingId: string,
    @Body() dto: AllocateRoomUnitsDto,
    @CurrentUser() actor: { id: string; role: 'ADMIN' | 'EMPLOYEE' },
    @Req() req?: any,
  ) {
    const effectiveActor = actor?.id
      ? actor
      : {
          id: String(req?.user?.sub || req?.user?.id),
          role: (req?.user?.role || 'EMPLOYEE') as 'ADMIN' | 'EMPLOYEE',
        };
    return this.roomAllocation.allocate(
      bookingId,
      {
        unitIds: dto.unitIds,
        commandId: dto.commandId,
        expectedBookingVersion: dto.expectedBookingVersion ?? dto.expectedVersion,
      },
      effectiveActor,
    );
  }
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class RoomUnitsController {
  constructor(
    private readonly roomUnitsService: RoomUnitsService,
    private readonly roomAllocationService: RoomAllocationService,
    private readonly roomMoveService: RoomMoveService,
  ) {}

  private extractActor(req: any) {
    return {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'CUSTOMER'),
    };
  }

  @Get('hotels/:hotelId/room-units')
  @Roles('ADMIN', 'EMPLOYEE')
  async listRoomUnits(
    @Param('hotelId') hotelId: string,
    @Query('roomTypeId') roomTypeId?: string,
    @Query('operationalStatus') operationalStatus?: any,
    @Query('housekeepingState') housekeepingState?: any,
    @Req() req?: any,
  ) {
    return this.roomUnitsService.listHotelRoomUnits(hotelId, this.extractActor(req), {
      roomTypeId,
      operationalStatus,
      housekeepingState,
    });
  }

  @Post('hotels/:hotelId/room-units')
  @Roles('ADMIN', 'EMPLOYEE')
  async createRoomUnit(
    @Param('hotelId') hotelId: string,
    @Body() dto: CreateRoomUnitBodyDto,
    @Req() req: any,
  ) {
    return this.roomUnitsService.createRoomUnit(
      { ...dto, hotelId },
      this.extractActor(req),
    );
  }

  @Post('room-units/:unitId/verify')
  @Roles('ADMIN', 'EMPLOYEE')
  async verifyRoomUnit(
    @Param('unitId') unitId: string,
    @Body() body: VerifyRoomUnitDto,
    @Req() req: any,
  ) {
    return this.roomUnitsService.verifyRoomUnit(
      unitId,
      this.extractActor(req),
      body?.note,
    );
  }

  @Post('hotels/:hotelId/room-units/:unitId/verify')
  @Roles('ADMIN', 'EMPLOYEE')
  async verifyHotelRoomUnit(
    @Param('unitId') unitId: string,
    @Body() body: VerifyRoomUnitDto,
    @Req() req: any,
  ) {
    return this.roomUnitsService.verifyRoomUnit(
      unitId,
      this.extractActor(req),
      body?.note,
    );
  }

  @Patch('room-units/:unitId/state')
  @Roles('ADMIN', 'EMPLOYEE')
  async updateUnitState(
    @Param('unitId') unitId: string,
    @Body() body: UpdateRoomUnitStateDto,
    @Req() req: any,
  ) {
    return this.roomUnitsService.updateUnitState(unitId, body, this.extractActor(req));
  }

  @Get('bookings/:id/room-unit-candidates')
  @Roles('ADMIN', 'EMPLOYEE')
  async getCandidates(@Param('id') id: string, @Req() req: any) {
    return this.roomAllocationService.getCandidates(id, this.extractActor(req));
  }

  @Get('bookings/:id/room-unit-allocations')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async getAllocations(@Param('id') id: string, @Req() req: any) {
    return this.roomAllocationService.getBookingAllocationsForActor(
      id,
      this.extractActor(req),
    );
  }

  @Post('bookings/:id/room-moves/preview')
  @Roles('ADMIN', 'EMPLOYEE')
  async previewMove(
    @Param('id') id: string,
    @Body() body: PreviewRoomMoveDto,
    @Req() req: any,
  ) {
    return this.roomMoveService.previewMove(id, body, this.extractActor(req));
  }

  @Post('bookings/:id/room-moves/commit')
  @Roles('ADMIN', 'EMPLOYEE')
  async commitMove(
    @Param('id') id: string,
    @Body() body: CommitRoomMoveDto,
    @Req() req: any,
  ) {
    return this.roomMoveService.commitMove(id, body, this.extractActor(req));
  }
}
