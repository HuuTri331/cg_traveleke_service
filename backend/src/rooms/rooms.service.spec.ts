import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository, SelectQueryBuilder } from 'typeorm';

import { HotelsService } from '../hotels/hotels.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { QueryRoomDto } from './dto/query-room.dto';
import { RoomImage } from './entities/room-image.entity';
import { Room, RoomStatus } from './entities/room.entity';
import { MAX_ROOM_IMAGES, RoomsService } from './rooms.service';

describe('RoomsService', () => {
  let service: RoomsService;
  let roomsRepository: jest.Mocked<Repository<Room>>;
  let mockRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
    softDelete: jest.Mock;
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
  let mockHotelsService: {
    findOne: jest.Mock;
  };

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn().mockImplementation((dto: Partial<Room>) => dto),
      save: jest.fn().mockImplementation((entity: Room) =>
        Promise.resolve({
          ...entity,
          id: entity.id ?? '1',
        }),
      ),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
      softDelete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
    };

    mockImageRepo = {
      create: jest.fn().mockImplementation((dto: Partial<RoomImage>) => dto),
      save: jest.fn().mockImplementation((entity: RoomImage) =>
        Promise.resolve({
          ...entity,
          id: entity.id ?? '201',
        }),
      ),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    mockHotelsService = {
      findOne: jest.fn().mockResolvedValue({
        id: '1',
        name: 'Rex Hotel',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsService,
        {
          provide: getRepositoryToken(Room),
          useValue: mockRepo,
        },
        {
          provide: getRepositoryToken(RoomImage),
          useValue: mockImageRepo,
        },
        {
          provide: HotelsService,
          useValue: mockHotelsService,
        },
      ],
    }).compile();

    service = module.get<RoomsService>(RoomsService);
    roomsRepository = module.get(getRepositoryToken(Room));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully create room after verifying hotel exists', async () => {
      const qbSlugMock = {
        withDeleted: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getExists: jest.fn().mockResolvedValue(false),
      } as unknown as SelectQueryBuilder<Room>;

      roomsRepository.createQueryBuilder.mockReturnValue(qbSlugMock);

      const dto: CreateRoomDto = {
        hotelId: 1,
        name: 'Deluxe King',
        pricePerNight: 1200000,
        maxAdults: 2,
        maxChildren: 1,
        totalRooms: 5,
        bedCount: 1,
        coverImageUrl: '/uploads/rooms/king.jpg',
      };

      const result = await service.create(dto);

      expect(mockHotelsService.findOne).toHaveBeenCalledWith('1');
      expect(result).toBeDefined();
      expect(result.name).toBe('Deluxe King');
      expect(result.slug).toBe('deluxe-king');
      expect(result.status).toBe(RoomStatus.AVAILABLE);
      expect(result.totalRooms).toBe(5);
      expect(result.availableRooms).toBe(5);
      expect(mockImageRepo.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException if availableRooms > totalRooms', async () => {
      const qbSlugMock = {
        withDeleted: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getExists: jest.fn().mockResolvedValue(false),
      } as unknown as SelectQueryBuilder<Room>;

      roomsRepository.createQueryBuilder.mockReturnValue(qbSlugMock);

      const dto: CreateRoomDto = {
        hotelId: 1,
        name: 'Deluxe King',
        pricePerNight: 1200000,
        totalRooms: 3,
        availableRooms: 5,
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if hotel FK constraint fails (errno 1452)', async () => {
      const qbSlugMock = {
        withDeleted: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getExists: jest.fn().mockResolvedValue(false),
      } as unknown as SelectQueryBuilder<Room>;

      roomsRepository.createQueryBuilder.mockReturnValue(qbSlugMock);

      const fkError = new QueryFailedError('query', [], new Error('FK fail'));
      (fkError as unknown as { driverError: { errno: number } }).driverError = {
        errno: 1452,
      };

      mockRepo.save.mockRejectedValueOnce(fkError);

      const dto: CreateRoomDto = {
        hotelId: 999,
        name: 'Deluxe King',
        pricePerNight: 1000000,
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if duplicate slug in same hotel (errno 1062)', async () => {
      const qbSlugMock = {
        withDeleted: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getExists: jest.fn().mockResolvedValue(false),
      } as unknown as SelectQueryBuilder<Room>;

      roomsRepository.createQueryBuilder.mockReturnValue(qbSlugMock);

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

      const dto: CreateRoomDto = {
        hotelId: 1,
        name: 'Deluxe King',
        pricePerNight: 1000000,
      };

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return paginated rooms with filters', async () => {
      const rooms = [
        { id: '1', name: 'Deluxe King', hotelId: '1' },
        { id: '2', name: 'Deluxe Twin', hotelId: '1' },
      ] as Room[];

      const qbMock = {
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([rooms, 2]),
      } as unknown as SelectQueryBuilder<Room>;

      roomsRepository.createQueryBuilder.mockReturnValue(qbMock);

      const query: QueryRoomDto = {
        hotelId: 1,
        search: 'Deluxe',
        minPrice: 500000,
        maxPrice: 2000000,
        adults: 2,
        page: 1,
        perPage: 10,
      };

      const result = await service.findAll(query);

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.perPage).toBe(10);
    });
  });

  describe('findOne', () => {
    it('should throw BadRequestException for invalid room id format', async () => {
      await expect(service.findOne('abc')).rejects.toThrow(BadRequestException);
      await expect(service.findOne('0')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if room does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });

    it('should return room with images if found', async () => {
      const room = {
        id: '1',
        name: 'Deluxe King',
        hotelId: '1',
      } as Room;

      mockRepo.findOne.mockResolvedValue(room);
      mockImageRepo.find.mockResolvedValue([
        { id: '201', imageUrl: '/room1.jpg', isPrimary: 1 },
      ]);

      const result = await service.findOne('1');
      expect(result.id).toBe('1');
      expect(result.images).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('should update room fields successfully', async () => {
      const existingRoom = {
        id: '1',
        hotelId: '1',
        name: 'Deluxe King',
        totalRooms: 5,
        availableRooms: 5,
      } as Room;

      mockRepo.findOne.mockResolvedValue(existingRoom);

      const result = await service.update('1', {
        pricePerNight: 1500000,
        availableRooms: 4,
      });

      expect(result).toBeDefined();
      expect(result.pricePerNight).toBe('1500000');
      expect(result.availableRooms).toBe(4);
    });
  });

  describe('remove', () => {
    it('should soft delete room successfully', async () => {
      const existingRoom = {
        id: '1',
        name: 'Deluxe King',
      } as Room;

      mockRepo.findOne.mockResolvedValue(existingRoom);

      const result = await service.remove('1');
      expect(result.success).toBe(true);
      expect(mockRepo.softDelete).toHaveBeenCalledWith('1');
    });
  });

  describe('Images Management (max 5 images)', () => {
    it('should throw BadRequestException if room has reached 5 images limit', async () => {
      const roomData = { id: '1', name: 'Deluxe King' } as Room;
      mockRepo.findOne.mockResolvedValue(roomData);
      mockImageRepo.count.mockResolvedValue(MAX_ROOM_IMAGES);

      await expect(
        service.addImage('1', { imageUrl: '/img6.jpg' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should add image and update cover if primary', async () => {
      const roomData = {
        id: '1',
        name: 'Deluxe King',
        coverImageUrl: null,
      } as Room;
      mockRepo.findOne.mockResolvedValue(roomData);
      mockImageRepo.count.mockResolvedValue(2);

      const result = await service.addImage('1', {
        imageUrl: '/new-room-cover.jpg',
        isPrimary: true,
      });

      expect(result).toBeDefined();
      expect(result.imageUrl).toBe('/new-room-cover.jpg');
      expect(mockImageRepo.update).toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('should set primary image for room successfully', async () => {
      const roomData = { id: '1', name: 'Deluxe King' } as Room;
      const image = {
        id: '202',
        roomId: '1',
        imageUrl: '/cover2.jpg',
        isPrimary: 0,
      } as RoomImage;

      mockRepo.findOne.mockResolvedValue(roomData);
      mockImageRepo.findOne.mockResolvedValue(image);

      const updatedRoom = await service.setPrimaryImage('1', '202');
      expect(updatedRoom.coverImageUrl).toBe('/cover2.jpg');
    });

    it('should delete image and update room cover if deleted was primary', async () => {
      const roomData = {
        id: '1',
        name: 'Deluxe King',
        coverImageUrl: '/rimg1.jpg',
      } as Room;
      const image = {
        id: '201',
        roomId: '1',
        imageUrl: '/rimg1.jpg',
        isPrimary: 1,
      } as RoomImage;
      const nextImage = {
        id: '202',
        roomId: '1',
        imageUrl: '/rimg2.jpg',
        isPrimary: 0,
      } as RoomImage;

      mockRepo.findOne.mockResolvedValue(roomData);
      mockImageRepo.findOne
        .mockResolvedValueOnce(image)
        .mockResolvedValueOnce(nextImage);

      const result = await service.deleteImage('1', '201');
      expect(result.success).toBe(true);
      expect(mockImageRepo.delete).toHaveBeenCalledWith('201');
    });
  });
});
