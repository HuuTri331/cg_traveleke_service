DROP DATABASE IF EXISTS hotel_booking_db;

CREATE DATABASE hotel_booking_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE hotel_booking_db;

-- ============================================================
-- 1. USERS
-- Dùng chung cho CUSTOMER, EMPLOYEE và ADMIN
-- ============================================================
CREATE TABLE users (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    full_name           VARCHAR(150) NOT NULL,
    email               VARCHAR(255) NOT NULL,
    phone               VARCHAR(20) NULL,
    password            VARCHAR(255) NOT NULL,
    avatar_url          VARCHAR(500) NULL,
    date_of_birth       DATE NULL,
    gender              VARCHAR(20) NULL,
    role                VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER',
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    email_verified_at   DATETIME NULL,
    last_login_at       DATETIME NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                                      ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME NULL,

    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT uq_users_phone UNIQUE (phone),

    CONSTRAINT chk_users_gender
        CHECK (
            gender IS NULL
            OR gender IN ('MALE', 'FEMALE', 'OTHER')
        ),

    CONSTRAINT chk_users_role
        CHECK (
            role IN ('CUSTOMER', 'EMPLOYEE', 'ADMIN')
        ),

    CONSTRAINT chk_users_status
        CHECK (
            status IN ('ACTIVE', 'BLOCKED', 'INACTIVE')
        ),

    INDEX idx_users_role (role),
    INDEX idx_users_status (status)
) ENGINE=InnoDB;

