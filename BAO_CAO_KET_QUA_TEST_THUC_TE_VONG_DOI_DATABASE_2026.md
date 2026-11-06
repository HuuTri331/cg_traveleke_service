# BÁO CÁO KẾT QUẢ KIỂM THỬ THỰC TẾ TOÀN BỘ VÒNG ĐỜI NGHIỆP VỤ & BẢO MẬT TRÊN CƠ SỞ DỮ LIỆU THẬT (LIVE MYSQL 8.4 E2E LIFECYCLE AUDIT — 2026)

- **Dự án**: Hệ thống Đặt phòng & Vận hành Khách sạn Traveleke (`cg_traveleke_service` & `cg_traveleke_app`)
- **Ngày thực hiện**: `06/11/2026`
- **Môi trường kiểm thử thực tế**:
  - **Cơ sở dữ liệu tạm thời**: MySQL 8.4 độc lập (`traveleke_tmp_audit_mysql` tại cổng `127.0.0.1:33316`, `utf8mb4_unicode_ci`, `STRICT_TRANS_TABLES`), hoàn toàn tách biệt với MySQL chính tại cổng `3306`.
  - **Schema nạp thực tế**: `database/migration_unified_complete.sql` + 3 bản vá migration (`20261102-coverage-executor.cjs`, `20261106-operations-46-fixes.cjs`, `20261107-online-extensions-v1.cjs`) — xác nhận khởi tạo đủ **114 bảng dữ liệu**.
  - **Bộ kiểm thử thực thi**:
    1. **28 Unit/Service Test Suites sẵn có (`210/210 tests`)**: Đạt `PASS 100%` (`9.7s`).
    2. **Bộ E2E 6 Đợt sẵn có (`test/six-phases.e2e-spec.ts`)**: `3/4 PASS`, **`1/4 FAIL`** (phát hiện lỗi lệch trạng thái `hotels.status` mặc định `'DRAFT'` trong DB thật).
    3. **Bộ Kiểm thử Vòng đời Toàn diện 8 Giai đoạn & 3 Trụ cột Bảo mật (`AppModule` + `ValidationPipe` + `TypeORM` + `MySQL 8.4`)**: Thực thi xuyên suốt từ Khởi tạo Khách sạn -> Đặt phòng -> Thanh toán VNPay -> Phân công Lễ tân 40/120p -> Pre-check-in -> Phân bổ Phòng vật lý -> Check-in -> Phục vụ trong kỳ lưu trú / Sự cố / Gia hạn giờ -> Sổ cái Folio / Bút toán điều chỉnh -> Kiểm toán đêm (Night Audit) -> Xuất biên lai -> Check-out -> Đánh giá sao nhân viên -> Đăng xuất.
- **Trạng thái Dọn dẹp (Clean-up Status)**: **ĐÃ XÓA SẠCH 100%** container database tạm thời (`docker rm -f -v traveleke_tmp_audit_mysql`) và toàn bộ file test tạm thời. Database gốc (`hotel_booking_db` trên cổng `3306`) và mã nguồn dự án được giữ nguyên trạng 100%.

---

## PHẦN 1: TỔNG HỢP KẾT QUẢ CHẠY THỰC TẾ TRÊN DATABASE TẠM (EXECUTIVE SUMMARY)

Khi chạy thực tế toàn bộ vòng đời ứng dụng trên **MySQL 8.4 thật** (thay vì dùng Mock Repository trong bộ nhớ RAM), hệ thống bộc lộ rõ **những luồng chạy tốt** và **16 lỗi thực tế (6 lỗi đứt gãy vòng đời/crash 500/lệch schema trên DB thật + 10 lỗ hổng phân quyền/trạng thái xác nhận trực tiếp qua HTTP Response & MySQL State)**:

