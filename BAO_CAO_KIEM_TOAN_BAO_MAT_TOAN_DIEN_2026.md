# BÁO CÁO KIỂM TOÁN BẢO MẬT TOÀN DIỆN DỰ ÁN TRAVELEKE (2026)
**Phương pháp đối chiếu:** AuthMatrix (RBAC / BOLA / BFLA / Multi-Hotel Isolation) • Schemathesis (OpenAPI Contract / DTO Schema / State-Machine Fuzzing) • StackHawk / OWASP API Security Top 10 (DAST / Headers / Auth / Rate-Limit / Payment Webhook)

- **Ngày kiểm toán:** 06/11/2026
- **Phạm vi kiểm toán:**
  - **Backend & Database (`/Users/dangquangminh/cg_traveleke_service`)**: Toàn bộ 34 Controllers, 1 WebSocket Gateway (`RealtimeGateway`), 87 TypeORM Entities, 114 bảng MySQL hợp nhất (`migration_unified_complete.sql`), và toàn bộ Services thuộc Core + Waves 1–6 + 32 Online PMS Extensions.
  - **Frontend (`/Users/dangquangminh/cg_traveleke_app`)**: Next.js App Router, cơ chế lưu trữ Token (`AuthContext`, `CustomerAuthContext`), Axios Interceptor (`client.ts`), và Socket.IO Client (`socket.ts`).

---

## 1. TỔNG QUAN KẾT QUẢ KIỂM ĐỊNH (EXECUTIVE SUMMARY)

| Mức độ nghiêm trọng | Số lượng phát hiện | Trụ cột kiểm định chính | Trạng thái |
| :--- | :---: | :--- | :--- |
| **CRITICAL (Nghiêm trọng tối đa)** | **2** | AuthMatrix (BOLA / BFLA / 4-Eyes Bypass trên Sổ cái Folio) | Cần vá ngay trước khi lên Production |
| **HIGH (Rủi ro cao)** | **8** | AuthMatrix (IDOR / Cross-Hotel Leak) + Schemathesis (`ValidationPipe` Bypass) + StackHawk (Auth / DoS) | Cần ưu tiên khắc phục |
| **MEDIUM (Rủi ro trung bình)** | **9** | OWASP API Top 10 (IP Spoofing, Upload Extension, Headers, Open Redirect, State Drift) | Nên khắc phục sớm |
| **LOW (Rủi ro thấp / Kiến trúc)** | **2** | Quản lý trạng thái bộ nhớ trong (In-Memory Map) | Khuyến nghị cải thiện |
| **Tổng cộng** | **21** | Toàn bộ vòng đời Đặt phòng $\rightarrow$ Thanh toán $\rightarrow$ Vận hành $\rightarrow$ Kế toán Folio $\rightarrow$ Hậu mãi | Đã định vị chính xác từng file & dòng code |

### Những điểm sáng bảo mật đã được dự án làm tốt:
1. **Chống SQL Injection triệt để:** Rà soát toàn bộ các lệnh `.query(...)` trên khắp `backend/src/` cho thấy 100% truy vấn sử dụng tham số hóa (`?` hoặc `:param` trong QueryBuilder). Không có bất kỳ chuỗi nội suy `${...}` nào nối trực tiếp dữ liệu người dùng vào câu lệnh SQL.
2. **Bảo mật Webhook & Đối soát VNPay (`vnpay.service.ts`, `payments.service.ts`):**
   - Sử dụng `crypto.timingSafeEqual` (`safeCompareHex`) chống Timing Attack khi so sánh chữ ký `HMAC-SHA512` ở cả 3 luồng: IPN Callback, QueryDr và Refund.
   - Có khóa dòng `pessimistic_write` (`FOR UPDATE`) trên cả `PaymentTransaction` và `Booking` kết hợp kiểm tra khớp số tiền (`Math.abs(Number(payment.amount) - vnpAmount) <= 1`) và chống xử lý trùng lặp (Idempotency).
3. **Cơ chế Refresh Token Rotation & phát hiện đánh cắp (`auth.service.ts`):**
   - Lưu băm `SHA-256` của Refresh Token kèm `familyId` và `sessionId`; tự động thu hồi toàn bộ `familyId` nếu phát hiện Refresh Token cũ (`USED` / `REVOKED`) bị gửi lại.


---

## 2. CHI TIẾT CÁC LỖ HỔNG THEO TRỤ CỘT 1: AUTHMATRIX & BURP SUITE (PHÂN QUYỀN RBAC, BOLA/IDOR, BFLA & CÁCH LY ĐA KHÁCH SẠN)

### [CRITICAL-01] BFLA & Vượt rào nguyên tắc 4-Eyes: Khách hàng (`CUSTOMER`) hoặc nhân viên khách sạn khác có thể tự điều chỉnh giảm công nợ Folio về 0 VND
- **Phân loại:** OWASP API5:2023 (Broken Function Level Authorization) & API1:2023 (BOLA)
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/folio/folio.controller.ts` (dòng `50–69`)
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/folio/folio.service.ts` (dòng `246–280`)
- **Cơ chế lỗ hổng:**
  1. Tại `FolioController`, controller chỉ gắn `@UseGuards(JwtAuthGuard)` mà **không có** `@UseGuards(RolesGuard)` hay `@Roles('ADMIN', 'EMPLOYEE')`.
  2. Tại `FolioService.postFourEyesAdjustment(folioId, dto, actor)`:
     - Hàm **không gọi** `assertBookingOperator(...)` (khác với `recordSettlement` ở dòng 205 có gọi).
     - Hàm **không kiểm tra** `actor.role` có phải là nhân sự khách sạn (`EMPLOYEE` / `ADMIN`) hay không.
     - Hàm kiểm tra 4-eyes chỉ bằng biểu thức `if (!dto.approvedByManagerId || String(dto.approvedByManagerId) === String(actor.id))` mà **không hề truy vấn CSDL** để xác minh `dto.approvedByManagerId` có thực sự là `MANAGER` đang `ACTIVE` tại `folio.hotelId` hay có bản ghi `approval_requests` đã được duyệt hay không.
