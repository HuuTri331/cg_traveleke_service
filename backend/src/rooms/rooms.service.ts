import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { HotelsService } from '../hotels/hotels.service';
import { deletePhysicalFile } from '../hotels/upload-image.config';
import { AddRoomImageDto } from './dto/add-room-image.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { QueryRoomDto } from './dto/query-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomImage } from './entities/room-image.entity';
import { Room, RoomStatus } from './entities/room.entity';

export const MAX_ROOM_IMAGES = 5;

@Injectable()
export class RoomsService {
  constructor(
    @InjectRepository(Room)
    private readonly roomsRepository: Repository<Room>,
    @InjectRepository(RoomImage)
    private readonly roomImagesRepository: Repository<RoomImage>,
    private readonly hotelsService: HotelsService,
  ) {}

  async create(dto: CreateRoomDto): Promise<Room> {
    // 1. Kiểm tra khách sạn tồn tại bằng cách gọi HotelsService
    await this.hotelsService.findOne(String(dto.hotelId));

    // 2. Tạo slug duy nhất theo từng khách sạn
    const slug = await this.buildUniqueSlug(dto.slug ?? dto.name, dto.hotelId);

    const totalRooms = dto.totalRooms ?? 1;
    const availableRooms = dto.availableRooms ?? totalRooms;

    if (availableRooms > totalRooms) {
      throw new BadRequestException(
        'Số phòng còn trống (availableRooms) không được vượt quá tổng số phòng (totalRooms).',
      );
    }

    const room = this.roomsRepository.create({
      hotelId: String(dto.hotelId),
      name: dto.name.trim(),
      slug,
      description: dto.description?.trim() ?? null,
      pricePerNight: String(dto.pricePerNight),
      checkInTime: dto.checkInTime ?? '14:00:00',
      checkOutTime: dto.checkOutTime ?? '12:00:00',
      maxAdults: dto.maxAdults ?? 2,
      maxChildren: dto.maxChildren ?? 0,
      totalRooms,
      availableRooms,
      bedCount: dto.bedCount ?? 1,
      bedType: dto.bedType?.trim() ?? 'Giường Đôi',
      roomSize: dto.roomSize ?? null,
      rating: dto.rating !== undefined ? Number(dto.rating).toFixed(2) : '5.00',
      reviewCount: dto.reviewCount ?? 0,
      coverImageUrl: dto.coverImageUrl?.trim() ?? null,
      status: dto.status ?? RoomStatus.AVAILABLE,
    });

    try {
      const savedRoom = await this.roomsRepository.save(room);

      if (savedRoom.coverImageUrl) {
        await this.roomImagesRepository.save(
          this.roomImagesRepository.create({
            roomId: savedRoom.id,
            imageUrl: savedRoom.coverImageUrl,
            caption: 'Ảnh đại diện phòng',
            sortOrder: 0,
            isPrimary: 1,
          }),
        );
      }

      return savedRoom;
    } catch (error) {
      this.rethrowDatabaseError(error);
    }
  }

  async findAll(query: QueryRoomDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const qb = this.roomsRepository
      .createQueryBuilder('room')
      .orderBy('room.id', 'DESC');

    if (query.hotelId) {
      qb.andWhere('room.hotel_id = :hotelId', {
        hotelId: query.hotelId,
      });
    }

    if (query.search?.trim()) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere('room.name LIKE :search', { search });
    }

    if (query.status) {
      qb.andWhere('room.status = :status', {
        status: query.status,
      });
    }

    if (query.minPrice !== undefined) {
      qb.andWhere('room.price_per_night >= :minPrice', {
        minPrice: query.minPrice,
      });
    }

    if (query.maxPrice !== undefined) {
      qb.andWhere('room.price_per_night <= :maxPrice', {
        maxPrice: query.maxPrice,
      });
    }

    if (query.adults !== undefined) {
      qb.andWhere('room.max_adults >= :adults', {
        adults: query.adults,
      });
    }

    if (query.children !== undefined) {
      qb.andWhere('room.max_children >= :children', {
        children: query.children,
      });
    }

    qb.skip((page - 1) * perPage).take(perPage);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findOne(id: string): Promise<Room> {
    this.assertValidId(id);

    const room = await this.roomsRepository.findOne({
      where: { id },
    });

    if (!room) {
      throw new NotFoundException(`Không tìm thấy phòng có id=${id}.`);
    }

    const images = await this.roomImagesRepository.find({
      where: { roomId: id },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });

    room.images = images;
    return room;
  }

