# TRAVELEKE — ĐẶC TẢ TÍNH NĂNG MỚI, LUỒNG ĐI NGHIỆP VỤ, VÒNG ĐỜI TRẠNG THÁI & LIÊN THÔNG MODULE CŨ (2026)

**Ngày ban hành:** 06/11/2026  
**Phạm vi áp dụng:** Hệ thống Backend (`cg_traveleke_service`) & Frontend (`cg_traveleke_app`) — Nhánh `minh`  
**Mục tiêu tài liệu:** Diễn giải toàn diện các nhóm tính năng mới vừa được bổ sung và chuẩn hóa, mô tả chi tiết luồng đi (Workflows), vòng đời trạng thái (Lifecycles) và cơ chế phối hợp, ràng buộc hai chiều với các module hiện hữu trong hệ thống. Tài liệu tập trung thuần túy vào kiến trúc nghiệp vụ và vận hành thực tế, không đi vào chi tiết mã nguồn.

---

## 1. TỔNG QUAN BỨC TRANH NGHIỆP VỤ MỚI & CÁC NGUYÊN TẮC BẤT BIẾN

Trước đợt nâng cấp này, hệ thống Traveleke đã vận hành tốt luồng đặt phòng theo hạng phòng (Room Type), thanh toán VNPay, phân công nhân sự công bằng theo khung 40/120 phút, theo dõi hiện diện (No-Show / Late Check-in), ủy quyền hỗ trợ tạm thời, giao việc phục vụ khách (Guest Work) và tính điểm KPI 8 tiêu chí.

