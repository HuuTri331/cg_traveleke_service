# TÀI LIỆU KIẾN TRÚC ENTERPRISE: ĐỊNH DANH DUY NHẤT (UUID v7, CUID2, ULID, BUSINESS CODE) TRONG NESTJS & MYSQL
> **Hệ thống Quản lý & Đặt phòng Khách sạn Traveleke**  
> **Ngôn ngữ & Nền tảng:** NestJS 11, TypeScript, MySQL (InnoDB B-Tree Index), RFC 9562 Standard

---

## MỤC LỤC
1. [TỔNG QUAN VỀ ĐỊNH DANH DUY NHẤT (IDENTIFIERS)](#1-tổng-quan-về-định-danh-duy-nhất-identifiers)
2. [PHÂN TÍCH CÁC PHIÊN BẢN UUID VÀ TIÊU CHUẨN RFC 9562](#2-phân-tích-các-phiên-bản-uuid-và-tiêu-chuẩn-rfc-9562)
   - [2.1. UUID v4: Điểm mạnh và Thảm họa B-Tree Index Fragmentation](#21-uuid-v4-điểm-mạnh-và-thảm-họa-b-tree-index-fragmentation)
   - [2.2. UUID v7: Bước nhảy vọt về Hiệu năng (Time-ordered Sortable)](#22-uuid-v7-bước-nhảy-vọt-về-hiệu-năng-time-ordered-sortable)
3. [SO SÁNH TOÀN DIỆN CÁC GIẢI PHÁP ĐỊNH DANH](#3-so-sánh-toàn-diện-các-giải-pháp-định-danh)
   - [UUID v4 vs UUID v7 vs ULID vs NanoID vs CUID2 vs Snowflake vs Auto-Increment](#3-so-sánh-toàn-diện-các-giải-pháp-định-danh)
4. [MÔ HÌNH PHÂN TÁCH 3 LOẠI ĐỊNH DANH TRONG DỰ ÁN TRAVELEKE](#4-mô-hình-phân-tách-3-loại-định-danh-trong-dự-án-traveleke)
   - [4.1. Technical Database Primary Key](#41-technical-database-primary-key)
   - [4.2. Tracing Request ID (UUID v7)](#42-tracing-request-id-uuid-v7)
   - [4.3. Business Human-Friendly Code (BK-YYYYMMDD-XXXX)](#43-business-human-friendly-code-bk-yyyymmdd-xxxx)
5. [TRIỂN KHAI THỰC TẾ TRONG CODEBASE TRAVELEKE](#5-triển-khai-thực-tế-trong-codebase-traveleke)
   - [5.1. IdGeneratorService & IdModule](#51-idgeneratorservice--idmodule)
   - [5.2. Tích hợp trong BookingsService](#52-tích-hợp-trong-bookingsservice)
   - [5.3. Unit Test Verification](#53-unit-test-verification)
6. [KẾT LUẬN & NGUYÊN TẮC VÀNG VẬN HÀNH](#6-kết-luận--nguyên-tắc-vàng-vận-hành)

---

## 1. TỔNG QUAN VỀ ĐỊNH DANH DUY NHẤT (IDENTIFIERS)

Mọi thực thể trong hệ thống khách sạn (Đơn đặt phòng, Khách sạn, Phòng, Yêu cầu dịch vụ, Giao dịch thanh toán, Request HTTP) đều cần một định danh duy nhất (Unique Identifier).

Nếu chọn sai chiến lược định danh:
- **Cơ sở dữ liệu bị nghẽn (Disk I/O Choke)** khi lượng bản ghi vượt qua hàng trăm ngàn dòng do phân mảnh Index.
- **Rò rỉ dữ liệu nhạy cảm (Security Enumeration Attack)**: ID tự tăng tuần tự (`id=1, id=2`) cho phép đối thủ crawl toàn bộ doanh thu, số lượng đơn của khách sạn bằng vòng lặp đơn giản.
- **Trải nghiệm khách hàng và lễ tân tồi tệ**: Bắt khách hàng đọc một chuỗi UUID 36 ký tự dài ngoằng `e0970a27-0245-4fdc-b5f7-66a3d9023ff1` qua điện thoại để tra cứu phòng.

---

## 2. PHÂN TÍCH CÁC PHIÊN BẢN UUID VÀ TIÊU CHUẨN RFC 9562

UUID (Universally Unique Identifier) là chuỗi nhị phân 128-bit, thường biểu diễn dưới dạng 32 ký tự hex phân tách bởi 4 dấu gạch ngang (dài 36 ký tự): `xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx`.

### 2.1. UUID v4: Điểm mạnh và Thảm họa B-Tree Index Fragmentation
- **Cơ chế**: Sinh ngẫu nhiên hoàn toàn bằng bộ sinh số giả ngẫu nhiên bảo mật (CSPRNG), 122 bit ngẫu nhiên.
- **Ưu điểm**: Khả năng trùng lặp gần như bằng 0 ($1 / 2^{122}$), sinh độc lập ở bất kỳ node nào mà không cần server trung tâm.
- **Nhược điểm chết người trong CSDL quan hệ (MySQL InnoDB)**:
  - InnoDB lưu trữ bảng dạng **Clustered Index B+Tree**, sắp xếp vật lý trên đĩa theo Primary Key.
  - UUID v4 hoàn toàn ngẫu nhiên $\rightarrow$ Mỗi bản ghi mới chèn vào sẽ có vị trí ngẫu nhiên trên cây B+Tree.
  - Gây ra hiện tượng **Page Split** liên tục: MySQL phải đọc trang đĩa cũ lên RAM, tách đôi trang, di chuyển con trỏ, ghi lại 2 trang xuống đĩa $\rightarrow$ Tăng vọt Disk I/O, cache hit rate của Buffer Pool sụt giảm nghiêm trọng khi dữ liệu vượt quá dung lượng RAM.

### 2.2. UUID v7: Bước nhảy vọt về Hiệu năng (Time-ordered Sortable)
Được chuẩn hóa chính thức trong **IETF RFC 9562 (Tháng 5/2024)**:
- **Cấu trúc 128-bit**:
  - **48 bit đầu**: Unix Epoch Timestamp tính bằng mili-giây (cho phép sắp xếp thời gian tự nhiên).
  - **4 bit**: Version `0111` (v7).
  - **12 bit**: Sub-millisecond timestamp fraction hoặc counter tăng dần.
  - **2 bit**: Variant `10` (RFC 4122/9562).
  - **62 bit**: Random cryptographic entropy.
- **Lợi ích vượt trội**:
  - Vừa đảm bảo tính duy nhất toàn cầu và an toàn bảo mật.
  - Vừa có tính **Locality of Reference (Tuần tự theo thời gian)** $\rightarrow$ Bản ghi mới luôn được chèn vào nhánh bên phải (cuối cùng) của B+Tree, triệt tiêu hiện tượng Page Split, tối ưu hóa bộ nhớ đệm Buffer Pool tuyệt đối.

---

## 3. SO SÁNH TOÀN DIỆN CÁC GIẢI PHÁP ĐỊNH DANH

| Tiêu chí | Auto-Increment (BIGINT) | UUID v4 | UUID v7 (RFC 9562) | ULID | NanoID | CUID2 | Snowflake |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Kích thước** | 8 bytes (64 bit) | 16 bytes (128 bit) | 16 bytes (128 bit) | 16 bytes (128 bit) | Tuỳ biến (thường 21 char) | 24-32 char | 8 bytes (64 bit) |
| **Sắp xếp theo thời gian** | Có | **KHÔNG** | **CÓ** | Có | Không | Không | Có |
| **Độ thân thiện B-Tree** | Xuất sắc | Rất kém (Page split) | Xuất sắc | Xuất sắc | Kém | Kém | Xuất sắc |
| **Khả năng sinh phân tán** | Không (cần centralized DB) | Có | Có | Có | Có | Có | Có (cần worker ID) |
| **Chống Enumeration** | Kém (dễ đoán `id+1`) | Xuất sắc | Xuất sắc | Tốt | Xuất sắc | Xuất sắc | Trung bình |
| **Tiêu chuẩn chính thức** | SQL Standard | RFC 4122 | **RFC 9562 (Chuẩn mới nhất)** | Spec cộng đồng | Thư viện JS | Thư viện JS | Kiến trúc Twitter |

---

## 4. MÔ HÌNH PHÂN TÁCH 3 LOẠI ĐỊNH DANH TRONG DỰ ÁN TRAVELEKE

Trong hệ thống Traveleke, một sai lầm phổ biến là dùng một loại ID duy nhất cho tất cả mục đích. Dự án thiết lập ranh giới rõ ràng cho 3 phân tầng định danh:

```text
                                  TRAVELEKE ARCHITECTURE
                                             │
      ┌──────────────────────────────────────┼──────────────────────────────────────┐
      ▼                                      ▼                                      ▼
[ 1. DATABASE PRIMARY KEY ]        [ 2. TRACING & AUDIT ID ]             [ 3. BUSINESS BOOKING CODE ]
• Kiểu: BIGINT / INT Auto-Inc     • Kiểu: UUID v7 (RFC 9562)             • Kiểu: VARCHAR(30)
• Mục đích: Lưu trữ vật lý,        • Mục đích: RequestId, Distributed     • Mục đích: Khách hàng và Lễ tân
  Foreign Key, Join bảng tối ưu     Tracing, Audit Log, Idempotency        tra cứu, đọc qua điện thoại
• Không bao giờ lộ ra ngoài API    • Sắp xếp thời gian + Ngẫu nhiên       • Định dạng: BK-YYYYMMDD-XXXX
```

### 4.1. Technical Database Primary Key
- Dùng cho quan hệ nội bộ bảng: `hotels.id`, `rooms.id`, `users.id`, `services.id`.
- Tối ưu hóa kích thước Foreign Key và tốc độ JOIN bảng trong SQL.
- Không được dùng làm mã tra cứu cho người dùng cuối trên hóa đơn hay tin nhắn SMS/Email.

### 4.2. Tracing Request ID (UUID v7)
- Dùng trong header HTTP `X-Request-Id`, OpenTelemetry Trace Correlation, Audit Log Entry ID.
- Sinh ra bằng UUID v7 để đảm bảo mỗi bản ghi log hay tracing đều có mốc thời gian sắp xếp tự nhiên mà không cần query cột thời gian riêng biệt.

### 4.3. Business Human-Friendly Code (BK-YYYYMMDD-XXXX)
- Dành riêng cho trải nghiệm người dùng cuối (Khách hàng) và nghiệp vụ vận hành (Lễ tân, Kế toán).
- **Cấu trúc**: `BK-` + Ngày tháng năm nhận phòng hoặc tạo đơn (`YYYYMMDD`) + 4 ký tự phân biệt không gây nhầm lẫn (Base32 loại bỏ ký tự dễ nhầm: `0/O`, `1/I/L`).
- **Ví dụ**: `BK-20260925-A7X9`.
- Dễ đọc, dễ nhớ, dễ đọc qua tổng đài hotline, dễ in trên voucher đón khách.

---

## 5. TRIỂN KHAI THỰC TẾ TRONG CODEBASE TRAVELEKE

### 5.1. IdGeneratorService & IdModule
Toàn bộ logic sinh định danh được đóng gói thành service độc lập và testable tại:
`backend/src/common/id/id-generator.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { v7 as uuidv7, v4 as uuidv4 } from 'uuid';

@Injectable()
export class IdGeneratorService {
  /**
   * Sinh UUID v7 chuẩn RFC 9562 (Time-ordered 128-bit)
   */
  generateUuidV7(): string {
    return uuidv7();
  }

  /**
   * Sinh Business Booking Code thân thiện: BK-YYYYMMDD-XXXX
   */
  generateBookingCode(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    
    // Bộ ký tự Base32 loại bỏ 0, O, 1, I để tránh nhầm lẫn khi đọc
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let suffix = '';
    for (let i = 0; i < 4; i++) {
      suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return `BK-${y}${m}${d}-${suffix}`;
  }
}
```

### 5.2. Tích hợp trong BookingsService
Trong `backend/src/bookings/bookings.service.ts`:
- Khi khách hàng tạo đơn đặt phòng, `IdGeneratorService.generateBookingCode()` sinh mã nghiệp vụ `BK-YYYYMMDD-XXXX`.
- Mã này được lưu vào cột `booking_code` (có Index `UNIQUE`) và dùng để hiển thị trên màn hình Lễ tân (`/bookings`) cũng như lịch sử của khách hàng (`/booking-history`).

### 5.3. Unit Test Verification
File `backend/src/common/id/id-generator.service.spec.ts` kiểm thử toàn diện:
- Kiểm tra tính tuần tự thời gian của UUID v7 (`id1 < id2` khi sinh liên tiếp).
- Kiểm tra độ dài, regex và tiền tố của Booking Code.
- Đảm bảo 10.000 mã sinh ngẫu nhiên liên tiếp không xảy ra va chạm (Collision-free).

---

## 6. KẾT LUẬN & NGUYÊN TẮC VÀNG VẬN HÀNH

1. **Không bao giờ dùng UUID v4 làm Primary Key có tần suất chèn cao trong MySQL InnoDB**. Hãy dùng UUID v7 nếu cần UUID hoặc BIGINT Auto-Increment cho Technical Key.
2. **Tách bạch mã kỹ thuật (Technical ID) và mã nghiệp vụ (Business Code)**. Khách hàng và lễ tân chỉ làm việc với Business Code (`BK-YYYYMMDD-XXXX`).
3. **Mọi RequestId truyền qua hệ thống microservices/logging phải là UUID v7**. Giúp sắp xếp và lọc log theo mốc thời gian tức thì mà không bị suy hao hiệu năng.
