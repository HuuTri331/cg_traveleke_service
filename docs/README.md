# TỦ SÁCH TÀI LIỆU KIẾN TRÚC ENTERPRISE – HỆ THỐNG TRAVELEKE
> **Tổng hợp toàn bộ kiến thức cốt lõi, cẩm nang kiến trúc và giải pháp tối ưu hóa chuyên sâu đã được phân tích và áp dụng vào dự án Traveleke (`cg_traveleke_service` & `cg_traveleke_app`).**

---

## 📌 DANH MỤC CÁC CHUYÊN ĐỀ KIẾN TRÚC (ARCHITECTURAL DOCUMENTS)

| STT | Chuyên đề kiến trúc | File tài liệu chi tiết | Trọng tâm công nghệ & Ứng dụng thực tế |
| :---: | :--- | :--- | :--- |
| **1** | **Định danh duy nhất & Business Code** | [`KIEN_TRUC_IDENTIFIERS_UUID_V7_VA_BUSINESS_CODE.md`](./KIEN_TRUC_IDENTIFIERS_UUID_V7_VA_BUSINESS_CODE.md) | • Chuẩn RFC 9562 UUID v7 (Time-ordered 128-bit) chống phân mảnh B-Tree.<br>• Phân định 3 loại ID: Database Key vs Tracing ID vs Business Code (`BK-YYYYMMDD-XXXX`).<br>• Triển khai `IdGeneratorService` & `IdModule`. |
| **2** | **Next.js 16 & React 19.2 Enterprise** | [`KIEN_TRUC_NEXTJS_16_VA_REACT_19_ENTERPRISE.md`](./KIEN_TRUC_NEXTJS_16_VA_REACT_19_ENTERPRISE.md) | • Turbopack mặc định siêu tốc (~2.4s build 26 routes).<br>• Xử lý Breaking Change: `params: Promise<{ id: string }>` dạng bất đồng bộ.<br>• Tối ưu nén ảnh AVIF/WebP, Server vs Client Component boundaries. |
| **3** | **Authorization Bearer Token & RBAC** | [`KIEN_TRUC_BEARER_TOKEN_AUTHENTICATION_VA_RBAC.md`](./KIEN_TRUC_BEARER_TOKEN_AUTHENTICATION_VA_RBAC.md) | • Chuẩn IETF RFC 6750 Bearer Scheme & Cấu trúc JWT.<br>• Phân định rạch ròi HTTP 401 Unauthorized vs 403 Forbidden.<br>• Chuẩn hóa header `WWW-Authenticate`, `JwtAuthGuard`, `RolesGuard`. |
| **4** | **Global State Management** | [`KIEN_TRUC_GLOBAL_STATE_MANAGEMENT_REACT_NEXTJS16.md`](./KIEN_TRUC_GLOBAL_STATE_MANAGEMENT_REACT_NEXTJS16.md) | • Phân loại 4 tầng State; Triệt tiêu cạm bẫy Re-render Cascade trong Context API.<br>• Memoization toàn diện `useMemo`/`useCallback` cho Toast, Auth, CustomerAuth.<br>• Layout State Persistence qua chuyển trang App Router. |
| **5** | **Realtime WebSocket & Socket.IO** | [`KIEN_TRUC_REALTIME_WEBSOCKET_SOCKETIO_NEXTJS16_NESTJS.md`](./KIEN_TRUC_REALTIME_WEBSOCKET_SOCKETIO_NEXTJS16_NESTJS.md) | • NestJS Realtime Gateway (`@WebSocketGateway()`) + Socket.IO.<br>• Next.js 16 Singleton Socket client, cleanup vòng đời `socket.off()`.<br>• Room Multiplexing phục vụ Lễ tân (`/bookings`), Khách hàng (`/booking-history`) và Quản lý. |
| **6** | **Tối ưu hóa Phân trang (Pagination)** | [`TOI_UU_PAGINATION_ENTERPRISE_NESTJS_TYPEORM.md`](./TOI_UU_PAGINATION_ENTERPRISE_NESTJS_TYPEORM.md) | • Khắc phục lỗi crash `offset < 0`, chống DoS `limit = 500,000`.<br>• Đẩy điều kiện lọc xuống Index MySQL, triệt tiêu JavaScript memory filtering.<br>• Module `backend/src/common/pagination/` chuẩn hóa metadata API. |
| **7** | **Enterprise Logging & Distributed Tracing** | [`KIEN_TRUC_ENTERPRISE_OPENTELEMETRY_LOGGING_TRACING.md`](./KIEN_TRUC_ENTERPRISE_OPENTELEMETRY_LOGGING_TRACING.md) | • Tích hợp OpenTelemetry (OTel) SDK tự động trace mọi HTTP & MySQL call.<br>• Correlation ID (`trace_id`, `span_id`) gán vào Winston Structured Logger.<br>• Xuất dữ liệu qua chuẩn OTLP/HTTP về Elastic Stack / Jaeger / Grafana. |
| **8** | **Audit Logging Engine & Rate Limiting** | [`KIEN_TRUC_ENTERPRISE_AUDIT_LOG_VA_RATE_LIMITING.md`](./KIEN_TRUC_ENTERPRISE_AUDIT_LOG_VA_RATE_LIMITING.md) | • AsyncLocalStorage lưu vết User Context xuyên suốt request pipeline.<br>• TypeORM Entity Subscriber tự động ghi nhận biến động dữ liệu (Diff Engine).<br>• Rate Limiting đa tầng bằng Redis Lua Script (Sliding Window Log & Token Bucket). |
| **9** | **Tối ưu DB Transaction & Xử lý Deadlock** | [`KIEN_TRUC_DATABASE_TRANSACTION_DEADLOCK_VA_QUEUE_CONCURRENCY.md`](./KIEN_TRUC_DATABASE_TRANSACTION_DEADLOCK_VA_QUEUE_CONCURRENCY.md) | • Khắc phục triệt để Deadlock (MySQL Error 1213) & Lock Wait Timeout (1205).<br>• Atomic Conditional Room Update (`UPDATE ... WHERE available_rooms >= :qty`) chống Overbooking.<br>• Transaction Retry Helper với Exponential Backoff + Jitter & Redis Distributed Lock. |

