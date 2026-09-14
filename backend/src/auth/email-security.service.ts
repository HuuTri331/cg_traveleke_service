import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as dns from 'dns';

// Danh sách các từ tục tĩu, thô tục hoặc phá hoại phổ biến
const VULGAR_PATTERNS = [
  'duma',
  'ditme',
  'duanloz',
  'duanlon',
  'duconme',
  'dume',
  'du_me',
  'vailon',
  'vcl',
  'clgt',
  'concac',
  'con_cac',
  'buoi',
  'cac',
  'loz',
  'lon',
  'cailon',
  'chode',
  'cho_de',
  'dmm',
  'dcm',
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'pussy',
  'dick',
  'cunt',
];

// Danh sách các tên miền email ảo / rác (disposable emails)
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  '10minutemail.com',
  'tempmail.com',
  'guerrillamail.com',
  'throwawaymail.com',
  'yopmail.com',
  'sharklasers.com',
  'trashmail.com',
  'dispostable.com',
  'getairmail.com',
  'fakemailgenerator.com',
]);

interface LockoutRecord {
  violationCount: number;
  lockedUntil: number; // timestamp ms
  lastViolationAt: number;
}

@Injectable()
export class EmailSecurityService {
  private readonly logger = new Logger(EmailSecurityService.name);

  // Lưu trữ lịch sử vi phạm theo IP/Client: IP -> LockoutRecord
  private readonly lockoutMap = new Map<string, LockoutRecord>();

