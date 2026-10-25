# TRAVELEKE — PHỤ LỤC KIẾN TRÚC, LUỒNG XỬ LÝ VÀ HƯỚNG SỬA SOURCE CODE CHI TIẾT

**Tài liệu bổ sung triển khai kỹ thuật cho 06 đợt phát triển**  
**Ngày:** 25/10/2026 | **Phiên bản:** 2.0 | **Loại tài liệu:** Technical implementation blueprint & non-regression plan  
**Đối chiếu:** `HuuTri331/cg_traveleke_service` — nhánh `minh` (backend NestJS/TypeORM/MySQL); `HuuTri331/cg_traveleke_app` — nhánh `minh` (frontend Next.js).  
**Dùng cùng tài liệu:** `Traveleke_Dac_ta_6_dot_Phan_cong_KPI_Checkin_2026.md` (đặc tả nghiệp vụ). Tài liệu này đi sâu vào **kiến trúc triển khai, đường đi dữ liệu, nhánh xử lý, sửa/tạo file, tích hợp và kiểm thử không phá vỡ luồng cũ**.

> **GIỚI HẠN TRIỂN KHAI.** Đây là tài liệu hướng dẫn thay đổi code, **chưa phải code đã sửa hoặc đã chạy kiểm thử trong hai repository**. Đường dẫn đánh dấu **[HIỆN CÓ]** được đối chiếu với source nhánh `minh`; đường dẫn **[TẠO MỚI]** là cấu trúc file đề nghị thêm, không khẳng định đang tồn tại. Không được thực hiện migration hay đổi nhánh mặc định trên hệ thống thật chỉ bằng việc sao chép tài liệu mà chưa kiểm tra schema thực tế.

---

## 0. CÁCH ĐỌC TÀI LIỆU VÀ PHẠM VI BẤT BIẾN

### 0.1. Mục tiêu kỹ thuật cuối cùng

Sau sáu đợt, một giao dịch thanh toán thành công phải tạo **đúng một quyền giữ phòng**, kích hoạt **đúng một quyết định phân công chính**; người phụ trách được chọn theo năng lực và công bằng thời gian 40/120 phút, có loại trừ khoảng nghỉ/đi muộn đã duyệt. Đơn được giữ phòng dù khách No-show, vẫn cho phép check-in muộn trong kỳ; nhân viên khác có thể **làm thay tạm thời** hoặc **nhận bàn giao hẳn** mà sự kiện/KPI cũ không mất. Các yêu cầu phục vụ, SLA, đánh giá sao và KPI đều có người thực hiện, thời điểm, minh chứng và quyền truy cập rõ ràng.

### 0.2. Các luồng cũ phải được bảo vệ

| Mã bất biến | Luồng đang có | Yêu cầu không hồi quy |
|---|---|---|
| INV-01 | Khách tìm khách sạn, xem phòng, kiểm tra tồn và tạo checkout session | Không thay đổi hình thức đặt/phụ phí và cách lấy giá. Không tự chuyển `HELD` thành `COMMITTED` trước khi VNPay xác nhận. |
| INV-02 | VNPay IPN, QueryDr/đối soát, retry payment, chống thanh toán trùng | Giữ chữ ký, kiểm tra giao dịch, transaction, `payment_transactions`, `booking_holds`, refund/outbox hiện có; phân công thất bại không được đảo ngược việc đã nhận tiền. |
| INV-03 | `InventoryService`: tính hold `COMMITTED` + hold `HELD` còn hạn theo khoảng chồng lấn | Không giải phóng `COMMITTED` do No-show, không trừ tồn lần thứ hai khi check-in muộn. |
| INV-04 | Hủy booking thanh toán và hoàn tiền qua `CancellationsService` | Không biến No-show thành CANCELLED, không tạo shortcut hoàn tiền, không gọi `releaseCommittedHold` ngoài quy trình hủy được duyệt. |
| INV-05 | Booking trực tiếp `POST /bookings/front-desk` | Giữ luồng tạo booking tại quầy/điện thoại hiện tại; xử lý khác biệt tồn phòng của nhánh này bằng kiểm thử/ticket độc lập, không âm thầm ghép thành VNPay. |
| INV-06 | CRUD khách sạn, phòng, ảnh, dịch vụ và snapshot giá | Thêm trường mới theo kiểu **additive** và DTO optional; không đổi hợp đồng JSON/đường dẫn cũ khi không cần thiết. |
| INV-07 | Đăng nhập, JWT refresh, phân vai `CUSTOMER/EMPLOYEE/ADMIN` | Không đổi token hiện có một cách đột ngột; vai trò nghiệp vụ quản lý/lễ tân xét **theo từng khách sạn** bằng `hotel_staff.staff_role`. |
| INV-08 | Realtime, email, thông báo thanh toán thành công/thất bại | Giữ tên event cũ, chỉ bổ sung event mới; việc gửi email/socket lỗi không được làm rollback giao dịch đã commit. |
| INV-09 | `services/requests`, SLA và service recovery | Giữ `ServiceRequestStatus` và đường dẫn request đang dùng, chỉ thêm người thực hiện/bằng chứng và kiểm tra quyền. |
| INV-10 | Code/DB chưa có module lịch ca hoạt động thống nhất | **Không lấy dữ liệu từ `shifts`, không sửa module xếp ca, không chấm công/tính lương** trong sáu đợt này. |

**Nguyên tắc triển khai:** chỉ sửa phần có liên quan; tạo module mới khi phù hợp; bổ sung adapter tại điểm nối hiện hữu; chạy kiểm thử trước và sau sửa; không xóa bảng/cột/trường JSON hoặc đổi ý nghĩa enum đã có mà không có kế hoạch tương thích. Hành vi cũ bị chứng minh là sai hoặc không an toàn (ví dụ lộ booking khác khách sạn) **được sửa bằng kiểm tra quyền bắt buộc**, nhưng phải bảo toàn hành vi hợp lệ của người dùng được phép.

### 0.3. Ký hiệu dùng trong danh mục file

- **[SỬA]**: File thực tế đã có tại nhánh `minh`, chỉ rõ hàm/điểm gắn cần thay đổi.
- **[TẠO]**: File/cấu trúc chưa có trong phạm vi đã kiểm tra, đề xuất mới.
- **[GIỮ]**: Không đụng đến hoặc chỉ viết test nhằm bảo vệ hành vi cũ.
- **[RÀ SOÁT]**: Cần chạy thử/đọc schema dữ liệu thật trước khi quyết định migration; không khẳng định tương thích chỉ từ entity.
- **P0/P1/P2**: Mức ưu tiên khi phân nhóm công việc, không phải ngày triển khai bắt buộc.

---

## 1. KIẾN TRÚC ĐÍCH: MỞ RỘNG THEO DOMAIN, KHÔNG ĐẬP ĐI LÀM LẠI

### 1.1. Đường đi tổng thể từ giao diện đến database

```text
TRÌNH DUYỆT
  Customer / Hotel Manager / Receptionist
      |
      v
Next.js app router (trang cũ + màn hình mới)
      |
      +-- src/services/api/*.api.ts  [giữ apiClient, refresh JWT, error handling]
      |
      v
NestJS Controllers + JwtAuthGuard + HotelAccessPolicy
      |
      +-- PaymentsModule --------------> PaymentFinalizer + InventoryService
      |                                      |
      |                                      +-- cùng transaction: PAID, COMMITTED, outbox
      |                                      v
      |                                 Outbox events
      |                                      |
      +-- BookingAssignmentModule <---------+-- worker: booking.assignment.requested
      |       +-- StaffEligibilityPolicy    |       (retry + idempotency)
      |       +-- AvailabilityPolicy        |
      |       +-- DispatchLockRepository    |
      |       +-- AssignmentHistory         |
      |
      +-- BookingPresenceModule  ---> NO_SHOW / CHECKED_IN / CLOSED_NO_SHOW
      |       +-- chỉ đọc hold để xác thực, không hủy hoặc commit lại
      |
      +-- StaffAvailabilityModule --> đơn nghỉ/đi muộn -> duyệt -> block thời gian
      |
      +-- BookingCoverageModule ----> thay tạm / chuyển hẳn -> nhật ký A/B
      |
      +-- ServicesModule + GuestWorkEvents --> service request / SLA / tác vụ
      |
      +-- StaffKpiModule ----------> tính điểm qua event bất biến + sao khách
      |
      v
MySQL: bảng cũ giữ nguyên + cột/bảng mới bằng migration additive
      |
      +--> outbox / audit / realtime sau commit
```

**Ranh giới phụ thuộc quan trọng:** `PaymentFinalizerService` **không** gọi ngược `BookingsService` để tính KPI, lịch nghỉ hay SLA. Nó chỉ xác nhận thanh toán và ghi sự kiện. Module phân công **không** import `PaymentsModule`; nhận bookingId và xác minh từ bảng booking/payment/hold. Module KPI **không** cập nhật booking hoặc tiền. Module No-show **không** gọi giải phóng hold. Nhờ đó giảm vòng lặp NestJS và không làm gãy payment.

### 1.2. Cách bố trí module đề nghị (backend)

```text
backend/src/
  common/authz/                  [TẠO] HotelAccessModule, HotelAccessPolicy
  staff-availability/            [TẠO] đơn xin nghỉ/đi muộn, quyết định duyệt, availability
  booking-assignment/            [TẠO] eligibility, dispatch, lock, history, repair
  booking-presence/              [TẠO] no-show, late check-in, actual presence
  booking-coverage/              [TẠO] temporary delegate / permanent transfer
  guest-work/                    [TẠO] task-event, evidence, SLA evidence adapter
  staff-kpi/                     [TẠO] review, scoring, period snapshot, adjustments
  bookings/                      [SỬA NHỎ] adapters, DTO/enum, response enrich
  payments/                      [SỬA NHỎ] ghi outbox sau xác nhận PAID
  workers/                       [SỬA] đăng ký handler cho outbox mới + scheduler
  hotel-staff/                   [SỬA NHỎ] scope và tra cứu ứng viên
  services/                      [SỬA NHỎ] gắn task events + tenant authorization
  rooms/                         [SỬA NHỎ] service_tier
  inventory/                     [GIỮ] thuật toán chống overbooking
  cancellations/                 [GIỮ] core refund; thêm regression tests
  shifts/                        [GIỮ NGUYÊN] ngoài phạm vi
  approvals/                     [GIỮ] luồng duyệt chi phí hiện có
  app.module.ts                  [SỬA] import các module độc lập mới
```

**Vì sao không tái sử dụng `approvals` để duyệt đơn nghỉ?** Trong source, `ApprovalRequestType` hiện gồm `REFUND`, `RATE_OVERRIDE`, `DISCOUNT`, `COMPLIMENTARY`, `SERVICE_RECOVERY`, có trường `amount`. Dồn đơn nghỉ vào đó sẽ làm loãng domain và có rủi ro ảnh hưởng duyệt tiền. Tạo module `staff-availability` riêng, tái sử dụng phong cách API/authorization chứ không sửa ý nghĩa approval cũ.

### 1.3. Những nguồn sự thật (single source of truth)

| Khái niệm | Nguồn sự thật | Không được làm |
|---|---|---|
| Đã thu tiền? | `payment_transactions.status = PAID` | Suy từ `booking.status` hoặc nội dung UI. |
| Đã giữ suất phòng? | `booking_holds.status = COMMITTED` và khoảng ngày | Suy từ cờ `CHECKED_IN`; tự cộng/trừ `rooms.available_rooms` cho No-show. |
| Ai phụ trách chính ngay bây giờ? | Bảng `booking_assignment_state` + mirror `bookings.handled_by` | Dựa vào booking status hoặc ai bấm nút gần nhất. |
| Ai đã thực hiện nhiệm vụ X? | `guest_work_events.actor_staff_id` / lịch sử tác vụ | Quy toàn bộ về người đang giữ `handled_by`. |
| A có thể nhận việc lúc T? | `users ACTIVE` + `hotel_staff ACTIVE` + availability blocks được duyệt | Chỉ nhìn trạng thái tài khoản; giả định ca trực. |
| Khách có mặt thực tế? | `booking_presence` và `actual_check_in_at` | Coi thông báo “Tôi sắp đến” của khách là check-in. |
| Điểm KPI kỳ tháng? | Snapshot có version + nguồn event/review | Chỉ cộng số từ bảng booking hiện hành hoặc cho sửa trực tiếp trong UI. |

### 1.4. Kiến trúc giao dịch, bất đồng bộ và khóa

**Nhóm A — thanh toán, giữ phòng:** giữ nguyên giao dịch hiện tại. Tại đường `PaymentFinalizerService.finalizeSuccess()` đã chuyển PAID/COMMITTED, ghi thêm **sự kiện outbox riêng `booking.assignment.requested`** khi bật tính năng mới. Tuyệt đối không kéo tác vụ tìm ứng viên/đơn nghỉ dài dòng vào đường quyết định thành công của VNPay; phân công có thể chạy sau commit. Sự kiện `payment.paid` hiện dùng gửi realtime **giữ nguyên**.

**Nhóm B — quyết định phân công:** worker lấy event mới, `BookingAssignmentService.assignOnce(bookingId)` mở transaction riêng, khóa hàng booking và hàng `hotel_assignment_dispatch_locks(hotel_id)` bằng `FOR UPDATE`, kiểm tra booking PAID + hold COMMITTED, đọc ứng viên và lịch sử 40/120 phút theo **thời gian server**, ghi kết quả + lịch sử + assignment-state **cùng một transaction**. Retry/dead-letter độc lập thanh toán; có job rà soát booking PAID chưa được giao sau một khoảng trễ.

**Nhóm C — hiện diện/chuyển giao/tác vụ:** mỗi command có transaction riêng theo booking/task, kiểm tra quyền ngay trong transaction và version lạc quan hoặc khóa hàng để tránh hai lễ tân cùng check-in. Ghi event và outbox thông báo sau ghi dữ liệu; tuyệt đối không gọi VNPay/refund ở đây.

**Nhóm D — KPI:** tính lại bất đồng bộ từ event immutable theo kỳ; mỗi kết quả có `calculation_version`, `evidence_count`, `snapshot_hash`, thời điểm tính và trạng thái DRAFT/APPROVED/LOCKED. KPI không được là nguyên nhân rollback booking, check-in hay service request.

### 1.5. Cơ chế bật/tắt từng phần (feature flags)

| Cấu hình | Mặc định giai đoạn triển khai | Khi bật |
|---|---|---|
| `FEATURE_ASSIGNMENT_V2` | `false` | Giao booking qua outbox và thuật toán 40/120, không tiếp tục nhánh auto-assign cũ cho booking mới. |
| `FEATURE_STAFF_AVAILABILITY` | `false` | Lọc theo đơn nghỉ/đi muộn đã duyệt; `false` nghĩa là ACTIVE theo quy tắc cũ. |
| `FEATURE_BOOKING_PRESENCE_V2` | `false` | Cho No-show, check-in muộn qua use case mới, legacy status endpoint phải chuyển tiếp đúng chính sách. |
| `FEATURE_BOOKING_COVERAGE` | `false` | Kích hoạt temporary coverage/permanent transfer, hiển thị nút tương ứng. |
| `FEATURE_GUEST_WORK_EVENTS` | `false` | Ghi thêm event vào yêu cầu dịch vụ, không làm gián đoạn service nếu event-worker tạm lỗi. |
| `FEATURE_STAFF_KPI_V2` | `false` | Hiển thị tính điểm mới; thống kê cũ vẫn có sẵn trong thời gian so sánh. |

**Quy tắc về cờ:** không dùng cờ để bỏ qua kiểm tra quyền hoặc an toàn dữ liệu. Rollback flag chỉ đổi tuyến điều khiển của hành vi mới; migration mới phải giữ khả năng đọc dữ liệu cũ. Nếu một feature có sự kiện đang chờ worker, cần quyết định xử lý/drain queue trước khi tắt.

### 1.6. Baseline, lộ trình PR và điểm dừng an toàn

1. Khóa commit đầu vào của hai repo ở thời điểm bắt đầu; tạo nhánh triển khai mới từ `minh`. Ghi checksum migration/schema, phiên bản Node và MySQL đang dùng; sao lưu database thử nghiệm đã ẩn dữ liệu riêng tư.
2. Chạy `cd backend && npm ci && npm run build && npm test -- --runInBand && npm run test:e2e` và `cd frontend && npm ci && npm run lint && npm run build`; lưu kết quả **trước sửa**. Nếu test đã đỏ, ghi baseline; không được tính lỗi có sẵn là lỗi mới nhưng phải xử lý trước khi release nếu thuộc tuyến P0.
3. PR loại 1: migration additive và model + unit tests. PR loại 2: domain service + adapters, flag off. PR loại 3: API + frontend flag off. PR loại 4: integration test + canary flag on. Mỗi đợt có rollback điều khiển và kiểm thử hồi quy.
4. Trước merge: so `git diff` với nhánh gốc; không tự đổi API public ngoài danh sách cho phép; không xóa câu lệnh anti-double-charge hoặc anti-overbooking; tối thiểu một reviewer kiểm tra tác động thanh toán.

---

## 2. HỢP ĐỒNG TÍCH HỢP CỐT LÕI VÀ NGUYÊN TẮC AN TOÀN

### 2.1. Sơ đồ nghiệp vụ tổng hợp

```text
[Khách chọn loại phòng] -> [Tạo checkout session] -> [HELD]
                                               |
                                         VNPay IPN/QueryDr
                                               |
                                  +------------+-----------+
                                  | PAID                    | FAILED/TIMEOUT
                                  v                         v
                      [hold COMMITTED]           [giữ logic cũ/release HELD]
                                  |
                    [outbox booking.assignment.requested]
                                  |
                     [worker: assignOnce + 40/120 + năng lực]
                                  |
                           [current receptionist]
                                  |
                   [pre-arrival task + availability updates]
                                  |
                   [đến hạn check-in] ----> [đến quầy?]
                                  |                  |
                                 không                có
                                  v                  v
                              [NO_SHOW] --------> [CHECKED_IN]
                                  |                  |
                        khách đến muộn?          [guest work/SLA]
                                  |                  |
                                  +--------------> [CHECKED_IN]
                                                     |
                                       [temporary cover A/B nếu cần]
                                                     |
                                        [check-out -> COMPLETED]
                                                     |
                                        [review + KPI by event actor]
```

**Không đồng nhất ba thời điểm:** booking được thanh toán, booking được phân công, khách check-in. Khoảng ngắn giữa PAID và phân công bất đồng bộ được hiển thị `ASSIGNMENT_PENDING`; khách vẫn có booking và suất phòng an toàn. Lỗi phân công dẫn tới `ASSIGNMENT_RETRY/CRITICAL`, không sửa `payment_status` hoặc hold.

### 2.2. Chuẩn đầu vào và đầu ra của command mới

Tất cả command thay đổi dữ liệu mới dùng: `hotelId` **được backend lấy từ booking/quan hệ**, không tin `hotelId` do client gửi; `actorId` lấy từ JWT; `idempotencyKey` từ header/correlation-id; thời gian sử dụng đồng hồ server; `expectedVersion` để chống cập nhật đè; JSON trả về có `{ data, message }` hoặc shape tương thích API cũ nếu là adapter. Mã lỗi chuẩn: `400` dữ liệu sai, `401` chưa đăng nhập, `403` khác khách sạn/không có quyền, `404` không tìm thấy, `409` xung đột phiên bản/trạng thái, `422` vi phạm chính sách hợp lệ. Không trả thông tin nhân viên/booking khách sạn khác trong lỗi.

### 2.3. Mô hình thời gian

- Khoảng lưu trú dạng **nửa mở**: `[checkInAt, checkOutAt)`. Tại đúng thời điểm `checkOutAt`, không thể check-in muộn vào kỳ đã hết. Các hold COMMITTED không cần 'release' chỉ vì thời gian trôi qua; điều kiện overlap tự loại ngày đã hết.
- `assignment_at`, mốc 40 phút, 120 phút tính trên thời điểm commit phân công của server; cùng khách sạn, tính từ **lần giao chính gần nhất**, không đếm temporary coverage là một lần giao booking mới trừ khi công việc thực sự được tính tải.
- Nghỉ/đi trễ theo `[startAt, endAt)` đã duyệt; giữ timestamp UTC trong DB, hiển thị giờ khách sạn; hai khoảng chồng lấn cần chính sách không tạo đúp.
- Tác vụ có `occurred_at`, `recorded_at`; nếu nhập hỗ trợ trực tiếp sau khi hoàn thành, không được mạo nhận recorded_at là thời điểm thực tế hệ thống ghi nhận. Có thể thêm `claimed_occurred_at` (khai báo bởi nhân viên) và `evidence_level` riêng.
- Không cho nhân viên tự thay đổi thời gian check-in đã xảy ra hoặc lùi thời gian để tăng KPI; sửa sai bằng adjustment event có phê duyệt.

### 2.4. Truyền sự kiện và phát thông báo

Giữ các event cũ như `payment.paid`, `booking.payment_expired`, `refund.process`, `booking status changed`. Bổ sung event mới: `booking.assignment.requested`, `booking.assigned`, `staff.availability.changed`, `booking.presence.changed`, `booking.coverage.changed`, `guest.work.completed`, `kpi.period.calculated`. Worker xử lý từng loại bằng handler riêng; cần `event_id` và `idempotency_key`. Gửi socket/email chỉ **sau commit**. Không chứa họ tên/điện thoại/email khách không cần thiết trong payload broadcast; dùng room `hotel:{id}`/`user:{id}` đã được xác thực.

### 2.5. Thử nghiệm tương thích API cũ