- **Tác động:** Bất kỳ tài khoản `CUSTOMER` nào đã đăng nhập (hoặc nhân viên của một khách sạn khác) đều có thể gọi `POST /api/folios/:id/adjustments` với `direction: 'CREDIT'` và truyền một `approvedByManagerId` bất kỳ khác `actor.id` để xóa toàn bộ công nợ (`outstandingBalanceVnd`) của sổ cái Folio trước khi Check-out, vượt qua chốt chặn tài chính `assertCheckoutAllowed()`.
- **Khuyến nghị khắc phục (Defensive Fix):**
  - Bổ sung `@UseGuards(JwtAuthGuard, RolesGuard)` và `@Roles('ADMIN', 'EMPLOYEE')` lên `POST folios/:id/adjustments` và `POST folios/:id/settlements`.
  - Trong `postFourEyesAdjustment`, bắt buộc gọi `assertBookingOperator(this.dataSource.manager, booking, actor, 'FOLIO_ADJUSTMENT')` và truy vấn bảng `hotel_staff` (hoặc `approval_requests`) để xác thực `approvedByManagerId` là `MANAGER` đang hoạt động tại đúng `folio.hotelId`.

---

### [CRITICAL-02] BOLA / IDOR: Lộ toàn bộ Sổ cái Tài chính (Folio, Bút toán & Chứng từ Thanh toán) của mọi đơn đặt phòng
- **Phân loại:** OWASP API1:2023 (Broken Object Level Authorization / IDOR)
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/folio/folio.controller.ts` (dòng `25–28`)
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/folio/folio.service.ts` (dòng `166–179`)
- **Cơ chế lỗ hổng:**
  Endpoint `GET /api/bookings/:id/folio` không nhận `@Req() req` hay `@CurrentUser() user`, và `folioService.getBookingFolio(bookingId)` trả thẳng toàn bộ `{ folio, entries, settlements }` của bất kỳ `bookingId` nào mà không kiểm tra người gọi có phải là chủ đơn (`booking.userId === user.id`) hay nhân viên của khách sạn (`booking.hotelId`) hay không. Ngoài ra, lệnh `GET` này còn gọi `getOrCreateFolio()`, gây tác dụng phụ ghi dữ liệu (tạo mới Folio) trên một request đọc.
- **Tác động:** Bất kỳ người dùng nào đã đăng nhập đều có thể quét tuần tự `:id` (`1, 2, 3...`) để xem chi tiết lịch sử thanh toán, phụ thu, mã giao dịch ngân hàng (`providerRef`), và đường dẫn ảnh chứng từ (`evidenceUrl`) của mọi khách hàng trên toàn hệ thống.
- **Khuyến nghị khắc phục:**
  - Truyền `this.extractActor(req)` vào `this.folioService.getBookingFolio(bookingId, actor)` và kiểm tra quyền truy cập qua `BookingAccessService.assertCanView(booking, actor)` hoặc `assertBookingOperator`.

---

### [HIGH-01] BOLA / IDOR & Lộ số phòng vật lý trước giờ Check-in (`GET /api/bookings/:id/room-unit-allocations`)
- **Phân loại:** OWASP API1:2023 (BOLA) & Vi phạm chính sách nghiệp vụ `allowGuestRoomNumberReveal`
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/room-units/room-units.controller.ts` (dòng `111–114`)
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/room-units/room-allocation.service.ts` (dòng `76–85`)
- **Cơ chế lỗ hổng:**
  - `GET /api/bookings/:id/room-unit-allocations` chỉ yêu cầu `JwtAuthGuard` và gọi thẳng `this.roomAllocationService.getBookingAllocations(id)` mà không truyền `actor`.
  - Không kiểm tra quyền sở hữu booking hay biên chế nhân sự tại khách sạn.
  - Ngay cả với chính khách hàng đặt phòng, hệ thống có cờ bảo mật an ninh khách sạn `allowGuestRoomNumberReveal = false` (trong `hotel_business_settings`) nhằm không tiết lộ số phòng vật lý cụ thể trước khi khách hoàn tất Check-in tại quầy, nhưng endpoint này trả thẳng `roomUnitId` ở trạng thái `ASSIGNED`.
- **Khuyến nghị khắc phục:**
  - Bắt buộc truyền `actor` vào `getBookingAllocations`, kiểm tra quyền xem qua `BookingAccessService.assertCanView`, và nếu `actor.role === 'CUSTOMER'` khi `booking.status !== 'CHECKED_IN'` đồng thời `allowGuestRoomNumberReveal === false`, ẩn `roomUnitId` / `roomNumber`.

---

### [HIGH-02] Vượt quyền ngang & dọc trên Quản lý Khách hàng (`GET /api/users/customers` & `PATCH /api/users/customers/:id/status`)
- **Phân loại:** OWASP API3:2023 (Excessive Data Exposure) & API5:2023 (BFLA)
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/users/users.controller.ts` (dòng `45–70`)
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/users/users.service.ts` (dòng `47–85`)
- **Cơ chế lỗ hổng:**
  1. `GET /api/users/customers` cho phép mọi tài khoản có `role = 'EMPLOYEE'` tải về **toàn bộ danh sách khách hàng của toàn nền tảng** (`fullName`, `email`, `phone`, `address`, `dateOfBirth`, `gender`) mà không giới hạn theo khách sạn (`hotel_staff`) và không có phân trang.
  2. `PATCH /api/users/customers/:id/status` cho phép bất kỳ `EMPLOYEE` nào (kể cả lễ tân bình thường, không phải `MANAGER` hay `ADMIN`) khóa (`BLOCKED`) tài khoản của bất kỳ khách hàng nào trên toàn hệ thống.
- **Khuyến nghị khắc phục:**
  - Giới hạn `PATCH /api/users/customers/:id/status` chỉ cho `@Roles('ADMIN')` (đồng bộ với `ROLE_PERMISSIONS` trong `auth.service.ts` dòng 77: `'users.update_status'` chỉ thuộc về `ADMIN`).
  - Với `GET /api/users/customers`, áp dụng phân trang bắt buộc và nếu người gọi là `EMPLOYEE`, chỉ trả về khách hàng có booking tại khách sạn mà nhân viên đó đang `ACTIVE`.

---

