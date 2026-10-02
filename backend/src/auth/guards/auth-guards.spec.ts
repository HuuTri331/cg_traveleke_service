import { ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';

describe('Auth Guards (Bearer Authentication & Role Authorization)', () => {
  describe('JwtAuthGuard (Authentication Scheme: Bearer)', () => {
    let guard: JwtAuthGuard;
    let mockResponse: { setHeader: jest.Mock };
    let mockContext: ExecutionContext;

    beforeEach(() => {
      guard = new JwtAuthGuard();
      mockResponse = { setHeader: jest.fn() };
      mockContext = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
          getRequest: () => ({}),
        }),
      } as unknown as ExecutionContext;
    });

    it('should return user when authentication succeeds', () => {
      const mockUser = { id: 1, email: 'admin@traveleke.com', role: 'ADMIN' };
      const result = guard.handleRequest(null, mockUser, null, mockContext);

      expect(result).toEqual(mockUser);
      expect(mockResponse.setHeader).not.toHaveBeenCalled();
    });

    it('should throw 401 and set WWW-Authenticate header when token is missing', () => {
      expect(() => {
        guard.handleRequest(null, null, null, mockContext);
      }).toThrow(UnauthorizedException);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
    });

    it('should throw 401 with expired message and RFC 6750 header when token expired', () => {
      const expiredError = new Error('jwt expired');
      expiredError.name = 'TokenExpiredError';

      expect(() => {
        guard.handleRequest(null, null, expiredError, mockContext);
      }).toThrow(UnauthorizedException);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining('error="invalid_token"'),
      );
    });

    it('should throw 401 with invalid signature message when token corrupted', () => {
      const invalidError = new Error('invalid signature');
      invalidError.name = 'JsonWebTokenError';

      expect(() => {
        guard.handleRequest(null, null, invalidError, mockContext);
      }).toThrow(UnauthorizedException);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining('Invalid token signature'),
      );
    });
  });

  describe('RolesGuard (Authorization Layer)', () => {
    let rolesGuard: RolesGuard;
    let reflector: Reflector;

    beforeEach(() => {
      reflector = new Reflector();
      rolesGuard = new RolesGuard(reflector);
    });

    it('should allow access if route has no @Roles restriction', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      const mockContext = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({ user: null }),
        }),
      } as unknown as ExecutionContext;

      expect(rolesGuard.canActivate(mockContext)).toBe(true);
    });

    it('should throw 401 Unauthorized (not 403) when user is unauthenticated', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);

      const mockContext = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({ user: null }),
        }),
      } as unknown as ExecutionContext;

      expect(() => rolesGuard.canActivate(mockContext)).toThrow(UnauthorizedException);
    });

    it('should throw 403 Forbidden when authenticated user has insufficient role', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);

      const mockContext = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 2, role: 'CUSTOMER' } }),
        }),
      } as unknown as ExecutionContext;

      expect(() => rolesGuard.canActivate(mockContext)).toThrow(ForbiddenException);
    });

    it('should allow access when user role matches requirement', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN', 'EMPLOYEE']);

      const mockContext = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 3, role: 'EMPLOYEE' } }),
        }),
      } as unknown as ExecutionContext;

      expect(rolesGuard.canActivate(mockContext)).toBe(true);
    });
  });
});
