cấu trúc chuẩn backend
backend/src/
│
├── auth/
├── users/
├── locations/
├── hotel-types/
├── hotels/
├── hotel-staff/
├── trip-plans/
├── bookings/
│
├── common/
├── health/
│
├── app.module.ts
└── main.ts


cấu trúc 1 backend module
hotels/
│
├── dto/
│   ├── create-hotel.dto.ts
│   ├── update-hotel.dto.ts
│   └── query-hotel.dto.ts
│
├── entities/
│   └── hotel.entity.ts
│
├── hotels.controller.ts
├── hotels.service.ts
└── hotels.module.ts

dto/

Kiểm soát dữ liệu đi vào API


controller Nhận HTTP request.
GET    /api/hotels
POST   /api/hotels
PATCH  /api/hotels/:id

service Đây mới là nơi xử lý nghiệp vụ.
kiểm tra hotel tồn tại
kiểm tra user
kiểm tra trạng thái
tính toán
thay đổi booking
ghi status log

Repository TypeORM cung cấp: Nó chịu trách nhiệm giao tiếp với database.
Repository<User>
Repository<Hotel>
Repository<Booking>

tổng quan luồng đi
Controller
    ↓
Service
    ↓
Repository
    ↓
Entity
    ↓
MySQL


<!-- Quy tắc module gọi nhau -->
không làm 
BookingsService
→ tự query bảng hotels
→ copy logic HotelsService
mà nên làm 
HotelsModule
    │
    └── exports HotelsService
              ↓
        BookingsModule
              ↓
        imports HotelsModule
              ↓
        BookingsService
        inject HotelsService

Quy tắc:

UsersModule sở hữu user.

HotelsModule sở hữu hotel.

BookingsModule sở hữu booking.

Không module nào tự tiện giành nghiệp vụ của module khác.

common/ Chỉ chứa thứ thật sự dùng chung nhiều module.

common/
├── decorators/
├── enums/
├── filters/
├── guards/
├── interceptors/
├── pipes/
└── utils/
Quy tắc quan trọng

Không tạo đầy folder rỗng ngay bây giờ.

Khi một logic được ít nhất 2 module dùng chung thì mới xem xét đưa vào common.

AuthModule Sau Dashboard skeleton chúng ta sẽ cần Auth.
login
password hashing
JWT
current user
role
authorization

luồng đi
Login
  ↓
AuthController
  ↓
AuthService
  ↓
UsersService
  ↓
password verify
  ↓
JWT
sau khi login xong
Frontend
   ↓ token/session
Backend
   ↓
Auth Guard
   ↓
Roles Guard
   ↓
Controller

ADMIN
├── Dashboard
├── Users
├── Hotels
├── Staff
├── Bookings
└── Reports

MANAGER
├── Dashboard
├── Hotel
├── Rooms
├── Staff
├── Bookings
└── Schedules

EMPLOYEE / RECEPTIONIST
├── Dashboard
├── Bookings
├── Rooms
├── Check-in/out
└── Schedule


**Lưu ý khi xoá sạch dữ liệu trong database rồi thì khi đó muốn chạy lại thì đầu tiên
vào trong source backend thực hiện các bước
npm install (Nếu đã có node_modules rồi thì bỏ qua)
npm run seed (để tạo dữ liệu mặc định cho 1 số các fields các bảng)
rồi khi đó cuối cùng mới 
npm run start:dev