### [HIGH-03] Giả mạo phê duyệt Quản lý (`approvedByManagerId`) trong Xử lý Sự cố Phòng & Chuyển Phòng Vật lý
- **Phân loại:** OWASP API5:2023 (Broken Function Level Authorization / Maker-Checker Bypass)
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/room-incidents/room-incident.service.ts` (dòng `94–108`)
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/room-units/room-move.service.ts` (dòng `167–178`)
- **Cơ chế lỗ hổng:**
  - Trong `RoomIncidentService.proposeOption`: Khi phương án xử lý là nâng hạng miễn phí (`COMPLIMENTARY_UPGRADE`), chuyển khách sạn (`RELOCATION`), hoặc có tiền bồi thường (`compensationVnd > 0`), hệ thống chỉ kiểm tra `if (requiresManager && !dto.approvedByManagerId && actor.role !== 'ADMIN')`.
  - Tương tự trong `RoomMoveService.executeRoomMoveSwap`: Khi chuyển khách sang phòng khác hạng (`isDifferentRoomType`), hệ thống chỉ kiểm tra `if (!dto.approvedByManagerId && actor.role !== 'ADMIN')`.
  - Cả hai nơi **đều tin tưởng tuyệt đối chuỗi `approvedByManagerId` do client gửi lên trong JSON body** mà không kiểm tra:
    1. `String(dto.approvedByManagerId) !== String(actor.id)` (nhân viên tự điền ID của chính mình),
    2. `approvedByManagerId` có thực sự là `MANAGER` đang `ACTIVE` tại khách sạn đó trong bảng `hotel_staff` hay không,
    3. Hoặc có gắn với một bản ghi `approval_requests` đã được Quản lý duyệt (`APPROVED`) hay không.
- **Khuyến nghị khắc phục:**
  - Truy vấn xác thực `approvedByManagerId` trong bảng `hotel_staff` (`staff_role = 'MANAGER' AND status = 'ACTIVE' AND hotel_id = ?`) và yêu cầu mã phê duyệt `approvalRequestId` đã ở trạng thái `APPROVED` bởi chính Manager đó.

---

### [HIGH-04] Rò rỉ dữ liệu thời gian thực liên khách sạn (Cross-Hotel Data Leak) qua kênh WebSocket `staff:notifications`
- **Phân loại:** OWASP API1:2023 / Multi-Tenant Isolation Breach
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/realtime/realtime.gateway.ts` (dòng `212–410`)
- **Cơ chế lỗ hổng:**
  - Sự kiện `@SubscribeMessage('subscribe:staff')` (dòng `212–233`) cho phép bất kỳ `EMPLOYEE` nào tham gia vào room chung `'staff:notifications'`.
  - Toàn bộ các hàm phát sự kiện (`emitBookingCreated`, `emitBookingStatusChanged`, `emitServiceRequested`, `emitPaymentStatusChanged`, `emitBookingReadyForConfirmation`, `emitBookingPaymentExpired`, `emitInventoryUpdated`, `emitRefundStatusChanged`) đều phát đồng thời tới cả `hotel:<hotelId>` **VÀ** `'staff:notifications'`.
- **Tác động:** Một nhân viên lễ tân chỉ thuộc biên chế **Khách sạn 1** khi kết nối WebSocket và gửi sự kiện `subscribe:staff` sẽ nhận được toàn bộ thông tin đặt phòng mới (họ tên khách, số điện thoại, email, mã booking, tổng tiền, trạng thái thanh toán/hoàn tiền) của **tất cả các khách sạn khác (Khách sạn 2 đến 15)** theo thời gian thực.
- **Khuyến nghị khắc phục:**
  - Chỉ cho phép `user.role === 'ADMIN'` tham gia room toàn cục `'staff:notifications'`, còn `EMPLOYEE` chỉ được phép nhận thông báo qua room `hotel:<hotelId>` nơi họ có bản ghi `hotel_staff` trạng thái `ACTIVE`.

---

### [MEDIUM-01] Rò rỉ hồ sơ năng lực, chứng chỉ và email nhân sự liên khách sạn (`StaffSkillsController`)
- **Phân loại:** OWASP API1:2023 (BOLA) & API3:2023
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/hotel-staff/staff-skills.controller.ts` (dòng `68–71, 107–118, 124–127, 159–166, 172–175`)
- **Cơ chế lỗ hổng:**
  - Các endpoint `GET /api/staff-skills/user/:userId`, `GET /api/staff-skills/user/:userId/languages`, `GET /api/staff-skills/suggest`, `POST /api/staff-skills/check-eligibility`, và `GET /api/staff-skills/stats` chỉ kiểm tra `@Roles('ADMIN', 'EMPLOYEE')` mà không kiểm tra `actor` có thuộc cùng khách sạn với `userId` / `hotelId` được tra cứu hay không.
  - Đặc biệt, `GET /api/staff-skills/suggest?skillCode=...` nếu không truyền `hotelId` sẽ trả về danh sách nhân viên và email (`staffEmail`) trên toàn hệ thống.
- **Khuyến nghị khắc phục:**
  - Bổ sung kiểm tra phạm vi khách sạn (`HotelAccessPolicyService.assertActiveStaffAtHotel`) cho tất cả các endpoint đọc của `StaffSkillsController`.

---

### [MEDIUM-02] Lộ cấu hình vận hành nội bộ khách sạn (`PropertySettingsController`) & Lỗi mất dữ liệu khi cập nhật cấu hình
- **Phân loại:** OWASP API1:2023 & Lỗi toàn vẹn trạng thái (State Persistence Drift)
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/property-settings/property-settings.controller.ts` (dòng `24–65`)
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/property-settings/property-settings.service.ts` (dòng `51–129`)
- **Cơ chế lỗ hổng:**
  1. `GET /api/hotels/:hotelId/property-settings` và `GET /api/hotels/:hotelId/property-settings/feature-flags/:flagKey` chỉ gắn `JwtAuthGuard`, cho phép mọi `CUSTOMER` hoặc nhân viên khách sạn khác xem cấu hình nội bộ (`requireRoomInspection`, `cutoffTime`, feature flags) của bất kỳ khách sạn nào.
  2. **Lỗi logic nghiêm trọng trong `updateHotelSettings` (dòng 96–129):** Hàm cập nhật chỉ lưu vào `this.inMemorySettings.set(key, updated)` trong RAM mà **không thực hiện `INSERT ... ON DUPLICATE KEY UPDATE` xuống bảng `hotel_business_settings` trong MySQL**. Trong khi đó, hàm `getHotelSettings` (dòng 56–77) luôn ưu tiên đọc từ bảng `hotel_business_settings` trong MySQL trước! Do file SQL hợp nhất đã seed sẵn dữ liệu cho các khách sạn trong `hotel_business_settings`, mọi thay đổi cấu hình qua API `PATCH /api/hotels/:hotelId/property-settings` đều bị bỏ qua hoàn toàn ở các lần đọc tiếp theo.