Để vận hành như một hệ thống Quản trị Khách sạn & Đặt phòng Trực tuyến (Online PMS + OTA) khép kín ngoài thực tế, phần nâng cấp mới bổ sung **6 trụ cột nghiệp vụ lớn**:
1. **Quản lý Phòng vật lý (Physical Room Units), Xếp phòng theo từng đêm lưu trú, Buồng phòng (Housekeeping) & Khóa phòng bảo trì.**
2. **Cổng kiểm soát quyền ghi tập trung (`BookingWritePolicy`) đồng bộ hóa giữa Ca trực – Nghỉ phép – Ủy quyền tạm thời A/B.**
3. **Sửa đổi đơn đặt phòng sau thanh toán (Đổi ngày ở, tăng/giảm số lượng phòng) với cơ chế giữ chỗ phần chênh lệch (Delta Hold) và thanh toán phụ thu độc lập.**
4. **Sổ cái tài chính bất biến (Immutable Folio Ledger), Công cụ định giá theo từng đêm (Rate Calendar), Thuế/Phí và Mã giảm giá (Vouchers).**
5. **Trải nghiệm Khách hàng 360 độ (My Booking 360, Pre-Check-in trực tuyến, Chứng từ/Biên nhận, Đánh giá kỳ lưu trú & Chống gửi trùng thông báo).**
6. **Bảng điều hành Lễ tân trong ngày (Today's Desk Board), Kiểm toán cuối ngày (Night Audit), Báo cáo doanh thu chuẩn khách sạn (ADR, RevPAR) & Cấu hình chính sách từng cơ sở.**

### 7 Nguyên tắc Bất biến (System Invariants) xuyên suốt toàn hệ thống:
- **Bất biến 1 — Tách biệt Tồn kho Hạng phòng và Phòng vật lý:** Khách hàng đặt phòng theo *Hạng phòng* (Deluxe, Suite...) để giữ chỗ nhanh; Lễ tân xếp *Số phòng vật lý* (101, 202, 305...) trước hoặc tại thời điểm Check-in. Không bao giờ có hai đơn đặt phòng cùng chiếm một số phòng vật lý trong cùng một đêm lưu trú.
- **Bất biến 2 — Cổng kiểm tra sẵn sàng trước Check-in:** Không một đơn đặt phòng nào được chuyển sang trạng thái `CHECKED_IN` nếu chưa được gán đủ số lượng phòng vật lý đã xác minh (`VERIFIED`) và các phòng đó phải đang ở trạng thái dọn sạch sẵn sàng đón khách (`CLEAN_READY`).
- **Bất biến 3 — Độc quyền thao tác khi đang Ủy quyền (A/B Coverage):** Khi nhân viên chính (A) đã bàn giao tạm thời cho nhân viên nhận hỗ trợ (B) và B đã xác nhận nhận việc trong ca trực, chỉ một mình B được phép thao tác nghiệp vụ trên đơn đó. Nhân viên A bị khóa quyền ghi tạm thời để tránh xung đột thao tác hoặc nhắn tin chồng chéo cho khách.
- **Bất biến 4 — Đơn đã thanh toán không bao giờ quay ngược về chờ thanh toán:** Khi khách đã trả tiền cho đơn gốc (`PAID`), việc khách yêu cầu đổi ngày ở hoặc nâng hạng/thêm phòng phát sinh phụ thu sẽ đi trên một nhánh giao dịch phụ thu riêng biệt, tuyệt đối không làm đơn gốc bị quay về trạng thái `PENDING` hay làm mất quyền giữ phòng ban đầu.
- **Bất biến 5 — Không thể Check-out khi còn dư nợ Sổ cái (Folio Gate):** Khách không thể hoàn tất thủ tục `CHECKED_OUT` nếu tổng dư nợ trên Sổ cái Folio lớn hơn `0 VND`. Mọi khoản điều chỉnh giảm trừ công nợ tại quầy bắt buộc phải qua phê duyệt 4 mắt (Nhân viên lập – Quản lý khác duyệt).
- **Bất biến 6 — Tiền tệ nguyên đồng VND tuyệt đối:** Toàn bộ giá phòng theo đêm, thuế, phí dịch vụ, phụ thu và số dư sổ cái đều được tính toán và lưu trữ dưới dạng số nguyên đồng Việt Nam (`VND`), loại bỏ hoàn toàn sai số làm tròn số thập phân.
- **Bất biến 7 — Chống xử lý trùng lặp (Idempotency):** Mọi thao tác nhạy cảm từ phía giao diện (bấm nút xếp phòng nhiều lần khi mạng chậm) đến phía hệ thống (VNPay gọi lại IPN nhiều lần) đều được định danh bằng khóa lệnh duy nhất để đảm bảo chỉ thực thi và chỉ gửi thông báo đúng một lần.

---

## 2. NHÓM TÍNH NĂNG 1: QUẢN LÝ PHÒNG VẬT LÝ, XẾP PHÒNG THEO ĐÊM, BUỒNG PHÒNG & BẢO TRÌ

### 2.1. Tính năng cốt lõi
- **Danh mục Phòng vật lý (`room-units`):** Quản lý từng phòng cụ thể theo số phòng (ví dụ: `101`, `102`, `205`), tầng (`floor_code`), thuộc hạng phòng nào, trạng thái xác minh thực tế (`UNVERIFIED` / `VERIFIED` / `RETIRED`) và trạng thái vận hành hiện tại.
- **Xếp phòng theo từng đêm lưu trú (`room_unit_stay_slots`):** Khi gán một phòng vật lý cho khách ở từ ngày 10/11 đến 13/11 (3 đêm), hệ thống tạo ra 3 khe lưu trú cho các đêm `10/11`, `11/11` và `12/11`. Cơ sở dữ liệu khóa cứng quy tắc: mỗi số phòng vật lý chỉ có tối đa 1 khe đang hoạt động (`ACTIVE`) trên mỗi đêm.
- **Đổi phòng giữa kỳ lưu trú (`Move Room`):** Khi điều hòa hỏng hoặc khách xin đổi phòng ở đêm thứ 2, hệ thống giữ nguyên lịch sử đêm thứ 1 ở phòng cũ để tính KPI/bằng chứng, giải phóng các đêm còn lại của phòng cũ và cấp các đêm còn lại sang phòng mới.
- **Điều phối Buồng phòng (`housekeeping`) & Khóa bảo trì (`maintenance` / `room-incidents`):** Tự động sinh công việc dọn phòng khi khách trả phòng hoặc đổi phòng; cho phép khóa phòng bảo trì (`OUT_OF_ORDER`) trong một khoảng ngày nhất định kèm kiểm tra xung đột với các phòng đã gán cho khách.

### 2.2. Vòng đời trạng thái (Lifecycles)
1. **Vòng đời Xác minh Phòng vật lý:**
   - `UNVERIFIED` (Phòng mới khởi tạo tự động hoặc chưa nghiệm thu cơ sở vật chất — **bị cấm gán cho khách**) $\rightarrow$ `VERIFIED` (Đã xác minh thực tế, sẵn sàng khai thác) $\rightarrow$ `RETIRED` (Ngưng khai thác vĩnh viễn).
2. **Vòng đời Vận hành & Vệ sinh của Phòng vật lý:**
   - `CLEAN_READY` (Phòng sạch, sẵn sàng đón khách) $\rightarrow$ `OCCUPIED` (Khách đang lưu trú sau khi Check-in) $\rightarrow$ `DIRTY` (Khách vừa trả phòng hoặc vừa chuyển đi) $\rightarrow$ `CLEANING` (Nhân viên buồng phòng đang dọn) $\rightarrow$ `INSPECTED` / `CLEAN_READY` (Đã kiểm tra đạt chuẩn, mở lại để đón khách tiếp theo).
   - Nhánh sự cố/bảo trì: Từ bất kỳ trạng thái nào $\rightarrow$ `OUT_OF_ORDER` (Hỏng hóc nặng, khóa không cho xếp khách) hoặc `OUT_OF_SERVICE` (Tạm ngưng phục vụ ngắn hạn) $\rightarrow$ Khi sửa xong chuyển về `DIRTY` để dọn vệ sinh trước khi về lại `CLEAN_READY`.
3. **Vòng đời Khe lưu trú theo đêm (`Stay Slot`):**
   - `ACTIVE` (Đang giữ cho đơn đặt phòng) $\rightarrow$ chuyển sang một trong ba trạng thái kết thúc:
     - `RELEASED_CHECKOUT` (Giải phóng các đêm chưa ở tới khi khách trả phòng sớm/đúng hạn).
     - `RELEASED_MOVE` (Giải phóng các đêm còn lại khi khách đổi sang phòng khác giữa kỳ nghỉ).
     - `RELEASED_CANCEL` (Giải phóng toàn bộ các đêm khi đơn bị hủy hoặc đổi lịch trước khi ở).

### 2.3. Luồng đi chi tiết (End-to-End Flow)
1. **Bước 1 — Chuẩn bị và Chọn phòng trên Giao diện Lễ tân (`RoomAssignmentDialog`):**
   - Lễ tân mở đơn đặt phòng đã xác nhận, hệ thống tải danh sách các phòng vật lý thuộc đúng hạng phòng khách đặt, đang ở trạng thái `VERIFIED` + `CLEAN_READY`, không bị khóa bảo trì và chưa có khách nào chiếm trong các đêm lưu trú của đơn.
   - Mỗi lần lễ tân chọn một tổ hợp phòng, giao diện gắn một mã lệnh duy nhất (`commandId`) kèm phiên bản hiện tại của đơn (`expectedBookingVersion`).
   - Nếu mạng chập chờn và lễ tân bấm nút "Xác nhận gán phòng" nhiều lần liên tiếp cho cùng lựa chọn đó, hệ thống nhận diện cùng `commandId` + cùng danh sách phòng và trả về ngay biên nhận thành công mà không xử lý lặp. Nếu lễ tân cố tình dùng lại `commandId` cũ nhưng gửi danh sách phòng khác, hệ thống từ chối với mã `409 IDEMPOTENCY_KEY_REUSED_DIFFERENT_PAYLOAD`.
   - Nếu hai lễ tân ở hai máy tính khác nhau cùng chọn phòng `301` cho hai đơn trùng ngày ở và bấm xác nhận cùng lúc: người đầu tiên thành công; người thứ hai nhận mã phản hồi `409 Conflict (ROOM_UNIT_OCCUPIED)`. Giao diện của người thứ hai tự động tải lại danh sách phòng trống mới nhất từ máy chủ để chọn phòng khác ngay lập tức.
2. **Bước 2 — Kiểm tra tại thời điểm Check-in:**
   - Khi khách đến quầy làm thủ tục Check-in, hệ thống kiểm tra đơn đã được gán đủ số lượng phòng vật lý theo từng hạng phòng đã đặt hay chưa, và tất cả các phòng đó có đang ở trạng thái `CLEAN_READY` hay không. Nếu đạt, đơn chuyển sang `CHECKED_IN` và các phòng vật lý chuyển sang `OCCUPIED`.
3. **Bước 3 — Đổi phòng hoặc Check-out & Kích hoạt Buồng phòng:**
   - Khi khách đổi phòng hoặc hoàn tất Check-out, phòng vật lý lập tức chuyển sang trạng thái `DIRTY`, đồng thời hệ thống tự động sinh một nhiệm vụ dọn phòng (`HousekeepingTask`) gắn với mã sự kiện nguồn để bộ phận buồng phòng thực hiện.

### 2.4. Liên thông và tác động tới các Module cũ
- **Liên kết với Module Tồn kho Hạng phòng (`rooms` & `inventory` / `booking_holds`):**
  - Hoàn toàn tương thích ngược. Khi khách đặt phòng trên web/app, hệ thống vẫn trừ tồn kho tổng theo hạng phòng (`available_rooms`) thông qua `booking_holds` như cũ. Việc gán phòng vật lý diễn ra ở tầng điều hành bên dưới. Đặc biệt, khi hai lễ tân tranh chấp cùng một số phòng vật lý (`301`) dẫn đến lỗi `409 ROOM_UNIT_OCCUPIED`, giao dịch gán phòng bị từ chối nhưng **tuyệt đối không làm hủy hay giải phóng `booking_holds` đã cam kết (`COMMITTED`)** của đơn đặt phòng.
- **Liên kết với Module Đặt phòng (`bookings`):**
  - Bổ sung cột phiên bản `version` trên bảng `bookings` để chống ghi đè mù (Optimistic Concurrency Control) khi nhiều người cùng cập nhật đơn, và bổ sung cổng chặn tại hàm Check-in của `BookingsService`.
- **Liên kết với Module Giao việc & KPI (`guest-work` & `staff-kpi`):**
  - Thời điểm lễ tân hoàn tất gán phòng sẵn sàng trước giờ khách đến và kết quả xử lý sự cố phòng (`room-incidents`) được kết nối làm bằng chứng cho tiêu chí chuẩn bị trước giờ đến (`PRE_ARRIVAL_PREP`) và xử lý khiếu nại (`COMPLIANCE_ACCURACY` / `COMPLAINT_RESOLUTION`).

---

## 3. NHÓM TÍNH NĂNG 2: CỔNG KIỂM SOÁT QUYỀN GHI TẬP TRUNG, CA TRỰC & ỦY QUYỀN A/B (`BookingWritePolicy`)

### 3.1. Tính năng cốt lõi
- **Cổng kiểm soát quyền thao tác tập trung (`BookingWritePolicy`):** Mọi hành động làm thay đổi trạng thái hoặc dữ liệu vận hành của đơn đặt phòng (`CHECK_IN`, `CHECK_OUT`, `ROOM_ASSIGN`, `MOVE_ROOM`, `MESSAGE`, `AMEND_BOOKING`, `FOLIO_SETTLEMENT`, `STAY_TIME_REQUEST`) đều phải đi qua một bộ lọc chính sách duy nhất nằm trong khóa giao dịch của đơn.
- **Chuyển giao quyền độc quyền tạm thời từ A sang B (`A/B Coverage Exclusive Write`):** Khi nhân viên phụ trách chính (A) có việc đột xuất/nghỉ phép và được ủy quyền tạm thời cho đồng nghiệp (B), ngay khi B xác nhận nhận việc và đang trong ca trực, quyền ghi trên đơn chuyển sang độc quyền cho B trong suốt khung giờ ủy quyền.
- **Kiểm soát Ca trực (`shifts`) & Nghỉ phép (`staff-availability`):** Nhân viên chỉ được thực hiện thao tác vận hành khi đang trong ca trực hợp lệ và không nằm trong khung giờ nghỉ phép/đi muộn đã được Quản lý phê duyệt.
- **Tách biệt quyền Quản trị viên (`ADMIN` Audit Override):** Tài khoản `ADMIN` không được tự ý thao tác trực tiếp như một lễ tân đang trực ca (để tránh làm sai lệch quy kết KPI của nhân viên), trừ khi thực hiện lệnh ghi đè khẩn cấp có kèm lý do kiểm toán bắt buộc (`overrideReason`).

### 3.2. Vòng đời trạng thái (Lifecycles)
1. **Vòng đời Ủy quyền Tạm thời (`BookingCoverageGrant`):**
   - `PENDING_ACCEPTANCE` (Vừa khởi tạo lệnh ủy quyền từ A sang B) $\rightarrow$ `ACTIVE` (Khi B đã xác nhận nhận bàn giao `accepted_at IS NOT NULL` và thời gian hiện tại nằm trong khoảng `start_at <= now < end_at`) $\rightarrow$ kết thúc tại một trong các trạng thái:
     - `EXPIRED` (Hết thời hạn ủy quyền, quyền thao tác tự động trả về cho A nếu A đã quay lại ca trực).
     - `REVOKED` (Thu hồi ủy quyền trước hạn bởi Quản lý hoặc khi A trở lại sớm).
     - `SUPERSEDED` (Khi Quản lý quyết định chuyển giao vĩnh viễn `Permanent Transfer` đơn đó sang cho B hoặc nhân viên C).
2. **Vòng đời Ca trực & Khả dụng nhân sự:**
   - Ca trực (`StaffShift`): `SCHEDULED` (Đã xếp lịch) $\rightarrow$ `ACTIVE / CHECKED_IN` (Đang trong ca làm việc) $\rightarrow$ `COMPLETED` (Hoàn thành ca) | `CANCELLED`.
   - Khối vắng mặt (`StaffAvailabilityBlock`): `PENDING` (Nhân viên gửi đơn xin nghỉ/vắng mặt) $\rightarrow$ `APPROVED` (Quản lý duyệt — lập tức kích hoạt chặn thao tác nghiệp vụ trong khung giờ nghỉ) | `REJECTED`.

### 3.3. Luồng đi chi tiết (End-to-End Flow)
1. **Khi không có ủy quyền tạm thời:**
   - Nhân viên A (người đang đứng tên `handled_by` trên đơn) thực hiện gán phòng, Check-in hoặc nhắn tin cho khách. Hệ thống kiểm tra: (1) A còn công tác `ACTIVE` tại khách sạn; (2) A không có đơn nghỉ phép `APPROVED` trùng giờ hiện tại; (3) A đang có mặt trong ca trực hợp lệ. Nếu thỏa mãn cả 3 điều kiện, thao tác được thực thi và ghi nhận `executorId = A`.
2. **Khi đang có ủy quyền tạm thời từ A sang B:**
   - Quản lý duyệt đơn vắng mặt của A và kích hoạt ủy quyền tạm thời cho B (phạm vi toàn bộ công việc của đơn `BOOKING_TASKS` hoặc theo nhóm việc cụ thể như `CHECK_IN`, `ROOM_ASSIGN`, `MESSAGE`).
   - Nhân viên B bấm xác nhận nhận bàn giao và đang trong ca trực: Khi B bấm Check-in, gán phòng hoặc trả lời tin nhắn khách hàng, hệ thống cho phép thực thi và lưu vết `{ executorId: B, coverageGrantId: grantId }`.
   - Nếu trong khoảng thời gian đó, nhân viên A mở ứng dụng lên và cố tình bấm Check-in, đổi phòng hoặc nhắn tin vào cuộc hội thoại của khách, hệ thống lập tức chặn lại với lỗi `403 COVERAGE_ACTIVE_ONLY_DELEGATE_CAN_WRITE`.

### 3.4. Liên thông và tác động tới các Module cũ
- **Liên kết với Module Phân công (`booking-assignment`):** Giữ nguyên người phụ trách gốc (`handled_by = A`) trong suốt thời gian ủy quyền tạm thời để không làm xáo trộn hạn ngạch phân công 40/120 phút, nhưng mọi sự kiện thực thi đều ghi rõ người làm thực tế là B. Nếu chuyển sang bàn giao vĩnh viễn (`transferPermanent`), hệ thống mới đổi `handled_by = B`, tăng `assignment_version` và đóng toàn bộ ủy quyền tạm thời cũ.
- **Liên kết với Module Trò chuyện với khách (`guest-conversations`):** Trước đây chỉ kiểm tra quyền theo chủ đơn; nay `GuestConversationsService` truyền mã hành động `'MESSAGE'` qua chính sách kiểm soát để đảm bảo khi B đang nhận ủy quyền, A không thể nhắn tin chồng chéo gây hoang mang cho khách.
- **Liên kết với Module Đánh giá & KPI (`staff-kpi` & `guest-staff-reviews`):** Nhờ lưu vết cặp `(executorId, coverageGrantId)` trên từng hành động, hệ thống KPI biết chính xác giai đoạn nào do A phục vụ, giai đoạn nào do B hỗ trợ để tính điểm SLA và phân bổ đánh giá sao của khách công bằng cho từng người.

---

## 4. NHÓM TÍNH NĂNG 3: SỬA ĐỔI ĐƠN ĐẶT PHÒNG SAU THANH TOÁN (`booking-amendments`, `multi-line-hold`, `stay-extras`)

### 4.1. Tính năng cốt lõi
- **Đổi ngày nhận/trả phòng & Tăng/giảm số lượng phòng sau khi đã thanh toán (`PAID`):** Cho phép khách hàng hoặc lễ tân điều chỉnh lịch lưu trú mà không cần hủy đơn cũ đặt lại từ đầu.
- **Giữ chỗ phần chênh lệch (`Delta Hold`) & Giỏ hàng đa hạng phòng nguyên tử (`Multi-Line Atomic Hold`):** Khi khách đặt nhiều hạng phòng trong một giỏ hàng hoặc xin thêm phòng/thêm đêm, hệ thống chỉ giữ chỗ bổ sung cho phần chênh lệch tăng thêm. Nếu bất kỳ hạng phòng nào trong giỏ hàng không đủ số lượng trống, toàn bộ yêu cầu giữ chỗ sẽ tự động hoàn tác (Atomic Rollback), không bao giờ giữ chỗ dở dang.
- **Khóa chống sửa đổi kép (`booking_active_amendments`):** Tại một thời điểm, mỗi đơn đặt phòng chỉ được phép có tối đa 1 yêu cầu sửa đổi đang mở.
- **Tách bạch Nhận phòng sớm / Trả phòng muộn (`Stay Time Request`) và Ở thêm đêm (`Extra Night`):** Yêu cầu nhận phòng sớm hoặc trả phòng muộn trong ngày được kiểm tra va chạm trực tiếp với khe lưu trú của khách kế tiếp trên cùng phòng vật lý; trong khi yêu cầu ở thêm đêm bắt buộc phải đi qua luồng Sửa đổi đơn (`Booking Amendment`) để trừ tồn kho phòng chính thức.

### 4.2. Vòng đời trạng thái (Lifecycles)
- **Vòng đời Yêu cầu Sửa đổi (`BookingAmendment`):**
  - `QUOTED` (Đã tính toán chênh lệch tiền `delta_amount_vnd` và giữ chỗ tạm thời cho phần đêm/phòng tăng thêm với hạn sử dụng `quote_expires_at`) $\rightarrow$ chuyển sang:
    - `COMMITTED` ngay lập tức nếu không phát sinh thêm tiền (`delta_amount_vnd <= 0`). Nếu giảm tiền và chính sách cho phép hoàn một phần, hệ thống tạo lệnh hoàn phần chênh lệch.
    - `AWAITING_SURCHARGE_PAYMENT` (Nếu `delta_amount_vnd > 0`, chờ khách thanh toán khoản phụ thu qua VNPay hoặc tại quầy).
  - Từ `AWAITING_SURCHARGE_PAYMENT` $\rightarrow$ chuyển sang một trong các trạng thái kết thúc:
    - `COMMITTED` (Khi tiền phụ thu được xác nhận thanh toán trong thời hạn giữ chỗ `quote_expires_at` $\rightarrow$ áp dụng ngày mới/số phòng mới vào đơn gốc).
    - `EXPIRED` / `CANCELLED` (Khi hết thời hạn giữ chỗ mà khách không thanh toán hoặc khách chủ động hủy yêu cầu đổi lịch $\rightarrow$ đơn gốc giữ nguyên 100%).
    - `RECONCILIATION_REQUIRED` (Trường hợp đặc biệt: khách thanh toán phụ thu thành công nhưng **muộn** sau khi `quote_expires_at` đã hết hạn và phòng tăng thêm đã bị người khác đặt hết $\rightarrow$ **giữ nguyên đơn gốc ban đầu** để khách vẫn có phòng ở theo lịch cũ, đồng thời đưa khoản tiền phụ thu vào danh sách đối soát để hoàn trả hoặc hỗ trợ đổi hạng phòng tại quầy).

### 4.3. Luồng đi chi tiết (End-to-End Flow)
1. **Bước 1 — Yêu cầu Báo giá sửa đổi (Quote):**
   - Khách đang có đơn `X` đã thanh toán (`PAID`) cho 2 đêm (10/11 – 12/11), nay muốn đổi thành 3 đêm (10/11 – 13/11).
   - Hệ thống kiểm tra bảng `booking_active_amendments` để chắc chắn đơn `X` không có yêu cầu sửa đổi nào khác đang chạy, sau đó kiểm tra tồn kho đêm `12/11`, tạm giữ chỗ đêm `12/11` trong 15 phút và tính số tiền phụ thu.
2. **Bước 2 — Thanh toán Phụ thu độc lập:**
   - Hệ thống khởi tạo một giao dịch thanh toán mới gắn nhãn mục đích `purpose = AMENDMENT_SURCHARGE` và gắn `amendment_id`. Trong suốt thời gian khách đang mở cổng VNPay để trả tiền phụ thu, đơn gốc `X` vẫn giữ nguyên trạng thái `CONFIRMED` + `PAID` và nhân viên lễ tân A vẫn giữ nguyên quyền phụ trách.
3. **Bước 3 — Xác nhận Thanh toán Phụ thu & Chốt sửa đổi:**
   - Khi VNPay trả kết quả IPN thành công cho giao dịch `AMENDMENT_SURCHARGE`, bộ hoàn tất thanh toán (`PaymentFinalizerService`) nhận diện đây là giao dịch phụ thu nên phát sự kiện `amendment.surcharge_paid.v1` để chốt yêu cầu sửa đổi: cập nhật ngày ở mới cho đơn `X`, tăng `version` của đơn, ghi bút toán phụ thu + thanh toán vào Sổ cái Folio, và giải phóng khóa `booking_active_amendments`.

### 4.4. Liên thông và tác động tới các Module cũ
- **Liên kết với Module Thanh toán (`payments` / `PaymentFinalizerService`):**
  - Đây là điểm chạm cực kỳ quan trọng: trước đây mọi giao dịch qua `PaymentFinalizerService` đều mặc định coi là thanh toán đơn đặt phòng ban đầu. Nay `PaymentFinalizerService` kiểm tra trường `purpose`: nếu là `AMENDMENT_SURCHARGE`, hệ thống chỉ xác nhận tiền cho bản sửa đổi và **tuyệt đối không reset đơn gốc về `PENDING`, không phát lại sự kiện phân công lễ tân từ đầu**.
- **Liên kết với Module Hủy phòng & Hoàn tiền (`cancellations`):**
  - Cả hàm gửi yêu cầu hủy (`createRequest`) và hàm duyệt hủy (`approveCancellation`) trong `CancellationsService` đều khóa dòng đơn đặt phòng và kiểm tra xem có yêu cầu sửa đổi nào đang mở hay không. Nếu đang có sửa đổi dở dang (`AMENDMENT_IN_PROGRESS`), hệ thống chặn việc hủy đơn để tránh lỗi tính sai số tiền hoàn hoặc hoàn tiền trùng lặp.

---

## 5. NHÓM TÍNH NĂNG 4: SỔ CÁI TÀI CHÍNH BẤT BIẾN (FOLIO), ĐỊNH GIÁ THEO ĐÊM (RATE CALENDAR), THUẾ PHÍ & VOUCHERS

### 5.1. Tính năng cốt lõi
- **Sổ cái Tài chính Chỉ ghi thêm (`folio` / `FolioPostingService`):** Mỗi đơn đặt phòng có một Sổ cái Folio riêng ghi nhận mọi biến động tài chính bằng các bút toán bất biến (`folio_entries`). Không bao giờ sửa hoặc xóa dòng tiền cũ; mọi điều chỉnh hay hoàn trả đều là bút toán mới có dấu âm/dương rõ ràng.
- **Công cụ Định giá theo từng đêm lưu trú (`rate-plans` / `rate-resolver`):** Tính tiền phòng theo từng ngày cụ thể trên lịch giá (`rate_calendar` — cho phép giá cuối tuần, ngày lễ khác ngày thường), cộng/trừ hệ số theo gói giá (`RatePlan`), nhân với số lượng phòng hoàn toàn bằng số nguyên đồng Việt Nam (`bigint VND`).
- **Tách bạch Cấu phần Giá, Thuế GTGT & Phí dịch vụ (`price-components` & `service-packages`):** Minh bạch hóa tiền phòng cơ sở, phí dịch vụ khách sạn, thuế VAT và các gói dịch vụ đi kèm (ăn sáng, đưa đón sân bay, giặt ủi).
- **Quản lý Mã giảm giá có Giữ chỗ (`vouchers`):** Giữ suất mã giảm giá ngay khi khách tạo đơn chờ thanh toán, chốt sử dụng khi đơn thanh toán thành công và tự động nhả suất mã nếu đơn hết hạn thanh toán hoặc bị hủy.

### 5.2. Vòng đời trạng thái (Lifecycles)
1. **Vòng đời Sổ cái Folio & Các loại Bút toán (`FolioEntry`):**
   - Sổ cái được khởi tạo tự động ngay khi đơn có phát sinh tài chính đầu tiên $\rightarrow$ duy trì ở trạng thái mở trong suốt kỳ lưu trú $\rightarrow$ chỉ cho phép đóng/hoàn tất Check-out khi tổng đại số của toàn bộ bút toán bằng `0 VND`.
   - Quy ước dấu của 4 loại bút toán trong Sổ cái:
     - `CHARGE` (**Dương `+`**): Khoản khách phải trả (tiền phòng gốc, phụ thu đổi lịch, phí dịch vụ phòng phát sinh trong lúc ở, phí nhận phòng sớm/trả phòng muộn).
     - `PAYMENT` (**Âm `-`**): Khoản tiền khách đã thanh toán và được xác minh (qua VNPay hoặc thu tại quầy).
     - `REFUND` (**Dương `+`**): Khoản tiền khách sạn đã hoàn trả lại cho khách (làm giảm số tiền khách sạn đang giữ).
     - `ADJUSTMENT` (**Dương `+` hoặc Âm `-`**): Khoản điều chỉnh công nợ/giảm trừ thiện chí tại quầy (bắt buộc có người lập và Quản lý phê duyệt khác nhau theo nguyên tắc 4 mắt).
2. **Vòng đời Giữ chỗ Mã giảm giá (`VoucherReservation`):**
   - `RESERVED` (Khách áp mã lúc đặt phòng — tạm trừ hạn ngạch sử dụng) $\rightarrow$ `REDEEMED` (Khách hoàn tất thanh toán `PAID`) | `RELEASED` (Đơn quá hạn giữ chỗ hoặc hủy — trả lại lượt dùng cho khách/chiến dịch).

### 5.3. Luồng đi chi tiết (End-to-End Flow)
1. **Khi đặt phòng và thanh toán lần đầu (ví dụ 2.000.000 VND):**
   - Sổ cái ghi nhận 1 bút toán `CHARGE` `+2.000.000 VND` (tiền phòng) và 1 bút toán `PAYMENT` `-2.000.000 VND` (VNPay xác nhận). Số dư hiện tại = `0 VND`.
2. **Trong quá trình khách lưu trú tại khách sạn:**
   - Khách gọi thêm dịch vụ giặt ủi và minibar trị giá `250.000 VND`. Hệ thống ghi thêm 1 bút toán `CHARGE` `+250.000 VND` với khóa chống trùng `idempotency_key`. Lúc này số dư nợ trên Sổ cái là `+250.000 VND`.
   - Nếu hệ thống hoặc nhân viên gửi trùng lại cùng khóa `idempotency_key` với cùng số tiền, Sổ cái trả về bút toán đã ghi mà không cộng tiền hai lần. Nếu dùng lại khóa cũ nhưng đổi số tiền khác, hệ thống báo lỗi `409 IDEMPOTENCY_KEY_REUSED_DIFFERENT_PAYLOAD`.
3. **Khi khách làm thủ tục Trả phòng (Check-out Gate):**
   - Lễ tân bấm nút Check-out khi khách chưa thanh toán khoản `250.000 VND` dịch vụ phát sinh: Hệ thống kiểm tra tổng Sổ cái và chặn đứng thao tác Check-out với thông báo `409 FOLIO_OUTSTANDING: 250000 VND`.
   - Sau khi khách thanh toán `250.000 VND` (ghi nhận bút toán `PAYMENT` `-250.000 VND`), tổng dư nợ về `0 VND` và thủ tục Check-out được thông qua.

### 5.4. Liên thông và tác động tới các Module cũ
- **Liên kết với Module Dịch vụ Khách sạn (`services`) & Đặt phòng (`bookings`):**
  - Mọi yêu cầu dịch vụ (`ServiceRequest`) phát sinh chi phí khi hoàn tất đều được kết nối sang Sổ cái Folio thay vì nằm rời rạc, và bước chuyển trạng thái `CHECKED_OUT` của `BookingsService` bắt buộc phải vượt qua cổng kiểm tra công nợ của Folio.
- **Liên kết với Module Khuyến mãi cũ (`promotions`):**
  - Giữ nguyên bảng khuyến mãi hiển thị của khách sạn, đồng thời bổ sung tầng kiểm soát hạn ngạch chặt chẽ qua `voucher_codes` và `voucher_reservations` để chống lỗi nhiều người bấm áp cùng một mã giảm giá chỉ còn 1 lượt cuối cùng (Race Condition).

---

## 6. NHÓM TÍNH NĂNG 5: TRẢI NGHIỆM KHÁCH HÀNG 360 ĐỘ, PRE-CHECK-IN, CHỨNG TỪ & THÔNG BÁO CHỐNG TRÙNG

### 6.1. Tính năng cốt lõi
- **Trang Chi tiết Đơn đặt phòng 360 độ cho Khách hàng (`my-booking`):** Tổng hợp toàn bộ trạng thái đơn, trạng thái thanh toán, thông tin nhân viên phụ trách (hoặc người đang nhận ủy quyền hỗ trợ), số phòng vật lý đã được gán, số dư Sổ cái Folio và tập hợp các quyền thao tác hợp lệ (`allowedActions`) do máy chủ tính toán sẵn.
- **Làm thủ tục khai báo trước khi đến (`precheckin`):** Khách hàng khai báo giờ đến dự kiến (ETA), số lượng khách thực tế, yêu cầu đặc biệt và thông tin giấy tờ tùy thân đã được mã hóa/che số nhạy cảm (`id_doc_masked`) theo từng phiên bản (`version`).
- **Xuất Chứng từ Đặt phòng & Biên nhận Thanh toán (`booking-documents`) & Đánh giá Kỳ lưu trú (`stay-reviews`):** Cung cấp phiếu xác nhận đặt phòng, biên nhận thu tiền/hoàn tiền chính thức và tách biệt đánh giá chất lượng cơ sở vật chất khách sạn (`stay-reviews`) với đánh giá thái độ phục vụ của nhân sự (`guest-staff-reviews`).
- **Hệ thống Ý định Thông báo Chống gửi trùng (`booking-notifications` / `NotificationIntentService`):** Đảm bảo mỗi sự kiện nghiệp vụ (như thanh toán thành công, xác nhận đổi ngày, thông báo gán phòng) chỉ phát sinh đúng 1 thông báo trên mỗi kênh (Email / In-App / SMS) tới người nhận, bất kể cổng thanh toán hay hàng đợi chạy lại bao nhiêu lần.

### 6.2. Vòng đời trạng thái (Lifecycles)
1. **Vòng đời Hồ sơ Pre-Check-in (`PrecheckinSubmission`):**
   - `SUBMITTED` (Khách hàng gửi thông tin trực tuyến trước giờ đến; mỗi lần cập nhật sẽ tăng số `version`) $\rightarrow$ `VERIFIED_AT_DESK` (Lễ tân kiểm tra đối chiếu giấy tờ gốc tại quầy khi khách đến nhận phòng) | `NEEDS_UPDATE` (Yêu cầu khách bổ sung thông tin).
2. **Vòng đời Ý định Thông báo (`NotificationIntent`):**
   - `PENDING` (Được ghi vào bảng `notification_intents` trong cùng giao dịch cơ sở dữ liệu với sự kiện nghiệp vụ) $\rightarrow$ `PROCESSING` $\rightarrow$ `SENT` (Đã gửi thành công) | `FAILED` (Gửi lỗi, chờ thử lại theo cơ chế Backoff).

### 6.3. Luồng đi & Liên thông Module cũ
- **Liên kết với Module Thanh toán (`payments`):** Khi VNPay gửi lại thông báo IPN 5 lần cho cùng một giao dịch đã thanh toán, `NotificationIntentService` đối chiếu tổ hợp khóa duy nhất `(source_event_id, template_key, channel, recipient_key)` và bỏ qua 4 lần trùng sau (`INSERT IGNORE`), giúp khách hàng không bao giờ bị nhận 5 email xác nhận giống hệt nhau.
- **Liên kết với Module Hồ sơ Khách hàng & Quyền riêng tư (`guest-profiles`):** Cho phép khách hàng quản lý tùy chọn cá nhân (phòng yên tĩnh, tầng cao...) và thu hồi quyền nhận tiếp thị hoặc xóa thông tin sở thích cá nhân theo chuẩn bảo mật dữ liệu mà **vẫn bảo toàn nguyên vẹn Sổ cái tài chính Folio và hóa đơn/biên nhận** phục vụ kiểm toán thuế.

---

## 7. NHÓM TÍNH NĂNG 6: BẢNG ĐIỀU HÀNH LỄ TÂN TRONG NGÀY, KIỂM TOÁN ĐÊM & BÁO CÁO DOANH THU CHUẨN KHÁCH SẠN

### 7.1. Tính năng cốt lõi
- **Bảng Điều hành Lễ tân Trong ngày (`desk-board` — Giao diện `/today`, `/room-board`, `/housekeeping`):** Gom toàn bộ công việc trong ngày của lễ tân về một màn hình điều hành thời gian thực: Danh sách khách sắp đến hôm nay (Arrivals), Khách đang lưu trú (In-House), Khách sắp trả phòng (Departures), Đơn chưa xếp phòng vật lý (Unassigned Units), Phòng đang bẩn cần dọn gấp (Dirty Rooms) và các nhiệm vụ sắp chạm ngưỡng SLA.
- **Kiểm toán Cuối ngày (`night-audit`):** Quy trình chốt sổ cuối ngày kinh doanh của khách sạn — tự động rà soát các đơn đến hạn mà chưa Check-in để chuyển xử lý No-Show, kiểm tra các phòng chưa đóng ca và khóa số liệu doanh thu theo ngày kinh doanh (`business_date`).
- **Báo cáo Doanh thu Chuẩn Quản trị Khách sạn (`revenue-reports`):** Tính toán chính xác các chỉ số tài chính cốt lõi của ngành khách sạn dựa trên doanh thu đã xác minh:
  - **Net Room Revenue:** Doanh thu phòng thuần sau khi trừ hoàn tiền.
  - **ADR (Average Daily Rate):** Giá phòng bình quân thực thu trên mỗi đêm phòng đã bán.
  - **RevPAR (Revenue Per Available Room):** Doanh thu bình quân trên mỗi đêm phòng khả dụng.
- **Cấu hình Chính sách Cơ sở & Nội dung Phiên bản (`property-settings`, `hotel-content`, `booking-rules`, `channel-sync`):** Quản lý múi giờ riêng của từng khách sạn (`Asia/Ho_Chi_Minh`), giờ Check-in/Check-out chuẩn, đóng băng bản chụp chính sách hủy/trẻ em tại thời điểm khách đặt đơn (`Policy Snapshot`), và cổng đồng bộ lịch phòng ngoài (`Channel Sync`) có cờ bật/tắt an toàn (`Feature Flags`).

---

## 8. BẢNG TỔNG HỢP ĐIỂM CHẠM LIÊN THÔNG GIỮA MODULE MỚI VÀ MODULE CŨ

| Module Mới / Mở rộng | Module Cũ Liên quan | Cơ chế Phối hợp & Ràng buộc Hai chiều |
|---|---|---|
| **`room-units` & `housekeeping`** | `bookings`, `rooms`, `inventory` | Giữ nguyên trừ tồn kho hạng phòng (`booking_holds`); bổ sung cổng bắt buộc gán đủ phòng vật lý `VERIFIED` + `CLEAN_READY` trước khi `CHECKED_IN`. Tự động tạo việc dọn phòng khi `CHECKED_OUT` hoặc đổi phòng. |
| **`BookingWritePolicy`** | `booking-coverage`, `shifts`, `staff-availability`, `guest-conversations` | Chặn nhân viên A thao tác (Check-in, gán phòng, nhắn tin...) khi đồng nghiệp B đang giữ ủy quyền `ACTIVE` đã nhận việc; bắt buộc nhân viên phải đang trong ca trực và không nằm trong lịch nghỉ phép đã duyệt. |
| **`booking-amendments`** | `payments`, `cancellations`, `inventory` | Phân nhánh `AMENDMENT_SURCHARGE` trong `PaymentFinalizerService` để không reset đơn gốc về `PENDING`; khóa chức năng hủy đơn trong `CancellationsService` khi đang có yêu cầu sửa đổi chưa hoàn tất. |
| **`folio` (`FolioPostingService`)** | `bookings`, `services`, `payments`, `cancellations` | Ghi nhận mọi khoản thu/chi/phụ thu/dịch vụ bằng số nguyên VND bất biến; chặn `CHECKED_OUT` nếu số dư Sổ cái `> 0 VND`; áp dụng nguyên tắc 4 mắt cho mọi điều chỉnh giảm giá tại quầy. |
| **`rate-plans` & `vouchers`** | `rooms`, `promotions`, `bookings` | Tính giá phòng chi tiết theo từng đêm lưu trú (`Rate Calendar`) bằng `bigint VND`; giữ chỗ mã giảm giá theo phiên báo giá và tự động thu hồi lượt dùng nếu đơn quá hạn thanh toán. |
| **`booking-notifications`** | `payments`, `bookings`, `workers` | Khử trùng lặp tuyệt đối theo khóa `(source_event_id, template_key, channel, recipient_key)` khi webhook thanh toán hoặc worker chạy lại. |
| **`my-booking`, `desk-board`, `night-audit`** | `bookings`, `booking-presence`, `guest-work`, `staff-kpi` | Tổng hợp dữ liệu đa chiều cho cả Khách hàng (My Booking 360) và Lễ tân/Quản lý (Today's Desk Board, Night Audit, ADR/RevPAR) mà không làm phá vỡ bất kỳ API hiện hữu nào. |





