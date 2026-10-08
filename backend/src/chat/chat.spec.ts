import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { Room } from '../rooms/entities/room.entity';

describe('ChatController & ChatService', () => {
  let controller: ChatController;
  let service: ChatService;

  const mockRoomsRepository = {
    createQueryBuilder: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'OLLAMA_URL') return 'http://localhost:11434';
      if (key === 'OLLAMA_MODEL') return 'qwen3:4b';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        ChatService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: getRepositoryToken(Room),
          useValue: mockRoomsRepository,
        },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
    service = module.get<ChatService>(ChatService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  it('should call chatService.chat with message', async () => {
    const expected = {
      success: true,
      userMessage: 'Xin chào',
      filters: {
        intent: 'general' as const,
        location: null,
        starRating: null,
        minPrice: null,
        maxPrice: null,
        adults: null,
        children: null,
        checkIn: null,
        checkOut: null,
      },
      reply: 'Tôi có thể hỗ trợ bạn tìm khách sạn và phòng phù hợp.',
      results: [],
    };

    jest.spyOn(service, 'chat').mockResolvedValue(expected);

    const result = await controller.chat({ message: 'Xin chào' });
    expect(result).toEqual(expected);
    expect(service.chat).toHaveBeenCalledWith('Xin chào');
  });
});