- **Khuyến nghị khắc phục:**
  - Thực thi `INSERT INTO hotel_business_settings ... ON DUPLICATE KEY UPDATE ...` trong `updateHotelSettings` và giới hạn quyền đọc cấu hình nội bộ cho nhân sự của khách sạn đó.

---

### [MEDIUM-03] Thiếu kiểm tra quyền ngữ cảnh trên `POST /api/promotions/service-quotes`
- **Phân loại:** OWASP API1:2023
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/promotions/promotions.controller.ts` (dòng `161–167`)
- **Cơ chế lỗ hổng:**
  - Endpoint `POST /api/promotions/service-quotes` nhận `QuoteServiceItemDto` (có thể chứa `bookingId`, `hotelId`, `serviceId`) nhưng không truyền `@CurrentUser()` xuống `this.promotionsService.quoteServiceItem(dto)` để kiểm tra quyền truy cập trên `bookingId` đó.
- **Khuyến nghị khắc phục:**
  - Truyền `@CurrentUser() user` xuống `quoteServiceItem(dto, user)` và xác thực quyền xem trên `bookingId`.

---

## 3. CHI TIẾT CÁC LỖ HỔNG THEO TRỤ CỘT 2: SCHEMATHESIS (HỢP ĐỒNG SCHEMA API, DTO VALIDATION PIPE & TOÀN VẸN STATE-MACHINE)

### [HIGH-05] Vô hiệu hóa Global `ValidationPipe` (`whitelist` & `forbidNonWhitelisted`) tại 16 Controllers do sử dụng `any`, Inline Object `{...}` hoặc `import type`
- **Phân loại:** OWASP API3:2023 (Broken Object Property Level Authorization / Mass Assignment) & API8:2023 (Security Misconfiguration)
- **Cơ chế kỹ thuật (Tại sao Schemathesis phát hiện lỗi này):**
  Mặc dù `main.ts` (dòng `41–47`) đã cấu hình `new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`, cơ chế `ValidationPipe` của NestJS phụ thuộc vào metadata kiểu lúc chạy (`design:paramtypes`) của TypeScript. Khi tham số `@Body()` được khai báo bằng:
  - kiểu `any` hoặc `Record<string, any>`,
  - kiểu inline object literal `@Body() body: { ... }`,
  - kiểu generic `Omit<Dto, 'field'>`, hoặc
  - interface được nạp bằng `import type { ... }`,
  trình biên dịch TypeScript sẽ xóa bỏ kiểu và phát ra `Object` lúc runtime. Hàm `ValidationPipe.toValidate(Object)` trả về `false` và **bỏ qua hoàn toàn cả việc lọc trường thừa (`whitelist`) lẫn kiểm tra kiểu dữ liệu (`class-validator`)**!
- **Danh sách đầy đủ 16 Controllers đang bị hở Schema Validation:**
  1. `auth/auth.controller.ts` (dòng `272, 327`): `@Body() dto: { refreshToken?: string }`
  2. `payments/payments.controller.ts` (dòng `126`): `@Body() body: { amount: number; reason: string }`
  3. `booking-amendments/booking-amendments.controller.ts` (dòng `12, 32, 45, 67`): `import type { RequestBookingAmendmentDto }`, `Omit<...>`, và inline `body: { ... }`
  4. `booking-documents/documents.controller.ts` (dòng `35`): `@Body() body: { type: BookingDocumentType; amountVnd?: number; ... }`
  5. `folio/folio.controller.ts` (dòng `34, 54`): `@Body() body: { method: string; amountVnd: number; ... }`
  6. `housekeeping/housekeeping.controller.ts` (dòng `43, 56, 70, 85`): `@Body() body: { ... }`
  7. `maintenance/room-blocks.controller.ts` (dòng `11, 28, 41`): `import type { CreateRoomBlockDto }` và `Omit<...>`
  8. `night-audit/night-audit.controller.ts` (dòng `41`): `@Body() body: { date: string; commandId: string }`
  9. `precheckin/precheckin.controller.ts` (dòng `33, 42, 52`): `@Body() body: any` và inline `body: { ... }`
  10. `property-settings/property-settings.controller.ts` (dòng `14, 32, 44`): `import type { UpdateHotelBusinessSettingDto }` và inline `body: { ... }`
  11. `rate-plans/rate-plans.controller.ts` (dòng `27, 40`): `@Body() dto: any` và `@Body() body: { entries: any[] }`
  12. `room-incidents/room-incident.controller.ts` (dòng `12, 27, 35, 51`): `import type { OpenRoomIncidentInput }` và inline `body: { ... }`
  13. `room-units/room-units.controller.ts` (dòng `19, 21, 88, 100, 128, 137`): `import type { RoomMoveRequestDto }`, `import type { CreateRoomUnitDto }`, `Omit<...>`, và inline `body: { ... }`
  14. `services/services.controller.ts` (dòng `232, 257, 272`): inline `@Body() body: { ... }`
  15. `staff-availability/staff-availability.controller.ts` (dòng `189`): inline `@Body() dto: { ... }`
  16. `vouchers/voucher.controller.ts` (dòng `13`): `@Body() body: { code: string }`
- **Tác động:** Khi fuzzing bằng Schemathesis với các kiểu dữ liệu bất thường (ví dụ truyền mảng/object vào trường `code`, `commandId`, `providerRef` hoặc số âm/NaN vào `amount`), ứng dụng sẽ ném lỗi `TypeError: ...trim is not a function` (`500 Internal Server Error`) hoặc lưu dữ liệu rác vào cột JSON trong MySQL.
- **Khuyến nghị khắc phục:**
  - Chuyển toàn bộ 16 vị trí trên sang các `class` DTO thực thụ có gắn decorators của `class-validator` (`@IsString()`, `@IsNotEmpty()`, `@IsInt()`, `@Min(0)`, `@IsEnum()`, `@ValidateNested()`).

---

### [MEDIUM-04] Đăng ký trùng lặp Route `POST /api/bookings/:id/room-unit-allocations` với 2 cấu hình Guard khác nhau
- **Phân loại:** API Contract Ambiguity / Guard Shadowing
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/room-units/room-units.controller.ts`:
    - `RoomUnitBookingController.allocate` (dòng `28–51`): Có `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('ADMIN', 'EMPLOYEE')`.
    - `RoomUnitsController.allocateRoomUnits` (dòng `116–123`): Chỉ có `@UseGuards(JwtAuthGuard)` (thiếu `RolesGuard` và `@Roles`).
