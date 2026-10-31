# TRAVELEKE — BÁO CÁO HOÀN THIỆN & SỬA LỖI ĐỢT 1 VÀ ĐỢT 2
**Hệ Thống Phân Công Lễ Tân Công Bằng 40/120 Phút & Quản Lý Vòng Đời Hiện Diện No-Show**

**Ngày thực hiện:** 31/10/2026  
**Trạng thái:** HOÀN TẤT TRIỂN KHAI & PASS 100% KIỂM THỬ ĐƠN VỊ, TÍCH HỢP, BUILD SOURCE  
**Phạm vi áp dụng:**
- Backend: `cg_traveleke_service` (nhánh `minh` — commit cơ sở `0bfcc021dbe1f224967e51e4a221d3f48cd26723`)
- Frontend: `cg_traveleke_app` (nhánh `minh` — commit cơ sở `e1597a978558b24808f50954907d68e194988fd2`)

---

## 1. TỔNG QUAN HIỆN TRẠNG DỰ ÁN & ĐỐI CHIẾU BÁO CÁO KIỂM TRA

### 1.1. Hiện trạng các luồng tính năng trong dự án
Trước khi thực hiện đợt điều chỉnh này, hệ thống TravelEke đã xây dựng các khối tính năng nền tảng:
1. **Quản lý danh mục & Tồn phòng (Inventory & Rooms):** Tìm kiếm phòng theo khách sạn, loại phòng, quản lý số phòng khả dụng theo khoảng ngày lưu trú `[checkInAt, checkOutAt)`.
2. **Thanh toán & Giữ phòng (VNPay & Booking Holds):** Tạo session checkout, tạo booking tạm `PAYMENT_PENDING` cùng hold `HELD` (TTL 15 phút), xử lý webhook IPN VNPay commit hold thành `COMMITTED`, chuyển trạng thái `PAID` và ghi nhận Outbox Pattern.
3. **Quản lý đơn xin nghỉ/đi muộn (Staff Availability - Đợt 1):** Cho phép lễ tân nộp đơn xin nghỉ/đi muộn, quản lý xét duyệt `APPROVED`/`REJECTED`, tự động kích hoạt `staff_availability_blocks` để chặn phân công.
4. **Phân công lễ tân công bằng 40/120 phút (Booking Assignment - Đợt 1):** Cơ chế tính toán độ tươi (`HARD_COOLDOWN` < 40 phút, `SOFT_RECENT` 40-119 phút, `FRESH` ≥ 120 phút), phân loại năng lực M1–M4 và quản lý fallback.
5. **Vòng đời hiện diện & No-show (Booking Presence - Đợt 2):** Khách báo dự kiến đến muộn, lễ tân check-in, check-out, scheduler tự động quét No-show và đóng kỳ No-show khi hết hạn lưu trú.

### 1.2. Trả lời câu hỏi: Nội dung báo cáo kiểm tra đã hoàn thành trước đó chưa?
**KẾT LUẬN: CHƯA HOÀN THÀNH.**
Tại thời điểm audit tĩnh ngày 28/10/2026, tài liệu audit chỉ là bản đề xuất thiết kế hướng sửa (Bản V2), **chưa hề được commit hoặc áp dụng vào source code**. Kiểm tra thực tế trên cây mã nguồn của 2 repository xác nhận toàn bộ các lỗ hổng kiến trúc và lỗi P0/P1 vẫn còn nguyên vẹn trong code:
- `booking-presence.service.ts` vẫn ghi `changedBy: '0'` vào `BookingStatusLog` (gây lỗi vi phạm Foreign Key rollback scheduler).
- `payments.service.ts` vẫn truyền callback phân công cũ `autoAssignStaffForPaidBooking` đồng thời với outbox event mới.
- Các controller `booking-assignment` và `booking-presence` bỏ ngỏ phân quyền tài khoản và không kiểm tra phạm vi khách sạn.
- `bookings.service.ts` phương thức `updateStatus` cho phép chuyển `NO_SHOW` và `CLOSED_NO_SHOW` bừa bãi mà không kiểm tra thời gian ân hạn hay hạn trả phòng.
- Phương thức `reassignStaff` chỉ cập nhật `bookings.handled_by` mà không hề ghi nhận lịch sử vào `booking_assignments` hay đồng bộ `booking_assignment_state`.

