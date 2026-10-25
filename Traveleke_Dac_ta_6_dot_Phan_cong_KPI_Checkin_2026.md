# ĐẶC TẢ NGHIỆP VỤ VÀ KẾ HOẠCH PHÁT TRIỂN TRAVELEKE

**Chủ đề:** Phân công lễ tân công bằng – đơn xin nghỉ/đi muộn – hỗ trợ thay tạm thời/bàn giao hoàn toàn – No-show/check-in muộn – KPI theo bằng chứng.

**Phiên bản:** 1.0 | **Ngày biên soạn:** 25/10/2026 | **Phạm vi:** Backend NestJS, frontend Next.js, cơ sở dữ liệu quan hệ, tích hợp VNPay.  
**Nhánh đối chiếu:** `minh` tại `HuuTri331/cg_traveleke_service` và `HuuTri331/cg_traveleke_app`.  
**Tính chất:** Đặc tả để triển khai; các thay đổi nêu dưới đây là **đề xuất phát triển**, không phải khẳng định đã hoàn thành trên repository.

## TÓM TẮT ĐIỀU HÀNH

Dự án có ba đối tượng nghiệp vụ: **khách hàng (CUSTOMER), quản lý khách sạn (HOTEL_MANAGER), nhân viên lễ tân (RECEPTIONIST)**. Có thể tiếp tục giữ `ADMIN` kỹ thuật trong hệ thống hiện tại, nhưng không tính là vai trò vận hành thứ tư. Chưa triển khai xếp lịch ca, chấm công, tính lương hoặc phân hệ nhân sự toàn diện.

Các quyết định đã chốt:

1. **Phân công sau thanh toán thành công:** Chọn lễ tân đang hoạt động của đúng khách sạn, không bị khóa, không trong khoảng nghỉ/đi muộn đã được quản lý chấp thuận, và đủ khả năng xử lý cấp độ phòng. Luồng callback VNPay, đối soát và retry phải có cùng kết quả, không phân công trùng.
2. **Công bằng theo cửa sổ trượt:** Sau lần được giao gần nhất, **dưới 40 phút** không được tự động nhận booking khác; **từ 40 đến dưới 120 phút** được chọn lại nhưng ưu tiên thấp hơn người đủ năng lực chưa nhận booking trong 120 phút; **từ 120 phút** trở lên được xét bình thường. Luôn rà soát các mức năng lực thấp hơn phù hợp trước khi dồn thêm đơn cho nhân viên vừa được giao trong 120 phút.
3. **Mở rộng dần mức năng lực:** Với phòng VIP, xét lễ tân cao cấp trước; thiếu thì giảm yêu cầu kinh nghiệm theo các bậc cấu hình, không xuống dưới ngưỡng năng lực an toàn. Không ai đủ/khả dụng thì quản lý khách sạn tiếp nhận. Phòng phổ thông ưu tiên cấp năng lực tương xứng, không để người cao cấp nhận hết.
4. **Nhân viên có quyền xin nghỉ hoặc đi muộn:** Lễ tân gửi đơn; quản lý duyệt/từ chối, hệ thống lưu lịch sử, điều chỉnh tập nhân viên khả dụng theo **khoảng thời gian đã duyệt**. Đây là cơ chế ngoại lệ về sự hiện diện, **không phải module ca trực**.
5. **Hai loại thay người:** Hỗ trợ thay **tạm thời** mặc định **120 phút**, cấu hình trong phạm vi **15 phút–24 giờ**, giới hạn nhiệm vụ và được gia hạn có duyệt; hoặc chuyển giao **hoàn toàn** từ A sang B. KPI cũ của A giữ nguyên, KPI từng tác vụ của B được tính cho B.
6. **No-show không giải phóng tồn phòng:** Đơn đã thanh toán và hold `COMMITTED` tiếp tục giữ quyền phòng trong khoảng `[check_in_at, check_out_at)` dù khách chưa đến. Khách có thể check-in muộn từ `NO_SHOW` khi còn trong kỳ đặt và chưa phát sinh hủy/hoàn tiền hợp lệ; không bán trùng phòng.
7. **KPI không nhập điểm tùy ý:** Dữ liệu chính từ sự kiện hệ thống có kiểm chứng, khách đánh giá 1–5 sao cho đúng nhân viên và đúng giai đoạn, quản lý chỉ xác minh/nhận xét có chứng cứ. Kết quả tính theo kỳ, lưu cả điểm thành phần, tập mẫu và lịch sử điều chỉnh.

**Lộ trình giữ nguyên sáu đợt:** (1) chuẩn hóa năng lực, đơn xin phép và phân công; (2) booking/No-show/check-in muộn; (3) thay tạm thời và chuyển giao hoàn toàn; (4) sự kiện công việc và SLA; (5) KPI và đánh giá sao; (6) dashboard hoàn thiện, bảo mật, kiểm thử tích hợp, chuyển đổi dữ liệu và phát hành.

## A. HIỆN TRẠNG SOURCE VÀ RANH GIỚI PHÁT TRIỂN

### A.1. Những phần có thể tái sử dụng

