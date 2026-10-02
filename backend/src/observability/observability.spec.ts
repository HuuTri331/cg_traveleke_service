import { trace } from '@opentelemetry/api';
import { logWithTrace, ObservabilityLoggerService } from './trace-logger';
import { logger } from './logger';
import { LoggingInterceptor } from './logging.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';

describe('Observability Module', () => {
  let loggerSpy: jest.SpyInstance;

  beforeEach(() => {
    loggerSpy = jest.spyOn(logger, 'log').mockImplementation(() => logger);
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  describe('logWithTrace', () => {
    it('should log with message and metadata', () => {
      logWithTrace('info', 'Test user created', { userId: 123 });

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          message: 'Test user created',
          userId: 123,
        }),
      );
    });

    it('should attach trace_id and span_id when active span exists', () => {
      const mockSpanContext = {
        traceId: 'test-trace-id-abc123',
        spanId: 'test-span-id-xyz789',
        traceFlags: 1,
      };

      const getActiveSpanSpy = jest
        .spyOn(trace, 'getActiveSpan')
        .mockReturnValue({
          spanContext: () => mockSpanContext,
        } as any);

      logWithTrace('info', 'Database query executed');

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          trace_id: 'test-trace-id-abc123',
          span_id: 'test-span-id-xyz789',
        }),
      );

      getActiveSpanSpy.mockRestore();
    });
  });

  describe('ObservabilityLoggerService', () => {
    it('should implement NestJS LoggerService methods', () => {
      const service = new ObservabilityLoggerService();

      service.log('Application started successfully');
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          message: 'Application started successfully',
        }),
      );

      service.warn('High memory usage');
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          message: 'High memory usage',
        }),
      );

      service.error('Database connection failed');
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: 'Database connection failed',
        }),
      );
    });
  });

  describe('LoggingInterceptor', () => {
    it('should measure execution time and log completed HTTP request', (done) => {
      const interceptor = new LoggingInterceptor();

      const mockRequest = {
        method: 'GET',
        originalUrl: '/api/hotels',
        headers: { 'x-forwarded-for': '203.0.113.195' },
        user: { id: 45 },
      };

      const mockResponse = {
        statusCode: 200,
      };

      const mockContext = {
        getType: () => 'http',
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const mockHandler: CallHandler = {
        handle: () => of({ success: true, data: [] }),
      };

      interceptor.intercept(mockContext, mockHandler).subscribe({
        next: (result) => {
          expect(result).toEqual({ success: true, data: [] });
          expect(loggerSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              level: 'info',
              message: expect.stringContaining('GET /api/hotels 200'),
              http: expect.objectContaining({
                method: 'GET',
                url: '/api/hotels',
                status_code: 200,
              }),
              ip: '203.0.113.195',
              user_id: 45,
            }),
          );
          done();
        },
      });
    });
  });
});
