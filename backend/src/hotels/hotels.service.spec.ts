import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository, SelectQueryBuilder } from 'typeorm';

import { CreateHotelDto } from './dto/create-hotel.dto';
import { QueryHotelDto } from './dto/query-hotel.dto';
import { HotelImage } from './entities/hotel-image.entity';
import { Hotel, HotelStatus } from './entities/hotel.entity';
import { HotelsService, MAX_HOTEL_IMAGES } from './hotels.service';

describe('HotelsService', () => {
  let service: HotelsService;
  let hotelsRepository: jest.Mocked<Repository<Hotel>>;
  let mockRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
    softDelete: jest.Mock;
    restore: jest.Mock;
  };
  let mockImageRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn().mockImplementation((dto: Partial<Hotel>) => dto),
      save: jest.fn().mockImplementation((entity: Hotel) =>
        Promise.resolve({
          ...entity,
          id: entity.id ?? '1',
        }),
      ),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
      softDelete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
      restore: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
    };

    mockImageRepo = {
      create: jest.fn().mockImplementation((dto: Partial<HotelImage>) => dto),
      save: jest.fn().mockImplementation((entity: HotelImage) =>
        Promise.resolve({
          ...entity,
          id: entity.id ?? '101',
        }),
      ),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HotelsService,
        {
          provide: getRepositoryToken(Hotel),
          useValue: mockRepo,
        },
        {
          provide: getRepositoryToken(HotelImage),
          useValue: mockImageRepo,
        },
      ],
    }).compile();

    service = module.get<HotelsService>(HotelsService);
    hotelsRepository = module.get(getRepositoryToken(Hotel));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully create hotel and generate unique slug', async () => {
      const qbSlugMock = {
        withDeleted: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getExists: jest.fn().mockResolvedValue(false),
      } as unknown as SelectQueryBuilder<Hotel>;

      hotelsRepository.createQueryBuilder.mockReturnValue(qbSlugMock);

      const dto: CreateHotelDto = {
        hotelTypeId: 1,
        locationId: 1,
        name: 'Rex Hotel Saigon',
        address: '141 Nguyễn Huệ, Quận 1',
        starRating: 5,
        coverImageUrl: '/uploads/hotels/rex.jpg',
      };

      const result = await service.create(dto);

      expect(result).toBeDefined();
      expect(result.name).toBe('Rex Hotel Saigon');
      expect(result.slug).toBe('rex-hotel-saigon');
      expect(result.status).toBe(HotelStatus.DRAFT);
      expect(result.createdBy).toBeNull();
      expect(mockImageRepo.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException if FK constraint fails (errno 1452)', async () => {
      const qbSlugMock = {
        withDeleted: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getExists: jest.fn().mockResolvedValue(false),
      } as unknown as SelectQueryBuilder<Hotel>;

      hotelsRepository.createQueryBuilder.mockReturnValue(qbSlugMock);

      const fkError = new QueryFailedError('query', [], new Error('FK fail'));
      (fkError as unknown as { driverError: { errno: number } }).driverError = {
        errno: 1452,
      };

      mockRepo.save.mockRejectedValueOnce(fkError);

      const dto: CreateHotelDto = {
        hotelTypeId: 999,
        locationId: 999,
        name: 'Invalid Hotel',
        address: 'Nowhere',
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if duplicate UNIQUE constraint fails (errno 1062)', async () => {
      const qbSlugMock = {
        withDeleted: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getExists: jest.fn().mockResolvedValue(false),
      } as unknown as SelectQueryBuilder<Hotel>;

      hotelsRepository.createQueryBuilder.mockReturnValue(qbSlugMock);

      const dupError = new QueryFailedError(
        'query',
        [],
        new Error('Duplicate'),
      );
      (dupError as unknown as { driverError: { errno: number } }).driverError =
        {
          errno: 1062,
        };

      mockRepo.save.mockRejectedValueOnce(dupError);

      const dto: CreateHotelDto = {
        hotelTypeId: 1,
        locationId: 1,
        name: 'Rex Hotel',
        address: '141 Nguyen Hue',
      };

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return paginated list of hotels', async () => {
      const hotels = [
        { id: '1', name: 'Hotel A', slug: 'hotel-a' },
        { id: '2', name: 'Hotel B', slug: 'hotel-b' },
      ] as Hotel[];

      const qbMock = {
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([hotels, 2]),
      } as unknown as SelectQueryBuilder<Hotel>;

      hotelsRepository.createQueryBuilder.mockReturnValue(qbMock);

      const query: QueryHotelDto = {
        page: 1,
        perPage: 10,
        search: 'Hotel',
        status: HotelStatus.ACTIVE,
        hotelTypeId: 1,
        locationId: 1,
      };

      const result = await service.findAll(query);

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.perPage).toBe(10);
      expect(result.meta.totalPages).toBe(1);
    });
  });

  describe('findOne', () => {
    it('should throw BadRequestException for invalid id format', async () => {
      await expect(service.findOne('invalid-id')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.findOne('0')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if hotel is not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });

    it('should return hotel with images if found', async () => {
      const hotelData = {
        id: '1',
        name: 'Rex Hotel Saigon',
        slug: 'rex-hotel-saigon',
        address: '141 Nguyen Hue',
      } as Hotel;

      mockRepo.findOne.mockResolvedValue(hotelData);
      mockImageRepo.find.mockResolvedValue([
        { id: '101', imageUrl: '/img1.jpg', isPrimary: 1 },
      ]);

      const result = await service.findOne('1');
      expect(result.id).toBe('1');
      expect(result.images).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('should update hotel fields successfully', async () => {
      const existingHotel = {
        id: '1',
        name: 'Rex Hotel Saigon',
        slug: 'rex-hotel-saigon',
        status: HotelStatus.DRAFT,
        address: '141 Nguyen Hue',
      } as Hotel;

      mockRepo.findOne.mockResolvedValue(existingHotel);

      const result = await service.update('1', {
        status: HotelStatus.ACTIVE,
        phone: '02838292186',
      });

      expect(result).toBeDefined();
      expect(result.status).toBe(HotelStatus.ACTIVE);
      expect(result.phone).toBe('02838292186');
    });
  });

  describe('Images Management (max 6 images)', () => {
    it('should throw BadRequestException if hotel has reached 6 images limit', async () => {
      const hotelData = { id: '1', name: 'Rex Hotel' } as Hotel;
      mockRepo.findOne.mockResolvedValue(hotelData);
      mockImageRepo.count.mockResolvedValue(MAX_HOTEL_IMAGES);

      await expect(
        service.addImage('1', { imageUrl: '/img7.jpg' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should add image and update cover if marked as primary', async () => {
      const hotelData = {
        id: '1',
        name: 'Rex Hotel',
        coverImageUrl: null,
      } as Hotel;
      mockRepo.findOne.mockResolvedValue(hotelData);
      mockImageRepo.count.mockResolvedValue(2);

      const result = await service.addImage('1', {
        imageUrl: '/new-cover.jpg',
        isPrimary: true,
      });

      expect(result).toBeDefined();
      expect(result.imageUrl).toBe('/new-cover.jpg');
      expect(mockImageRepo.update).toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('should set primary image successfully', async () => {
      const hotelData = { id: '1', name: 'Rex Hotel' } as Hotel;
      const image = {
        id: '102',
        hotelId: '1',
        imageUrl: '/cover2.jpg',
        isPrimary: 0,
      } as HotelImage;

      mockRepo.findOne.mockResolvedValue(hotelData);
      mockImageRepo.findOne.mockResolvedValue(image);

      const updatedHotel = await service.setPrimaryImage('1', '102');
      expect(updatedHotel.coverImageUrl).toBe('/cover2.jpg');
    });

    it('should delete image and update cover if deleted was primary', async () => {
      const hotelData = {
        id: '1',
        name: 'Rex Hotel',
        coverImageUrl: '/img1.jpg',
      } as Hotel;
      const image = {
        id: '101',
        hotelId: '1',
        imageUrl: '/img1.jpg',
        isPrimary: 1,
      } as HotelImage;
      const nextImage = {
        id: '102',
        hotelId: '1',
        imageUrl: '/img2.jpg',
        isPrimary: 0,
      } as HotelImage;

      mockRepo.findOne.mockResolvedValue(hotelData);
      mockImageRepo.findOne
        .mockResolvedValueOnce(image) // find image to delete
        .mockResolvedValueOnce(nextImage); // find next image

      const result = await service.deleteImage('1', '101');
      expect(result.success).toBe(true);
      expect(mockImageRepo.delete).toHaveBeenCalledWith('101');
    });
  });
});
