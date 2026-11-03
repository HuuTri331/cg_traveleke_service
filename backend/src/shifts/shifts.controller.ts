import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User } from '../users/entities/user.entity';
import { ShiftsService } from './shifts.service';
import {
  CreateShiftDto,
  StartShiftDto,
  EndShiftDto,
  CreateHandoverDto,
} from './dto/shifts.dto';

@Controller('shifts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Get('my-shifts')
  @Roles('ADMIN', 'EMPLOYEE')
  getMyShifts(@CurrentUser() user: User) {
    return this.shiftsService.getMyShifts(String(user.id));
  }

  @Get('active')
  @Roles('ADMIN', 'EMPLOYEE')
  getActiveShift(@CurrentUser() user: User) {
    return this.shiftsService.getActiveShift(String(user.id));
  }

  @Get(['hotel/:hotelId', 'hotels/:hotelId'])
  @Roles('ADMIN', 'EMPLOYEE')
  getHotelShifts(
    @Param('hotelId') hotelId: string,
    @CurrentUser() user: User,
    @Query('date') date?: string,
  ) {
    return this.shiftsService.getHotelShifts(hotelId, user, date);
  }

  @Get(['hotel/:hotelId/handovers', 'hotels/:hotelId/handovers'])
  @Roles('ADMIN', 'EMPLOYEE')
  getHotelHandovers(
    @Param('hotelId') hotelId: string,
    @CurrentUser() user: User,
  ) {
    return this.shiftsService.getHotelHandovers(hotelId, user);
  }

  @Post()
  @Roles('ADMIN', 'EMPLOYEE')
  createShift(@Body() dto: CreateShiftDto, @CurrentUser() user: User) {
    return this.shiftsService.createShift(dto, user);
  }

  @Post(':id/start')
  @Roles('ADMIN', 'EMPLOYEE')
  startShift(
    @Param('id') id: string,
    @Body() dto: StartShiftDto,
    @CurrentUser() user: User,
  ) {
    return this.shiftsService.startShift(id, String(user.id), dto);
  }

  @Post(':id/end')
  @Roles('ADMIN', 'EMPLOYEE')
  endShift(
    @Param('id') id: string,
    @Body() dto: EndShiftDto,
    @CurrentUser() user: User,
  ) {
    return this.shiftsService.endShift(id, String(user.id), dto);
  }

  @Post(':id/handover')
  @Roles('ADMIN', 'EMPLOYEE')
  createHandover(
    @Param('id') id: string,
    @Body() dto: CreateHandoverDto,
    @CurrentUser() user: User,
  ) {
    return this.shiftsService.createHandover(id, String(user.id), dto);
  }

  @Post('handovers/:id/accept')
  @Roles('ADMIN', 'EMPLOYEE')
  acceptHandover(@Param('id') id: string, @CurrentUser() user: User) {
    return this.shiftsService.acceptHandover(id, String(user.id));
  }
}