---

## 2. CHI TIẾT 5 NHÓM LỖI TRỌNG TÂM ĐÃ ĐIỀU CHỈNH & KHẮC PHỤC

### 2.1. FIX-01 (P0-01): No-show scheduler ghi `changedBy = '0'` gây lỗi Foreign Key
- **Nguyên nhân gốc:** Bảng `booking_status_logs.changed_by` có FK trỏ tới `users(id)`. Khi scheduler tự động chạy, service ghi actor hệ thống bằng chuỗi `'0'`. Trên hệ thống MySQL bật `FOREIGN_KEY_CHECKS=1`, câu lệnh INSERT thất bại với lỗi `ER_NO_REFERENCED_ROW_2` (Mã 1452), khiến toàn bộ transaction No-Show bị rollback.
- **Giải pháp triển khai:**
  1. Cập nhật TypeORM Entity `BookingStatusLog`: mô tả rõ `changedBy` là nullable (`string | null`) và bổ sung trường `actorType` (`'USER' | 'SYSTEM'`) đồng bộ hoàn hảo với schema DB.
  2. Tại `BookingPresenceService.markNoShowIfEligible` và `closeExpiredNoShow`: Khi tác nhân là hệ thống (scheduler), lưu `changedBy: null` và `actorType: 'SYSTEM'`.
  3. Khi tác nhân là Quản lý thao tác thủ công tại quầy, lưu `changedBy: actor.id` và `actorType: 'USER'`.

### 2.2. FIX-02 (P0-03, P0-04): Chấm dứt tình trạng Dual-Assignment (Single-Writer Architecture)
- **Nguyên nhân gốc:** Khi VNPay gửi IPN thành công, `payments.service.ts` vừa gọi callback legacy `autoAssignStaffForPaidBooking` trực tiếp, vừa phát event outbox `booking.assignment.requested` cho worker gọi `assignOnce`. Hai thuật toán chọn người khác nhau chạy song song, gây xung đột người phụ trách, ghi đè dữ liệu và làm sai lệch chỉ tiêu 40/120 phút.
- **Giải pháp triển khai:**
  1. Tại `payments.service.ts`: Loại bỏ hoàn toàn tham số callback phân công legacy khi gọi `finalizeSuccess`. Toàn bộ quy trình xác minh VNPay, chữ ký, bảo vệ double-charge và commit hold COMMITTED được bảo toàn 100%.
  2. Tại `booking-assignment.service.ts` (`assignOnce`):
     - Bổ sung chốt kiểm tra tính hợp lệ: Chỉ cho phép phân công đơn ở trạng thái `PENDING` hoặc `CONFIRMED`.
     - Với đơn đặt phòng trực tuyến (website): Bắt buộc kiểm tra giao dịch đã có `PAID` và tồn kho hold đã `COMMITTED`. Nếu chưa thanh toán hoặc bị hủy, từ chối phân công với lý do rõ ràng.
     - Cơ chế bảo toàn đơn cũ (**Legacy Import**): Nếu booking cũ đã có `handled_by` nhưng chưa có state trong hệ thống mới, hệ thống tự động import bản ghi lịch sử `LEGACY_IMPORT` và khởi tạo state mà **tuyệt đối không ghi đè hoặc đổi sang người khác**.
     - Khi phân công thành công: Đồng bộ nguyên tử cả 3 trường `booking.handledBy`, `booking.assignmentType` và `booking.assignmentNote`.
  3. Tại `repairUnassignedPaidBookings`: Thêm điều kiện INNER JOIN với `payment_transactions (PAID)` và `booking_holds (COMMITTED)` để không quét nhầm đơn chưa thanh toán hoặc đơn hủy.

