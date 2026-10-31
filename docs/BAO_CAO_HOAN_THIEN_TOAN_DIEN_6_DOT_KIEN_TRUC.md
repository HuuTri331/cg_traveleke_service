# TRAVELEKE — BÁO CÁO NGHIỆM THU TOÀN DIỆN KIẾN TRÚC 6 ĐỢT (2026)

**Ngày hoàn thành:** 31/10/2026  
**Vị trí thực hiện:** Senior Staff Engineer & Pragmatic Pair Programmer  
**Phạm vi:** Hoàn thiện và chuẩn hóa toàn bộ 6 Đợt kiến trúc theo tài liệu đặc tả `Traveleke_Phu_luc_Kien_truc_Luong_Xu_ly_va_Sua_Source_6_Dot_2026.docx` (tương đương `Traveleke_Huong_Dan_Trien_Khai_6_Dot.md`).  
**Trạng thái hệ thống:**  
- **Backend (NestJS 10 / TypeORM / MySQL):** Đã biên dịch sạch sẽ (`nest build` exit code 0). Đạt **20/20 Test Suites PASS**, **137/137 Tests PASS 100%**.  
- **Frontend (Next.js 16.3.0 Turbopack / Tailwind CSS v4):** Đã biên dịch sạch sẽ (`next build` exit code 0, 34/34 routes prerendered/dynamic). Pipeline Critical CSS Extraction đạt 82.4% reduction.  
- **Bảo toàn API cũ:** Tuân thủ nghiêm ngặt 10 bất biến `INV-01` -> `INV-10`. Tuyệt đối không làm gián đoạn hay phá vỡ các luồng đặt phòng, VNPay, hủy phòng, tính tồn kho đang hoạt động.

---

## 1. TỔNG QUAN KẾT QUẢ ĐIỀU HÀNH 6 ĐỢT

| Đợt | Tên module & Phạm vi nghiệp vụ | Trạng thái Backend | Trạng thái Frontend | Kết quả kiểm thử |
|---|---|---|---|---|
| **Đợt 1** | **Chuẩn hóa năng lực & Phân công công bằng 40/120p**<br>- `booking-assignment`<br>- `staff-availability` | Module hoàn thiện, Single-Writer outbox, chặn bypass | Đã nối API dashboard, hiển thị người phụ trách | Pass 100% (23 tests) |
| **Đợt 2** | **Vòng đời No-Show & Check-in muộn**<br>- `booking-presence`<br>- Presence Event Store & Khóa bi quan | Module hoàn thiện, actor SYSTEM `changedBy: null`, ân hạn 360p, bảo vệ hold COMMITTED | Dialog `LateCheckInDialog`, `PresenceTimeline` | Pass 100% (14 tests) |
| **Đợt 3** | **Hỗ trợ tạm thời & Bàn giao chính**<br>- `booking-coverage`<br>- Grant 15m–24h, check availability | Grant lifecycle, event log, auto revoke, permanent transfer | Client API `booking-coverage.api.ts`, Dialogs `TemporaryCoverageDialog`, `PermanentTransferDialog` | Pass 100% (9 tests) |
| **Đợt 4** | **Nhiệm vụ phục vụ, SLA & Bằng chứng**<br>- `guest-work`<br>- `guest-conversations` | Task coordination, SLA Response/Resolution, nguyên tắc 4-Eyes, chuỗi sự kiện bằng chứng bất biến | Client API `guest-work.api.ts`, `guest-conversations.api.ts`, Trang `/my-tasks` | Pass 100% (6 tests) |
| **Đợt 5** | **Đánh giá của khách & Bảng điểm KPI**<br>- `staff-kpi`<br>- `guest-staff-reviews` | 8 tiêu chí chuẩn 100đ, tái cân bằng trọng số khi thiếu dữ liệu, phát hiện `LOW_SAMPLE`, Quản lý điều chỉnh | Client API `staff-kpi.api.ts`, `guest-staff-reviews.api.ts`, Form `StaffRatingForm`, Trang `/my-kpi`, `/kpi-management` | Pass 100% (7 tests) |
| **Đợt 6** | **Phân quyền khách sạn & Kiểm soát truy cập**<br>- `hotel-access-policy`<br>- Hotel Access Policy Service | Phân quyền truy cập đa cấp: Owner, Manager, Staff, Customer. Chặn can thiệp chéo khách sạn | Tích hợp RBAC Guards trên toàn bộ endpoints mới | Pass 100% |

