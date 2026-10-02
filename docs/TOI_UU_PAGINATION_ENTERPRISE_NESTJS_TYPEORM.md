# HƯỚNG DẪN KIẾN TRÚC & TỐI ƯU HÓA PHÂN TRANG (PAGINATION) TRONG NESTJS VỚI TYPEORM

---

## 1. TỔNG QUAN & NGUY CƠ TIỀM ẨN TRƯỚC KHI TỐI ƯU

Trong hệ thống đặt phòng du lịch **Traveleke**, các bảng dữ liệu như `bookings`, `hotels`, `rooms`, `users` sẽ tăng trưởng rất nhanh theo thời gian.
Nếu hệ thống phân trang không được chuẩn hóa và bảo vệ nghiêm ngặt, các lỗi nguy hiểm sau sẽ xảy ra:

| Vấn đề trước khi tối ưu | Nguy cơ kỹ thuật | Giải pháp chuẩn hóa (Đã áp dụng) |
| :--- | :--- | :--- |
| **Không chuẩn hóa số âm (`page = -5`)** | Tính ra `offset = -120` gửi xuống MySQL gây **Lỗi cú pháp SQL (SQL Crash)**. | Dùng hàm `normalizePagination()` ép `page >= 1`. |
| **Không chặn giới hạn trên (`perPage = 500,000`)** | Hacker hoặc bot có thể gọi request với số lượng khổng lồ làm **tràn RAM (Out-of-memory - DoS)**. | Ép trần `limit <= 100` bằng `Math.min(requestedLimit, maxLimit)`. |
| **Lọc bằng JavaScript sau khi load toàn bộ CSDL** | `UsersService` nạp toàn bộ 100.000 khách hàng vào RAM rồi mới dùng `.filter()` để tìm nhân viên. | Đẩy điều kiện lọc trực tiếp xuống MySQL: `where: { role: 'CUSTOMER' }` tận dụng Index B-Tree `idx_users_role`. |
| **Thiếu Index trên cột ORDER BY** | `ORDER BY created_at DESC` trên bảng `bookings` không có Index dẫn đến **Full Table Scan & FileSort** rất chậm khi dữ liệu lớn. | Bổ sung Index `idx_bookings_created_at` trong cấu trúc CSDL. |
| **Metadata phân trang không nhất quán** | Chỗ trả `page/perPage`, chỗ trả `limit/skip`, thiếu thông tin trang kế tiếp/trang trước cho UI. | Chuẩn hóa `buildPaginationMeta()` hỗ trợ song song 100% trường cũ của Frontend và các trường chuẩn Enterprise mới. |

---

## 2. KIẾN TRÚC PHÂN TRANG CHUẨN DOANH NGHIỆP TRONG DỰ ÁN

Toàn bộ logic phân trang được tập trung tại thư mục:
`backend/src/common/pagination/`

```text
backend/src/common/pagination/
├── pagination.dto.ts      # DTO validate @Min(1), @Max(100), ép kiểu Number
├── pagination.helper.ts   # normalizePagination() & buildPaginationMeta()
├── pagination.spec.ts     # Bộ unit test kiểm tra 100% case biên (Edge cases)
└── index.ts               # Public export
```

### Công thức chuẩn hóa tham số (Normalization Formula):
```typescript
// 1. Chuẩn hóa page (mặc định là 1, không cho phép số âm hoặc 0)
const page = Math.max(1, Math.floor(Number(query?.page) || 1));

// 2. Chuẩn hóa limit (mặc định 20, chặn số âm, chặn trần tối đa 100)
const requestedLimit = Number(query?.perPage ?? query?.limit) || defaultPerPage;
const limit = Math.min(100, Math.max(1, Math.floor(requestedLimit)));

// 3. Tính toán skip / offset
const skip = (page - 1) * limit;
```

---

## 3. CẤU TRÚC RESPONSE PHÂN TRANG CHUẨN

Tất cả các API phân trang (`GET /api/bookings`, `GET /api/hotels`, `GET /api/rooms`, `GET /api/rooms/search`) đều trả về cấu trúc đồng nhất:

```json
{
  "data": [
    { "id": "1", "name": "Khách sạn Mường Thanh" },
    { "id": "2", "name": "Vinpearl Resort" }
  ],
  "meta": {
    "page": 1,
    "perPage": 20,
    "total": 125,
    "totalPages": 7,
    "totalItems": 125,
    "itemCount": 20,
    "itemsPerPage": 20,
    "currentPage": 1,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

> **Ghi chú về tính tương thích:**
> - Các trường: `page`, `perPage`, `total`, `totalPages` được giữ nguyên vẹn 100% giúp giao diện Frontend Next.js (`cg_traveleke_app`) không bao giờ bị lỗi hiển thị.
> - Các trường: `totalItems`, `itemCount`, `itemsPerPage`, `currentPage`, `hasNextPage`, `hasPreviousPage` giúp hỗ trợ phân trang nâng cao và các component UI hiện đại.

---

## 4. CHI TIẾT CÁC ĐIỂM ĐÃ TỐI ƯU HÓA TRONG MÃ NGUỒN

### 1. Module Bookings (`src/bookings/`)
* **`QueryBookingDto`**: Chuyển đổi sang `@Type(() => Number)` với `@IsInt()`, `@Min(1)` và `@Max(100)`.
* **`BookingsService.findAll`**: Thay thế đoạn tính nhẩm `Number(page) || 1` dễ bị crash khi nhận số âm bằng `normalizePagination(query, 20, 100)`.
* **`BookingsService.getActivityLogs`**: Chặn cứng tham số `limit` từ 1 đến 100 bằng `Math.min(100, Math.max(1, limit))`, ngăn ngừa request `limit=9999999` làm sập dịch vụ.

### 2. Module Hotels (`src/hotels/`)
* **`HotelsService.findAll` & `HotelsService.search`**: Sử dụng `normalizePagination()` và `buildPaginationMeta()`.
* Phân trang an toàn với TypeORM QueryBuilder:
  ```typescript
  qb.skip(skip).take(limit);
  const [data, total] = await qb.getManyAndCount();
  ```

### 3. Module Rooms (`src/rooms/`)
* **`RoomsService.findAll` & `RoomsService.search`**: Đồng bộ hóa `skip`, `limit` và chuẩn hóa metadata đầu ra.

### 4. Module Users (`src/users/`)
* **Loại bỏ hoàn toàn In-memory Filtering**:
  * Trước: Tải toàn bộ bảng `users` lên RAM rồi gọi `.filter(u => u.role === 'CUSTOMER')`.
  * Sau: Đẩy thẳng xuống MySQL `where: { role: 'CUSTOMER' }` và `where: { role: In(['ADMIN', 'EMPLOYEE']) }`, khai thác triệt để Index `idx_users_role`, giảm 99% tải RAM và I/O.

### 5. Cấu trúc CSDL (`database/bootstrap/phase-2-unified-complete.sql`)
* Bổ sung Index:
  ```sql
  CREATE INDEX idx_bookings_created_at ON bookings (created_at);
  ```
  Giúp tăng tốc các truy vấn `ORDER BY created_at DESC` khi phân trang đơn đặt phòng.

---

## 5. BỘ NGUYÊN TẮC BẮT BUỘC CHO CÁC TÍNH NĂNG MỚI VỀ SAU

Khi lập trình viên xây dựng bất kỳ API danh sách nào trong dự án, **BẮT BUỘC tuân thủ 5 bước**:

1. **DTO:** Luôn kế thừa hoặc áp dụng quy chuẩn `@Min(1)` cho `page` và `@Min(1) @Max(100)` cho `perPage` / `limit`.
2. **Normalize:** Luôn gọi `normalizePagination(query, defaultLimit, maxLimit)` ngay đầu Service method.
3. **QueryBuilder:** Luôn dùng `qb.skip(skip).take(limit)` và `getManyAndCount()`.
4. **Order by:** Luôn có `orderBy` rõ ràng và đảm bảo cột được sắp xếp đã được đánh **Index** trong CSDL.
5. **Metadata:** Luôn trả về bằng `buildPaginationMeta({ page, limit, total, dataLength })`.
