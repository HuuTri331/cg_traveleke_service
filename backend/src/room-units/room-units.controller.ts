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
import { RoomAllocationService } from './room-allocation.service';
import { RoomMoveService } from './room-move.service';
import type { RoomMoveRequestDto } from './room-move.service';
import { RoomUnitsService } from './room-units.service';
import type { CreateRoomUnitDto } from './room-units.service';

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
@UseGuards(JwtAuthGuard)
export class RoomUnitsController {
  constructor(
    private readonly roomUnitsService: RoomUnitsService,
    private readonly roomAllocationService: RoomAllocationService,
    private readonly roomMoveService: RoomMoveService,
  ) {}

  private extractActor(req: any) {
    return {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'STAFF'),
    };
  }

  @Get('hotels/:hotelId/room-units')
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
  async createRoomUnit(
    @Param('hotelId') hotelId: string,
    @Body() dto: Omit<CreateRoomUnitDto, 'hotelId'>,
    @Req() req: any,
  ) {
    return this.roomUnitsService.createRoomUnit(
      { ...dto, hotelId },
      this.extractActor(req),
    );
  }

  @Patch('room-units/:unitId/state')
  async updateUnitState(
    @Param('unitId') unitId: string,
    @Body() body: { operationalStatus?: any; housekeepingState?: any; notes?: string },
    @Req() req: any,
  ) {
    return this.roomUnitsService.updateUnitState(unitId, body, this.extractActor(req));
  }

  @Get('bookings/:id/room-unit-candidates')
  async getCandidates(@Param('id') id: string, @Req() req: any) {
    return this.roomAllocationService.getCandidates(id, this.extractActor(req));
  }

  @Get('bookings/:id/room-unit-allocations')
  async getAllocations(@Param('id') id: string) {
    return this.roomAllocationService.getBookingAllocations(id);
  }

  @Post('bookings/:id/room-unit-allocations')
  async allocateRoomUnits(
    @Param('id') id: string,
    @Body() body: AllocateRoomUnitsDto,
    @Req() req: any,
  ) {
    return this.roomAllocationService.allocate(id, body, this.extractActor(req));
  }

  @Post('bookings/:id/room-moves/preview')
  async previewMove(
    @Param('id') id: string,
    @Body() body: Omit<RoomMoveRequestDto, 'commandId'>,
    @Req() req: any,
  ) {
    return this.roomMoveService.previewMove(id, body, this.extractActor(req));
  }

  @Post('bookings/:id/room-moves/commit')
  async commitMove(
    @Param('id') id: string,
    @Body() body: RoomMoveRequestDto,
    @Req() req: any,
  ) {
    return this.roomMoveService.commitMove(id, body, this.extractActor(req));
  }
}
