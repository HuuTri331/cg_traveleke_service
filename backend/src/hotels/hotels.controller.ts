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

import { AddHotelImageDto } from './dto/add-hotel-image.dto';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { QueryHotelDto } from './dto/query-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { SearchHotelDto } from './dto/search-hotel.dto';

import { HotelsService } from './hotels.service';
import { createMulterOptions } from './upload-image.config';
import { RateLimiterGuard } from '../rate-limit/rate-limiter.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';

@Controller('hotels')
@UseGuards(RateLimiterGuard)
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  // ============================================================
  // KHÁCH SẠN (PUBLIC ĐỌC & TÌM KIẾM CHO KHÁCH HÀNG)
  // ============================================================

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  create(@Body() dto: CreateHotelDto) {
    return this.hotelsService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryHotelDto) {
    return this.hotelsService.findAll(query);
  }

  @Get('search')
  @RateLimit({
    slidingWindow: {
      limit: 120,
      windowMs: 60_000,
    },
  })
  search(@Query() query: SearchHotelDto) {
    return this.hotelsService.search(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.hotelsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHotelDto,
    @CurrentUser() user: User,
  ) {
    if (user.role === 'EMPLOYEE') {
      const isManager = await this.hotelsService.isHotelManager(user.id, id);
      if (!isManager) {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới có quyền cập nhật thông tin khách sạn này.',
        );
      }
    }
    return this.hotelsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.hotelsService.remove(id);
  }

  // ============================================================
  // ALBUM ẢNH KHÁCH SẠN
  // Hỗ trợ upload cùng lúc nhiều file ảnh
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
  @UseInterceptors(AnyFilesInterceptor(createMulterOptions('hotels')))
  async uploadImages(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @UploadedFiles() files?: Express.Multer.File[],
    @Body('caption') caption?: string,
  ) {
    if (user.role === 'EMPLOYEE') {
      const isManager = await this.hotelsService.isHotelManager(user.id, id);
      if (!isManager) {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới có quyền tải ảnh lên cho khách sạn này.',
        );
      }
    }
    if (!files || files.length === 0) {
      throw new BadRequestException('Vui lòng đính kèm ít nhất 1 file ảnh.');
    }

    const dtos: AddHotelImageDto[] = files.map((file, index) => ({
      imageUrl: `/uploads/hotels/${file.filename}`,
      caption: caption ?? file.originalname,
      sortOrder: index,
    }));

    return this.hotelsService.addImages(id, dtos);
  }

  @Post(':id/images')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  async addImage(
    @Param('id') id: string,
    @Body() dto: AddHotelImageDto,
    @CurrentUser() user: User,
  ) {
    if (user.role === 'EMPLOYEE') {
      const isManager = await this.hotelsService.isHotelManager(user.id, id);
      if (!isManager) {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới có quyền thêm ảnh cho khách sạn này.',
        );
      }
    }
    return this.hotelsService.addImage(id, dto);
  }

  @Get(':id/images')
  getImages(@Param('id') id: string) {
    return this.hotelsService.getImages(id);
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
      const isManager = await this.hotelsService.isHotelManager(user.id, id);
      if (!isManager) {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới có quyền đổi ảnh đại diện cho khách sạn này.',
        );
      }
    }
    return this.hotelsService.setPrimaryImage(id, imageId);
  }

  @Delete(':id/images/:imageId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  async deleteImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: User,
  ) {
    if (user.role === 'EMPLOYEE') {
      const isManager = await this.hotelsService.isHotelManager(user.id, id);
      if (!isManager) {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới có quyền xóa ảnh của khách sạn này.',
        );
      }
    }
    return this.hotelsService.deleteImage(id, imageId);
  }
}
