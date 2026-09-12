import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { SearchHotelDto } from './dto/search-hotel.dto';

import { AddHotelImageDto } from './dto/add-hotel-image.dto';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { QueryHotelDto } from './dto/query-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { HotelImage } from './entities/hotel-image.entity';
import { Hotel, HotelStatus } from './entities/hotel.entity';
import { deletePhysicalFile } from './upload-image.config';

export const MAX_HOTEL_IMAGES = 6;

@Injectable()
export class HotelsService {
  constructor(
    @InjectRepository(Hotel)
    private readonly hotelsRepository: Repository<Hotel>,
    @InjectRepository(HotelImage)
    private readonly hotelImagesRepository: Repository<HotelImage>,
  ) {}

  async create(dto: CreateHotelDto): Promise<Hotel> {
    const slug = await this.buildUniqueSlug(dto.slug ?? dto.name);

    const hotel = this.hotelsRepository.create({
      hotelTypeId: String(dto.hotelTypeId),
      locationId: String(dto.locationId),
      createdBy: null,
      name: dto.name.trim(),
      slug,
      description: dto.description?.trim() ?? null,
      starRating: dto.starRating ?? null,
      address: dto.address.trim(),
      latitude:
        dto.latitude === undefined || dto.latitude === null
          ? null
          : String(dto.latitude),
      longitude:
        dto.longitude === undefined || dto.longitude === null
          ? null
          : String(dto.longitude),
      phone: dto.phone?.trim() ?? null,
      email: dto.email?.trim().toLowerCase() ?? null,
      checkInTime: dto.checkInTime ?? '14:00:00',
      checkOutTime: dto.checkOutTime ?? '12:00:00',
      coverImageUrl: dto.coverImageUrl?.trim() ?? null,
      status: dto.status ?? HotelStatus.DRAFT,
    });

    try {
      const savedHotel = await this.hotelsRepository.save(hotel);

      if (savedHotel.coverImageUrl) {
        await this.hotelImagesRepository.save(
          this.hotelImagesRepository.create({
            hotelId: savedHotel.id,
            imageUrl: savedHotel.coverImageUrl,
            caption: 'Ảnh đại diện chính',
            sortOrder: 0,
            isPrimary: 1,
          }),
        );
      }

      return savedHotel;
    } catch (error) {
      this.rethrowDatabaseError(error);
    }
  }