  async update(id: string, dto: UpdateRoomDto): Promise<Room> {
    const room = await this.findOne(id);

    if (dto.hotelId !== undefined) {
      await this.hotelsService.findOne(String(dto.hotelId));
      room.hotelId = String(dto.hotelId);
    }

    if (dto.name !== undefined) {
      room.name = dto.name.trim();
    }

    if (dto.slug !== undefined) {
      room.slug = await this.buildUniqueSlug(dto.slug, room.hotelId, room.id);
    }

    if (dto.description !== undefined) {
      room.description = dto.description?.trim() ?? null;
    }

    if (dto.pricePerNight !== undefined) {
      room.pricePerNight = String(dto.pricePerNight);
    }

    if (dto.checkInTime !== undefined) {
      room.checkInTime = dto.checkInTime;
    }

    if (dto.checkOutTime !== undefined) {
      room.checkOutTime = dto.checkOutTime;
    }

    if (dto.maxAdults !== undefined) {
      room.maxAdults = dto.maxAdults;
    }

    if (dto.maxChildren !== undefined) {
      room.maxChildren = dto.maxChildren;
    }

    if (dto.totalRooms !== undefined) {
      room.totalRooms = dto.totalRooms;
    }

    if (dto.availableRooms !== undefined) {
      room.availableRooms = dto.availableRooms;
    }

    if (room.availableRooms > room.totalRooms) {
      throw new BadRequestException(
        'Số phòng còn trống (availableRooms) không được vượt quá tổng số phòng (totalRooms).',
      );
    }

    if (dto.bedCount !== undefined) {
      room.bedCount = dto.bedCount;
    }

    if (dto.bedType !== undefined) {
      room.bedType = dto.bedType.trim();
    }

    if (dto.roomSize !== undefined) {
      room.roomSize = dto.roomSize;
    }

    if (dto.rating !== undefined) {
      room.rating = Number(dto.rating).toFixed(2);
    }

    if (dto.reviewCount !== undefined) {
      room.reviewCount = dto.reviewCount;
    }

    if (dto.coverImageUrl !== undefined) {
      room.coverImageUrl = dto.coverImageUrl?.trim() ?? null;
    }

    if (dto.status !== undefined) {
      room.status = dto.status;
    }

    try {
      return await this.roomsRepository.save(room);
    } catch (error) {
      this.rethrowDatabaseError(error);
    }
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const room = await this.findOne(id);
    await this.roomsRepository.softDelete(room.id);
    return {
      success: true,
      message: `Đã xóa phòng ${room.name} (id=${id}) thành công.`,
    };
  }

  // ============================================================
  // ALBUM ẢNH PHÒNG (HỖ TRỢ UPLOAD NHIỀU ẢNH CÙNG LÚC, TỐI ĐA 5 ẢNH)
  // ============================================================

  async addImages(
    roomId: string,
    dtos: AddRoomImageDto[],
  ): Promise<RoomImage[]> {
    if (!dtos || dtos.length === 0) {
      throw new BadRequestException('Vui lòng cung cấp ít nhất 1 ảnh.');
    }

    const room = await this.findOne(roomId);

    const currentCount = await this.roomImagesRepository.count({
      where: { roomId: room.id },
    });

    if (currentCount + dtos.length > MAX_ROOM_IMAGES) {
      throw new BadRequestException(
        `Phòng này hiện có ${currentCount} ảnh. Bạn đang tải thêm ${dtos.length} ảnh, sẽ vượt quá giới hạn tối đa ${MAX_ROOM_IMAGES} ảnh. Vui lòng chọn tối đa ${MAX_ROOM_IMAGES - currentCount} ảnh.`,
      );
    }

    const savedImages: RoomImage[] = [];

    for (let i = 0; i < dtos.length; i++) {
      const dto = dtos[i];
      const isPrimary = Boolean(
        dto.isPrimary || (currentCount === 0 && i === 0),
      );

      if (isPrimary) {
        await this.roomImagesRepository.update(
          { roomId: room.id },
          { isPrimary: 0 },
        );
        room.coverImageUrl = dto.imageUrl.trim();
        await this.roomsRepository.save(room);
      }

      const newImage = this.roomImagesRepository.create({
        roomId: room.id,
        imageUrl: dto.imageUrl.trim(),
        caption: dto.caption?.trim() ?? null,
        sortOrder: dto.sortOrder ?? currentCount + i,
        isPrimary: isPrimary ? 1 : 0,
      });

      const saved = await this.roomImagesRepository.save(newImage);
      savedImages.push(saved);
    }

    return savedImages;
  }

