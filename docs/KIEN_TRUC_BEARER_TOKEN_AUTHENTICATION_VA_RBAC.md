# TÀI LIỆU KIẾN TRÚC ENTERPRISE: AUTHORIZATION BEARER TOKEN (RFC 6750) & PHÂN QUYỀN RBAC TRONG NESTJS & NEXT.JS 16
> **Hệ thống Quản lý & Đặt phòng Khách sạn Traveleke**  
> **Ngôn ngữ & Nền tảng:** NestJS 11, Passport-JWT, Next.js 16, RFC 6750, RBAC (Role-Based Access Control)

---

## MỤC LỤC
1. [BẢN CHẤT CỦA CƠ CHẾ AUTHORIZATION BEARER TOKEN](#1-bản-chất-của-cơ-chế-authorization-bearer-token)
   - [1.1. Cấu trúc Header Authorization & Tiêu chuẩn RFC 6750](#11-cấu-trúc-header-authorization--tiêu-chuẩn-rfc-6750)
   - [1.2. Giải phẫu JSON Web Token (JWT)](#12-giải-phẫu-json-web-token-jwt)
   - [1.3. Vòng đời Token: Access Token vs Refresh Token](#13-vòng-đời-token-access-token-vs-refresh-token)
2. [CHUẨN HÓA MÃ TRẠNG THÁI HTTP: 401 UNAUTHORIZED VS 403 FORBIDDEN](#2-chuẩn-hóa-mã-trạng-thái-http-401-unauthorized-vs-403-forbidden)
   - [2.1. Phân biệt rạch ròi Authentication và Authorization](#21-phân-biệt-rạch-ròi-authentication-và-authorization)
   - [2.2. Header WWW-Authenticate theo RFC 6750](#22-header-www-authenticate-theo-rfc-6750)
3. [MÔ HÌNH PHÂN QUYỀN ĐA TẦNG RBAC TRONG TRAVELEKE](#3-mô-hình-phân-quyền-đa-tầng-rbac-trong-traveleke)
   - [Vai trò ADMIN vs STAFF vs CUSTOMER](#vai-trò-admin-vs-staff-vs-customer)
4. [TRIỂN KHAI PHÍA BACKEND NESTJS](#4-triển-khai-phía-backend-nestjs)
   - [4.1. JwtAuthGuard chuẩn hóa RFC 6750](#41-jwtauthguard-chuẩn-hóa-rfc-6750)
   - [4.2. RolesGuard kiểm soát quyền hạn chặt chẽ (HTTP 403)](#42-rolesguard-kiểm-soát-quyền-hạn-chặt-chẽ-http-403)
   - [4.3. Bộ Unit Test Xác thực Guards](#43-bộ-unit-test-xác-thực-guards)
5. [TRIỂN KHAI PHÍA FRONTEND NEXT.JS 16](#5-triển-khai-phía-frontend-nextjs-16)
   - [5.1. Tách biệt Ngữ cảnh: AuthContext (Staff) vs CustomerAuthContext (Khách)](#51-tách-biệt-ngữ-cảnh-authcontext-staff-vs-customerauthcontext-khách)
   - [5.2. Axios Response Interceptor & Điều hướng 401 thông minh](#52-axios-response-interceptor--điều-hướng-401-thông-minh)
6. [KẾT LUẬN & NGUYÊN TẮC BẢO MẬT BẤT BIẾN](#6-kết-luận--nguyên-tắc-bảo-mật-bất-biến)

---

## 1. BẢN CHẤT CỦA CƠ CHẾ AUTHORIZATION BEARER TOKEN

### 1.1. Cấu trúc Header Authorization & Tiêu chuẩn RFC 6750
Trong giao thức HTTP, phía Client gửi thông tin chứng thực danh tính thông qua header:
```http
Authorization: Bearer <access_token>
```
- **`Bearer`**: Là Authentication Scheme được định nghĩa trong **IETF RFC 6750**.
- **Ý nghĩa**: "Bearer" nghĩa là "người cầm giữ". Bất kỳ ai cầm giữ token này đều được hệ thống coi là chủ sở hữu hợp pháp của quyền hạn gắn liền với token. Do đó, kênh truyền bắt buộc phải được mã hóa bằng **HTTPS (TLS)** để chống nghe lén (Man-In-The-Middle Attack).

### 1.2. Giải phẫu JSON Web Token (JWT)
JWT là chuỗi gồm 3 phần phân tách bởi dấu chấm (`.`): `Header.Payload.Signature`
1. **Header (Mã hóa Base64URL)**: Chứa thuật toán ký (`alg: "HS256"`) và loại token (`typ: "JWT"`).
2. **Payload (Mã hóa Base64URL - KHÔNG ĐƯỢC CHỨA DỮ LIỆU NHẠY CẢM NHƯ PASSWORD)**:
   - Các trường chuẩn (Registered claims): `sub` (User ID), `iat` (Thời điểm cấp), `exp` (Thời điểm hết hạn).
   - Các trường nghiệp vụ của Traveleke (Custom claims): `email`, `role` (`ADMIN` | `STAFF` | `CUSTOMER`), `hotelId`.
3. **Signature (Chữ ký mật mã)**:
   - Tạo bởi thuật toán ký HMAC-SHA256 kết hợp giữa `Header + Payload + SecretKey` trên máy chủ.
   - Giúp Backend phát hiện ngay lập tức nếu Client tự ý sửa đổi `role: "CUSTOMER"` thành `role: "ADMIN"`.

### 1.3. Vòng đời Token: Access Token vs Refresh Token
- **Access Token**:
  - Thời gian sống ngắn: **15 - 60 phút**.
  - Giảm thiểu rủi ro nếu token bị rò rỉ; Backend không cần lưu session vào RAM (Stateless).
- **Refresh Token**:
  - Thời gian sống dài: **7 - 30 ngày**.
  - Dùng để xin cấp Access Token mới mà không bắt người dùng phải nhập lại mật khẩu.
  - Lưu trữ an toàn trong CSDL hoặc Redis, hỗ trợ cơ chế thu hồi (Revocation) khi người dùng đổi mật khẩu hoặc bị khóa tài khoản.

---

## 2. CHUẨN HÓA MÃ TRẠNG THÁI HTTP: 401 UNAUTHORIZED VS 403 FORBIDDEN

Một sai lầm rất phổ biến trong các hệ thống là ném chung mã `401 Unauthorized` cho tất cả các lỗi về bảo mật.

### 2.1. Phân biệt rạch ròi Authentication và Authorization

```text
                  REQUEST ĐẾN TẦNG BẢO MẬT
                             │
                             ▼
                 [ BẠN LÀ AI? (AUTHENTICATION) ]
                 Có Token không? Token có hợp lệ không?
                             ├── KHÔNG ──► HTTP 401 UNAUTHORIZED
                             │             Header: WWW-Authenticate: Bearer error="invalid_token"
                             ▼ CÓ (User hợp lệ)
                 [ BẠN CÓ QUYỀN LÀM VIỆC NÀY KHÔNG? (AUTHORIZATION) ]
                 Role của bạn có nằm trong @Roles(...) không?
                             ├── KHÔNG ──► HTTP 403 FORBIDDEN
                             │             User hợp lệ nhưng không đủ quyền hạn (Quyền hạn bị từ chối)
                             ▼ CÓ
                    CHO PHÉP TRUY CẬP VÀO CONTROLLER
```

| Tình huống | Mã HTTP chuẩn | Ý nghĩa nghiệp vụ |
| :--- | :---: | :--- |
| Không gửi header `Authorization` | **401** | Chưa đăng nhập. Cần chuyển hướng sang trang Login. |
| Token sai chữ ký, bị sửa đổi | **401** | Token giả mạo. Xóa token và yêu cầu đăng nhập lại. |
| Token hết hạn (`jwt expired`) | **401** | Phiên đăng nhập hết hạn. Thực hiện refresh token hoặc login lại. |
| Nhân viên Lễ tân xóa Khách sạn của Admin | **403** | Đã đăng nhập đúng là Lễ tân, nhưng không có quyền xóa khách sạn. |
| Khách hàng xem danh sách nhân sự nội bộ | **403** | Khách hàng không có quyền truy cập trang quản trị nội bộ. |

### 2.2. Header WWW-Authenticate theo RFC 6750
Theo quy định tại **RFC 6750 Section 3**, khi trả về lỗi `HTTP 401 Unauthorized`, máy chủ **bắt buộc** phải kèm theo header:
```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="invalid_token", error_description="Token không hợp lệ hoặc đã hết hạn"
```
Header này giúp các thư viện Client và API Gateways nhận diện chính xác nguyên nhân lỗi thuộc về Bearer token để kích hoạt cơ chế tự động refresh token.

---

## 3. MÔ HÌNH PHÂN QUYỀN ĐA TẦNG RBAC TRONG TRAVELEKE

Hệ thống Traveleke phân chia 3 vai trò rõ rệt:

```text
┌─────────────────┐      ┌─────────────────────────┐      ┌─────────────────────────┐
│   ROLE: ADMIN   │      │       ROLE: STAFF       │      │     ROLE: CUSTOMER      │
├─────────────────┤      ├─────────────────────────┤      ├─────────────────────────┤
│ • Toàn quyền    │      │ • Duyệt đặt phòng       │      │ • Tìm kiếm khách sạn    │
│ • Quản lý KS    │      │ • Phục vụ dịch vụ phòng │      │ • Đặt phòng online      │
│ • Quản lý Staff │      │ • Đổi trạng thái đơn    │      │ • Xem lịch sử đơn của   │
│ • Xem Audit Log │      │ • Không được xóa KS/User│      │   chính mình            │
└─────────────────┘      └─────────────────────────┘      └─────────────────────────┘
```

---

## 4. TRIỂN KHAI PHÍA BACKEND NESTJS

### 4.1. JwtAuthGuard chuẩn hóa RFC 6750
Được cài đặt tại `backend/src/auth/guards/jwt-auth.guard.ts`:
- Bắt lỗi xác thực từ Passport-JWT.
- Nếu token thiếu, lỗi, hoặc hết hạn $\rightarrow$ Bổ sung header `WWW-Authenticate` theo RFC 6750 và ném `UnauthorizedException` (401).

```typescript
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    if (err || !user) {
      const response = context.switchToHttp().getResponse();
      if (response && typeof response.setHeader === 'function') {
        response.setHeader(
          'WWW-Authenticate',
          'Bearer error="invalid_token", error_description="The access token expired or is invalid"',
        );
      }
      throw err || new UnauthorizedException('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }
    return user;
  }
}
```

### 4.2. RolesGuard kiểm soát quyền hạn chặt chẽ (HTTP 403)
Được cài đặt tại `backend/src/auth/guards/roles.guard.ts`:
- Đọc danh sách role yêu cầu qua `@Roles('ADMIN', 'STAFF')`.
- So sánh với `req.user.role`. Nếu không khớp, ném `ForbiddenException` (**HTTP 403**) với thông báo rõ ràng về quyền hạn bị thiếu.

### 4.3. Bộ Unit Test Xác thực Guards
File `backend/src/auth/guards/auth-guards.spec.ts` kiểm thử toàn diện:
- Trường hợp hợp lệ: Cho phép truy cập.
- Trường hợp không có token: Trả 401 kèm header `WWW-Authenticate`.
- Trường hợp sai role: Trả 403 Forbidden chính xác.

---

## 5. TRIỂN KHAI PHÍA FRONTEND NEXT.JS 16

### 5.1. Tách biệt Ngữ cảnh: AuthContext (Staff) vs CustomerAuthContext (Khách)
Trong ứng dụng Traveleke:
- Quản trị viên và Lễ tân đăng nhập qua `/login`, token lưu trong `traveleke_token`.
- Khách hàng đăng nhập qua `/customer-login`, token lưu trong `traveleke_customer_token`.
- Hai luồng hoàn toàn độc lập, không xảy ra tình trạng Lễ tân đăng xuất làm văng Khách hàng hoặc ngược lại.

### 5.2. Axios Response Interceptor & Điều hướng 401 thông minh
Cài đặt tại `src/services/api/client.ts`:
- Đính kèm header `Authorization: Bearer <token>` tự động cho mọi request gửi sang Backend.
- Khi nhận phản hồi **HTTP 401**:
  - Tự động xóa token lỗi trong LocalStorage.
  - Phân loại: Nếu đang truy cập trang Quản trị (`/bookings`, `/dashboard`, `/hotels`) $\rightarrow$ Điều hướng về `/login`.
  - Nếu đang ở giao diện Khách hàng (`/booking-history`, `/home`) $\rightarrow$ Mở popup thông báo hoặc chuyển về `/customer-login` nhẹ nhàng.

---

## 6. KẾT LUẬN & NGUYÊN TẮC BẢO MẬT BẤT BIẾN

1. **Luôn dùng HTTPS trên Production**: Vì Bearer Token tương đương với chìa khóa vạn năng, không có mã hóa SSL/TLS sẽ khiến hệ thống bị lộ phiên làm việc.
2. **Không lưu trữ Secret Key ở Frontend**: Khóa bí mật (`JWT_SECRET`) chỉ nằm duy nhất trên server NestJS.
3. **Phân biệt rạch ròi 401 và 403**: Giúp Client xử lý UX thông minh – 401 thì gọi refresh token/login lại, 403 thì thông báo không đủ quyền hạn.