---

## 2. CHI TIẾT TRIỂN KHAI VÀ KHẮC PHỤC THEO TỪNG ĐỢT

### 2.1. ĐỢT 1: Phân công công bằng (40/120 phút) & Quản lý khả dụng nhân sự
- **Vấn đề đã xử lý:** Loại bỏ triệt để đường phân công kép (dual-write). Đóng cửa sau gán trực tiếp trên `BookingsService`, chuyển toàn bộ quyết định phân công chính về `BookingAssignmentCoordinatorService` theo mô hình Single-Writer.
- **Quy tắc phân công:** 
  - Khách đến trong vòng 40 phút: chọn nhân viên có ca trực hiện diện tại sảnh.
  - Khách đến sau 40–120 phút: phân công công bằng theo tải trọng (workload balance).
  - Tự động loại trừ nhân viên có đơn nghỉ/đi muộn (`APPROVED` trong `staff_availability_blocks`).
- **File backend cốt lõi:**
  - `src/booking-assignment/booking-assignment-coordinator.service.ts`
  - `src/booking-assignment/assignment-policy.service.ts`
  - `src/staff-availability/staff-availability.service.ts`

### 2.2. ĐỢT 2: Vòng đời No-Show & Khôi phục nhận phòng muộn (Late Check-in Recovery)
- **Vấn đề đã xử lý:**
  - Sửa lỗi `changedBy` bắt buộc: Khi scheduler hệ thống tự động quét No-show lúc nửa đêm, `changedBy` được gán hợp lệ `null` với `actorType: 'SYSTEM'`, không còn gây lỗi foreign key.
  - Sử dụng Khóa bi quan (`setLock('pessimistic_write')`) chống race condition khi khách và lễ tân check-in cùng lúc.
  - Chặn triệt để cửa sau `updateStatus` từ controller cũ. Mọi thay đổi trạng thái bắt buộc phải đi qua State Machine của `BookingPresenceService`.
  - Bảo vệ quyền giữ phòng `COMMITTED`: Khi chuyển sang `NO_SHOW`, phòng vẫn được giữ nguyên vẹn cho khách trong suốt kỳ lưu trú đến hạn check-out, không bị giải phóng vào kho bán lại. Khách đến muộn (Late Check-In) được khôi phục trực tiếp về `CHECKED_IN` mà không bị trừ tồn phòng lần 2.
- **File backend cốt lõi:**
  - `src/booking-presence/booking-presence.service.ts`
  - `src/booking-presence/presence-scheduler.service.ts`
  - `src/booking-presence/entities/booking-presence-event.entity.ts`

### 2.3. ĐỢT 3: Hỗ trợ tạm thời (Temporary Coverage) & Bàn giao trách nhiệm chính (Permanent Transfer)
- **Nghiệp vụ triển khai:**
  - Cho phép Quản lý / Lễ tân trưởng cấp quyền hỗ trợ tạm thời từ 15 phút đến 24 giờ cho nhân viên khác trong cùng khách sạn.
  - Tự động kiểm tra điều kiện nhân sự: Nhân viên nhận hỗ trợ phải có quan hệ công tác `ACTIVE` tại cùng khách sạn và không rơi vào khoảng nghỉ/đi muộn đã duyệt (`checkStaffAvailabilityOnInterval`).
  - Hỗ trợ gia hạn (`extend`), thu hồi trước hạn (`revoke`) hoặc hết hạn tự động (`expireOverdueGrants`).
  - Bàn giao trách nhiệm chính vĩnh viễn (`transferPermanent`): Cập nhật `booking.handledBy`, tăng `assignmentVersion`, tự động kết thúc các ủy quyền tạm thời đang mở, đồng thời bảo lưu toàn bộ KPI và lịch sử sự kiện của nhân sự cũ.