| Phân loại Kết quả Kiểm thử Thực tế | Số lượng | Chi tiết |
| :--- | :---: | :--- |
| **1. Unit/Service Spec Suites hiện có** | **28 / 28 PASS** | 210 test cases chạy qua mock vượt qua 100%. |
| **2. Luồng Vòng đời Nghiệp vụ chạy THÀNH CÔNG trên DB thật** | **8 luồng cốt lõi PASS** | Phân công lễ tân VIP (40/120p + dispatch lock), Pre-check-in (tạo mã -> nộp -> duyệt), Check-in (`CONFIRMED -> CHECKED_IN`), Tạo & Khóa sổ Kiểm toán đêm (`Night Audit Preview & Close`), Xuất chứng từ (`DOC-...-REC-V1`), Check-out (`CHECKED_IN -> COMPLETED`). |
| **3. Lỗi Đứt gãy Vòng đời / Crash 500 / Lệch Schema mới phát hiện khi chạy DB thật** | **6 lỗi (`BUG-DB-01` .. `BUG-LIFECYCLE-06`)** | Những lỗi **chỉ xuất hiện khi chạy với MySQL thật** (do giá trị `DEFAULT` của cột MySQL hoặc ép kiểu `String(undefined)` khi thiếu DTO validation). |
| **4. Lỗ hổng Bảo mật (AuthMatrix / Schemathesis / StackHawk) xác nhận thực tế trên DB thật** | **10 kịch bản (`CRITICAL`, `HIGH`, `MEDIUM`)** | Xác nhận thực nghiệm bằng request HTTP thật: `CUSTOMER` tự xóa nợ Folio `500,000 VND -> 0 VND`, `Customer 2` đọc trộm Folio & Phòng vật lý của `Customer 1`, `EMPLOYEE` khách sạn khác khóa tài khoản khách hàng toàn cục, v.v. |

---

## PHẦN 2: BẢNG KẾT QUẢ KIỂM THỬ TỪNG GIAI ĐOẠN TRONG VÒNG ĐỜI (STAGE-BY-STAGE LIVE TEST MATRIX)

