import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HotelsService } from './hotels.service';
import { Hotel } from './entities/hotel.entity';
import { HotelImage } from './entities/hotel-image.entity';

describe('HotelsService', () => {
  let service: HotelsService;
  let mockHotelRepo: any;
  let mockImageRepo: any;

  beforeEach(async () => {
    mockHotelRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest
        .fn()
        .mockImplementation((dto) => Promise.resolve({ id: '1', ...dto })),
      findOne: jest
        .fn()
        .mockResolvedValue({ id: '1', name: 'Caravelle Hotel' }),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(),
    };

    mockImageRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((dto) => Promise.resolve(dto)),
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HotelsService,
        {
          provide: getRepositoryToken(Hotel),
          useValue: mockHotelRepo,
        },
        {
          provide: getRepositoryToken(HotelImage),
          useValue: mockImageRepo,
        },
      ],
    }).compile();

    service = module.get<HotelsService>(HotelsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should find a hotel by id', async () => {
    const hotel = await service.findOne('1');
    expect(hotel).toBeDefined();
    expect(hotel.name).toBe('Caravelle Hotel');
  });
});