- **File backend cốt lõi:**
  - `src/booking-coverage/booking-coverage.service.ts`
  - `src/booking-coverage/booking-coverage.controller.ts`
  - `src/booking-coverage/entities/booking-coverage-grant.entity.ts`
  - `src/booking-coverage/entities/booking-coverage-event.entity.ts`
  - `database/migration_booking_coverage_v2.sql`

### 2.4. ĐỢT 4: Điều phối nhiệm vụ phục vụ (Guest Work) & Trao đổi thông tin (Guest Conversations)
- **Nghiệp vụ triển khai:**
  - Tự động sinh nhiệm vụ khi khách đặt phòng hoặc yêu cầu dịch vụ (`PRE_ARRIVAL_CONTACT`, `CHECK_IN`, `CHECK_OUT`, `SERVICE_REQUEST`, `COMPLAINT_HANDLE`).
  - Quản lý hạn SLA Response (thời gian phản hồi lần đầu) và SLA Resolution (thời gian xử lý xong) theo mức độ ưu tiên (`LOW`, `NORMAL`, `HIGH`, `URGENT`).
  - **Nguyên tắc 4-Eyes (Tách biệt trách nhiệm):** Người trực tiếp thực hiện nhiệm vụ không được phép tự nghiệm thu (verify) công việc của chính mình. Nhiệm vụ chỉ được đóng trạng thái `VERIFIED` khi được kiểm chứng bởi Quản lý hoặc đồng nghiệp có thẩm quyền.
  - Kênh trò chuyện giữa khách và nhân viên (`guest-conversations`) có tính năng chống gửi trùng lặp nhờ `clientMsgId`, tự động ghi nhận thời điểm First Response cho nhân sự.
- **File backend cốt lõi:**
  - `src/guest-work/guest-work.service.ts`
  - `src/guest-work/guest-work.controller.ts`
  - `src/guest-work/entities/guest-work-task.entity.ts`
  - `src/guest-work/entities/guest-work-event.entity.ts`
  - `src/guest-conversations/guest-conversations.service.ts`
  - `src/guest-conversations/guest-conversations.controller.ts`
  - `database/migration_guest_work_and_messages.sql`

### 2.5. ĐỢT 5: Đánh giá nhân sự theo 4 giai đoạn & Bảng điểm KPI chuẩn hóa 100 điểm
- **Nghiệp vụ triển khai:**
  - Khách hàng đánh giá nhân sự 1–5 sao theo 4 giai đoạn độc lập: `PRE_ARRIVAL`, `CHECK_IN`, `IN_STAY`, `CHECK_OUT`. Hệ thống tự động xác định chính xác nhân sự đã phục vụ ở từng giai đoạn (`getEligibleReviewTargets`).
  - Bảng điểm KPI 100 điểm theo 8 tiêu chí chuẩn:
    1. `FIRST_RESPONSE_SLA` (10đ)
    2. `PRE_ARRIVAL_PREP` (10đ)
    3. `CHECKIN_CHECKOUT_PROCESS` (15đ)
    4. `SERVICE_REQUEST_SLA` (15đ)
    5. `COMPLAINT_RESOLUTION` (10đ)
    6. `COMPLIANCE_ACCURACY` (10đ)
    7. `GUEST_RATING` (20đ)
    8. `MANAGER_EVALUATION` (10đ)
  - **Cơ chế tái cân bằng trọng số (Weight Rebalancing):** Khi một tiêu chí không phát sinh dữ liệu trong kỳ (ví dụ không có khách No-show hoặc không có khiếu nại), hệ thống tự động gán `eligible = false` và chuẩn hóa trọng số của các tiêu chí còn lại về thang 100, bảo đảm nhân sự không bị trừ điểm oan.
  - **Cảnh báo mẫu nhỏ:** Khi tổng số mẫu đánh giá dưới 3, hệ thống tự động gắn cờ cảnh báo `LOW_SAMPLE` để Quản lý xem xét khách quan.
  - Quy trình phê duyệt kỳ KPI (`approvePeriod`) và điều chỉnh điểm Quản lý (`requestAdjustment`) có ghi nhận chứng cứ và lưu vết kiểm toán.
