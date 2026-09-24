import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { RateLimiterGuard } from './rate-limiter.guard';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { RATE_LIMIT_METADATA } from './rate-limit.decorator';

describe('RateLimiterGuard', () => {
  let guard: RateLimiterGuard;
  let reflector: jest.Mocked<Reflector>;
  let mockRedis: {
    eval: jest.Mock;
  };

  const createMockContext = (options: {
    ip?: string;
    headers?: Record<string, string>;
    user?: any;
  }): ExecutionContext => {
    const responseHeaders: Record<string, any> = {};
    const mockRequest = {
      ip: options.ip || '127.0.0.1',
      headers: options.headers || {},
      user: options.user,
      socket: { remoteAddress: '127.0.0.1' },
    };
    const mockResponse = {
      setHeader: jest.fn((name: string, value: any) => {
        responseHeaders[name] = value;
      }),
      getHeader: jest.fn((name: string) => responseHeaders[name]),
    };

    return {
      getHandler: jest.fn().mockReturnValue({ name: 'testHandler' }),
      getClass: jest.fn().mockReturnValue({ name: 'TestController' }),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as any;

    mockRedis = {
      eval: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimiterGuard,
        { provide: Reflector, useValue: reflector },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    guard = module.get<RateLimiterGuard>(RateLimiterGuard);
  });

  it('should pass if no RateLimit metadata is present', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = createMockContext({});

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  describe('Tier 1: IP Sliding Window Log', () => {
    it('should allow request when within IP rate limit', async () => {
      reflector.getAllAndOverride.mockReturnValue({
        slidingWindow: { limit: 10, windowMs: 60000 },
      });
      // Redis eval returns [allowed: 1, currentCount: 3]
      mockRedis.eval.mockResolvedValue([1, 3]);

      const context = createMockContext({ ip: '192.168.1.100' });
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      const res = context.switchToHttp().getResponse();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-IP-Limit', 10);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-IP-Remaining', 7);
    });

    it('should throw HTTP 429 when IP rate limit is exceeded', async () => {
      reflector.getAllAndOverride.mockReturnValue({
        slidingWindow: { limit: 10, windowMs: 60000 },
      });
      // Redis eval returns [allowed: 0, currentCount: 10]
      mockRedis.eval.mockResolvedValue([0, 10]);

      const context = createMockContext({ ip: '192.168.1.100' });

      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
      const res = context.switchToHttp().getResponse();
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 60);
    });
  });

  describe('Tier 2: User Token Bucket', () => {
    it('should allow request when user has tokens', async () => {
      reflector.getAllAndOverride.mockReturnValue({
        tokenBucket: { capacity: 10, refillRate: 1 },
      });
      // Redis eval returns [allowed: 1, remaining: 9]
      mockRedis.eval.mockResolvedValue([1, 9]);

      const context = createMockContext({ user: { id: 101 } });
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      const res = context.switchToHttp().getResponse();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 9);
    });

    it('should throw HTTP 429 when user runs out of tokens', async () => {
      reflector.getAllAndOverride.mockReturnValue({
        tokenBucket: { capacity: 5, refillRate: 0.2 },
      });
      // Redis eval returns [allowed: 0, remaining: 0]
      mockRedis.eval.mockResolvedValue([0, 0]);

      const context = createMockContext({ user: { id: 101 } });

      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
      const res = context.switchToHttp().getResponse();
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 5); // ceil(1 / 0.2) = 5
    });
  });

  describe('Fail-Open Mechanism', () => {
    it('should fail-open and allow request if Redis encounters connection error', async () => {
      reflector.getAllAndOverride.mockReturnValue({
        slidingWindow: { limit: 10, windowMs: 60000 },
      });
      mockRedis.eval.mockRejectedValue(
        new Error('ECONNREFUSED: Redis is down'),
      );

      const context = createMockContext({ ip: '192.168.1.100' });
      const result = await guard.canActivate(context);

      // Should not throw, should return true to protect user experience
      expect(result).toBe(true);
    });
  });
});