- Backend có `BookingsService.autoAssignHotelStaffInternal()` lấy nhân viên từ `hotel_staff`, `users`, `staff_skills`, dùng kinh nghiệm, level, số booking hoàn thành, tải hiện tại và có fallback quản lý. Logic đang chọn dựa vào giá/tên phòng và chưa có cửa sổ 40/120 phút, đơn nghỉ/đi muộn hoặc nhật ký phân công theo giai đoạn.
- `PaymentFinalizerService` có cơ chế đánh dấu thanh toán thành công và giữ phòng; callback phân công hiện là tham số tùy chọn. Đường đối soát cần được nối bắt buộc với cùng quy trình phân công. Ngoài checkout chính, `BookingsService.create()` có nhánh tạo booking khác cần rà soát để không phân công trước thanh toán thành công.
- `InventoryService.getOccupiedRooms()` cộng các hold `COMMITTED` và các hold `HELD` còn hạn theo khoảng thời gian chồng lấn; đây là nền tảng để No-show vẫn giữ phòng.
- `BookingStatus` đang có `PAYMENT_PENDING`, `PENDING`, `CONFIRMED`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`... nhưng **chưa có** `NO_SHOW`, `CLOSED_NO_SHOW`.
- Backend có phân công lại (`reassignStaff`) nhưng hiện cấm đổi người khi booking đã `CHECKED_IN`; phải chỉnh để hỗ trợ chuyển giao trong thời gian lưu trú.
- `ServiceRequest` đã có `assigned_to`, `accepted_at`, `started_at`, `completed_at`, `sla_due_at`, trạng thái tiến trình; có thể dùng lại cho dịch vụ khách sạn. `ChatService` hiện thiên về chatbot/tìm kiếm, **chưa được coi là chứng cứ tin nhắn giữa khách và lễ tân**.
- `StaffSkill` đã có level 1–5, năm kinh nghiệm và trường xác minh kỹ năng; `StaffEligibilityRule` có mức kỹ năng, năm kinh nghiệm, số ca xử lý tối thiểu. Quy tắc cũ có nhắc đến ca trực nhưng giai đoạn này **bỏ qua điều kiện ca**.
- `bookings.handled_by` lưu người phụ trách hiện tại; **chưa đủ** để xác định lịch sử A/B theo từng tác vụ và từng khoảng thời gian.

### A.2. Những phần buộc phải làm mới hoặc sửa

- Thêm quy trình nhân viên gửi đơn nghỉ/đi muộn và quản lý duyệt; bổ sung trạng thái **khả dụng theo thời gian** độc lập với tài khoản `ACTIVE`.
- Thêm nhật ký phân công, bộ lọc 40/120 phút, mức phân công, phiên bản quy tắc và lý do lựa chọn; xử lý cạnh tranh khi nhiều thanh toán đồng thời.
- Thêm No-show, check-in muộn, dấu thời gian thực tế và luồng khôi phục; không thay đổi hold chỉ do đổi trạng thái có mặt của khách.
- Thêm hỗ trợ thay theo tác vụ/thời hạn và chuyển giao hoàn toàn; không chuyển KPI lịch sử của người cũ sang người mới.
- Thêm sự kiện hỗ trợ, bằng chứng xử lý, đánh giá sao, snapshot KPI theo kỳ và công cụ kiểm soát chỉnh sửa.
- Vá quyền API theo đúng khách sạn và đúng người được giao/được ủy quyền. Không được chỉ dùng role toàn cục `EMPLOYEE` để cho xem toàn bộ booking.
- Viết migration dữ liệu thay vì bật đồng bộ schema tự động; đối chiếu lỗi cột của `bookings` và ràng buộc `booking_status_logs.changed_by` với sự kiện hệ thống.

### A.3. Ranh giới loại trừ

Không triển khai lịch ca trực, tính công, bảng lương, chấm công bằng GPS, tuyển dụng, housekeeping hay phân công bộ phận khác. Không thay toàn bộ cơ chế VNPay. Không coi bước khách nhấn “Tôi đã đến” là check-in thực tế. Không tự động chuyển chủ booking mỗi khi đổi trạng thái.

## B. QUY TẮC XUYÊN SUỐT VÀ CÁC KHÁI NIỆM

### B.1. Phân biệt bốn lớp dữ liệu

| Lớp | Dữ liệu chính | Nguyên tắc |
|---|---|---|
| Booking & thanh toán | booking, payment, thời gian, trạng thái | Ghi nhận quyền đặt phòng và nghĩa vụ thanh toán; không đồng nhất với khách đã có mặt. |
| Inventory | hold `HELD`/`COMMITTED`/`RELEASED` | Tính suất phòng khả dụng theo khoảng `[đến, đi)`; No-show vẫn giữ `COMMITTED`. |
| Trách nhiệm nhân sự | chủ booking hiện tại, lịch sử giao, hỗ trợ tạm thời | Có thể đổi người; việc đã làm thuộc đúng người thực hiện. |
| Hiệu suất | sự kiện nhiệm vụ, SLA, đánh giá khách, xác minh quản lý | Chấm điểm dựa trên bằng chứng; KPI không tự thay đổi khi chuyển chủ booking. |

### B.2. Vai trò và quyền hạn

| Đối tượng | Có quyền | Không được |
|---|---|---|
| Khách hàng | Đặt và thanh toán booking của mình; xem tình trạng; gửi yêu cầu hỗ trợ/đề nghị check-in; đánh giá người thực sự phục vụ. | Tự xác nhận đã nhận phòng tại quầy; tự đổi nhân viên; sửa KPI. |
| Lễ tân | Xem booking được giao hoặc tác vụ hỗ trợ hợp lệ; cập nhật công việc; check-in/out theo quyền; xin nghỉ/đi muộn; xem KPI cá nhân. | Duyệt đơn của bản thân; cấp quyền nhân sự; sửa điểm hệ thống; xem booking khách sạn khác. |
| Quản lý khách sạn | Duyệt đơn nhân viên cùng khách sạn; duyệt hỗ trợ thay/chuyển giao; xử lý ngoại lệ; xem KPI của khách sạn mình; xác minh/duyệt kỳ KPI. | Sửa/xóa lịch sử sự kiện không để vết; duyệt đơn của khách sạn khác; sửa đánh giá sao do khách gửi. |

`ADMIN` kỹ thuật có thể tồn tại để vận hành nền tảng nhưng mọi endpoint nghiệp vụ vẫn cần lọc `hotel_id`; không dùng ADMIN như nhân sự nhận booking mặc định.

### B.3. Quy tắc thời gian và kết quả dữ liệu

- CSDL dùng thời gian UTC hoặc kiểu thời gian có múi giờ nhất quán; frontend hiển thị `Asia/Ho_Chi_Minh` khi làm nghiệp vụ tại Việt Nam. Mọi mốc 40/120 phút tính bằng thời điểm thực tế phía server, không theo đồng hồ trình duyệt.
- Khoảng lưu trú dùng `[check_in_at, check_out_at)`; tại đúng `check_out_at`, booking không còn chiếm suất phòng cho thời gian sau đó. Không giải phóng khoảng ngày quá khứ vì không cần và dễ làm lệch báo cáo.
- Tác vụ, đánh giá, đơn xin phép, quyết định quản lý và thay người dùng **soft-delete hoặc trạng thái hủy**, không xóa cứng dữ liệu có giá trị kiểm toán.
- Mọi thao tác thay đổi booking, phân công và nghỉ phép có `actor_type`, `actor_id`, `created_at`, `reason`, `correlation_id/idempotency_key` khi phù hợp. Sự kiện do hệ thống tạo phải có actor kiểu `SYSTEM`, không ghi giả người dùng hoặc gây lỗi `changed_by = NULL`.
- Phân biệt rõ `booking_status`, `payment_status`, `inventory_hold_status`, `staff_availability`, `coverage_status` và `kpi_period_status`. Chúng có quan hệ nhưng không thay thế nhau.

### B.4. Hai loại thay người đã thống nhất

**Hỗ trợ thay tạm thời (`TEMP_COVERAGE`):** A vẫn là người phụ trách chính; B được làm thay cho một tác vụ hoặc nhóm tác vụ xác định. Mặc định **120 phút**; người quản lý được chọn từ **15 phút đến 24 giờ**, có giờ bắt đầu, giờ kết thúc và phạm vi rõ ràng. Nếu nghỉ dài hơn, cần gia hạn có phê duyệt hoặc chuyển giao hoàn toàn. Hết hạn không tự ngắt công việc B đang xử lý dở: cho phép B hoàn tất tác vụ đã nhận, nhưng không được nhận tác vụ mới ngoài thời gian hiệu lực nếu chưa gia hạn. Hệ thống kiểm tra A đã khả dụng chưa và báo quản lý nếu tồn đọng.

**Chuyển giao hoàn toàn (`PERMANENT_TRANSFER`):** Đóng phân công chính của A tại thời điểm T, mở phân công chính cho B tại T; cập nhật `bookings.handled_by = B`. Các sự kiện do A thực hiện trước T giữ nguyên `actor_staff_id = A`. Những tác vụ chưa xong phải có trạng thái bàn giao và người nhận rõ ràng. Cho phép chuyển giao cả khi booking `CHECKED_IN` hoặc `NO_SHOW`, nếu do quản lý đúng khách sạn thực hiện và có lý do.

**Khả dụng khi chưa có ca trực:** Mặc định lễ tân `ACTIVE` và gắn đúng khách sạn được coi là có thể nhận việc, **ngoại trừ** khoảng đã duyệt nghỉ/đi muộn/vắng mặt hoặc đánh dấu `TEMP_UNAVAILABLE` khẩn cấp có kiểm toán. Không khẳng định A đang đứng tại quầy chỉ vì tài khoản ACTIVE. Khi có khách chờ tại quầy, quản lý hoặc lễ tân được ủy quyền có thể xử lý check-in thay đúng quyền hạn.

---

## ĐỢT 1. CHUẨN HÓA NĂNG LỰC, ĐƠN XIN PHÉP VÀ PHÂN CÔNG BOOKING CÔNG BẰNG

### 1.1. Bối cảnh nghiệp vụ

Khách đặt phòng và thanh toán VNPay; cùng một khách sạn có lễ tân A giỏi nhất, B gần tương đương, C ít kinh nghiệm. Nếu chỉ xếp theo kỹ năng, A rất dễ nhận liên tục tất cả booking VIP. Đồng thời, nhân viên A có thể gửi đơn xin nghỉ hoặc đi trễ; tài khoản vẫn ACTIVE nhưng A không thể trực tiếp tiếp nhận việc trong khoảng được duyệt. Chúng ta chưa dùng lịch ca trực, nên phải tạo **nguồn dữ liệu khả dụng theo đơn đã duyệt** để tránh gán nhầm.

### 1.2. Các tình huống cụ thể và kết quả cần có

**Tình huống 1 – ba booking đến liên tiếp:** 08:30 đơn 01 giao A (mức năng lực tốt nhất). 08:55 đơn 02 loại A vì mới 25 phút, ưu tiên B. 09:20 đơn 03: A đã qua 50 phút nhưng vẫn trong 120 phút giảm ưu tiên; B mới 25 phút; hệ thống phải tìm C ở mức đủ năng lực trước. 09:45 đơn 04: xét lại A/B (đã qua 40 phút) theo độ phù hợp, tải thực tế và lần giao gần nhất; C mới 25 phút nên không xét. Không bắt buộc lúc nào cũng cần nhân viên thứ ba; chỉ cần tuân thủ cửa sổ thời gian.

**Tình huống 2 – nhiều booking VIP trong 119 phút:** A đã nhận một booking VIP. Trong khoảng 40–119 phút sau đó, hệ thống quét tiếp B ở mức 1, rồi nhóm đủ điều kiện mức 2, mức 3, mức 4 chưa nhận trong 120 phút, trước khi lại chọn A. Ngưỡng VIP an toàn vẫn phải được bảo vệ; người chưa đủ năng lực tối thiểu thì không giao tự động chỉ để đủ vòng.

**Tình huống 3 – chỉ có A và quản lý:** A nhận lúc 08:30, đơn mới thanh toán 08:55. A còn trong 40 phút loại trừ; quản lý cùng khách sạn nhận tạm. Nếu cả quản lý cũng không khả dụng, đánh dấu `UNASSIGNED_CRITICAL`, thông báo cần tiếp nhận thủ công, không tự nhận booking của khách sạn khác. Giữ phòng và tiền của khách đúng như giao dịch đã hoàn tất.

**Tình huống 4 – A gửi đơn xin đi trễ:** A dự kiến bắt đầu làm việc lúc 08:00, báo sẽ đến 10:00; quản lý duyệt thời gian không khả dụng 08:00–10:00. Booking thanh toán lúc 08:30 không xét A. Đúng 10:00, nếu không có xác nhận kéo dài và tài khoản vẫn ACTIVE thì A quay lại tập ứng viên. Không tự tạo lịch ca chỉ vì có trường giờ dự kiến.

**Tình huống 5 – đơn đang chờ duyệt hoặc bị từ chối:** Đơn `SUBMITTED` chưa làm thay đổi điều kiện phân công tự động; quản lý được cảnh báo cần xử lý nhanh. Nếu sự việc đột xuất đã xác minh, quản lý dùng `TEMP_UNAVAILABLE` khẩn cấp có lý do và thời hạn để chặn việc phân công ngay. Khi từ chối đơn thì không tự tạo trạng thái vắng mặt.

**Tình huống 6 – A được duyệt nghỉ sau khi đã có booking:** Booking không tự biến mất khỏi A. Hệ thống tạo cảnh báo các booking, check-in, tác vụ sẽ đến hạn trong khoảng A nghỉ; quản lý thực hiện hỗ trợ thay tạm thời hoặc chuyển giao theo Đợt 3. Đợt 1 chỉ quản lý đơn và danh sách ảnh hưởng, chưa tự thay chủ booking.

**Tình huống 7 – hai callback VNPay sát nhau:** Hai đơn cùng thanh toán lúc 08:30:00. Hệ thống phải có khóa phù hợp ở mức khách sạn hoặc phân công tuần tự trong transaction, bảo đảm không cùng cho rằng A chưa có việc rồi gán cả hai cho A. Callback lặp không tạo lịch sử phân công lần hai.

### 1.3. Quy tắc phân công chuẩn

**Lọc cơ bản:** `users.status = ACTIVE`, chưa soft-delete; `hotel_staff.status = ACTIVE`, `hotel_id` của booking; vai trò công việc là `RECEPTIONIST`, không chỉ kiểm tra `staff_role != MANAGER`; không có khoảng nghỉ/đi muộn đã duyệt đang hiệu lực hoặc dấu vắng mặt khẩn cấp; không đang giữ tác vụ loại `EXCLUSIVE_IN_PROGRESS` không thể tiếp nhận thêm.

**Cửa sổ thời gian:** `now - last_assigned_at < 40 phút` → loại khỏi phân công tự động; `40 ≤ chênh lệch < 120 phút` → nhóm ưu tiên thấp; `≥ 120 phút` hoặc chưa từng nhận → nhóm ưu tiên cao. Dùng **lần phân công booking chính thức gần nhất**; không tính nhầm từng tin nhắn hoặc từng thao tác dịch vụ là một booking mới.

**Thứ tự quét:** (a) Nhân viên chưa được giao trong 120 phút: mức năng lực M1 → M2 → M3 → M4 theo phân hạng phòng; (b) nếu không có, xét người đã qua 40 phút nhưng còn trong 120 phút: M1 → M2 → M3 → M4; (c) nếu không có ứng viên hợp lệ thì quản lý; (d) nếu không có quản lý thì `UNASSIGNED_CRITICAL` và cảnh báo khẩn. Người bị loại bởi 40 phút **không được quay lại** bằng cách hạ mức năng lực.

**Ví dụ ngưỡng đề xuất cho VIP:** M1 kỹ năng ≥4/5 và ≥4 năm kinh nghiệm hoặc ≥40 hồ sơ hợp lệ; M2 kỹ năng ≥3/5 và ≥2 năm hoặc ≥20 hồ sơ; M3 kỹ năng ≥2/5 và ≥1 năm hoặc ≥10 hồ sơ; M4 có ≥1 năm kinh nghiệm và đạt danh mục kỹ năng nền bắt buộc. Các ngưỡng phải cấu hình theo khách sạn/hạng phòng, kỹ năng được xác minh; **không phải số liệu cố định đã có trên DB**. Với STANDARD/ECONOMY bắt đầu ở mức phù hợp, có thể nâng mức khi cần, không ép người hạng cao gánh hết phòng thường.

**Trong cùng nhóm:** ưu tiên người năng lực tốt hơn, tải công việc hợp lý hơn, có lần phân công lâu hơn; nếu bằng nhau dùng tiêu chí tất định (mã nhân viên) để dễ kiểm thử. Tải là tổng **tác vụ đang thực hiện + booking cần hỗ trợ trong giai đoạn gần**, không chỉ số booking PENDING vô thời hạn.

### 1.4. Quy trình gửi và duyệt đơn nghỉ/đi muộn

1. Lễ tân mở **Đơn xin phép** → chọn `LEAVE` (nghỉ làm), `LATE_ARRIVAL` (đi muộn), có thể hỗ trợ `SHORT_ABSENCE` và `EARLY_LEAVE` sau này. Nhập khoảng bắt đầu/kết thúc, thời điểm dự kiến đến đối với đi muộn, lý do tổng quát, thông tin liên lạc khi cần và minh chứng tùy chọn. Không bắt buộc ghi chi tiết sức khỏe nhạy cảm.
2. Backend xác thực nhân viên thuộc khách sạn, kiểm tra `from < to`, không đè đơn đã duyệt mâu thuẫn; lưu `SUBMITTED`, phát thông báo tới quản lý khách sạn đó.
3. Quản lý xem đơn, danh sách booking/tác vụ chịu ảnh hưởng, duyệt `APPROVED` hoặc từ chối `REJECTED` kèm lý do. Quản lý không sửa lén khoảng thời gian nhân viên khai; nếu cần đổi, trả về yêu cầu sửa hoặc tạo phiên bản quyết định có lịch sử.
4. Khi duyệt, một khoảng `UNAVAILABLE` có hiệu lực theo ngày giờ được xác nhận. Đơn đi muộn cần có `expected_start_at` do nhân viên khai/đã được quản lý xác nhận; không suy đoán từ lịch ca chưa tồn tại.
5. Nhân viên có thể xin rút đơn; nếu đã duyệt, việc hủy phải được quản lý chấp thuận và tạo sự kiện đảo trạng thái. Nếu đi muộn tiếp, gửi đơn gia hạn; trong lúc chờ có thể dùng cờ vắng mặt khẩn cấp có hạn do quản lý xác minh.
6. Đến hết khoảng được duyệt, chỉ khôi phục khả dụng nếu không có đơn khác đang hiệu lực, không bị khóa và không còn cờ vắng mặt khẩn cấp. Khi A quay lại vẫn chịu quy tắc luân phiên 40/120 phút như nhân viên khác.

### 1.5. Thiết kế backend và database

- Tạo `StaffRequestsModule` với `StaffRequestsController`, `StaffRequestsService`, DTO create/decision/withdraw; `StaffAvailabilityService` tổng hợp trạng thái theo **thời điểm truy vấn** từ user, `hotel_staff`, các đơn đã duyệt và cờ khẩn cấp. Không lưu một boolean “đang đi làm” duy nhất làm nguồn sự thật.
- Thêm `staff_attendance_requests`: `id`, `hotel_id`, `staff_user_id`, `request_type`, `unavailable_from`, `unavailable_until`, `expected_start_at`, `expected_arrival_at`, `reason`, `status`, `reviewed_by`, `reviewed_at`, `review_note`, `created_at`, `updated_at`, `version`.
- Thêm `staff_availability_overrides`: `id`, `hotel_id`, `staff_user_id`, `from`, `until`, `reason`, `created_by`, `ended_by`, `status`; dùng cho ngoại lệ quản lý đã xác minh, không để lễ tân tự cấp quyền bỏ qua phê duyệt.
- Thêm `booking_assignments`: `id`, `booking_id`, `hotel_id`, `staff_user_id`, `assignment_type`, `competency_level`, `cooldown_bucket`, `reason`, `assigned_at`, `ended_at`, `assigned_by`, `previous_assignment_id`, `policy_version`, `source_event_id`. Chỉ một bản ghi **phân công chính đang mở** cho mỗi booking; dùng unique guard phù hợp theo CSDL/transaction.
- Tạo `BookingAssignmentService`: lọc khách sạn + availability; quét M1–M4; xét hai mốc; lấy manager fallback; ghi `booking_assignments` và cập nhật `bookings.handled_by` trong giao dịch; có khóa tránh tranh chấp và idempotency theo booking.
- Chuẩn hóa `rooms.service_tier` (`ECONOMY`, `STANDARD`, `VIP`), tránh dựa hoàn toàn vào giá và từ khóa trong tên phòng. Tận dụng `staff_skills`, `staff_eligibility_rules` nhưng bỏ ràng buộc ca trực trong phiên bản này.
- `PaymentFinalizerService` luôn gọi sự kiện `payment.paid` rồi bộ xử lý phân công bảo đảm ít nhất một lần nhưng hiệu quả đúng một lần; sửa đối soát VNPay đi chung đường. Không tạo assignment chính thức từ nhánh tạo booking chưa xác nhận thanh toán.
- Migration phải kiểm tra tương thích dữ liệu cũ: `booking_status_logs.changed_by` hiện được dùng `NULL` cho hành động tự động trong code; lưu actor hệ thống hợp lệ bằng cấu trúc hỗ trợ `actor_type`, hoặc xử lý nullable có kiểm soát, tránh fail trong transaction.
- Index gợi ý: `(hotel_id, staff_user_id, unavailable_from, unavailable_until, status)`; `(hotel_id, staff_user_id, assigned_at)`; `(booking_id, ended_at)`. Bảo vệ idempotency bằng khóa/sự kiện duy nhất.

### 1.6. Frontend và hợp đồng API đề xuất

**Trang lễ tân:** `Đơn của tôi`, danh sách đơn đã gửi, trạng thái xử lý, form nghỉ/đi muộn, cảnh báo booking liên quan; thêm biểu tượng “đã duyệt/đang chờ duyệt” nhưng không hiển thị thông tin riêng tư của nhân viên khác.

**Trang quản lý:** `Đơn xin phép nhân viên`, lọc theo nhân viên/ngày/trạng thái; xem xung đột với lịch booking dự kiến; nút duyệt/từ chối; danh sách lễ tân hiện khả dụng, nguyên nhân không khả dụng; chính sách phân công 40/120 phút và mức phòng; bản ghi lý do vì sao booking chọn A/B/C.

**API gợi ý:** `POST /staff-requests`, `GET /staff-requests/me`, `GET /staff-requests/hotel/:hotelId`, `PATCH /staff-requests/:id/decision`, `POST /staff-requests/:id/withdraw`, `GET /staff-availability/hotels/:hotelId`, `GET /bookings/:id/assignments`. Mọi API phải kiểm tra cùng khách sạn trong service, không chỉ ở guard vai trò.

### 1.7. Kiểm thử và tiêu chí nghiệm thu

- Unit test ở 39:59, đúng 40:00, 119:59 và đúng 120:00; VIP M1→M4; phòng STANDARD/ECONOMY; ít nhân viên; tất cả đều vắng mặt; không có quản lý; nhân viên bị khóa; nhân viên không thuộc khách sạn; đơn xin phép `PENDING` vs `APPROVED`.
- Integration test hai thanh toán thành công đồng thời, callback lặp, đối soát, rollback nếu ghi assignment lỗi, không giao trước PAID.
- Auth test nhân viên A không duyệt đơn chính mình; quản lý khách sạn X không thấy đơn nhân viên khách sạn Y; nhân viên bị khóa không gửi hành động mới.
- **Hoàn thành Đợt 1 khi:** có lịch sử assignment; quyết định A/B/C giải thích được; cửa sổ 40/120 được thực thi đúng; đơn được duyệt ảnh hưởng ứng viên theo thời gian; thanh toán thành công không sinh phân công trùng; quản lý luôn thấy cảnh báo nếu không có người nhận.

---

## ĐỢT 2. HOÀN THIỆN VÒNG ĐỜI BOOKING, NO-SHOW VÀ CHECK-IN MUỘN

### 2.1. Bối cảnh nghiệp vụ

Khách đặt và thanh toán phòng từ 17:00 ngày 15/08/2026 đến 17:00 ngày 19/08/2026. Khách có thể chưa tới đúng 17:00 vì công việc riêng, thậm chí tới 22:00 ngày 15/08 hoặc ngày 16, 17/08. Website không có yêu cầu check-in không chứng minh khách chưa xuất hiện: khách có thể đến quầy trực tiếp. Booking đã thanh toán vẫn giữ suất phòng, vì bán lại cho người khác sẽ gây tranh chấp và overbooking.

### 2.2. Các tình huống và hướng xử lý

**Tình huống 1 – 17:00 chưa có khách:** Booking ở `CONFIRMED` hoặc đã thanh toán đầy đủ và hợp lệ. Không cho khách tự xác nhận nhận phòng qua website. Chuyển trạng thái theo chính sách thời gian chờ: mặc định cho phép trễ **6 giờ**, tức khoảng 23:00 mới đánh dấu `NO_SHOW` nếu vẫn không có check-in thực tế; quản lý cấu hình giới hạn này theo khách sạn.

**Tình huống 2 – khách đến 22:00 cùng ngày:** Lễ tân kiểm tra booking, xác nhận khách tại quầy, cập nhật `CHECKED_IN` và `actual_check_in_at = 22:00`; ghi `is_late_check_in = true`, `late_minutes = 300`. Vì chưa qua ngưỡng No-show, luồng đi trực tiếp `CONFIRMED → CHECKED_IN`.

**Tình huống 3 – khách đến ngày 16 hoặc 17/08:** Booking đã ở `NO_SHOW` nhưng vẫn `PAID`, hold `COMMITTED`, chưa quá `check_out_at`, chưa hủy hoặc hoàn tiền giải phóng hợp lệ. Nhân viên được quyền thực hiện `NO_SHOW → CHECKED_IN`, ghi sự kiện `LATE_CHECK_IN_RECOVERED`; không tạo booking mới, không tăng/giảm thêm số phòng giữ.

**Tình huống 4 – khách không đến suốt kỳ:** Giữ `COMMITTED` theo khoảng ngày đã mua đến 17:00 ngày 19/08. Sau thời điểm checkout và kiểm tra không có check-in, đóng `CLOSED_NO_SHOW`. Trạng thái này **không đồng nghĩa** `COMPLETED` của một kỳ lưu trú thực sự; KPI check-in của lễ tân được đánh dấu không áp dụng, không chấm lỗi do khách tự vắng mặt.

**Tình huống 5 – khách đến đúng/sau giờ trả phòng:** Không tự check-in nếu `now >= check_out_at`. Quản lý xử lý đặt mới hoặc gia hạn hợp lệ sau khi kiểm tra tồn phòng và thanh toán. Không sửa ngược lịch sử để làm như đã nhận phòng đúng giờ.

**Tình huống 6 – khách hủy/hoàn tiền:** Chỉ gọi cơ chế giải phóng hold `COMMITTED` khi quy trình hủy và hoàn tiền đã được chấp thuận đúng chính sách; **không bao giờ** gọi release chỉ vì gắn nhãn `NO_SHOW`.

**Tình huống 7 – công việc chạy đúng lúc nhân viên check-in:** Cron đánh dấu No-show và thao tác check-in có thể đua nhau. Lock hàng booking trong transaction, đọc lại trạng thái mới nhất; đúng một kết quả hợp lệ thắng, không ghi đè `CHECKED_IN` thành `NO_SHOW`.

### 2.3. Quy tắc vòng đời và trạng thái

Trạng thái đề xuất: `PAYMENT_PENDING → PENDING (đã thanh toán) → CONFIRMED → CHECKED_IN → COMPLETED`; từ `CONFIRMED → NO_SHOW → CHECKED_IN` (nếu đến muộn hợp lệ) hoặc `NO_SHOW → CLOSED_NO_SHOW` (hết kỳ, khách không đến). Nhánh hủy/hoàn tiền phải qua module Cancellation hiện có, không mở lối tắt bỏ qua kiểm tra thanh toán.

**Trước khi cron No-show chạy:** xác minh thanh toán PAID, hold COMMITTED, booking hợp lệ, thời hạn `now >= check_in_at + grace_minutes`, `actual_check_in_at IS NULL`, không có thao tác check-in đang thực hiện. Nếu booking thanh toán xong còn PENDING vì chưa được khách sạn xác nhận, cần xử lý nhất quán (tự xác nhận theo chính sách hoặc cảnh báo), không bỏ qua một cách âm thầm.

**Inventory:** `getOccupiedRooms` dựa vào hold; không thay số lượng `rooms.available_rooms` theo `NO_SHOW` nếu cơ chế tồn phòng chính là theo hold. Chỉ một nguồn sự thật cho việc chặn bán trùng. Với nhiều phòng trong một booking, giữ đủ quantity theo khoảng thời gian đã mua.

### 2.4. Backend, database và vận hành

- Bổ sung enum `NO_SHOW`, `CLOSED_NO_SHOW` trong `BookingStatus`; cập nhật `VALID_STATUS_TRANSITIONS`, service điều kiện quyền, lọc danh sách, thống kê dashboard và luồng hoàn tất booking.
- Bổ sung vào `bookings`: `actual_check_in_at`, `actual_check_out_at`, `no_show_at`, `no_show_grace_minutes_snapshot`, `no_show_closed_at`, `late_check_in_recovered_at`, `check_in_confirmed_by` (hoặc lưu đầy đủ trong bảng event). Không ghi đè `check_in_at`/`check_out_at` đã thỏa thuận.
- Tạo `BookingLifecycleService.markNoShowIfEligible()` chạy job định kỳ 5–15 phút (cấu hình), kết hợp kiểm tra khi đọc booking; job idempotent, có transaction row lock. Đừng dùng timer trên frontend hoặc chỉ dựa vào website check-in request.
- Tạo `checkin_out_events` hoặc `booking_task_events` với `type`, `booking_id`, `performed_by`, `scheduled_at`, `occurred_at`, `previous_status`, `new_status`, `late_minutes`, `reason`, `idempotency_key`.
- Đổi endpoint check-in/check-out hiện hành thành logic tập trung của lifecycle service; check-in chỉ cho lễ tân có quyền booking hoặc đang có coverage hợp lệ và quản lý cùng khách sạn. Người quản lý có đường xử lý ngoại lệ có lưu lý do.
- Audit luồng cancellation/paid reconciliation/checkout: không bán trùng khi khách `NO_SHOW`, không check-in sau khi hold đã release hợp lệ; dùng invariant kiểm thử thay vì chỉ kiểm tra giao diện.

### 2.5. Giao diện và API

**Khách:** hiển thị lịch dự kiến, booking đã thanh toán và hướng dẫn nhận phòng; có thể bấm **“Tôi dự kiến đến muộn”** để báo trước, nhưng không phải nút tự check-in. Khi No-show vẫn hiển thị booking có thể tiếp nhận muộn theo chính sách và đến trước checkout.

**Lễ tân:** danh sách `Đến hôm nay`, `Khách đã check-in`, `No-show cần theo dõi`, `Khách đến muộn`; nút xác nhận đã kiểm tra khách tại quầy, xem thời gian dự kiến/thực tế; giải thích rõ lý do từ chối check-in ngoài kỳ.

**Quản lý:** số booking chờ check-in, No-show đang giữ phòng, No-show đã đóng, nguy cơ quá hạn; phân biệt phòng đã bán và phòng đang có khách thực tế.

**API gợi ý:** `POST /bookings/:id/check-in`, `POST /bookings/:id/check-out`, `POST /bookings/:id/late-arrival-notice`, `GET /bookings/hotel/:hotelId/arrivals`, `GET /bookings/hotel/:hotelId/no-shows`, endpoint nội bộ/job đóng No-show. Endpoint cập nhật trạng thái chung không được vượt qua quy tắc này.

### 2.6. Kiểm thử và nghiệm thu

- Kiểm thử 15/08 17:00, 15/08 22:00, 15/08 23:00, 16/08, 17/08, 19/08 16:59 và 19/08 17:00; thời gian UTC vs giờ Việt Nam; nhiều phòng/booking; No-show và check-in chạy cạnh tranh; callback thanh toán trùng; hủy hợp lệ.
- Trước/sau mọi chuyển trạng thái `CONFIRMED → NO_SHOW → CHECKED_IN`, lượng hold `COMMITTED` và kết quả availability cho khoảng lưu trú phải **không đổi**.
- **Hoàn thành Đợt 2 khi:** khách không đến không làm mở bán suất phòng đã thanh toán; check-in muộn trong kỳ thành công; ngoài kỳ bị kiểm soát; không có sự kiện check-in giả; dashboard phân biệt No-show với đã lưu trú.

---
## ĐỢT 3. HỖ TRỢ THAY TẠM THỜI VÀ CHUYỂN GIAO TRÁCH NHIỆM HOÀN TOÀN

### 3.1. Bối cảnh nghiệp vụ

Một booking có thể được phân công A từ ngày đặt phòng, nhưng khi khách đến check-in thực tế thì A xin đi muộn, đã được duyệt nghỉ, nghỉ đột xuất, bị khóa tài khoản hoặc không còn làm việc tại khách sạn. Khách không thể bị từ chối phục vụ chỉ vì A vắng mặt. Song cũng không thể gộp mọi hoạt động của A và B vào một trường `handled_by`, vì điểm KPI của A và B sẽ bị sai.

Đợt này xây **hai đường xử lý độc lập**: **hỗ trợ thay có thời hạn** (không đổi chủ booking) và **chuyển giao hoàn toàn** (đổi chủ booking và bàn giao tồn đọng). Đơn nghỉ/đi muộn tại Đợt 1 là nguồn để phát hiện và đề nghị hai đường xử lý, còn quyết định thay người phải có quy tắc và lịch sử rõ ràng.

### 3.2. Những tình huống nghiệp vụ cần xử lý

**Tình huống 1 – A đi muộn, B làm check-in thay:** Booking có lịch nhận phòng 17:00, A được duyệt đến muộn 120 phút. Khách đến 17:15. B đang ACTIVE, cùng khách sạn và đủ quyền, được quản lý chỉ định `TEMP_COVERAGE` từ 17:00–19:00 với phạm vi `CHECK_IN`. B xác nhận khách tại quầy; hệ thống lưu **B là người thực hiện check-in**, A vẫn là người phụ trách chính để xử lý các công việc khác sau khi quay lại. KPI chuẩn bị trước nhận phòng của A giữ nguyên; KPI check-in của B được ghi cho B.

**Tình huống 2 – A nghỉ nửa ngày, B hỗ trợ mọi tác vụ phát sinh:** Quản lý duyệt A vắng 08:00–12:00, mở coverage B từ 08:00–12:00 với phạm vi `CHECK_IN, GUEST_SUPPORT, SERVICE_REQUEST`. Trong 4 giờ, khách gửi hai yêu cầu, B xử lý và nhận KPI của từng yêu cầu. A quay lại 12:00, các tác vụ mới được đưa về A; tác vụ B đang giải quyết dở được cho hoàn tất hoặc được bàn giao minh bạch. Không tự thay tên người thực hiện các sự kiện cũ.

**Tình huống 3 – coverage 120 phút hết hạn nhưng B đang làm dở:** B bắt đầu giải quyết khiếu nại lúc 18:50, coverage hết 19:00. Hệ thống không cắt thao tác đang thực hiện; B được phép hoàn tất ticket đã nhận, nhưng không được nhận thêm ticket mới với coverage hết hạn. Nếu A vẫn chưa khả dụng, tạo cảnh báo cho quản lý gia hạn hoặc chuyển giao. Không tự gia hạn vô hạn.

**Tình huống 4 – A nghỉ nhiều ngày hoặc nghỉ việc:** Quản lý nhận đơn nghỉ 3 ngày hoặc cập nhật A `BLOCKED/INACTIVE`, xác định không thể tiếp tục phục vụ booking đang lưu trú. Quản lý dùng **Chuyển giao hoàn toàn A → B**, có thời điểm hiệu lực và lý do; từ đó B trở thành người phụ trách chính. Tất cả công việc A đã hoàn thành được khóa vào lịch sử A, công việc chưa xong được chuyển sang B với trạng thái bàn giao.

**Tình huống 5 – A không có đơn nhưng thực tế không có mặt:** Khách tới quầy, quản lý xác minh A đột xuất vắng, tạo `TEMP_UNAVAILABLE` có lý do, thời hạn ngắn, rồi chọn B hỗ trợ. Đây là ngoại lệ có audit để khách không chờ; sau đó phải liên kết hoặc hoàn thiện hồ sơ xin phép, không biến ngoại lệ thành quyền vô hạn cho người quản lý.

**Tình huống 6 – A không vắng, B chỉ hỗ trợ một việc:** A vẫn chăm sóc booking, nhưng B trực tiếp tiếp nhận khách tại quầy hoặc giải quyết một yêu cầu chuyên biệt. Chỉ tạo tác vụ hỗ trợ `TASK_DELEGATION` hoặc coverage một tác vụ, không cần đổi người phụ trách chính. KPI thuộc người làm việc; A không bị tự động trừ điểm nếu hành động được giao hợp lệ cho B.

**Tình huống 7 – khách đến muộn khi A đã nghỉ việc:** Booking `NO_SHOW` từ ngày 15, khách đến ngày 17, A đã `INACTIVE`. Quản lý chuyển giao hoàn toàn A → B ngay khi xác nhận tình huống (hoặc B làm check-in theo ủy quyền hợp lệ rồi quản lý chuyển giao). B ghi sự kiện check-in muộn; A vẫn giữ KPI hỗ trợ booking trước ngày nghỉ, không mất thành tích.

**Tình huống 8 – B bị khóa trong thời gian hỗ trợ:** Coverage phải dừng nhận tác vụ mới ngay; nếu có tác vụ chưa hoàn thành, cảnh báo quản lý và chuyển cho người phù hợp khác. Không cho nhân viên `BLOCKED` tiếp tục cập nhật giao dịch dù token chưa hết hạn.

### 3.3. Quy tắc thời gian và quyền thay tạm thời

- Coverage **mặc định 120 phút**, tối thiểu **15 phút**, tối đa **24 giờ mỗi lần duyệt**. Cấu hình có thể đổi tại khách sạn trong giới hạn hệ thống. Nếu cần vắng trên 24 giờ thì quản lý gia hạn có chứng cứ hoặc chuyển giao hoàn toàn; không cấp coverage vô hạn.
- Thời gian có hiệu lực `[starts_at, ends_at)`. Không bắt buộc trùng toàn bộ đơn xin phép: coverage chỉ áp dụng khoảng cần người B hỗ trợ. Một đơn được duyệt có thể kích hoạt nhiều coverage theo booking/tác vụ nhưng phải chống trùng quyền xung đột.
- Có ba phạm vi điển hình: `CHECK_IN_OUT`, `GUEST_SUPPORT`, `SERVICE_REQUEST`; có thể chọn `ALL_CURRENT_TASKS` trong phạm vi một booking nếu quản lý xác nhận. Không được cấp quyền sang khách sạn khác hoặc vào những booking không liên quan.
- A vẫn là **primary owner** trong `TEMP_COVERAGE`; B là **acting staff**. Khi tác vụ phát sinh, định tuyến tới B nếu phạm vi phù hợp và coverage còn hiệu lực; ngược lại A nếu khả dụng; nếu không có ai thì đưa về quản lý.
- Nếu A sẵn sàng trở lại sớm, quản lý có thể kết thúc coverage trước hạn; không tự ý thu hồi tác vụ B đang xử lý. Nếu B xin dừng sớm, quản lý phải chấp thuận và xử lý tồn đọng.
- Trong trường hợp khẩn cấp tại quầy, có thể cho lễ tân cùng khách sạn đủ điều kiện thực hiện **một thao tác hỗ trợ có kiểm toán** nếu chính sách cấp quyền sẵn cho phép, đồng thời buộc quản lý xác nhận sau; không dùng đây để vượt qua kiểm tra danh tính khách hoặc bảo vệ dữ liệu.

### 3.4. Quy tắc chuyển giao hoàn toàn và KPI A/B

1. Kiểm tra người duyệt là quản lý đúng khách sạn; B ACTIVE, đủ quyền, không trong khoảng vắng được duyệt, không xung đột trách nhiệm nghiêm trọng. Nếu B không đủ năng lực xử lý hạng phòng, chuyển về quản lý theo cơ chế fallback.
2. Trong cùng giao dịch, đóng bản ghi assignment hiện tại của A tại thời điểm T; thêm assignment `PERMANENT_TRANSFER` của B; cập nhật `bookings.handled_by = B`; liên kết các tác vụ chưa hoàn tất với B, tạo event `HANDOVER_RECEIVED`.
3. Lưu snapshot: A phụ trách từ lúc nào đến T, đã hoàn thành tác vụ nào, có yêu cầu nào đang xử lý, ai phê duyệt, lý do, mức độ phức tạp booking; đẩy thông báo nội bộ và (nếu phù hợp) thông báo người hỗ trợ mới cho khách.
4. Mọi `booking_task_events.actor_staff_id` trước T vẫn là A hoặc nhân viên thực hiện thực tế; không đổi hàng loạt thành B. Lịch sử rating cũng không chuyển tên người được đánh giá.
5. KPI được tính theo **người làm từng sự kiện**, giai đoạn nhiệm vụ và điều kiện đủ mẫu. Nếu A chỉ chuẩn bị, B check-in rồi phục vụ trong lưu trú, A có thể nhận điểm chuẩn bị/phản hồi, B nhận điểm check-in/dịch vụ và sao của khách tương ứng.
6. Nếu chuyển giao sai do nhầm người, có sự kiện `TRANSFER_CORRECTED` hoặc transfer ngược có lý do; không xóa log cũ. Khi booking đã `COMPLETED` hoặc `CLOSED_NO_SHOW`, chỉ được sửa lịch sử bằng quy trình kiểm toán, không mở assignment mới trái thời gian.

### 3.5. Backend và cấu trúc dữ liệu

- Tạo `BookingCoverageService` và `BookingTransferService`, dùng chung kiểm tra hotel-scope, kiểm tra khả dụng và transaction. `BookingsService.reassignStaff()` cần bỏ lệnh chặn tuyệt đối `CHECKED_IN`, thay bằng policy cho phép quản lý thực hiện chuyển giao chính thức theo loại trạng thái và điều kiện cụ thể.
- Bảng `booking_coverages`: `id`, `hotel_id`, `booking_id`, `primary_staff_id`, `acting_staff_id`, `coverage_type`, `scope_json`, `starts_at`, `ends_at`, `status`, `reason`, `linked_staff_request_id`, `approved_by`, `approved_at`, `ended_by`, `ended_reason`, `created_at`.
- Bảng `booking_task_assignments`: `id`, `booking_id`, `task_id`, `staff_user_id`, `assignment_id`, `coverage_id`, `assigned_at`, `ended_at`, `accepted_at`, `status`, `reason`, `assigned_by`. Tác vụ không có hai người **phụ trách chính cùng lúc**; hỗ trợ phối hợp có vai trò riêng nếu cần.
- Bảng `booking_handover_events`: `id`, `booking_id`, `from_staff_id`, `to_staff_id`, `handover_type`, `effective_at`, `pending_tasks_snapshot`, `reason`, `approved_by`, `created_at`. Có thể hợp nhất với `booking_assignments` và audit log nếu thực hiện đúng bất biến.
- Luồng tạo coverage phải kiểm tra người thực hiện B có quyền đúng tác vụ, thời gian chưa hết và không bị khóa **tại thời điểm thao tác**. Không cấp quyền dựa vào tên B trên giao diện.
- Cho các job `coverage.expiring`, `coverage.expired`, `staff.request.approved`, `staff.blocked` tạo cảnh báo và gợi ý xử lý; không tự đóng công việc đang thực hiện mà không có trạng thái trung gian.

### 3.6. Frontend và API

**Lễ tân A:** thấy đơn xin phép được duyệt, các booking có người hỗ trợ, thời hạn hỗ trợ và công việc đã chuyển; có nút báo đã trở lại (để quản lý/hệ thống xác minh), không tự thu hồi quyền của B.

**Lễ tân B:** danh sách `Công việc được hỗ trợ thay`, thời hạn, phạm vi, tên chủ booking, nút tiếp nhận tác vụ, check-in khách, hoàn tất hoặc bàn giao; phân biệt với `Booking tôi phụ trách chính`.

**Quản lý:** modal `Hỗ trợ tạm thời` (booking, B, phạm vi, bắt đầu, kết thúc, lý do, đơn liên quan), modal `Chuyển giao hoàn toàn` (A → B, tác vụ tồn, lý do, xác nhận), cảnh báo coverage hết hạn, nhân viên nghỉ nhưng vẫn có booking cần chăm sóc.

**API gợi ý:** `POST /bookings/:id/coverages`, `GET /bookings/:id/coverages`, `POST /bookings/:id/coverages/:coverageId/end`, `POST /bookings/:id/transfer`, `GET /bookings/:id/handover-history`, `POST /booking-tasks/:id/accept`, `POST /booking-tasks/:id/handover`. Dùng DTO chuẩn và quy tắc quyền ở backend.

### 3.7. Kiểm thử và nghiệm thu

- Coverage 120 phút đúng mốc, kết thúc sớm, gia hạn, vượt 24 giờ, B bị khóa, A quay lại, thiếu quản lý, trùng phạm vi, một tác vụ đang thực hiện khi coverage hết hạn.
- Chuyển A→B trước check-in, trong `CHECKED_IN`, từ `NO_SHOW`, giữa lúc nhiều yêu cầu đang mở; không làm mất KPI A hoặc nhân đôi KPI B.
- Kiểm thử thao tác tại quầy khi A vắng nhưng chưa có đơn duyệt; có audit và cảnh báo, không chặn khách vô lý.
- **Hoàn thành Đợt 3 khi:** có đúng hai lựa chọn tạm thời/hoàn toàn, việc A và B rõ ràng, hợp đồng thời gian minh bạch, phân quyền tác vụ đúng và lịch sử công việc không bị chuyển nhầm người.

---

## ĐỢT 4. THU THẬP DẤU VẾT PHỤC VỤ, YÊU CẦU KHÁCH VÀ SLA CÓ BẰNG CHỨNG

### 4.1. Bối cảnh nghiệp vụ

Một lễ tân có thể chủ động gọi điện hướng dẫn khách, check-in nhanh, tiếp nhận yêu cầu dịch vụ, giải quyết sự cố tại phòng. Nếu quản lý chỉ nhập một dòng “A phản hồi sau 5 phút” thì không thể xác minh. Website phải tạo **sự kiện nghiệp vụ thực tế**; đánh giá sau này dựa vào những sự kiện đó thay vì nhập điểm thủ công.

`ServiceRequest` hiện có chỉ phản ánh dịch vụ cụ thể với các trạng thái tiến trình. Các yêu cầu như “giờ nhận phòng?”, “tôi đến muộn”, “có thể thêm gối?”, “máy lạnh có sự cố” cần một luồng hỗ trợ khách chung có thể liên kết dịch vụ trả phí khi có, nhưng không bắt buộc mua dịch vụ mới được tạo ticket.

### 4.2. Tình huống vận hành và chứng cứ

**Tình huống 1 – khách nhắn qua website:** 10:00 khách gửi câu hỏi, server ghi `request_created_at`; 10:06 B gửi một tin nhắn thực tế qua hệ thống, lưu `message_sent_at`, nội dung hoặc chứng cứ có quyền truy cập; 10:07 ticket chuyển `ACKNOWLEDGED`. KPI phản hồi đầu tiên dùng **tin phản hồi thật**, không chỉ dùng thao tác bấm nút `Đã phản hồi`.

**Tình huống 2 – lễ tân gọi điện:** B bấm `Đã gọi điện`, hệ thống biết thời điểm **khai báo** chứ chưa xác minh cuộc gọi; sự kiện có `evidence_level = SELF_REPORTED`, cần thêm log tổng đài/tệp chứng cứ hoặc xác nhận khách nếu muốn tính điểm đầy đủ. Không đồng nhất với phản hồi đã xác thực.

**Tình huống 3 – khách tới quầy yêu cầu thêm vật dụng:** B tạo ticket thay mặt khách, đánh dấu `CHANNEL = FRONT_DESK`, nhập tóm tắt và thông tin kiểm chứng tối thiểu. Quản lý có thể xác minh kết quả, hoặc khách xác nhận khi hoàn thành. Nếu thiếu bằng chứng, KPI hiển thị mức tin cậy thấp hơn.

**Tình huống 4 – yêu cầu dịch vụ có sẵn trong `service_requests`:** Khách yêu cầu giặt ủi, tạo service request, liên kết `booking_id`, lịch hoàn thành, SLA; khi hoàn thành, ghi event `SERVICE_COMPLETED` và người trực tiếp xác nhận. Không tạo hai KPI cho cùng một yêu cầu do vừa có bản ghi dịch vụ vừa có ticket hỗ trợ.

**Tình huống 5 – khiếu nại bị xử lý sai:** Nhân viên đánh dấu `RESOLVED`, khách phản hồi “chưa xong” và mở lại `REOPENED`. KPI phải đánh giá thời gian xử lý có tính reopen, không mặc nhiên cho điểm tối đa theo lần bấm `COMPLETED` đầu tiên.

**Tình huống 6 – khách No-show:** Không có check-in và dịch vụ trong phòng, nên phần đánh giá check-in/dịch vụ lưu trú đánh dấu `N/A`. Nếu A đã hướng dẫn trước khi khách tới, các sự kiện pre-stay vẫn có thể được tính; không phạt A vì khách tự không đến.

**Tình huống 7 – A → B chuyển giao giữa ticket:** A trả lời lần đầu, B nhận bàn giao và xử lý hoàn tất. KPI phản hồi đầu tiên thuộc A nếu A thực sự phản hồi; KPI giải quyết và phần chất lượng thuộc B theo sự kiện thực hiện. Ticket không được ghi một chủ duy nhất để cộng toàn bộ điểm cho B.

### 4.3. Mô hình tác vụ và SLA

- Tạo `guest_support_requests` cho liên hệ/hỗ trợ chung: `OPEN → ACKNOWLEDGED → IN_PROGRESS → RESOLVED → CONFIRMED`; cho phép `REOPENED`, `CANCELLED`, `ESCALATED` có điều kiện và audit. Tác vụ trả phí vẫn dùng `service_requests` hiện có nhưng gắn chung cơ chế event.
- Server phát `task.created`, `task.assigned`, `response.sent`, `task.started`, `task.resolved`, `customer.confirmed`, `task.reopened`, `task.escalated`, `task.cancelled` với actor, booking, assignment/coverage liên quan, timestamp.
- SLA có `first_response_due_at`, `resolution_due_at` theo loại nhiệm vụ/độ ưu tiên/hạng phòng, do cấu hình quản lý phê duyệt. Ví dụ tham khảo: phản hồi ban đầu trong 15 phút ở trường hợp tiêu chuẩn; VIP có thể cấu hình chặt hơn. Đây là **giá trị đề xuất**, không phải cam kết chất lượng mọi khách sạn.
- Thời gian SLA dùng lịch thời gian thực hoặc thời gian làm việc được cấu hình ở cấp khách sạn; giai đoạn chưa có ca trực không suy đoán lịch làm việc của từng lễ tân. Nếu khách sạn hỗ trợ 24/7, SLA có thể tính liên tục. Thời gian gián đoạn do nguyên nhân bất khả kháng phải có quy tắc tạm dừng và nhật ký, không cho nhân viên tự dừng để tăng điểm.
- Tại thời điểm ticket tạo, định tuyến mặc định tới người phụ trách booking hiện tại; nếu có coverage hợp lệ thì tới người hỗ trợ theo phạm vi. Khi nhân viên không khả dụng, xử lý chuyển người hoặc cảnh báo quản lý, không bỏ yêu cầu trong hàng chờ vô chủ.

### 4.4. Backend/database và tích hợp

- Tạo `GuestSupportModule`, `BookingTaskEventService`, `SlaPolicyService`, API gửi yêu cầu, nhắn/phản hồi, giao việc, xác nhận hoàn tất; dùng `RealtimeGateway` hiện có để thông báo. Không coi chatbot tìm phòng là kênh trao đổi lễ tân-khách có bằng chứng nếu chưa có luồng nhắn thực.
- Thêm `guest_support_requests`, `booking_task_events` hoặc `service_events`: `id`, `booking_id`, `task_id`, `actor_staff_id`, `actor_type`, `event_type`, `stage` (`PRE_STAY`, `CHECK_IN`, `IN_STAY`, `CHECK_OUT`), `event_at`, `source`, `evidence_level`, `evidence_ref`, `assignment_id`, `coverage_id`, `idempotency_key`, `metadata_json`.
- Thêm bảng tin nhắn/hội thoại nếu làm kênh trực tuyến, quản lý quyền theo booking; dữ liệu nhạy cảm có giới hạn truy cập, thời gian lưu và cơ chế ẩn thông tin. Nếu chưa làm chat, chỉ đưa KPI phản hồi từ các nguồn đã có chứng cứ đáng tin, không tự chấm các nguồn chưa có.
- Kết nối `ServicesService` hiện tại với `booking_task_events` khi trạng thái đổi hợp lệ; mở rộng check-in/out từ Đợt 2 tạo event có `actor_staff_id`; tích hợp coverage/transfer từ Đợt 3.
- Bổ sung cơ chế xử lý duplicate event; event một chiều, không sửa `event_at` tùy tiện. Nếu nhập sai, thêm `CORRECTION_EVENT` có người duyệt, để giữ cả dữ liệu gốc và lý do điều chỉnh.

### 4.5. Frontend và API

**Khách:** mục `Yêu cầu hỗ trợ` trong chi tiết booking; chọn loại yêu cầu, gửi nội dung, theo dõi tiến độ, xác nhận hoàn tất, mở lại nếu chưa được giải quyết; thấy rõ người đang hỗ trợ (A hoặc B) nhưng không lộ dữ liệu nhân sự nội bộ.

**Lễ tân:** hộp việc cần xử lý theo hạn SLA, thời gian nhận, tình trạng, khả năng trả lời khách, lịch sử trao đổi, nút bàn giao, bằng chứng hoàn tất. Công việc được ủy quyền tạm thời có ký hiệu riêng.

**Quản lý:** danh sách tác vụ quá hạn, mở lại, tồn đọng, đổi người, mức chứng cứ; xem SLA theo booking/nhân viên, nhưng không tự thay đổi thời điểm server đã ghi.

**API gợi ý:** `POST /bookings/:id/support-requests`, `GET /bookings/:id/support-requests`, `POST /support-requests/:id/messages`, `PATCH /support-requests/:id/status`, `POST /support-requests/:id/confirm`, `POST /support-requests/:id/reopen`, `GET /support-requests/my`, `GET /support-requests/hotel/:hotelId`.

### 4.6. Kiểm thử và nghiệm thu

- Kiểm tra tính KPI phản hồi từ tin nhắn được lưu, không dựa vào bấm nút; chống sửa timestamp; reopen ticket; SLA vượt hạn; B tiếp nhận coverage; A bị khóa giữa lúc xử lý; khách khác không đọc được hội thoại.
- Kiểm tra các yêu cầu trả phí không bị cộng đôi khi cũng xuất hiện ở hỗ trợ chung; N/A khi No-show; quy trình xác minh hiện trường khi khách không nhắn qua hệ thống.
- **Hoàn thành Đợt 4 khi:** mọi thao tác chủ chốt có event và người thực hiện; có nguồn dữ liệu tin cậy để tính phần KPI tự động; khách và quản lý theo dõi được tiến trình công việc.

---

## ĐỢT 5. CHẤM ĐIỂM KPI THEO BẰNG CHỨNG, PHẢN HỒI SAO VÀ LƯU THEO KỲ

### 5.1. Bối cảnh nghiệp vụ

Dashboard cần đánh giá hiệu quả của nhân viên, nhưng quản lý ngoài đời có thể quan sát và điền điểm theo cảm tính. Nếu cho quản lý sửa toàn bộ chỉ tiêu, khó bảo đảm công bằng. Traveleke cần cơ chế **tổng hợp từ sự kiện có thể kiểm tra**, **đánh giá độc lập của khách** và **xác minh quản lý có lý do**, không quy doanh thu website về toàn bộ lễ tân được phân công.

Ngoài ra, một booking có thể do A chuẩn bị nhưng B check-in và C xử lý khiếu nại. KPI phải tính cho **người thực hiện từng phần**, không phải người đang nằm trong `bookings.handled_by` tại thời điểm xuất báo cáo.

### 5.2. Các tình huống và cách chấm công bằng

**Tình huống 1 – A hỗ trợ trước kỳ lưu trú, B check-in thay:** A có 3 sự kiện hỗ trợ đã xác minh và hoàn thành chuẩn bị đúng hạn; B nhận một sự kiện check-in có xác nhận tại quầy. Kỳ KPI tính các chỉ tiêu pre-stay/response cho A, check-in cho B; không chuyển ngược phần đã ghi của A khi `handled_by` chuyển sang B.

**Tình huống 2 – khách No-show:** A đã phản hồi hướng dẫn đúng hạn, nhưng khách không đến và không phát sinh dịch vụ tại phòng. Điểm check-in, check-out, dịch vụ trong lưu trú là `N/A` đối với booking này; chỉ tính các chỉ tiêu có cơ hội thực hiện. Không thưởng/check-in giả, không trừ điểm oan.

**Tình huống 3 – khách không gửi sao:** Không suy diễn là 0 sao, cũng không mặc định là 5 sao. Dashboard ghi `Chưa đủ dữ liệu khách đánh giá` và số lượt đánh giá thực tế. KPI chính thức chuẩn hóa trên các trọng số có dữ liệu đủ điều kiện; công khai tỷ lệ dữ liệu bao phủ.

**Tình huống 4 – A nhận 1 đánh giá 1 sao, B nhận 12 đánh giá:** Không dùng một mẫu đơn lẻ quyết định toàn bộ chất lượng A. Đề xuất chỉ đưa trọng số sao vào KPI chính thức khi một nhân viên đạt **ít nhất 3 đánh giá hợp lệ trong kỳ**, còn ít hơn thì hiện riêng là dữ liệu tham khảo; ngưỡng cho phép cấu hình.

**Tình huống 5 – quản lý muốn sửa điểm phản hồi:** Hệ thống có event phản hồi 10:06 cho ticket tạo 10:00. Quản lý không được gõ một con số 1 phút thay thế; chỉ có thể tạo **đề nghị hiệu chỉnh** kèm bằng chứng (ví dụ lỗi đồng bộ), người phê duyệt và lịch sử. Báo cáo phải cho phép xem điểm gốc và điểm điều chỉnh.

**Tình huống 6 – A đánh giá tốt nhưng ít booking:** Không lấy số lượng booking/doanh thu online làm KPI chất lượng chính. Hiển thị sản lượng và tải riêng, điểm chất lượng chỉ tính theo các cơ hội thực sự phát sinh. Có cảnh báo dữ liệu ít; tránh tuyên bố xếp hạng chắc chắn khi cỡ mẫu quá nhỏ.

**Tình huống 7 – nhân viên được fallback xử lý VIP:** Hệ thống ghi mức fallback và độ khó nhiệm vụ. Đánh giá theo kết quả thật và yêu cầu SLA đã áp dụng cho booking, không trừ điểm tự động chỉ vì nhân viên không ở M1. Nếu yêu cầu quá năng lực phải escalated manager, và KPI đánh giá đúng hành vi escalated đúng lúc.

**Tình huống 8 – nhân viên bị khóa/đã nghỉ:** Không cho chỉnh sửa dữ liệu công việc cũ; vẫn cho quản lý xem KPI các kỳ đã khóa của nhân viên theo đúng khách sạn và phạm vi pháp lý. Các sự kiện do họ làm không bị đổi người chỉ vì tài khoản INACTIVE.

### 5.3. Khung điểm đề xuất 100 điểm

| Thành phần | Điểm tối đa | Nguồn chính |
|---|---:|---|
| Phản hồi đầu tiên đúng hạn | 10 | Tin nhắn/sự kiện phản hồi có timestamp server và chứng cứ. |
| Chuẩn bị trước nhận phòng | 10 | Checklist hợp lệ, xác nhận hỗ trợ, event đúng thời hạn. |
| Check-in/check-out chính xác | 15 | Checkin/out thực tế, người thao tác, thiếu sót được xác minh. |
| Dịch vụ trong thời gian lưu trú | 15 | Service ticket, SLA hoàn tất, xác nhận kết quả. |
| Giải quyết sự cố/khiếu nại | 10 | Ticket, reopen, SLA, evidence của sự cố. |
| Độ chính xác và tuân thủ | 10 | Sự kiện lỗi hợp lệ, vi phạm quy trình có kiểm chứng. |
| Đánh giá sao của khách | 20 | Rating 1–5 sao, booking thật, đúng nhân viên và giai đoạn. |
| Đánh giá xác minh của quản lý | 10 | Mẫu tiêu chí có dẫn chứng, lý do và lịch sử duyệt. |
| **Tổng** | **100** | **70 điểm hệ thống + 20 điểm khách + 10 điểm quản lý**. |

Đây là **chính sách đề xuất**, được cấu hình có phiên bản và có thể điều chỉnh sau thử nghiệm thực tế; không dùng số liệu giả để tô điểm Dashboard. Mỗi tiêu chí phải chỉ rõ: số lần đủ điều kiện, số lần đạt, mức độ tin cậy, mẫu dữ liệu, kết quả chuẩn hóa và tình trạng `N/A`.

### 5.4. Công thức tính và quy tắc dữ liệu thiếu

Với từng chỉ tiêu `i`, xác định trọng số `w_i`, điểm chuẩn hóa `s_i` từ 0–1, và `eligible_i` bằng 1 nếu có dữ liệu đủ điều kiện; bằng 0 nếu thực sự không áp dụng/không đủ mẫu theo chính sách. Khi đó:

`KPI_100 = 100 × Σ(w_i × s_i × eligible_i) / Σ(w_i × eligible_i)`.

Nếu mẫu dữ liệu thiếu ở nhiều tiêu chí, phải hiển thị thêm `coverage = Σ(w_i × eligible_i) / 100` và trạng thái `PROVISIONAL/INSUFFICIENT_DATA` thay vì công bố xếp hạng chắc chắn. Nếu mẫu trống hoàn toàn thì **không được chia 0 hoặc cho 100 điểm**; trả `N/A`.

- Điểm phản hồi: tính tỷ lệ yêu cầu có phản hồi thực tế đúng SLA, phân biệt first response và resolution; sự kiện nhập tay không kiểm chứng không mặc định nhận điểm tối đa.
- Điểm checklist: chỉ tính bước bắt buộc phù hợp booking; không yêu cầu nhân viên chuẩn bị những nghiệp vụ khách không có.
- Điểm check-in/out: tính tỷ lệ tác vụ thuộc quyền và thực sự thực hiện đúng; không tính booking No-show vào mẫu check-in.
- Điểm giải quyết: tính sự kiện đúng SLA, tình trạng reopen, độ khó và yếu tố ngoài kiểm soát được xác minh; trách nhiệm từng người chia theo event.
- Điểm sao: mỗi khách có booking hợp lệ được đánh giá đúng người trong đúng giai đoạn (`PRE_STAY`, `CHECK_IN`, `IN_STAY`, `CHECK_OUT`), một đánh giá hiệu lực cho mỗi nhân viên/giai đoạn/booking. Ví dụ nếu trọng số sao đủ điều kiện: `điểm_sao = 20 × (sao_trung_bình - 1) / 4`; 1 sao = 0/20, 5 sao = 20/20. Quy tắc này phải hiển thị công khai và có kiểm soát số lượng mẫu.
- Điểm quản lý: dùng rubric cụ thể (tinh thần phối hợp, xử lý ngoài hệ thống có xác minh, đúng quy trình), tối đa 10 điểm, lý do bằng chứng bắt buộc. Không được sửa 70 điểm hệ thống hay 20 điểm sao của khách bằng thao tác CRUD thông thường.
- Doanh số, số đơn, giá trị upsell và khối lượng công việc vẫn xuất hiện ở **báo cáo kinh doanh và bảng sản lượng**, tách với tổng KPI chất lượng. Nếu đo upsell cá nhân phải có chứng cứ giao dịch và người tạo upsell, không cộng booking online cho lễ tân như doanh số bán trực tiếp.

### 5.5. Khách đánh giá đúng người, đúng giai đoạn

1. Booking thuộc đúng khách đăng nhập, đã phát sinh giai đoạn phục vụ thực tế; hệ thống liệt kê A/B từng tham gia có event phù hợp. Khách không được đánh giá B về check-in nếu B chưa từng thực hiện hoặc hỗ trợ giai đoạn đó.
2. Hiển thị tên/đơn vị người hỗ trợ theo phạm vi được phép công khai, nội dung `Bạn đánh giá thế nào về hỗ trợ trước khi đến?` hoặc `Bạn đánh giá lễ tân hỗ trợ trong thời gian lưu trú?`, chọn 1–5 sao và bình luận tùy chọn.
3. Chống duplicate theo `(booking_id, customer_id, staff_id, service_stage)`; sửa đánh giá tạo version và nhật ký, không ghi đè làm mất dấu vết. Không cho nhân viên/manager gửi đánh giá sao thay khách.
4. Chặn rating cho giai đoạn không xảy ra: No-show chỉ có thể đánh giá pre-stay nếu thực sự có tương tác, không đánh giá kỳ lưu trú giả.
5. Dashboard hiển thị sao trung bình, số đánh giá, phân bố 1–5 sao, thời gian, giai đoạn và tình trạng đủ mẫu. Có cơ chế báo cáo nội dung lạm dụng/không phù hợp, không cho quản lý tùy ý xóa đánh giá bất lợi.

### 5.6. Database, backend và frontend

- Tạo `StaffKpiModule` với các phần `KpiMetricsCollector`, `KpiScoringPolicyService`, `KpiPeriodCalculator`, `KpiReviewService`. Tính định kỳ theo tháng và có thể tính thử thời gian thực nhưng chỉ khóa sau thời hạn đối soát/sửa sai.
- Bảng `staff_kpi_events`: liên kết `source_event_id`, `booking_id`, `staff_id`, `metric_code`, `evidence_level`, `eligible`, `result`, `occurred_at`, `policy_version`; dùng unique để không tính trùng một sự kiện.
- Bảng `staff_reviews`: `booking_id`, `customer_id`, `staff_id`, `service_stage`, `stars`, `comment`, `version`, `status`, `created_at` và bảng lịch sử sửa review.
- Bảng `staff_kpi_period_scores`: `(hotel_id, staff_id, period_start, period_end, policy_version)`, `total_score`, `coverage_ratio`, `sample_count`, `status` (`DRAFT`, `PROVISIONAL`, `SUBMITTED`, `APPROVED`, `LOCKED`), `calculated_at`, `approved_by`, `approved_at`.
- Bảng `staff_kpi_metric_scores`: `period_score_id`, `metric_code`, `weight`, `eligible_count`, `success_count`, `raw_score`, `weighted_points`, `evidence_count`, `is_na`, `reason`.
- Bảng `kpi_adjustment_requests`: điểm gốc, điểm đề xuất, `metric_code`, căn cứ, người đề nghị/phê duyệt, status, thời gian; không cho DELETE hard với kỳ đã khóa.
- Frontend khách thêm biểu mẫu sao ở booking history/detail; frontend lễ tân thêm dashboard KPI cá nhân có dấu vết event, mẫu và tiêu chí thiếu; frontend quản lý thêm KPI nhân viên khách sạn theo kỳ, bảng điểm thành phần, phê duyệt, tranh luận/điều chỉnh có lịch sử.
- API gợi ý: `POST /bookings/:id/staff-reviews`, `PATCH /staff-reviews/:id`, `GET /staff-kpi/me`, `GET /staff-kpi/hotels/:hotelId`, `GET /staff-kpi/staff/:staffId/periods/:periodId`, `POST /staff-kpi/periods/:id/submit`, `POST /staff-kpi/periods/:id/approve`, `POST /staff-kpi/adjustments`.

### 5.7. Kiểm thử và nghiệm thu

- A đã làm pre-stay, B làm check-in và in-stay: điểm phân bổ đúng; chuyển assignment không thay dữ liệu lịch sử; No-show N/A; khách không đánh giá không bị 0; số review dưới ngưỡng ghi provisional; khách không thể đánh giá sai người.
- Bị gửi trùng sự kiện, sửa review nhiều lần, khách/nhân viên khác khách sạn gửi yêu cầu trái quyền, quản lý cố sửa điểm tự động, trùng kỳ, thời điểm khóa kỳ: phải xử lý đúng quy tắc.
- So sánh kết quả tính lại từ event với snapshot đã duyệt; khi đổi phiên bản policy không tự ghi đè các kỳ đã khóa.
- **Hoàn thành Đợt 5 khi:** điểm được giải thích tới từng nguồn dữ liệu, có tỷ lệ dữ liệu đủ mẫu, 70/20/10 có kiểm soát; A/B giữ KPI chính xác dù booking chuyển người.

---

## ĐỢT 6. HOÀN THIỆN DASHBOARD, PHÂN QUYỀN, KIỂM THỬ ĐẦU CUỐI VÀ PHÁT HÀNH

### 6.1. Bối cảnh nghiệp vụ

Các module chạy đúng riêng lẻ chưa đủ để đưa vào vận hành. Booking có thể được tạo qua nhiều đường; IPN VNPay có thể đến lại; nhân viên A có thể xin nghỉ trong lúc đang có booking; cron No-show có thể chạy cùng lúc B bấm check-in; quản lý khách sạn X không được đọc dữ liệu khách sạn Y. Đợt 6 tích hợp cả hệ thống thành một hành trình vận hành có thể dùng thật và kiểm soát được sự cố.

### 6.2. Các hành trình E2E bắt buộc

**Hành trình 1 – bình thường:** khách chọn phòng STANDARD → thanh toán VNPay → hold COMMITTED → phân công lễ tân hợp lệ theo 40/120 → A hỗ trợ trước kỳ → khách đến check-in → cùng A phục vụ trong lưu trú → checkout → khách đánh giá A → KPI kỳ ghi nhận đúng A.

**Hành trình 2 – VIP nhiều booking liên tiếp:** 08:30 A nhận VIP, 08:55 B nhận VIP, 09:20 C nhận VIP theo năng lực fallback hợp lệ, 09:45 chọn lại ứng viên ngoài cửa sổ 40 phút; hiển thị lý do phân công, không giao liên tục cho A.

**Hành trình 3 – nhân viên xin đi muộn:** A nộp đơn 08:00–10:00, quản lý duyệt; booking 08:30 không xét A. Booking cũ của A có khách đến 08:45: quản lý cấp B coverage check-in 120 phút. B ghi KPI check-in, A giữ KPI pre-stay.

**Hành trình 4 – A nghỉ việc:** A đang giữ booking CHECKED_IN, quản lý chuyển hoàn toàn sang B, tồn đọng được bàn giao, khách thấy người phục vụ hiện tại, A/B có KPI riêng; B checkout hợp lệ.

**Hành trình 5 – No-show rồi phục hồi:** khách đã thanh toán 15/08 17:00–19/08 17:00; quá grace chuyển No-show, inventory vẫn giữ; ngày 17 khách đến và A vắng, B check-in thay; booking chuyển `CHECKED_IN`, không tạo hold mới, KPI thuộc B cho check-in.

**Hành trình 6 – No-show hết kỳ:** khách không đến đến 19/08 17:00, đóng `CLOSED_NO_SHOW`, phòng khả dụng cho các khoảng sau checkout, không chấm 0 điểm check-in cho lễ tân; sự kiện hỗ trợ trước kỳ vẫn còn.

**Hành trình 7 – lỗi đồng thời:** hai callback IPN cùng phút, cron No-show đang chạy, manager transfer A→B, check-in của B và đối soát thanh toán cùng lúc: backend dùng transaction/idempotency; không phân công đôi, không check-in vượt trạng thái, không release phòng sai.

**Hành trình 8 – quyền dữ liệu:** manager A không đọc staff/KPI/booking của hotel B; lễ tân không nhận đơn ngoài phạm vi; khách không thấy thông tin vắng mặt hoặc hồ sơ nghỉ phép của nhân viên; token bị khóa bị từ chối tại backend.

### 6.3. Màn hình và quyền cần hoàn thiện

| Vùng giao diện | Khách | Lễ tân | Quản lý |
|---|---|---|---|
| Booking cá nhân/phụ trách | Đơn của chính mình | Đơn được giao hoặc hỗ trợ có hiệu lực | Tất cả booking thuộc khách sạn quản lý |
| Đơn xin phép nhân viên | Không có | Tạo, xem, rút theo điều kiện | Duyệt/từ chối, tra cứu lịch sử |
| Phân công/coverage | Xem tên người hỗ trợ phù hợp | Xem assignment và coverage của mình | Tạo, duyệt, chuyển giao, xem lý do thuật toán |
| Check-in/No-show | Xem trạng thái, báo đến muộn | Xác nhận tại quầy nếu đủ quyền | Giám sát, giải quyết ngoại lệ |
| Yêu cầu dịch vụ/hỗ trợ | Tạo và đánh giá kết quả | Nhận, phản hồi, hoàn thành theo quyền | Giám sát SLA, điều phối |
| KPI | Gửi rating hợp lệ | Chỉ xem KPI cá nhân và bằng chứng liên quan | Xem/duyệt KPI trong khách sạn mình |

Đảm bảo các menu `Bookings`, `Hotel Staff`, `Services`, `Dashboard`, `Profile` liên kết API thực; không để button placeholder hoặc màn hình KPI tính dữ liệu giả. Phân quyền ở UI chỉ để hướng dẫn; bắt buộc backend kiểm tra quyền lần cuối.

### 6.4. Bảo mật, đồng thời và dữ liệu

- **Chặn rò dữ liệu chéo khách sạn:** mọi query cần `hotel_id` từ quyền actor, không chỉ nhận query param `hotelId` do client gửi. Backend `GET /bookings` hiện cần sửa để bắt buộc phạm vi khách sạn cho `EMPLOYEE`; các báo cáo và API available-staff cũng phải kiểm tra quyền theo booking.
- **Chỉ đúng người được quyền thao tác booking:** primary owner, acting staff theo coverage còn hạn và đúng scope, hoặc hotel manager hợp lệ. Một lễ tân cùng khách sạn nhưng không được giao không tự nhiên có quyền xử lý booking bất kỳ.
- **Khoá cạnh tranh:** sử dụng DB transaction và row/advisory lock phù hợp để phân công trong cùng khách sạn, check-in vs No-show, transfer vs update công việc; mọi lệnh thay đổi có optimistic version hoặc lock cho trạng thái nhạy cảm.
- **Event idempotent:** unique theo transaction/payment-event ID và booking để chống gọi lặp; không ghi KPI hai lần khi callback gửi lại hoặc người dùng double-click.
- **Tách dữ liệu cá nhân:** lý do nghỉ/đi muộn chỉ nhân viên, quản lý có thẩm quyền xem; các lễ tân khác chỉ thấy “không khả dụng” thay vì chi tiết riêng tư. Hạn chế thông tin nhạy cảm ở logs và payload realtime.
- **Audit bất biến:** ai tạo/duyệt đơn; ai đổi nhân viên; ai nhận check-in muộn; ai điều chỉnh KPI; dữ liệu cũ không bị hard-delete. Thêm log hệ thống hợp lệ cho sự kiện tự động.
- **Quan sát hệ thống:** metrics cho `assignment_failed`, `manager_fallback`, `no_show_transition`, `late_check_in_recovery`, `coverage_expired_with_open_tasks`, `kpi_recalculation_failed`; cảnh báo vận hành đến đúng quản lý.

### 6.5. Migration, backfill và triển khai an toàn

1. Sao lưu dữ liệu và kiểm tra schema hiện tại; đối chiếu ORM với SQL bootstrap/migrations. Không cho `synchronize:true` tự thay đổi môi trường sản xuất.
2. Chạy migration bảng mới và cột nullable, index; xác nhận các entity cũ `bookings`, `booking_status_logs`, `service_requests`, `staff_skills` tương thích thực tế.
3. Backfill `rooms.service_tier` có kiểm soát: gợi ý theo giá/tên **chỉ để quản lý xác nhận**, không tự chốt VIP nếu dữ liệu mơ hồ.
4. Backfill các booking đang mở thành assignment hiện tại từ `handled_by` nếu còn hợp lệ; ghi `source = MIGRATION` và thời điểm backfill. **Không suy diễn A đã xử lý bao nhiêu phút/ticket khi không có bằng chứng**; KPI cũ có thể đánh dấu `LEGACY_NO_EVIDENCE`.
5. Bật feature flag theo hotel: `staff_requests_enabled`, `assignment_fairness_enabled`, `no_show_enabled`, `coverage_enabled`, `kpi_enabled`. Mở trước trên môi trường staging, test E2E với VNPay sandbox và dữ liệu giả.
6. Khi cần rollback, tắt tính năng mới, không rollback bừa các giao dịch đã thanh toán, không hủy hold COMMITTED hoặc xóa lịch sử chuyển giao. Có kế hoạch sửa dữ liệu tương thích nếu bắt buộc hạ phiên bản.
7. Tài liệu hóa runbook: phát hiện booking vô chủ, trường hợp No-show sai, chuyển người khẩn cấp, chứng cứ hỗ trợ, khiếu nại KPI; phân công người trực xử lý lỗi kỹ thuật ngoài các vai trò nghiệp vụ.

### 6.6. Danh sách test chấp nhận phát hành

- **Phân công:** đủ nhân viên, thiếu nhân viên, VIP nhiều cấp, giới hạn 39:59/40:00/119:59/120:00, hai thanh toán đồng thời, idempotency, không phân công trước PAID, manager fallback và critical alert.
- **Đơn xin phép:** nộp mới, từ chối, duyệt, rút, kéo dài đi muộn, đơn chồng lấn, nhân viên nghỉ đúng khoảng, nhân viên bị khóa, quản lý khách sạn khác, cờ khẩn cấp hết hạn.
- **Thay người:** TEMP 15 phút/120 phút/24 giờ, gia hạn, hết hạn khi tác vụ dở, A quay lại, B bị khóa, chuyển hẳn khi CHECKED_IN, A/B nhận KPI riêng, không chuyển rating sai người.
- **No-show:** kiểm tra gia hạn 6 giờ, check-in trong grace, check-in sau No-show, đến sau checkout, hủy/hoàn tiền hợp lệ, ngày giờ/cạnh tranh cron, không thay inventory COMMITTED, nhiều phòng một booking.
- **Dịch vụ/KPI:** phản hồi thật vs nút giả, SLA quá hạn, ticket reopen, service event không nhân đôi, rating một khách/một nhân viên/giai đoạn, thiếu mẫu, tỷ lệ coverage, điều chỉnh có lịch sử, kỳ KPI đã khóa không tự đổi.
- **Bảo mật:** cross-hotel, cross-customer, nhân viên không phải primary/acting, không cho đọc đơn xin phép trái quyền, API bị replay, kiểm soát token của người bị khóa.

### 6.7. Tiêu chí phát hành và bàn giao

Một bản release chỉ đạt khi: (a) E2E của ít nhất 8 hành trình trên chạy thành công; (b) không còn trường hợp đặt trùng suất phòng do No-show; (c) mọi booking PAID đều có primary owner hoặc cảnh báo critical được nhìn thấy; (d) A/B được chấm theo event, không theo tên người cuối cùng; (e) quản lý có thể duyệt đơn vắng, phân công thay/chuyển hẳn; (f) log đủ để truy vết một khiếu nại; (g) dashboard không hiển thị điểm tự chế thiếu nguồn; (h) migration/rollback đã diễn tập.

---
## PHỤ LỤC I. MA TRẬN API ĐỀ XUẤT VÀ QUYỀN TỐI THIỂU

Các đường dẫn dưới đây là **API thiết kế mới**; tên có thể tinh chỉnh theo chuẩn endpoint của repository khi code. Không công bố là API đã tồn tại.

| API đề xuất | Đối tượng được gọi | Hành vi/kiểm soát bắt buộc |
|---|---|---|
| `POST /staff-requests` | Lễ tân | Gửi đơn của bản thân, thuộc khách sạn đang làm việc. |
| `GET /staff-requests/me` | Lễ tân | Chỉ xem đơn của chính mình. |
| `GET /staff-requests/hotel/:hotelId` | Quản lý | Dữ liệu nhân viên đúng khách sạn mình quản lý. |
| `PATCH /staff-requests/:id/decision` | Quản lý | APPROVED/REJECTED với reason, lưu reviewer và thời điểm. |
| `POST /staff-requests/:id/withdraw` | Lễ tân / quản lý | Rút theo trạng thái, cần duyệt nếu đơn đã APPROVED. |
| `GET /staff-availability/hotels/:hotelId` | Quản lý | Danh sách khả dụng theo thời điểm, ẩn lý do riêng tư khi không đủ quyền. |
| `GET /bookings/:id/assignments` | Quản lý / nhân viên liên quan | Lịch sử owner, lý do phân công, lịch sử chuyển giao. |
| `POST /bookings/:id/coverages` | Quản lý | Chọn B, phạm vi, 15 phút–24 giờ, không cross-hotel. |
| `POST /bookings/:id/coverages/:id/end` | Quản lý | Kết thúc sớm, xử lý tác vụ đang mở. |
| `POST /bookings/:id/transfer` | Quản lý | Chuyển owner A→B, transaction, audit, bàn giao tồn đọng. |
| `POST /bookings/:id/check-in` | Primary/acting/manager hợp lệ | Xác nhận tại quầy, cho phép late/no-show theo policy. |
| `POST /bookings/:id/check-out` | Primary/acting/manager hợp lệ | Kiểm tra CHECKED_IN, ghi người và thời điểm thực tế. |
| `POST /bookings/:id/late-arrival-notice` | Khách có booking | Chỉ gửi thông báo đến muộn, không tự check-in. |
| `POST /bookings/:id/support-requests` | Khách có booking | Tạo yêu cầu chung có actor/customer, gắn booking. |
| `POST /support-requests/:id/messages` | Khách / staff đúng quyền | Gửi phản hồi thật, timestamp server, lưu lịch sử. |
| `PATCH /support-requests/:id/status` | Staff đúng quyền / quản lý | State machine, actor, audit, SLA. |
| `POST /support-requests/:id/confirm` | Khách / quản lý có xác minh | Xác nhận giải quyết; kiểm tra cùng booking/khách sạn. |
| `POST /bookings/:id/staff-reviews` | Khách đặt phòng | Chỉ người có event phục vụ và đúng giai đoạn. |
| `GET /staff-kpi/me` | Lễ tân | Kỳ, điểm thành phần, mẫu và chứng cứ của mình. |
| `GET /staff-kpi/hotels/:hotelId` | Quản lý | Tổng hợp trong phạm vi khách sạn, có filter kỳ. |
| `POST /staff-kpi/periods/:id/approve` | Quản lý | Không tự sửa 70 điểm hệ thống, audit việc phê duyệt. |

## PHỤ LỤC II. DANH MỤC CẤU HÌNH NGHIỆP VỤ VÀ GIÁ TRỊ KHỞI TẠO

| Tham số | Giá trị khởi tạo đề xuất | Ghi chú |
|---|---|---|
| `assignment_hard_cooldown_minutes` | **40** | Loại cứng khỏi phân công **tự động**; không ngăn coverage/transfer đã duyệt. |
| `assignment_fairness_window_minutes` | **120** | Sau 40 phút cho phép tái xét với ưu tiên thấp hơn. |
| `temporary_coverage_default_minutes` | **120** | Lễ tân B được hỗ trợ thay trong phạm vi xác định. |
| `temporary_coverage_min_minutes` | **15** | Ngưỡng điều chỉnh nhỏ nhất. |
| `temporary_coverage_max_minutes` | **1440** | Tối đa 24 giờ mỗi lần duyệt; có thể gia hạn có kiểm soát. |
| `no_show_grace_minutes` | **360** | 6 giờ từ check-in dự kiến, cấu hình theo khách sạn. |
| `kpi_review_min_valid_count` | **3** | Dưới mức này sao hiển thị tham khảo, chưa vào KPI chính thức. |
| `kpi_period` | **Tháng** | Kỳ KPI mặc định; có snapshot và thời điểm khóa kỳ. |
| `kpi_weights` | **70/20/10** | Hệ thống/khách/quản lý; version hóa. |
| `timezone_display` | **Asia/Ho_Chi_Minh** | Dữ liệu lưu UTC, hiển thị theo múi giờ khách sạn. |
| `staff_availability_default` | **ACTIVE eligible** | Ngoại lệ từ nghỉ/đi muộn đã duyệt và cờ unavailable. |
| `kpi_missing_metric` | **N/A; normalize** | Không coi chưa phát sinh cơ hội là thất bại. |

Ngưỡng kỹ năng M1–M4, số hồ sơ tối thiểu, SLA phản hồi và các trường liên quan đến độ khó booking phải được cấu hình riêng và kiểm thử với dữ liệu thực tế. Không coi những con số ví dụ trong đặc tả là chuẩn nghề nghiệp chung.

## PHỤ LỤC III. DANH SÁCH TICKET PHÁT TRIỂN TỐI THIỂU

| Ticket | Phụ thuộc | Điều kiện hoàn thành |
|---|---|---|
| P1-01 Chuẩn hóa `service_tier` và nghiệp vụ lễ tân | Migration | Có phân hạng rõ, quản lý xác nhận dữ liệu cũ. |
| P1-02 Staff Requests và duyệt đi muộn/nghỉ | P1-01 | Đơn + duyệt + lịch sử + availability thời gian. |
| P1-03 AssignmentService 40/120 và fallback | P1-01, P1-02 | Test ranh giới và giải thích lựa chọn. |
| P1-04 Tích hợp VNPay / đối soát / idempotency | P1-03 | Không phân công trước PAID, không gán hai lần. |
| P2-01 State machine No-show/late check-in | P1-04 | Khách có thể nhận muộn hợp lệ. |
| P2-02 Bảo toàn inventory & job No-show | P2-01 | COMMITTED không bị release do No-show. |
| P3-01 Temporary coverage theo phạm vi & hạn | P1-02, P2-01 | B làm thay, A không mất owner. |
| P3-02 Transfer A→B và tác vụ dở | P3-01 | Đổi owner kể cả CHECKED_IN; KPI lịch sử giữ nguyên. |
| P4-01 Support Requests & event ledger | P3-02 | Mọi tác vụ có actor và timestamp có chứng cứ. |
| P4-02 SLA & kết nối ServicesService | P4-01 | Tính đúng first response và resolution; không double count. |
| P5-01 Đánh giá sao đúng nhân viên/giai đoạn | P3-02, P4-01 | Rating có xác thực và chống duplicate. |
| P5-02 KPI scoring + snapshot + duyệt | P4-02, P5-01 | 70/20/10, N/A, sample coverage, history. |
| P6-01 Dashboard theo vai trò | P1–P5 | Không hiển thị dữ liệu khách sạn khác, không fake KPI. |
| P6-02 Migration/backfill & E2E | P1–P6 | Có CI, staging, test dữ liệu, rollback và runbook. |

**Thứ tự khuyến nghị:** ưu tiên P1 và P2 để bảo đảm tiền/phòng/phân công chính xác, làm P3 trước KPI để sự kiện A/B được quy trách nhiệm đúng từ đầu, sau đó mới khóa thiết kế scoring và dashboard đánh giá.

## PHỤ LỤC IV. BẤT BIẾN KỸ THUẬT PHẢI ĐƯỢC KIỂM TRA

1. Mỗi booking thanh toán thành công có **tối đa một primary assignment đang mở**; nếu chưa có người thì có cảnh báo `UNASSIGNED_CRITICAL` có thể hành động.
2. Một callback/đối soát thành công lặp lại **không tạo assignment, hold COMMITTED hoặc KPI event trùng**.
3. Một lễ tân trong khoảng 40 phút sau lần được giao booking mới nhất **không nhận booking tự động thứ hai**, dù là VIP; ngoại lệ coverage quản lý duyệt là loại tác vụ khác và được ghi riêng.
4. Tại cùng một khách sạn, ưu tiên người chưa có phân công trong 120 phút ở mức năng lực hợp lệ trước người ở cửa sổ 40–119 phút, kể cả phải đi sang mức kỹ năng tiếp theo nhưng không dưới ngưỡng an toàn.
5. Nhân viên đang được duyệt nghỉ/đi muộn tại thời điểm T không được bộ phân công tự động coi là khả dụng; `SUBMITTED` chưa duyệt không mặc nhiên chặn, nhưng có cảnh báo xử lý.
6. Mọi booking ở `NO_SHOW` có thanh toán PAID và hold COMMITTED **vẫn chiếm suất phòng trong `[checkIn, checkOut)`**; chuyển `NO_SHOW → CHECKED_IN` không tạo thêm hold và không đổi quantity.
7. Mọi sự kiện check-in có actor hợp lệ, timestamp server và booking đang đủ điều kiện; không thay `actual_check_in_at` bằng lịch hẹn.
8. Hỗ trợ tạm thời không thay `bookings.handled_by`; chuyển hoàn toàn phải đóng phân công A/mở B nguyên tử; tác vụ được ghi theo người thực hiện.
9. KPI kỳ chỉ dựa vào sự kiện hợp lệ và đánh giá đúng nhân viên; transfer không làm thay người trong sự kiện quá khứ, không nhân đôi điểm do một ticket có nhiều bước.
10. Mọi truy vấn nhân viên, booking, rating, KPI đều có phạm vi khách sạn/booking/tác vụ tại backend; role global `EMPLOYEE` đơn lẻ không đủ quyền.

## PHỤ LỤC V. ĐIỂM GẮN VỚI SOURCE HIỆN CÓ

**Backend — nhánh minh:**

- [BookingsService: phân công và callback](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/bookings/bookings.service.ts) — thay `autoAssignHotelStaffInternal` bằng `BookingAssignmentService`, xem lại nhánh tạo booking và phép phân công sau PAID.
- [BookingsService: chuyển người và KPI tổng hợp](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/bookings/bookings.service.ts#L886-L1014) — bỏ giới hạn cấm chuyển khi CHECKED_IN theo policy; không chỉ dùng `handled_by` làm căn cứ KPI.
- [BookingStatus / Booking entity](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/bookings/entities/booking.entity.ts) — thêm trạng thái, mốc thời gian và trường liên kết assignment.
- [InventoryService](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/inventory/inventory.service.ts) — dùng hold COMMITTED làm nguồn tính tồn phòng; không giải phóng khi No-show.
- [PaymentFinalizerService](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/payments/services/payment-finalizer.service.ts) và [PaymentReconciliationService](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/payments/services/payment-reconciliation.service.ts) — thống nhất phân công sau thanh toán, idempotency.
- [HotelStaffService](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/hotel-staff/hotel-staff.service.ts), [StaffSkill](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/hotel-staff/entities/staff-skill.entity.ts), [StaffEligibilityRule](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/hotel-staff/entities/staff-eligibility-rule.entity.ts) — nguồn năng lực, vai trò nghiệp vụ và điều kiện xét chọn.
- [ServiceRequest](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/services/entities/service-request.entity.ts) và [ServicesService](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/services/services.service.ts) — tận dụng trạng thái tác vụ/SLA, mở rộng ghi event.
- [BookingsController](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/bookings/bookings.controller.ts) và [BookingAccessService](https://github.com/HuuTri331/cg_traveleke_service/blob/minh/backend/src/bookings/services/booking-access.service.ts) — siết quyền theo hotel/primary/acting.

**Frontend — nhánh minh:**

- [Bookings dashboard](https://github.com/HuuTri331/cg_traveleke_app/blob/minh/src/app/%28dashboard%29/bookings/page.tsx), [Booking API](https://github.com/HuuTri331/cg_traveleke_app/blob/minh/src/services/api/booking.api.ts) — giao diện người phụ trách, No-show, coverage, transfer.
- [Hotel Staff dashboard](https://github.com/HuuTri331/cg_traveleke_app/blob/minh/src/app/%28dashboard%29/hotel-staff/page.tsx), [Staff Skills dashboard](https://github.com/HuuTri331/cg_traveleke_app/blob/minh/src/app/%28dashboard%29/staff-skills/page.tsx) — cơ sở để quản lý nhân viên và chuẩn năng lực.
- [Services dashboard](https://github.com/HuuTri331/cg_traveleke_app/blob/minh/src/app/%28dashboard%29/services/page.tsx), [Profile dashboard](https://github.com/HuuTri331/cg_traveleke_app/blob/minh/src/app/%28dashboard%29/profile/page.tsx), [Dashboard](https://github.com/HuuTri331/cg_traveleke_app/blob/minh/src/app/%28dashboard%29/dashboard/page.tsx) — bổ sung công việc và KPI cá nhân/quản lý.
- [Booking History](https://github.com/HuuTri331/cg_traveleke_app/blob/minh/src/app/booking-history/page.tsx) — bổ sung thông báo đến muộn và đánh giá nhân viên có thực sự phục vụ.

**Tài liệu tham khảo kiến trúc:** [QloApps](https://github.com/Qloapps/QloApps) (booking/PMS), [OCA Vertical Hotel](https://github.com/OCA/vertical-hotel) (phân tách module khách sạn), [Frappe Helpdesk](https://github.com/frappe/helpdesk) (ticket, giao việc, SLA), [Zammad](https://github.com/zammad/zammad) (ticket và lịch sử sự kiện). Các dự án này để tham khảo **mẫu thiết kế**, không có nghĩa chứa sẵn thuật toán 40/120 phút, hai loại thay người và chính sách No-show của Traveleke.

## KẾT LUẬN VÀ TIÊU CHUẨN CHỐT YÊU CẦU

Traveleke phải phục vụ xuyên suốt vòng đời khách sạn, đồng thời công bằng với lễ tân. Người giỏi được ưu tiên khi chưa có ai được giao, nhưng không độc chiếm booking nhờ quy tắc 40/120 phút. Nghỉ/đi muộn được báo bằng đơn do nhân viên tự gửi và quản lý phê duyệt, không cần ca trực. Trợ giúp tạm thời có thời hạn là hỗ trợ công việc; chuyển giao hoàn toàn là thay đổi người chịu trách nhiệm chính thức. Booking No-show đã thanh toán vẫn giữ phòng nhưng cho phép check-in muộn hợp lệ. KPI được ghi theo **người thực sự làm từng việc**, có dấu vết và đánh giá khách, không theo người cuối cùng đứng tên booking hoặc con số quản lý tự nhập.

**Đầu ra cần có sau sáu đợt:** migration an toàn, backend/frontend vận hành thật, bộ unit/integration/E2E test, dashboard theo ba vai trò, nhật ký phân công – đơn xin phép – No-show – chuyển người – KPI có thể truy vết, và tài liệu bàn giao vận hành.