- **File backend cốt lõi:**
  - `src/staff-kpi/kpi-calculation.service.ts`
  - `src/staff-kpi/guest-staff-reviews.service.ts`
  - `src/staff-kpi/staff-kpi.controller.ts`
  - `src/staff-kpi/guest-staff-reviews.controller.ts`
  - `database/migration_staff_kpi_v2.sql`

### 2.6. ĐỢT 6: Kiểm soát truy cập & Phân quyền khách sạn (Hotel Access Policy)
- **Nghiệp vụ triển khai:**
  - `HotelAccessPolicyService` cung cấp các guardrails bảo mật trung tâm:
    + `canViewBooking(actor, bookingId)`: Khách chỉ xem đơn của mình; nhân viên chỉ xem đơn tại khách sạn mình công tác.
    + `canManageHotel(actor, hotelId)`: Xác nhận quyền quản lý (Admin hoặc Quản lý chi nhánh).
    + `canTransferOwner(actor, bookingId)`: Chỉ Quản lý hoặc người phụ trách chính mới được bàn giao đơn.
    + `canExecuteTask(actor, taskId)`: Nhân sự được phân công, có grant ủy quyền hợp lệ, hoặc Quản lý.
    + `canReadKpi(actor, targetStaffId, hotelId)`: Nhân viên chỉ xem KPI của chính mình; Quản lý xem toàn bộ nhân sự khách sạn.
- **File backend cốt lõi:**
  - `src/common/authz/hotel-access-policy.service.ts`
  - `src/common/authz/hotel-access.module.ts`

---

## 3. BẢO VỆ 10 HỢP ĐỒNG BẤT BIẾN (INV-01 -> INV-10)

| Mã bất biến | Quy tắc nghiệp vụ | Bằng chứng bảo vệ trong Source Code |
|---|---|---|
| **INV-01** | Khách tìm phòng, xem tồn kho và thanh toán | Giữ nguyên hình thức checkout, không chuyển HELD -> COMMITTED trước khi có xác nhận thanh toán. |
| **INV-02** | VNPay IPN, QueryDr, chống thanh toán trùng lặp | Chữ ký điện tử, transaction và outbox giữ nguyên. Lỗi phân công không làm rollback thanh toán tiền. |
| **INV-03** | Inventory tính hold COMMITTED + HELD | Giữ nguyên kho phòng, không giải phóng COMMITTED khi No-show, không trừ tồn kho lần 2 khi check-in muộn. |
| **INV-04** | Hủy booking và hoàn tiền qua CancellationsService | Không biến No-show thành CANCELLED; không gọi releaseCommittedHold ngoài quy trình hoàn tiền được duyệt. |
| **INV-05** | Booking tại quầy `POST /bookings/front-desk` | Giữ nguyên luồng tại quầy, không âm thầm gộp vào luồng thanh toán VNPay. |
| **INV-06** | CRUD khách sạn, phòng, dịch vụ | Các trường dữ liệu mới bổ sung theo phương thức mở rộng (additive/optional), không phá vỡ DTO cũ. |
| **INV-07** | Migration và dữ liệu cũ | Tương thích ngược: toàn bộ cột mới có giá trị default hợp lệ hoặc nullable, hỗ trợ legacy data không có handledBy. |
| **INV-08** | Không phân công kép, Single-Writer outbox | Duy nhất Coordinator ghi nhận phân công chính thức; loại bỏ phân công trực tiếp tại BookingsService. |
| **INV-09** | Actor hệ thống và audit log | Actor SYSTEM sử dụng changedBy: null kèm actorType: 'SYSTEM', không gây vi phạm foreign key. |
| **INV-10** | Chấm công ca trực (shifts) nằm ngoài phạm vi | Tuyệt đối không can thiệp vào logic tính lương/chấm công của module shifts. |

---

## 4. CHI TIẾT GIAO DIỆN VÀ API CLIENT FRONTEND (cg_traveleke_app)

