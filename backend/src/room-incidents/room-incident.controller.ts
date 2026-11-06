import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoomIncidentResolutionType } from './entities/room-incident.entity';
import { RoomIncidentService } from './room-incident.service';
import type { OpenRoomIncidentInput } from './room-incident.service';

@Controller('room-incidents')
@UseGuards(JwtAuthGuard)
export class RoomIncidentController {
  constructor(private readonly roomIncidentService: RoomIncidentService) {}

  private extractActor(req: any) {
    return {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'STAFF'),
    };
  }

  @Post()
  async openIncident(@Body() body: OpenRoomIncidentInput, @Req() req: any) {
    return this.roomIncidentService.openIncidentOnce(body, this.extractActor(req));
  }

  @Post(':id/propose-option')
  async proposeOption(
    @Param('id') id: string,
    @Body()
    body: {
      resolutionType: RoomIncidentResolutionType;
      proposedUnitId?: string;
      proposedRoomTypeId?: string;
      compensationVnd?: number;
      approvedByManagerId?: string;
      note?: string;
      commandId?: string;
    },
    @Req() req: any,
  ) {
    return this.roomIncidentService.proposeOption(id, body, this.extractActor(req));
  }

  @Post(':id/resolve')
  async resolveIncident(
    @Param('id') id: string,
    @Body() body: { customerAccepted: boolean; note?: string; commandId?: string },
    @Req() req: any,
  ) {
    return this.roomIncidentService.resolveIncident(id, body, this.extractActor(req));
  }
}
