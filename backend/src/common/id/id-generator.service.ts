import { Injectable } from '@nestjs/common';
import { v7 as uuidv7, validate as uuidValidate } from 'uuid';

@Injectable()
export class IdGeneratorService {
  /**
   * Sinh mã UUID v7 (RFC 9562) - kết hợp 48-bit Unix timestamp và entropy ngẫu nhiên.
   * Ưu điểm:
   * - Time-ordered: Sắp xếp theo thứ tự thời gian tự nhiên, thân thiện với B-Tree index.
   * - Chuẩn hóa cho distributed tracing (requestId, correlationId), idempotency key, audit logs.
   */
  generateUuidV7(): string {
    return uuidv7();
  }

  /**
   * Kiểm tra chuỗi có phải là định dạng UUID hợp lệ hay không.
   */
  isValidUuid(id: unknown): boolean {
    return typeof id === 'string' && uuidValidate(id);
  }

  /**
   * Sinh mã nghiệp vụ (Business Code) thân thiện cho Khách hàng, Lễ tân và Quản lý khách sạn.
   *
   * Theo đúng nguyên tắc "IDENTITY KHÔNG PHẢI BUSINESS CODE":
   * - Technical ID (Database PK): Dùng BIGINT UNSIGNED AUTO_INCREMENT để quan hệ khóa ngoại nhanh, nhẹ.
   * - Business Code: Dùng mã dễ đọc, dễ đối soát qua điện thoại hoặc tại quầy lễ tân:
   *   Định dạng: BK-YYYYMMDD-XXXX (ví dụ: BK-20260924-A8F2)
   *
   * Ưu điểm vượt trội so với raw timestamp (BK1727...):
   * - Lễ tân đọc và đối soát nhanh gọn: "BK - 20260924 - A8F2".
   * - Không lo xung đột millisecond (36^4 = 1.67 triệu mã/ngày/khách sạn).
   * - Vừa vặn cột VARCHAR(30) trong database (chỉ dài 16 ký tự).
   */
  generateBookingCode(prefix = 'BK', date: Date = new Date()): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;

    // 4 ký tự entropy ngẫu nhiên gồm chữ in hoa và chữ số (bỏ các ký tự dễ nhầm lẫn như I, O nếu muốn, hoặc dùng base36)
    const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let entropy = '';
    for (let i = 0; i < 4; i++) {
      const randomIndex = Math.floor(Math.random() * chars.length);
      entropy += chars[randomIndex];
    }

    return `${prefix}-${dateStr}-${entropy}`;
  }
}