### 2.3. FIX-03 (P0-02, P0-05, P0-07, P1-21): Siết chặt Phân quyền RBAC và Giới hạn Khách Sạn (Cross-Hotel Scoping)
- **Nguyên nhân gốc:** Nhiều endpoint mới chỉ khai báo `JwtAuthGuard` chung chung, không xác minh quyền hạn của tài khoản đối với khách sạn hoặc đơn đặt phòng tương ứng, dẫn tới nguy cơ lộ thông tin nhân sự và dữ liệu khách hàng.
- **Giải pháp triển khai:**
  1. `BookingAssignmentController`:
     - `GET :bookingId/history`: Yêu cầu `@CurrentUser()`. Nếu là `CUSTOMER`, chỉ được xem booking của chính mình và hệ thống tự động ẩn email cá nhân của nhân sự (`staffEmail: null`). Nếu là `EMPLOYEE`, bắt buộc phải có quan hệ công tác `ACTIVE` tại khách sạn của booking đó.
     - `POST :bookingId/assign`: Giới hạn nghiêm ngặt chỉ Quản trị viên (`ADMIN`) hoặc Quản lý (`MANAGER`) đang `ACTIVE` tại đúng khách sạn của booking mới được kích hoạt.
     - `POST repair`: Thu hồi quyền của người dùng thông thường, chuyển thành API đặc quyền nội bộ chỉ dành cho `ADMIN`.
  2. `BookingPresenceController`:
     - `GET :bookingId/timeline`: Bắt buộc kiểm tra quyền sở hữu (Customer) hoặc quyền công tác tại khách sạn (Staff).
     - `GET hotel/:hotelId/arrivals`: Bắt buộc nhân viên thao tác phải thuộc đúng khách sạn `:hotelId`.
     - `POST :bookingId/mark-no-show`: Bắt buộc nhân sự thao tác phải có chức vụ `MANAGER` hoặc `ADMIN` tại đúng khách sạn của booking.
  3. `StaffAvailabilityController`:
     - `GET check/:hotelId/:staffUserId`: Nhân viên cùng khách sạn xem được trạng thái khả dụng (`available: boolean`), nhưng lý do nghỉ/đi muộn (`activeBlock`) được che giấu bảo mật (redaction); chỉ Quản lý, Admin hoặc chính người nộp đơn mới được xem chi tiết lý do.

### 2.4. FIX-04 (P0-05, P0-06): Chặn mọi cửa sau No-Show sai thời hạn & Thống nhất State Machine
- **Nguyên nhân gốc:** API cũ `PATCH /bookings/:id/status` cho phép đổi sang `NO_SHOW` và `CLOSED_NO_SHOW` mà không kiểm tra thời gian ân hạn hoặc giờ trả phòng, tạo ra "cửa sau" làm sai lệch doanh thu và tước đoạt quyền nhận phòng muộn của khách hàng. Đồng thời `updateStatus` cũ tự ý gán `handledBy = changedByUserId`.
- **Giải pháp triển khai:**
  1. Loại bỏ hoàn toàn việc tự gán `handledBy` ngầm trong `BookingsService.updateStatus`.
  2. Đặt khóa bi quan `lock: { mode: 'pessimistic_write' }` cho booking trong `updateStatus`.
  3. Đồng bộ quy tắc chuyển trạng thái No-show trên cả API cũ và service mới:
     - Chuyển `NO_SHOW`: Bắt buộc `now >= checkInAt + noShowGraceMinutes` (mặc định 360 phút = 6 giờ) và `now < checkOutAt`, đồng thời khách chưa từng check-in (`actualCheckInAt IS NULL`). Nếu chưa hết hạn ân hạn, lập tức ném lỗi `ConflictException (409)` kèm thông báo số phút còn lại.
     - Chuyển `CLOSED_NO_SHOW`: Bắt buộc `now >= checkOutAt` và khách chưa từng check-in. Nếu chưa hết kỳ lưu trú, từ chối bằng lỗi `ConflictException (409)`.
     - Chuyển `COMPLETED`: Bắt buộc khách đã làm thủ tục nhận phòng thực tế (`actualCheckInAt !== null`).
  4. Hỗ trợ toán tử nullish coalescing `noShowGraceMinutes ?? 360` để tôn trọng cấu hình thời gian ân hạn bằng 0 khi khách sạn có chính sách đặc thù.

