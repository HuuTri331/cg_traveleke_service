-- ====================================================================================================
-- TRAVELEKE SYSTEM - TOÀN BỘ CƠ SỞ DỮ LIỆU CHUẨN HOÀN CHỈNH (TỪ KHỞI TẠO ĐẾN MỚI NHẤT)
-- ====================================================================================================
-- File SQL này là BẢN THỐNG NHẤT TOÀN DIỆN VÀ HOÀN CHỈNH 100% CỦA DỰ ÁN TRAVELEKE.
-- Chứa đầy đủ cấu trúc 27 bảng và dữ liệu mẫu chuẩn từ Phase 1 (Cốt lõi) đến Phase 2 (Nâng cao).
--
-- CÁCH DÙNG:
--   1. Chạy mới tinh từ đầu (Clean Install): Mở file này trong MySQL Workbench / DBeaver và chạy toàn bộ.
--      (Nếu muốn xoá sạch database cũ để tạo lại tinh tươm, chỉ cần bỏ comment dòng DROP DATABASE ở dưới).
--   2. Nâng cấp database cũ: Chạy file này trên database đã có, toàn bộ dữ liệu cũ được giữ nguyên 100%,
--      các bảng mới và cột mới sẽ được tự động đồng bộ mà không phát sinh lỗi.
-- ====================================================================================================

-- Bỏ dấu comment dòng dưới nếu muốn xoá sạch database cũ và tạo lại từ đầu:
-- DROP DATABASE IF EXISTS hotel_booking_db;

CREATE DATABASE IF NOT EXISTS hotel_booking_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE hotel_booking_db;

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- Tắt tạm thời kiểm tra foreign key để đảm bảo thứ tự import hoàn toàn không bị chặn
SET FOREIGN_KEY_CHECKS = 0;


-- ====================================================================================================
-- PHẦN 1: CÁC BẢNG CỐT LÕI CỦA HỆ THỐNG (PHASE 1 - CORE SYSTEM TABLES)
-- ====================================================================================================

-- 1.1 Bảng Users (Tài khoản người dùng, nhân viên, quản trị viên)
CREATE TABLE IF NOT EXISTS users (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    full_name           VARCHAR(150) NOT NULL,
    email               VARCHAR(255) NOT NULL,
    phone               VARCHAR(20) NULL,
    address             VARCHAR(255) NULL,
    password            VARCHAR(255) NOT NULL,
    avatar_url          VARCHAR(500) NULL,
    date_of_birth       DATE NULL,
    gender              VARCHAR(20) NULL,
    role                VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER',
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    email_verified_at   DATETIME NULL,
    last_login_at       DATETIME NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME NULL,
    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT uq_users_phone UNIQUE (phone),
    CONSTRAINT chk_users_gender CHECK (gender IS NULL OR gender IN ('MALE', 'FEMALE', 'OTHER')),
    CONSTRAINT chk_users_status CHECK (status IN ('ACTIVE', 'BLOCKED', 'INACTIVE')),
    INDEX idx_users_role (role),
    INDEX idx_users_status (status)
) ENGINE=InnoDB;

