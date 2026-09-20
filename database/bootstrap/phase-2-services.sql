-- ============================================================
-- PHASE 2 MIGRATION: Quản Lý Dịch Vụ Phòng & Năng Lực Nhân Sự
-- Chạy sau phase-1-schema.sql
-- ============================================================

USE hotel_booking_db;

-- ============================================================
-- PHẦN 1: QUẢN LÝ DỊCH VỤ PHÒNG
-- ============================================================

-- 1. SERVICE_CATEGORIES
-- Danh mục dịch vụ: Dọn phòng, Giặt ủi, Ăn uống, Spa...
-- ============================================================
CREATE TABLE IF NOT EXISTS service_categories (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code        VARCHAR(60) NOT NULL,
    name        VARCHAR(150) NOT NULL,
    description TEXT NULL,
    icon        VARCHAR(100) NULL COMMENT 'Tên icon Lucide hoặc emoji',
    sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_service_categories PRIMARY KEY (id),
    CONSTRAINT uq_service_categories_code UNIQUE (code),

    CONSTRAINT chk_service_categories_status
        CHECK (status IN ('ACTIVE', 'INACTIVE')),

    INDEX idx_service_categories_status (status),
    INDEX idx_service_categories_sort (sort_order)
) ENGINE=InnoDB;