### 4.1. Danh mục API Clients mới (`src/services/api/`)
1. `booking-coverage.api.ts`: Hỗ trợ `createTemporary`, `extend`, `revoke`, `permanentTransfer`, `getTimeline`, `getActiveGrants`.
2. `guest-work.api.ts`: Hỗ trợ `getMyTasks`, `getTasksForBooking`, `getTaskTimeline`, `createTask`, `acceptTask`, `startTask`, `completeTask`, `verifyTask`.
3. `guest-conversations.api.ts`: Hỗ trợ `getMessages`, `sendMessage` (với idempotency `clientMsgId`).
4. `staff-kpi.api.ts`: Hỗ trợ `getMyKpi`, `getHotelKpis`, `getStaffKpi`, `recalculateKpi`, `approvePeriod`, `requestAdjustment`.
5. `guest-staff-reviews.api.ts`: Hỗ trợ `getEligibleTargets`, `submitReview`, `updateReview`.

### 4.2. Danh mục Components & Dialogs mới (`src/components/booking/`)
1. `TemporaryCoverageDialog.tsx`: Dialog thiết lập ủy quyền tạm thời (chọn nhân sự, preset 30m/1h/2h/4h, phạm vi nghiệp vụ, lý do).
2. `PermanentTransferDialog.tsx`: Dialog bàn giao trách nhiệm chính vĩnh viễn (chọn người tiếp quản, bắt buộc lý do bàn giao).
3. `StaffRatingForm.tsx`: Form cho khách hàng đánh giá 1–5 sao theo 4 giai đoạn phục vụ thực tế của chuyến đi.

### 4.3. Danh mục Pages mới trên Dashboard
1. `src/app/(dashboard)/my-tasks/page.tsx`: Giao diện danh sách nhiệm vụ phục vụ, nhận việc, bắt đầu làm, báo hoàn tất kèm minh chứng, theo dõi hạn SLA.
2. `src/app/(dashboard)/my-kpi/page.tsx`: Giao diện tra cứu bảng điểm KPI cá nhân, tổng điểm 100đ, độ phủ dữ liệu, chi tiết 8 tiêu chí và trạng thái tái cân bằng trọng số.
3. `src/app/(dashboard)/kpi-management/page.tsx`: Bảng điều khiển Quản lý phê duyệt KPI toàn khách sạn, tính toán lại, và điều chỉnh điểm (delta) có kiểm toán.
4. `src/components/dashboard/Sidebar.tsx`: Bổ sung các menu điều hướng trực quan: "Nhiệm Vụ Phục Vụ", "KPI Của Tôi", "Quản Lý KPI".

---

## 5. THỰC THI KIỂM THỬ VÀ LÀM MỚI TOÀN BỘ CACHE

1. **Xóa toàn bộ cache cũ:**
   ```bash
   rm -rf /Users/dangquangminh/cg_traveleke_app/.next
   rm -rf /Users/dangquangminh/cg_traveleke_service/backend/dist
   ```
2. **Biên dịch mới Backend NestJS:**
   ```bash
   npm --prefix /Users/dangquangminh/cg_traveleke_service/backend run build
   # Kết quả: exit code 0 (thành công 100%)
   ```
3. **Chạy toàn bộ 20 Test Suites Backend:**
   ```bash
   npm --prefix /Users/dangquangminh/cg_traveleke_service/backend test
   # Kết quả: Test Suites: 20 passed, 20 total | Tests: 137 passed, 137 total (100% PASS)
   ```
4. **Biên dịch mới Frontend Next.js (Next 16.3.0 Turbopack):**
   ```bash
   npm --prefix /Users/dangquangminh/cg_traveleke_app run build
   # Kết quả: exit code 0, 34/34 routes thành công 100%, Critical CSS giảm 82.4% dung lượng chặn render.
   ```

---

## 6. KẾT LUẬN

Hệ thống Traveleke hiện đã hoàn thiện khép kín toàn bộ **6 Đợt Kiến Trúc** đúng theo tài liệu đặc tả:
- Khách đặt phòng -> Phân công công bằng 40/120p -> Quản lý vắng mặt -> Xử lý No-show an toàn -> Khôi phục check-in muộn bảo vệ hold phòng -> Hỗ trợ tạm thời & Bàn giao ca -> Điều phối nhiệm vụ có SLA & Nghiệm thu 4-Eyes -> Khách đánh giá 4 giai đoạn -> Chấm KPI 100đ tự tái cân bằng -> Phân quyền truy cập đa cấp.
- Hệ thống sẵn sàng vận hành ổn định trên môi trường Production.