- `GET /bookings`, `GET /bookings/:id`, `PATCH /bookings/:id/status`, `PATCH /bookings/:id/reassign` và `POST /bookings/front-desk` vẫn tồn tại; chỉ có thêm kiểm tra quyền thực chất và adapter use case khi bật cờ.
- `GET /services/requests`, `PUT /services/requests/:id/status` giữ URL/field; backend tiếp nhận `@CurrentUser` để kiểm tra hotel và actor thực hiện trước khi ghi. Không đổi tên status cũ.
- `GET /bookings/performance/me` vẫn trả dữ liệu tổng hợp cũ cho tới khi màn KPI mới sử dụng `/staff-kpi/*`; tránh trả lẫn shape mà UI hiện hành không hiểu.
- `src/services/api/client.ts` giữ token/refresh interceptor; tạo file api theo domain, không tự viết axios instance mới. `shifts` không tham gia luồng.


---

## ĐỢT 1. KIẾN TRÚC PHÂN CÔNG 40/120 PHÚT, NĂNG LỰC, ĐƠN NGHỈ/ĐI MUỘN

### 1.1. Bối cảnh thực tế và các nhánh cần xử lý

**Tình huống A — ba booking liên tiếp:** 08:30 khách X thanh toán booking VIP, A và B đều có năng lực cao, A kinh nghiệm hơn được giao; 08:55 booking mới tới, A cách lần giao 25 phút nên loại; chọn B; 09:20 booking thứ ba, A đã qua 40 phút nhưng còn trong 120 phút, trước hết phải tìm người chưa nhận booking trong 120 phút ở mức đủ an toàn, có thể chọn C nếu đáp ứng hạng phòng. 09:45 tiếp tục có booking, chọn dựa trên lịch giao gần nhất, tải đang nhận, độ phù hợp. Không được lấy người đứng đầu danh sách SQL mặc định sau mỗi callback.

**Tình huống B — hết người trong 40 phút:** khách sạn có một lễ tân A; 08:30 A vừa nhận một booking, 08:55 lại có booking PAID. Quy tắc 40 phút là **loại trừ cứng khỏi auto-dispatch**; chuyển cho quản lý ACTIVE của **cùng khách sạn**. Nếu nhiều quản lý, chọn quản lý ít tải. Nếu không có cả quản lý: lưu `UNASSIGNED_CRITICAL`, cảnh báo, retry điều phối có kiểm soát; **không hủy thanh toán và không cho nhân viên khách sạn khác nhận**.

**Tình huống C — phòng VIP nhưng không đủ người:** theo từng nấc năng lực: VIP ưu tiên nhóm cấp cao; nếu không có ứng viên chưa nhận trong 120 phút thì rà soát nhóm năng lực thấp hơn có điều kiện tối thiểu hợp lệ; hết ứng viên mới xét lại nhóm đã qua 40 phút. Không mặc nhiên ép người cấp thấp nhận công việc vượt kỹ năng có xác minh; nếu không đủ ngưỡng tối thiểu, fallback quản lý.

**Tình huống D — đi muộn đã duyệt:** A gửi đơn đi muộn 90 phút từ 08:00 đến 09:30; quản lý duyệt trước ngày làm việc. Booking PAID lúc 08:45 không chọn A; 09:30 trở đi A lại khả dụng nếu tài khoản/quan hệ khách sạn ACTIVE, không cần thao tác chuyển ca.

**Tình huống E — nghỉ phát sinh sau khi đã nhận booking:** A đã nhận booking từ hôm qua nhưng xin nghỉ ngày khách đến. Duyệt đơn phải tạo cảnh báo các booking/tác vụ có thời gian phục vụ trùng với khoảng vắng; không tự xóa A khỏi booking lịch sử. Quản lý chọn hỗ trợ thay tạm thời hoặc bàn giao hoàn toàn ở Đợt 3. Trong thời gian chuyển tiếp, booking được đánh dấu `COVERAGE_REQUIRED` nếu đến hạn và A không sẵn sàng.

**Tình huống F — đơn chờ duyệt, từ chối, hủy/thu hồi:** đơn `PENDING` không tự loại A; `APPROVED` mới ảnh hưởng availability. A xin hủy đơn đã duyệt: gửi yêu cầu rút, quản lý chấp nhận mới gỡ block; không cho A tự rút block để né quy trình. Nếu quản lý từ chối: giữ nhân viên khả dụng như trước và thông báo có lý do.

### 1.2. Luồng 1 — nhân viên xin nghỉ/đi muộn đến cập nhật khả dụng

```text
A mở /staff-requests/new
 -> chọn ABSENCE_FULL_DAY | ABSENCE_PARTIAL | LATE_ARRIVAL
 -> nhập startAt/endAt, lý do, tài liệu nếu cần
 -> POST /staff-availability/requests (JWT A)
 -> Controller validate DTO + actor == staff + active hotel relation
 -> StaffAvailabilityService kiểm tra khoảng thời gian, đơn trùng, giới hạn
 -> INSERT staff_absence_requests [PENDING] + audit_event
 -> outbox thông báo hotel manager
 -> Manager mở /staff-requests/management
 -> GET /staff-availability/requests?hotelId=...&status=PENDING
 -> Manager POST /staff-availability/requests/:id/decision [APPROVE/REJECT]
 -> DB transaction khóa request row, xác minh manager cùng hotel, kiểm tra chưa duyệt
 -> nếu APPROVE: tạo/ cập nhật staff_availability_blocks [startAt,endAt)
 -> commit -> notify A + Manager -> assignment policy tự đọc block mới
 -> nếu đơn chồng booking đang phục vụ: tạo coverage alert cho Manager
```

**Luồng bù trừ và nhánh lỗi:** khoảng `startAt >= endAt` trả 400; A nộp đơn cho khách sạn A nhưng không thuộc khách sạn đó trả 403; hai quản lý duyệt đồng thời chỉ một người thành công, người còn lại 409; đơn được duyệt nhưng insert block lỗi thì transaction rollback cả phê duyệt; outbox email lỗi được retry, không đảo quyết định. Nếu employee bị BLOCKED sau khi duyệt, rule availability vẫn loại theo account status. Đơn nghỉ nhiều ngày không tự đổi booking đã hoàn thành trong quá khứ.

**Trạng thái đơn:** `PENDING -> APPROVED | REJECTED`; `APPROVED -> REVOCATION_REQUESTED -> REVOKED` (quản lý quyết định); `PENDING -> WITHDRAWN` (nhân viên rút trước duyệt). Lưu lịch sử sự kiện quyết định độc lập; không DELETE vật lý.

### 1.3. Luồng 2 — từ VNPay PAID đến booking assignment

```text
PaymentFinalizerService.finalizeSuccess() [transaction cũ]
 -> kiểm tra duplicate payment / commit hold COMMITTED / set payment PAID
 -> ghi event payment.paid [GIỮ NGUYÊN]
 -> FEATURE_ASSIGNMENT_V2? ghi event booking.assignment.requested [MỚI]
 -> COMMIT payment transaction
 -> WorkersService claim event booking.assignment.requested
 -> BookingAssignmentService.assignOnce(bookingId)
      BEGIN TRANSACTION
      SELECT booking FOR UPDATE
      IF current assignment exists -> return idempotent result
      ASSERT payment PAID + hold COMMITTED + hotelId đúng
      SELECT hotel_assignment_dispatch_locks(hotelId) FOR UPDATE
      FETCH staff active, hotel_staff active role EMPLOYEE, user not BLOCKED
      EXCLUDE approved availability blocks overlapping NOW
      EXCLUDE staff with last assignment less than 40 minutes
      DETERMINE room service_tier from booking_rooms/room
      SELECT by fairness bucket + skill tier + load + experience
      IF no receptionist -> choose MANAGER at same hotel
      SAVE booking_assignments, booking_assignment_state, bookings.handled_by
      SAVE assignment dispatch receipt + audit/outbox
      COMMIT
 -> worker ack event; emit booking.assigned to correct hotel/staff/customer
```

**Không gọi `assignOnce()` trực tiếp trong IPN** khi feature mới bật. Source hiện đã có worker outbox `payment.paid` chỉ phát realtime; tiếp tục giữ nhánh này để email/socket không bị ảnh hưởng. Tạo **event `booking.assignment.requested` tách biệt** để việc không có lễ tân, lỗi dữ liệu kỹ năng hay deadlock của dispatch không làm retry/lặp việc thông báo thanh toán hoặc rollback số tiền đã nhận.

**Các đường phải thống nhất:** `PaymentsService.processVnpayIpn()`, `PaymentReconciliationService.reconcilePayment()` và đường `retryPayment()` đều đi qua `PaymentFinalizerService.finalizeSuccess()`; chỉ thêm sự kiện tại finalizer để các lối ra được bao phủ. Với booking đã PAID trước khi bật tính năng mới, tạo **repair job** định kỳ phát hiện `PAID + COMMITTED + chưa có assignment` và gọi `assignOnce`; không sửa booking đã có nhân viên hợp lệ. Đối với nhánh front-desk legacy không có VNPay, giữ chủ booking là nhân viên tạo đơn và lưu lịch sử tương ứng (phân loại `FRONT_DESK`), không tự đưa qua PAID assignment.

### 1.4. Quy tắc quyết định chuẩn, giải quyết xung đột giữa năng lực và công bằng

**Các bộ lọc bắt buộc**: đúng hotel; `users.status='ACTIVE'`; `hotel_staff.status='ACTIVE'`; `staff_role='EMPLOYEE'` được chuẩn hóa nghiệp vụ thành **RECEPTIONIST** (không đổi enum DB vội vì source còn phụ thuộc); không có absence block hiệu lực tại `NOW`; không có nhiệm vụ độc quyền chưa kết thúc nếu loại này được quản lý; không có phân công mới trong **40 phút** trước đó. Đơn vị đo đều theo server UTC.

**Bucket ưu tiên (duyệt theo thứ tự, không cộng điểm tùy tiện):**

1. **FRESH**: ứng viên có lần giao gần nhất **>=120 phút** hoặc chưa từng được giao. Tìm lần lượt từng **skill tier** từ phù hợp nhất đến hạ ngưỡng còn an toàn. Trong tier đã qua lọc: ai có `activeWorkload` ít hơn thì chọn trước; hòa thì kỹ năng/phản hồi tốt hơn; hòa nữa chọn người lâu nhất chưa được giao; cuối cùng `staffUserId` ổn định để deterministic.
2. **SOFT_RECENT**: nếu toàn bộ FRESH không có người đủ điều kiện, xét người được giao **>=40 và <120 phút**, cũng theo skill tier, tải và độ lâu chưa được giao. Có thể chọn lại A sau 50 phút, nhưng không trước C còn trống và đáp ứng hạng phòng.
3. **HARD_COOLDOWN**: dưới 40 phút **không tái sử dụng** bằng auto-dispatch, kể cả toàn khách sạn ít người.
4. **MANAGER_FALLBACK**: nếu không có lễ tân đủ điều kiện hoặc tất cả ở HARD_COOLDOWN, giao quản lý của chính hotel. Không có quản lý thì `UNASSIGNED_CRITICAL` + notify + retry.

**Ngưỡng cấu hình ví dụ**, không phải số hiện có của source: `VIP HIGH: level>=4 & (years>=4 OR cases>=40)`, `VIP RELAX_50: level>=3 & (years>=2 OR cases>=20)`, `VIP STANDARD: level>=2 & (years>=1 OR cases>=10)`, `VIP MIN_SAFE: verified FRONT_DESK + years>=1`. Với STANDARD/ECONOMY khởi đầu ở cấp tương xứng, không dùng logic ưu ái nhân viên level 5 cho mọi đơn. Người dưới ngưỡng an toàn không được giao VIP chỉ để phân bổ số lượng.

**Điểm cần sửa dứt khoát:** code hiện dùng `MAX(ss.level)` trên toàn bộ kỹ năng. Phải xác định kỹ năng tương ứng `FRONT_DESK`, `VIP_HANDLING` hay capability hợp lệ theo `staff_eligibility_rules.required_skill_codes`; skill không liên quan không được tính nâng cấp cho booking VIP. Điểm KPI trong tương lai không thể dựa hoàn toàn vào `bookings.handled_by` hiện tại sau các lần chuyển giao.

**Pseudocode quyết định thuần (dễ unit test):**

```ts
function pickReceptionist(ctx: DecisionContext): Decision {
  const candidates = ctx.staff.filter(s =>
    s.sameHotel && s.accountActive && s.hotelStaffActive &&
    s.businessRole === 'RECEPTIONIST' &&
    !s.isAbsentAt(ctx.now) && !s.hasExclusiveBlockingTask &&
    ctx.now - s.lastPrimaryAssignmentAt >= minutes(40)
  );
  for (const bucket of ['FRESH_120', 'SOFT_RECENT_40_120']) {
    for (const skillTier of ctx.allowedSkillTiersBestToFallback) {
      const eligible = candidates.filter(s =>
        s.inBucket(bucket, ctx.now) && s.meets(skillTier, ctx.bookingTier)
      );
      if (eligible.length) return rankDeterministically(eligible, skillTier)[0];
    }
  }
  return findActiveManagerSameHotel(ctx) ?? UNASSIGNED_CRITICAL;
}
```

**Chống tranh chấp dữ liệu:** `SELECT ... FOR UPDATE` trên **một hàng lock thuộc khách sạn** trước khi đọc `lastPrimaryAssignmentAt` và ghi phân công. Hai callback PAID ở 08:30:00.000 và 08:30:00.050 không thể cùng đọc “A chưa nhận đơn” rồi cùng gán A. Bản khóa được giữ trong một transaction DB; dùng lại helper retry deadlock có sẵn, ghi metric lock-wait, không lạm dụng lock Redis làm nguồn sự thật.

### 1.5. Database: bảng/cột phải bổ sung (migration additive)

| Schema | Trường và chỉ mục thiết yếu | Bất biến |
|---|---|---|
| `rooms` | `service_tier VARCHAR(20) NOT NULL DEFAULT 'STANDARD'` | Không đổi `price_per_night`, `total_rooms`, `available_rooms`. Dữ liệu cũ phân hạng STANDARD tạm thời, quản lý rà soát VIP thật trước bật v2. |
| `staff_absence_requests` | id, hotel_id, staff_user_id, request_type, start_at, end_at, reason, status, decided_by/at, decision_note, version, created_at | Người nộp thuộc hotel; không có trạng thái duyệt không lưu audit. |
| `staff_absence_request_events` | request_id, old_status, new_status, actor_id, occurred_at, note | Nhật ký append-only. |
| `staff_availability_blocks` | id, hotel_id, staff_user_id, request_id nullable, block_type, start_at, end_at, active, source, created_by | Block chồng lấn theo khoảng; tránh trùng cùng request; có thể block khẩn cấp khi quản lý có lý do. |
| `hotel_assignment_dispatch_locks` | `hotel_id PRIMARY KEY`, version, updated_at | Một khóa logic cho từng khách sạn; migration seed từ hotel hiện có và upsert khi thêm hotel. |
| `booking_assignment_state` | `booking_id PRIMARY KEY`, `current_assignment_id`, `current_staff_id`, `version`, `updated_at` | Tối đa một người phụ trách chính hiện tại; mirror sang `bookings.handled_by`. |
| `booking_assignments` | id, booking_id, hotel_id, staff_user_id, assignment_version, assigned_at, ended_at, type, skill_tier, freshness_bucket, reason, source_event_id, assigned_by | Unique `(booking_id, assignment_version)`; record cũ không xóa, thay người tạo record mới. |
| `booking_assignment_command_receipts` | booking_id, `command_key UNIQUE`, status, attempts, last_error, processed_at | Từ chối xử lý lặp IPN/worker/retry. |

**Lưu ý MySQL:** đừng dùng unique `(booking_id, ended_at)` để ép chỉ một bản ghi `ended_at IS NULL`, vì MySQL cho nhiều `NULL` trong unique index. Dùng `booking_assignment_state` là nguồn chỉ thị hiện tại; transaction khóa booking để ngăn hai assignment-active. Tạo index `(hotel_id, staff_user_id, assigned_at)` cho lịch sử 40/120 và `(hotel_id, staff_user_id, start_at, end_at, active)` cho availability.

**RÀ SOÁT schema có sẵn trước migration:** entity `BookingStatusLog.changedBy` là không-null nhưng hàm auto-assign hiện đang ghi `changedBy: null`. Bootstrap SQL cũng có ràng buộc không-null. Nếu hệ thống dùng `SYSTEM` actor, **đề nghị migration cho `changed_by` nullable + thêm `actor_type = SYSTEM|USER`**, thay vì gán giả ID người quản lý. Đồng thời kiểm tra các cột `bookings.booking_source`, `created_by_staff_id` tồn tại thực tế trước khi chạy nhánh front-desk; các file bootstrap từng thiếu cột này.

### 1.6. Backend: danh sách file và thay đổi ở mức hàm

| File | Tác động cụ thể |
|---|---|
| **[SỬA]** `backend/src/rooms/entities/room.entity.ts` | Thêm `serviceTier` ánh xạ `service_tier`, DEFAULT STANDARD. Không sửa giá/tồn. |
| **[SỬA]** `backend/src/rooms/dto/create-room.dto.ts`, `update-room.dto.ts`, `rooms.service.ts` | DTO `serviceTier?` optional `ECONOMY/STANDARD/VIP`; validate, persist field có whitelist. `update()` phải giữ giá trị cũ nếu không gửi. |
| **[SỬA]** `backend/src/hotel-staff/staff-skills.service.ts` | Tạo hàm chỉ đọc hồ sơ kỹ năng đã xác minh, phân loại theo `StaffEligibilityRule` hiện có, không dùng `MAX(level)` toàn kỹ năng. Không thay route skill management cũ. |
| **[TẠO]** `backend/src/staff-availability/entities/staff-absence-request.entity.ts`, `staff-availability-block.entity.ts`, `staff-absence-request-event.entity.ts` | Model schema kể trên; trạng thái qua enum rõ ràng. |
| **[TẠO]** `backend/src/staff-availability/dto/create-absence-request.dto.ts`, `decide-absence.dto.ts`, `request-revocation.dto.ts` | Validate loại đơn, ngày bắt đầu/kết thúc, lý do, expectedVersion. |
| **[TẠO]** `backend/src/staff-availability/staff-availability.controller.ts` | `POST /staff-availability/requests`, `GET /staff-availability/requests/me`, `GET /staff-availability/requests/hotel/:hotelId`, `POST /staff-availability/requests/:id/decision`, `POST /staff-availability/requests/:id/revocation`. |
| **[TẠO]** `backend/src/staff-availability/staff-availability.service.ts` | `createRequest`, `decide`, `requestRevoke`, `isAvailableAt(staffId,hotelId,at)`, `getOverlappingBlocks`; duyệt cùng transaction với block. |
| **[TẠO]** `backend/src/booking-assignment/assignment-policy.ts`, `assignment-decision.service.ts` | Pure decision: freshness buckets, skill tiers, deterministic ranking; unit-test riêng. |
| **[TẠO]** `backend/src/booking-assignment/booking-assignment.service.ts` | `assignOnce` idempotent; các mức fallback; lock per hotel; lưu history, state, `handledBy`; `repairUnassignedPaidBookings`. |
| **[TẠO]** `backend/src/booking-assignment/booking-assignment.module.ts` và entities/DTO | Module chỉ import TypeORM/StaffAvailability/HotelAccess/Outbox; **không import PaymentsModule**. |
| **[SỬA]** `backend/src/bookings/bookings.service.ts` | Giữ hàm auto-assign cũ dưới flag cũ; khi bật v2, không gọi logic legacy; bảo đảm `updateStatus` không tự gán `handledBy=changedByUserId` khi assignment đang PENDING (tránh cướp người phụ trách). |
| **[SỬA]** `backend/src/payments/services/payment-finalizer.service.ts` | Sau khi PAID/COMMITTED, thêm outbox `booking.assignment.requested` vào transaction và feature flag. **Không đổi kiểm tra VNPay, double-payment, amount, hold, refund**. |
| **[SỬA]** `backend/src/payments/payments.service.ts` | Tại callback legacy auto-assign hiện có, điều kiện hóa khi bật v2; xác nhận các đường IPN/retry vẫn finalizer chung. |
| **[SỬA]** `backend/src/workers/workers.service.ts`, `workers.module.ts` | Handler event mới gọi `assignOnce`; báo retry/critical, không sửa case `payment.paid` realtime cũ. |
| **[SỬA]** `backend/src/app.module.ts` | Import StaffAvailabilityModule và BookingAssignmentModule, không đụng ShiftsModule. |
| **[TẠO]** `database/migration_staff_availability_assignment_v2.sql` | Chỉ ADD column/tables/indexes, có preflight và rollback có điều kiện. Không DROP dữ liệu. |

### 1.7. Frontend: đường đi và file cần chỉnh

| File | Tác động cụ thể |
|---|---|
| **[TẠO]** `src/services/api/staff-availability.api.ts` | Interface `AbsenceRequest`, `AvailabilityBlock`, create/decide/revoke/getMe/getHotel; dùng `apiClient` có sẵn. |
| **[TẠO]** `src/services/api/booking-assignment.api.ts` | GET history/decision/retryStatus; types `ASSIGNMENT_PENDING`, `ASSIGNED`, `MANAGER_FALLBACK`, `CRITICAL`. |
| **[TẠO]** `src/app/(dashboard)/staff-requests/page.tsx` | Form nghỉ/đi muộn của lễ tân, danh sách đơn của mình, trạng thái và lịch sử. |
| **[TẠO]** `src/app/(dashboard)/staff-requests/management/page.tsx` | Quản lý xem đơn thuộc hotel, duyệt/từ chối, xem tác động booking chồng lịch; không hiện nút duyệt trên đơn của chính mình. |
| **[SỬA]** `src/app/(dashboard)/bookings/page.tsx` | Ở ô người phụ trách, hiển thị assignment status/độ mới 40/120 và lý do; không tự suy ra assigned từ booking status. |
| **[SỬA]** `src/services/api/booking.api.ts` | Bổ sung field optional `assignmentStatus`, `assignmentReason`, `assignmentVersion`; giữ field cũ. |
| **[SỬA]** `src/features/rooms/components/RoomCreateModal.tsx`, `RoomEditModal.tsx`, `src/types/room.ts`, `src/services/api/rooms.api.ts` | Dropdown service tier; chỉ gửi khi người dùng thay đổi, giữ form cũ hoạt động. |
| **[SỬA]** `src/components/dashboard/Sidebar.tsx` | Thêm mục “Đơn xin nghỉ/Đi muộn” theo vai trò; không xóa link đang có. |

