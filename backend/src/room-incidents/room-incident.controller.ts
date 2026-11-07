import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  OpenRoomIncidentDto,
  ProposeIncidentOptionDto,
  ResolveRoomIncidentDto,
} from './dto/room-incident.dto';
import { RoomIncidentService } from './room-incident.service';

@Controller('room-incidents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RoomIncidentController {
  constructor(private readonly roomIncidentService: RoomIncidentService) {}

  private extractActor(req: any) {
    return {
      id: String(req.user?.sub || req.user?.id),
      role: String(req.user?.role || 'EMPLOYEE'),
    };
  }

  @Post()
  @Roles('ADMIN', 'EMPLOYEE')
  async openIncident(@Body() body: OpenRoomIncidentDto, @Req() req: any) {
    return this.roomIncidentService.openIncidentOnce(body, this.extractActor(req));
  }

  @Post(':id/propose-option')
  @Roles('ADMIN', 'EMPLOYEE')
  async proposeOption(
    @Param('id') id: string,
    @Body() body: ProposeIncidentOptionDto,
    @Req() req: any,
  ) {
    return this.roomIncidentService.proposeOption(id, body, this.extractActor(req));
  }

  @Post(':id/resolve')
  @Roles('ADMIN', 'EMPLOYEE', 'CUSTOMER')
  async resolveIncident(
    @Param('id') id: string,
    @Body() body: ResolveRoomIncidentDto,
    @Req() req: any,
  ) {
    return this.roomIncidentService.resolveIncident(id, body, this.extractActor(req));
  }
}
