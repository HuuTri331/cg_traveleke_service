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
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';

import { createMulterOptions } from '../hotels/upload-image.config';
import { AddRoomImageDto } from './dto/add-room-image.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { QueryRoomDto } from './dto/query-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomsService } from './rooms.service';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  create(@Body() dto: CreateRoomDto) {
    return this.roomsService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryRoomDto) {
    return this.roomsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.roomsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRoomDto) {
    return this.roomsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.roomsService.remove(id);
  }

  // ============================================================
  // ALBUM ẢNH PHÒNG (HỖ TRỢ UPLOAD CÙNG LÚC NHIỀU FILE ẢNH, TỐI ĐA 5 ẢNH)
  // ============================================================

  @Post(':id/images/upload')
  @UseInterceptors(AnyFilesInterceptor(createMulterOptions('rooms')))
  uploadImages(
    @Param('id') id: string,
    @UploadedFiles() files?: Express.Multer.File[],
    @Body('caption') caption?: string,
  ) {
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
  addImage(@Param('id') id: string, @Body() dto: AddRoomImageDto) {
    return this.roomsService.addImage(id, dto);
  }

  @Get(':id/images')
  getImages(@Param('id') id: string) {
    return this.roomsService.getImages(id);
  }

  @Patch(':id/images/:imageId/primary')
  setPrimaryImage(@Param('id') id: string, @Param('imageId') imageId: string) {
    return this.roomsService.setPrimaryImage(id, imageId);
  }

  @Delete(':id/images/:imageId')
  deleteImage(@Param('id') id: string, @Param('imageId') imageId: string) {
    return this.roomsService.deleteImage(id, imageId);
  }
}
