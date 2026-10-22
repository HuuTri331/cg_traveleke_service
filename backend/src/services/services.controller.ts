import {
  BadRequestException,
  ForbiddenException,
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
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import {
  CreateServiceCategoryDto,
  UpdateServiceCategoryDto,
  CreateRoomServiceDto,
  UpdateRoomServiceDto,
  CreateServiceRequestDto,
  UpdateServiceRequestDto,
  CreateServiceRecoveryLogDto,
  ApproveRecoveryDto,
} from './dto/services.dto';
import { ServiceRequestStatus } from './entities/service-request.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  // ============================================================
  // PUBLIC ENDPOINTS (Không cần đăng nhập)
  // ============================================================

  @Get('categories')
  getAllCategories(@Query('includeInactive') includeInactive?: string) {
    return this.servicesService.getAllCategories(includeInactive === 'true');
  }

  @Get('categories/:id')
  getCategoryById(@Param('id', ParseIntPipe) id: number) {
    return this.servicesService.getCategoryById(id);
  }

  @Get('room-services')
  getAllRoomServices(
    @Query('hotelId') hotelId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.servicesService.getAllRoomServices(
      hotelId ? Number(hotelId) : undefined,
      categoryId ? Number(categoryId) : undefined,
    );
  }

  @Get('room-services/:id')
  getRoomServiceById(@Param('id', ParseIntPipe) id: number) {
    return this.servicesService.getRoomServiceById(id);
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  getStats() {
    return this.servicesService.getServiceStats();
  }

  // ============================================================
  // ADMIN/EMPLOYEE – Quản lý danh mục
  // ============================================================

  @Post('categories')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  createCategory(@Body() dto: CreateServiceCategoryDto) {
    return this.servicesService.createCategory(dto);
  }

  @Put('categories/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateServiceCategoryDto,
  ) {
    return this.servicesService.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  deleteCategory(@Param('id', ParseIntPipe) id: number) {
    return this.servicesService.deleteCategory(id);
  }

  // ============================================================
  // ADMIN/EMPLOYEE – Quản lý dịch vụ phòng
  // ============================================================

  @Post('room-services')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @HttpCode(HttpStatus.CREATED)
  async createRoomService(
    @Body() dto: CreateRoomServiceDto,
    @CurrentUser() user: User,
  ) {
    if (user.role === 'EMPLOYEE') {
      if (!dto.hotelId) {
        throw new BadRequestException('Vui lòng chỉ định khách sạn (hotelId) cho dịch vụ phòng.');
      }
      const isManager = await this.servicesService.isHotelManager(user.id, dto.hotelId);
      if (!isManager) {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới có quyền tạo dịch vụ phòng cho khách sạn này.',
        );
      }
    }
    return this.servicesService.createRoomService(dto);
  }

  @Put('room-services/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  async updateRoomService(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoomServiceDto,
    @CurrentUser() user: User,
  ) {
    if (user.role === 'EMPLOYEE') {
      const svc = await this.servicesService.getRoomServiceById(id);
      if (svc.hotelId) {
        const isManager = await this.servicesService.isHotelManager(user.id, svc.hotelId);
        if (!isManager) {
          throw new ForbiddenException(
            'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới có quyền cập nhật dịch vụ phòng của khách sạn này.',
          );
        }
      }
    }
    return this.servicesService.updateRoomService(id, dto);
  }

  @Delete('room-services/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  deleteRoomService(@Param('id', ParseIntPipe) id: number) {
    return this.servicesService.deleteRoomService(id);
  }

  // ============================================================
  // SERVICE REQUESTS & LIFECYCLE WORKFLOW
  // ============================================================

  @Get('requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  getAllRequests(
    @CurrentUser() user: User,
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('hotelId') hotelId?: string,
  ) {
    return this.servicesService.getAllServiceRequests(
      {
        status,
        assignedTo: assignedTo ? Number(assignedTo) : undefined,
        hotelId: hotelId ? Number(hotelId) : undefined,
      },
      user,
    );
  }

  @Get('requests/booking/:bookingId')
  @UseGuards(JwtAuthGuard)
  getRequestsByBooking(
    @Param('bookingId', ParseIntPipe) bookingId: number,
    @CurrentUser() user: User,
  ) {
    return this.servicesService.getServiceRequestsByBooking(bookingId, user);
  }

  @Post('requests')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  createServiceRequest(
    @Body() dto: CreateServiceRequestDto,
    @CurrentUser() user: User,
  ) {
    return this.servicesService.createServiceRequest(dto, user);
  }

  @Put('requests/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  updateServiceRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateServiceRequestDto,
  ) {
    return this.servicesService.updateServiceRequest(id, dto);
  }

  @Put('requests/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  updateRequestStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      status: ServiceRequestStatus;
      assignedTo?: number;
      failureReason?: string;
      note?: string;
    },
  ) {
    return this.servicesService.updateServiceRequestStatus(id, body.status, {
      assignedTo: body.assignedTo,
      failureReason: body.failureReason,
      note: body.note,
    });
  }

  // ============================================================
  // BOOKING SERVICE SNAPSHOTS (Quyền lợi booking)
  // ============================================================

  @Post('snapshots/create')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @HttpCode(HttpStatus.CREATED)
  createBookingSnapshots(
    @Body() body: { bookingId: number; roomTypeId?: number; hotelId?: number },
    @CurrentUser() user: User,
  ) {
    return this.servicesService.createBookingSnapshots(
      body.bookingId,
      body.roomTypeId,
      body.hotelId,
      user,
    );
  }

  @Get('snapshots/booking/:bookingId')
  @UseGuards(JwtAuthGuard)
  getBookingSnapshots(
    @Param('bookingId', ParseIntPipe) bookingId: number,
    @CurrentUser() user: User,
  ) {
    return this.servicesService.getBookingSnapshots(bookingId, user);
  }

  // ============================================================
  // SERVICE RECOVERY (Bù đắp sai lỗi)
  // ============================================================

  @Post('recovery')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @HttpCode(HttpStatus.CREATED)
  createRecoveryLog(
    @Body() dto: CreateServiceRecoveryLogDto,
    @Request() req: { user: { id: number } },
  ) {
    if (!dto.reportedBy) dto.reportedBy = req.user.id;
    return this.servicesService.createRecoveryLog(dto);
  }

  @Put('recovery/:id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  approveRecovery(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveRecoveryDto,
    @CurrentUser() user: User,
  ) {
    if (!dto.approvedBy) dto.approvedBy = Number(user.id);
    return this.servicesService.approveRecoveryLog(id, dto, user);
  }

  @Get('recovery')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  getRecoveryLogs(@Query('bookingId') bookingId?: string) {
    return this.servicesService.getRecoveryLogs(
      bookingId ? Number(bookingId) : undefined,
    );
  }
}