  async addImage(roomId: string, dto: AddRoomImageDto): Promise<RoomImage> {
    const [saved] = await this.addImages(roomId, [dto]);
    return saved;
  }

  async getImages(roomId: string): Promise<RoomImage[]> {
    this.assertValidId(roomId);
    let images = await this.roomImagesRepository.find({
      where: { roomId },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });

    if (images.length === 0) {
      const room = await this.roomsRepository.findOne({ where: { id: roomId } });
      if (room?.coverImageUrl && room.coverImageUrl.trim()) {
        const initialImg = this.roomImagesRepository.create({
          roomId: room.id,
          imageUrl: room.coverImageUrl.trim(),
          caption: 'Ảnh đại diện chính',
          sortOrder: 0,
          isPrimary: 1,
        });
        const saved = await this.roomImagesRepository.save(initialImg);
        images = [saved];
      }
    }

    return images;
  }

  async setPrimaryImage(roomId: string, imageId: string): Promise<Room> {
    const room = await this.findOne(roomId);

    const image = await this.roomImagesRepository.findOne({
      where: { id: imageId, roomId: room.id },
    });

    if (!image) {
      throw new NotFoundException(
        `Không tìm thấy ảnh có id=${imageId} trong album của phòng này.`,
      );
    }

    await this.roomImagesRepository.update(
      { roomId: room.id },
      { isPrimary: 0 },
    );

    image.isPrimary = 1;
    await this.roomImagesRepository.save(image);

    room.coverImageUrl = image.imageUrl;
    return await this.roomsRepository.save(room);
  }

  async deleteImage(
    roomId: string,
    imageId: string,
  ): Promise<{ success: boolean; message: string }> {
    const room = await this.findOne(roomId);

    const image = await this.roomImagesRepository.findOne({
      where: { id: imageId, roomId: room.id },
    });

    if (!image) {
      throw new NotFoundException(
        `Không tìm thấy ảnh có id=${imageId} trong album của phòng này.`,
      );
    }

    const wasPrimary = image.isPrimary === 1;

    // Xóa file vật lý trên đĩa (folder uploads/rooms)
    deletePhysicalFile(image.imageUrl);

    await this.roomImagesRepository.delete(image.id);

    if (wasPrimary) {
      const nextImage = await this.roomImagesRepository.findOne({
        where: { roomId: room.id },
        order: { sortOrder: 'ASC', id: 'ASC' },
      });

      if (nextImage) {
        nextImage.isPrimary = 1;
        await this.roomImagesRepository.save(nextImage);
        room.coverImageUrl = nextImage.imageUrl;
      } else {
        room.coverImageUrl = null;
      }

      await this.roomsRepository.save(room);
    }

    return {
      success: true,
      message: `Đã xóa ảnh id=${imageId} khỏi album phòng thành công.`,
    };
  }

  private assertValidId(id: string): void {
    if (!/^\d+$/.test(id) || id === '0') {
      throw new BadRequestException('Room id không hợp lệ.');
    }
  }

  private normalizeSlug(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/đ/g, 'd')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 170);
  }

  private async buildUniqueSlug(
    value: string,
    hotelId: number | string,
    ignoreId?: string,
  ): Promise<string> {
    const base = this.normalizeSlug(value);

    if (!base) {
      throw new BadRequestException(
        'Không thể tạo slug hợp lệ từ tên phòng đã nhập.',
      );
    }

    let candidate = base;
    let suffix = 2;

    while (true) {
      const qb = this.roomsRepository
        .createQueryBuilder('room')
        .withDeleted()
        .where('room.hotel_id = :hotelId', { hotelId })
        .andWhere('room.slug = :slug', { slug: candidate });

      if (ignoreId) {
        qb.andWhere('room.id <> :ignoreId', { ignoreId });
      }

      const exists = await qb.getExists();

      if (!exists) {
        return candidate;
      }

      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
  }

  private rethrowDatabaseError(error: unknown): never {
    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as {
        errno?: number;
        code?: string;
      };

      if (driverError.errno === 1452) {
        throw new BadRequestException(
          'Khách sạn (hotelId) không tồn tại trong hệ thống.',
        );
      }

      if (driverError.errno === 1062) {
        throw new ConflictException(
          'Dữ liệu phòng bị trùng slug trong cùng một khách sạn.',
        );
      }
    }

    throw error;
  }
}