---


## 🏗️ MÔ HÌNH KIẾN TRÚC TỔNG THỂ HỆ THỐNG TRAVELEKE

```text
                                  CLIENT BROWSERS
               ┌─────────────────────────┴─────────────────────────┐
               ▼                                                   ▼
     [ GIAO DIỆN KHÁCH HÀNG ]                             [ DASHBOARD LỄ TÂN / QUẢN LÝ ]
     (Next.js 16 Client Component)                        (Next.js 16 Client Component)
               │                                                   │
               │ HTTP REST Requests (Axios + Bearer Token)         │
               ▼                                                   ▼
     ══════════════════════════════════════════════════════════════════════════════════════
                                    NESTJS 11 BACKEND API
     ══════════════════════════════════════════════════════════════════════════════════════
       [ LỚP 1: BẢO VỆ MẠNG ]        ► Rate Limiter Đa Tầng (Redis Sliding Window Log + Token Bucket)
       [ LỚP 2: ĐỊNH DANH ]          ► JwtAuthGuard (RFC 6750) + AsyncLocalStorage User Context
       [ LỚP 3: PHÂN QUYỀN ]         ► RolesGuard (ADMIN, STAFF, CUSTOMER) (HTTP 403 Forbidden)
       [ LỚP 4: GIÁM SÁT TOÀN DIỆN ] ► OpenTelemetry Tracing + Winston Structured Logging (OTLP)
       [ LỚP 5: NGHIỆP VỤ LÕI ]      ► Bookings, Hotels, Rooms, HotelStaff, Services
       [ LỚP 6: PHÂN TRANG CHUẨN ]   ► normalizePagination() + buildPaginationMeta()
       [ LỚP 7: KIỂM TOÁN TỰ ĐỘNG ]  ► TypeORM AuditSubscriber (Ghi vết Diff CSDL tự động)
       [ LỚP 8: REALTIME GATEWAY ]   ► RealtimeGateway (Socket.IO Room Multiplexing: hotel, user, staff)
     ══════════════════════════════════════════════════════════════════════════════════════
               │                                                   │
               ▼                                                   ▼
     [ MYSQL 8 DATABASE (InnoDB) ]                        [ REDIS DISTRIBUTED CACHE ]
     • Clustered Index B+Tree                             • Rate Limit Counters & Lua Scripts
     • UUID v7 & Business Codes                           • Token Blacklist & Session Store
```

---

## 🎯 GIÁ TRỊ MANG LẠI CHO CÁC BÊN THAM GIA

1. **Khách hàng (Hotel Guest)**:
   - Trải nghiệm mượt mà, tốc độ nạp trang siêu tốc nhờ Next.js 16 và ảnh nén AVIF/WebP.
   - Thẻ đặt phòng trên `/booking-history` tự động nhảy trạng thái khi Lễ tân duyệt, không phải F5.
   - Mã đặt phòng `BK-YYYYMMDD-XXXX` ngắn gọn, lịch sự, dễ đọc qua điện thoại.
2. **Nhân viên Lễ tân (Receptionist)**:
   - Không bỏ lỡ bất kỳ đơn đặt phòng hay yêu cầu dịch vụ nào nhờ chuông báo Realtime và bảng `/bookings` tự động nạp đơn mới.
   - Phân công công việc minh bạch, tự động và rõ ràng.
3. **Chủ khách sạn & Quản trị viên (Hotel Manager / Admin)**:
   - Bảng Dashboard Header tích hợp đèn **Realtime Live** và chuông thông báo trực tiếp.
   - Kiểm soát gian lận tuyệt đối với **Audit Log Engine** (biết ai đổi giá phòng, ai duyệt đơn, đổi từ giá bao nhiêu sang bao nhiêu).
   - Bảo vệ hệ thống khỏi tấn công DDoS và scraping với **Rate Limiting Đa Tầng Redis**.