- **Khuyến nghị khắc phục:**
  - Xóa method trùng lặp `allocateRoomUnits` trong `RoomUnitsController` và chỉ giữ lại một handler chuẩn duy nhất có đầy đủ `RolesGuard`.

---

### [MEDIUM-05] Khách hàng có thể tự duyệt `EARLY_CHECKIN` / `LATE_CHECKOUT` miễn phí (`isComplimentary: true`) trên `StayTimeService`
- **Phân loại:** Logic Nghiệp vụ / Vòng đời State-Machine (`StayTimeService`)
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/booking-amendments/booking-amendments.controller.ts` (dòng `63–80`)
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/stay-extras/stay-time.service.ts` (dòng `37–98`)
- **Cơ chế lỗ hổng:**
  - Tại `stay-time.service.ts` dòng `52`: `if (String(booking.userId) !== String(actor.id))` cho phép chính `CUSTOMER` gọi endpoint `POST /api/bookings/:id/stay-time-requests`.
  - Nếu `CUSTOMER` truyền `isComplimentary: true` hoặc `feeVnd: 0`, hàm trả về ngay `status: 'APPROVED'` và `feeVnd: 0` mà không qua bước lễ tân/quản lý phê duyệt và không ghi bút toán phụ thu vào sổ Folio.
- **Khuyến nghị khắc phục:**
  - Nếu người gọi là `CUSTOMER`, trạng thái trả về phải là `REQUESTED` (chờ lễ tân/quản lý duyệt) và chỉ cho phép `EMPLOYEE` / `ADMIN` thiết lập `isComplimentary` hoặc `feeVnd`.

---

### [MEDIUM-06] Lỗi vòng đời Token Pre-check-in (`usedAt` không chặn tái sử dụng, lộ `tokenHash`, thiếu Transaction khi cập nhật Occupants)
- **Phân loại:** OWASP API2:2023 & API4:2023
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/precheckin/precheckin.service.ts` (dòng `58–129, 159–223`)
- **Cơ chế lỗ hổng:**
  1. Hàm `createInviteToken` (dòng `70`) trả về cả `tokenHash` (mã băm lưu trong DB) ra HTTP response.
  2. Hàm `submitByToken` (`POST /api/precheckin/:opaqueToken/submit` - Public endpoint) có gán `tokenRow.usedAt = new Date()` (dòng `125`), nhưng ở dòng `86–91` chỉ kiểm tra `tokenRow.revokedAt` và `expiresAt` mà **không kiểm tra `tokenRow.usedAt`** hoặc khóa khi hồ sơ đã `REVIEWED`, đồng thời không có `@RateLimit` và cho phép truyền `guestDataMinimal` kiểu `any` không giới hạn kích thước.
  3. Hàm `upsertOccupants` (dòng `203–221`) thực hiện `await this.occupantRepo.delete(...)` rồi chạy vòng lặp `for` lưu từng người ở ngoài Transaction; nếu phần tử thứ 2 bị lỗi (`fullName` null), toàn bộ danh sách khách lưu trú cũ sẽ bị mất trắng.
- **Khuyến nghị khắc phục:**
  - Ẩn `tokenHash` khỏi response; bổ sung `@RateLimit` cho `submitByToken`; chặn ghi đè khi `sub.status === 'REVIEWED'`; bọc `upsertOccupants` trong `this.dataSource.transaction(...)`.

---

## 4. CHI TIẾT CÁC LỖ HỔNG THEO TRỤ CỘT 3: STACKHAWK & OWASP API TOP 10 (XÁC THỰC, RATE LIMIT, HEADERS, UPLOAD & FRONTEND)

### [HIGH-06] Access Token không bị thu hồi tức thì khi Logout (`sessionId` không được kiểm tra) & WebSocket Handshake bỏ qua kiểm tra trạng thái `BLOCKED`
- **Phân loại:** OWASP API2:2023 (Broken Authentication)
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/auth/strategies/jwt.strategy.ts` (dòng `10–42`)
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/auth/auth.module.ts` (dòng `33–35`)
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/realtime/realtime.gateway.ts` (dòng `68–100`)
- **Cơ chế lỗ hổng:**
  1. Mặc dù `AuthService.login` và `rotateRefreshToken` đã nhúng `sessionId` vào JWT payload, `JwtStrategy.validate(payload)` chỉ truy vấn bảng `users` theo `payload.sub` mà **không kiểm tra xem `payload.sessionId` đã bị đánh dấu `REVOKED` trong bảng `refresh_tokens` (hoặc Redis blacklist) hay chưa**. Do đó, sau khi người dùng bấm Đăng xuất (`logout` / `logout-all`), Access Token cũ vẫn tiếp tục gọi API hợp lệ cho đến khi hết hạn.
  2. Tại `RealtimeGateway.afterInit` (dòng `82–83`), khi xác thực kết nối WebSocket (`this.jwtService.verify(token)`), hệ thống chỉ kiểm tra chữ ký JWT mà **không truy vấn CSDL để kiểm tra tài khoản đã bị khóa (`status = 'BLOCKED'`) hoặc xóa mềm (`deleted_at IS NOT NULL`) hay chưa**.
