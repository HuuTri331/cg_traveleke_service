import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

import { AddHotelImageDto } from './dto/add-hotel-image.dto';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { QueryHotelDto } from './dto/query-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { SearchHotelDto } from './dto/search-hotel.dto';

import { HotelsService } from './hotels.service';
import { createMulterOptions } from './upload-image.config';

@Controller('hotels')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  // ============================================================
  // KHÁCH SẠN
  // ============================================================

  @Post()
  @Roles('ADMIN', 'EMPLOYEE')
  create(@Body() dto: CreateHotelDto) {
    return this.hotelsService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryHotelDto) {
    return this.hotelsService.findAll(query);
  }

  @Get('search')
  search(@Query() query: SearchHotelDto) {
    return this.hotelsService.search(query);
  }
  
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.hotelsService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'EMPLOYEE')
  update(@Param('id') id: string, @Body() dto: UpdateHotelDto) {
    return this.hotelsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.hotelsService.remove(id);
  }

  // ============================================================
  // ALBUM ẢNH KHÁCH SẠN
  // Hỗ trợ upload cùng lúc nhiều file ảnh
  // ============================================================

  @Post(':id/images/upload')
  @Roles('ADMIN', 'EMPLOYEE')
  @UseInterceptors(AnyFilesInterceptor(createMulterOptions('hotels')))
  uploadImages(
    @Param('id') id: string,
    @UploadedFiles() files?: Express.Multer.File[],
    @Body('caption') caption?: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException(
        'Vui lòng đính kèm ít nhất 1 file ảnh.',
      );
    }

    const dtos: AddHotelImageDto[] = files.map((file, index) => ({
      imageUrl: `/uploads/hotels/${file.filename}`,
      caption: caption ?? file.originalname,
      sortOrder: index,
    }));

    return this.hotelsService.addImages(id, dtos);
  }

  @Post(':id/images')
  @Roles('ADMIN', 'EMPLOYEE')
  addImage(
    @Param('id') id: string,
    @Body() dto: AddHotelImageDto,
  ) {
    return this.hotelsService.addImage(id, dto);
  }

  @Get(':id/images')
  getImages(@Param('id') id: string) {
    return this.hotelsService.getImages(id);
  }

  @Patch(':id/images/:imageId/primary')
  @Roles('ADMIN', 'EMPLOYEE')
  setPrimaryImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.hotelsService.setPrimaryImage(id, imageId);
  }

  @Delete(':id/images/:imageId')
  @Roles('ADMIN', 'EMPLOYEE')
  deleteImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.hotelsService.deleteImage(id, imageId);
  }
}