### 1.8. API payload mẫu và mã phản hồi

```json
POST /staff-availability/requests
{
  "hotelId": "15",
  "requestType": "LATE_ARRIVAL",
  "startAt": "2026-11-02T01:00:00.000Z",
  "endAt": "2026-11-02T02:30:00.000Z",
  "reason": "Việc cá nhân, xin đi muộn 90 phút"
}

POST /staff-availability/requests/802/decision
{ "decision": "APPROVE", "reviewNote": "Đồng ý", "expectedVersion": 1 }
```

Kết quả approve `200`, gửi lại nguyên trạng request đã quyết định `409`, manager khác khách sạn `403`, đơn chồng chưa được phép `422`. API xem availability chỉ trả những trường cần thiết cho người tương ứng, không công khai lý do nghỉ chi tiết cho khách.

### 1.9. Kiểm thử bắt buộc và rollback

- **Unit:** thời điểm đúng 39:59 phải loại; 40:00 được vào SOFT_RECENT; 119:59 chưa FRESH; 120:00 FRESH; bucket fresh ở tier thấp đủ an toàn được xét trước A vừa nhận 50 phút; ties deterministic; đóng băng clock để test ổn định.
- **Concurrency:** hai callback PAID cùng hotel đồng thời không giao cùng nhân viên đang ở trong 40 phút; callback lặp không tạo bản ghi assignment thứ hai; hai hotel độc lập không khóa lẫn nhau; nhiều worker/instance xử lý receipt vẫn đúng một lần.
- **Availability:** duyệt đi muộn 08:00–09:30 loại A lúc 08:45, cho A lúc 09:30; từ chối không block; thu hồi approved chỉ sau quản lý duyệt; đơn hai quản lý quyết định đồng thời chỉ một thắng.
- **Payment regression:** IPN success/fail, retry, reconciliation, PAID_REQUIRES_REVIEW, expired HELD, refund và realtime event cũ không đổi. Nếu assignment queue hỏng, vẫn hiển thị PAID + COMMITTED, không trả response VNPay thất bại.
- **Release/rollback:** bật V2 cho một khách sạn thử nghiệm, so shadow decision và actual; nếu tỷ lệ lỗi vượt ngưỡng, tắt flag V2, worker mới được drain/cô lập, không rollback schema dạng DROP. Khôi phục từ event nếu booking `ASSIGNMENT_PENDING`.

**Tiêu chí đóng Đợt 1:** tất cả booking PAID hợp lệ được phân công đúng một lần hoặc có cờ cảnh báo/repair; việc vắng mặt được manager duyệt là điều kiện lọc thực sự; thanh toán và tồn phòng cũ qua regression.


---

## ĐỢT 2. KIẾN TRÚC NO-SHOW, CHECK-IN MUỘN, CHẤM DỨT KỲ GIỮ PHÒNG

### 2.1. Bối cảnh và ba loại thông tin độc lập

Khách trả tiền booking từ **15/08/2026 17:00 đến 19/08/2026 17:00**. Đúng 17:00 khách chưa đến; chưa có thao tác xác nhận nhận phòng của lễ tân. Nếu hệ thống đánh dấu check-in tự động là sai, nhưng nếu vì khách chưa đến mà nhả phòng thì có thể bán trùng. Traveleke phải tách:

1. **Payment:** `PAID` = tiền đã được hệ thống nhận/đối soát.
2. **Inventory:** `COMMITTED` = suất phòng đã được cấp quyền sử dụng trong `[15/08 17:00,19/08 17:00)`, dù chưa có người đến.
3. **Presence:** `EXPECTED`/`NO_SHOW`/`IN_HOUSE`/`DEPARTED`/`CLOSED_NO_SHOW` = trạng thái khách thực tế có mặt.

Không biến một thay đổi của lớp presence thành cập nhật thanh toán hoặc inventory. `NO_SHOW` là trạng thái **có thể phục hồi** khi còn trong kỳ; `CLOSED_NO_SHOW` sau khi kỳ đặt hết mới là kết thúc khách chưa đến. Nếu cần báo cáo doanh thu No-show, phân biệt doanh thu đã thanh toán với đêm lưu trú thực tế; không tăng số lần check-in.

**Chú ý đến source cũ:** `BookingStatus` hiện có `PAYMENT_PENDING`, `PENDING`, `CONFIRMED`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`... nhưng chưa có NO_SHOW; hàm `updateStatus()` kiểm tra `VALID_STATUS_TRANSITIONS`, DTO cũng whitelist status cũ. Nếu chỉ thêm enum vào entity mà không cập nhật luật và giao diện thì sẽ có lỗi 400 hoặc sai nghiệp vụ.

### 2.2. Ma trận tình huống và hướng xử lý đúng

| Tình huống | Quyết định backend | Inventory | KPI/người phục vụ |
|---|---|---|---|
| Khách đến đúng 17:00 ngày 15/08 | Lễ tân xác minh và check-in -> `CHECKED_IN`; lưu actual time | Giữ COMMITTED | Check-in ghi đúng actor. |
| 17:00 chưa thấy khách, chưa có yêu cầu check-in | Chuyển `ARRIVAL_PENDING`/chờ muộn nội bộ, chưa tự đánh dấu CHECKED_IN | Giữ COMMITTED | Không trừ điểm A ngay. |
| 22:00 ngày 15/08 khách đến trước hạn No-show | Cho check-in bình thường, đánh dấu late arrival nếu muốn | Giữ COMMITTED | Actor tại quầy được ghi. |
| Quá ngưỡng No-show (ví dụ 23:00) vẫn không đến | `NO_SHOW`, `no_show_at`, outbox thông báo | Giữ COMMITTED | Không coi No-show là nhân viên thất bại. |
| 16/08 hoặc 17/08 khách đến muộn | Cho `NO_SHOW -> CHECKED_IN` nếu `now < checkOutAt`, PAID, hold COMMITTED, không bị hủy | **Không** commit lần nữa | Ghi `late_check_in=true`, actor B/A thực hiện. |
| 19/08 lúc 17:00 khách chưa bao giờ đến | `NO_SHOW -> CLOSED_NO_SHOW`, đóng hành trình; không gọi release committed | Qua mốc checkout thì không còn overlap thời gian tới | Chỉ chấm phần pre-arrival đã làm. |
| Khách đến sau 19/08 lúc 17:00 | Trả 409/422; hướng dẫn tạo booking mới, không hồi sinh kỳ đặt đã hết | Không hồi sinh hold cũ | Không ghi check-in giả. |
| Manager đánh dấu No-show nhầm, khách vẫn trong kỳ | Có thao tác xác nhận khách tại quầy để check-in muộn hợp lệ, không xóa lịch sử No-show | Không đổi COMMITTED | Tách thời điểm No-show và check-in thật. |
| Khách đã có `CANCELLED`, hold `RELEASED`, có refund | Cấm check-in muộn trên booking cũ, làm đặt lại hợp lệ | Không tự chiếm phòng | Không lấy lịch sử A/B đã đóng làm mới. |
| Hai nhân viên B/C cùng bấm check-in | DB khóa booking/version; người đầu thành công, người sau nhận already checked-in/409 | Chỉ một sự kiện check-in | Không chấm KPI hai lần. |

**Ngưỡng No-show** không nhất thiết bằng giờ check-in: đề xuất `noShowGraceMinutes=360` để mô phỏng khách nhận phòng 17:00 mà 23:00 vẫn chưa đến. Quản lý có thể cấu hình theo khách sạn với giới hạn hợp lý và hiệu lực tương lai; không sửa ngược booking đã ghi nhận.

### 2.3. State machine mục tiêu và tương thích legacy

```text
PAYMENT_PENDING --VNPay PAID--> PENDING --manager confirm--> CONFIRMED
                                                     |                |
                                                     v                v
                                                CHECKED_IN <------- NO_SHOW
                                                     |                |
                                                     v                v
                                                 COMPLETED       CLOSED_NO_SHOW

PAYMENT_PENDING --timeout--> PAYMENT_EXPIRED  [GIỮ NHƯ CŨ]
PAID PENDING / CONFIRMED --đúng quy trình hủy--> CANCELLED [GIỮ NHƯ CŨ]
```

**Luật nghiệp vụ bắt buộc:**

- `CONFIRMED -> NO_SHOW` chỉ do hệ thống/manager theo chính sách thời gian và kiểm tra PAID/COMMITTED; `PENDING -> NO_SHOW` tùy quy tắc xác nhận thực tế; tránh bỏ sót booking PAID chưa được manager confirm: scheduler nên nhận `PENDING` đã PAID và quá hạn theo chính sách, nhưng lưu cờ reason `CONFIRMATION_MISSING` để cảnh báo thay vì giả confirm.
- `NO_SHOW -> CHECKED_IN` là luồng **phục hồi hợp lệ**; lúc ấy set `actual_check_in_at`, `check_in_actor_id`; No-show trước đó vẫn còn trong audit/event.
- `CHECKED_IN -> COMPLETED` theo thao tác check-out; ghi `actual_check_out_at` và actor. Chưa check-in thì không được `COMPLETED` để giả là khách đã ở.
- `NO_SHOW -> CLOSED_NO_SHOW` sau khi tới/hết `checkOutAt` và chưa check-in; không gọi `refund` hoặc `releaseCommittedHold` mặc định. Nếu sản phẩm cần hoàn tiền ngoại lệ, phải tạo luồng xét duyệt riêng sử dụng hạ tầng cancellation/refund cũ với điều kiện minh bạch, không trộn vào state machine tự động.
- `CONFIRMED -> CHECKED_IN` giữ được với API/status cũ, nhưng backend phải chuyển qua cùng một use case `confirmArrival()` để có kiểm tra quyền, timestamp, event và lock; không cho bypass bằng PATCH status thuần.

**Chi tiết dữ liệu:** có thể giữ `bookings.status` là trạng thái hiển thị chính để tương thích Dashboard, đồng thời lưu `booking_presence` là timeline chuẩn; mọi trạng thái NO_SHOW mới phải map nhất quán với status và đếm trong báo cáo. Các API cũ nhận field status string phải hỗ trợ giá trị mới ở phần render/filter; không đổi shape trường cũ.

### 2.4. Luồng No-show từ scheduler đến database

```text
PresenceScheduler @Interval / @Cron
 -> NOW(server) >= booking.checkInAt + graceMinutes
 -> tìm booking có status PENDING/CONFIRMED, chưa actual_check_in_at
 -> query payment PAID, hold COMMITTED, checkOutAt > NOW
 -> cho mỗi booking: BookingPresenceService.markNoShow(bookingId)
      BEGIN TX; SELECT booking FOR UPDATE
      re-check condition in transaction
      IF CHECKED_IN or NO_SHOW -> no-op/idempotent
      status = NO_SHOW; set no_show_at = NOW
      append presence_events and booking_status_logs
      enqueue booking.presence.changed
      COMMIT
 -> socket/email tới đúng hotel + staff + customer
```

**Khi có nhiều server:** scheduler có thể cùng quét nhưng chỉ một `markNoShow` được ghi do row lock + trạng thái/version; không bao giờ tăng/trừ inventory trong hàm này. Nên dùng batch có phân trang và index `(status, check_in_at)`, đừng quét toàn bộ DB một transaction dài. Nếu worker ngừng hoạt động sáu giờ, chạy lại sẽ quét backlog idempotent, nhưng không tự đánh dấu No-show cho booking đã CHECKED_IN.

**Nếu nhân viên đến quầy check-in đúng lúc scheduler đang đánh dấu No-show:** cả hai dùng cùng booking lock. Nếu scheduler thắng, check-in xử lý `NO_SHOW -> CHECKED_IN`; nếu check-in thắng, scheduler thấy CHECKED_IN và không đổi. Cuối cùng booking phải CHECKED_IN khi khách đã được xác minh, không rơi vào trạng thái No-show cuối kỳ.

### 2.5. Luồng check-in muộn có người A/B tham gia

```text
B xác minh booking code và khách tại quầy
 -> (tùy trường hợp) A là owner chính, B có coverage hợp lệ hoặc Manager ủy quyền
 -> POST /booking-presence/:bookingId/check-in
       {arrivalKind: 'LATE', note?, expectedVersion, commandId}
 -> JwtAuthGuard + HotelAccessPolicy + BookingTaskActorPolicy
 -> BookingPresenceService.confirmArrival()
      BEGIN TX; LOCK booking, presence
      verify user/hotel/coverage; verify payment PAID + committed hold
      IF now >= checkOutAt OR CANCELLED/REFUNDED -> 409
      IF status CHECKED_IN -> idempotent return
      IF status CONFIRMED or PENDING or NO_SHOW -> set CHECKED_IN
      record actual_check_in_at, actor_id, from_no_show, previous_status
      append presence_event + guest_work_event(CheckInCompleted) [nếu flag đợt4]
      COMMIT
 -> UI cập nhật lịch sử, giữ handled_by nếu chỉ là coverage; socket tới A/B/Manager
```

**Không bắt buộc khách gửi check-in request trên web** vì họ có thể đến trực tiếp. Nếu có chức năng “Tôi sắp đến”, nó chỉ tạo `ARRIVAL_INTENT`; nhân viên xác thực tại quầy mới là người thực hiện check-in. Chỉ cho khách nhận phòng muộn nếu tồn phòng đã được giữ hợp lệ; trường hợp legacy front-desk booking `CONFIRMED` nhưng không có hold phải xét rule riêng (được tạo trực tiếp tại quầy), không suy bừa PAID/COMMITTED.

### 2.6. Nghiệp vụ tồn phòng: điều gì tuyệt đối không được thực hiện

Source `backend/src/inventory/inventory.service.ts:getOccupiedRooms()` hiện cộng tổng quantity của COMMITTED + HELD chưa hết hạn theo điều kiện `existing.checkInAt < requested.checkOutAt AND existing.checkOutAt > requested.checkInAt`. Vì thế:

1. KHÔNG tăng số phòng trống khi chuyển `CONFIRMED -> NO_SHOW`.
2. KHÔNG tạo hold mới khi `NO_SHOW -> CHECKED_IN`; không chạy `reserve` hoặc `commitHold` lần nữa.
3. KHÔNG giảm `rooms.available_rooms` thêm một lần trong thao tác check-in muộn trên checkout VNPay.
4. KHÔNG cho No-show đi qua nhánh `CancellationsService.reviewRequest(APPROVE)` tự động; quy trình hủy và refund có điều kiện riêng.
5. Tại ngày 17 trong kỳ 15–19, booking No-show vẫn chiếm suất phòng trong truy vấn ngày 17–18. Booking khác không thể đặt vượt `total_rooms`; câu trả lời availability phải dựa cùng quy tắc hold.
6. Kết thúc 19/08 17:00, overlap `[15,19)` với booking yêu cầu `[19,21)` là false, vì `19 > 19` false; vì vậy không cần hủy hold để mở bán từ 19/08 17:00 trở đi.
7. Nếu khách đặt nhiều phòng (`requested_room_count > 1`), No-show/late check-in phải giữ đúng quantity, không tự chuyển thành 1. Vấn đề gán **số phòng vật lý cụ thể** vẫn ngoài phạm vi sáu đợt nếu source mới chỉ theo room listing/category.

### 2.7. Backend: tạo/sửa file và trách nhiệm từng hàm

| File | Sửa/tạo gì, không đụng gì |
|---|---|
| **[SỬA]** `backend/src/bookings/entities/booking.entity.ts` | Thêm enum `NO_SHOW`, `CLOSED_NO_SHOW`; field optional `noShowAt`, `actualCheckInAt`, `actualCheckOutAt`, `checkInActorId`, `checkOutActorId`, `lastPresenceVersion`. Không đổi các trường tiền hoặc thời gian kỳ đặt. |
| **[SỬA]** `backend/src/bookings/dto/update-booking-status.dto.ts` | Không cho client dùng PATCH status để tự ý No-show/reopen; nếu muốn tương thích CHECKED_IN/COMPLETED cũ, adapter gọi PresenceService với actor. Giữ enum status cũ cho luồng hợp lệ. |
| **[SỬA]** `backend/src/bookings/bookings.service.ts` | Bổ sung chuyển trạng thái kiểm soát `NO_SHOW -> CHECKED_IN`; refactor `updateStatus()` nhánh CHECKED_IN/COMPLETED sang PresenceService; giữ cancellation guard cũ và realtime. Không sửa logic refund. |
| **[TẠO]** `backend/src/booking-presence/booking-presence.service.ts` | `markNoShow`, `confirmArrival`, `confirmDeparture`, `closeExpiredNoShow`, `getPresenceTimeline`; transaction/lock/idempotency. |
| **[TẠO]** `backend/src/booking-presence/booking-presence.controller.ts` | `POST /booking-presence/:bookingId/check-in`, `POST .../check-out`, `GET .../timeline`; route nội bộ no-show dành cho manager, scheduler gọi service trực tiếp. |
| **[TẠO]** `backend/src/booking-presence/entities/booking-presence-event.entity.ts` | Bảng log timeline chứa `from_state`, `to_state`, `actor_type`, `actor_id`, `occurred_at`, `command_id`, `reason`, `booking_version`. |
| **[TẠO]** `backend/src/booking-presence/presence-scheduler.service.ts` | Quét quá hạn chờ check-in, qua checkout; batch + re-check transaction; không phát event trùng. |
| **[SỬA]** `backend/src/bookings/bookings.controller.ts` | Bảo toàn route status cũ; thêm `@CurrentUser()`/delegate cho hành vi check-in/out theo actor. Không đổi vị trí/ý nghĩa `:id` một cách gây bắt nhầm route mới. |
| **[SỬA]** `backend/src/bookings/bookings.module.ts`, `backend/src/app.module.ts` | Import/export PresenceModule theo một chiều, tránh vòng `PaymentsModule <-> BookingsModule` vốn đã có `forwardRef`. |
| **[GIỮ]** `backend/src/inventory/inventory.service.ts` | Không chỉnh `getOccupiedRooms`, `commitHold`, `releaseCommittedHold` cho No-show. Chỉ thêm integration tests đọc đúng occupancy. |
| **[GIỮ]** `backend/src/cancellations/cancellations.service.ts` | Không thay logic xét duyệt hoàn tiền cũ; thêm case test No-show không được hủy qua đường tắt. |
| **[TẠO]** `database/migration_booking_presence_v2.sql` | ADD enum-compatible VARCHAR values, cột timestamp nullable, tạo presence event table/index; migration không reset booking cũ. |

### 2.8. Frontend: các màn hình và hành vi cần sửa

| File | Chi tiết |
|---|---|
| **[SỬA]** `src/services/api/booking.api.ts` | Bổ sung union trạng thái NO_SHOW/CLOSED_NO_SHOW; optional `actualCheckInAt`, `actualCheckOutAt`, `noShowAt`, `presenceVersion`; **không xóa** kiểu cũ. |
| **[TẠO]** `src/services/api/booking-presence.api.ts` | `checkIn(bookingId, expectedVersion, commandId)`, `checkOut`, `getTimeline`, `getArrivals`; nhận 409 để refresh dữ liệu. |
| **[SỬA]** `src/app/(dashboard)/bookings/page.tsx` | Trong `STATUS_OPTIONS`, thêm No-show/đóng No-show; nút “Nhận phòng muộn” khi NO_SHOW còn hạn; không hiện nút hủy sai; trong chi tiết hiển thị lịch đến, giờ đến thực tế, người thao tác, thời gian còn hiệu lực. |
| **[TẠO]** `src/components/booking/PresenceTimeline.tsx`, `LateCheckInDialog.tsx` | Thể hiện tiến trình, yêu cầu ghi nhận khách có mặt, cập nhật optimistic lock, thông báo xung đột. Tách component khỏi page đã >2.400 dòng. |
| **[SỬA]** `src/components/booking/BookingHistory.tsx` | Với khách: nhãn “Chưa đến/đến muộn/đang lưu trú”, không thể tự xác nhận check-in tại quầy; cho biết booking còn được giữ đến checkout. |
| **[GIỮ]** `src/app/payment/vnpay/result/page.tsx`, các form checkout | Không biến No-show thành payment failed; kết quả VNPay chỉ hiển thị tình trạng thanh toán và đặt phòng. |

### 2.9. Test tích hợp, test âm và tiêu chí đóng

- **No-show policy**: 17:00 chưa đến vẫn chờ theo grace, 22:00 có thể check-in, 23:00 bắt đầu No-show, 16/08 và 17/08 check-in muộn được, đúng 19/08 17:00 bị từ chối nếu chưa check-in.
- **Occupancy**: booking PAID hold COMMITTED số lượng 2 phòng, trạng thái NO_SHOW; tìm kiếm overlapping dates không được bán vượt lượng phòng; sau checkout range không còn block ngày mới; không query/tác vụ nào `releaseCommittedHold` vì No-show.
- **Concurrent**: hai nút check-in cùng lúc chỉ một actual-check-in event; cron No-show đua check-in cuối cùng booking đúng; retry command idempotent.
- **Legacy:** `PATCH /bookings/:id/status` CHECKED_IN/COMPLETED vẫn hoạt động với người có quyền; refund/cancel cũ vẫn chạy theo điều kiện hiện có; front-desk booking không bị bắt buộc có VNPay.
- **Rollback:** flag OFF sẽ ẩn chức năng No-show mới trên UI; dữ liệu đã có No-show cần adapter đọc/trình bày an toàn, **không tự map NO_SHOW thành CANCELLED**. Nếu rollback kỹ thuật, chạy repair/reconciliation presence có kiểm toán chứ không xóa dòng.

**Tiêu chí đóng Đợt 2:** không còn trường hợp khách đã PAID nhưng No-show bị nhả phòng và bán trùng; khách đến muộn trong kỳ có thể nhận phòng hợp lệ; lịch sử ghi cả No-show và actual check-in.

---

## ĐỢT 3. KIẾN TRÚC THAY TẠM THỜI, CHUYỂN GIAO HẲN VÀ PHÂN CHIA KPI A/B

### 3.1. Vấn đề thực tế không thể giải bằng một trường `handled_by`

A nhận booking và đã tư vấn khách. Ngày dự kiến check-in, A xin nghỉ ốm được duyệt và không có mặt. B đứng quầy đón khách đến muộn. Hệ thống phải hỗ trợ **B thực hiện thay riêng thao tác check-in**, A vẫn giữ công tư vấn đã làm. Nhưng nếu A nghỉ việc hay nghỉ dài ngày, cần **chuyển hẳn trách nhiệm booking từ A sang B** để B nhận mọi yêu cầu tiếp theo. Hai việc này khác nhau về hạn quyền, thông báo, dữ liệu và KPI.

**Nghiệp vụ chốt:** temporary coverage mặc định **120 phút**, quản lý được nhập **15 phút đến 24 giờ**, có nhiệm vụ cụ thể và quyền hạn giới hạn; không tự chuyển chủ booking. Permanent transfer đóng trách nhiệm A, mở trách nhiệm B tại T, cập nhật `handled_by`; không xóa lịch sử A. Quản lý đúng khách sạn là người phê duyệt; trường hợp có khách đứng tại quầy thì cần tuyến xử lý khẩn cấp trong phạm vi quyền để không bỏ mặc khách.

### 3.2. Luồng thứ nhất — tạm thời hỗ trợ thay A trong khoảng thời gian T

```text
A gửi đơn nghỉ -> manager duyệt -> availability block -> coverage alert
 -> manager mở booking có A đang phụ trách
 -> chọn 'Hỗ trợ thay tạm thời' + B + start/end + allowedTaskTypes
 -> POST /booking-coverage/:bookingId/temporary
 -> authorization manager same hotel; A/B active role; B available; no overlap contradictory
 -> transaction: create coverage_grant [ACTIVE], scope, expiry, reason, actor
 -> outbox thông báo A/B/customer nếu có thay đổi đầu mối tại quầy
 -> B mở booking, hệ thống kiểm tra coverage grant + thời gian + task scope
 -> B check-in thay hoặc giải quyết task được ủy quyền
 -> task event.actor_staff_id = B; booking.handled_by vẫn A
 -> hết endAt: không cấp việc mới cho B nếu chưa gia hạn;
                 task B đã CLAIMED trước hạn có thể hoàn tất đúng chính sách
 -> manager xác nhận kết thúc/gia hạn hoặc chuyển hẳn nếu A chưa quay lại