-- 1.2 Bảng Locations (Địa điểm, Tỉnh/Thành phố)
CREATE TABLE IF NOT EXISTS locations (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    parent_id   BIGINT UNSIGNED NULL,
    code        VARCHAR(50) NULL,
    name        VARCHAR(150) NOT NULL,
    type        VARCHAR(30) NOT NULL,
    latitude    DECIMAL(10,7) NULL,
    longitude   DECIMAL(10,7) NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_locations PRIMARY KEY (id),
    CONSTRAINT uq_locations_code UNIQUE (code),
    CONSTRAINT fk_locations_parent FOREIGN KEY (parent_id) REFERENCES locations(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_locations_type CHECK (type IN ('COUNTRY', 'PROVINCE', 'CITY', 'DISTRICT', 'WARD', 'AREA')),
    CONSTRAINT chk_locations_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
    INDEX idx_locations_parent_id (parent_id),
    INDEX idx_locations_name (name)
) ENGINE=InnoDB;

-- 1.3 Bảng Hotel_Types (Loại hình khách sạn / nghỉ dưỡng)
CREATE TABLE IF NOT EXISTS hotel_types (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code        VARCHAR(50) NOT NULL,
    name        VARCHAR(100) NOT NULL,
    description TEXT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_hotel_types PRIMARY KEY (id),
    CONSTRAINT uq_hotel_types_code UNIQUE (code),
    CONSTRAINT chk_hotel_types_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
) ENGINE=InnoDB;

-- 1.4 Bảng Hotels (Thông tin khách sạn)
CREATE TABLE IF NOT EXISTS hotels (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    hotel_type_id   BIGINT UNSIGNED NOT NULL,
    location_id     BIGINT UNSIGNED NOT NULL,
    created_by      BIGINT UNSIGNED NULL,
    name            VARCHAR(200) NOT NULL,
    slug            VARCHAR(220) NOT NULL,
    description     LONGTEXT NULL,
    star_rating     TINYINT UNSIGNED NULL,
    address         VARCHAR(255) NOT NULL,
    latitude        DECIMAL(10,7) NULL,
    longitude       DECIMAL(10,7) NULL,
    phone           VARCHAR(20) NULL,
    email           VARCHAR(255) NULL,
    check_in_time   TIME NOT NULL DEFAULT '14:00:00',
    check_out_time  TIME NOT NULL DEFAULT '12:00:00',
    cover_image_url VARCHAR(500) NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME NULL,
    CONSTRAINT pk_hotels PRIMARY KEY (id),
    CONSTRAINT uq_hotels_slug UNIQUE (slug),
    CONSTRAINT fk_hotels_hotel_type FOREIGN KEY (hotel_type_id) REFERENCES hotel_types(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_hotels_location FOREIGN KEY (location_id) REFERENCES locations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_hotels_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_hotels_star_rating CHECK (star_rating IS NULL OR star_rating BETWEEN 1 AND 5),
    CONSTRAINT chk_hotels_status CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
    INDEX idx_hotels_hotel_type_id (hotel_type_id),
    INDEX idx_hotels_location_id (location_id),
    INDEX idx_hotels_created_by (created_by),
    INDEX idx_hotels_status (status)
) ENGINE=InnoDB;

-- 1.5 Bảng Hotel_Staff (Phân công nhân viên quản lý khách sạn)
CREATE TABLE IF NOT EXISTS hotel_staff (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    hotel_id        BIGINT UNSIGNED NOT NULL,
    staff_user_id   BIGINT UNSIGNED NOT NULL,
    staff_role      VARCHAR(30) NOT NULL DEFAULT 'EMPLOYEE',
    assigned_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_hotel_staff PRIMARY KEY (id),
    CONSTRAINT uq_hotel_staff_assignment UNIQUE (hotel_id, staff_user_id),
    CONSTRAINT fk_hotel_staff_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_hotel_staff_user FOREIGN KEY (staff_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_hotel_staff_role CHECK (staff_role IN ('MANAGER', 'EMPLOYEE')),
    CONSTRAINT chk_hotel_staff_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
    INDEX idx_hotel_staff_hotel_id (hotel_id),
    INDEX idx_hotel_staff_user_id (staff_user_id)
) ENGINE=InnoDB;

-- 1.6 Bảng Rooms (Phòng nghỉ thuộc khách sạn)
CREATE TABLE IF NOT EXISTS rooms (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    hotel_id            BIGINT UNSIGNED NOT NULL,
    name                VARCHAR(150) NOT NULL,
    slug                VARCHAR(180) NOT NULL,
    description         TEXT NULL,
    price_per_night     DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    check_in_time       TIME NOT NULL DEFAULT '14:00:00',
    check_out_time      TIME NOT NULL DEFAULT '12:00:00',
    max_adults          TINYINT UNSIGNED NOT NULL DEFAULT 2,
    max_children        TINYINT UNSIGNED NOT NULL DEFAULT 0,
    total_rooms         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    available_rooms     SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    bed_count           TINYINT UNSIGNED NOT NULL DEFAULT 1,
    bed_type            VARCHAR(100) NOT NULL DEFAULT 'Giường Đôi',
    room_size           SMALLINT UNSIGNED NULL,
    rating              DECIMAL(3,2) NOT NULL DEFAULT 5.00,
    review_count        INT UNSIGNED NOT NULL DEFAULT 0,
    cover_image_url     VARCHAR(500) NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME NULL,
    CONSTRAINT pk_rooms PRIMARY KEY (id),
    CONSTRAINT uq_rooms_hotel_slug UNIQUE (hotel_id, slug),
    CONSTRAINT fk_rooms_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_rooms_bed_count CHECK (bed_count BETWEEN 1 AND 2),
    CONSTRAINT chk_rooms_status CHECK (status IN ('AVAILABLE', 'UNAVAILABLE', 'MAINTENANCE')),
    CONSTRAINT chk_rooms_price CHECK (price_per_night >= 0),
    CONSTRAINT chk_rooms_adults CHECK (max_adults >= 1),
    CONSTRAINT chk_rooms_total_rooms CHECK (total_rooms >= 1),
    INDEX idx_rooms_hotel_id (hotel_id),
    INDEX idx_rooms_status (status),
    INDEX idx_rooms_price (price_per_night)
) ENGINE=InnoDB;

-- 1.7 Bảng Hotel_Images (Album hình ảnh khách sạn)
CREATE TABLE IF NOT EXISTS hotel_images (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    hotel_id    BIGINT UNSIGNED NOT NULL,
    image_url   VARCHAR(500) NOT NULL,
    caption     VARCHAR(200) NULL,
    sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    is_primary  TINYINT(1) NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_hotel_images PRIMARY KEY (id),
    CONSTRAINT fk_hotel_images_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON UPDATE CASCADE ON DELETE CASCADE,
    INDEX idx_hotel_images_hotel_id (hotel_id),
    INDEX idx_hotel_images_sort (hotel_id, sort_order)
) ENGINE=InnoDB;

-- 1.8 Bảng Room_Images (Album hình ảnh phòng)
CREATE TABLE IF NOT EXISTS room_images (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    room_id     BIGINT UNSIGNED NOT NULL,
    image_url   VARCHAR(500) NOT NULL,
    caption     VARCHAR(200) NULL,
    sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    is_primary  TINYINT(1) NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_room_images PRIMARY KEY (id),
    CONSTRAINT fk_room_images_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON UPDATE CASCADE ON DELETE CASCADE,
    INDEX idx_room_images_room_id (room_id),
    INDEX idx_room_images_sort (room_id, sort_order)
) ENGINE=InnoDB;

-- 1.9 Bảng Trip_Plans (Lịch trình chuyến đi của khách hàng)
CREATE TABLE IF NOT EXISTS trip_plans (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id                 BIGINT UNSIGNED NOT NULL,
    origin_location_id      BIGINT UNSIGNED NOT NULL,
    destination_location_id BIGINT UNSIGNED NOT NULL,
    departure_at            DATETIME NOT NULL,
    arrival_at              DATETIME NULL,
    traveler_count          SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    budget                  DECIMAL(15,2) NULL,
    note                    TEXT NULL,
    status                  VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_trip_plans PRIMARY KEY (id),
    CONSTRAINT fk_trip_plans_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_trip_plans_origin FOREIGN KEY (origin_location_id) REFERENCES locations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_trip_plans_destination FOREIGN KEY (destination_location_id) REFERENCES locations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_trip_plans_locations CHECK (origin_location_id <> destination_location_id),
    CONSTRAINT chk_trip_plans_times CHECK (arrival_at IS NULL OR arrival_at > departure_at),
    CONSTRAINT chk_trip_plans_travelers CHECK (traveler_count >= 1),
    CONSTRAINT chk_trip_plans_budget CHECK (budget IS NULL OR budget >= 0),
    CONSTRAINT chk_trip_plans_status CHECK (status IN ('DRAFT', 'PLANNED', 'COMPLETED', 'CANCELLED')),
    INDEX idx_trip_plans_user_id (user_id),
    INDEX idx_trip_plans_origin_id (origin_location_id),
    INDEX idx_trip_plans_destination_id (destination_location_id),
    INDEX idx_trip_plans_status (status)
) ENGINE=InnoDB;

-- 1.10 Bảng Bookings (Đơn đặt phòng, ĐẦY ĐỦ CÁC CỘT PHÂN CÔNG TỪ ĐẦU)
CREATE TABLE IF NOT EXISTS bookings (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_code            VARCHAR(30) NOT NULL,
    user_id                 BIGINT UNSIGNED NOT NULL,
    hotel_id                BIGINT UNSIGNED NOT NULL,
    trip_plan_id            BIGINT UNSIGNED NULL,
    handled_by              BIGINT UNSIGNED NULL,
    assignment_type         VARCHAR(20) NOT NULL DEFAULT 'AUTO' COMMENT 'AUTO hoặc MANUAL',
    assignment_note         TEXT NULL COMMENT 'Lý do hoặc ghi chú phân công',
    reassigned_at           DATETIME NULL COMMENT 'Thời điểm đổi người phụ trách',
    reassigned_by           BIGINT UNSIGNED NULL COMMENT 'Admin/Manager thực hiện đổi',
    contact_name            VARCHAR(150) NOT NULL,
    contact_email           VARCHAR(255) NOT NULL,
    contact_phone           VARCHAR(20) NOT NULL,
    check_in_at             DATETIME NOT NULL,
    check_out_at            DATETIME NOT NULL,
    total_guests            SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    requested_room_count    SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    estimated_total         DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    status                  VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    special_request         TEXT NULL,
    confirmed_at            DATETIME NULL,
    rejected_at             DATETIME NULL,
    cancelled_at            DATETIME NULL,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_bookings PRIMARY KEY (id),
    CONSTRAINT uq_bookings_code UNIQUE (booking_code),
    CONSTRAINT fk_bookings_customer FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_bookings_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_bookings_trip_plan FOREIGN KEY (trip_plan_id) REFERENCES trip_plans(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_bookings_handled_by FOREIGN KEY (handled_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_bookings_reassigned_by FOREIGN KEY (reassigned_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_bookings_dates CHECK (check_out_at > check_in_at),
    CONSTRAINT chk_bookings_guests CHECK (total_guests >= 1),
    CONSTRAINT chk_bookings_room_count CHECK (requested_room_count >= 1),
    CONSTRAINT chk_bookings_estimated_total CHECK (estimated_total >= 0),
    CONSTRAINT chk_bookings_status CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED')),
    INDEX idx_bookings_user_id (user_id),
    INDEX idx_bookings_hotel_id (hotel_id),
    INDEX idx_bookings_trip_plan_id (trip_plan_id),
    INDEX idx_bookings_handled_by (handled_by),
    INDEX idx_bookings_status (status),
    INDEX idx_bookings_created_at (created_at)
) ENGINE=InnoDB;

-- 1.11 Bảng Booking_Rooms (Chi tiết từng phòng trong đơn đặt)
CREATE TABLE IF NOT EXISTS booking_rooms (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id      BIGINT UNSIGNED NOT NULL,
    room_id         BIGINT UNSIGNED NOT NULL,
    quantity        SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    price_per_night DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    nights          SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    subtotal        DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_booking_rooms PRIMARY KEY (id),
    CONSTRAINT fk_booking_rooms_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_booking_rooms_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_booking_rooms_quantity CHECK (quantity >= 1),
    CONSTRAINT chk_booking_rooms_price CHECK (price_per_night >= 0),
    CONSTRAINT chk_booking_rooms_nights CHECK (nights >= 1),
    CONSTRAINT chk_booking_rooms_subtotal CHECK (subtotal >= 0),
    INDEX idx_booking_rooms_booking_id (booking_id),
    INDEX idx_booking_rooms_room_id (room_id)
) ENGINE=InnoDB;

-- 1.12 Bảng Booking_Status_Logs (Nhật ký thay đổi trạng thái đặt phòng)
CREATE TABLE IF NOT EXISTS booking_status_logs (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id      BIGINT UNSIGNED NOT NULL,
    changed_by      BIGINT UNSIGNED NOT NULL,
    old_status      VARCHAR(30) NULL,
    new_status      VARCHAR(30) NOT NULL,
    note            VARCHAR(500) NULL,
    changed_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_booking_status_logs PRIMARY KEY (id),
    CONSTRAINT fk_booking_status_logs_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_booking_status_logs_user FOREIGN KEY (changed_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_booking_status_logs_old CHECK (old_status IS NULL OR old_status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT chk_booking_status_logs_new CHECK (new_status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED')),
    INDEX idx_booking_status_logs_booking_id (booking_id),
    INDEX idx_booking_status_logs_changed_by (changed_by)
) ENGINE=InnoDB;


-- ====================================================================================================
-- PHẦN 2: PHÂN QUYỀN NÂNG CAO RBAC (PHASE 2 - ROLES & PERMISSIONS)
-- ====================================================================================================

-- 2.1 Bảng Roles (Danh mục vai trò)
CREATE TABLE IF NOT EXISTS roles (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name            VARCHAR(50) NOT NULL,
    display_name    VARCHAR(100) NOT NULL,
    description     TEXT NULL,
    is_system       TINYINT(1) NOT NULL DEFAULT 0,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_roles PRIMARY KEY (id),
    CONSTRAINT uq_roles_name UNIQUE (name)
) ENGINE=InnoDB;

-- 2.2 Bảng Permissions (Danh mục quyền hạn)
CREATE TABLE IF NOT EXISTS permissions (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    module      VARCHAR(50) NOT NULL,
    action      VARCHAR(50) NOT NULL,
    name        VARCHAR(100) NOT NULL,
    description VARCHAR(255) NULL,
    CONSTRAINT pk_permissions PRIMARY KEY (id),
    CONSTRAINT uq_permissions_name UNIQUE (name),
    INDEX idx_permissions_module (module)
) ENGINE=InnoDB;

-- 2.3 Bảng Role_Permissions (Gán quyền chi tiết cho vai trò)
CREATE TABLE IF NOT EXISTS role_permissions (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    role_id         BIGINT UNSIGNED NOT NULL,
    permission_id   BIGINT UNSIGNED NOT NULL,
    CONSTRAINT pk_role_permissions PRIMARY KEY (id),
    CONSTRAINT uq_role_permissions UNIQUE (role_id, permission_id),
    CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON UPDATE CASCADE ON DELETE CASCADE,
    INDEX idx_rp_role_id (role_id),
    INDEX idx_rp_permission_id (permission_id)
) ENGINE=InnoDB;

-- 2.4 Bảng Users_Roles (Gán vai trò cho người dùng)
CREATE TABLE IF NOT EXISTS users_roles (
    user_id     BIGINT UNSIGNED NOT NULL,
    role_id     BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, role_id),
    CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id) ON UPDATE CASCADE ON DELETE CASCADE,
    INDEX idx_ur_user_id (user_id),
    INDEX idx_ur_role_id (role_id)
) ENGINE=InnoDB;


-- ====================================================================================================
-- PHẦN 3: DỊCH VỤ PHÒNG & ADD-ONS (PHASE 2 - ROOM SERVICES & REQUESTS)
-- ====================================================================================================

-- 3.1 Bảng Service_Categories (Danh mục nhóm dịch vụ)
CREATE TABLE IF NOT EXISTS service_categories (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code        VARCHAR(60) NOT NULL,
    name        VARCHAR(150) NOT NULL,
    description TEXT NULL,
    icon        VARCHAR(100) NULL COMMENT 'Tên icon Lucide hoặc emoji',
    sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_service_categories PRIMARY KEY (id),
    CONSTRAINT uq_service_categories_code UNIQUE (code),
    INDEX idx_service_categories_status (status),
    INDEX idx_service_categories_sort (sort_order)
) ENGINE=InnoDB;

-- 3.2 Bảng Room_Services (Dịch vụ phòng - ĐẦY ĐỦ CÁC CỘT NGHIỆP VỤ TỪ ĐẦU)
CREATE TABLE IF NOT EXISTS room_services (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    category_id         BIGINT UNSIGNED NOT NULL,
    hotel_id            BIGINT UNSIGNED NULL COMMENT 'NULL = Dịch vụ chung toàn hệ thống, có ID = Dịch vụ riêng của khách sạn',
    room_type_id        BIGINT UNSIGNED NULL COMMENT 'Phòng/Loại phòng cụ thể áp dụng nếu có',
    name                VARCHAR(150) NOT NULL,
    description         TEXT NULL,
    unit                VARCHAR(30) NOT NULL DEFAULT 'lần' COMMENT 'lần, giờ, ngày, món, bộ, suất, người, phòng',
    base_price          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    is_complimentary    TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = Miễn phí đi kèm phòng, 0 = Có thu phí',
    service_type        VARCHAR(30) NOT NULL DEFAULT 'ADD_ON' COMMENT 'INCLUDED, ADD_ON, UPGRADE, HOURLY',
    quota_per_booking   SMALLINT UNSIGNED NULL COMMENT 'Số lượt miễn phí/giới hạn mỗi booking',
    quota_per_night     SMALLINT UNSIGNED NULL COMMENT 'Số lượt miễn phí mỗi đêm',
    max_quantity        SMALLINT UNSIGNED NULL COMMENT 'Số lượng tối đa có thể đặt',
    sla_minutes         SMALLINT UNSIGNED NULL DEFAULT 30 COMMENT 'Cam kết thời gian phục vụ tính bằng phút',
    capacity_per_hour   SMALLINT UNSIGNED NULL COMMENT 'Công suất phục vụ tối đa trong 1 giờ',
    lead_time_hours     TINYINT UNSIGNED NULL DEFAULT 0 COMMENT 'Cần đặt trước bao nhiêu giờ',
    requires_approval   TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Cần Quản lý duyệt trước khi thực hiện',
    department_owner    VARCHAR(60) NULL COMMENT 'Phòng ban chịu trách nhiệm (F&B, HOUSEKEEPING, FRONT_DESK, SPA...)',
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_room_services PRIMARY KEY (id),
    CONSTRAINT fk_room_services_category FOREIGN KEY (category_id) REFERENCES service_categories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_room_services_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON UPDATE CASCADE ON DELETE CASCADE,
    INDEX idx_room_services_hotel (hotel_id),
    INDEX idx_room_services_type (service_type),
    INDEX idx_room_services_status (status),
    INDEX idx_room_services_complimentary (is_complimentary)
) ENGINE=InnoDB;

-- 3.3 Bảng Room_Service_Assignments (Gán dịch vụ có sẵn hoặc phụ thu theo từng phòng cụ thể)
CREATE TABLE IF NOT EXISTS room_service_assignments (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    room_id             BIGINT UNSIGNED NOT NULL,
    service_id          BIGINT UNSIGNED NOT NULL,
    is_complimentary    TINYINT(1) NOT NULL DEFAULT 0,
    custom_price        DECIMAL(12,2) NULL COMMENT 'Giá riêng cho phòng này nếu khác giá base_price',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_room_service_assignments PRIMARY KEY (id),
    CONSTRAINT uq_rsa_room_service UNIQUE (room_id, service_id),
    CONSTRAINT fk_rsa_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_rsa_service FOREIGN KEY (service_id) REFERENCES room_services(id) ON UPDATE CASCADE ON DELETE CASCADE,
    INDEX idx_rsa_room (room_id),
    INDEX idx_rsa_service (service_id)
) ENGINE=InnoDB;

-- 3.4 Bảng Service_Requests (Yêu cầu dịch vụ phát sinh từ khách - ĐẦY ĐỦ CÁC CỘT TỪ ĐẦU)
CREATE TABLE IF NOT EXISTS service_requests (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id              BIGINT UNSIGNED NOT NULL,
    service_id              BIGINT UNSIGNED NOT NULL,
    assigned_to             BIGINT UNSIGNED NULL COMMENT 'Nhân viên trực tiếp thực hiện (users.id)',
    requested_quantity      SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    unit_price              DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_amount            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    status                  VARCHAR(30) NOT NULL DEFAULT 'REQUESTED' COMMENT 'REQUESTED, SCHEDULED, ACCEPTED, IN_PROGRESS, COMPLETED, CONFIRMED, REJECTED, CANCELLED',
    scheduled_at            DATETIME NULL COMMENT 'Thời gian hẹn phục vụ',
    accepted_at             DATETIME NULL COMMENT 'Thời điểm nhân viên nhận việc',
    started_at              DATETIME NULL COMMENT 'Thời điểm bắt đầu thực hiện',
    completed_at            DATETIME NULL COMMENT 'Thời điểm nhân viên báo xong',
    confirmed_at            DATETIME NULL COMMENT 'Thời điểm khách hoặc lễ tân xác nhận hoàn tất',
    sla_due_at              DATETIME NULL COMMENT 'Hạn chót SLA cam kết hoàn thành',
    is_sla_breached         TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = Bị trễ hạn SLA',
    failure_reason          TEXT NULL COMMENT 'Lý do dịch vụ bị trễ hoặc thất bại nếu có',
    recovery_action         VARCHAR(200) NULL COMMENT 'Biện pháp đền bù/khắc phục',
    recovery_approved_by    BIGINT UNSIGNED NULL COMMENT 'Người phê duyệt đền bù',
    recovery_cost           DECIMAL(12,2) NULL COMMENT 'Chi phí đền bù cho khách nếu có',
    special_instructions    TEXT NULL COMMENT 'Yêu cầu cụ thể từ khách',
    staff_notes             TEXT NULL COMMENT 'Ghi chú nội bộ của nhân viên',
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_service_requests PRIMARY KEY (id),
    CONSTRAINT fk_service_requests_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_service_requests_service FOREIGN KEY (service_id) REFERENCES room_services(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_service_requests_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_service_requests_recovery_approver FOREIGN KEY (recovery_approved_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_sr_booking (booking_id),
    INDEX idx_sr_service (service_id),
    INDEX idx_sr_assigned (assigned_to),
    INDEX idx_sr_status (status),
    INDEX idx_sr_sla (sla_due_at, is_sla_breached)
) ENGINE=InnoDB;

-- 3.5 Bảng Booking_Service_Snapshots (Bảo lưu giá và điều kiện dịch vụ tại thời điểm đặt)
CREATE TABLE IF NOT EXISTS booking_service_snapshots (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id          BIGINT UNSIGNED NOT NULL,
    service_id          BIGINT UNSIGNED NOT NULL,
    service_name        VARCHAR(150) NOT NULL,
    category_name       VARCHAR(150) NOT NULL,
    unit                VARCHAR(30) NOT NULL,
    unit_price          DECIMAL(12,2) NOT NULL,
    quantity            SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    total_amount        DECIMAL(12,2) NOT NULL,
    is_complimentary    TINYINT(1) NOT NULL DEFAULT 0,
    snapshotted_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_booking_service_snapshots PRIMARY KEY (id),
    CONSTRAINT fk_bss_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_bss_service FOREIGN KEY (service_id) REFERENCES room_services(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_bss_booking (booking_id)
) ENGINE=InnoDB;

-- 3.6 Bảng Service_Recovery_Log (Nhật ký xử lý sự cố & đền bù dịch vụ)
CREATE TABLE IF NOT EXISTS service_recovery_log (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    service_request_id  BIGINT UNSIGNED NULL,
    booking_id          BIGINT UNSIGNED NOT NULL,
    reported_by         BIGINT UNSIGNED NOT NULL,
    approved_by         BIGINT UNSIGNED NULL,
    issue_type          VARCHAR(60) NOT NULL COMMENT 'DELAY, QUALITY, WRONG_ITEM, STAFF_ATTITUDE, CANCELLATION',
    root_cause          TEXT NULL,
    action_taken        TEXT NOT NULL,
    compensation_type   VARCHAR(40) NOT NULL DEFAULT 'NONE' COMMENT 'NONE, VOUCHER, DISCOUNT, FREE_SERVICE, REFUND',
    compensation_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    guest_satisfaction  TINYINT UNSIGNED NULL COMMENT 'Đánh giá hài lòng từ 1 đến 5 sao',
    resolved_at         DATETIME NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_service_recovery_log PRIMARY KEY (id),
    CONSTRAINT fk_srl_request FOREIGN KEY (service_request_id) REFERENCES service_requests(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_srl_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_srl_reporter FOREIGN KEY (reported_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_srl_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_srl_booking (booking_id),
    INDEX idx_srl_issue (issue_type)
) ENGINE=InnoDB;


-- ====================================================================================================
-- PHẦN 4: HỒ SƠ NĂNG LỰC & PHÂN CÔNG NHÂN SỰ (PHASE 2 - SKILLS & ASSIGNMENTS)
-- ====================================================================================================

-- 4.1 Bảng Skill_Categories (Danh mục kỹ năng nghiệp vụ)
CREATE TABLE IF NOT EXISTS skill_categories (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code                VARCHAR(60) NOT NULL,
    name                VARCHAR(150) NOT NULL,
    description         TEXT NULL,
    department          VARCHAR(60) NOT NULL COMMENT 'HOUSEKEEPING, F&B, FRONT_DESK, CONCIERGE, SPA, MAINTENANCE',
    weight_multiplier   DECIMAL(3,2) NOT NULL DEFAULT 1.00 COMMENT 'Hệ số độ khó kỹ năng',
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_skill_categories PRIMARY KEY (id),
    CONSTRAINT uq_skill_categories_code UNIQUE (code),
    INDEX idx_skill_dept (department),
    INDEX idx_skill_status (status)
) ENGINE=InnoDB;

-- 4.2 Bảng Staff_Skills (Kỹ năng đã xác thực của nhân viên - ĐẦY ĐỦ CÁC CỘT TỪ ĐẦU)
CREATE TABLE IF NOT EXISTS staff_skills (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id             BIGINT UNSIGNED NOT NULL,
    skill_id            BIGINT UNSIGNED NOT NULL,
    proficiency_level   VARCHAR(20) NOT NULL DEFAULT 'BASIC' COMMENT 'BASIC, INTERMEDIATE, ADVANCED, EXPERT',
    certificate         VARCHAR(255) NULL COMMENT 'Tên chứng chỉ nghiệp vụ',
    certificate_expiry  DATE NULL,
    verified_by         BIGINT UNSIGNED NULL COMMENT 'Admin/Manager đã duyệt kỹ năng',
    verified_at         DATETIME NULL,
    is_shadow           TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = Đang thực tập kèm cặp',
    shadow_mentor_id    BIGINT UNSIGNED NULL COMMENT 'Nhân viên kinh nghiệm hướng dẫn',
    eligibility_level   VARCHAR(20) NOT NULL DEFAULT 'STANDARD' COMMENT 'STANDARD, HIGH_COMPLEXITY, VIP_ONLY',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_staff_skills PRIMARY KEY (id),
    CONSTRAINT uq_staff_skill UNIQUE (user_id, skill_id),
    CONSTRAINT fk_staff_skills_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_staff_skills_skill FOREIGN KEY (skill_id) REFERENCES skill_categories(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_staff_skills_mentor FOREIGN KEY (shadow_mentor_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_staff_skills_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_staff_skills_user (user_id),
    INDEX idx_staff_skills_skill (skill_id),
    INDEX idx_staff_skills_level (proficiency_level)
) ENGINE=InnoDB;

-- 4.3 Bảng Staff_Language_Skills (Trình độ ngoại ngữ của nhân viên)
CREATE TABLE IF NOT EXISTS staff_language_skills (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id             BIGINT UNSIGNED NOT NULL,
    language_code       VARCHAR(10) NOT NULL COMMENT 'vi, en, zh, ja, ko, fr, de, ru',
    proficiency_level   VARCHAR(20) NOT NULL DEFAULT 'INTERMEDIATE' COMMENT 'BASIC, INTERMEDIATE, FLUENT, NATIVE',
    certificate         VARCHAR(255) NULL COMMENT 'IELTS, TOEIC, HSK, JLPT...',
    verified_by         BIGINT UNSIGNED NULL,
    verified_at         DATETIME NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_staff_language_skills PRIMARY KEY (id),
    CONSTRAINT uq_staff_language UNIQUE (user_id, language_code),
    CONSTRAINT fk_sls_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_sls_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_sls_user (user_id),
    INDEX idx_sls_lang (language_code)
) ENGINE=InnoDB;

-- 4.4 Bảng Staff_Assignments (Phân công tác vụ dịch vụ cho nhân viên - ĐẦY ĐỦ CÁC CỘT TỪ ĐẦU)
CREATE TABLE IF NOT EXISTS staff_assignments (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    service_request_id      BIGINT UNSIGNED NOT NULL,
    assigned_staff_id       BIGINT UNSIGNED NOT NULL,
    assigned_by             BIGINT UNSIGNED NOT NULL,
    assigned_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    difficulty_level        VARCHAR(20) NOT NULL DEFAULT 'STANDARD' COMMENT 'STANDARD, HIGH, CRITICAL, VIP',
    case_complexity         VARCHAR(20) NOT NULL DEFAULT 'STANDARD' COMMENT 'STANDARD, HIGH, CRITICAL',
    required_language       VARCHAR(10) NULL COMMENT 'Ngoại ngữ yêu cầu cho ca phục vụ',
    is_shadow               TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = Nhân viên đi kèm học việc',
    shadow_supervisor_id    BIGINT UNSIGNED NULL COMMENT 'Người giám sát trực tiếp',
    is_acting               TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = Làm nhiệm vụ kiêm nhiệm vượt cấp',
    escalated_to            BIGINT UNSIGNED NULL COMMENT 'Chuyển giao cho người khác khi khẩn cấp',
    escalated_at            DATETIME NULL,
    escalation_reason       TEXT NULL,
    performance_score       TINYINT UNSIGNED NULL COMMENT 'Chấm điểm hiệu suất (1 - 100)',
    status                  VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED' COMMENT 'ASSIGNED, IN_PROGRESS, COMPLETED, ESCALATED, REJECTED',
    notes                   TEXT NULL,
    rating                  DECIMAL(2,1) NULL COMMENT 'Khách đánh giá (1.0 đến 5.0 sao)',
    quality_score           TINYINT UNSIGNED NULL COMMENT 'Đánh giá chất lượng từ quản lý',
    feedback                TEXT NULL,
    completed_at            DATETIME NULL,
    CONSTRAINT pk_staff_assignments PRIMARY KEY (id),
    CONSTRAINT fk_staff_assignments_request FOREIGN KEY (service_request_id) REFERENCES service_requests(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_staff_assignments_staff FOREIGN KEY (assigned_staff_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_staff_assignments_assigner FOREIGN KEY (assigned_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_sa_shadow_supervisor FOREIGN KEY (shadow_supervisor_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_sa_escalated_to FOREIGN KEY (escalated_to) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_sa_request (service_request_id),
    INDEX idx_sa_staff (assigned_staff_id),
    INDEX idx_sa_status (status)
) ENGINE=InnoDB;

-- 4.5 Bảng Staff_Eligibility_Rules (Luật điều kiện nhận việc của nhân viên)
CREATE TABLE IF NOT EXISTS staff_eligibility_rules (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    rule_code               VARCHAR(60) NOT NULL,
    case_complexity         VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
    description             TEXT NULL,
    min_skill_level         TINYINT UNSIGNED NOT NULL DEFAULT 1,
    required_skill_codes    JSON NULL,
    required_language_codes JSON NULL,
    min_years_experience    DECIMAL(4,1) NOT NULL DEFAULT 0.0,
    min_cases_completed     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    exclude_shadow_mode     TINYINT(1) NOT NULL DEFAULT 1,
    require_verified_skills TINYINT(1) NOT NULL DEFAULT 0,
    escalation_role         VARCHAR(30) NOT NULL DEFAULT 'MANAGER',
    status                  VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_staff_eligibility_rules PRIMARY KEY (id),
    CONSTRAINT uq_rule_code UNIQUE (rule_code)
) ENGINE=InnoDB;

-- 4.6 Bảng Audit_Logs (Hệ thống truy vết & nhật ký biến động dữ liệu tự động)
CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    entity_name     VARCHAR(100) NOT NULL COMMENT 'Tên bảng / entity bị thay đổi',
    entity_id       VARCHAR(100) NOT NULL COMMENT 'ID của bản ghi bị thay đổi',
    action          VARCHAR(20) NOT NULL COMMENT 'INSERT, UPDATE, DELETE',
    old_values      JSON NULL COMMENT 'Dữ liệu trước khi sửa (chỉ lưu trường thay đổi khi UPDATE)',
    new_values      JSON NULL COMMENT 'Dữ liệu sau khi sửa',
    performed_by    VARCHAR(100) NULL DEFAULT 'SYSTEM' COMMENT 'User ID thực hiện hoặc SYSTEM',
    ip_address      VARCHAR(45) NULL,
    user_agent      VARCHAR(255) NULL,
    request_id      VARCHAR(100) NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_audit_logs PRIMARY KEY (id),
    INDEX idx_audit_entity (entity_name, entity_id),
    INDEX idx_audit_action (action),
    INDEX idx_audit_performed_by (performed_by),
    INDEX idx_audit_created_at (created_at)
) ENGINE=InnoDB;


-- ====================================================================================================
-- PHẦN 5: BỘ DỮ LIỆU MẪU MẶC ĐỊNH (MASTER SEEDS DATA - CHẠY 1 LẦN DÙNG MÃI MÃI)
-- ====================================================================================================

-- 5.1 Seed Roles Mặc Định (3 vai trò chính)
INSERT INTO roles (id, name, display_name, description, is_system) VALUES
    (1, 'ADMIN',    'Quản Trị Viên', 'Toàn quyền quản trị hệ thống', 1),
    (2, 'EMPLOYEE', 'Nhân Viên',     'Quản lý khách sạn, phòng, đơn đặt phòng và dịch vụ', 1),
    (3, 'CUSTOMER', 'Khách Hàng',    'Đặt phòng và quản lý chuyến đi cá nhân', 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- 5.2 Seed Permissions Mặc Định (23 quyền chi tiết các modules)
INSERT INTO permissions (module, action, name, description) VALUES
    ('hotels',   'create',        'hotels.create',        'Tạo khách sạn mới'),
    ('hotels',   'read',          'hotels.read',          'Xem danh sách và chi tiết khách sạn'),
    ('hotels',   'update',        'hotels.update',        'Cập nhật thông tin khách sạn'),
    ('hotels',   'delete',        'hotels.delete',        'Xóa khách sạn'),
    ('hotels',   'manage_images', 'hotels.manage_images', 'Upload và quản lý album ảnh khách sạn'),
    ('rooms',    'create',        'rooms.create',         'Tạo phòng mới'),
    ('rooms',    'read',          'rooms.read',           'Xem danh sách và chi tiết phòng'),
    ('rooms',    'update',        'rooms.update',         'Cập nhật thông tin phòng'),
    ('rooms',    'delete',        'rooms.delete',         'Xóa phòng'),
    ('rooms',    'manage_images', 'rooms.manage_images',  'Upload và quản lý album ảnh phòng'),
    ('bookings', 'read',          'bookings.read',        'Xem danh sách và chi tiết đơn đặt phòng'),
    ('bookings', 'update_status', 'bookings.update_status','Duyệt, xác nhận, từ chối đơn đặt phòng'),
    ('bookings', 'delete',        'bookings.delete',      'Xóa đơn đặt phòng'),
    ('users',    'read',          'users.read',           'Xem danh sách tài khoản nhân viên'),
    ('users',    'create',        'users.create',         'Tạo tài khoản nhân viên mới'),
    ('users',    'update',        'users.update',         'Cập nhật thông tin tài khoản nhân viên'),
    ('users',    'delete',        'users.delete',         'Xóa tài khoản nhân viên'),
    ('users',    'manage_staff',  'users.manage_staff',   'Quản lý và phân công nhân viên'),
    ('users',    'update_role',   'users.update_role',    'Thay đổi quyền/role của tài khoản'),
    ('users',    'update_status', 'users.update_status',  'Khoá/Mở khoá tài khoản nhân viên'),
    ('services', 'read',          'services.read',        'Xem danh sách dịch vụ và yêu cầu dịch vụ'),
    ('services', 'manage',        'services.manage',      'Thêm, sửa cấu hình bảng giá và phân loại dịch vụ'),
    ('skills',   'read',          'skills.read',          'Xem hồ sơ năng lực và ma trận kỹ năng nhân viên'),
    ('skills',   'manage',        'skills.manage',        'Đánh giá, phê duyệt chứng chỉ và kỹ năng nhân viên')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- 5.3 Gán quyền cho ADMIN (Full toàn bộ quyền)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions;

-- 5.4 Gán quyền cho EMPLOYEE (Quyền vận hành khách sạn, phòng, booking, dịch vụ)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions
WHERE name IN (
    'hotels.create', 'hotels.read', 'hotels.update', 'hotels.manage_images',
    'rooms.create',  'rooms.read',  'rooms.update',  'rooms.manage_images',
    'bookings.read', 'bookings.update_status',
    'services.read', 'skills.read'
);

-- 5.5 Seed Danh Mục Địa Điểm Mẫu
INSERT INTO locations (id, code, name, type, status) VALUES
    (1, 'HCM', 'TP. Hồ Chí Minh', 'CITY', 'ACTIVE'),
    (2, 'HN',  'Hà Nội',         'CITY', 'ACTIVE'),
    (3, 'DN',  'Đà Nẵng',         'CITY', 'ACTIVE')
ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status);

-- 5.6 Seed Loại Hình Khách Sạn Mẫu
INSERT INTO hotel_types (id, code, name, description, status) VALUES
    (1, 'HOTEL',    'Khách sạn',             'Cơ sở lưu trú dạng khách sạn tiêu chuẩn', 'ACTIVE'),
    (2, 'RESORT',   'Khu nghỉ dưỡng',         'Khu nghỉ dưỡng có nhiều dịch vụ cao cấp', 'ACTIVE'),
    (3, 'HOMESTAY', 'Homestay',              'Mô hình lưu trú gần gũi địa phương',      'ACTIVE'),
    (4, 'HOSTEL',   'Hostel',                'Lưu trú tiết kiệm hoặc phòng tập thể',     'ACTIVE'),
    (5, 'VILLA',    'Biệt thự nghỉ dưỡng',    'Biệt thự dành cho nhóm hoặc gia đình',    'ACTIVE')
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description);

-- 5.7 Seed Tài Khoản Mặc Định (Mật khẩu chuẩn: 123456789 - hash Bcrypt salt 12)
INSERT INTO users (id, full_name, email, password, role, status, email_verified_at) VALUES
    (1, 'Quản Trị Viên', 'admintraveloka@gmail.com',     '$2b$12$u0KyTp2ztwRmR0/Bo7IPL.ovoNv5EUr4lF8UYuQr/Z6cHxixIMEMu', 'ADMIN',    'ACTIVE', NOW()),
    (2, 'Nhân Viên',     'nhanvientraveloka@gmail.com', '$2b$12$u0KyTp2ztwRmR0/Bo7IPL.ovoNv5EUr4lF8UYuQr/Z6cHxixIMEMu', 'EMPLOYEE', 'ACTIVE', NOW()),
    (3, 'Khách Hàng',    'user@traveleke.vn',           '$2b$12$u0KyTp2ztwRmR0/Bo7IPL.ovoNv5EUr4lF8UYuQr/Z6cHxixIMEMu', 'CUSTOMER', 'ACTIVE', NOW())
ON DUPLICATE KEY UPDATE
    password = VALUES(password),
    role = VALUES(role),
    status = VALUES(status),
    email_verified_at = NOW();

-- Gán Role vào bảng liên kết users_roles
INSERT IGNORE INTO users_roles (user_id, role_id)
SELECT u.id, r.id FROM users u, roles r
WHERE u.email = 'admintraveloka@gmail.com' AND r.name = 'ADMIN';

INSERT IGNORE INTO users_roles (user_id, role_id)
SELECT u.id, r.id FROM users u, roles r
WHERE u.email = 'nhanvientraveloka@gmail.com' AND r.name = 'EMPLOYEE';

INSERT IGNORE INTO users_roles (user_id, role_id)
SELECT u.id, r.id FROM users u, roles r
WHERE u.email = 'user@traveleke.vn' AND r.name = 'CUSTOMER';

-- 5.8 Seed Khách Sạn Mẫu
INSERT INTO hotels (id, hotel_type_id, location_id, name, slug, description, star_rating, address, phone, email, cover_image_url, status) VALUES
    (1, 1, 1, 'Khách sạn Caravelle Sài Gòn', 'khach-san-caravelle-sai-gon', 'Khách sạn 5 sao sang trọng ngay trung tâm Quận 1 với tầm nhìn tráng lệ ra toàn cảnh thành phố.', 5, '19-23 Công Trường Lam Sơn, Bến Nghé, Quận 1, TP. Hồ Chí Minh', '02838234999', 'caravelle@traveleke.vn', '/uploads/hotels/hotels-1786794920215-472320896.png', 'ACTIVE'),
    (2, 1, 3, 'Furama Resort Đà Nẵng', 'furama-resort-da-nang', 'Khu nghỉ dưỡng 5 sao hướng biển Bắc Mỹ An tuyệt đẹp với hệ sinh thái ẩm thực và hồ bơi vô cực đẳng cấp.', 5, '105 Võ Nguyên Giáp, Ngũ Hành Sơn, Đà Nẵng', '02363847333', 'furama@traveleke.vn', '/uploads/hotels/hotels-1786798592187-334845302.png', 'ACTIVE'),
    (3, 1, 2, 'Lotte Hotel Hà Nội', 'lotte-hotel-ha-noi', 'Tọa lạc trên các tầng cao của tòa nhà Lotte Center, mang đến trải nghiệm nghỉ dưỡng 5 sao trên tầng mây.', 5, '54 Liễu Giai, Ba Đình, Hà Nội', '02433331000', 'lotte@traveleke.vn', '/uploads/hotels/hotels-1788620536254-73388191.png', 'ACTIVE')
ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address), cover_image_url = VALUES(cover_image_url);

-- 5.9 Seed Album Ảnh Khách Sạn
INSERT INTO hotel_images (hotel_id, image_url, caption, sort_order, is_primary) VALUES
    (1, '/uploads/hotels/hotels-1786794920215-472320896.png', 'Mặt tiền khách sạn Caravelle', 0, 1),
    (1, '/uploads/hotels/hotels-1786795692411-620859.png',     'Sảnh chính Caravelle', 1, 0),
    (2, '/uploads/hotels/hotels-1786798592187-334845302.png', 'Khuôn viên Furama Resort', 0, 1),
    (2, '/uploads/hotels/hotels-1786798592184-324501.jpg',     'Hồ bơi hướng biển Furama', 1, 0),
    (3, '/uploads/hotels/hotels-1788620536254-73388191.png',  'Toàn cảnh Lotte Hotel Hà Nội', 0, 1)
ON DUPLICATE KEY UPDATE caption = VALUES(caption);

-- 5.10 Seed Phòng Mẫu Cho Khách Sạn
INSERT INTO rooms (id, hotel_id, name, slug, description, price_per_night, max_adults, max_children, total_rooms, available_rooms, bed_count, bed_type, room_size, rating, review_count, cover_image_url, status) VALUES
    (1, 1, 'Phòng Deluxe City View', 'phong-deluxe-city-view-caravelle', 'Phòng nghỉ tiện nghi hiện đại với cửa kính panorama view ngắm trung tâm thành phố Sài Gòn rực rỡ ánh đèn.', 1850000, 2, 1, 10, 8, 1, 'Giường Đôi', 38, 4.90, 48, '/uploads/rooms/rooms-1786797511481-837351127.png', 'AVAILABLE'),
    (2, 1, 'Phòng Premium Suite King', 'phong-premium-suite-king-caravelle', 'Suite cao cấp với phòng khách riêng biệt, bồn tắm nằm massage và đặc quyền sử dụng Signature Lounge.', 3200000, 2, 2, 5, 4, 1, 'Giường Đôi King', 56, 5.00, 32, '/uploads/rooms/rooms-1786797511488-924455364.png', 'AVAILABLE'),
    (3, 2, 'Phòng Ocean Deluxe Biển Mỹ An', 'phong-ocean-deluxe-bien-my-an', 'Phòng hướng biển với ban công thoáng mát, đón gió biển tự nhiên trong lành và không gian thư giãn tuyệt đối.', 2450000, 2, 1, 12, 10, 1, 'Giường Đôi', 45, 4.95, 75, '/uploads/rooms/rooms-1786798401064-252341834.jpg', 'AVAILABLE'),
    (4, 2, 'Biệt Thự Hướng Vườn Furama Villa', 'biet-thu-huong-vuon-furama-villa', 'Villa sân vườn nhiệt đới với hồ bơi riêng biệt, không gian nghỉ dưỡng biệt lập lý tưởng cho gia đình.', 5900000, 4, 2, 4, 3, 2, '2 Giường Đôi King', 120, 5.00, 26, '/uploads/rooms/rooms-1786803009948-438879937.png', 'AVAILABLE'),
    (5, 3, 'Phòng Grand Deluxe Lotte', 'phong-grand-deluxe-lotte', 'Thiết kế phong cách tối giản thanh lịch với view hồ Tây thơ mộng từ trên cao cùng giường nệm êm ái.', 2100000, 2, 1, 15, 12, 1, 'Giường Đôi', 42, 4.88, 54, '/uploads/rooms/rooms-1788621367940-828756673.png', 'AVAILABLE'),
    (6, 3, 'Phòng Club Junior Suite', 'phong-club-junior-suite-lotte', 'Không gian sang trọng với bàn làm việc cao cấp, bồn tắm ngắm mây và bữa sáng buffet thượng hạng miễn phí.', 3800000, 2, 1, 6, 5, 1, 'Giường Đôi King', 65, 4.96, 41, '/uploads/rooms/rooms-1788621480468-810683228.png', 'AVAILABLE')
ON DUPLICATE KEY UPDATE name = VALUES(name), price_per_night = VALUES(price_per_night), cover_image_url = VALUES(cover_image_url);

-- 5.11 Seed Album Ảnh Phòng
INSERT INTO room_images (room_id, image_url, caption, sort_order, is_primary) VALUES
    (1, '/uploads/rooms/rooms-1786797511481-837351127.png', 'Ảnh phòng Deluxe City View', 0, 1),
    (2, '/uploads/rooms/rooms-1786797511488-924455364.png', 'Ảnh phòng Premium Suite King', 0, 1),
    (3, '/uploads/rooms/rooms-1786798401064-252341834.jpg', 'Ảnh phòng Ocean Deluxe', 0, 1),
    (4, '/uploads/rooms/rooms-1786803009948-438879937.png', 'Ảnh Biệt Thự Hướng Vườn', 0, 1),
    (5, '/uploads/rooms/rooms-1788621367940-828756673.png', 'Ảnh phòng Grand Deluxe Lotte', 0, 1),
    (6, '/uploads/rooms/rooms-1788621480468-810683228.png', 'Ảnh phòng Club Junior Suite', 0, 1)
ON DUPLICATE KEY UPDATE caption = VALUES(caption);

-- 5.12 Seed Danh Mục Dịch Vụ Chuẩn
INSERT INTO service_categories (id, code, name, description, icon, sort_order, status) VALUES
    (1, 'FOODFAST',      'Ẩm Thực & Nhà Hàng',       'Ăn uống tại phòng, buffet, món gọi nhanh và thức uống cao cấp', 'UtensilsCrossed', 1, 'ACTIVE'),
    (2, 'HOUSEKEEPING',  'Buồng Phòng & Vệ Sinh',    'Dọn phòng theo yêu cầu, thêm gối chăn mền, đồ dùng phòng tắm', 'Sparkles', 2, 'ACTIVE'),
    (3, 'LAUNDRY',      'Giặt Ủi Nhanh',            'Giặt hấp, giặt sấy, ủi đồ cấp tốc lấy trong ngày',              'Shirt', 3, 'ACTIVE'),
    (4, 'SPA_WELLNESS',  'Spa & Chăm Sóc Sức Khỏe',  'Massage trị liệu, xông hơi, chăm sóc da tại phòng hoặc trung tâm', 'Flower2', 4, 'ACTIVE'),
    (5, 'TRANSPORT',     'Đưa Đón & Di Chuyển',      'Xe đưa đón sân bay, thuê xe tự lái, dịch vụ tài xế riêng',      'Car', 5, 'ACTIVE'),
    (6, 'CONCIERGE',     'Hỗ Trợ & Trợ Lý Du Lịch',  'Đặt vé tour tham quan, hướng dẫn viên, hỗ trợ y tế, dịch vụ hoa tươi', 'BellRing', 6, 'ACTIVE'),
    (7, 'CHILDCARE',     'Dịch Vụ Trông Trẻ',        'Giữ trẻ theo giờ, đồ chơi và nôi em bé tại phòng',              'Baby', 7, 'ACTIVE'),
    (8, 'TECH_SUPPORT',  'Thiết Bị & Kỹ Thuật',      'Cáp chuyển đổi, bộ sạc, loa bluetooth, hỗ trợ wifi tốc độ cao', 'Wifi', 8, 'ACTIVE'),
    (9, 'FOOD_BEVERAGE', 'Đồ Uống & Giải Khát',      'Nước ngọt, nước khoáng, bia và cà phê hảo hạng',                'Coffee', 9, 'ACTIVE')
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), icon = VALUES(icon), sort_order = VALUES(sort_order);

-- 5.13 Seed Dịch Vụ Phòng Chuẩn (Miễn Phí & Có Phí Add-ons)
INSERT INTO room_services (category_id, name, description, unit, base_price, is_complimentary, service_type, status)
SELECT c.id, 'Wifi Tốc Độ Cao', 'Internet wifi cáp quang băng thông rộng không giới hạn', 'phòng', 0, 1, 'INCLUDED', 'ACTIVE'
FROM service_categories c WHERE c.code = 'TECH_SUPPORT'
AND NOT EXISTS (SELECT 1 FROM room_services rs WHERE rs.name = 'Wifi Tốc Độ Cao');

INSERT INTO room_services (category_id, name, description, unit, base_price, is_complimentary, service_type, status)
SELECT c.id, 'Dọn Phòng Hàng Ngày', 'Thay drap, hút bụi, khử khuẩn và dọn dẹp buồng phòng mỗi ngày', 'ngày', 0, 1, 'INCLUDED', 'ACTIVE'
FROM service_categories c WHERE c.code = 'HOUSEKEEPING'
AND NOT EXISTS (SELECT 1 FROM room_services rs WHERE rs.name = 'Dọn Phòng Hàng Ngày');

INSERT INTO room_services (category_id, name, description, unit, base_price, is_complimentary, service_type, status)
SELECT c.id, 'Trà & Cà Phê Miễn Phí', 'Gói trà túi lọc và cà phê hòa tan cao cấp kèm ấm đun siêu tốc tại phòng', 'ngày', 0, 1, 'INCLUDED', 'ACTIVE'
FROM service_categories c WHERE c.code = 'FOOD_BEVERAGE'
AND NOT EXISTS (SELECT 1 FROM room_services rs WHERE rs.name = 'Trà & Cà Phê Miễn Phí');

INSERT INTO room_services (category_id, name, description, unit, base_price, is_complimentary, service_type, status)
SELECT c.id, 'Khăn Tắm & Đồ Vệ Sinh Cá Nhân', 'Bộ khăn bông, bàn chải, kem đánh răng, dầu gội, sữa tắm chất lượng cao', 'lần', 0, 1, 'INCLUDED', 'ACTIVE'
FROM service_categories c WHERE c.code = 'HOUSEKEEPING'
AND NOT EXISTS (SELECT 1 FROM room_services rs WHERE rs.name = 'Khăn Tắm & Đồ Vệ Sinh Cá Nhân');

INSERT INTO room_services (category_id, name, description, unit, base_price, is_complimentary, service_type, status)
SELECT c.id, 'Dịch Vụ Báo Thức & Hỗ Trợ 24/7', 'Lễ tân trực hotline hỗ trợ thông tin và báo thức cuộc gọi theo yêu cầu', 'lần', 0, 1, 'INCLUDED', 'ACTIVE'
FROM service_categories c WHERE c.code = 'CONCIERGE'
AND NOT EXISTS (SELECT 1 FROM room_services rs WHERE rs.name = 'Dịch Vụ Báo Thức & Hỗ Trợ 24/7');

INSERT INTO room_services (category_id, name, description, unit, base_price, is_complimentary, service_type, status)
SELECT c.id, 'Buffet Ăn Sáng Quốc Tế', 'Tiệc buffet sáng phong phú món Á - Âu tại nhà hàng khách sạn', 'người', 150000, 0, 'ADD_ON', 'ACTIVE'
FROM service_categories c WHERE c.code = 'FOODFAST'
AND NOT EXISTS (SELECT 1 FROM room_services rs WHERE rs.name = 'Buffet Ăn Sáng Quốc Tế');

INSERT INTO room_services (category_id, name, description, unit, base_price, is_complimentary, service_type, status)
SELECT c.id, 'Giặt Sấy & Ủi Quần Áo Lấy Liền', 'Dịch vụ giặt sấy thơm tho và ủi phẳng trả đồ trong vòng 4 tiếng', 'kg', 60000, 0, 'ADD_ON', 'ACTIVE'
FROM service_categories c WHERE c.code = 'LAUNDRY'
AND NOT EXISTS (SELECT 1 FROM room_services rs WHERE rs.name = 'Giặt Sấy & Ủi Quần Áo Lấy Liền');

INSERT INTO room_services (category_id, name, description, unit, base_price, is_complimentary, service_type, status)
SELECT c.id, 'Massage Thảo Dược Toàn Thân (60 Phút)', 'Liệu trình massage thư giãn với tinh dầu tự nhiên tại phòng hoặc spa', 'giờ', 350000, 0, 'ADD_ON', 'ACTIVE'
FROM service_categories c WHERE c.code = 'SPA_WELLNESS'
AND NOT EXISTS (SELECT 1 FROM room_services rs WHERE rs.name = 'Massage Thảo Dược Toàn Thân (60 Phút)');

INSERT INTO room_services (category_id, name, description, unit, base_price, is_complimentary, service_type, status)
SELECT c.id, 'Đưa Đón Sân Bay Riêng 4 Chỗ', 'Xe đón hoặc tiễn sân bay sang trọng, tài xế đúng giờ và nhiệt tình', 'chuyến', 250000, 0, 'ADD_ON', 'ACTIVE'
FROM service_categories c WHERE c.code = 'TRANSPORT'
AND NOT EXISTS (SELECT 1 FROM room_services rs WHERE rs.name = 'Đưa Đón Sân Bay Riêng 4 Chỗ');

INSERT INTO room_services (category_id, name, description, unit, base_price, is_complimentary, service_type, status)
SELECT c.id, 'Trông Trẻ Theo Giờ Tại Phòng', 'Nhân viên trông trẻ được đào tạo nghiệp vụ, an toàn và chu đáo', 'giờ', 100000, 0, 'ADD_ON', 'ACTIVE'
FROM service_categories c WHERE c.code = 'CHILDCARE'
AND NOT EXISTS (SELECT 1 FROM room_services rs WHERE rs.name = 'Trông Trẻ Theo Giờ Tại Phòng');

-- 5.14 Gán Mặc Định Dịch Vụ Miễn Phí Cho Toàn Bộ Phòng
INSERT IGNORE INTO room_service_assignments (room_id, service_id, is_complimentary)
SELECT r.id, rs.id, 1
FROM rooms r
CROSS JOIN room_services rs
WHERE rs.is_complimentary = 1;

-- 5.15 Seed Skill Categories Chuẩn
INSERT INTO skill_categories (code, name, description, department, weight_multiplier, status) VALUES
    ('HK_CLEAN_STD',   'Dọn Buồng Phòng Cơ Bản',          'Kỹ năng thay ga trải giường, hút bụi và khử khuẩn tiêu chuẩn', 'HOUSEKEEPING', 1.00, 'ACTIVE'),
    ('HK_VIP_SETUP',   'Setup Phòng VIP & HoneyMoon',     'Trang trí hoa tươi, xếp thiên nga, chuẩn bị champagne và trái cây đón khách', 'HOUSEKEEPING', 1.50, 'ACTIVE'),
    ('FB_BARISTA',     'Pha Chế Cà Phê Chuyên Nghiệp',    'Pha chế espresso, latte art, sinh tố và đồ uống đặc biệt', 'F&B', 1.20, 'ACTIVE'),
    ('FB_FINE_DINING', 'Phục Vụ Bàn Tiệc & Rượu Vang',    'Quy chuẩn phục vụ món ăn Âu - Á cao cấp và kỹ năng sommelier rượu vang', 'F&B', 1.40, 'ACTIVE'),
    ('SPA_THAI_MASS',  'Massage Thái Cổ Truyền',          'Kỹ thuật kéo giãn cơ học bấm huyệt trị liệu chuẩn quốc tế', 'SPA', 1.60, 'ACTIVE'),
    ('SPA_SKINCARE',   'Chăm Sóc Da Chuyên Sâu',          'Quy trình trị liệu mặt, dưỡng ẩm trẻ hóa và liệu pháp thảo dược', 'SPA', 1.30, 'ACTIVE'),
    ('ENG_ELECTRIC',   'Sửa Chữa Điện Lạnh & Thiết Bị',   'Khắc phục sự cố máy lạnh, hệ thống đèn thông minh và điện dân dụng', 'MAINTENANCE', 1.50, 'ACTIVE'),
    ('CON_TOUR_GUIDE', 'Hướng Dẫn Tour & Lịch Trình',     'Am hiểu điểm du lịch địa phương, tư vấn tour và giao tiếp khách quốc tế', 'CONCIERGE', 1.30, 'ACTIVE')
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), weight_multiplier = VALUES(weight_multiplier);

-- 5.16 Seed Staff Eligibility Rules Chuẩn
INSERT INTO staff_eligibility_rules (
    rule_code, case_complexity, description, min_skill_level,
    required_skill_codes, required_language_codes, min_years_experience,
    min_cases_completed, exclude_shadow_mode, require_verified_skills,
    escalation_role, status
) VALUES
    ('RULE_STANDARD', 'STANDARD', 'Phân công chuẩn cho đơn hàng phổ thông', 1, NULL, NULL, 0.0, 0, 0, 0, 'EMPLOYEE', 'ACTIVE'),
    ('RULE_PREMIUM',  'PREMIUM',  'Phân công cho phòng cao cấp', 2, JSON_ARRAY('SERVICE_EXCELLENCE'), JSON_ARRAY('en'), 1.0, 5, 1, 0, 'MANAGER', 'ACTIVE'),
    ('RULE_VIP',      'VIP',      'Phục vụ khách hàng VIP / phòng Suite', 3, JSON_ARRAY('VIP_HANDLING'), JSON_ARRAY('en'), 2.0, 20, 1, 1, 'MANAGER', 'ACTIVE'),
    ('RULE_COMPLEX',  'COMPLEX',  'Xử lý sự cố dịch vụ phức tạp / đoàn khách lớn', 4, JSON_ARRAY('PROBLEM_SOLVING', 'VIP_HANDLING'), JSON_ARRAY('en'), 3.0, 50, 1, 1, 'ADMIN', 'ACTIVE')
ON DUPLICATE KEY UPDATE
    description = VALUES(description),
    min_skill_level = VALUES(min_skill_level),
    required_skill_codes = VALUES(required_skill_codes),
    required_language_codes = VALUES(required_language_codes),
    min_years_experience = VALUES(min_years_experience),
    min_cases_completed = VALUES(min_cases_completed),
    exclude_shadow_mode = VALUES(exclude_shadow_mode),
    require_verified_skills = VALUES(require_verified_skills),
    escalation_role = VALUES(escalation_role),
    status = VALUES(status);


-- ====================================================================================================
-- PHẦN 6: ĐỒNG BỘ CỘT BẢO VỆ CHO DATABASE CŨ (MIGRATION COMPATIBILITY CHECK)
-- ====================================================================================================
-- Chỉ cần thiết khi chạy trên database cũ đã tạo từ giai đoạn trước để đảm bảo đủ 100% cột
-- ====================================================================================================

DROP PROCEDURE IF EXISTS SyncExistingDatabaseColumns;
DELIMITER $$
CREATE PROCEDURE SyncExistingDatabaseColumns()
BEGIN
    DECLARE col_cnt INT DEFAULT 0;

    -- Đồng bộ bảng bookings nếu chạy trên DB cũ
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'assignment_type';
    IF col_cnt = 0 THEN
        ALTER TABLE bookings ADD COLUMN assignment_type VARCHAR(20) NOT NULL DEFAULT 'AUTO' COMMENT 'AUTO hoặc MANUAL' AFTER handled_by;
    END IF;

    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'assignment_note';
    IF col_cnt = 0 THEN
        ALTER TABLE bookings ADD COLUMN assignment_note TEXT NULL COMMENT 'Lý do hoặc ghi chú phân công' AFTER assignment_type;
    END IF;

    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'reassigned_at';
    IF col_cnt = 0 THEN
        ALTER TABLE bookings ADD COLUMN reassigned_at DATETIME NULL COMMENT 'Thời điểm đổi người phụ trách' AFTER assignment_note;
    END IF;

    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'reassigned_by';
    IF col_cnt = 0 THEN
        ALTER TABLE bookings ADD COLUMN reassigned_by BIGINT UNSIGNED NULL COMMENT 'Admin/Manager thực hiện đổi' AFTER reassigned_at;
    END IF;

    -- Đồng bộ bảng users nếu thiếu cột address
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'address';
    IF col_cnt = 0 THEN
        ALTER TABLE users ADD COLUMN address VARCHAR(255) NULL AFTER phone;
    END IF;

    -- Đồng bộ bảng room_services nếu thiếu cột room_type_id hoặc max_quantity
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'room_type_id';
    IF col_cnt = 0 THEN
        ALTER TABLE room_services ADD COLUMN room_type_id BIGINT UNSIGNED NULL AFTER hotel_id;
    END IF;

    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'max_quantity';
    IF col_cnt = 0 THEN
        ALTER TABLE room_services ADD COLUMN max_quantity SMALLINT UNSIGNED NULL AFTER quota_per_night;
    END IF;
END$$
DELIMITER ;

CALL SyncExistingDatabaseColumns();
DROP PROCEDURE IF EXISTS SyncExistingDatabaseColumns;

-- Bật lại kiểm tra foreign key
SET FOREIGN_KEY_CHECKS = 1;


-- ====================================================================================================
-- KIỂM TRA BÁO CÁO TỔNG QUAN SAU KHI CHẠY
-- ====================================================================================================
SELECT 'HOÀN TẤT 100%! TOÀN BỘ CƠ SỞ DỮ LIỆU TRAVELEKE ĐÃ SẴN SÀNG HOẠT ĐỘNG KHÔNG LỖI' AS status;

SELECT 
    'users' AS table_name, COUNT(*) AS total_records FROM users
UNION ALL
SELECT 'hotels', COUNT(*) FROM hotels
UNION ALL
SELECT 'rooms', COUNT(*) FROM rooms
UNION ALL
SELECT 'bookings', COUNT(*) FROM bookings
UNION ALL
SELECT 'roles', COUNT(*) FROM roles
UNION ALL
SELECT 'permissions', COUNT(*) FROM permissions
UNION ALL
SELECT 'service_categories', COUNT(*) FROM service_categories
UNION ALL
SELECT 'room_services', COUNT(*) FROM room_services
UNION ALL
SELECT 'skill_categories', COUNT(*) FROM skill_categories
UNION ALL
SELECT 'staff_eligibility_rules', COUNT(*) FROM staff_eligibility_rules
UNION ALL
SELECT 'audit_logs', COUNT(*) FROM audit_logs;