| Giai đoạn Vòng đời | Mã Kiểm thử | Endpoint / Service Thực thi | Kỳ vọng (Expected) | Kết quả Thực tế trên MySQL 8.4 (Actual Output) | Kết luận |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Stage 0: Migration & Schema** | `BUG-DB-01` | `scripts/migrate-operations.cjs` + `migration_unified_complete.sql` | Chạy migration theo biến môi trường `DB_DATABASE` bất kỳ | File SQL gắn cứng `CREATE DATABASE hotel_booking_db; USE hotel_booking_db;` ở dòng 24–28, ghi đè mọi cấu hình `DB_DATABASE` khác | **LỖI SCRIPT MIGRATION** |
| **Stage 0: E2E 6 Đợt sẵn có** | `BUG-E2E-02` | `test/six-phases.e2e-spec.ts` (Test #4 `Pricing & Promotions`) | `PASS` toàn bộ 4 test E2E | **FAIL** tại `promotions.service.ts:82`: `ForbiddenException: Khách sạn #... hiện không ở trạng thái hoạt động (ACTIVE)` vì `hotels.status` mặc định là `'DRAFT'` trong MySQL | **LỖI LỆCH DEFAULT DB** |
| **Stage 1: Auth & Users RBAC** | `HIGH-02A` | `GET /api/users/customers` (bởi `EMPLOYEE` Khách sạn B) | `403 Forbidden` hoặc chỉ trả về khách của Khách sạn B | **HTTP 200 OK** — Trả về toàn bộ danh sách khách hàng trên toàn hệ thống | **LỖI BẢO MẬT (HIGH)** |
| **Stage 1: Auth & Users RBAC** | `HIGH-02B` | `PATCH /api/users/customers/:id/status` (`BLOCKED` bởi `EMPLOYEE` Khách sạn B) | `403 Forbidden` (Chỉ `ADMIN` mới được khóa tài khoản cấp hệ thống) | **HTTP 200 OK** — Lễ tân Khách sạn B khóa thành công tài khoản khách hàng không liên quan | **LỖI BẢO MẬT (HIGH)** |
| **Stage 1: Multi-Hotel Isolation** | `MEDIUM-01` | `GET /api/staff-skills/user/:userId` (bởi `EMPLOYEE` Khách sạn B đọc hồ sơ nhân viên Khách sạn A) | `403 Forbidden` (Khác khách sạn) | **HTTP 200 OK** — Trả về hồ sơ kỹ năng, ngoại ngữ và `user.email` của nhân viên Khách sạn A | **LỖI BẢO MẬT (MEDIUM)** |
| **Stage 2: Property Settings** | `MEDIUM-02` | `PATCH` & `GET /api/hotels/:hotelId/property-settings` | `PATCH` lưu xuống bảng `hotel_business_settings` (`cutoffTime=03:00:00`) và chặn `CUSTOMER` gọi `GET` (`403`) | `PATCH` trả về `03:00:00` (chỉ lưu RAM), ngay sau đó `CUSTOMER` gọi `GET` nhận **HTTP 200 OK** với giá trị DB cũ `cutoffTime=04:00:00` | **LỖI NGHIỆP VỤ & RBAC** |
| **Stage 2: DTO ValidationPipe** | `HIGH-05` | `POST /api/booking-price-quotes/:id/voucher` với `{ code: { nested: true } }` | `400 Bad Request` bởi Global `ValidationPipe` | **HTTP 500 Internal Server Error** — `TypeError: (params.code || "").trim is not a function` tại `voucher.service.ts:28` | **LỖI CRASH 500 & BYPASS PIPE** |
| **Stage 3 & 4: Booking & Auto-Assign** | `LC-04-ASSIGN` | `BookingAssignmentService.assignOnce(bookingId)` | Tự động gán lễ tân đạt chuẩn VIP (`staffA1`) | `success: true, staffUserId: staffA1.id` (Chạy chính xác khóa điều phối & 40/120p fairness) | **PASS HOÀN HẢO** |
| **Stage 5: Pre-check-in Online** | `MEDIUM-06` | `POST /api/bookings/:id/precheckin/invite` -> `submit` -> `review` -> `submit` lần 2 | Không lộ `tokenHash`; Chặn `submit` lại sau khi đã `REVIEWED` | **HTTP 201 Created** — Lộ `tokenHash` trong response; Nộp lại lần 2 bằng `opaqueToken` cũ ghi đè trạng thái từ `REVIEWED` lùi về `SUBMITTED` | **LỖI TRẠNG THÁI & LỘ HASH** |
| **Stage 5: Tạo & Phân bổ Phòng vật lý** | `BUG-LIFECYCLE-03` | `POST /api/hotels/:hotelId/room-units` -> `POST /api/bookings/:id/room-unit-allocations` | Tạo phòng `101` xong phải phân bổ được cho booking (`201 Created`) | **HTTP 409 Conflict** — `Phòng vật lý #101 sai khách sạn hoặc chưa xác minh` vì cột `verification_status` mặc định là `'UNVERIFIED'` và không có API nào để verify! | **LỖI ĐỨT GÃY VÒNG ĐỜI (HIGH)** |
| **Stage 5: Xem Phân bổ Phòng vật lý** | `HIGH-01` | `GET /api/bookings/:id/room-unit-allocations` (bởi `Customer 2` không phải chủ booking) | `403 Forbidden` (Chặn khách hàng khác xem phòng của `Customer 1`) | **HTTP 200 OK** — `Customer 2` đọc được toàn bộ bản ghi phân bổ phòng vật lý của `Customer 1` (`[{"id":"2","status":"ASSIGNED"}]`) | **LỖI BOLA / IDOR (HIGH)** |
| **Stage 5: Xác nhận Check-in** | `LC-05-CHECKIN` | `POST /api/booking-presence/:bookingId/check-in` | Chuyển trạng thái `CONFIRMED -> CHECKED_IN` | **HTTP 200 OK** — `booking.status = CHECKED_IN` | **PASS HOÀN HẢO** |
| **Stage 6: Gia hạn Giờ Lưu trú** | `BUG-RUNTIME-04` & `MEDIUM-05` | `POST /api/bookings/:id/stay-time-requests` | Truyền `"17:00"` trả về `400`; `CUSTOMER` không được tự duyệt `isComplimentary: true` (`0 VND`) | Truyền `"17:00"` -> **HTTP 500 (`RangeError: Invalid time value`)**; Truyền ISO + `isComplimentary: true` bởi `CUSTOMER` -> **HTTP 201 (`status: APPROVED, feeVnd: 0`)** và không lưu DB | **LỖI CRASH 500 & LOGIC** |
| **Stage 6: Sự cố Phòng & Bồi thường** | `BUG-RUNTIME-05` & `HIGH-03` | `POST /api/room-incidents` & `POST /api/room-incidents/:id/propose-option` | Thiếu `roomTypeId` trả về `400`; Giả mạo `approvedByManagerId: '999999999'` bị chặn `403` | Thiếu `roomTypeId` -> **HTTP 500 (`MySQL 1366 Incorrect integer value 'undefined'`)**; Truyền `approvedByManagerId='999999999'` -> **HTTP 201 (`compensationVnd=500000`)** | **LỖI CRASH 500 & BFLA (HIGH)** |
| **Stage 7: Sổ cái Tài chính (Folio)** | `CRITICAL-02` | `GET /api/bookings/:id/folio` (bởi `Customer 2` không phải chủ booking) | `403 Forbidden` | **HTTP 200 OK** — `Customer 2` đọc được toàn bộ sổ cái `folioId=4`, các khoản thu và chứng từ thanh toán của `Customer 1` | **LỖI BOLA NGHIÊM TRỌNG (CRITICAL)** |
| **Stage 7: Điều chỉnh Công nợ Folio** | `CRITICAL-01` | `POST /api/folios/:id/adjustments` (`CREDIT 500,000 VND` bởi chính `Customer 1`) | `403 Forbidden` (`CUSTOMER` tuyệt đối không được tự tạo bút toán xóa nợ Folio) | **HTTP 201 Created** — `Customer 1` tự tạo bút toán `CREDIT 500,000 VND` với `approvedByManagerId='999999999'`, xóa dư nợ từ **`500,000.00 VND` về `0.00 VND`** | **LỖI TÀI CHÍNH NGHIÊM TRỌNG (CRITICAL)** |
| **Stage 7: Kiểm toán Đêm (Night Audit)** | `LC-07-NIGHT-AUDIT` | `POST /api/hotels/:id/night-audit/preview` & `/close` | Preview & Khóa sổ thành công (`status: CLOSED`) | **HTTP 201 Created** — `status = CLOSED` | **PASS HOÀN HẢO** |
| **Stage 7 & 8: Xuất Chứng từ & Check-out** | `LC-07-CHECKOUT` | `POST /api/bookings/:id/documents/issue` & `POST /api/booking-presence/:id/check-out` | Xuất biên lai `RECEIPT` & chuyển `CHECKED_IN -> COMPLETED` | **Doc HTTP 201 (`DOC-...-REC-V1`)**, **Check-out HTTP 200 (`status: COMPLETED`)** (vượt qua cổng kiểm tra nợ vì `Customer 1` đã tự xóa nợ ở bước trên!) | **PASS LUỒNG (NHƯNG BỊ BYPASS CỔNG NỢ)** |
| **Stage 8: Đánh giá Nhân viên sau Check-out** | `BUG-LIFECYCLE-06` | `GET /api/staff-reviews/booking/:id/eligible` -> `POST /api/staff-reviews` | Khách hàng đánh giá được lễ tân `staffA1` sau khi `COMPLETED` | **HTTP 400 Bad Request** — Nếu booking hoàn tất qua `booking-presence` mà không phát sinh `guest_work_tasks` ở trạng thái `COMPLETED`, lễ tân chính không được tính là eligible | **LỖI ĐIỀU KIỆN NGHIỆP VỤ** |
| **Stage 8: Thu hồi Phiên Đăng xuất** | `HIGH-06` | `POST /api/auth/logout` -> `GET /api/auth/me` (dùng lại Access Token vừa đăng xuất) | `401 Unauthorized` | **HTTP 200 OK** — Access Token cũ vẫn truy cập bình thường sau khi đã gọi `logout` | **LỖI QUẢN LÝ PHIÊN (HIGH)** |

---

## PHẦN 3: PHÂN TÍCH CHI TIẾT 6 LỖI ĐỨT GÃY VÒNG ĐỜI & CRASH 500 PHÁT HIỆN TRỰC TIẾP TRÊN DATABASE THẬT

Đây là 6 lỗi kỹ thuật chỉ bộc lộ rõ ràng khi kết nối ứng dụng vào **MySQL 8.4 thật** và chạy luồng End-to-End (do các Unit Test dùng Mock trong RAM đã che khuất các ràng buộc cột MySQL và giá trị `DEFAULT`):

### 1. `[BUG-LIFECYCLE-03]` (Mức độ: HIGH — Đứt gãy hoàn toàn luồng Tạo Phòng vật lý -> Phân bổ Phòng)
- **Ở đâu**:
  - `backend/src/room-units/room-units.service.ts:91-106` (`createRoomUnit`)
  - `backend/src/room-units/room-allocation.service.ts:286-288` (`allocate`)
  - `backend/scripts/migrations/20261107-online-extensions-v1.cjs:23` (`verification_status DEFAULT 'UNVERIFIED'`)
- **Lỗi cái gì & Lỗi như thế nào**:
  - Trong cơ sở dữ liệu MySQL thật, cột `verification_status` của bảng `room_units` có giá trị mặc định là `'UNVERIFIED'`.
  - Khi Quản lý khách sạn (`MANAGER`) tạo mới phòng vật lý qua `POST /api/hotels/:hotelId/room-units` (ví dụ phòng `101`), hàm `RoomUnitsService.createRoomUnit()` không truyền `verificationStatus: 'VERIFIED'`, khiến MySQL lưu bản ghi với `verification_status = 'UNVERIFIED'`.
  - Toàn bộ codebase **không có bất kỳ API hay hàm Service nào** cho phép cập nhật `verificationStatus` sang `'VERIFIED'` (`PATCH /api/room-units/:unitId/state` chỉ cho sửa `operationalStatus`, `housekeepingState`, `notes`).
  - Kết quả: Khi Lễ tân gọi `POST /api/bookings/:id/room-unit-allocations` để gán phòng `101` cho khách, dòng 286 của `room-allocation.service.ts`:
    ```ts
    if (String(unit.hotelId) !== String(booking.hotelId) || unit.verificationStatus === 'UNVERIFIED') {
      throw new ConflictException(`Phòng vật lý #${unit.roomNumber} sai khách sạn hoặc chưa xác minh.`);
    }
    ```
    **luôn luôn ném lỗi `HTTP 409 Conflict: Phòng vật lý #101 sai khách sạn hoặc chưa xác minh.`**, làm tắc nghẽn 100% luồng gán phòng vật lý cho mọi phòng mới tạo!