```

**Phạm vi `allowedTaskTypes` đề nghị:** `CHECK_IN`, `CHECK_OUT`, `PRE_ARRIVAL_CONTACT`, `SERVICE_RESPONSE`, `COMPLAINT_HANDLE`, `ALL_SERVICE_TASKS` (manager-only cho ALL). Mặc định khi tạm thay do A nghỉ đúng giờ khách đến: **chỉ `CHECK_IN` và `ARRIVAL_SUPPORT`**, không tự cho B xem mọi booking/tài khoản của A. Quyền chỉ áp dụng booking cụ thể và hotel cụ thể.

**Mốc thời gian**: tại 09:00 cấp coverage 120 phút => B có thể nhận task mới tới trước 11:00; nếu B nhận check-in lúc 10:59 và đến 11:05 mới hoàn tất, được hoàn tất task đã claim (không tự cấp thêm quyền cho task mới). Nếu khách đến 11:10 và A vẫn nghỉ, manager gia hạn hoặc mở coverage mới; có thể chuyển permanent. Không làm `booking.handled_by` nhảy A↔B mỗi lần B thực hiện tác vụ.

**Tình huống B cũng nghỉ/bị BLOCKED sau khi nhận coverage:** grant không còn đủ điều kiện để cấp task mới; hiển thị cảnh báo ngay, manager cấp cho C. Task đang dở của B cần `TASK_HANDOVER_REQUIRED`; không ghi completion giả. Nếu A quay lại trước hạn, quản lý có thể kết thúc coverage sớm có lý do, nhưng sự kiện B đã làm vẫn thuộc B.

### 3.3. Luồng thứ hai — chuyển giao hoàn toàn A sang B tại thời điểm T

```text
Manager chọn 'Chuyển giao hoàn toàn' trong booking
 -> GET preview: current owner A, unfinished tasks, absence/conflicts, candidate B
 -> chọn B và lý do A nghỉ dài/nghỉ việc/không thể tiếp tục
 -> POST /booking-coverage/:bookingId/permanent-transfer
      { toStaffUserId, reason, expectedAssignmentVersion, commandId }
 -> HotelAccessPolicy.validateManager + target receptionist same hotel ACTIVE
 -> transaction LOCK booking + booking_assignment_state
      ASSERT status permits transfer: PENDING/CONFIRMED/NO_SHOW/CHECKED_IN
      ASSERT version matches
      close A assignment (ended_at = T)
      create B assignment (assigned_at = T, type = PERMANENT_TRANSFER)
      update assignment_state/current B and bookings.handled_by = B
      review unfinished tasks: pending -> B; in-progress -> handover needed
      append coverage/assignment events; outbox alert A/B/customer
      COMMIT
 -> UI hiển thị lịch sử A [trước T] và B [từ T]; KPI theo actor task
```

**Quan trọng:** source hiện tại `BookingsService.reassignStaff()` **cấm khi `CHECKED_IN`** và ghi `bookings.handled_by` trực tiếp. Không nên đơn giản xóa một câu `if` rồi cho mọi EMPLOYEE sửa owner. Thay bằng `BookingTransferService.transferPermanent()` kiểm tra manager cùng hotel, transaction, version, unfinished tasks và audit. Giữ endpoint legacy `PATCH /bookings/:id/reassign` bằng adapter chuyển tới service mới khi flag bật; giữ request/response tương thích với modal hiện có. Chỉ manager chuyển hẳn, không cho receptionist tự giao booking của người khác.

**Booking đã `COMPLETED/CANCELLED/CLOSED_NO_SHOW`:** không chuyển người phụ trách chính nữa; nếu phát hiện sai người thực hiện trong quá khứ, dùng cơ chế adjustment có biên bản, không backdate việc chuyển giao.

### 3.4. Một booking, hai loại danh tính trong cơ sở dữ liệu

- `bookings.handled_by`: **người chịu trách nhiệm chính hiện tại** (mirror tương thích UI cũ).
- `booking_assignment_state.current_staff_id`: chủ chính hiện tại có version, được cập nhật trong transaction.
- `booking_assignments`: các khoảng A/B phụ trách chính, không xóa lịch sử.
- `booking_coverage_grants`: B có quyền xử lý thay trong `[startAt,endAt)` nhưng không làm chủ chính.
- `guest_work_events.actor_staff_id`: **người làm thật** của từng tác vụ; bất biến sau commit.
- `guest_work_tasks.assigned_staff_id`: người đang cần thực hiện task; có thể khác owner booking do coverage/transfer.

**Ví dụ không mất KPI:** booking 502 có A tư vấn qua tác vụ `PRE_ARRIVAL_CONTACT` ngày 15/08, A hoàn tất 08:45; B check-in muộn ngày 17/08 10:00; ngày 18/08 manager chuyển permanent sang C. KPI A giữ sự kiện tư vấn, B giữ check-in, C nhận nhiệm vụ đã giao lại kể từ ngày 18. **Không nhân viên nào tự nhận toàn bộ doanh thu/booking chỉ do đang nằm trong `handled_by`.**

### 3.5. Bảng nghiệp vụ cần thêm và index

| Bảng | Trường chính | Ràng buộc / giải thích |
|---|---|---|
| `booking_coverage_grants` | id, booking_id, hotel_id, principal_staff_id, delegate_staff_id, mode=TEMPORARY, start_at, end_at, status, allowed_task_types JSON, created_by, reason, version | Unique request `command_key`; grant có trạng thái ACTIVE/EXPIRED/REVOKED; `(booking_id, start_at, end_at)` để lọc. |
| `booking_coverage_events` | id, grant_id, booking_id, event_type, actor_id, old_value/new_value JSON, occurred_at | Lưu grant/extend/revoke/expire, không xóa. |
| `guest_work_tasks` (phối hợp Đợt 4) | id, booking_id, type, assignee, claimed_at, status, due_at, completed_at, assignment_source | Giữ task chưa xong khi transfer; dữ liệu có thể tạo sớm ở Đợt 3 cho check-in/out. |
| `booking_assignments` | Các dòng A/B, source `PERMANENT_TRANSFER` | Đã tạo ở Đợt 1, chỉ bổ sung loại nguyên nhân, link event. |
| `booking_assignment_state` | `current_assignment_id`, `version` | Update cùng transaction với `bookings.handled_by`. |

**Chống overgrant:** hai coverage cùng khoảng cho cùng booking và cùng task type phải có chính sách. Đề xuất chỉ **một người điều phối thay mặc định** cho một loại task tại một thời điểm, nhưng manager có thể phân chia hai tác vụ khác nhau cho B/C, không tạo hai quyền cùng xử lý CHECK_IN. Kiểm tra trong transaction, không dựa vào disable button ở UI.

### 3.6. Quyền tác vụ không đồng nghĩa quyền owner

`HotelAccessPolicy` phải tách các hàm:

```ts
canViewBooking(user, booking);       // CUSTOMER owner / MANAGER hotel / assigned staff / coverage scope
canManageHotel(user, hotelId);       // MANAGER tại hotel hoặc ADMIN kỹ thuật
canTransferOwner(user, booking);     // chỉ manager hotel/admin
canExecuteTask(user, taskOrBooking); // current owner hoặc active coverage cho đúng task
canReadKpi(user, staffId, hotelId);  // self hoặc manager hotel
```

Nếu A bị khóa/đã thôi việc, A không còn quyền đăng nhập hoặc nhận việc, **nhưng actorId của các sự kiện cũ vẫn nguyên**. Khi B coverage, B chỉ xem booking và dữ liệu cần thiết cho tác vụ được ủy quyền, không được xem toàn bộ lịch sử tài chính/booking của nhân viên A tại các hotel khác.

**Xử lý khẩn cấp:** khách đã đến quầy trong khi A nghỉ, và manager chưa lập grant. Có thể cho manager tự thực hiện check-in; hoặc manager tạo grant nhanh cho B (hợp lệ theo quyền). Nếu cho B xử lý trước do tình huống khẩn cấp, hệ thống phải tạo yêu cầu xác minh sự kiện có audit và thời gian thực, **không cho cấp quyền retrospective ngầm để hợp thức hóa thao tác không có quyền**.

### 3.7. Backend: file-level implementation

| File | Sửa/tạo thực tế |
|---|---|
| **[TẠO]** `backend/src/booking-coverage/booking-coverage.controller.ts` | API temporary/extend/revoke/permanent-transfer/preview/history; tất cả kiểm tra JWT và hotel. |
| **[TẠO]** `backend/src/booking-coverage/booking-coverage.service.ts` | `createTemporary`, `extend`, `revoke`, `transferPermanent`, `expireCoverage`, `listCoverage`; kiểm tra quyền/transaction/version. |
| **[TẠO]** `backend/src/booking-coverage/entities/booking-coverage-grant.entity.ts`, `booking-coverage-event.entity.ts` | ORM mapping, unique/index, không xóa vết. |
| **[TẠO]** `backend/src/booking-coverage/dto/create-temporary-coverage.dto.ts`, `permanent-transfer.dto.ts`, `extend-coverage.dto.ts` | Validate 15 phút <= duration <= 24 giờ, scope, toStaffUserId, expectedVersion, commandId. |
| **[SỬA]** `backend/src/bookings/bookings.service.ts` | `reassignStaff()` đổi thành adapter gọi service transfer có khóa/version; bỏ cấm CHECKED_IN **chỉ cho phép** qua permanent transfer manager, không mở bừa cho tất cả user. |
| **[SỬA]** `backend/src/bookings/dto/reassign-staff.dto.ts` | Giữ `staffUserId`/`note` cũ; bổ sung `expectedVersion?`, `reasonCode?` optional để frontend cũ không hỏng. |
| **[SỬA]** `backend/src/bookings/bookings.controller.ts` | Truyền `@CurrentUser` bắt buộc; route legacy `PATCH /:id/reassign` giữ nguyên và trả shape cũ. |
| **[SỬA]** `backend/src/bookings/services/booking-access.service.ts` | Bổ sung method policy chi tiết theo booking owner/coverage; giữ behavior xem booking của khách và manager. |
| **[SỬA]** `backend/src/booking-presence/booking-presence.service.ts` | Khi B check-in thay, resolve `canExecuteTask` bằng coverage grant; ghi **B** là actor, không đổi A owner. |
| **[SỬA]** `backend/src/staff-availability/staff-availability.service.ts` | Khi duyệt nghỉ có booking trùng mốc cần phục vụ, phát `booking.coverage.required`/dashboard alert, không xóa assignment. |
| **[TẠO]** `database/migration_booking_coverage_v2.sql` | Tạo coverage_grants/events, indexes, task bridge; toàn bộ ADD. |

### 3.8. Frontend: không nhồi tất cả vào trang 2.400 dòng

| File | Nội dung |
|---|---|
| **[TẠO]** `src/services/api/booking-coverage.api.ts` | `previewTransfer`, `createTemporary`, `extendTemporary`, `revoke`, `transferPermanent`, `getTimeline`; type fields theo hợp đồng backend. |
| **[TẠO]** `src/components/booking/TemporaryCoverageDialog.tsx` | Chọn B, quyền tác vụ, start/end, lý do, preview xung đột availability; default 120 phút, range 15 phút–24 giờ. |
| **[TẠO]** `src/components/booking/PermanentTransferDialog.tsx` | Cho manager chọn B, kiểm tra unfinished tasks, nhập lý do, xác nhận chuyển. |
| **[TẠO]** `src/components/booking/AssignmentHistoryPanel.tsx` | Timeline A/B, ai quyết định, thời hạn, công việc đã thực hiện. |
| **[SỬA]** `src/app/(dashboard)/bookings/page.tsx` | Hàm `openReassignModal` hiện chặn CHECKED_IN: sửa UI thành hai action riêng (temporary/permanent), condition theo quyền manager + status hợp lệ; vẫn giữ modal reassign cũ khi feature off. |
| **[SỬA]** `src/services/api/booking.api.ts` | Adapter `reassignStaff()` không đổi shape cũ; chỉ bổ sung field `assignmentVersion`, coverage summary để màn mới dùng. |
| **[SỬA]** `src/app/(dashboard)/staff-requests/management/page.tsx` | Từ đơn nghỉ đã duyệt, dẫn trực tiếp đến danh sách booking cần cover. |
| **[SỬA]** `src/components/dashboard/Sidebar.tsx` | Chỉ hiện công việc đúng role, không cần một menu module ca trực mới. |

### 3.9. API và logic quá hạn coverage

```json
POST /booking-coverage/502/temporary
{
  "delegateStaffUserId": "83",
  "startAt": "2026-11-02T02:00:00.000Z",
  "endAt": "2026-11-02T04:00:00.000Z",
  "allowedTaskTypes": ["CHECK_IN", "ARRIVAL_SUPPORT"],
  "reason": "A nghỉ đã được duyệt",
  "expectedAssignmentVersion": 2,
  "commandId": "coverage-502-20261102-01"
}

POST /booking-coverage/502/permanent-transfer
{
  "toStaffUserId": "83",
  "reasonCode": "STAFF_LONG_ABSENCE",
  "reason": "A nghỉ dài ngày, B tiếp nhận toàn bộ",
  "expectedAssignmentVersion": 2,
  "commandId": "transfer-502-02"
}
```

**Worker hết hạn:** mọi 5 phút quét grant đến endAt, đổi ACTIVE -> EXPIRED nếu chưa gia hạn; báo manager khi A vẫn absent. Không đóng task đang IN_PROGRESS do B đã nhận hợp lệ, nhưng gắn hạn giao việc mới. Quyết định gia hạn phải được ghi trước khi B nhận tiếp nhiệm vụ.

### 3.10. Regression và tiêu chí đóng Đợt 3

- A tư vấn -> B check-in thay trong 120 phút -> booking owner vẫn A; sự kiện check-in actor B; đánh giá phần check-in gắn B; không tạo thêm booking/payment.
- A tư vấn -> manager transfer hoàn toàn sang B khi `CHECKED_IN` -> owner chuyển B; A giữ history, B xử lý yêu cầu sau T; completed/cancelled không cho transfer.
- A nghỉ sau khi đã được giao -> tạo alert; không ép mọi booking A chuyển tự động; manager chọn scope. B vắng mặt -> không được nhận coverage mới.
- Hai manager cùng transfer booking một lúc -> một transaction thắng, transaction sau nhận 409/refresh; không có hai owner active.
- Hết 120 phút -> B không nhận task mới, nhưng hoàn thành task đã claim được; manager có thể gia hạn hoặc chuyển hẳn. Hành vi 40/120 phút **phân công booking mới** độc lập với thời hạn **coverage 120 phút** (hai khái niệm không được trộn).
- API reassign cũ vẫn hoạt động trên booking chưa check-in và trả shape tương thích; front desk và refund không thay đổi.

**Tiêu chí đóng:** có thể phục vụ khách liên tục dù A nghỉ; quy tắc trách nhiệm và KPI A/B không nhập nhằng; không cấp quyền vượt hotel/phạm vi/tạm thời.


---

## ĐỢT 4. KIẾN TRÚC CÔNG VIỆC, NHẬT KÝ CÓ BẰNG CHỨNG, SLA VÀ GIAO VIỆC THEO BOOKING

### 4.1. Vì sao cần một lớp Task/Event riêng

Nếu lễ tân bấm nút “Đã hỗ trợ” trên Dashboard mà không có dữ liệu kiểm chứng, hệ thống không thể kết luận họ đã phản hồi khách nhanh hay xử lý xong yêu cầu. `ServiceRequest` hiện có `accepted_at`, `started_at`, `completed_at`, `confirmed_at`, `sla_due_at` và `assigned_to`, nhưng **chưa đủ để chứng minh ai thật sự làm gì** hoặc ai là người đã làm trước khi A chuyển giao cho B. Trong source, `ServicesService.updateServiceRequestStatus()` hiện **không nhận actor người dùng**, còn `ServicesController PUT /services/requests/:id/status` không truyền `@CurrentUser` xuống; phải bổ sung kiểm tra người thực hiện tại đây.

Kiến trúc mục tiêu: **task có trạng thái và người được giao; event là bằng chứng bất biến về hành động; review đánh giá người đã thực hiện task, không đánh giá từ cờ owner booking**. Task trước nhận phòng, thủ tục check-in, yêu cầu lưu trú, giải quyết sự cố và checkout là các loại task khác nhau nhưng sử dụng một core giống nhau.

### 4.2. Luồng vận hành mẫu từ A tư vấn đến B xử lý sự cố

**Tình huống 1 — pre-arrival:** booking PAID được giao A lúc 08:30. Hệ thống tạo task `PRE_ARRIVAL_CONTACT` gắn A. A gửi thông tin check-in qua kênh nhắn tin tích hợp hoặc ghi nhận cuộc gọi; event ghi `message_sent_at` do server hoặc ghi minh chứng cuộc gọi. Nếu chỉ bấm “Đã gọi” mà không có log cuộc gọi hay xác nhận khách, ghi `EVIDENCE_SELF_REPORTED`, không tự tính như phản hồi xác minh.

**Tình huống 2 — check-in B thay:** A nghỉ đã duyệt, B có coverage `CHECK_IN` từ 09:00–11:00. B làm xác minh tại quầy và bấm check-in lúc 10:10. PresenceService tạo actual check-in và guest-work event trong một transaction, `actor_staff_id = B`, `booking_owner_at_time = A`, `coverage_grant_id` xác định B được phép làm thay. Một completion check-in sinh **một** KPI event, không phải một cho A và một cho B.

**Tình huống 3 — khách đang ở yêu cầu khăn/đổi dịch vụ:** khách có booking CHECKED_IN tạo service request lúc 18:00. Hệ thống đọc **owner hiện tại hoặc active coverage theo task type** để đề xuất assignee. A hoặc B được giao, nhận request, bắt đầu, hoàn tất; mốc tiếp nhận/hoàn tất do server ghi. Khách xác nhận đã nhận dịch vụ; nếu không xác nhận thì quản lý có thể xác minh có lý do, giữ hai trường actor khác nhau.

**Tình huống 4 — khách than phiền:** khách gửi khiếu nại lúc 21:00, mức ưu tiên cao, deadline theo rule; A phản hồi 21:05, B được giao tiếp lúc 21:15 do A đã hết thời gian làm việc; task history ghi các hoạt động của A/B, SLA giải quyết không bị reset khi chuyển người. Điểm phản hồi đầu thuộc A, điểm xử lý hoàn tất thuộc B nếu chứng cứ cho phép. Không đổi timestamps gốc để làm đẹp SLA.

**Tình huống 5 — khách không phát sinh dịch vụ:** booking chỉ pre-arrival + check-in/out, không có service request. Không tạo task giả để lấy KPI; các chỉ tiêu không có dữ liệu chuyển `N/A` ở Đợt 5 chứ không cho 0 điểm hoặc tự cho 100 điểm.

### 4.3. State machine Task và sự kiện

```text
CREATED -> ASSIGNED -> ACCEPTED -> IN_PROGRESS -> COMPLETED -> VERIFIED
     |         |          |           |           |
     +---------+----------+-----------+-------> CANCELLED / FAILED
                                  |
                                  +-- HANDOVER_REQUIRED -> ASSIGNED(new staff)
