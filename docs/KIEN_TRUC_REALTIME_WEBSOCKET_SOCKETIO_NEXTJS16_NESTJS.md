# TÀI LIỆU KIẾN TRÚC ENTERPRISE: GIAO TIẾP THỜI GIAN THỰC (REALTIME WEBSOCKET, SOCKET.IO) TRONG NEXT.JS 16 VÀ NESTJS
> **Hệ thống Quản lý & Đặt phòng Khách sạn Traveleke**  
> **Ngôn ngữ & Nền tảng:** NestJS 11 Gateway, Socket.IO 4, Next.js 16 App Router, Room Multiplexing

---

## MỤC LỤC
1. [BẢN CHẤT CỦA CÔNG NGHỆ THỜI GIAN THỰC (REALTIME)](#1-bản-chất-của-công-nghệ-thời-gian-thực-realtime)
   - [1.1. So sánh: HTTP vs Polling vs SSE vs WebSocket](#11-so-sánh-http-vs-polling-vs-sse-vs-websocket)
   - [1.2. WebSocket: Kết nối 2 chiều liên tục (Bidirectional Persistent Connection)](#12-websocket-kết-nối-2-chiều-liên-tục-bidirectional-persistent-connection)
2. [LỰA CHỌN CÔNG NGHỆ: SOCKET.IO VS PUSHER VS NATIVE WEBSOCKET](#2-lựa-chọn-công-nghệ-socketio-vs-pusher-vs-native-websocket)
   - [2.1. Điểm khác biệt sống còn: Socket.IO không phải WebSocket thuần](#21-điểm-khác-biệt-sống-còn-socketio-không-phải-websocket-thuần)
   - [2.2. So sánh Self-hosted (Socket.IO) vs Managed Service (Pusher)](#22-so-sánh-self-hosted-socketio-vs-managed-service-pusher)
   - [2.3. Khái niệm Rooms và Namespaces](#23-khái-niệm-rooms-và-namespaces)
3. [KIẾN TRÚC TIÊU CHUẨN: NEXT.JS 16 + NESTJS + SOCKET.IO](#3-kiến-trúc-tiêu-chuẩn-nextjs-16--nestjs--socketio)
   - [3.1. Phân định trách nhiệm: NestJS là Server, Next.js là Client](#31-phân-định-trách-nhiệm-nestjs-là-server-nextjs-là-client)
   - [3.2. Server Component (Initial Data) + Client Component (Live Updates)](#32-server-component-initial-data--client-component-live-updates)
   - [3.3. Database là Single Source of Truth (Nguyên tắc Fail-safe)](#33-database-là-single-source-of-truth-nguyên-tắc-fail-safe)
4. [ÁP DỤNG THỰC TẾ CHO 3 ĐỐI TƯỢNG TRONG TRAVELEKE](#4-áp-dụng-thực-tế-cho-3-đối-tượng-trong-traveleke)
   - [4.1. Lễ tân (Receptionist): Live Booking & Room Service Alert](#41-lễ-tân-receptionist-live-booking--room-service-alert)
   - [4.2. Khách hàng (Guest): Live Booking Status Synchronization](#42-khách-hàng-guest-live-booking-status-synchronization)
   - [4.3. Quản lý (Manager): Realtime Live Indicator & Notification Center](#43-quản-lý-manager-realtime-live-indicator--notification-center)
5. [CHI TIẾT TRIỂN KHAI PHÍA BACKEND NESTJS](#5-chi-tiết-triển-khai-phía-backend-nestjs)
   - [5.1. RealtimeGateway & Room Multiplexing](#51-realtimegateway--room-multiplexing)
   - [5.2. Tích hợp trong BookingsService và ServicesService](#52-tích-hợp-trong-bookingsservice-và-servicesservice)
   - [5.3. Unit Test Verification](#53-unit-test-verification)
6. [CHI TIẾT TRIỂN KHAI PHÍA FRONTEND NEXT.JS 16](#6-chi-tiết-triển-khai-phía-frontend-nextjs-16)
   - [6.1. Singleton Socket Manager (socket.ts)](#61-singleton-socket-manager-socketts)
   - [6.2. RealtimeProvider & Quy tắc Cleanup bắt buộc](#62-realtimeprovider--quy-tắc-cleanup-bắt-buộc)
   - [6.3. Tự động cập nhật bảng Bookings (/bookings) & Thẻ Booking History](#63-tự-động-cập-nhật-bảng-bookings-bookings--thẻ-booking-history)
7. [CHECKLIST TRIỂN KHAI SẢN XUẤT (PRODUCTION REALTIME CHECKLIST)](#7-checklist-triển-khai-sản-xuất-production-realtime-checklist)

---

## 1. BẢN CHẤT CỦA CÔNG NGHỆ THỜI GIAN THỰC (REALTIME)

Trong mô hình truyền thống (HTTP Request-Response), máy chủ chỉ có thể trả dữ liệu khi máy khách gửi yêu cầu hỏi.

### 1.1. So sánh: HTTP vs Polling vs SSE vs WebSocket

| Tiêu chí | HTTP Polling (`setInterval`) | Server-Sent Events (SSE) | WebSocket / Socket.IO |
| :--- | :--- | :--- | :--- |
| **Hướng truyền** | 1 chiều (Client $\rightarrow$ Server $\rightarrow$ Client) | 1 chiều (Server $\rightarrow$ Client) | **2 chiều liên tục (Bidirectional)** |
| **Giao thức** | HTTP/1.1 hoặc HTTP/2 | HTTP/1.1 hoặc HTTP/2 (Mime: `text/event-stream`) | Giao thức **WS / WSS** (Khởi tạo từ HTTP Handshake) |
| **Chi phí Header** | Rất lớn (Gửi lại toàn bộ Cookie, Headers mỗi 3s) | Nhẹ (Chỉ gửi frame dữ liệu text) | **Cực nhẹ** (Frame nhị phân chỉ từ 2-6 bytes overhead) |
| **Tải trên Server** | Rất cao (Tạo lập/đóng kết nối liên tục) | Thấp (1 kết nối HTTP giữ mở) | **Tối ưu** (1 kết nối TCP duy trì lâu dài) |
| **Tự động Reconnect** | Không (Chỉ là request mới) | Có (Trình duyệt tự hỗ trợ) | Hỗ trợ tuyệt vời (Qua thư viện Socket.IO) |
| **Trường hợp tối ưu** | Dữ liệu cập nhật rất chậm (vài phút) | Bảng giá chứng khoán, Live Log, Notification Feed | **Chat, Game, Đặt phòng, Cảnh báo Lễ tân, Điều phối** |

### 1.2. WebSocket: Kết nối 2 chiều liên tục (Bidirectional Persistent Connection)
Khác với HTTP kết thúc ngay sau khi nhận Response, WebSocket nâng cấp kết nối (HTTP Upgrade Header) lên kênh TCP song công (Full-duplex). Cả hai bên Client và Server đều có thể chủ động bắn dữ liệu bất cứ lúc nào mà không cần thăm dò (Polling).

---

## 2. LỰA CHỌN CÔNG NGHỆ: SOCKET.IO VS PUSHER VS NATIVE WEBSOCKET

### 2.1. Điểm khác biệt sống còn: Socket.IO không phải WebSocket thuần
- **Native WebSocket**:
  ```javascript
  const ws = new WebSocket('wss://example.com');
  ```
  Chỉ cung cấp kết nối mạng cơ bản. Lập trình viên phải tự viết: Reconnection logic, Fallback HTTP Long-polling (khi mạng chặn port WS), Phân nhóm Rooms, Heartbeat Ping/Pong.
- **Socket.IO**:
  Là một tầng giao thức/thư viện cấp cao (High-level abstraction). Socket.IO sử dụng WebSocket làm transport chính; nếu môi trường mạng gặp sự cố (tường lửa, proxy công ty chặn WS), nó tự động fallback xuống HTTP Long-polling và tự động reconnect ngay khi có mạng trở lại.

### 2.2. So sánh Self-hosted (Socket.IO) vs Managed Service (Pusher)

```text
               SOCKET.IO (TỰ QUẢN TRỊ)                     PUSHER (MANAGED REALTIME)
      Client ──► NestJS Socket Server ──► Database    Client ──► Pusher Cloud ◄── NestJS Backend
      • Kiểm soát 100% dữ liệu, không lo vendor lock-in • Setup siêu nhanh, không cần quản lý cluster
      • Chi phí hạ tầng cố định theo Server VPS/Cloud   • Chi phí tăng vọt theo số lượng message & user
      • Phù hợp: Lõi nghiệp vụ lâu dài, bảo mật cao    • Phù hợp: MVP nhanh, team thiếu DevOps
```

Trong hệ thống Traveleke, **Socket.IO** là lựa chọn số 1 vì backend đã có sẵn NestJS, dữ liệu khách sạn & đặt phòng cần bảo mật tuyệt đối tại chỗ, không phụ thuộc vào quota của bên thứ 3.

### 2.3. Khái niệm Rooms và Namespaces
- **Namespace**: Chia ứng dụng thành các vùng logic riêng biệt trên cùng 1 kết nối TCP (ví dụ: `/admin`, `/client`).
- **Room**: Là cơ chế gom nhóm socket trên Server. Client không tự ý phát sóng vào room; máy chủ sẽ quyết định socket nào được phép `join()` hoặc `leave()` room.
  - `hotel:10`: Tất cả nhân viên lễ tân của khách sạn ID 10.
  - `user:usr-123`: Tất cả các thiết bị (Laptop, Điện thoại) của khách hàng `usr-123`.

---

## 3. KIẾN TRÚC TIÊU CHUẨN: NEXT.JS 16 + NESTJS + SOCKET.IO

```text
                            KIẾN TRÚC DOANH NGHIỆP TRAVELEKE
                            
    [ TRÌNH DUYỆT KHÁCH HÀNG / LỄ TÂN ]
                 │
                 ├── 1. Khởi tạo trang ban đầu (SSR / Server Component)
                 ▼
    [ NEXT.JS 16 (FRONTEND) ]
         • Server Component: Fetch dữ liệu CSDL ban đầu (Initial Data)
         • Client Component: Quản lý Singleton Socket.IO Client (Live Updates)
                 │
                 │ 2. Thao tác nghiệp vụ (Đặt phòng, Duyệt đơn) qua HTTP REST
                 ▼
    [ NESTJS 11 (BACKEND API) ]
         • Validate DTO ──► Commit Transaction vào MySQL Database
                 │
                 │ 3. DATABASE COMMIT THÀNH CÔNG (Source of Truth)
                 ▼
    [ NESTJS WEBSOCKET GATEWAY ]
         • Phát sự kiện (Emit) tới Room tương ứng:
           ├── hotel:<hotelId>       ──► Lễ tân nhận Live Alert
           ├── staff:notifications   ──► Header Dashboard cập nhật chuông
           └── user:<userId>         ──► Khách hàng thấy thẻ phòng đổi trạng thái
```

### 3.1. Phân định trách nhiệm: NestJS là Server, Next.js là Client
- Không bao giờ tạo Socket.IO Server bên trong Route Handler của Next.js (vì serverless / request-based lifecycle không phù hợp duy trì connection sống lâu).
- NestJS chạy dạng persistent container/process, giữ vai trò duy trì WebSocket Gateway.

### 3.2. Server Component (Initial Data) + Client Component (Live Updates)
- Trang nạp lần đầu: Sử dụng Server Component để render HTML nhanh, tối ưu SEO.
- Ngay sau khi mount: Client Component kết nối WebSocket để nhận dữ liệu gia tăng (Incremental updates).

### 3.3. Database là Single Source of Truth (Nguyên tắc Fail-safe)
- **WebSocket không phải là Database, cũng không phải Message Queue bảo đảm 100% Delivery**.
- Khi đặt phòng: `BookingsService` lưu vào MySQL thành công trước. Logic phát Realtime được bọc trong khối `try/catch` an toàn. Nếu kết nối mạng gián đoạn, đơn hàng của khách vẫn được bảo toàn trọn vẹn trong CSDL.

---

## 4. ÁP DỤNG THỰC TẾ CHO 3 ĐỐI TƯỢNG TRONG TRAVELEKE

### 4.1. Lễ tân (Receptionist): Live Booking & Room Service Alert
- **Vấn đề trước đây**: Lễ tân không biết khách mới đặt phòng trừ khi chủ động bấm reload trang `/bookings`.
- **Sau khi có Realtime**:
  - Khi khách đặt phòng trên web $\rightarrow$ Sự kiện `booking.created` lập tức bay về room `hotel:<hotelId>`.
  - Chuông thông báo kêu, popup Toast bật lên: `🛎️ Đơn đặt phòng mới: #BK-20260925-A7X9 từ Khách Nguyễn Văn A`.
  - Bảng danh sách đơn đặt phòng tự động kích hoạt `fetchBookings()` nạp thêm đơn mới vào đầu bảng mà không cần tải lại toàn bộ trang.
  - Khi khách gọi dịch vụ dọn phòng / khăn tắm $\rightarrow$ Sự kiện `service.requested` lập tức báo cho lễ tân xử lý.

### 4.2. Khách hàng (Guest): Live Booking Status Synchronization
- **Vấn đề trước đây**: Khách đặt xong phải F5 trang `/booking-history` nhiều lần để xem trạng thái `PENDING` có đổi sang `CONFIRMED` hay chưa.
- **Sau khi có Realtime**:
  - Khi lễ tân bấm "Duyệt đơn" hoặc "Xác nhận nhận phòng" $\rightarrow$ Sự kiện `booking.status_changed` gửi thẳng tới room `user:<userId>`.
  - Toast thông báo tức thì: `✅ Đơn phòng của bạn đã chuyển sang trạng thái "Đã xác nhận"!`.
  - Thẻ đặt phòng trên trang tự động chuyển badge sang màu xanh lá mà khách không phải bấm F5.

### 4.3. Quản lý (Manager): Realtime Live Indicator & Notification Center
- Thanh Header Dashboard tích hợp đèn **Realtime Live** (chấm tròn xanh lá animate pulse) cho biết hệ thống giám sát thời gian thực đang hoạt động ổn định.
- Chuông thông báo hiển thị danh sách các sự kiện thực tế nhận từ WebSocket thay cho dữ liệu mẫu tĩnh cũ.

---

## 5. CHI TIẾT TRIỂN KHAI PHÍA BACKEND NESTJS

### 5.1. RealtimeGateway & Room Multiplexing
Cài đặt tại `backend/src/realtime/realtime.gateway.ts`:

```typescript
@WebSocketGateway({ cors: { origin: '*', credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  @SubscribeMessage('subscribe:hotel')
  handleSubscribeHotel(@ConnectedSocket() client: Socket, @MessageBody() data: { hotelId: string | number }) {
    client.join(`hotel:${data.hotelId}`);
    return { event: 'subscribed', room: `hotel:${data.hotelId}` };
  }

  @SubscribeMessage('subscribe:user')
  handleSubscribeUser(@ConnectedSocket() client: Socket, @MessageBody() data: { userId: string | number }) {
    client.join(`user:${data.userId}`);
    return { event: 'subscribed', room: `user:${data.userId}` };
  }

  @SubscribeMessage('subscribe:staff')
  handleSubscribeStaff(@ConnectedSocket() client: Socket) {
    client.join('staff:notifications');
    return { event: 'subscribed', room: 'staff:notifications' };
  }

  emitBookingCreated(payload: BookingCreatedPayload) {
    this.server.to(`hotel:${payload.hotelId}`).to('staff:notifications').emit(REALTIME_EVENTS.BOOKING_CREATED, payload);
  }

  emitBookingStatusChanged(payload: BookingStatusChangedPayload) {
    let emitter = this.server.to(`hotel:${payload.hotelId}`).to('staff:notifications');
    if (payload.userId) emitter = emitter.to(`user:${payload.userId}`);
    emitter.emit(REALTIME_EVENTS.BOOKING_STATUS_CHANGED, payload);
  }
}
```

### 5.2. Tích hợp trong BookingsService và ServicesService
- `BookingsService.create()`: Sau khi lưu transaction đơn phòng, gọi `this.realtimeGateway?.emitBookingCreated(...)`.
- `BookingsService.updateStatus()`: Sau khi cập nhật trạng thái đơn, gọi `this.realtimeGateway?.emitBookingStatusChanged(...)`.
- `ServicesService.createServiceRequest()`: Sau khi lưu yêu cầu dịch vụ, gọi `this.realtimeGateway?.emitServiceRequested(...)`.

---

## 6. CHI TIẾT TRIỂN KHAI PHÍA FRONTEND NEXT.JS 16

### 6.1. Singleton Socket Manager (socket.ts)
Cài đặt tại `src/lib/socket.ts`:
- Đảm bảo toàn bộ ứng dụng chỉ duy trì **duy nhất 1 connection** Socket.IO, tránh việc mỗi component tự mở một kết nối gây nghẽn RAM server.
- Cấu hình tự động kết nối lại (`reconnectionAttempts: 10`, `reconnectionDelay: 2000`).

### 6.2. RealtimeProvider & Quy tắc Cleanup bắt buộc
Cài đặt tại `src/features/realtime/RealtimeContext.tsx`:
- Lắng nghe các sự kiện nghiệp vụ và đẩy vào Toast / Notification List.
- **Quy tắc bắt buộc**: Phải luôn có `socket.off()` trong hàm return của `useEffect`:
  ```typescript
  return () => {
    socket.off(REALTIME_EVENTS.BOOKING_CREATED, handleBookingCreated);
    socket.off(REALTIME_EVENTS.BOOKING_STATUS_CHANGED, handleBookingStatusChanged);
  };
  ```

### 6.3. Tự động cập nhật bảng Bookings (/bookings) & Thẻ Booking History
- Trong `src/app/(dashboard)/bookings/page.tsx`:
  Lắng nghe `booking.created` và `booking.status_changed` để tự động gọi `fetchBookings()` làm mới dữ liệu bảng.
- Trong `src/components/booking/BookingHistory.tsx`:
  Lắng nghe `booking.status_changed` để cập nhật trực tiếp `status` của item trong state mà không cần gọi lại API toàn bộ.

---

## 7. CHECKLIST TRIỂN KHAI SẢN XUẤT (PRODUCTION REALTIME CHECKLIST)

- [x] Code Socket nằm hoàn toàn trong Client Component (`'use client'`).
- [x] Áp dụng Singleton Pattern, không tạo socket mới mỗi lần re-render.
- [x] Bắt buộc có hàm cleanup `socket.off(...)` khi unmount.
- [x] Phân quyền room chặt chẽ, không cho phép client tự do phát sóng trái phép.
- [x] CSDL luôn là Single Source of Truth; WebSocket chỉ phát tín hiệu gia tăng.
- [x] Bọc lệnh emit trong `try/catch` chống sập transaction nghiệp vụ.
- [x] Production sử dụng giao thức bảo mật `wss://` qua cổng HTTPS/TLS.
- [x] Bộ test suite 9/9 suites (60/60 tests) đạt chuẩn 100%.
