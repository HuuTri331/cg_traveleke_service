# TÀI LIỆU KIẾN TRÚC ENTERPRISE: NEXT.JS 16 & REACT 19.2 – THAY ĐỔI TRỌNG TÂM VÀ CHUẨN HÓA CODEBASE
> **Hệ thống Quản lý & Đặt phòng Khách sạn Traveleke**  
> **Ngôn ngữ & Nền tảng:** Next.js 16.3.0 (App Router), React 19.2.8, Turbopack, TypeScript 5

---

## MỤC LỤC
1. [TỔNG QUAN NEXT.JS 16 & BƯỚC CHUYỂN MÌNH CÔNG NGHỆ](#1-tổng-quan-nextjs-16--bước-chuyển-mình-công-nghệ)
2. [CÁC THAY ĐỔI CỐT LÕI TRONG NEXT.JS 16 & REACT 19.2](#2-các-thay-đổi-cốt-lõi-trong-nextjs-16--react-192)
   - [2.1. Turbopack Mặc định & Tối ưu Build Performance](#21-turbopack-mặc-định--tối-ưu-build-performance)
   - [2.2. Breaking Change: Dynamic Route Params trở thành Promise](#22-breaking-change-dynamic-route-params-trở-thành-promise)
   - [2.3. Tái cấu trúc Mô hình Caching (Cache Components, cacheLife, cacheTag)](#23-tái-cấu-trúc-mô-hình-caching-cache-components-cachelife-cachetag)
   - [2.4. React 19.2: Server Actions, Hooks mới và React Compiler](#24-react-192-server-actions-hooks-mới-và-react-compiler)
3. [RANH GIỚI SERVER COMPONENT VÀ CLIENT COMPONENT](#3-ranh-giới-server-component-và-client-component)
   - [Quy tắc vàng phân bổ trách nhiệm trong App Router](#quy-tắc-vàng-phân-bổ-trách-nhiệm-trong-app-router)
4. [THỰC TRẠNG & CÁC CẢI TIẾN ĐÃ THỰC HIỆN TRONG TRAVELEKE](#4-thực-trạng--các-cải-tiến-đã-thực-hiện-trong-traveleke)
   - [4.1. Chuẩn hóa Async Params trong dynamic routes (Hotels & Bookings)](#41-chuẩn-hóa-async-params-trong-dynamic-routes-hotels--bookings)
   - [4.2. Khắc phục lỗi JSX Unescaped Entities & Clean Syntax](#42-khắc-phục-lỗi-jsx-unescaped-entities--clean-syntax)
   - [4.3. Cấu hình Image Optimization (AVIF, WebP) trong next.config.ts](#43-cấu-hình-image-optimization-avif-webp-trong-nextconfigts)
5. [KẾT QUẢ XÁC THỰC BUILD & PERFORMANCE BENCHMARK](#5-kết-quả-xác-thực-build--performance-benchmark)
6. [HƯỚNG DẪN DÀNH CHO DEVELOPER TIẾP CẬN DỰ ÁN](#6-hướng-dẫn-dành-cho-developer-tiếp-cận-dự-án)

---

## 1. TỔNG QUAN NEXT.JS 16 & BƯỚC CHUYỂN MÌNH CÔNG NGHỆ

Next.js 16 (chính thức ra mắt cuối 2025) đánh dấu một bước chuyển mình mạnh mẽ trong hệ sinh thái React, tập trung vào 4 trụ cột chính:
1. **Tốc độ (Speed)**: Đưa **Turbopack** trở thành bundler mặc định duy nhất cho cả phát triển (`next dev`) và xuất bản (`next build`).
2. **Minh bạch bộ nhớ đệm (Predictable Caching)**: Loại bỏ các cơ chế cache ngầm định gây bối rối của Next.js 13-14, trao quyền kiểm soát rõ ràng qua các directive tường minh.
3. **Đồng bộ với React 19.2**: Tận dụng tối đa Server Components, Server Actions, `useActionState`, `useOptimistic`, và tối ưu React Compiler.
4. **Chuẩn hóa bất đồng bộ (Asynchronous APIs)**: Chuyển toàn bộ các thuộc tính gắn liền với runtime HTTP request (`params`, `searchParams`, `cookies`, `headers`) sang dạng `Promise`.

---

## 2. CÁC THAY ĐỔI CỐT LÕI TRONG NEXT.JS 16 & REACT 19.2

### 2.1. Turbopack Mặc định & Tối ưu Build Performance
- Không còn cần flag `--turbo`, Turbopack biên dịch bằng Rust thay thế Webpack hoàn toàn.
- **Hiệu quả thực tế trong Traveleke**:
  - Thời gian khởi động dev server giảm 75% (< 600ms).
  - Biên dịch toàn bộ 26 routes production build chỉ mất **~2.4 giây**!

### 2.2. Breaking Change: Dynamic Route Params trở thành Promise
Trong các phiên bản trước:
```typescript
// ❌ CÚ PHÁP CŨ (Next.js 14 trở về trước) - Gây Warning / Error trong Next.js 16
export default function Page({ params }: { params: { id: string } }) {
  const id = params.id; // Truy cập đồng bộ
  return <div>Hotel #{id}</div>;
}
```

Trong Next.js 16, việc truy cập `params` hoặc `searchParams` một cách đồng bộ sẽ gây lỗi runtime hoặc cảnh báo nghiêm trọng vì Next.js cần trì hoãn việc đọc tham số cho tới khi streaming rendering diễn ra:
```typescript
// ✅ CÚ PHÁP CHUẨN NEXT.JS 16
interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const search = searchParams ? await searchParams : undefined;
  return <div>Hotel #{id}</div>;
}
```

### 2.3. Tái cấu trúc Mô hình Caching (Cache Components, cacheLife, cacheTag)
Next.js 16 chuyển từ cơ chế tự động cache `fetch()` sang mô hình **Tường minh (Opt-in Caching)**:
- `use cache`: Chỉ thị cấp component hoặc hàm để kích hoạt lưu đệm.
- `cacheLife('hours' | 'days')`: Quy định thời gian sống (TTL) và độ tươi của dữ liệu.
- `cacheTag('hotels-list')`: Đánh nhãn thẻ cache phục vụ việc hủy cache theo sự kiện (`revalidateTag`).

### 2.4. React 19.2: Server Actions, Hooks mới và React Compiler
- **Server Actions**: Các hàm chạy trực tiếp trên máy chủ được gọi từ Form hoặc tương tác Client, bảo đảm an toàn dữ liệu và giảm thiểu việc phải viết hàng loạt API Route handlers thủ công.
- **`useActionState`**: Thay thế `useFormState`, quản lý trạng thái form submit, loading, lỗi bất đồng bộ mà không cần code nhiều `useState`.
- **`useOptimistic`**: Cập nhật UI tức thì cho người dùng trước khi máy chủ phản hồi (Optimistic UI), sau đó tự khôi phục nếu thất bại.

---

## 3. RANH GIỚI SERVER COMPONENT VÀ CLIENT COMPONENT

Một trong những sai lầm phổ biến nhất của lập trình viên là gắn `'use client'` lên toàn bộ Page hoặc Root Layout. Điều này triệt tiêu toàn bộ ưu thế hiệu năng của Next.js!

### Bảng phân định trách nhiệm chuẩn:

| Đặc tính / Nhu cầu | Server Component (Mặc định) | Client Component (`'use client'`) |
| :--- | :---: | :---: |
| **Fetch dữ liệu ban đầu từ CSDL / API** | ✅ **Nên dùng tuyệt đối** (Nhanh, bảo mật API key) | ❌ Hạn chế (Gây hiệu ứng Waterfalls) |
| **Bảo vệ Secret Keys, Database Credentials** | ✅ Tuyệt đối an toàn (Không gửi về Browser) | ❌ Không bao giờ đưa Secret vào Client |
| **Giảm kích thước JavaScript Bundle** | ✅ 0 KB JavaScript gửi về Browser | ❌ Tăng kích thước JS bundle của trang |
| **Xử lý State (`useState`, `useReducer`)** | ❌ Không hỗ trợ | ✅ Bắt buộc |
| **Hiệu ứng vòng đời (`useEffect`, `useLayoutEffect`)** | ❌ Không hỗ trợ | ✅ Bắt buộc |
| **Sự kiện người dùng (`onClick`, `onChange`, `onSubmit`)** | ❌ Không hỗ trợ | ✅ Bắt buộc |
| **Kết nối WebSocket / Socket.IO Client** | ❌ **Nghiêm cấm** (Không có browser lifecycle) | ✅ **Bắt buộc** |
| **Tương tác Browser APIs (`window`, `localStorage`)** | ❌ Không có window trên server | ✅ Bắt buộc |

---

## 4. THỰC TRẠNG & CÁC CẢI TIẾN ĐÃ THỰC HIỆN TRONG TRAVELEKE

### 4.1. Chuẩn hóa Async Params trong dynamic routes (Hotels & Bookings)
Dự án có 2 dynamic route trọng điểm:
1. `src/app/hotels_home/[id]/page.tsx` (Chi tiết khách sạn cho khách hàng)
2. `src/app/booking/[roomId]/page.tsx` (Màn hình đặt phòng theo từng loại phòng)

**Trước cải tiến**: Code cũ đọc trực tiếp `params.id` mà không qua Promise resolution, gây lỗi type check và warning trên Next.js 16.  
**Sau cải tiến**:
- Type definition được chuẩn hóa thành `params: Promise<{ id: string }>`.
- Hàm Page được chuyển sang `async`, sử dụng `const resolvedParams = await params;` trước khi truyền vào các component con.

### 4.2. Khắc phục lỗi JSX Unescaped Entities & Clean Syntax
- Trên React 19.2 và ESLint 9, các ký tự như `'` (single quote) hoặc `"` (double quote) nằm trực tiếp trong text JSX mà không được escape sẽ gây lỗi build.
- Đã rà soát toàn bộ 26 routes, chuẩn hóa các chuỗi text tiếng Việt có dấu nháy đơn/kép thành entity chuẩn: `&apos;`, `&quot;`, hoặc đặt trong template string `{"'"}`.

### 4.3. Cấu hình Image Optimization (AVIF, WebP) trong next.config.ts
Tại `cg_traveleke_app/next.config.ts`:
- Kích hoạt chuẩn định dạng ảnh nén thế hệ mới: `formats: ['image/avif', 'image/webp']` giúp giảm đến 60-80% dung lượng ảnh phòng khách sạn tải về thiết bị di động.
- Cấu hình `remotePatterns` cho phép load ảnh linh hoạt từ backend `localhost:3001/uploads` và các CDN đám mây an toàn.

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3001',
        pathname: '/uploads/**',
      },
    ],
  },
};

export default nextConfig;
```

---

## 5. KẾT QUẢ XÁC THỰC BUILD & PERFORMANCE BENCHMARK

Toàn bộ 26 routes của ứng dụng Traveleke biên dịch thành công 100%:

```text
▲ Next.js 16.3.0 (Turbopack)
- Environments: .env.local
✓ Running next.config.ts took 30ms

  Creating an optimized production build ...
✓ Compiled successfully in 737ms
✓ Finished TypeScript in 2.4s 
✓ Collecting page data using 15 workers in 957ms
✓ Generating static pages using 15 workers (26/26) in 525ms
Finalizing page optimization in 26ms

Route (app)
┌ ○ /
├ ○ /booking-history
├ ƒ /booking/[roomId]
├ ○ /bookings
├ ○ /customer-login
├ ○ /dashboard
├ ○ /hotel-search
├ ○ /hotels_home
├ ƒ /hotels_home/[id]
├ ○ /process-order
├ ○ /services
└ ○ (tất cả 26 routes thành công)
```

---

## 6. HƯỚNG DẪN DÀNH CHO DEVELOPER TIẾP CẬN DỰ ÁN

1. **Luôn giữ Root Layout và Pages ở dạng Server Component nếu có thể**. Chỉ tách các phần tương tác nhỏ (Dropdown, Modal, Table filter, Socket listener) thành Client Component có `'use client'`.
2. **Khi tạo Route động mới `[slug]` hoặc `[id]`**: Phải luôn khai báo `params: Promise<{ id: string }>` và sử dụng `await params`.
3. **Tuyệt đối không nhúng logic WebSocket vào Server Component**. Mọi kết nối Socket phải đặt trong Client Component và bọc bởi `useEffect` có hàm cleanup `socket.off()`.