### 2.5. FIX-05 (P0-08, P1-28): Đồng bộ nguyên tử khi Quản Lý Reassign (A -> B)
- **Nguyên nhân gốc:** Khi quản lý đổi nhân viên từ A sang B qua `PATCH /bookings/:id/reassign`, hệ thống cũ chỉ sửa trường `bookings.handled_by`, bỏ quên `booking_assignments` và `booking_assignment_state`. Khi worker chạy hoặc retry, hệ thống nhìn vào state cũ và báo lệch trạng thái.
- **Giải pháp triển khai:**
  - Tích hợp xử lý toàn vẹn trong cùng transaction của `BookingsService.reassignStaff`:
    1. Đóng bản ghi phân công hiện tại của A bằng mốc `ended_at = now`.
    2. Thêm bản ghi `BookingAssignment` mới cho nhân viên B với `assignment_type = AssignmentType.MANUAL_OVERRIDE`, `previous_assignment_id = A.id`, `assigned_by = changedByUserId`, tăng `assignment_version`.
    3. Cập nhật `BookingAssignmentState`: trỏ `current_assignment_id` sang bản ghi mới của B, `current_staff_id = B`, tăng `version`.
    4. Cập nhật `booking.handledBy = B`, `booking.assignmentType = 'MANUAL'`, `booking.reassignedBy`, `booking.reassignedAt`.
    5. Lưu `BookingStatusLog` với `actorType: 'USER'`.
    6. Phát sự kiện Socket realtime thông báo nhân sự mới phụ trách đơn.

---

## 3. HOÀN THIỆN ĐIỂM NỐI FRONTEND & HỢP ĐỒNG API CONTRACT

1. **Bổ sung các trường hiện diện vào API lịch sử (P1-34):**
   - Đã cập nhật câu lệnh raw SQL trong `BookingsService.findByUser` và `findOne`: SELECT bổ sung đầy đủ `actual_check_in_at`, `actual_check_out_at`, `no_show_at`, `no_show_closed_at`, `late_arrival_expected_at`, `late_arrival_note`, `presence_version`.
   - Giúp giao diện khách hàng và chi tiết quản trị hiển thị chính xác mốc giờ check-in thực tế và giờ khách đã báo đến muộn.
2. **Chuẩn hóa DTO gửi thông báo đến muộn (P1-35):**
   - Đổi `@IsNotEmpty` thành `@IsOptional` cho trường `note` trong `LateArrivalNoticeDto`, tránh lỗi 400 Bad Request khi khách hàng chỉ chọn giờ đến mà không điền ghi chú.
3. **Mở rộng nút báo đến muộn cho đơn PENDING/CONFIRMED (P1-36):**
   - Trên giao diện `BookingHistory.tsx`: Hiển thị thẻ thông báo kế hoạch nhận phòng và nút "Báo dự kiến đến muộn / Cập nhật giờ đến" cho các đơn `CONFIRMED` hoặc `PENDING` đã thanh toán, giúp khách báo trước khi bị chuyển thành No-show.
4. **Khắc phục lỗi lệch 7 giờ múi giờ (Timezone Offset) (P1-37):**
   - Bổ sung helper `toLocalDatetimeInput` chuyển đổi chính xác mốc thời gian ISO sang định dạng `YYYY-MM-DDTHH:mm` theo giờ địa phương của trình duyệt thay vì cắt chuỗi `.toISOString().slice(0, 16)` của UTC.
   - Giờ đến muộn của khách và giới hạn `min`/`max` trên modal hoạt động chính xác tuyệt đối.