- **Cách khắc phục**: Trong `RoomUnitsService.createRoomUnit()` (vốn đã bắt buộc người gọi là `MANAGER` hoặc `ADMIN` ở dòng 63), thiết lập `verificationStatus: 'VERIFIED'`, đồng thời bổ sung trường `verificationStatus?: 'VERIFIED' | 'UNVERIFIED'` vào `updateUnitState` cho `MANAGER`/`ADMIN`.

### 2. `[BUG-RUNTIME-04]` (Mức độ: HIGH — Lỗi Crash `HTTP 500 RangeError` & Không lưu DB trên `POST /api/bookings/:id/stay-time-requests`)
- **Ở đâu**:
  - `backend/src/stay-extras/stay-time.service.ts:89-97` (`requestStayTimeExtension`)
  - `backend/src/booking-amendments/booking-amendments.controller.ts:63-79` (`requestStayTime`)
- **Lỗi cái gì & Lỗi như thế nào**:
  - Controller định nghĩa `@Body() body: { requestedTime: string; ... }` bằng kiểu inline nên `ValidationPipe` bị vô hiệu hóa.
  - Khi người dùng gửi `requestedTime: "17:00"` (định dạng giờ `HH:mm`), dòng 93 của `stay-time.service.ts`:
    ```ts
    requestedTime: new Date(input.requestedTime).toISOString(),
    ```
    văng ngoại lệ chưa được bắt **`RangeError: Invalid time value`**, làm sập request với **`HTTP 500 Internal Server Error`**.
  - Nghiêm trọng hơn: Ngay cả khi truyền chuỗi ISO hợp lệ, hàm `requestStayTimeExtension` chỉ kiểm tra xung đột phòng rồi **trả về một object tạm trong RAM (`status: 'APPROVED'`) mà không hề lưu vào bất kỳ bảng nào trong MySQL**, cũng không ghi bút toán `STAY_TIME_FEE` vào sổ cái Folio!