- **Khuyến nghị khắc phục:**
  - Trong `JwtStrategy.validate(payload)`, kiểm tra thêm trạng thái phiên `sessionId` (hoặc lưu danh sách `sessionId` bị thu hồi vào Redis với TTL bằng thời hạn còn lại của Access Token).
  - Trong `RealtimeGateway.afterInit`, kiểm tra `users.status === 'ACTIVE' AND deleted_at IS NULL` trước khi cho phép gắn `socket.data.user`.

---

### [HIGH-07] Lộ `refresh_token` ra JSON Body & Lưu trữ trong `localStorage` ở Frontend (Vô hiệu hóa cơ chế `HttpOnly` Cookie) + Xung đột Cookie giữa cổng Staff & Customer
- **Phân loại:** OWASP API2:2023 & CWE-922 (Insecure Storage of Sensitive Information)
- **Vị trí mã nguồn:**
  - Backend: `/Users/dangquangminh/cg_traveleke_service/backend/src/auth/auth.controller.ts` (dòng `241–255, 288–302`)
  - Frontend:
    - `/Users/dangquangminh/cg_traveleke_app/src/features/auth/context/AuthContext.tsx` (dòng `165–169`)
    - `/Users/dangquangminh/cg_traveleke_app/src/features/auth/context/CustomerAuthContext.tsx` (dòng `96–100`)
    - `/Users/dangquangminh/cg_traveleke_app/src/services/api/client.ts` (dòng `140–148`)
- **Cơ chế lỗ hổng:**
  1. Backend đã thiết lập cookie `traveleke_refresh_token` với cờ `httpOnly: true` để chống đánh cắp Refresh Token qua XSS, **nhưng lại đồng thời trả về `refresh_token` dạng rõ trong JSON response (`data.refresh_token`)**.
  2. Phía Frontend (`AuthContext`, `CustomerAuthContext`, `client.ts`) lại lưu trực tiếp cả `access_token` lẫn `refresh_token` vào `localStorage` (`traveleke_refresh_token`, `traveleke_customer_refresh_token`). Nếu xảy ra bất kỳ lỗi XSS nào trên trình duyệt, kẻ tấn công đọc được ngay `refresh_token` từ `localStorage`, làm mất hoàn toàn tác dụng của `HttpOnly` Cookie.
  3. Ngoài ra, cả 2 luồng đăng nhập Nhân viên (`/login`) và Khách hàng (`/customer-login`) đều ghi đè lên **cùng một tên cookie `traveleke_refresh_token`** tại `path: '/'`, dẫn đến xung đột phiên khi mở song song 2 tab trên cùng trình duyệt.
- **Khuyến nghị khắc phục:**
  - Không lưu `refresh_token` vào `localStorage`; chỉ sử dụng `HttpOnly` Cookie (tách tên cookie riêng cho Staff và Customer nếu cần chạy song song trên cùng domain).

---

### [HIGH-08] Điểm cuối AI Chatbox (`POST /api/chat`) mở công khai không có Xác thực, không có Rate Limit và không giới hạn độ dài chuỗi đầu vào
- **Phân loại:** OWASP API4:2023 (Unrestricted Resource Consumption / LLM & DB DoS)
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/chat/chat.controller.ts` (dòng `6–14`)
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/chat/dto/chat-message.dto.ts`
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/chat/chat.service.ts` (dòng `50–101, 520–640`)
- **Cơ chế lỗ hổng:**
  - `ChatController` không gắn `@UseGuards(RateLimiterGuard)` hay `@RateLimit(...)`.
  - Mỗi request `POST /api/chat` kích hoạt một lệnh gọi HTTP tới mô hình LLM (`fetch('${ollamaUrl}/api/chat')`) kèm theo câu truy vấn SQL nhiều phép JOIN trên `rooms`, `hotels`, `locations`, `booking_holds`.
- **Tác động:** Kẻ tấn công có thể gửi hàng loạt request đồng thời với văn bản rất dài tới `/api/chat` để làm treo cứng GPU/CPU của máy chủ AI (`Ollama`) và làm nghẽn Connection Pool của MySQL.
- **Khuyến nghị khắc phục:**
  - Gắn `@UseGuards(RateLimiterGuard)` và `@RateLimit({ slidingWindow: { limit: 10, windowMs: 60_000 } })` lên `ChatController`.
  - Thêm `@MaxLength(500)` vào `ChatMessageDto.message` và `AbortSignal.timeout(10000)` cho lệnh `fetch` gọi Ollama.

---

### [MEDIUM-07] Thiếu Security Headers (`helmet`), thiếu giới hạn JSON Payload Size & Giả mạo IP qua Header `X-Forwarded-For` để vượt qua Rate Limit / Lockout
- **Phân loại:** OWASP API8:2023 (Security Misconfiguration) & CWE-290 (Authentication Bypass by Spoofing)
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/main.ts` (dòng `16–50`)
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/rate-limit/rate-limiter.guard.ts` (dòng `64–70`)
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/auth/auth.controller.ts` (dòng `73–82`)
- **Cơ chế lỗ hổng:**
  1. `main.ts` chưa cài đặt và kích hoạt `helmet()` (thiếu các header bảo mật bắt buộc theo chuẩn DAST của StackHawk: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Content-Security-Policy`, `Referrer-Policy`) và chưa tắt `x-powered-by`.
  2. `RateLimiterGuard` và `AuthController.getClientIp()` lấy trực tiếp phần tử đầu tiên của header `req.headers['x-forwarded-for']?.split(',')[0]?.trim()` mà không bật `app.set('trust proxy', 1)` trên Express. Do header `X-Forwarded-For` có thể bị client tự chèn giá trị ngẫu nhiên trên mỗi request, kẻ tấn công có thể **vượt qua hoàn toàn giới hạn Rate Limit (Sliding Window theo IP)** trên `/api/auth/login`, `/api/auth/register` và khóa IP 10 giờ của `EmailSecurityService`.
- **Khuyến nghị khắc phục:**
  - Bật `app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))` và `app.disable('x-powered-by')` trong `main.ts`.
  - Cấu hình `app.set('trust proxy', 1)` và sử dụng `req.ip` chuẩn của Express thay vì đọc thủ công `req.headers['x-forwarded-for']`.

---

### [MEDIUM-08] Upload File chỉ kiểm tra `file.mimetype` từ Header của Client và giữ nguyên đuôi mở rộng `path.extname(file.originalname)`
- **Phân loại:** OWASP API8:2023 & CWE-434 (Unrestricted Upload of File with Dangerous Type)
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/auth/auth.controller.ts` (dòng `36–59`)
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/hotels/upload-image.config.ts` (dòng `16–53`)
  - `/Users/dangquangminh/cg_traveleke_service/backend/src/main.ts` (dòng `26–28`)
- **Cơ chế lỗ hổng:**
  - Trong `avatarMulterOptions` và `createMulterOptions`, `fileFilter` chỉ kiểm tra `file.mimetype` (do client tự khai báo trong multipart header), nhưng hàm đặt tên file `filename` lại lấy trực tiếp `const ext = path.extname(file.originalname).toLowerCase()` mà không kiểm tra `ext` có nằm trong danh sách đuôi ảnh cho phép (`['.jpg', '.jpeg', '.png', '.webp', '.avif']`) hay không.
  - Nếu client gửi request multipart có `Content-Type: image/png` nhưng `filename="xss.html"` hoặc `"xss.svg"`, file sẽ được lưu thành `/uploads/avatars/avatar-...html` và được phục vụ trực tiếp qua `app.useStaticAssets(..., { prefix: '/uploads/' })`, dẫn đến nguy cơ Stored XSS trên cùng origin của Backend.
- **Khuyến nghị khắc phục:**
  - Kiểm tra chặt chẽ `ext` theo whitelist `['.jpg', '.jpeg', '.png', '.webp', '.avif']` (hoặc suy ra đuôi file từ bảng ánh xạ MIME chuẩn và kiểm tra Magic Bytes đầu file), đồng thời gắn header `X-Content-Type-Options: nosniff` và `Content-Disposition: inline` cho thư mục tĩnh `/uploads/`.

---

### [MEDIUM-09] Rủi ro Open Redirect trên trang Đăng nhập Khách hàng (`/customer-login?redirect=...`)
- **Phân loại:** CWE-601 (URL Redirection to Untrusted Site / Open Redirect)
- **Vị trí mã nguồn:**
  - `/Users/dangquangminh/cg_traveleke_app/src/app/customer-login/page.tsx` (dòng `45–48`)
  - `/Users/dangquangminh/cg_traveleke_app/src/features/auth/context/CustomerAuthContext.tsx` (dòng `103`)
- **Cơ chế lỗ hổng:**
  - `CustomerLoginForm` lấy `const redirectParam = searchParams.get('redirect') || ''` và truyền thẳng vào `customerLogin(..., redirectParam)`, sau đó gọi `router.push(redirectPath || '/home')` mà không kiểm tra `redirectPath` có phải là đường dẫn nội bộ hợp lệ hay không (ví dụ: `?redirect=https://evil.example` hoặc `?redirect=//evil.example`).