```

- `CREATED`: server ghi, có booking/khách sạn/type/source.
- `ASSIGNED`: có người nhận task từ owner hoặc coverage; `assignment_at` server.
- `ACCEPTED`: lễ tân thực sự nhận, `accepted_at` server; không phải chỉ đã đọc thông báo.
- `IN_PROGRESS`: có bước xử lý, `started_at`; cần tránh tự ý chuyển ngược.
- `COMPLETED`: nhân viên tuyên bố hoàn thành, `completed_at`, event actor.
- `VERIFIED`: khách hoặc quản lý có chứng cứ xác nhận kết quả; đánh giá chất lượng dựa vào thông tin này.
- `HANDOVER_REQUIRED`: khi A nghỉ/chuyển giao trong lúc task dở; B nhận task với deadline ban đầu, không reset SLA.

**Nguyên tắc nguồn sự thật:** event append-only `guest_work_events` là căn cứ tính KPI, `guest_work_tasks` là trạng thái hiện hành. Mọi thao tác cập nhật status phải đi qua use case có kiểm tra version và actor, không chỉ `repository.save()` tùy ý từ nhiều controller.

### 4.4. Luồng API yêu cầu dịch vụ giữ tương thích legacy

```text
Khách CHECKED_IN mở trang dịch vụ -> POST /services/requests [route cũ]
 -> ServicesController JwtAuthGuard lấy @CurrentUser
 -> ServicesService.createServiceRequest() [GIỮ giá, snapshot, quota]
 -> GuestWorkIntegration.onServiceRequestCreated(saved, actor)
      tạo task SERVICE_REQUEST, sao chép booking/hotel/source_id
      chọn người phụ trách hiện tại hoặc active coverage theo task
      lưu event TASK_CREATED/TASK_ASSIGNED
 -> emit service requested [GIỮ event cũ]
 -> A/B nhận thông báo trên Dashboard -> PUT /services/requests/:id/status [route cũ]
 -> ServicesService.updateServiceRequestStatus(..., actor)
      assert actor belongs to same hotel AND is assigned/granted/manager
      validate legal status transition
      preserve SLA original, server timestamps
      persist req and guest_work_event inside transaction
 -> customer confirm hoặc manager verify bằng evidence -> VERIFIED
 -> KPI worker đọc event, không đọc mỗi status hiện thời
