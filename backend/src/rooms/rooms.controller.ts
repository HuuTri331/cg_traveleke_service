import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User } from '../users/entities/user.entity';
import { createMulterOptions } from '../hotels/upload-image.config';

import { AddRoomImageDto } from './dto/add-room-image.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { QueryRoomDto } from './dto/query-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomsService } from './rooms.service';

import { SearchRoomDto } from './dto/search-room.dto';
import { RateLimiterGuard } from '../rate-limit/rate-limiter.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';

@Controller('rooms')
@UseGuards(RateLimiterGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  // ============================================================
  // CRUD PHÒNG (PUBLIC ĐỌC & TÌM KIẾM CHO KHÁCH HÀNG)
  // ============================================================

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  async create(@Body() dto: CreateRoomDto, @CurrentUser() user: User) {
    if (user.role === 'EMPLOYEE') {
      const isManager = await this.roomsService.isHotelManager(user.id, dto.hotelId);
      if (!isManager) {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới có quyền tạo phòng cho khách sạn này.',
        );
      }
    }
    return this.roomsService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryRoomDto) {
    return this.roomsService.findAll(query);
  }

  @Get('search')
  @RateLimit({
    slidingWindow: {
      limit: 120,
      windowMs: 60_000,
    },
  })
  search(@Query() query: SearchRoomDto) {
    return this.roomsService.search(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.roomsService.findOne(id);
  }

  @Get(':id/services')
  getRoomServices(@Param('id') id: string) {
    return this.roomsService.getRoomServices(Number(id));
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRoomDto,
    @CurrentUser() user: User,
  ) {
    if (user.role === 'EMPLOYEE') {
      const room = await this.roomsService.findOne(id);
      const isManager = await this.roomsService.isHotelManager(user.id, room.hotelId);
      if (!isManager) {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới có quyền sửa thông tin/giá phòng của khách sạn này.',
        );
      }
    }
    return this.roomsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.roomsService.remove(id);
  }

  // ============================================================
  // ALBUM ẢNH PHÒNG
  // HỖ TRỢ UPLOAD NHIỀU FILE ẢNH CÙNG LÚC
  // ============================================================

  @Post(':id/images/upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @RateLimit({
    slidingWindow: {
      limit: 20,
      windowMs: 60_000,
    },
  })
  @UseInterceptors(AnyFilesInterceptor(createMulterOptions('rooms')))
  async uploadImages(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @UploadedFiles() files?: Express.Multer.File[],
    @Body('caption') caption?: string,
  ) {
    if (user.role === 'EMPLOYEE') {
      const room = await this.roomsService.findOne(id);
      const isManager = await this.roomsService.isHotelManager(user.id, room.hotelId);
      if (!isManager) {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới có quyền cập nhật ảnh phòng của khách sạn này.',
        );
      }
    }
    if (!files || files.length === 0) {
      throw new BadRequestException('Vui lòng đính kèm ít nhất 1 file ảnh.');
    }

    const dtos: AddRoomImageDto[] = files.map((file, index) => ({
      imageUrl: `/uploads/rooms/${file.filename}`,
      caption: caption ?? file.originalname,
      sortOrder: index,
    }));

    return this.roomsService.addImages(id, dtos);
  }

  @Post(':id/images')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  async addImage(
    @Param('id') id: string,
    @Body() dto: AddRoomImageDto,
    @CurrentUser() user: User,
  ) {
    if (user.role === 'EMPLOYEE') {
      const room = await this.roomsService.findOne(id);
      const isManager = await this.roomsService.isHotelManager(user.id, room.hotelId);
      if (!isManager) {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới có quyền thêm ảnh phòng của khách sạn này.',
        );
      }
    }
    return this.roomsService.addImage(id, dto);
  }

  @Get(':id/images')
  getImages(@Param('id') id: string) {
    return this.roomsService.getImages(id);
  }

  @Patch(':id/images/:imageId/primary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  async setPrimaryImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: User,
  ) {
    if (user.role === 'EMPLOYEE') {
      const room = await this.roomsService.findOne(id);
      const isManager = await this.roomsService.isHotelManager(user.id, room.hotelId);
      if (!isManager) {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới có quyền đổi ảnh đại diện phòng của khách sạn này.',
        );
      }
    }
    return this.roomsService.setPrimaryImage(id, imageId);
  }

  @Delete(':id/images/:imageId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  deleteImage(@Param('id') id: string, @Param('imageId') imageId: string) {
    return this.roomsService.deleteImage(id, imageId);
  }
}