- **Khuyến nghị khắc phục:**
  - Chỉ chấp nhận `redirectPath` khi `redirectPath.startsWith('/') && !redirectPath.startsWith('//')`.

---

### [LOW-01] Bộ nhớ khóa vi phạm `EmailSecurityService.lockoutMap` lưu trên RAM (In-Memory `Map`) không có giới hạn kích thước & TTL Eviction
- **Vị trí mã nguồn:** `/Users/dangquangminh/cg_traveleke_service/backend/src/auth/email-security.service.ts` (dòng `62`)
- **Cơ chế & Khuyến nghị:** `lockoutMap` lưu trên RAM của tiến trình Node.js nên sẽ mất trạng thái khi restart server, không đồng bộ khi chạy nhiều instance, và có thể gây tăng trưởng bộ nhớ (Memory Leak) nếu bị spam từ nhiều IP. Nên chuyển sang lưu khóa trên Redis với `EXPIRE` tự động.

---

### [LOW-02] Bộ nhớ đệm kết quả hoàn tiền `RefundService.verifiedOutcomes` lưu trên RAM (`Map`)
- **Vị trí mã nguồn:** `/Users/dangquangminh/cg_traveleke_service/backend/src/payments/services/refund.service.ts` (dòng `12–28, 63–65`)
- **Cơ chế & Khuyến nghị:** `verifiedOutcomes` lưu trạng thái idempotency trên `Map` trong bộ nhớ RAM. Dù tầng DB đã có kiểm tra `PaymentTransaction.status === 'REFUNDED'`, đối với các lệnh hoàn tiền một phần (`03`) hoặc trạng thái `UNKNOWN_RECONCILE`, nếu tiến trình khởi động lại thì bộ nhớ đệm RAM sẽ mất. Nên đồng bộ kết quả hoàn tiền vào bảng CSDL hoặc Redis.

---

## 5. MA TRẬN ĐỐI CHIẾU BẢO MẬT THEO TOÀN BỘ VÒNG ĐỜI NGHIỆP VỤ (LIFECYCLE SECURITY MATRIX)

