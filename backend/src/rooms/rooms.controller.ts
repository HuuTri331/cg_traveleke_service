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
import { createMulterOptions } from '../hotels/upload-image.config';

import { AddRoomImageDto } from './dto/add-room-image.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { QueryRoomDto } from './dto/query-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomsService } from './rooms.service';

import { SearchRoomDto } from './dto/search-room.dto';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  // ============================================================
  // CRUD PHÒNG (PUBLIC ĐỌC & TÌM KIẾM CHO KHÁCH HÀNG)
  // ============================================================

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  create(@Body() dto: CreateRoomDto) {
    return this.roomsService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryRoomDto) {
    return this.roomsService.findAll(query);
  }

  @Get('search')
  search(@Query() query: SearchRoomDto) {
    return this.roomsService.search(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.roomsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  update(@Param('id') id: string, @Body() dto: UpdateRoomDto) {
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
  @UseInterceptors(AnyFilesInterceptor(createMulterOptions('rooms')))
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
  addImage(
    @Param('id') id: string,
    @Body() dto: AddRoomImageDto,
  ) {
    return this.roomsService.addImage(id, dto);
  }

  @Get(':id/images')
  getImages(@Param('id') id: string) {
    return this.roomsService.getImages(id);
  }

  @Patch(':id/images/:imageId/primary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  setPrimaryImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.roomsService.setPrimaryImage(id, imageId);
  }

  @Delete(':id/images/:imageId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  deleteImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.roomsService.deleteImage(id, imageId);
  }
}