### 3. `[BUG-RUNTIME-05]` (Mức độ: HIGH — Lỗi Crash `HTTP 500 QueryFailedError (errno: 1366)` trên `POST /api/room-incidents`)
- **Ở đâu**:
  - `backend/src/room-incidents/room-incident.controller.ts:12, 27` (`import type { OpenRoomIncidentInput }`)
  - `backend/src/room-incidents/room-incident.service.ts:44-63` (`openIncidentOnce`)
- **Lỗi cái gì & Lỗi như thế nào**:
  - Do `RoomIncidentController` sử dụng `import type { OpenRoomIncidentInput }`, TypeScript xóa metadata khi biên dịch sang JavaScript khiến Global `ValidationPipe` không kiểm tra các trường bắt buộc.
  - Khi request thiếu `roomTypeId`, dòng 48 của `room-incident.service.ts` thực hiện `roomTypeId: String(input.roomTypeId)` biến `undefined` thành chuỗi `'undefined'`, rồi thực thi câu lệnh SQL:
    ```sql
    INSERT INTO `room_incidents`(..., `room_type_id`, ...) VALUES (..., 'undefined', ...)
    ```
    MySQL 8.4 ở chế độ `STRICT_TRANS_TABLES` lập tức ném lỗi **`HTTP 500 Internal Server Error — QueryFailedError: Incorrect integer value: 'undefined' for column 'room_type_id' at row 1 (errno: 1366)`**.