| Giai đoạn Vòng đời | Luồng API / Module chính | Trạng thái Bảo mật | Các điểm hở cần đóng (Mã lỗi) |
| :--- | :--- | :--- | :--- |
| **1. Đăng ký, Xác thực & Quản lý Phiên** | `AuthController`, `JwtStrategy`, `RealtimeGateway`, `AuthContext` | ⚠️ **Cần củng cố** | `HIGH-06` (Session Revocation & WS Blocked User), `HIGH-07` (`refresh_token` trong `localStorage` & trùng tên Cookie), `MEDIUM-07` (Spoof `X-Forwarded-For`), `MEDIUM-08` (Upload Avatar ext), `MEDIUM-09` (Open Redirect) |
| **2. Tìm kiếm, Khuyến mãi, Báo giá & AI Chat** | `HotelsController`, `RoomsController`, `PromotionsController`, `VoucherController`, `ChatController` | ⚠️ **Cần củng cố** | `HIGH-08` (`POST /api/chat` không có Rate Limit & giới hạn độ dài), `HIGH-05` (`VoucherController`, `RatePlansController` thiếu class DTO), `MEDIUM-03` (`service-quotes` thiếu kiểm tra quyền booking) |
| **3. Đặt phòng, Giữ chỗ (Hold) & Thanh toán VNPay** | `BookingsController`, `PaymentsController`, `CheckoutService`, `VnpayService`, `PaymentFinalizerService` | ✅ **An toàn cao** (Core Payment) | Chữ ký HMAC-SHA512 dùng `timingSafeEqual`, khóa dòng `pessimistic_write` chuẩn xác. Chỉ cần bổ sung class DTO cho `POST /api/payments/:bookingId/refund` (`HIGH-05`). |
| **4. Phân công Lễ tân, Ca trực, Xin nghỉ & Ủy quyền (Coverage)** | `BookingAssignment`, `Shifts`, `StaffAvailability`, `BookingCoverage`, `StaffSkills` | ⚠️ **Cần củng cố** | `MEDIUM-01` (`StaffSkillsController` lộ thông tin nhân sự liên khách sạn), `HIGH-05` (`emergency-unavailable` dùng inline DTO), `HIGH-04` (WebSocket `staff:notifications` phát dữ liệu liên khách sạn) |
| **5. Pre-check-in, Phân bổ Phòng Vật lý, Check-in & Sự cố Phòng** | `Precheckin`, `RoomUnits`, `BookingPresence`, `RoomIncidents`, `RoomBlocks`, `Housekeeping` | ❌ **Có lỗ hổng** | `HIGH-01` (BOLA lộ `room-unit-allocations` & lộ số phòng sớm), `HIGH-03` (Giả mạo `approvedByManagerId` khi nâng hạng/bồi thường/chuyển phòng), `MEDIUM-04` (Trùng route `room-unit-allocations`), `MEDIUM-06` (`Precheckin` lộ `tokenHash` & thiếu Transaction), `HIGH-05` (DTO bypass) |
| **6. Phục vụ Trong kỳ Lưu trú, Sửa đổi Booking & Gia hạn Giờ** | `Services`, `GuestWork`, `GuestConversations`, `BookingAmendments`, `StayTimeService` | ⚠️ **Cần củng cố** | `MEDIUM-05` (`StayTimeService` cho phép khách tự duyệt miễn phí `isComplimentary`), `HIGH-05` (`BookingAmendments` dùng `import type` làm tắt `ValidationPipe`) |
| **7. Sổ cái Folio, Khóa sổ Đêm (Night Audit), Check-out & Chứng từ** | `FolioController`, `NightAuditController`, `DocumentsController`, `PropertySettingsController` | ❌ **Nghiêm trọng** | `CRITICAL-01` (Khách/Nhân viên khác tự điều chỉnh giảm công nợ Folio `postFourEyesAdjustment`), `CRITICAL-02` (BOLA đọc trộm toàn bộ Folio `GET /api/bookings/:id/folio`), `MEDIUM-02` (`PropertySettings` không lưu xuống MySQL & lộ cấu hình), `HIGH-05` (DTO bypass) |
| **8. Hủy phòng, Hoàn tiền, Đánh giá Nhân viên & KPI** | `Cancellations`, `RefundService`, `GuestStaffReviews`, `StaffKpi`, `Approvals`, `UsersController` | ⚠️ **Cần củng cố** | `HIGH-02` (`GET /api/users/customers` lộ toàn bộ PII khách hàng & `PATCH /api/users/customers/:id/status` cho phép lễ tân khóa tài khoản khách hàng), `LOW-02` (`RefundService.verifiedOutcomes` lưu trên RAM) |

---

## 6. LỘ TRÌNH KHẮC PHỤC ƯU TIÊN (REMEDIATION ROADMAP)

1. **Ưu tiên P0 (Thực hiện ngay lập tức - Chặn rủi ro Tài chính & BOLA/IDOR):**
   - Khóa quyền `@Roles('ADMIN', 'EMPLOYEE')` và xác thực `assertBookingOperator` + kiểm tra thực tế `approvedByManagerId` trong bảng `hotel_staff` / `approval_requests` tại `FolioController` & `FolioService` (`CRITICAL-01`, `CRITICAL-02`).
   - Bổ sung kiểm tra quyền xem & tôn trọng cờ `allowGuestRoomNumberReveal` tại `GET /api/bookings/:id/room-unit-allocations` (`HIGH-01`) và xóa route trùng lặp (`MEDIUM-04`).
   - Xác thực `approvedByManagerId` trong CSDL cho `RoomIncidentService.proposeOption` và `RoomMoveService.executeRoomMoveSwap` (`HIGH-03`).
   - Thu hẹp quyền `PATCH /api/users/customers/:id/status` chỉ cho `ADMIN` và phân trang + lọc theo khách sạn cho `GET /api/users/customers` (`HIGH-02`).
   - Tách kênh WebSocket `staff:notifications` chỉ dành cho `ADMIN`, còn `EMPLOYEE` chỉ nhận sự kiện qua `hotel:<hotelId>` (`HIGH-04`).

2. **Ưu tiên P1 (Chuẩn hóa Schema Validation & Bảo mật Xác thực / Chống DoS):**
   - Chuyển toàn bộ 16 Controllers đang dùng `any`, `{...}`, `Omit<...>`, `import type` sang `class` DTO có decorators `class-validator` để kích hoạt lại `ValidationPipe` toàn cục (`HIGH-05`).
   - Kiểm tra trạng thái thu hồi `sessionId` trong `JwtStrategy.validate()` và kiểm tra `user.status === 'ACTIVE'` trong `RealtimeGateway.afterInit` (`HIGH-06`).
   - Ngừng lưu `refresh_token` trong `localStorage` ở Frontend và tách tên Cookie Refresh Token giữa Staff và Customer (`HIGH-07`).
   - Gắn `@UseGuards(RateLimiterGuard)` + `@RateLimit` + `@MaxLength(500)` cho `ChatController` (`HIGH-08`).

3. **Ưu tiên P2 (Cấu hình Hạ tầng, Upload, State Persistence & Frontend):**
   - Sửa `PropertySettingsService.updateHotelSettings` để ghi bền vững xuống bảng `hotel_business_settings` trong MySQL (`MEDIUM-02`).
   - Cài đặt `helmet`, bật `app.set('trust proxy', 1)` trong `main.ts` (`MEDIUM-07`), kiểm tra whitelist đuôi file ảnh khi upload (`MEDIUM-08`), và chặn Open Redirect ở `/customer-login` (`MEDIUM-09`).