5. **Chuẩn hóa điều kiện M4 Lễ tân VIP (P1-12):**
   - Trong `assignment-policy.ts`: Sửa điều kiện `yearsExp >= 1 && skillLevel >= 2` thay vì toán tử `||`, bảo đảm nhân viên nhận phòng VIP phải có tối thiểu 1 năm kinh nghiệm thực chiến.
6. **Tự động đối soát đơn quá hạn trả phòng chưa từng nhận phòng (P1-47):**
   - Bổ sung tác vụ `processOverdueUnmarkedArrivals` trong `PresenceSchedulerService`: tự động phát hiện và chuyển đổi hợp lệ các đơn quá hạn trả phòng mà chưa được xử lý No-show về trạng thái `CLOSED_NO_SHOW`.

---

## 4. BẢO VỆ 8 HỢP ĐỒNG BẤT BIẾN (NON-REGRESSION CONTRACTS)

| ID | Hợp đồng bắt buộc | Bằng chứng bảo toàn trong source |
|---|---|---|
| `SAFE-01` | Tạo checkout session -> `PAYMENT_PENDING` -> giữ phòng `HELD` (15p) | Không thay đổi bất kỳ dòng code nào trong `CheckoutService`, `RoomAvailabilityService` hay cách tính giá. |
| `SAFE-02` | Xác minh VNPay IPN/QueryDR, chống thanh toán trùng, đối soát | `PaymentFinalizerService` giữ nguyên 100% logic xác minh tiền, chữ ký, `payment.paid` outbox. |
| `SAFE-03` | `PAID` -> hold `COMMITTED`; No-show KHÔNG nhả phòng | Trạng thái `NO_SHOW` tuyệt đối không gọi `releaseHold`; giữ nguyên suất phòng cho khách đến hết kỳ. |
| `SAFE-04` | Hủy phòng và hoàn tiền | Không can thiệp `CancellationsService` hay `RefundService`; No-show không tự ý hoàn tiền. |
| `SAFE-05` | API cũ `PATCH /bookings/:id/status` | Giữ nguyên URL, DTO `{status, note}` và response structure; chỉ siết chặt kiểm tra thời hạn và lock. |
| `SAFE-06` | API cũ `PATCH /bookings/:id/reassign` | Giữ nguyên URL, DTO và response `{message, booking, staff}`; đồng bộ nguyên tử state bên trong. |
| `SAFE-07` | Đơn tại quầy / qua điện thoại (`WALK_IN`, `PHONE`) | Không bắt buộc VNPay `PAID` đối với đơn tạo tại quầy (`createFrontDeskBooking` giữ nguyên hoạt động). |
| `SAFE-08` | Dữ liệu DB hiện hữu | Không DROP bảng, không đổi kiểu dữ liệu; chỉ cập nhật entity tương thích với schema migration có sẵn. |

---

## 5. KẾT QUẢ KIỂM THỬ & CHỨNG NHẬN BUILD

### 5.1. Kết quả kiểm thử Backend (Jest)
Chạy lệnh kiểm thử toàn bộ hệ thống:
```bash
npm --prefix /Users/dangquangminh/cg_traveleke_service/backend test
```
**Kết quả:**
- **Test Suites:** `16 passed, 16 total`
- **Tests:** `115 passed, 115 total`
- **Thời gian chạy:** 3.472 giây
- **Chi tiết các suite trọng tâm:**
  - `src/booking-presence/booking-presence.service.spec.ts`: `14 passed` (bao gồm test FK system actor, time grace check, permission check).
  - `src/booking-assignment/assignment-policy.spec.ts`: `12 passed` (bao gồm test M4 VIP threshold, trượt 40/120 phút).
  - `src/bookings/bookings.service.spec.ts`: `5 passed` (bao gồm test chặn No-show sai hạn, check-out không hợp lệ, reassign scoping).
  - `src/staff-availability/staff-availability.service.spec.ts`: `passed`.