-- ============================================================
-- 2. LOCATIONS
-- Lưu quốc gia, tỉnh/thành phố, quận/huyện...
-- parent_id tạo cấu trúc địa điểm cha - con
-- ============================================================
CREATE TABLE locations (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    parent_id   BIGINT UNSIGNED NULL,
    code        VARCHAR(50) NULL,
    name        VARCHAR(150) NOT NULL,
    type        VARCHAR(30) NOT NULL,
    latitude    DECIMAL(10,7) NULL,
    longitude   DECIMAL(10,7) NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_locations PRIMARY KEY (id),
    CONSTRAINT uq_locations_code UNIQUE (code),

    CONSTRAINT fk_locations_parent
        FOREIGN KEY (parent_id)
        REFERENCES locations(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT chk_locations_type
        CHECK (
            type IN (
                'COUNTRY',
                'PROVINCE',
                'CITY',
                'DISTRICT',
                'WARD',
                'AREA'
            )
        ),

    CONSTRAINT chk_locations_status
        CHECK (
            status IN ('ACTIVE', 'INACTIVE')
        ),

    INDEX idx_locations_parent_id (parent_id),
    INDEX idx_locations_name (name),
    INDEX idx_locations_type (type)
) ENGINE=InnoDB;

-- ============================================================
-- 3. HOTEL TYPES
-- Phân loại: HOTEL, RESORT, HOMESTAY, HOSTEL, VILLA...
-- ============================================================
CREATE TABLE hotel_types (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code        VARCHAR(50) NOT NULL,
    name        VARCHAR(100) NOT NULL,
    description TEXT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_hotel_types PRIMARY KEY (id),
    CONSTRAINT uq_hotel_types_code UNIQUE (code),

    CONSTRAINT chk_hotel_types_status
        CHECK (
            status IN ('ACTIVE', 'INACTIVE')
        )
) ENGINE=InnoDB;

-- ============================================================
-- 4. HOTELS
-- Thông tin khách sạn cơ bản, chưa phân loại phòng
-- ============================================================
CREATE TABLE hotels (
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
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME NULL,

    CONSTRAINT pk_hotels PRIMARY KEY (id),
    CONSTRAINT uq_hotels_slug UNIQUE (slug),

    CONSTRAINT fk_hotels_hotel_type
        FOREIGN KEY (hotel_type_id)
        REFERENCES hotel_types(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_hotels_location
        FOREIGN KEY (location_id)
        REFERENCES locations(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_hotels_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT chk_hotels_star_rating
        CHECK (
            star_rating IS NULL
            OR star_rating BETWEEN 1 AND 5
        ),

    CONSTRAINT chk_hotels_status
        CHECK (
            status IN ('DRAFT', 'ACTIVE', 'INACTIVE')
        ),

    INDEX idx_hotels_hotel_type_id (hotel_type_id),
    INDEX idx_hotels_location_id (location_id),
    INDEX idx_hotels_created_by (created_by),
    INDEX idx_hotels_status (status)
) ENGINE=InnoDB;

-- ============================================================
-- 5. HOTEL STAFF
-- Phân công nhân viên/admin quản lý khách sạn
-- ============================================================
CREATE TABLE hotel_staff (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    hotel_id        BIGINT UNSIGNED NOT NULL,
    staff_user_id   BIGINT UNSIGNED NOT NULL,
    staff_role      VARCHAR(30) NOT NULL DEFAULT 'EMPLOYEE',
    assigned_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_hotel_staff PRIMARY KEY (id),

    CONSTRAINT uq_hotel_staff_assignment
        UNIQUE (hotel_id, staff_user_id),

    CONSTRAINT fk_hotel_staff_hotel
        FOREIGN KEY (hotel_id)
        REFERENCES hotels(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_hotel_staff_user
        FOREIGN KEY (staff_user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT chk_hotel_staff_role
        CHECK (
            staff_role IN ('MANAGER', 'EMPLOYEE')
        ),

    CONSTRAINT chk_hotel_staff_status
        CHECK (
            status IN ('ACTIVE', 'INACTIVE')
        ),

    INDEX idx_hotel_staff_hotel_id (hotel_id),
    INDEX idx_hotel_staff_user_id (staff_user_id)
) ENGINE=InnoDB;

-- ============================================================
-- 6. TRIP PLANS
-- Lưu nơi xuất phát, nơi đến và thời gian di chuyển
-- ============================================================
CREATE TABLE trip_plans (
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
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_trip_plans PRIMARY KEY (id),

    CONSTRAINT fk_trip_plans_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_trip_plans_origin
        FOREIGN KEY (origin_location_id)
        REFERENCES locations(id),

    CONSTRAINT fk_trip_plans_destination
        FOREIGN KEY (destination_location_id)
        REFERENCES locations(id),

    CONSTRAINT chk_trip_plans_locations
        CHECK (
            origin_location_id <> destination_location_id
        ),

    CONSTRAINT chk_trip_plans_times
        CHECK (
            arrival_at IS NULL
            OR arrival_at > departure_at
        ),

    CONSTRAINT chk_trip_plans_travelers
        CHECK (
            traveler_count >= 1
        ),

    CONSTRAINT chk_trip_plans_budget
        CHECK (
            budget IS NULL
            OR budget >= 0
        ),

    CONSTRAINT chk_trip_plans_status
        CHECK (
            status IN ('DRAFT', 'PLANNED', 'COMPLETED', 'CANCELLED')
        ),

    INDEX idx_trip_plans_user_id (user_id),
    INDEX idx_trip_plans_origin_id (origin_location_id),
    INDEX idx_trip_plans_destination_id (destination_location_id),
    INDEX idx_trip_plans_departure_at (departure_at),
    INDEX idx_trip_plans_status (status)
) ENGINE=InnoDB;

-- ============================================================
-- 7. BOOKINGS
-- Booking khách sạn cơ bản, chưa có loại phòng/phòng thực tế
-- ============================================================
CREATE TABLE bookings (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_code            VARCHAR(30) NOT NULL,

    user_id                 BIGINT UNSIGNED NOT NULL,
    hotel_id                BIGINT UNSIGNED NOT NULL,
    trip_plan_id            BIGINT UNSIGNED NULL,
    handled_by              BIGINT UNSIGNED NULL,

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
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_bookings PRIMARY KEY (id),
    CONSTRAINT uq_bookings_code UNIQUE (booking_code),

    CONSTRAINT fk_bookings_customer
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_bookings_hotel
        FOREIGN KEY (hotel_id)
        REFERENCES hotels(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_bookings_trip_plan
        FOREIGN KEY (trip_plan_id)
        REFERENCES trip_plans(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT fk_bookings_handled_by
        FOREIGN KEY (handled_by)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT chk_bookings_dates
        CHECK (
            check_out_at > check_in_at
        ),

    CONSTRAINT chk_bookings_guests
        CHECK (
            total_guests >= 1
        ),

    CONSTRAINT chk_bookings_room_count
        CHECK (
            requested_room_count >= 1
        ),

    CONSTRAINT chk_bookings_estimated_total
        CHECK (
            estimated_total >= 0
        ),

    CONSTRAINT chk_bookings_status
        CHECK (
            status IN (
                'PENDING',
                'CONFIRMED',
                'REJECTED',
                'CHECKED_IN',
                'COMPLETED',
                'CANCELLED'
            )
        ),

    INDEX idx_bookings_user_id (user_id),
    INDEX idx_bookings_hotel_id (hotel_id),
    INDEX idx_bookings_trip_plan_id (trip_plan_id),
    INDEX idx_bookings_handled_by (handled_by),
    INDEX idx_bookings_dates (check_in_at, check_out_at),
    INDEX idx_bookings_status (status)
) ENGINE=InnoDB;

-- ============================================================
-- 8. BOOKING STATUS LOGS
-- Lưu lịch sử thay đổi trạng thái booking
-- ============================================================
CREATE TABLE booking_status_logs (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id      BIGINT UNSIGNED NOT NULL,
    changed_by      BIGINT UNSIGNED NOT NULL,
    old_status      VARCHAR(30) NULL,
    new_status      VARCHAR(30) NOT NULL,
    note            VARCHAR(500) NULL,
    changed_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_booking_status_logs PRIMARY KEY (id),

    CONSTRAINT fk_booking_status_logs_booking
        FOREIGN KEY (booking_id)
        REFERENCES bookings(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_booking_status_logs_user
        FOREIGN KEY (changed_by)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT chk_booking_status_logs_old_status
        CHECK (
            old_status IS NULL
            OR old_status IN (
                'PENDING',
                'CONFIRMED',
                'REJECTED',
                'CHECKED_IN',
                'COMPLETED',
                'CANCELLED'
            )
        ),

    CONSTRAINT chk_booking_status_logs_new_status
        CHECK (
            new_status IN (
                'PENDING',
                'CONFIRMED',
                'REJECTED',
                'CHECKED_IN',
                'COMPLETED',
                'CANCELLED'
            )
        ),

    INDEX idx_booking_status_logs_booking_id (booking_id),
    INDEX idx_booking_status_logs_changed_by (changed_by),
    INDEX idx_booking_status_logs_changed_at (changed_at)
) ENGINE=InnoDB;

-- ============================================================
-- DỮ LIỆU MẪU CHO HOTEL TYPES
-- ============================================================
INSERT INTO hotel_types (code, name, description)
VALUES
    ('HOTEL', 'Khách sạn', 'Cơ sở lưu trú dạng khách sạn'),
    ('RESORT', 'Khu nghỉ dưỡng', 'Khu nghỉ dưỡng có nhiều dịch vụ'),
    ('HOMESTAY', 'Homestay', 'Mô hình lưu trú gần gũi địa phương'),
    ('HOSTEL', 'Hostel', 'Lưu trú tiết kiệm hoặc phòng tập thể'),
    ('VILLA', 'Biệt thự nghỉ dưỡng', 'Biệt thự dành cho nhóm hoặc gia đình');

-- ============================================================
-- KIỂM TRA KẾT QUẢ
-- ============================================================
SHOW TABLES;

SELECT
    TABLE_NAME,
    COLUMN_NAME,
    CONSTRAINT_NAME,
    REFERENCED_TABLE_NAME,
    REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'hotel_booking_db'
  AND REFERENCED_TABLE_NAME IS NOT NULL