```

**Phần rủi ro trong source:** các phương thức `ServicesService.updateServiceRequest()` và `updateServiceRequestStatus()` hiện không có user và sửa `assignedTo`, `completedAt`, `confirmedAt` trực tiếp. Để không làm mất API cũ, controller giữ nguyên URL/body nhưng **thêm `@CurrentUser`** rồi service bắt buộc resolve booking/hotel, role và quyền task. Những giá trị timestamp do trình duyệt tự gửi chỉ có thể là ghi chú khai báo (`claimedOccurredAt`), **không** ghi đè actual server time dành cho KPI. Thao tác nhập lại dữ liệu lịch sử của manager phải qua adjustment có kiểm toán.

### 4.5. Phản hồi lần đầu: phải có giao tiếp thật, không dựa vào checkbox

Vì `backend/src/chat/chat.service.ts` trong nhánh `minh` chủ yếu là bot tư vấn/tìm kiếm khách sạn, **không được coi phản hồi chatbot là lễ tân phản hồi khách**. Có hai mức khả thi:

- **Mức tối thiểu cho MVP:** trong Dashboard tạo yêu cầu hỗ trợ có ghi nội dung; lễ tân gửi câu trả lời **thực qua website** tới đúng booking. Hệ thống ghi server timestamp của message được lưu thành công và actor; `first_response_at` bằng tin nhắn phản hồi hợp lệ đầu tiên. Nếu lễ tân chỉ gọi điện/giải quyết trực tiếp, lưu `self_reported` + chứng cứ hoặc khách xác nhận, không tự cho điểm phản hồi như chat.
- **Mức mở rộng:** kết nối tổng đài/SMS/CRM nếu được phép, nhận webhook đã xác minh; record source `PHONE_PROVIDER`/`SMS_PROVIDER`. Không đặt giả external message timestamp để có KPI.

Thiết kế kênh nhắn tin tối thiểu nên dùng module `guest-conversations` độc lập, không can thiệp prompt hoặc nội dung `ChatService` bot cũ. Customer chỉ xem và gửi trong booking của mình; receptionist chỉ xem những conversation được giao/coverage; manager xem tại hotel của mình khi cần giám sát.

### 4.6. SLA: định nghĩa đồng hồ và khoảng tạm dừng hợp lý

- `responseSlaDueAt`: tính từ lúc khách gửi yêu cầu có thể phục vụ, trừ ngoại lệ được công bố rõ. `firstResponseAt`: thời điểm server lưu phản hồi đầu có nội dung thật; phản hồi tự động không tính.
- `resolutionSlaDueAt`: mức deadline theo loại task, độ ưu tiên; cần lưu snapshot deadline lúc tạo, không tính lại khi manager thay rule sau đó.
- `completedAt`: do server ghi khi chuyển COMPLETED; `verifiedAt` riêng khi khách/manager xác nhận. Không cho thao tác hoàn tất thất bại vượt SLA xóa lịch sử vi phạm.
- Nếu khách đang đợi cung cấp thông tin, có thể chuyển `WAITING_CUSTOMER` và tạm dừng đồng hồ **chỉ nếu chính sách SLA cho phép và có sự kiện lý do**, không tự bỏ thời gian chờ khỏi mẫu số. Không reset SLA khi A chuyển B.
- Với complaint có severity HIGH, tạo cảnh báo manager trước hạn, escalation khi quá hạn; không làm nhiệm vụ của manager tự động kết thúc complaint.

### 4.7. Database và index đề xuất

| Bảng | Trường tối thiểu | Lưu ý |
|---|---|---|
| `guest_work_tasks` | id, hotel_id, booking_id, type, source_table, source_id, current_assignee, owner_at_create, status, priority, response_sla_due_at, resolution_sla_due_at, first_response_at, started_at, completed_at, verified_at, version | Index `(hotel_id,current_assignee,status,due_at)`, `(booking_id,type)`, unique `(source_table, source_id, type)` để không tạo task lặp cho service_request. |
| `guest_work_events` | id, task_id, booking_id, hotel_id, actor_type, actor_staff_id nullable, event_type, from/to status, occurred_at, recorded_at, evidence_type, evidence_ref, source_event_id, idempotency_key | Append-only; unique idempotency key; không hard-delete. |
| `guest_conversations` | id, booking_id, hotel_id, status, created_at | Mỗi conversation gắn booking thật, check actor scope. |
| `guest_messages` | id, conversation_id, sender_user_id, sender_role, body, sent_at, delivery_status, client_msg_id | Unique `(conversation_id, client_msg_id)`; server timestamp; text sanitize và hạn chế file upload. |
| `guest_work_evidence` | id, task_id, submitted_by, type, storage_ref, verification_status, verified_by, verified_at | Bảo vệ tệp, không cho tải bằng URL public nếu chứa thông tin cá nhân. |
| `staff_availability_blocks` | Đã có từ Đợt 1 | Cho phép assignment/task engine kiểm tra thời gian khi nhận task mới; task đã nhận không tự xóa. |

**Sự kiện đồng bộ với bảng cũ:** với request đã tồn tại trước triển khai, migration **không giả lập** `firstResponseAt` nếu không có dữ liệu giao tiếp thật. `ServiceRequest` có thể tạo `legacy task` với mức bằng chứng `HISTORICAL_IMPORT`, không được chấm KPI phản hồi theo mốc tự suy đoán.

### 4.8. Backend: bổ sung file cụ thể

| File | Sửa/tạo |
|---|---|
| **[TẠO]** `backend/src/guest-work/guest-work.module.ts`, `guest-work.controller.ts`, `guest-work.service.ts` | CRUD tác vụ, claim, complete, verify, handover, history. Không truy vấn thanh toán trừ khi cần validate booking. |
| **[TẠO]** `backend/src/guest-work/guest-work-events.service.ts` | Hàm ghi event tập trung: validate actor, event code, idempotency, append-only. |
| **[TẠO]** `backend/src/guest-work/entities/guest-work-task.entity.ts`, `guest-work-event.entity.ts`, `guest-work-evidence.entity.ts` | ORM schema với index, version. |
| **[TẠO]** `backend/src/guest-work/dto/create-work-task.dto.ts`, `claim-task.dto.ts`, `complete-task.dto.ts`, `verify-task.dto.ts` | DTO whitelist để client không tự gửi `actor_staff_id`/`actual_completed_at`. |
| **[TẠO]** `backend/src/guest-conversations/*` | Controller/service/entities/DTO cho kênh nhắn tin người–người; không thay code bot hiện có. |
| **[SỬA]** `backend/src/services/services.controller.ts` | Thêm `@CurrentUser()` cho PUT request/update status; route và response cũ giữ. |
| **[SỬA]** `backend/src/services/services.service.ts` | `updateServiceRequest`, `updateServiceRequestStatus`: check hotel/assignee/coverage, validate transitions, ghi guest-work event; `createServiceRequest` thêm task sau khi save thành công, không đổi chính sách giá/snapshot hiện tại. |
| **[SỬA]** `backend/src/services/services.module.ts` | Import GuestWorkModule/adapter; không tạo import ngược từ GuestWorkModule vào ServicesModule. |
| **[SỬA]** `backend/src/booking-coverage/booking-coverage.service.ts` | Transfer A→B phải rà soát unfinished tasks/ownership; không sửa lịch sử event đã lưu. |
| **[SỬA]** `backend/src/booking-presence/booking-presence.service.ts` | Ghi tác vụ CHECK_IN/CHECK_OUT một lần, actor thực hiện thật; công việc không làm ảnh hưởng hold. |
| **[TẠO]** `database/migration_guest_work_and_messages.sql` | Thêm task/events/messages/evidence, index, không sửa `service_requests` status enum. |

### 4.9. Frontend: trang và state handling

| File | Trách nhiệm |
|---|---|
| **[TẠO]** `src/services/api/guest-work.api.ts`, `guest-conversations.api.ts` | Typed API, retry-safe commandId, phân biệt `409` conflict, `403` invalid coverage. |
| **[TẠO]** `src/app/(dashboard)/my-tasks/page.tsx` | Lễ tân xem task assigned/accepted/in-progress, SLA, quyền coverage và bằng chứng; không thấy dữ liệu hotel khác. |
| **[TẠO]** `src/app/(dashboard)/service-monitor/page.tsx` | Quản lý lọc theo hotel/status/đến hạn/vi phạm SLA, mở timeline và giao việc. |
| **[TẠO]** `src/components/guest-work/TaskTimeline.tsx`, `TaskActionPanel.tsx`, `EvidencePanel.tsx` | Các component có đủ trạng thái loading/expired/conflict/forbidden; không cho thao tác complete 2 lần. |
| **[TẠO]** `src/components/booking/GuestConversation.tsx` | Chat có message thật và server-sent time; không mượn nội dung bot tìm khách sạn để tính KPI. |
| **[SỬA]** `src/app/(dashboard)/services/page.tsx`, `src/services/api/services.api.ts` | Bổ sung nhãn assignee/SLA/task status, không phá form dịch vụ/giá và endpoint cũ. |
| **[SỬA]** `src/components/booking/BookingHistory.tsx` | Khách gửi yêu cầu và xác nhận kết quả; guest chỉ thấy booking của mình. |

### 4.10. API chính, trường hợp lỗi và test

```text
GET  /guest-work/me?status=IN_PROGRESS
GET  /guest-work/booking/:bookingId
POST /guest-work/:taskId/accept            {commandId, expectedVersion}
POST /guest-work/:taskId/complete          {commandId, expectedVersion, evidenceRef?}
POST /guest-work/:taskId/verify            {decision, note?, evidenceRef?}
POST /guest-conversations/booking/:bookingId/messages
GET  /guest-conversations/booking/:bookingId/messages
```

- Nhân viên ngoài hotel trả 403; nhân viên cùng hotel nhưng không được giao/coverage trả 403 với endpoint thao tác; manager được xem giám sát đúng hotel.
- Message của chatbot không được chấm `firstResponse`; tin nhắn nhân viên gửi thành công được server ghi mốc; message retry cùng `client_msg_id` không nhân đôi KPI.
- Dịch vụ `PENDING -> COMPLETED` bằng cách bypass chuỗi trạng thái khi chưa đủ bước xử lý bị từ chối 422, trừ các transition legacy có căn cứ và đặc tả rõ để không phá chức năng đang dùng.
- SLA quá hạn dù đổi người vẫn tính theo deadline gốc; manager xem breach; failed request/recovery giữ lịch sử nguyên bản.
- Service request lỗi ghi event sau khi trạng thái DB đã commit? **Không để trạng thái thay đổi mà event mất dấu**: ghi event cùng transaction với state; outbox email/socket ngoài transaction. Nếu legacy update không được gói transaction trước đó, phải đưa vào transaction riêng có test.

**Tiêu chí đóng Đợt 4:** mọi thao tác phục vụ quan trọng biết được *ai làm, làm lúc nào, theo quyền gì, kết quả gì và chứng cứ ở mức nào*, với dữ liệu đủ để chấm KPI minh bạch ở Đợt 5.

---

## ĐỢT 5. KIẾN TRÚC KPI 100 ĐIỂM, KHÁCH ĐÁNH GIÁ SAO, QUẢN LÝ XÁC MINH

### 5.1. Từ thống kê số đơn sang điểm hiệu suất có kiểm toán

Hiện `backend/src/bookings/bookings.service.ts:getStaffPerformance()` tổng hợp booking trực tiếp, `handled_by`, dịch vụ `assigned_to` và dữ liệu ca trực. Đó là một bảng **thống kê khối lượng**, chưa phải chấm KPI theo tác vụ có bằng chứng. Hàm còn truy vấn `staff_shifts.status` theo `OPEN/CLOSED` trong khi mô hình shifts dùng `ACTIVE/COMPLETED` và migration bootstrap chưa có bảng shifts đầy đủ. Vì **chưa triển khai ca trực**, KPI v2 tuyệt đối không phụ thuộc shifts; endpoint thống kê cũ chỉ được giữ tương thích, tránh gây lỗi trang hiện hành bằng kiểm tra schema/giảm cấp graceful khi bảng không tồn tại.

Không chuyển điểm/doanh thu của A sang B chỉ vì `booking.handled_by` đổi. Tạo nguồn dữ liệu KPI mới chủ yếu từ `guest_work_events`, `guest_reviews`, `staff_kpi_adjustments` có nguồn gốc, tính theo kỳ và **actor thực hiện**.

### 5.2. Công thức mục tiêu, trọng số, điều kiện đủ mẫu

| Nhóm KPI | Điểm tối đa | Dữ liệu và người được chấm |
|---|---:|---|
| Phản hồi khách đúng SLA | 10 | Message đầu tiên **có nội dung thật** do actor lễ tân gửi, so với thời gian yêu cầu; exclude bot. |
| Chuẩn bị trước check-in | 10 | Task pre-arrival đủ bước và bằng chứng; actor người thực hiện, không phải booking owner hiện hành. |
| Check-in/check-out đúng quy trình | 15 | Presence events thành công, đúng actor A hoặc B; không tính khách No-show là thất bại của A. |
| Xử lý dịch vụ đúng SLA | 15 | Guest-work events/service requests VERIFIED và deadline ban đầu. |
| Giải quyết sự cố/khiếu nại | 10 | Severity, thời gian xử lý, kết quả xác minh, không cộng điểm cho giải quyết giả. |
| Tuân thủ và độ chính xác | 10 | Event kiểm tra, lỗi có minh chứng và phản hồi đã xác minh. |
| Khách đánh giá nhân viên (1–5 sao) | 20 | Review gắn booking + staff + giai đoạn dịch vụ thật; thông tin người đánh giá hợp lệ. |
| Quản lý đánh giá có chứng cứ | 10 | Nhận xét có minh chứng, giới hạn phạm vi và lịch sử phê duyệt. |
| **Tổng** | **100** | Có thể version hóa policy theo khách sạn/kỳ; không sửa ngược kỳ đã LOCKED. |

**Điểm số một tiêu chí** = `weight * normalizedPerformance(metric)` với `normalizedPerformance` trong `[0,1]`; ví dụ tỷ lệ phản hồi đúng SLA = `onTimeFirstReplies / eligibleRequests`, không bao gồm tin bot. Chỉ tiêu sai sót có quy tắc trừ minh bạch và giới hạn, **không** suy từ điểm sao. Hệ thống phải hiển thị cả `numerator`, `denominator`, `excludedCount`, `evidenceCount`, `policyVersion` để người bị đánh giá biết vì sao có điểm đó.

**Dữ liệu không đủ (`N/A`):** `eligibleRequests=0`, nhân viên chỉ làm pre-arrival vì khách No-show, hoặc khách không để lại sao thì **không** được chấm 0 hoặc tự cho tối đa. Tính `totalScore = 100 * sum(achievedApplicableWeights) / sum(applicableWeights)`; hiển thị `coverageRatio = sum(applicableWeights)/100` và độ tin cậy. Nếu số mẫu rất thấp, gắn `LOW_SAMPLE`, không xếp hạng tuyệt đối. Chính sách có thể yêu cầu đủ lượng task/review tối thiểu trước khi xếp hạng tháng.

**Không dùng doanh thu toàn booking để tính trực tiếp 70 điểm vận hành.** Doanh số trực tiếp từ booking do nhân viên tự bán có thể là báo cáo thương mại song song; tiền khách tự đặt trên web không trở thành thành tích bán của B chỉ vì B check-in.

### 5.3. Luồng khách đánh giá người phục vụ đúng giai đoạn

```text
Customer đăng nhập -> GET /bookings/me hoặc booking history
 -> chọn booking đã có bước phục vụ thật
 -> GET /staff-reviews/booking/:bookingId/eligible
      backend đọc guest_work_events/presence events
      xây tập (staffId, stage) đã được phục vụ: PRE_ARRIVAL, CHECK_IN, IN_STAY, CHECK_OUT
 -> FE hiển thị từng nhân viên và giai đoạn khách đã thực sự trải nghiệm
 -> khách chọn 1..5 sao và nhận xét phù hợp
 -> POST /staff-reviews
      {bookingId, staffUserId, stage, stars, comment?, commandId}
 -> auth verify booking.user_id = JWT user, stage thực tế, actor thực hiện task
 -> unique (bookingId, staffUserId, stage, reviewerUserId)
 -> lưu review + version + audit; không đè/hủy bản cũ âm thầm
 -> KPI engine recalculate draft period -> manager xem tổng hợp
```

**Ví dụ A/B:** A tư vấn qua tin nhắn nhưng B nhận phòng; khách có thể đánh giá A cho PRE_ARRIVAL và B cho CHECK_IN/IN_STAY. Không được hiển thị duy nhất “Nhân viên hiện tại B” rồi bắt khách chấm cả quá trình cho B. Với No-show, chỉ liệt kê `PRE_ARRIVAL` nếu A đã hỗ trợ thật; không hiển thị `IN_STAY` hoặc `CHECK_OUT` chưa xảy ra.

**Anti-fraud:** cùng booking/nhân viên/giai đoạn chỉ có một đánh giá hiệu lực mỗi khách; nếu sửa sao phải tạo review revision, giữ bản cũ; không cho đánh giá người không có event; giới hạn sửa theo chính sách; lọc nội dung lạm dụng/PII, không công khai thông tin booking người khác. Manager chỉ được phản hồi/chú thích review, **không chỉnh `stars`** của khách.

### 5.4. Luồng quản lý xác minh và điều chỉnh có căn cứ

```text
Manager mở KPI draft tháng 11/2026 của A tại hotel 15
 -> GET /staff-kpi/hotels/15/periods/2026-11/staff/A
 -> xem từng metric + event nguồn + review + số lượng mẫu
 -> phát hiện task CHECK_OUT có nhật ký sai / khách khiếu nại có bằng chứng
 -> POST /staff-kpi/adjustments
      {metricId, requestedDelta, reasonCode, evidenceRef, commandId}
 -> validation manager cùng hotel, delta trong hạn mức policy
 -> record REQUESTED; không sửa điểm trực tiếp
 -> kiểm tra/xác nhận theo cấu hình, audit người duyệt và lý do
 -> service recalculate tạo snapshot mới version N+1 (DRAFT)
 -> manager `APPROVE` sau khi đối chiếu; tới ngày khóa kỳ chuyển `LOCKED`
```

Để hạn chế một quản lý tự thao túng toàn bộ điểm, nên **tách “đề xuất điều chỉnh” và “phê duyệt”** khi điều chỉnh ảnh hưởng lớn; nếu chỉ có một manager thì yêu cầu lý do, minh chứng, thay đổi trước/sau và hiển thị cả điểm tự động trước điều chỉnh. Không xóa/sửa event gốc; thay đổi chỉ là adjustment event có thể đảo bằng adjustment khác. Cấu hình % điểm manager tối đa 10, không được sửa hộ 70 điểm event và 20 điểm sao của khách.

### 5.5. Những trường hợp đặc biệt phải chấm công bằng

| Trường hợp | KPI đúng | Điều cấm |
|---|---|---|
| Khách No-show hoàn toàn | A vẫn tính task pre-arrival có thật; check-in/in-stay/check-out N/A | Không trừ A vì khách tự không đến. |
| A pre-arrival, B check-in thay, C xử lý lưu trú | Điểm event A/B/C riêng; review từng người theo giai đoạn | Không lấy toàn bộ vào C do `handled_by=C`. |
| B nhận permanent transfer | B tính từ mốc nhận/hoàn thành task; việc A xong trước đó vẫn thuộc A | Không chuyển doanh số/đơn hoàn thành cho B một cách hồi tố. |
| Complaint đang giải quyết, được chuyển từ A sang B | First response của A, giải quyết cuối của B; SLA giữ deadline gốc | Không reset clock khi đổi người để làm đẹp điểm. |
| Không phát sinh service request | Nhóm service N/A, điều chỉnh mẫu số | Không cho 0 điểm hay tự 15 điểm. |
| Chỉ có một đánh giá 1 sao | Hiển thị `LOW_SAMPLE`, cân nhắc co điểm về baseline hoặc chưa rank | Không phạt tuyệt đối từ một review đơn lẻ. |
| Manager nghỉ / nhận booking fallback | Ghi event thuộc manager, tách báo cáo điều hành | Không cộng cho một receptionist khác. |
| Trễ check-in do khách, không phải do lễ tân | Log reason/customer lateness; không gán lỗi cho người tiếp đón | Không tính thời gian khách đến muộn thành lỗi nhân viên. |
| Khách được hoàn tiền sau sự cố | KPI chất lượng theo evidence + xét lại khi xác minh | Không xóa lịch sử dịch vụ vì booking đã refund. |
| Nhân viên rời khách sạn giữa tháng | Khóa/đóng khoảng làm việc, giữ điểm theo hotel+period đã làm | Không xóa dữ liệu KPI khi deactivate account. |

### 5.6. Phân kỳ, snapshot và event versioning

Kỳ mặc định tháng (`YYYY-MM`), timezone theo khách sạn. `metric_policy_version` chốt tại kỳ, `calculation_version` tăng mỗi lần tính lại; `source_event_watermark` cho biết đã đọc tới event nào; `source_hash` chống chênh giữa màn hình và export. Kỳ có trạng thái `OPEN` (thu thập), `DRAFT` (đã tính), `APPROVED` (manager xác nhận), `LOCKED` (đóng kỳ). Nếu có chứng cứ mới sau khi LOCKED, tạo điều chỉnh kỳ sau hoặc thủ tục mở khóa có audit, **không update âm thầm snapshot cũ**.

**Cách tính review thận trọng:** không cộng trung bình sao từ các booking ít review trực tiếp vào 20 điểm mà không kèm mẫu. Có thể dùng Bayesian smoothing về baseline của khách sạn khi n nhỏ, ví dụ `adjusted = (n * rawMean + m * baseline)/(n+m)`, với `m` và `baseline` là tham số policy cấu hình, công khai trong report. Nếu không đủ review, nhóm 20 điểm `N/A` theo quy tắc đầy đủ dữ liệu. Không được tự giả sử tất cả nhân viên đều 5 sao.

### 5.7. CSDL đề xuất

| Bảng | Trường chính và ràng buộc |
|---|---|
| `guest_staff_reviews` | id, booking_id, hotel_id, reviewer_user_id, staff_user_id, stage, stars INT 1..5, comment, status, current_revision, submitted_at. Unique business key cho đánh giá có hiệu lực; lưu history riêng. |
| `guest_staff_review_revisions` | review_id, version, old_stars, new_stars, old_comment/new_comment, changed_by, changed_at, reason. Append-only. |
| `staff_kpi_policies` | hotel_id, policy_version, effective_from, weights_json, sla_rules_json, min_sample_json, created_by, status. |
| `staff_kpi_period_scores` | hotel_id, staff_user_id, period_key, policy_version, calculation_version, total_score, coverage_ratio, sample_count, status, source_hash, calculated_at, approved_by/at. Unique `(hotel_id,staff_user_id,period_key,calculation_version)`. |
| `staff_kpi_metric_scores` | period_score_id, metric_code, weight, eligible, numerator, denominator, raw_value, score, evidence_count, no_data_reason. |
| `staff_kpi_adjustments` | id, hotel_id, staff_user_id, period_key, metric_code, delta, evidence_ref, reason, status, requested_by, reviewed_by/at, source_score_version. |

**Không cập nhật `staff_assignments.performance_score` cũ để giả đây là kết quả KPI:** trong bootstrap `staff_assignments` có trường performance_score nhưng chưa có lifecycle chấm điểm được kiểm chứng. Nếu cần đồng bộ cho legacy report, chỉ đưa summary read-only sau phê duyệt, không để hai bảng cùng nhận chỉnh sửa độc lập.

### 5.8. Backend: những file mới và điểm nối tối thiểu

| File | Sửa/tạo |
|---|---|
| **[TẠO]** `backend/src/staff-kpi/staff-kpi.module.ts`, `staff-kpi.controller.ts` | Read own/manager, calculate draft, approve, lock, detail per metric/evidence, export dữ liệu. |
| **[TẠO]** `backend/src/staff-kpi/kpi-calculation.service.ts` | Engine thuần: load events by actor+hotel+period, group metrics, N/A, sample thresholds, hash/version, persist snapshot. |
| **[TẠO]** `backend/src/staff-kpi/kpi-policy.service.ts`, `kpi-adjustment.service.ts` | Version trọng số, kiểm tra delta, audit xét duyệt, không sửa event gốc. |
| **[TẠO]** `backend/src/staff-kpi/guest-staff-reviews.controller.ts`, `guest-staff-reviews.service.ts` | Kiểm tra eligibility từ work events, ownership khách, one review per stage, rating revisions. |
| **[TẠO]** `backend/src/staff-kpi/entities/*.entity.ts`, `dto/*.dto.ts` | Entity review, revision, policy, period/metric scores, adjustment; validator constraints. |
| **[SỬA NHỎ]** `backend/src/bookings/bookings.controller.ts` | Giữ GET performance/me và /staff/:id legacy; cung cấp link/metadata tới KPI mới tùy feature nhưng không đổi JSON shape. |
| **[SỬA NHỎ]** `backend/src/bookings/bookings.service.ts` | Legacy performance phải tránh lỗi bảng shifts chưa có; **không** dùng query legacy để tính KPI v2. |
| **[SỬA]** `backend/src/workers/workers.service.ts` hoặc worker riêng của KPI | Recompute khi `guest.work.completed`, `guest.review.submitted`, `staff.kpi.adjustment.approved`; idempotent, batch, không block service operations. |
| **[TẠO]** `database/migration_staff_kpi_v2.sql` | Add review/score/adjustment tables, index, soft delete/timestamp. |

### 5.9. Frontend: luồng hiển thị và quyền chỉnh

| File | Chức năng |
|---|---|
| **[TẠO]** `src/services/api/staff-kpi.api.ts`, `guest-staff-reviews.api.ts` | API score, policy, detail, adjustments, rateEligible, submitReview. |
| **[TẠO]** `src/app/(dashboard)/my-kpi/page.tsx` | Receptionist chỉ xem kết quả cá nhân, thời kỳ, điểm mỗi metric, nguồn dữ liệu và cảnh báo mẫu thấp; không có nút nhập điểm. |
| **[TẠO]** `src/app/(dashboard)/kpi-management/page.tsx` | Manager lọc theo khách sạn/tháng, xem distribution, drill down event, viết nhận xét/adjustment và duyệt/khóa kỳ. |
| **[TẠO]** `src/components/kpi/KpiBreakdown.tsx`, `KpiEvidenceDrawer.tsx`, `KpiAdjustmentDialog.tsx` | Phân tích nguồn điểm, không có biểu mẫu sửa sao của khách. |
| **[TẠO]** `src/components/booking/StaffRatingForm.tsx`, `StaffRatingsHistory.tsx` | 1–5 sao, đúng staff+stage, ràng buộc eligibility, UI xem sửa có lịch sử. |
| **[SỬA]** `src/components/booking/BookingHistory.tsx` | Đặt nút đánh giá sau giai đoạn thực sự xảy ra, không hiện in-stay cho No-show. |
| **[SỬA]** `src/components/dashboard/Sidebar.tsx` | Thêm My KPI và KPI Management theo role/hotel. |

### 5.10. API và test chấp nhận

```text
GET  /staff-kpi/me?period=2026-11
GET  /staff-kpi/hotels/:hotelId?period=2026-11
GET  /staff-kpi/hotels/:hotelId/staff/:staffId?period=2026-11
POST /staff-kpi/periods/:period/recalculate             [manager]
POST /staff-kpi/periods/:period/approve                 [manager]
POST /staff-kpi/adjustments                             [manager]
GET  /staff-reviews/booking/:bookingId/eligible         [customer owner]
POST /staff-reviews                                    [customer owner]
PATCH /staff-reviews/:id                                [customer original reviewer]
```

- KPI A/B/C lấy theo event actor: A làm pre-arrival, B check-in, C in-stay; sau transfer không đổi điểm của A.
- No-show chỉ có pre-arrival, metrics lưu `N/A`, `coverage_ratio` đúng; trường hợp ít review có `LOW_SAMPLE`.
- Khách không tạo được sao cho nhân viên chưa từng phục vụ; rating submit trùng không nhân đôi; rating sửa có revision.
- Manager hotel A không mở được KPI hotel B; employee không xem KPI đồng nghiệp; manager không sửa stars khách.
- Đổi policy tháng sau không làm điểm kỳ khóa tháng trước đổi; reconcile/retry KPI job không tạo snapshot trùng cùng version/event watermark.
- KPI worker tắt 30 phút rồi bật lại vẫn tính lại đúng; không ảnh hưởng check-in/service/VNPay trong thời gian down.

**Tiêu chí đóng Đợt 5:** 100 điểm có công thức, có chứng cứ, có kỳ và nguồn dữ liệu; số liệu A/B đúng sau tạm thay hoặc chuyển hẳn; không còn form manager tự bấm sửa điểm nguồn hay sao khách.


---

## ĐỢT 6. KIẾN TRÚC DASHBOARD THEO QUYỀN, INTEGRATION, HARDENING, RELEASE KHÔNG HỒI QUY

### 6.1. Định nghĩa rõ ba vai trò nghiệp vụ mà không đập hệ thống đăng nhập

Trong source, `users.role` là `CUSTOMER | EMPLOYEE | ADMIN` và `hotel_staff.staff_role` là `MANAGER | EMPLOYEE` (có normalize chuỗi legacy). Giai đoạn này **không đổi dữ liệu role toàn hệ thống để tránh phá đăng nhập/JWT**. Tạo lớp `HotelAccessPolicy` hiểu các vai trò nghiệp vụ:

- `CUSTOMER`: người có `bookings.user_id == JWT.id` hoặc quyền sở hữu hợp lệ.
- `HOTEL_MANAGER`: `user.role=EMPLOYEE` và `hotel_staff.staff_role='MANAGER'`, cả user và relation ACTIVE tại **hotelId của booking**.
- `RECEPTIONIST`: `user.role=EMPLOYEE`, relation thuộc hotel đang ACTIVE với `staff_role='EMPLOYEE'` đã chuẩn hóa nghiệp vụ và đủ điều kiện front-desk; quyền thao tác booking phụ thuộc **assignment/coverage**, không chỉ role chung.
- `ADMIN`: vai trò **quản trị kỹ thuật hiện có**, được giữ để tương thích vận hành; không đem vào danh sách ứng viên giao booking hoặc mặc nhiên coi là manager mọi khách sạn khi đánh giá KPI.

Không cho frontend quyết định quyền bằng chuỗi `role === EMPLOYEE` đơn thuần. UI có thể ẩn nút không phù hợp nhưng **backend phải là nơi bảo vệ thật**.

### 6.2. Những lỗ hổng scope phải xử lý và cách không phá endpoint hợp lệ

| Điểm source hiện tại | Nguy cơ và thay đổi cần thiết | Giữ tương thích |
|---|---|---|
| `BookingsController.findAll()` gọi `bookingsService.findAll(query)` không truyền actor; `hotelId` optional | EMPLOYEE có thể xem booking nhiều hotel. Đổi `findAll(query, actor)` và áp dụng `WHERE hotel_id IN authorizedHotelIds` với manager; lễ tân chỉ booking assigned/coverage; admin giữ khả năng tổng hợp có kiểm soát. | Giữ GET `/bookings`, query `page/limit/search/status/hotelId`, shape `{data,meta}`. |
| `GET /bookings/statistics`, `GET /bookings/activity-logs` | Truy vấn tổng hợp có thể lộ chéo hotel. Thêm `actor` và filter hotel/assigned theo quyền trong SQL, kiểm tra rỗng. | Giữ đường dẫn/field; số liệu hiển thị đúng phạm vi từng user. |
| `GET /bookings/:id/available-staff` không truyền user xuống service | Người biết bookingId có thể xem nhân viên hotel khác. Check quyền manager đúng hotel trước khi trả danh sách, ẩn thông tin không cần thiết. | Giữ GET path; có thể thêm availability reason cho manager. |
| `BookingAccessService.canManage()` chấp nhận mọi EMPLOYEE cùng hotel | Lễ tân có thể sửa booking do người khác phụ trách. Tách `canExecuteTask` theo owner/coverage, `canManageHotel` manager; trạng thái booking nhạy cảm check actor. | Lễ tân được giao vẫn check-in/out hợp lệ, manager vẫn giám sát. |
| `ServicesService.updateServiceRequest/status` không nhận actor | Có thể sửa request không thuộc phạm vi. Truyền JWT actor và resolve hotel từ booking; xác minh assignee/coverage/manager. | Giữ URL/DTO hợp lệ, từ chối trước đây truy cập trái phép. |
| `HotelStaffController GET /hotel-staff` đang mở cho EMPLOYEE | Nguy cơ lộ danh sách nhân viên trên nhiều hotel. Scope danh sách theo hotel quản lý, hạn chế dữ liệu personal. | Admin kỹ thuật vẫn có phép tổng hợp; nhân viên xem đồng nghiệp đúng hotel khi cần. |
| `HotelStaffService.assignStaff()` normalize BUONG_PHONG/KE_TOAN thành EMPLOYEE | Nếu chọn trực tiếp mọi EMPLOYEE làm lễ tân có thể gán sai nghề. Bộ chọn v2 đòi điều kiện FRONT_DESK/eligible thật; quản lý cập nhật kỹ năng. | Không xóa dữ liệu legacy, không đổi role của user đã tồn tại. |
| Frontend `Sidebar.tsx`, `bookings/page.tsx` | Mọi EMPLOYEE có thể thấy nút không nên dùng. Dựng capability matrix từ API `/me/capabilities?hotelId=...`, ẩn đúng menu nhưng backend vẫn kiểm tra. | Giữ route cũ; link cũ không biến mất với người còn quyền. |
| `RealtimeGateway.emitBookingCreated`, `emitServiceRequested` phát vào staff global room | Cần kiểm tra khả năng lộ payload ngoài hotel; event mới chỉ tới room xác minh `hotel:{id}`, `user:{id}`. Audit subscription/notification cũ trước khi thay. | Không đổi event name/payload đang dùng bởi client cũ nếu chưa version. |

**Đặc biệt:** không sửa `RolesGuard` thành kiểm tra `hotel_staff` trong global guard cho mọi route, vì guard hiện chỉ thấy global role và nhiều route không mang hotelId. Hãy bổ sung **policy service ở lớp application/use case** hoặc guard/decorator chuyên biệt có khả năng resolve booking/hotel rồi kiểm tra. Điều này giảm rủi ro phá login/CRUD của các module không liên quan.

### 6.3. Hành trình E2E — diễn biến và bước backend/frontend phải đi

**Hành trình 1 — đặt VIP, phân công công bằng, hoàn thành:** Customer tìm phòng -> CheckoutService tạo payment session + hold HELD -> VNPay thành công -> finalizer đánh dấu PAID + hold COMMITTED -> outbox request assignment -> worker khóa hotel -> chọn A/B/C theo 40/120 + skill + availability -> lưu assignment -> customer thấy người phụ trách -> A xử lý pre-arrival -> khách tới quầy -> lễ tân có quyền check-in -> work event -> customer gửi service request -> owner/coverage xử lý -> checkout -> review -> KPI theo actor.

**Hành trình 2 — A xin đi muộn, manager duyệt:** A gửi đơn 08:00–09:30 -> manager review -> availability block -> booking mới 08:45 không chọn A -> khách đến lúc 09:00 cần B check-in thay trên booking A đã có -> manager cấp coverage 120 phút -> B check-in, KPI B; A trở lại 09:30, tiếp tục owner hoặc manager transfer theo tình hình.

**Hành trình 3 — No-show rồi check-in ngày hôm sau:** Booking PAID 15/08 17:00–19/08 17:00, khách không có mặt quá grace -> No-show event -> hold vẫn COMMITTED -> khách ngày 16/08 đến, B có coverage check-in hợp lệ -> NO_SHOW→CHECKED_IN -> `actualCheckInAt=16/08`, `noShowAt=15/08` vẫn trong audit -> không tạo payment/hold mới -> 19/08 checkout.

**Hành trình 4 — nghỉ việc và chuyển hẳn:** A đã làm pre-arrival, booking đang CHECKED_IN -> quản lý tắt quyền nhân viên A hoặc duyệt nghỉ dài, xem danh sách booking đang owner A -> preview unfinished tasks -> chọn B transfer permanent -> assignment history đóng A/mở B; `handled_by` B -> A mất quyền xử lý mới nhưng event A không mất -> B giải quyết service -> KPI A/B đúng.

**Hành trình 5 — xử lý lỗi hạ tầng:** Hai IPN cùng giao dịch -> finalizer idempotent và outbox không nhân đôi -> assignment worker tạm down 10 phút -> booking PAID/COMMITTED vẫn giữ phòng, trạng thái ASSIGNMENT_PENDING -> repair retry -> assignedOnce -> realtime phát hợp lệ. Nếu refund xảy ra theo hủy được duyệt trước khi worker chạy, assignment worker kiểm tra trạng thái CANCELED/hold RELEASED và **không giao người** cho booking đã hủy.

**Hành trình 6 — lỗi cạnh tranh:** Cron No-show và lễ tân check-in cùng lúc -> một trong hai khóa booking trước, kết quả cuối hợp lệ CHECKED_IN; hai manager chuyển A sang B/C cùng lúc -> chỉ một thắng, người còn lại nhận 409; hai dịch vụ cùng hoàn tất một task -> chỉ một `TaskCompleted` event, không chấm KPI đôi.

### 6.4. Cấu trúc Dashboard đề nghị không làm hỏng layout hiện có

```text
src/app/(dashboard)/
  dashboard/page.tsx                   [SỬA] role-aware summary widgets, giữ tổng quan cũ
  bookings/page.tsx                    [SỬA] tích hợp các panel mới qua component
  staff-requests/page.tsx             [TẠO] lễ tân gửi/xem đơn
  staff-requests/management/page.tsx  [TẠO] quản lý duyệt
  my-tasks/page.tsx                   [TẠO] nhiệm vụ cá nhân
  service-monitor/page.tsx           [TẠO] manager theo dõi SLA
  my-kpi/page.tsx                     [TẠO] KPI cá nhân
  kpi-management/page.tsx            [TẠO] manager xem/chốt KPI

src/components/
  booking/PresenceTimeline.tsx, LateCheckInDialog.tsx
  booking/TemporaryCoverageDialog.tsx, PermanentTransferDialog.tsx
  booking/AssignmentHistoryPanel.tsx, StaffRatingForm.tsx
  guest-work/TaskActionPanel.tsx, TaskTimeline.tsx, EvidencePanel.tsx
  kpi/KpiBreakdown.tsx, KpiEvidenceDrawer.tsx
  dashboard/Sidebar.tsx               [SỬA] visibility capability-aware

src/services/api/
  client.ts                            [GIỮ] Axios interceptor, JWT refresh
  booking.api.ts                       [SỬA NHỎ] optional types + adapter legacy
  services.api.ts                      [SỬA NHỎ] assignee/SLA optional types
  staff-availability.api.ts           [TẠO]
  booking-assignment.api.ts           [TẠO]
  booking-presence.api.ts             [TẠO]
  booking-coverage.api.ts             [TẠO]
  guest-work.api.ts                   [TẠO]
  guest-conversations.api.ts          [TẠO]
  staff-kpi.api.ts                    [TẠO]
  guest-staff-reviews.api.ts          [TẠO]
```

**Dữ liệu Dashboard phải lấy đúng nguồn:** Overview manager đọc tổng hợp theo **hotel được phép**; receptionist thấy `my-assigned-bookings + covered-tasks + KPI bản thân`; customer thấy booking, yêu cầu và review; không phải role nào cũng nhìn một dashboard chỉ khác menu. Realtime dùng để **invalidate/reload** state từ API, không coi dữ liệu socket là nguồn sự thật.

### 6.5. Backend file-level hardening và tích hợp

| File | Sửa đổi bắt buộc |
|---|---|
| **[TẠO]** `backend/src/common/authz/hotel-access-policy.service.ts`, `hotel-access.module.ts` | Resolver manager/receptionist/customer theo booking/hotel/task, helper bắt buộc cho controllers mới và sửa scope legacy. |
| **[SỬA]** `backend/src/bookings/bookings.controller.ts` | Truyền actor vào list/stats/activity/available staff, không chỉ `@Roles('EMPLOYEE')`. Giữ URL/trả response. |
| **[SỬA]** `backend/src/bookings/bookings.service.ts` | `findAll(query,actor)`, `getStatistics(actor)`, `getActivityLogs(limit,actor)` áp SQL tenant filter **trước** pagination/count; `getAvailableStaffForBooking(id,actor)` check hotel. |
| **[SỬA]** `backend/src/bookings/services/booking-access.service.ts` | Chuyển sang policy có quyền chi tiết, không đồng nhất EMPLOYEE tại hotel với manager hoặc assigned owner. |
| **[SỬA]** `backend/src/hotel-staff/hotel-staff.controller.ts`, `hotel-staff.service.ts` | Scope GET theo hotel; trả tối thiểu thông tin cần quản lý. Chức năng assign staff của manager hotel cần API riêng được kiểm tra quyền, không mở toàn cục POST cũ cho mọi EMPLOYEE. |
| **[SỬA]** `backend/src/services/services.controller.ts`, `services.service.ts` | Actor-aware authorization, check task owner/grant, không sửa pricing/recovery cũ. |
| **[SỬA]** `backend/src/realtime/realtime.gateway.ts` và realtime event constants | Bảo vệ subscription room theo hotel, add scoped new events, audit route `staff:notifications` global. Không đổi vô ý event cũ. |
| **[SỬA]** `backend/src/app.module.ts` | Import module mới theo DAG; dùng TypeORM forFeature và exports đúng module; giữ `synchronize:false`. |
| **[GIỮ]** `backend/src/auth/*`, `payments/vnpay.service.ts`, `inventory/inventory.service.ts`, `cancellations` payment core | Viết regression tests; chỉ sửa lỗi được xác minh và test riêng. |
| **[TẠO]** `backend/test/booking-operations.e2e-spec.ts`, `backend/test/payment-assignment.e2e-spec.ts` | Full E2E với test DB MySQL và mock VNPay; kịch bản concurrency/coverage/no-show. |

### 6.6. Quy trình migration/backfill an toàn, không phá luồng cũ

**Lượt triển khai 1 — Expand:** tạo bảng/cột mới bằng `ADD` nullable hoặc default an toàn, tạo index không unique khi cần kiểm tra trùng dữ liệu. Không xóa bảng/cột cũ. Chạy `SHOW CREATE TABLE`/`INFORMATION_SCHEMA` tại DB thật; kiểm tra MySQL version và locking DDL; sao lưu trước. Trước khi deploy code mới, DB cũ và DB expand đều phải chạy được code cũ.

**Lượt triển khai 2 — Deploy flag OFF:** release backend với entity/DTO và service mới nhưng feature off; frontend mới có route nhưng không quảng cáo/tự chạy khi chưa bật. Kiểm tra GET cũ, payment, inventory, cancel, front-desk, service CRUD.

**Lượt triển khai 3 — Backfill cẩn thận:**

- `rooms.service_tier`: STANDARD mặc định, quản lý kiểm tra từng VIP/ECONOMY; không dựa vào heuristic giá để quyết định vĩnh viễn mà không duyệt.
- `booking_assignment_state`: backfill từ `bookings.handled_by` hiện tại thành assignment `LEGACY_IMPORT` cho booking chưa kết thúc; `assigned_at` chọn timestamp có bằng chứng, nếu không biết thì lưu `unknown`/import-time và **không** dùng làm mốc lịch sử 40/120 của booking mới.
- `booking_coverage_grants`: không backfill quyền nếu không có lịch sử duyệt thật.
- `guest_work_events`: không giả lập tốc độ phản hồi hoặc thời gian hoàn tất từ `updated_at` không rõ nguồn; lịch sử chỉ đánh dấu `HISTORICAL_IMPORT` và `KPI_INELIGIBLE`.
- `booking_presence`: suy trạng thái hiện tại từ booking status cũ để hiển thị; không tạo check-in event có actor giả cho booking đã hoàn tất.
- `staff_absence_requests`: chỉ dữ liệu mới sau khi triển khai, không tự suy từ status account INACTIVE rằng ngày nào trước đó nhân viên nghỉ.

**Lượt triển khai 4 — Shadow mode / so kết quả:** với booking mới, tính kết quả phân công v2 trong chế độ dry-run và ghi log, chưa cập nhật owner; so với legacy, theo dõi ứng viên sai/không có manager/khác hotel/skill chưa xác minh. Bật v2 cho một khách sạn thử nghiệm sau khi tất cả migration thành công, chặn cảnh báo P0.

**Lượt triển khai 5 — Cutover theo feature:** bật availability, assignment, presence, coverage, guest work, KPI **theo phụ thuộc**; monitor và rollback bằng feature flag từng nhóm. Không bật KPI thật khi work events hoặc event attribution chưa chính xác.

**Lượt triển khai 6 — Contract sau thời gian ổn định:** chỉ cân nhắc bỏ nhánh legacy sau khi có báo cáo migration/hồi quy và phê duyệt rõ ràng. Không DROP ngay trường `handled_by` hoặc endpoint legacy; chúng vẫn là điểm tương thích cho client cũ.

### 6.7. Observability/alerts cần có để vận hành

| Chỉ số hoặc cảnh báo | Ngưỡng/ý nghĩa | Hành động |
|---|---|---|
| `assignment_pending_age_seconds` | Booking PAID >60–120 giây chưa có assignment | Retry job, manager dashboard alert; booking vẫn PAID/COMMITTED. |
| `assignment_critical_count` | Không có staff/manager khả dụng đúng hotel | Thông báo manager/admin; không tự chọn hotel khác. |
| `assignment_dispatch_lock_wait_ms` | Nhiều booking cùng hotel | Quan sát contention, retry deadlock, không tắt lock. |
| `presence_no_show_count` | Booking No-show theo ngày/hotel | Theo dõi quyền giữ phòng, phát hiện no-show nhưng hold RELEASED bất thường. |
| `late_check_in_success_count` | Khách check-in sau No-show | Đối chiếu actual và scheduled; không tự tính double occupancy. |
| `coverage_expiring_without_owner_return` | B hết hạn mà A vẫn unavailable | Manager quyết định gia hạn/chuyển hẳn. |
| `work_event_missing_actor` | Event nghiệp vụ cần actor nhưng thiếu actor thực | Điều tra/khắc phục trước KPI; không tự bịa actor. |
| `kpi_low_sample_ratio` | Điểm có ít dữ liệu, thiếu review | Dashboard gắn độ tin cậy, không xếp hạng thiếu căn cứ. |
| `payment_paid_hold_not_committed` | PAID nhưng không có COMMITTED hold | Cảnh báo P0, không tự tạo phân công như booking bình thường nếu còn tranh chấp tồn. |
| `hotel_scope_denied_count` | Request trái quyền theo hotel | Ghi security audit với dữ liệu tối thiểu. |

### 6.8. Ma trận test hồi quy trước khi cho phép phát hành

| ID | Test end-to-end bắt buộc | Kỳ vọng |
|---|---|---|
| REG-01 | Khách tìm/chọn loại phòng, checkout, trả VNPay thành công | Không thay đổi số tiền, booking, hold COMMITTED và kết quả người dùng. |
| REG-02 | IPN gửi hai lần cùng giao dịch | Một PAID, một hold COMMITTED, một assignment chính; outbox không gửi lặp các action không idempotent. |
| REG-03 | QueryDr đối soát PAID nhưng không có IPN | Vẫn assignment v2, không bỏ sót; tiền/hold không bị cộng/trừ trùng. |
| REG-04 | VNPay FAILED/EXPIRED | Không giao owner mới, không biến HELD thành COMMITTED, logic expiry cũ nguyên vẹn. |
| REG-05 | Duplicate payment/PAID_REQUIRES_REVIEW | Không giao booking không hợp lệ, refund/review cũ không bị bỏ qua. |
| REG-06 | Khách hủy hợp lệ qua cancellation review | Hold được RELEASED đúng một lần; không nhầm No-show với hủy; refund path cũ chạy. |
| REG-07 | Booking PAID No-show qua ngày 2 | Tồn phòng vẫn bị chiếm cho khoảng còn lại; không bán trùng. |
| REG-08 | Check-in muộn từ No-show | Một presence change và actual timestamp đúng; hold vẫn COMMITTED. |
| REG-09 | A nhận booking; B temporary check-in; C permanent transfer | A/B/C mỗi người giữ đúng event, `handled_by` cuối là C. |
| REG-10 | Nhân viên vắng được duyệt | Không xuất hiện trong assignment candidate trong block; ngoài block lại được xét. |
| REG-11 | Front desk booking cũ | Tạo đơn tại quầy, báo giá, nhân viên tạo đơn, lịch sử/checkout vẫn đúng; không bắt buộc VNPay. |
| REG-12 | Dịch vụ và service recovery | Price snapshot, request lifecycle, recovery approval không bị đổi; scope security mới đúng. |
| REG-13 | Khách rate nhân viên đã phục vụ, sửa rating | Sao đúng stage, một review hiệu lực, revision lịch sử. |
| REG-14 | KPI có review ít/không có tác vụ/No-show | Có N/A/LOW_SAMPLE, không điểm 0 hoặc 100 giả, tổng tính theo applicable weights. |
| REG-15 | Khách sạn A xem booking/staff/KPI khách sạn B | HTTP 403/filtered, không trả metadata nhạy cảm. |
| REG-16 | Lễ tân A sửa booking B không được ủy quyền | 403; cùng hotel không đồng nghĩa có quyền đổi người/check-in booking mọi nhân viên. |
| REG-17 | Hai manager transfer song song hoặc hai check-in song song | Một người thắng, người còn lại 409; không duplicate event. |
| REG-18 | Socket/email fail sau commit | Payment/booking/task thành công vẫn giữ, outbox retry; UI lấy lại state qua GET. |
| REG-19 | Feature flags OFF | API/Frontend cũ vẫn hoạt động đối với trạng thái legacy; không có side effect mới bắt buộc. |
| REG-20 | Restart worker/mất kết nối DB tạm thời | Pending event được xử lý lại, không double-count KPI hoặc double-book room. |

**Tiêu chí đóng Đợt 6:** PASS tất cả P0 + các bài `REG-*`; security scan và query scope đúng; deployment/rollback được diễn tập trên staging với database copy đã ẩn dữ liệu; người phụ trách sản phẩm ký xác nhận các tình huống no-show/late check-in/temporary/permanent/KPI.


---

## PHỤ LỤC A. DANH MỤC SOURCE THỰC TẾ, ĐIỂM GẮN VÀ LỆNH SỬA CỤ THỂ

**Mốc nguồn để so sánh (commit nhánh `minh` tại lúc đối chiếu):** Backend `6910f02eae600d32e965188b27bfb37643b73cc9`; Frontend `fde25aa388e842d60dd10cc5df89dda843000631`. Khi triển khai trên branch đã có commit mới, lập lại diff từ commit thực tế và chạy baseline tests trước khi sửa.

### A.1. Backend — các điểm sửa trực tiếp, không phải chỉ gợi ý chung

| File nguồn/điểm gắn | Hành động chi tiết | Vùng tuyệt đối không phá |
|---|---|---|
| `bookings/bookings.service.ts` — `autoAssignHotelStaffInternal` (khoảng dòng 403–535) | [SỬA] Di chuyển business rule thành `BookingAssignmentService` theo feature flag; giữ legacy adapter trong giai đoạn chuyển; không dùng `MAX(ss.level)` lẫn các skill; lưu history, rollback-safe. | Không động tuyến tạo checkout và giá trong `create()`; không xóa behavior khi flag off. |
| `bookings/bookings.service.ts` — `updateStatus` (khoảng 750–886) | [SỬA] Nhánh `CHECKED_IN`/`COMPLETED` chuyển vào PresenceService có quyền, timestamp, lock; bảo vệ khỏi tự set `handledBy=changedByUserId` không kiểm soát; thêm No-show transition được kiểm định. | Không mở lại `CANCELLED` cho PAID bằng PATCH status; không gọi refund trực tiếp. |
| `bookings/bookings.service.ts` — `reassignStaff` (khoảng 886–1014) | [SỬA] Gọi PermanentTransferService có expectedVersion, history, unfinished tasks; cho phép khi CHECKED_IN nếu manager có quyền; giữ adapter/response cho modal cũ. | Không cho mọi EMPLOYEE cập nhật owner bất kỳ; không đổi booking ended. |
| `bookings/bookings.service.ts` — `findAll` (khoảng 536–632) | [SỬA] Bắt buộc có actor và tenant scope ở SQL trước count/pagination; chỉ receptionist có assignment/coverage và manager thuộc hotel. | Giữ `QueryBookingDto`, shape phân trang, sort/search hợp lệ. |
| `bookings/bookings.service.ts` — `getStaffPerformance` (khoảng 1289–1397) | [GIỮ + VÁ TƯƠNG THÍCH] Không dùng cho KPI v2; tránh crash nếu bảng ca trực vắng/mismatched, không bật shifts. | Không đổi các key `directSales`, `operations`, `services`, `shifts` đột ngột cho client cũ. |
| `bookings/bookings.controller.ts` — GET list/stats/activity/available staff | [SỬA] Bổ sung `@CurrentUser`, truyền actor vào service; URL giữ nguyên; có scope `hotelId` từ backend. | Không thay middleware JWT toàn cục. |
| `bookings/bookings.controller.ts` — PATCH `:id/status`, `:id/reassign` | [SỬA] Bảo toàn request/response, đưa tới domain use case mới khi bật flag. | Không xóa route/HTTP method cũ. |
| `bookings/entities/booking.entity.ts` | [SỬA] Presence enum và optional fields; mirror current owner. | Không đổi primary key, money fields, `check_in_at`, `check_out_at` gốc. |
| `bookings/entities/booking-status-log.entity.ts` | [SỬA + MIGRATION] Bổ sung `actor_type`, nullable SYSTEM actor sau kiểm tra schema. | Không bỏ log cũ hay giả ID user. |
| `rooms/entities/room.entity.ts`, `rooms/dto/create-room.dto.ts`, `update-room.dto.ts`, `rooms.service.ts` | [SỬA] Add `serviceTier` optional + persist, backfill safe. | Không đổi giá, quantity, status phòng, ảnh, dịch vụ. |
| `hotel-staff/entities/staff-skill.entity.ts`, `staff-eligibility-rule.entity.ts` | [GIỮ MODEL + TẬN DỤNG] Query kỹ năng verified FRONT_DESK/VIP_HANDLE và min case/years; có thể thêm policy adapter. | Không đổi ý nghĩa `years_exp`, `verified_by`, `is_shadow`. |
| `hotel-staff/hotel-staff.service.ts`, `hotel-staff.controller.ts` | [SỬA] Query ứng viên ACTIVE đúng hotel, lọc business receptionist; scope staff list theo hotel; manager CRUD riêng. | Không xóa liên kết hotel_staff hoặc đổi role toàn bộ account. |
| `payments/services/payment-finalizer.service.ts` — `finalizeSuccess` (khoảng 26–275) | [SỬA CỰC NHỎ] Thêm outbox event `booking.assignment.requested` sau PAID+COMMITTED vào transaction theo flag, còn callback legacy để chuyển đổi có kiểm soát. | Giữ lock payment/booking, xử lý duplicate payment, QueryDr, refund, chữ ký. |
| `payments/payments.service.ts` — IPN/retry | [SỬA CỰC NHỎ] Không truyền legacy assignment callback khi V2 đã bật; mọi đường vẫn qua finalizer. | Không đổi public response IPN, payment retry/expiration. |
| `payments/services/payment-reconciliation.service.ts` | [GIỮ] Nhận assignment event qua finalizer; viết test đường không callback legacy. | Không đổi QueryDr request/response logic. |
| `outbox/outbox.service.ts` | [GIỮ] Reuse addEvent/claim/mark; nếu cần idempotent event unique, migration hoặc receipt ở domain. | Không viết lại cơ chế claim/retry chung. |
| `workers/workers.service.ts` — `processOutboxEvents` (khoảng 45–160) | [SỬA] Thêm case **riêng** cho `booking.assignment.requested`; bổ sung worker/cron cho presence/coverage/KPI có xử lý đồng thời. | Không đụng case `payment.paid` realtime, `refund.process`, `mail.payment_success`... |
| `inventory/inventory.service.ts` — `getOccupiedRooms` (khoảng 29–63) | [GIỮ] Test No-show vẫn chiếm hold, late check-in không commit/release lại. | Không thay điều kiện overlap và COMMITTED của hold. |
| `cancellations/cancellations.service.ts` — `createRequest/reviewRequest` | [GIỮ] Viết test No-show không tự gọi cancellation/refund. | Không bỏ quy trình duyệt refund. |
| `services/entities/service-request.entity.ts` | [GIỮ + OPTIONAL] Có đủ accepted/started/completed/sla timestamp; thêm mapping evidence/task id nếu thật cần. | Không đổi enum PENDING/ACCEPTED/ASSIGNED/... |
| `services/services.controller.ts`, `services.service.ts` | [SỬA] Thêm actor-aware scope, chuyển trạng thái qua service, guest-work events có transaction. | Không đổi giá/snapshot, quota, service recovery. |
| `realtime/realtime.gateway.ts` | [SỬA CÓ KIỂM CHỨNG] Thêm event mới vào room đúng hotel/staff; audit global staff room. | Không đổi event đang được client subscribe mà chưa có adapter. |
| `auth/guards/roles.guard.ts` | [GIỮ] Global JWT roles như cũ; policy hotel nằm service/guard chuyên biệt. | Không biến ADMIN/EMPLOYEE thành enum mới gây logout. |
| `app.module.ts`, `bookings.module.ts`, `services.module.ts`, `workers.module.ts` | [SỬA] Import provider module mới một chiều; tránh circular dependence. | Giữ `synchronize:false`, không bỏ các module hiện hữu. |

### A.2. Frontend — đúng file đang có và trách nhiệm cụ thể

| File | Thay đổi có kiểm soát |
|---|---|
| `src/app/(dashboard)/bookings/page.tsx` (hiện rất dài) | [SỬA] Giữ danh sách/thống kê/hủy/đối soát cũ; chỉ gắn thêm panel AssignmentHistory, NoShow/CheckInDialog, CoverageDialog; các nút cũ cần feature guard. Đặc biệt đoạn hiện `openReassignModal` chặn CHECKED_IN phải sửa **bằng phân quyền/adapter**, không đơn thuần bỏ chặn. |
| `src/services/api/booking.api.ts` | [SỬA] Optional fields status+assignment, helper API mới; không thay các hàm `create/getAll/getOne/updateStatus/getPaymentStatus/reassignStaff` đang được nơi khác gọi. |
| `src/app/(dashboard)/services/page.tsx`, `src/services/api/services.api.ts` | [SỬA] Bổ sung assignee/task/SLA và view timeline; API cũ vẫn chấp nhận input chính. |
| `src/features/rooms/components/RoomCreateModal.tsx`, `RoomEditModal.tsx`, `src/types/room.ts`, `src/services/api/rooms.api.ts` | [SỬA] Chọn/tải `serviceTier`; nếu server cũ chưa có, UI dùng fallback STANDARD an toàn; không xóa thông tin giá/phòng/ảnh. |
| `src/app/(dashboard)/hotel-staff/page.tsx`, `src/services/api/hotel-staff.api.ts` | [SỬA] Hiển thị kỹ năng, trạng thái availability tổng quát mà không lộ lý do nghỉ riêng tư; manager chỉ hotel của mình; không đổi cấu trúc nhân viên. |
| `src/app/(dashboard)/staff-skills/page.tsx`, `src/services/api/staff-skills.api.ts` | [SỬA] Nêu skill nào đã xác minh/đủ VIP, số năm/số ca; dữ liệu thật từ DB, không tính max toàn kỹ năng. |
| `src/app/(dashboard)/dashboard/page.tsx`, `src/components/dashboard/Sidebar.tsx` | [SỬA] Capability-aware view; thêm counters booking pending assignment, arrival/no-show, task SLA, nghỉ pending, KPI. Không bỏ Tổng Quan và menu cũ. |
| `src/components/booking/BookingHistory.tsx` | [SỬA] Khách xem đúng booking, lịch nhận muộn/no-show và review sao. |
| `src/services/api/client.ts` | [GIỮ] Chỉ reuse; không sinh axios mới làm mất refresh token hoặc lỗi 401 behavior. |
| `src/app/payment/vnpay/result/page.tsx`, `src/app/process-order/page.tsx` | [GIỮ] Thanh toán/đặt phòng; test không có UI chờ assignment blocking kết quả trả tiền. |
| `src/app/(dashboard)/shifts/page.tsx`, `src/services/api/shifts.api.ts` | [GIỮ NGUYÊN] Chưa thực hiện lịch ca, không dùng shift để lọc/cho điểm KPI. |

### A.3. Chính xác file mới nên tạo ở đâu

```text
BACKEND / backend/src/
  common/authz/
    hotel-access.module.ts                    # policy riêng theo hotel, booking, task
    hotel-access-policy.service.ts
  staff-availability/
    staff-availability.module.ts
    staff-availability.controller.ts
    staff-availability.service.ts
    dto/create-absence-request.dto.ts
    dto/decide-absence-request.dto.ts
    dto/revoke-absence-request.dto.ts
    entities/staff-absence-request.entity.ts
    entities/staff-absence-request-event.entity.ts
    entities/staff-availability-block.entity.ts
  booking-assignment/
    booking-assignment.module.ts
    booking-assignment.service.ts
    assignment-policy.ts
    assignment-decision.service.ts
    assignment-repair.service.ts
    entities/booking-assignment.entity.ts
    entities/booking-assignment-state.entity.ts
    entities/hotel-assignment-dispatch-lock.entity.ts
    entities/booking-assignment-command-receipt.entity.ts
  booking-presence/
    booking-presence.module.ts
    booking-presence.controller.ts
    booking-presence.service.ts
    presence-scheduler.service.ts
    entities/booking-presence-event.entity.ts
    dto/confirm-arrival.dto.ts
    dto/confirm-departure.dto.ts
  booking-coverage/
    booking-coverage.module.ts
    booking-coverage.controller.ts
    booking-coverage.service.ts
    coverage-expiration.service.ts
    entities/booking-coverage-grant.entity.ts
    entities/booking-coverage-event.entity.ts
    dto/create-temporary-coverage.dto.ts
    dto/transfer-permanent.dto.ts
  guest-work/
    guest-work.module.ts
    guest-work.controller.ts
    guest-work.service.ts
    guest-work-events.service.ts
    entities/guest-work-task.entity.ts
    entities/guest-work-event.entity.ts
    entities/guest-work-evidence.entity.ts
  guest-conversations/
    guest-conversations.module.ts
    guest-conversations.controller.ts
    guest-conversations.service.ts
    entities/guest-conversation.entity.ts
    entities/guest-message.entity.ts
  staff-kpi/
    staff-kpi.module.ts
    staff-kpi.controller.ts
    kpi-calculation.service.ts
    kpi-policy.service.ts
    kpi-adjustment.service.ts
    guest-staff-reviews.controller.ts
    guest-staff-reviews.service.ts
    entities/guest-staff-review.entity.ts
    entities/staff-kpi-period-score.entity.ts
    entities/staff-kpi-metric-score.entity.ts
    entities/staff-kpi-adjustment.entity.ts
    entities/staff-kpi-policy.entity.ts
  [test] *.spec.ts gần service và test/*.e2e-spec.ts theo luồng

DATABASE / database/
  migration_staff_availability_assignment_v2.sql
  migration_booking_presence_v2.sql
  migration_booking_coverage_v2.sql
  migration_guest_work_and_messages.sql
  migration_staff_kpi_v2.sql
  [TẠO] preflight_schema_checks.sql
  [TẠO] rollback_notes.md                # rollback ứng dụng, không DROP lịch sử

FRONTEND / src/
  services/api/staff-availability.api.ts
  services/api/booking-assignment.api.ts
  services/api/booking-presence.api.ts
  services/api/booking-coverage.api.ts
  services/api/guest-work.api.ts
  services/api/guest-conversations.api.ts
  services/api/staff-kpi.api.ts
  services/api/guest-staff-reviews.api.ts
  app/(dashboard)/staff-requests/page.tsx
  app/(dashboard)/staff-requests/management/page.tsx
  app/(dashboard)/my-tasks/page.tsx
  app/(dashboard)/service-monitor/page.tsx
  app/(dashboard)/my-kpi/page.tsx
  app/(dashboard)/kpi-management/page.tsx
  components/booking/PresenceTimeline.tsx
  components/booking/LateCheckInDialog.tsx
  components/booking/TemporaryCoverageDialog.tsx
  components/booking/PermanentTransferDialog.tsx
  components/booking/AssignmentHistoryPanel.tsx
  components/booking/StaffRatingForm.tsx
  components/guest-work/TaskTimeline.tsx
  components/guest-work/TaskActionPanel.tsx
  components/guest-work/EvidencePanel.tsx
  components/kpi/KpiBreakdown.tsx
  components/kpi/KpiEvidenceDrawer.tsx
  components/kpi/KpiAdjustmentDialog.tsx
```

**Đừng copy cây thư mục đề xuất thành hàng chục file rỗng ngay.** Tạo theo đợt và viết test với từng domain boundary. Ở những nơi service hiện rất lớn, ưu tiên wrapper/adapter và small PR thay vì viết lại toàn bộ BookingsService/PaymentsService/ServicesService.

---

## PHỤ LỤC B. API CONTRACT, EVENT CONTRACT VÀ LỖI CỤ THỂ

### B.1. Ma trận HTTP API thêm mới và quyền mặc định

| Đợt | HTTP endpoint | Chủ thể | Side effect thật |
|---|---|---|---|
| 1 | `POST /staff-availability/requests` | Receptionist own hotel | Tạo pending request + outbox notify. |
| 1 | `POST /staff-availability/requests/:id/decision` | Manager same hotel | Duyệt block `[start,end)` hoặc từ chối, tạo lịch sử. |
| 1 | `GET /staff-availability/requests/me` | Receptionist | Xem đơn bản thân. |
| 1 | `GET /staff-availability/requests/hotel/:hotelId` | Manager same hotel | Xem đơn nhân viên đúng hotel, lọc PENDING. |
| 1 | `GET /booking-assignments/:bookingId/history` | Owner/Manager/authorized staff | Trả lịch sử phân công có scope; customer chỉ thấy thông tin đầu mối cần thiết. |
| 2 | `POST /booking-presence/:bookingId/check-in` | Owner/valid coverage/Manager | Ghi actual check-in, event, booking status; không đổi hold. |
| 2 | `POST /booking-presence/:bookingId/check-out` | Owner/valid coverage/Manager | Ghi actual checkout, event và trạng thái COMPLETED. |
| 2 | `GET /booking-presence/:bookingId/timeline` | Customer owner, Owner, Manager | Chỉ trả timeline được phép xem. |
| 3 | `POST /booking-coverage/:bookingId/temporary` | Manager same hotel | Tạo grant có phạm vi/thời gian. |
| 3 | `POST /booking-coverage/:bookingId/temporary/:grantId/extend` | Manager same hotel | Gia hạn có audit, giới hạn thời gian. |
| 3 | `POST /booking-coverage/:bookingId/temporary/:grantId/revoke` | Manager same hotel | Dừng cấp task mới, không xóa event cũ. |
| 3 | `POST /booking-coverage/:bookingId/permanent-transfer` | Manager same hotel | A ended, B current, task handover event. |
| 4 | `GET /guest-work/me` | Receptionist | Liệt kê task được giao/coverage; không lộ hotel khác. |
| 4 | `POST /guest-work/:taskId/accept` | Assigned actor | Ghi acceptedAt và event. |
| 4 | `POST /guest-work/:taskId/complete` | Assigned actor | Ghi completedAt server, evidence, event. |
| 4 | `POST /guest-work/:taskId/verify` | Customer concerned/Manager | Xác minh kết quả, không sửa actual event. |
| 4 | `POST /guest-conversations/booking/:bookingId/messages` | Customer/authorized staff | Lưu message thật, tính first-response từ message server. |
| 5 | `GET /staff-reviews/booking/:bookingId/eligible` | Customer owner | Tập staff-stage đã thực sự phục vụ. |
| 5 | `POST /staff-reviews` | Customer owner | Rating đúng staff+stage, anti-duplicate. |
| 5 | `GET /staff-kpi/me` | Receptionist | Snapshot KPI của bản thân. |
| 5 | `GET /staff-kpi/hotels/:hotelId` | Manager same hotel | Tập KPI theo hotel/kỳ. |
| 5 | `POST /staff-kpi/adjustments` | Manager same hotel | Yêu cầu chỉnh có evidence, không sửa điểm trực tiếp. |
| 5 | `POST /staff-kpi/periods/:period/approve` | Manager same hotel | Chuyển kỳ sang APPROVED nếu đạt điều kiện. |

**Chú thích:** Đây là **API mới đề xuất**, không khẳng định đã có trong source. Nếu chọn URL cụ thể khác, phải thống nhất backend/frontend/tests một lần; không viết FE trước rồi API phát sinh tuỳ tiện.

### B.2. Event schema tối thiểu và idempotency

```json
{
  "eventType": "booking.assignment.requested",
  "aggregateType": "Booking",
  "aggregateId": "502",
  "payload": {
    "bookingId": "502",
    "hotelId": "15",
    "causation": "PAYMENT_PAID",
    "schemaVersion": 1,
    "occurredAt": "2026-11-02T01:30:00.000Z"
  }
}
```

- **Khóa chống lặp sự kiện:** dùng `event.id` ở worker receipt + business key `(booking_id, assignment_trigger='PAYMENT_PAID')`, không dùng `message string` hay timestamp làm khóa duy nhất.
- **Không dùng tên/customer contact trong event dispatch nếu không cần**; service có thể query booking sau khi kiểm tra quyền.
- **Event cập nhật trạng thái** (`booking.assigned`, `booking.presence.changed`, `guest.work.completed`) phải chứa `bookingId`, `hotelId`, `version`, `actor_type`, `actor_id`, timestamp và `correlation_id` khi có.
- **Cùng tác vụ**: outbox event retry không dẫn đến ghi hai `TaskCompleted`; business receipt commandId là duy nhất, append-only event unique key.

### B.3. Error handling theo use case

| Failure | HTTP/outbox behavior | Khôi phục |
|---|---|---|
| Assignment worker chết giữa xử lý | Event giữ PENDING hoặc retry; DB transaction rollback nếu chưa commit | Requeue `assignOnce`, booking PAID/COMMITTED không đổi. |
| Booking đã CANCELLED trước khi worker chạy | `assignOnce` trả no-op `BOOKING_NOT_ELIGIBLE` | Mark receipt resolved/skipped, không giao người. |
| Không có receptionist hoặc manager | Lưu CRITICAL và outbox cảnh báo, không rollback payment | Manager/hệ thống retry khi staff khả dụng; tránh retry vô hạn dày đặc. |
| Hai manager cùng quyết định một đơn nghỉ | 409 version stale | Refresh request, không ghi hai block. |
| Temporary coverage hết hạn trước khi B click nhiệm vụ mới | 403/422 | Manager gia hạn/chuyển permanent. |
| Khách đến sau checkout | 409 hoặc 422 `BOOKING_PERIOD_EXPIRED` | Hướng dẫn booking mới, không sửa inventory cũ. |
| No-show scheduler chạy sau check-in | No-op | Không ghi No-show mới. |
| Khách đánh giá sai nhân viên/giai đoạn | 422 `REVIEW_NOT_ELIGIBLE` | Hiển thị chỉ stage hợp lệ từ API. |
| KPI source event không xác minh | Không tính điểm tự động, có warning data quality | Xác minh/ghi adjustment, không tạo timestamp giả. |
| JWT đúng nhưng khác hotel | 403 `HOTEL_SCOPE_FORBIDDEN` | Không trả dữ liệu booking/staff/phòng của hotel khác. |

---

## PHỤ LỤC C. MẪU HỢP ĐỒNG SERVICE VÀ DDL ĐỂ LẬP TRÌNH VIÊN TRIỂN KHAI

> Những đoạn dưới đây là **pseudocode/SQL blueprint**, không phải bản patch có thể chạy ngay. Tên/cột/index phải xác minh bằng `SHOW CREATE TABLE`, `INFORMATION_SCHEMA` và DB version thực tế trước khi viết migration chính thức. DDL phải có bản kiểm tra dữ liệu và kế hoạch rollback tương ứng.

### C.1. Giao diện use case (TypeScript blueprint)

```ts
interface AssignmentUseCase {
  assignOnce(bookingId: string, trigger: 'PAYMENT_PAID'|'REPAIR'): Promise<AssignmentResult>;
  previewCandidates(bookingId: string, actor: User): Promise<StaffCandidate[]>;
  getHistory(bookingId: string, actor: User): Promise<AssignmentHistory[]>;
}
interface StaffAvailabilityUseCase {
  submitOwnRequest(actor: User, input: CreateAbsenceDto): Promise<AbsenceRequest>;
  decide(actor: User, requestId: string, input: DecideAbsenceDto): Promise<AbsenceRequest>;
  isEligibleAt(hotelId: string, staffId: string, at: Date): Promise<boolean>;
}
interface BookingPresenceUseCase {
  markNoShow(bookingId: string, now: Date): Promise<PresenceResult>;
  confirmArrival(bookingId: string, actor: User, commandId: string): Promise<PresenceResult>;
  confirmDeparture(bookingId: string, actor: User, commandId: string): Promise<PresenceResult>;
}
interface BookingCoverageUseCase {
  temporary(bookingId: string, manager: User, command: TemporaryCommand): Promise<CoverageGrant>;
  permanent(bookingId: string, manager: User, command: TransferCommand): Promise<TransferResult>;
  assertCanExecute(actor: User, bookingId: string, taskType: string, at: Date): Promise<void>;
}
interface StaffKpiUseCase {
  calculatePeriod(hotelId: string, staffId: string, period: string): Promise<KpiSnapshot>;
  listEligibleReviewTargets(bookingId: string, customer: User): Promise<ReviewTarget[]>;
  submitReview(customer: User, command: SubmitReviewCommand): Promise<Review>;
}
```

### C.2. Phác thảo transaction chống phân công đồng thời

```ts
return dataSource.transaction(async (em) => {
  const booking = await em.getRepository(Booking).findOne({
    where: { id: bookingId }, lock: { mode: 'pessimistic_write' },
  });
  if (!booking) throw new NotFoundException();
  if (await assignmentStateExists(em, booking.id)) return EXISTING_ASSIGNMENT;
  await assertPaidAndCommitted(em, booking.id);

  // Lock theo hotel, không theo user toàn hệ thống.
  await em.query(
    'SELECT hotel_id FROM hotel_assignment_dispatch_locks WHERE hotel_id = ? FOR UPDATE',
    [booking.hotelId],
  );
  const candidates = await loadEligibleReceptionists(em, booking.hotelId, serverNow());
  const decision = pickReceptionist(buildDecisionContext(booking, candidates));
  await persistCurrentAssignmentAndHistory(em, booking, decision);
  await persistCommandReceipt(em, booking.id, 'PAYMENT_PAID');
  await persistOutbox(em, 'booking.assigned', booking.id, decision);
  return decision;
});
```

**Chú ý lock row phải có trước:** khi khách sạn mới tạo, seed `hotel_assignment_dispatch_locks` bằng `INSERT ... ON DUPLICATE KEY UPDATE` trước `SELECT ... FOR UPDATE`, nếu không câu SELECT trả rỗng và không khóa ai. Đảm bảo thứ tự lock cố định (`booking` rồi `hotel dispatch`) trong tất cả tác vụ dispatch; tránh một use case lock ngược gây deadlock. Với `runWithDeadlockRetry` hiện có, retry toàn transaction một cách idempotent.

### C.3. SQL mẫu một số ràng buộc an toàn

```sql
-- Ví dụ cấu trúc, kiểm tra lại engine, collation và key type trước khi chạy.
CREATE TABLE hotel_assignment_dispatch_locks (
  hotel_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE booking_assignment_state (
  booking_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  current_assignment_id BIGINT UNSIGNED NULL,
  current_staff_id BIGINT UNSIGNED NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE booking_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL,
  hotel_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NULL,
  assignment_version INT UNSIGNED NOT NULL,
  assigned_at DATETIME NOT NULL,
  ended_at DATETIME NULL,
  assignment_type VARCHAR(30) NOT NULL,
  skill_tier VARCHAR(30) NULL,
  freshness_bucket VARCHAR(30) NULL,
  reason TEXT NULL,
  UNIQUE KEY ux_booking_version (booking_id, assignment_version),
  KEY ix_hotel_staff_assignment (hotel_id, staff_user_id, assigned_at)
) ENGINE=InnoDB;

-- Không sử dụng unique(booking_id, ended_at) để kiểm soát active assignment
-- vì nhiều NULL vẫn hợp lệ trong unique index của MySQL.
```

**Định nghĩa `rooms.service_tier` khi migrate:** nên dùng `VARCHAR(20)` với giá trị điều khiển ở DTO thay vì thêm ENUM cố định khó mở rộng. Add column default STANDARD nhưng cần report liệt kê các room cũ có tên VIP/Luxury hoặc giá cao để quản lý rà soát; không tự xác nhận tất cả là VIP từ heuristic.

**Định nghĩa `booking_status_logs` actor hệ thống:** nếu cho phép `changed_by NULL` phải đồng bộ cả entity, migration và tất cả báo cáo join users. Dùng `actor_type='SYSTEM'` và NULL thật; không chèn user giả. Nếu chưa sẵn sàng migration actor, chưa được bật phân công V2 ở production.

### C.4. Khả năng test unit thuần, không phụ thuộc DB

```text
fixture: hotel=15, now=09:20, VIP, min safe level=2
 A: level5, assigned=08:30, active=true  => SOFT_RECENT (50m)
 B: level4, assigned=08:55, active=true  => EXCLUDED (<40m)
 C: level3, never assigned, active=true => FRESH, valid tier fallback
 expected: C (nếu level3 đạt rule tương ứng).

fixture: hotel=15, now=08:55, STANDARD
 A: assigned=08:30 => EXCLUDED
 B: approved late absence 08:00-09:30 => EXCLUDED
 manager M active => MANAGER_FALLBACK.

fixture: booking=502, now=2026-08-17 10:00,
 scheduled=[2026-08-15 17:00,2026-08-19 17:00),
 payment PAID, hold COMMITTED, status NO_SHOW,
 actor B valid coverage CHECK_IN => CHECKED_IN,
 hold count unchanged, actual check-in=17/08 10:00, actor=B.

fixture: A pre-arrival verified; B check-in via coverage; C in-stay via transfer
 expected: preArrival metric actor=A, checkin actor=B, inStay actor=C,
 booking handled_by=C, historical KPI of A/B unchanged.
```

---

## PHỤ LỤC D. TRIỂN KHAI THEO PR, KIỂM SOÁT XUNG ĐỘT VÀ ĐIỀU KIỆN DỪNG

| Gói PR / checkpoint | Sửa gì theo thứ tự | Test gate trước merge |
|---|---|---|
| PR-00 Baseline | Ghi commit/branch, chạy build+tests, sao lưu staging DB, preflight SQL | Có báo cáo pass/fail hiện trạng và danh sách lỗi cũ. |
| PR-01 Expand schema | Add `service_tier`, absence/assignment tables, actor log migration | Schema cũ vẫn được code cũ đọc; không DROP, sample data không mất. |
| PR-02 Absence policy | StaffAvailabilityModule, manager approval, FE form | Quyền hotel, time overlaps, double-decision, reason/audit. |
| PR-03 Assignment pure engine | Policy 40/120, skill level, simulation | Unit test clock boundaries, skills, fallback, deterministic ranking. |
| PR-04 Payment-outbox hook | Add `booking.assignment.requested` event, worker/receipt, feature flag | VNPay IPN/QueryDr/retry/refund/idempotency/hold không hồi quy. |
| PR-05 Presence schema/service | State machine No-show/late check-in, cron, adapter status | PAID COMMITTED no-show giữ phòng, cron race check-in, old PATCH. |
| PR-06 Coverage & transfer | Temporary grant + permanent transfer, task actor/history | CHECKED_IN transfer manager-only, A/B KPI provenance, expiration. |
| PR-07 Guest work & messaging | Task events, SLA, human conversation, service adapter | Actor security, real timestamps, service pricing/snapshot giữ nguyên. |
| PR-08 KPI + guest reviews | Review eligibility, 100-point engine, period snapshots | N/A, low sample, partial service A/B, duplicate reviews, version. |
| PR-09 Dashboard + hardening | Menu capabilities, hotel scoping, observability | Cross-tenant 403, pagination/count scoped, realtime auth. |
| PR-10 Release rehearsal | Canary, shadow mode, worker retry, rollback flags, regression matrix | REG-01 đến REG-20 + staging rollback drill. |

### D.1. Những tình huống **phải dừng release ngay**

- Một booking PAID nhưng hold COMMITTED bị giải phóng do No-show, hoặc có thể bán quá số phòng tồn.
- Một giao dịch VNPay bị nhân đôi số tiền/refund hoặc trả thất bại vì assignment worker lỗi.
- Hai booking cùng hotel cùng gán A trong vòng <40 phút khi đang áp dụng V2 và có người khác/manager khả dụng theo policy.
- Quyền của hotel A xem/sửa booking, đơn nghỉ, KPI, chi tiết khách hotel B.
- Manager đổi owner khi CHECKED_IN làm mất lịch sử actor A hoặc tính KPI của A cho B.
- No-show nhận phòng muộn tạo booking mới, thu tiền lần hai hoặc commit hold lần hai.
- Review sao của khách bị manager sửa trực tiếp, hoặc KPI được tính từ một click “hoàn thành” không có event/evidence.
- Code thiếu tương thích với schema actual; build xanh nhưng production query lỗi bảng/cột do migration chưa chạy.

### D.2. Báo cáo nghiệm thu từng PR cần nộp

Mỗi PR nên có: (1) danh sách file sửa và lý do; (2) migrations đã chạy ở đâu, `SHOW CREATE TABLE` đối chiếu; (3) ảnh/clip hoặc mô tả hành trình E2E; (4) kết quả `npm run build`, unit, E2E, lint trước/sau; (5) bằng chứng không phá REG test; (6) ví dụ request/response thực tế; (7) tính năng được bật bằng flag nào, cách tắt và dữ liệu xử lý khi rollback; (8) rủi ro tồn tại; (9) người review nghiệp vụ.

### D.3. Ba tiêu chí quyết định kiến trúc không thể bỏ

**Không biến giao việc thành thanh toán:** phân công thất bại phải retry độc lập, tiền và quyền phòng vẫn an toàn. **Không biến presence thành inventory:** No-show là khách chưa đến, không phải phòng được bán lại. **Không biến owner thành actor:** người chịu trách nhiệm hiện tại có thể là B, nhưng công việc đã hoàn thành bởi A vẫn là thành tích của A.

### D.4. Những công việc chưa nằm trong sáu đợt

Lịch ca trực đầy đủ, chấm công, lương, tuyển dụng, buồng phòng, tài sản phòng vật lý (số 301/302), room-unit allocations chi tiết, PMS accounting và tích hợp phần cứng khóa cửa là dự án riêng. Không thêm các domain này ngầm vào pull request hiện tại. Nếu về sau xây ca trực, `StaffAvailabilityService` nên trở thành lớp hợp nhất availability blocks và lịch ca chứ không viết lại booking assignment.

---

## KẾT LUẬN: THỨ TỰ TRIỂN KHAI PHẢI ĐƯỢC TÔN TRỌNG

Bản kiến trúc này khuyến nghị phát triển theo cách **mở rộng có kiểm soát**: (1) giữ nguyên thanh toán và tồn phòng; (2) bổ sung dữ liệu/đơn nghỉ và bộ phân công độc lập có khóa, sau commit; (3) bổ sung No-show có khả năng phục hồi mà không nhả phòng; (4) tách coverage tạm thời và chuyển giao hẳn; (5) ghi nhận công việc bằng event và đánh giá theo người thực hiện; (6) tính KPI có nguồn bằng chứng; (7) cuối cùng hoàn thiện Dashboard, quyền từng hotel và hồi quy.

Mục tiêu nghiệm thu không phải “có đủ các nút chức năng”, mà là **tất cả đường đi nghiệp vụ đã được chạy thử trong những tình huống bình thường, ngoại lệ, cạnh tranh dữ liệu, mất kết nối và hoàn tác có kiểm soát**; bất kỳ thay đổi nào chạm các mô-đun cũ đều phải chứng minh bằng regression test rằng các hành vi cũ hợp lệ vẫn hoạt động.

### Liên kết nguồn source đã đối chiếu

- Backend: [cg_traveleke_service, branch `minh`](https://github.com/HuuTri331/cg_traveleke_service/tree/minh), tại commit `6910f02eae600d32e965188b27bfb37643b73cc9`.
- Frontend: [cg_traveleke_app, branch `minh`](https://github.com/HuuTri331/cg_traveleke_app/tree/minh), tại commit `fde25aa388e842d60dd10cc5df89dda843000631`.
- Các điểm nguồn quan trọng: [BookingsService](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/bookings/bookings.service.ts), [BookingAccessService](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/bookings/services/booking-access.service.ts), [PaymentFinalizerService](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/payments/services/payment-finalizer.service.ts), [InventoryService](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/inventory/inventory.service.ts), [WorkersService](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/workers/workers.service.ts), [ServicesService](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/services/services.service.ts), [frontend bookings page](https://github.com/HuuTri331/cg_traveleke_app/blob/minh/src/app/%28dashboard%29/bookings/page.tsx).