  async findAll(query: QueryHotelDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const qb = this.hotelsRepository
      .createQueryBuilder('hotel')
      .orderBy('hotel.id', 'DESC');

    if (query.search?.trim()) {
      const search = `%${query.search.trim()}%`;

      qb.andWhere(
        `(
          hotel.name LIKE :search
          OR hotel.address LIKE :search
          OR hotel.email LIKE :search
        )`,
        { search },
      );
    }

    if (query.status) {
      qb.andWhere('hotel.status = :status', {
        status: query.status,
      });
    }

    if (query.hotelTypeId) {
      qb.andWhere('hotel.hotel_type_id = :hotelTypeId', {
        hotelTypeId: query.hotelTypeId,
      });
    }

    if (query.locationId) {
      qb.andWhere('hotel.location_id = :locationId', {
        locationId: query.locationId,
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

  async search(query: SearchHotelDto) {
  const page = query.page ?? 1;
  const perPage = query.perPage ?? 10;

  const qb = this.hotelsRepository
    .createQueryBuilder('hotel')
    .where('hotel.deleted_at IS NULL')
    .orderBy('hotel.id', 'DESC');

  if (query.keyword?.trim()) {
    const keyword = `%${query.keyword.trim()}%`;

    qb.andWhere(
      `(
        hotel.name LIKE :keyword
        OR hotel.address LIKE :keyword
        OR hotel.description LIKE :keyword
        OR hotel.email LIKE :keyword
      )`,
      { keyword },
    );
  }

  if (query.locationId) {
    qb.andWhere('hotel.location_id = :locationId', {
      locationId: query.locationId,
    });
  }

  if (query.hotelTypeId) {
    qb.andWhere('hotel.hotel_type_id = :hotelTypeId', {
      hotelTypeId: query.hotelTypeId,
    });
  }

  if (query.starRating) {
    qb.andWhere('hotel.star_rating = :starRating', {
      starRating: query.starRating,
    });
  }

  if (query.status) {
    qb.andWhere('hotel.status = :status', {
      status: query.status,
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

  async findOne(id: string): Promise<Hotel> {
    this.assertValidId(id);

    const hotel = await this.hotelsRepository.findOne({
      where: { id },
    });

    if (!hotel) {
      throw new NotFoundException(`Không tìm thấy khách sạn có id=${id}.`);
    }

    const images = await this.hotelImagesRepository.find({
      where: { hotelId: id },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });

    hotel.images = images;
    return hotel;
  }

  async update(id: string, dto: UpdateHotelDto): Promise<Hotel> {
    const hotel = await this.findOne(id);

    if (dto.hotelTypeId !== undefined) {
      hotel.hotelTypeId = String(dto.hotelTypeId);
    }

    if (dto.locationId !== undefined) {
      hotel.locationId = String(dto.locationId);
    }

    if (dto.name !== undefined) {
      hotel.name = dto.name.trim();
    }

    if (dto.slug !== undefined) {
      hotel.slug = await this.buildUniqueSlug(dto.slug, hotel.id);
    }

    if (dto.description !== undefined) {
      hotel.description = dto.description?.trim() ?? null;
    }

    if (dto.starRating !== undefined) {
      hotel.starRating = dto.starRating;
    }

    if (dto.address !== undefined) {
      hotel.address = dto.address.trim();
    }

    if (dto.latitude !== undefined) {
      hotel.latitude = dto.latitude === null ? null : String(dto.latitude);
    }

    if (dto.longitude !== undefined) {
      hotel.longitude = dto.longitude === null ? null : String(dto.longitude);
    }

    if (dto.phone !== undefined) {
      hotel.phone = dto.phone?.trim() ?? null;
    }

    if (dto.email !== undefined) {
      hotel.email = dto.email?.trim().toLowerCase() ?? null;
    }

    if (dto.checkInTime !== undefined) {
      hotel.checkInTime = dto.checkInTime;
    }

    if (dto.checkOutTime !== undefined) {
      hotel.checkOutTime = dto.checkOutTime;
    }

    if (dto.coverImageUrl !== undefined) {
      hotel.coverImageUrl = dto.coverImageUrl?.trim() ?? null;
    }

    if (dto.status !== undefined) {
      hotel.status = dto.status;
    }

    try {
      return await this.hotelsRepository.save(hotel);
    } catch (error) {
      this.rethrowDatabaseError(error);
    }
  }
    async remove(id: string): Promise<void> {
    const hotel = await this.findOne(id);
    await this.hotelsRepository.softDelete(hotel.id);
  }

  // ============================================================
  // ALBUM ẢNH KHÁCH SẠN (HỖ TRỢ UPLOAD NHIỀU ẢNH CÙNG LÚC, TỐI ĐA 6 ẢNH)
  // ============================================================

  async addImages(
    hotelId: string,
    dtos: AddHotelImageDto[],
  ): Promise<HotelImage[]> {
    if (!dtos || dtos.length === 0) {
      throw new BadRequestException('Vui lòng cung cấp ít nhất 1 ảnh.');
    }

    const hotel = await this.findOne(hotelId);

    const currentCount = await this.hotelImagesRepository.count({
      where: { hotelId: hotel.id },
    });

    if (currentCount + dtos.length > MAX_HOTEL_IMAGES) {
      throw new BadRequestException(
        `Khách sạn này hiện có ${currentCount} ảnh. Bạn đang tải thêm ${dtos.length} ảnh, sẽ vượt quá giới hạn tối đa ${MAX_HOTEL_IMAGES} ảnh. Vui lòng chọn tối đa ${MAX_HOTEL_IMAGES - currentCount} ảnh.`,
      );
    }

    const savedImages: HotelImage[] = [];

    for (let i = 0; i < dtos.length; i++) {
      const dto = dtos[i];
      const isPrimary = Boolean(
        dto.isPrimary || (currentCount === 0 && i === 0),
      );

      if (isPrimary) {
        await this.hotelImagesRepository.update(
          { hotelId: hotel.id },
          { isPrimary: 0 },
        );
        hotel.coverImageUrl = dto.imageUrl.trim();
        await this.hotelsRepository.save(hotel);
      }

      const newImage = this.hotelImagesRepository.create({
        hotelId: hotel.id,
        imageUrl: dto.imageUrl.trim(),
        caption: dto.caption?.trim() ?? null,
        sortOrder: dto.sortOrder ?? currentCount + i,
        isPrimary: isPrimary ? 1 : 0,
      });

      const saved = await this.hotelImagesRepository.save(newImage);
      savedImages.push(saved);
    }

    return savedImages;
  }

  async addImage(hotelId: string, dto: AddHotelImageDto): Promise<HotelImage> {
    const [saved] = await this.addImages(hotelId, [dto]);
    return saved;
  }

  async getImages(hotelId: string): Promise<HotelImage[]> {
    this.assertValidId(hotelId);
    let images = await this.hotelImagesRepository.find({
      where: { hotelId },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });

    if (images.length === 0) {
      const hotel = await this.hotelsRepository.findOne({ where: { id: hotelId } });
      if (hotel?.coverImageUrl && hotel.coverImageUrl.trim()) {
        const initialImg = this.hotelImagesRepository.create({
          hotelId: hotel.id,
          imageUrl: hotel.coverImageUrl.trim(),
          caption: 'Ảnh đại diện chính',
          sortOrder: 0,
          isPrimary: 1,
        });
        const saved = await this.hotelImagesRepository.save(initialImg);
        images = [saved];
      }
    }

    return images;
  }

  async setPrimaryImage(hotelId: string, imageId: string): Promise<Hotel> {
    const hotel = await this.findOne(hotelId);

    const image = await this.hotelImagesRepository.findOne({
      where: { id: imageId, hotelId: hotel.id },
    });

    if (!image) {
      throw new NotFoundException(
        `Không tìm thấy ảnh có id=${imageId} trong album của khách sạn này.`,
      );
    }

    await this.hotelImagesRepository.update(
      { hotelId: hotel.id },
      { isPrimary: 0 },
    );

    image.isPrimary = 1;
    await this.hotelImagesRepository.save(image);

    hotel.coverImageUrl = image.imageUrl;
    return await this.hotelsRepository.save(hotel);
  }

  async deleteImage(
    hotelId: string,
    imageId: string,
  ): Promise<{ success: boolean; message: string }> {
    const hotel = await this.findOne(hotelId);

    const image = await this.hotelImagesRepository.findOne({
      where: { id: imageId, hotelId: hotel.id },
    });

    if (!image) {
      throw new NotFoundException(
        `Không tìm thấy ảnh có id=${imageId} trong album của khách sạn này.`,
      );
    }

    const wasPrimary = image.isPrimary === 1;

    // Xóa file vật lý trên đĩa (folder uploads/hotels)
    deletePhysicalFile(image.imageUrl);

    await this.hotelImagesRepository.delete(image.id);

    if (wasPrimary) {
      const nextImage = await this.hotelImagesRepository.findOne({
        where: { hotelId: hotel.id },
        order: { sortOrder: 'ASC', id: 'ASC' },
      });

      if (nextImage) {
        nextImage.isPrimary = 1;
        await this.hotelImagesRepository.save(nextImage);
        hotel.coverImageUrl = nextImage.imageUrl;
      } else {
        hotel.coverImageUrl = null;
      }

      await this.hotelsRepository.save(hotel);
    }

    return {
      success: true,
      message: `Đã xóa ảnh id=${imageId} khỏi album khách sạn thành công.`,
    };
  }

  private assertValidId(id: string): void {
    if (!/^\d+$/.test(id) || id === '0') {
      throw new BadRequestException('Hotel id không hợp lệ.');
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
      .slice(0, 210);
  }

  private async buildUniqueSlug(
    value: string,
    ignoreId?: string,
  ): Promise<string> {
    const base = this.normalizeSlug(value);

    if (!base) {
      throw new BadRequestException(
        'Không thể tạo slug hợp lệ từ dữ liệu đã nhập.',
      );
    }

    let candidate = base;
    let suffix = 2;

    while (true) {
      const qb = this.hotelsRepository
        .createQueryBuilder('hotel')
        .withDeleted()
        .where('hotel.slug = :slug', { slug: candidate });

      if (ignoreId) {
        qb.andWhere('hotel.id <> :ignoreId', { ignoreId });
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
          'Dữ liệu kiểu khách sạn và vị trí khách sạn chưa có trong database nên chưa tạo khách sạn được!',
        );
}
      if (driverError.errno === 1062) {
        throw new ConflictException(
          'Dữ liệu hotel bị trùng ở trường UNIQUE (ví dụ slug).',
        );
      }
    }

    throw error;
  }
}