-- ============================================================
-- 2. ROOM_SERVICES
-- Dịch vụ cụ thể gắn với loại phòng hoặc toàn bộ khách sạn
-- ============================================================
CREATE TABLE IF NOT EXISTS room_services (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    category_id         BIGINT UNSIGNED NOT NULL,
    hotel_id            BIGINT UNSIGNED NULL COMMENT 'NULL = áp dụng toàn hệ thống',
    room_type_id        BIGINT UNSIGNED NULL COMMENT 'NULL = áp dụng toàn khách sạn',

    name                VARCHAR(200) NOT NULL,
    description         TEXT NULL,
    unit                VARCHAR(50) NOT NULL DEFAULT 'lần' COMMENT 'lần, ngày, giờ, phần, kg...',
    base_price          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    is_complimentary    TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = miễn phí',
    max_quantity        SMALLINT UNSIGNED NULL COMMENT 'NULL = không giới hạn',

    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_room_services PRIMARY KEY (id),

    CONSTRAINT fk_room_services_category
        FOREIGN KEY (category_id)
        REFERENCES service_categories(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_room_services_hotel
        FOREIGN KEY (hotel_id)
        REFERENCES hotels(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT chk_room_services_price
        CHECK (base_price >= 0),

    CONSTRAINT chk_room_services_status
        CHECK (status IN ('ACTIVE', 'INACTIVE')),

    INDEX idx_room_services_category (category_id),
    INDEX idx_room_services_hotel (hotel_id),
    INDEX idx_room_services_status (status)
) ENGINE=InnoDB;

-- ============================================================
-- 3. SERVICE_REQUESTS
-- Yêu cầu dịch vụ từ booking (snapshot giá tại thời điểm đặt)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_requests (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id      BIGINT UNSIGNED NOT NULL,
    service_id      BIGINT UNSIGNED NOT NULL,
    assigned_to     BIGINT UNSIGNED NULL COMMENT 'Nhân viên xử lý',

    -- Snapshot tại thời điểm đặt
    service_name    VARCHAR(200) NOT NULL,
    unit_price      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    quantity        SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    total_price     DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    note            TEXT NULL,
    scheduled_at    DATETIME NULL COMMENT 'Thời điểm yêu cầu thực hiện',
    completed_at    DATETIME NULL,

    status          VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_service_requests PRIMARY KEY (id),

    CONSTRAINT fk_service_requests_booking
        FOREIGN KEY (booking_id)
        REFERENCES bookings(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_service_requests_service
        FOREIGN KEY (service_id)
        REFERENCES room_services(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_service_requests_assigned
        FOREIGN KEY (assigned_to)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT chk_service_requests_quantity
        CHECK (quantity >= 1),

    CONSTRAINT chk_service_requests_status
        CHECK (
            status IN (
                'PENDING',
                'ASSIGNED',
                'IN_PROGRESS',
                'COMPLETED',
                'CANCELLED'
            )
        ),

    INDEX idx_service_requests_booking (booking_id),
    INDEX idx_service_requests_service (service_id),
    INDEX idx_service_requests_assigned (assigned_to),
    INDEX idx_service_requests_status (status),
    INDEX idx_service_requests_scheduled (scheduled_at)
) ENGINE=InnoDB;

-- ============================================================
-- PHẦN 2: HỒ SƠ NĂNG LỰC NHÂN SỰ
-- ============================================================

-- 4. SKILL_CATEGORIES
-- Danh mục kỹ năng: Lễ tân, Buồng phòng, F&B, Kỹ thuật...
-- ============================================================
CREATE TABLE IF NOT EXISTS skill_categories (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code        VARCHAR(60) NOT NULL,
    name        VARCHAR(150) NOT NULL,
    description TEXT NULL,
    department  VARCHAR(60) NULL COMMENT 'Phòng ban liên quan',
    status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_skill_categories PRIMARY KEY (id),
    CONSTRAINT uq_skill_categories_code UNIQUE (code),

    CONSTRAINT chk_skill_categories_status
        CHECK (status IN ('ACTIVE', 'INACTIVE')),

    INDEX idx_skill_categories_status (status)
) ENGINE=InnoDB;

-- ============================================================
-- 5. STAFF_SKILLS
-- Bản đồ kỹ năng nhân viên (thang năng lực 1-5)
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_skills (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id         BIGINT UNSIGNED NOT NULL,
    skill_id        BIGINT UNSIGNED NOT NULL,

    level           TINYINT UNSIGNED NOT NULL DEFAULT 1
                        COMMENT '1=Cơ bản, 2=Trung cấp, 3=Thành thạo, 4=Chuyên gia, 5=Xuất sắc',
    years_exp       DECIMAL(4,1) NULL COMMENT 'Số năm kinh nghiệm',
    certificate     VARCHAR(200) NULL COMMENT 'Tên chứng chỉ nếu có',
    note            TEXT NULL,

    verified_by     BIGINT UNSIGNED NULL COMMENT 'Admin xác nhận kỹ năng',
    verified_at     DATETIME NULL,

    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_staff_skills PRIMARY KEY (id),
    CONSTRAINT uq_staff_skills_user_skill UNIQUE (user_id, skill_id),

    CONSTRAINT fk_staff_skills_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_staff_skills_skill
        FOREIGN KEY (skill_id)
        REFERENCES skill_categories(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_staff_skills_verifier
        FOREIGN KEY (verified_by)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT chk_staff_skills_level
        CHECK (level BETWEEN 1 AND 5),

    CONSTRAINT chk_staff_skills_years
        CHECK (years_exp IS NULL OR years_exp >= 0),

    INDEX idx_staff_skills_user (user_id),
    INDEX idx_staff_skills_skill (skill_id),
    INDEX idx_staff_skills_level (level)
) ENGINE=InnoDB;

-- ============================================================
-- 6. STAFF_ASSIGNMENTS
-- Phân công nhân viên xử lý yêu cầu dịch vụ
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_assignments (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    service_request_id  BIGINT UNSIGNED NOT NULL,
    assigned_staff_id   BIGINT UNSIGNED NOT NULL,
    assigned_by         BIGINT UNSIGNED NOT NULL COMMENT 'Admin/Manager phân công',

    difficulty_level    TINYINT UNSIGNED NOT NULL DEFAULT 1
                            COMMENT '1-5: độ khó của yêu cầu dịch vụ',
    note                TEXT NULL,
    started_at          DATETIME NULL,
    completed_at        DATETIME NULL,
    rating              TINYINT UNSIGNED NULL COMMENT '1-5: đánh giá sau hoàn thành',

    status              VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_staff_assignments PRIMARY KEY (id),

    CONSTRAINT fk_staff_assignments_request
        FOREIGN KEY (service_request_id)
        REFERENCES service_requests(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_staff_assignments_staff
        FOREIGN KEY (assigned_staff_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_staff_assignments_assigner
        FOREIGN KEY (assigned_by)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT chk_staff_assignments_difficulty
        CHECK (difficulty_level BETWEEN 1 AND 5),

    CONSTRAINT chk_staff_assignments_rating
        CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),

    CONSTRAINT chk_staff_assignments_status
        CHECK (
            status IN (
                'ASSIGNED',
                'ACCEPTED',
                'IN_PROGRESS',
                'COMPLETED',
                'REASSIGNED'
            )
        ),

    INDEX idx_staff_assignments_request (service_request_id),
    INDEX idx_staff_assignments_staff (assigned_staff_id),
    INDEX idx_staff_assignments_status (status)
) ENGINE=InnoDB;

-- ============================================================
-- SEED DATA MẪU – SERVICE CATEGORIES
-- ============================================================
INSERT INTO service_categories (code, name, description, icon, sort_order)
VALUES
    ('HOUSEKEEPING',  'Dọn phòng',          'Dịch vụ vệ sinh và dọn dẹp phòng',         'Sparkles',     1),
    ('LAUNDRY',       'Giặt ủi',            'Giặt sấy và ủi quần áo',                   'WashingMachine',2),
    ('FOOD_BEVERAGE', 'Ăn uống tại phòng',  'Room service: đồ ăn và thức uống',         'UtensilsCrossed',3),
    ('SPA_WELLNESS',  'Spa & Sức khỏe',     'Massage, chăm sóc sức khỏe và thư giãn',  'Heart',        4),
    ('TRANSPORT',     'Vận chuyển',          'Đưa đón sân bay và thuê xe',               'Car',          5),
    ('CONCIERGE',     'Hỗ trợ đặc biệt',    'Tour, vé, đặt nhà hàng và hỗ trợ đặc biệt','Star',        6),
    ('TECH_SUPPORT',  'Hỗ trợ kỹ thuật',    'Wifi, thiết bị điện tử, sửa chữa tại phòng','Wifi',        7),
    ('CHILDCARE',     'Chăm sóc trẻ em',    'Giữ trẻ và các hoạt động dành cho trẻ',   'Baby',         8)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ============================================================
-- SEED DATA MẪU – SKILL CATEGORIES
-- ============================================================
INSERT INTO skill_categories (code, name, description, department)
VALUES
    ('FRONT_DESK',     'Lễ Tân & Đón Tiếp',    'Kỹ năng tiếp đón, check-in/out, giao tiếp khách hàng',        'Lễ tân'),
    ('HOUSEKEEPING',   'Quản Gia & Buồng Phòng','Vệ sinh, sắp xếp phòng, kiểm tra trang thiết bị',            'Buồng phòng'),
    ('FOOD_BEVERAGE',  'F&B – Ẩm Thực',         'Phục vụ bàn, pha chế, chế biến món ăn',                      'F&B'),
    ('MAINTENANCE',    'Kỹ Thuật & Bảo Trì',    'Sửa chữa điện, nước, điều hòa, thang máy',                   'Kỹ thuật'),
    ('SPA_MASSAGE',    'Spa & Massage',           'Kỹ thuật massage, chăm sóc da, liệu pháp thư giãn',          'Spa'),
    ('SECURITY',       'An Ninh & Bảo Vệ',       'Tuần tra, xử lý tình huống khẩn cấp, kiểm soát ra vào',     'An ninh'),
    ('MANAGEMENT',     'Quản Lý & Giám Sát',     'Lập kế hoạch, điều phối nhân sự, báo cáo vận hành',         'Ban quản lý'),
    ('CUSTOMER_CARE',  'Chăm Sóc Khách Hàng',   'Xử lý khiếu nại, hỗ trợ đặt dịch vụ, upselling',           'CSKH'),
    ('LANG_ENGLISH',   'Ngoại Ngữ – Tiếng Anh', 'Giao tiếp bằng tiếng Anh với khách quốc tế',                'Đa dịch vụ'),
    ('LANG_CHINESE',   'Ngoại Ngữ – Tiếng Trung','Giao tiếp bằng tiếng Trung với khách quốc tế',             'Đa dịch vụ')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ============================================================
-- KIỂM TRA
-- ============================================================
SELECT 'Phase 2 migration completed!' AS status;
SHOW TABLES LIKE '%service%';
SHOW TABLES LIKE '%skill%';
SHOW TABLES LIKE '%staff_assign%';