  /**
   * Chuẩn hóa chuỗi (bỏ dấu tiếng Việt, ký tự đặc biệt) để phát hiện từ ngữ thô tục
   */
  private normalizeString(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Kiểm tra xem IP hiện tại có đang bị khóa hay không.
   * Nếu đang khóa, ném ra HttpException với mã 429 và thông tin đếm ngược.
   */
  checkLockout(clientIp: string): void {
    const record = this.lockoutMap.get(clientIp);
    if (!record) return;

    const now = Date.now();
    if (now < record.lockedUntil) {
      const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
      const tier = record.violationCount >= 2 ? 2 : 1;
      const message =
        tier === 2
          ? 'Bạn cố tình nhập gmail không đúng và có ý định phá hoại nên bạn hãy đăng nhập lại sau 10 giờ nữa!'
          : 'Gmail của bạn đăng ký không có thực! Vui lòng đăng ký lại sau 10 phút nữa!';

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message,
          locked: true,
          tier,
          lockedUntil: record.lockedUntil,
          remainingSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Ghi nhận 1 lần vi phạm khi người dùng cố tình nhập email ảo/thô tục:
   * - Vi phạm lần 1: Khóa 10 phút.
   * - Vi phạm lần 2 trở đi: Khóa 10 giờ.
   */
  recordViolation(clientIp: string): { tier: number; lockedUntil: number; message: string } {
    const now = Date.now();
    const existing = this.lockoutMap.get(clientIp);

    let count = 1;
    if (existing) {
      count = existing.violationCount + 1;
    }

    const tier = count >= 2 ? 2 : 1;
    // Cấp 1 = 10 phút (600,000ms), Cấp 2 = 10 giờ (36,000,000ms)
    const durationMs = tier === 2 ? 10 * 60 * 60 * 1000 : 10 * 60 * 1000;
    const lockedUntil = now + durationMs;

    this.lockoutMap.set(clientIp, {
      violationCount: count,
      lockedUntil,
      lastViolationAt: now,
    });

    const message =
      tier === 2
        ? 'Bạn cố tình nhập gmail không đúng và có ý định phá hoại nên bạn hãy đăng nhập lại sau 10 giờ nữa!'
        : 'Gmail của bạn đăng ký không có thực! Vui lòng đăng ký lại sau 10 phút nữa!';

    this.logger.warn(
      `IP ${clientIp} vi phạm lần ${count} (Cấp độ ${tier}). Đã khóa đến ${new Date(lockedUntil).toISOString()}`,
    );

    return { tier, lockedUntil, message };
  }

  /**
   * Kiểm tra tính hợp lệ toàn diện của email:
   * 1. Lọc từ ngữ thô tục / phá hoại
   * 2. Chặn tên miền email rác / disposable
   * 3. Quy chuẩn Gmail (độ dài, ký tự hợp lệ)
   * 4. Kiểm tra DNS MX record thực tế của tên miền
   */
  async validateEmail(email: string, clientIp: string): Promise<boolean> {
    // 1. Kiểm tra trạng thái khóa trước
    this.checkLockout(clientIp);

    const trimmed = (email || '').trim().toLowerCase();
    const atIndex = trimmed.indexOf('@');

    if (atIndex === -1 || atIndex === 0 || atIndex === trimmed.length - 1) {
      const violation = this.recordViolation(clientIp);
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: violation.message,
          locked: true,
          tier: violation.tier,
          lockedUntil: violation.lockedUntil,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const username = trimmed.slice(0, atIndex);
    const domain = trimmed.slice(atIndex + 1);

    // 2. Kiểm tra từ ngữ thô tục trong username hoặc toàn bộ email
    const normalizedUsername = this.normalizeString(username);
    const normalizedEmail = this.normalizeString(trimmed);

    for (const pattern of VULGAR_PATTERNS) {
      if (
        normalizedUsername.includes(pattern) ||
        normalizedEmail.includes(pattern)
      ) {
        this.logger.warn(`Phát hiện từ ngữ thô tục trong email: ${trimmed} (từ: ${pattern})`);
        const violation = this.recordViolation(clientIp);
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: violation.message,
            locked: true,
            tier: violation.tier,
            lockedUntil: violation.lockedUntil,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // 3. Chặn các nhà cung cấp email ảo / rác
    if (DISPOSABLE_DOMAINS.has(domain)) {
      this.logger.warn(`Email sử dụng tên miền rác/ảo: ${trimmed}`);
      const violation = this.recordViolation(clientIp);
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: violation.message,
          locked: true,
          tier: violation.tier,
          lockedUntil: violation.lockedUntil,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 4. Quy chuẩn đặc thù cho Gmail
    if (domain === 'gmail.com' || domain === 'googlemail.com') {
      // Gmail username phải từ 6 đến 30 ký tự
      const rawUser = username.replace(/\./g, '');
      if (rawUser.length < 6 || rawUser.length > 30) {
        this.logger.warn(`Gmail không hợp lệ về độ dài (6-30 ký tự): ${trimmed}`);
        const violation = this.recordViolation(clientIp);
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: violation.message,
            locked: true,
            tier: violation.tier,
            lockedUntil: violation.lockedUntil,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Gmail chỉ cho phép chữ cái a-z, số 0-9 và dấu chấm .
      if (!/^[a-z0-9.]+$/.test(username)) {
        this.logger.warn(`Gmail chứa ký tự cấm: ${trimmed}`);
        const violation = this.recordViolation(clientIp);
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: violation.message,
            locked: true,
            tier: violation.tier,
            lockedUntil: violation.lockedUntil,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Không cho phép dấu chấm ở đầu, cuối hoặc 2 dấu chấm liên tiếp
      if (username.startsWith('.') || username.endsWith('.') || username.includes('..')) {
        this.logger.warn(`Gmail chứa dấu chấm không hợp lệ: ${trimmed}`);
        const violation = this.recordViolation(clientIp);
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: violation.message,
            locked: true,
            tier: violation.tier,
            lockedUntil: violation.lockedUntil,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // 5. Kiểm tra DNS MX record thực tế của tên miền
    try {
      const mxRecords = await dns.promises.resolveMx(domain);
      if (!mxRecords || mxRecords.length === 0) {
        this.logger.warn(`Tên miền ${domain} không có bản ghi MX (không thể nhận mail).`);
        const violation = this.recordViolation(clientIp);
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: violation.message,
            locked: true,
            tier: violation.tier,
            lockedUntil: violation.lockedUntil,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    } catch (dnsErr: any) {
      this.logger.warn(`Lỗi DNS MX lookup cho tên miền ${domain}: ${dnsErr?.message}`);
      const violation = this.recordViolation(clientIp);
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: violation.message,
          locked: true,
          tier: violation.tier,
          lockedUntil: violation.lockedUntil,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return true;
  }
}