### 4. `[BUG-DB-01]` (Mức độ: MEDIUM — File SQL Hợp nhất gắn cứng `USE hotel_booking_db;` ghi đè biến môi trường `DB_DATABASE`)
- **Ở đâu**:
  - `database/migration_unified_complete.sql:24-28`
  - `backend/scripts/migrate-operations.cjs:40-48`
- **Lỗi cái gì & Lỗi như thế nào**:
  - Mặc dù `migrate-operations.cjs` nhận `process.env.DB_DATABASE` để kết nối vào database đích, nhưng bên trong `migration_unified_complete.sql` dòng 24–28 lại gắn cứng:
    ```sql
    CREATE DATABASE IF NOT EXISTS hotel_booking_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    USE hotel_booking_db;
    ```
  - Khi chạy `migrate-operations.cjs` với một tên database khác (ví dụ môi trường staging/test hoặc tài khoản MySQL chỉ được cấp quyền trên một schema cụ thể), câu lệnh `USE hotel_booking_db;` sẽ ép phiên kết nối chuyển sang `hotel_booking_db` hoặc gây lỗi `ER_DBACCESS_DENIED_ERROR (1044)`.

### 5. `[BUG-E2E-02]` (Mức độ: MEDIUM — Bộ test `test/six-phases.e2e-spec.ts` bị FAIL ở Test #4 do `hotels.status` mặc định `'DRAFT'`)
- **Ở đâu**:
  - `backend/test/six-phases.e2e-spec.ts:105` (`seedHotelAndStaff`)
  - `backend/src/promotions/promotions.service.ts:81-83` (`createCampaign`)
- **Lỗi cái gì & Lỗi như thế nào**:
  - Trong `six-phases.e2e-spec.ts:105`, hàm `seedHotelAndStaff()` chèn dữ liệu vào bảng `hotels` mà không truyền cột `status`. Trong MySQL, cột `hotels.status` có giá trị mặc định là `'DRAFT'`.
  - Khi chạy đến Test #4 (`Pricing & Promotions (B01–B46)`), hàm `PromotionsService.createCampaign` kiểm tra `String(hotelRows[0].status) !== 'ACTIVE'` và ném lỗi `ForbiddenException: Khách sạn #... hiện không ở trạng thái hoạt động (ACTIVE).`, làm Test #4 bị FAIL.

### 6. `[BUG-LIFECYCLE-06]` (Mức độ: MEDIUM — Lễ tân xử lý Check-in/Check-out qua `BookingPresence` không được ghi nhận vào danh sách `eligible` để Khách hàng đánh giá sao)
- **Ở đâu**:
  - `backend/src/staff-kpi/guest-staff-reviews.service.ts` (`getEligibleReviewTargets` / `submitReview`)
  - `backend/src/booking-presence/booking-presence.service.ts` (`confirmArrival` / `confirmDeparture`)
- **Lỗi cái gì & Lỗi như thế nào**:
  - Khi một booking đi trọn vòng đời từ `CONFIRMED -> CHECKED_IN -> COMPLETED` thông qua `POST /api/booking-presence/:id/check-in` và `/check-out` (bởi lễ tân được phân công `staffA1`), nếu trong kỳ lưu trú không phát sinh `guest_work_tasks` ở trạng thái `COMPLETED`, thì khi khách hàng gọi `POST /api/staff-reviews` để chấm 5 sao cho `staffA1` ở giai đoạn `POST_CHECKOUT`, API trả về **`HTTP 400 Bad Request`**.

---

## PHẦN 4: BẰNG CHỨNG THỰC NGHIỆM 10 LỖ HỔNG BẢO MẬT XÁC NHẬN TRỰC TIẾP TRÊN DATABASE THẬT

Toàn bộ các lỗ hổng dưới đây đã được xác minh bằng HTTP Request thực tế đi qua `JwtAuthGuard`, `RolesGuard`, `ValidationPipe`, `TypeORM` và `MySQL 8.4`:

1. **`[CRITICAL-01]` — Khách hàng (`CUSTOMER`) tự xóa nợ Folio `500,000 VND` về `0 VND` rồi Check-out trót lọt**:
   - **Vị trí lỗi**: `backend/src/folio/folio.controller.ts:50-69` & `backend/src/folio/folio.service.ts:246-280`
   - **Diễn biến thực tế trên DB**: Sau khi Lễ tân ghi nợ phụ thu Minibar `500,000.00 VND` (`outstanding_balance_vnd = 500000.00`), tài khoản `Customer 1` (`role: 'CUSTOMER'`) gọi trực tiếp `POST /api/folios/4/adjustments` với `direction: 'CREDIT', amountVnd: 500000, approvedByManagerId: '999999999'`. Server trả về **`HTTP 201 Created`**, cập nhật `outstanding_balance_vnd` trong bảng `folios` từ **`500000.00` về `0.00`**, giúp booking vượt qua cổng chặn công nợ khi gọi `POST /api/booking-presence/:id/check-out` (`HTTP 200 OK`, `status: COMPLETED`).

2. **`[CRITICAL-02]` — Lỗ hổng BOLA / IDOR trên `GET /api/bookings/:id/folio`**:
   - **Vị trí lỗi**: `backend/src/folio/folio.controller.ts:25-28` & `backend/src/folio/folio.service.ts:166-179`
   - **Diễn biến thực tế trên DB**: Tài khoản `Customer 2` (không có bất kỳ liên hệ nào với booking của `Customer 1`) gọi `GET /api/bookings/:booking1Id/folio` và nhận **`HTTP 200 OK`** cùng toàn bộ dữ liệu sổ cái tài chính (`folioId: 4`, các bút toán `entries` và lịch sử thanh toán `settlements`).

3. **`[HIGH-01]` — Lỗ hổng BOLA / IDOR trên `GET /api/bookings/:id/room-unit-allocations`**:
   - **Vị trí lỗi**: `backend/src/room-units/room-units.controller.ts:111-114`
   - **Diễn biến thực tế trên DB**: Ngay khi booking của `Customer 1` vừa được gán phòng vật lý (chưa Check-in), tài khoản `Customer 2` gọi `GET /api/bookings/:booking1Id/room-unit-allocations` và nhận **`HTTP 200 OK`** chứa danh sách phân bổ phòng của `Customer 1`.

4. **`[HIGH-02A & HIGH-02B]` — Lễ tân Khách sạn B (`EMPLOYEE`) xem toàn bộ khách hàng hệ thống & khóa tài khoản khách bất kỳ**:
   - **Vị trí lỗi**: `backend/src/users/users.controller.ts:45-70`
   - **Diễn biến thực tế trên DB**: Tài khoản `staffB1` (Lễ tân Khách sạn B) gọi `GET /api/users/customers` nhận **`HTTP 200 OK`** (toàn bộ khách hàng hệ thống), và gọi tiếp `PATCH /api/users/customers/:victimId/status` (`{ status: 'BLOCKED' }`) nhận **`HTTP 200 OK`**, khóa thành công tài khoản khách hàng không thuộc Khách sạn B.

5. **`[HIGH-03]` — Giả mạo `approvedByManagerId` trên `POST /api/room-incidents/:id/propose-option`**:
   - **Vị trí lỗi**: `backend/src/room-incidents/room-incident.service.ts:94-108`
   - **Diễn biến thực tế trên DB**: Lễ tân `staffA1` truyền `approvedByManagerId: '999999999'` (ID không tồn tại và không phải `MANAGER` trong bảng `hotel_staff`) để đề xuất bồi thường `compensationVnd: 500000`. Server không kiểm tra bảng `hotel_staff` mà trả về **`HTTP 201 Created`** và lưu `manager_user_id = 999999999` vào bảng `room_incidents`.

6. **`[HIGH-05]` — Bỏ qua `ValidationPipe` (`forbidNonWhitelisted`) & Crash `500 TypeError` khi fuzzing kiểu dữ liệu**:
   - **Vị trí lỗi**: `backend/src/vouchers/voucher.controller.ts:13` (cùng 15 controllers dùng inline `@Body()` hoặc `import type`)
   - **Diễn biến thực tế trên DB**: Gửi `{ code: "NON_EXISTENT", unwhitelistedExtraField: "SHOULD_BE_REJECTED_400" }` vào `POST /api/booking-price-quotes/999999/voucher` không bị `ValidationPipe` chặn `400` mà đi thẳng vào tầng Service (`404 Quote không tồn tại`). Khi gửi `{ code: { nestedObjectInsteadOfString: true } }`, server sập với **`HTTP 500 Internal Server Error — TypeError: (params.code || "").trim is not a function`**.