### 5.2. Kết quả Build Backend (NestJS)
```bash
npm --prefix /Users/dangquangminh/cg_traveleke_service/backend run build
```
**Kết quả:** `Exit code 0` — Biên dịch TypeScript NestJS sạch sẽ, không có lỗi cú pháp hay thiếu import.

### 5.3. Kết quả Build Frontend (Next.js 16 + Turbopack)
```bash
npm --prefix /Users/dangquangminh/cg_traveleke_app run build
```
**Kết quả:**
- Pipeline tokens Design System: `Success`
- TypeScript Compilation: `Finished TypeScript in 2.7s` (0 errors)
- Tạo trang tĩnh: `31/31 static routes generated`
- Critical CSS Pipeline: `Saved 82.3% render-blocking CSS`
- **Trạng thái:** `Exit code 0` thành công 100%.

---

## 6. DANH SÁCH FILE ĐÃ THAY ĐỔI

### Backend (`cg_traveleke_service`):
1. `backend/src/bookings/entities/booking-status-log.entity.ts`: Thêm `actorType`, cho phép `changedBy` nullable.
2. `backend/src/booking-presence/booking-presence.service.ts`: Sửa `changedBy: null` cho system actor, kiểm tra ân hạn No-show thủ công, bổ sung realtime check-out/no-show, siết quyền timeline/arrivals.
3. `backend/src/booking-presence/presence-scheduler.service.ts`: Sử dụng `?? 360`, bổ sung `processOverdueUnmarkedArrivals`.
4. `backend/src/booking-presence/booking-presence.controller.ts`: Phân quyền `MANAGER`/`ADMIN` cho manual No-show, kiểm tra quan hệ khách sạn cho timeline và arrivals.
5. `backend/src/booking-presence/dto/late-arrival-notice.dto.ts`: Cho phép `note` tùy chọn (`@IsOptional()`).
6. `backend/src/payments/payments.service.ts`: Ngắt callback phân công cũ tại IPN thành công (đảm bảo single-writer).
7. `backend/src/booking-assignment/booking-assignment.controller.ts`: Phân quyền RBAC cho history, manual assign và repair.
8. `backend/src/booking-assignment/booking-assignment.service.ts`: Thêm gate kiểm tra `PAID + COMMITTED`, import bảo toàn legacy owner, đồng bộ mirror note/type, siết quyền history/manual trigger.
9. `backend/src/booking-assignment/assignment-policy.ts`: Chuẩn hóa M4 VIP (`yearsExp >= 1 && skillLevel >= 2`).
10. `backend/src/bookings/bookings.service.ts`: Bổ sung actual/presence fields vào `findByUser` và `findOne`, đồng bộ nguyên tử assignment state trong `reassignStaff`, siết chặt điều kiện chuyển trạng thái No-show và check-out trong `updateStatus`.
11. `backend/src/bookings/bookings.controller.ts`: Truyền `@CurrentUser()` cho `getAvailableStaff`.
12. `backend/src/staff-availability/staff-availability.controller.ts`: Che giấu lý do vắng mặt nhạy cảm cho nhân viên thường.
13. `backend/src/staff-availability/staff-availability.service.ts`: Thêm helper kiểm tra staff/manager tại khách sạn.
14. Unit test suites: `booking-presence.service.spec.ts`, `bookings.service.spec.ts`, `assignment-policy.spec.ts`.

### Frontend (`cg_traveleke_app`):
1. `src/components/booking/BookingHistory.tsx`: Mở CTA báo đến muộn cho đơn `PENDING`/`CONFIRMED`, sửa lỗi lệch 7 giờ múi giờ qua helper `toLocalDatetimeInput`.