7. **`[HIGH-06]` — Access Token vẫn có hiệu lực (`200 OK`) sau khi đã gọi `POST /api/auth/logout`**:
   - **Vị trí lỗi**: `backend/src/auth/strategies/jwt.strategy.ts:30-42`
   - **Diễn biến thực tế trên DB**: Sau khi gọi `POST /api/auth/logout` (`HTTP 200 OK`), dùng lại chính `access_token` đó gọi `GET /api/auth/me` vẫn nhận **`HTTP 200 OK`** vì `JwtStrategy.validate()` không đối chiếu trạng thái thu hồi của `payload.sessionId`.

8. **`[MEDIUM-01]` — Rò rỉ Hồ sơ Kỹ năng, Ngoại ngữ & Email Nhân viên liên khách sạn**:
   - **Vị trí lỗi**: `backend/src/hotel-staff/staff-skills.controller.ts:68-71`
   - **Diễn biến thực tế trên DB**: Nhân viên Khách sạn B (`staffB1`) gọi `GET /api/staff-skills/user/:staffA1Id` của Khách sạn A và nhận **`HTTP 200 OK`**.

9. **`[MEDIUM-02]` — `PATCH /api/hotels/:hotelId/property-settings` chỉ lưu RAM, không ghi xuống MySQL & `CUSTOMER` đọc được**:
   - **Vị trí lỗi**: `backend/src/property-settings/property-settings.service.ts:51-129` & `property-settings.controller.ts:16-39`
   - **Diễn biến thực tế trên DB**: Quản lý `mgrA` gọi `PATCH /api/hotels/:hotelAId/property-settings` đổi `cutoffTime` thành `'03:00:00'` (`HTTP 200 OK`, trả về `'03:00:00'`). Ngay lập tức gọi `GET /api/hotels/:hotelAId/property-settings` bằng tài khoản `CUSTOMER` nhận **`HTTP 200 OK`** nhưng trả về giá trị cũ trong MySQL là **`cutoffTime: '04:00:00'`**.

10. **`[MEDIUM-05 & MEDIUM-06]` — Khách hàng tự duyệt trả phòng muộn miễn phí (`0 VND`) & Dùng lại `opaqueToken` ghi đè hồ sơ Pre-check-in đã `REVIEWED`**:
    - **Vị trí lỗi**: `backend/src/stay-extras/stay-time.service.ts:62-97` & `backend/src/precheckin/precheckin.service.ts:70, 86-127`
    - **Diễn biến thực tế trên DB**:
      - `Customer 1` gửi `isComplimentary: true` lên `POST /api/bookings/:id/stay-time-requests` và nhận **`HTTP 201 Created` (`status: 'APPROVED', feeVnd: 0`)**.
      - Sau khi Lễ tân đã duyệt hồ sơ Pre-check-in (`POST /api/bookings/:id/precheckin/review` -> `status: 'REVIEWED'`), dùng lại `opaqueToken` cũ gọi `POST /api/precheckin/:opaqueToken/submit` lần 2 vẫn nhận **`HTTP 201 Created`** và ghi đè trạng thái hồ sơ trong MySQL lùi từ `REVIEWED` về lại `SUBMITTED`!

---

## PHẦN 5: BIÊN BẢN XÁC NHẬN DỌN DẸP SẠCH SẼ 100% (CLEAN-UP VERIFICATION)

Ngay sau khi thu thập đầy đủ kết quả thực nghiệm ở trên, toàn bộ tài nguyên phục vụ kiểm thử đã được xóa bỏ hoàn toàn:

1. **Xóa Container & Volume Database Tạm thời**:
   - Đã thực thi `docker rm -f -v traveleke_tmp_audit_mysql`.
   - Kiểm tra `docker ps -a`: Không còn container `traveleke_tmp_audit_mysql`.
2. **Kiểm tra Database MySQL Chính trên máy (`127.0.0.1:3306`)**:
   - Kết quả `SHOW DATABASES` trên cổng `3306`: Chỉ còn đúng `[ 'hotel_booking_db', 'information_schema', 'performance_schema' ]` như ban đầu, không phát sinh bất kỳ database rác hay bảng tạm nào.
3. **Xóa Toàn bộ File Kiểm thử Tạm thời**:
   - Đã xóa `/Users/dangquangminh/cg_traveleke_service/backend/test/tmp-full-lifecycle-audit.e2e-spec.ts` và `/Users/dangquangminh/cg_traveleke_service/backend/test/tmp-audit-results.json`.
   - Thư mục `/Users/dangquangminh/cg_traveleke_service/backend/test/` trở về nguyên trạng ban đầu (`app.e2e-spec.ts`, `jest-e2e.json`, `six-phases.e2e-spec.ts`).


