-- ====================================================================================================
-- TRAVELEKE SYSTEM - PHASE 2 UNIFIED COMPLETE MIGRATION (TOÀN BỘ TÍNH NĂNG GIAI ĐOẠN 2 GOM TRONG 1 FILE)
-- ====================================================================================================
-- Gom đầy đủ và chuẩn hóa 100%:
--   1. RBAC (Phân quyền: roles, permissions, role_permissions & seeds)
--   2. Phân công nhân sự đặt phòng (hotel staff assignment columns cho bảng bookings)
--   3. Quản lý dịch vụ phòng & Add-ons (service_categories, room_services, service_requests, 
--      booking_service_snapshots, service_recovery_log & seeds)
--   4. Hồ sơ năng lực & Phân công công việc (skill_categories, staff_skills, staff_language_skills,
--      staff_assignments, staff_eligibility_rules & seeds)
-- 
-- TÍNH NĂNG ĐẶC BIỆT:
--   - Chuẩn IDEMPOTENT (Chạy 1 lần hay 100 lần đều an toàn, không sinh lỗi duplicate).
--   - Tương thích cả khi khởi tạo database mới hoặc cập nhật từ database cũ của nhánh git khác.
-- ====================================================================================================

USE hotel_booking_db;

-- Tắt kiểm tra foreign key tạm thời để tránh xung đột thứ tự ràng buộc khi import
SET FOREIGN_KEY_CHECKS = 0;

-- ====================================================================================================
-- PHẦN 1: RBAC (ROLE-BASED ACCESS CONTROL)
-- ====================================================================================================

-- 1.1 Bảng Roles
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

-- 1.2 Bảng Permissions
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

-- 1.3 Bảng Role_Permissions
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

-- 1.4 Seed Roles
INSERT INTO roles (id, name, display_name, description, is_system) VALUES
    (1, 'ADMIN',    'Quản Trị Viên', 'Toàn quyền quản trị hệ thống', 1),
    (2, 'EMPLOYEE', 'Nhân Viên',     'Quản lý khách sạn, phòng, đơn đặt phòng và dịch vụ', 1),
    (3, 'CUSTOMER', 'Khách Hàng',    'Đặt phòng và quản lý chuyến đi cá nhân', 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- 1.5 Seed Permissions
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

-- 1.6 Seed Role_Permissions (ADMIN full quyền)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions;

-- 1.7 Seed Role_Permissions (EMPLOYEE quyền vận hành)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions
WHERE name IN (
    'hotels.create', 'hotels.read', 'hotels.update', 'hotels.manage_images',
    'rooms.create',  'rooms.read',  'rooms.update',  'rooms.manage_images',
    'bookings.read', 'bookings.update_status',
    'services.read', 'skills.read'
);


-- ====================================================================================================
-- PHẦN 2: BỔ SUNG CỘT PHÂN CÔNG VÀO BẢNG BOOKINGS (HOTEL ASSIGNMENTS)
-- ====================================================================================================

-- Procedure an toàn: Kiểm tra nếu cột chưa có trong bookings thì mới ADD, tránh throw duplicate column error
DROP PROCEDURE IF EXISTS AddBookingAssignmentColumns;
DELIMITER $$
CREATE PROCEDURE AddBookingAssignmentColumns()
BEGIN
    DECLARE col_exists INT DEFAULT 0;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'assignment_type';
    IF col_exists = 0 THEN
        ALTER TABLE bookings ADD COLUMN assignment_type VARCHAR(20) NOT NULL DEFAULT 'AUTO' COMMENT 'AUTO hoặc MANUAL' AFTER handled_by;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'assignment_note';
    IF col_exists = 0 THEN
        ALTER TABLE bookings ADD COLUMN assignment_note TEXT NULL COMMENT 'Lý do hoặc ghi chú phân công' AFTER assignment_type;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'reassigned_at';
    IF col_exists = 0 THEN
        ALTER TABLE bookings ADD COLUMN reassigned_at DATETIME NULL COMMENT 'Thời điểm đổi người phụ trách' AFTER assignment_note;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'reassigned_by';
    IF col_exists = 0 THEN
        ALTER TABLE bookings ADD COLUMN reassigned_by BIGINT UNSIGNED NULL COMMENT 'Admin/Manager thực hiện đổi' AFTER reassigned_at;
    END IF;
END$$
DELIMITER ;

CALL AddBookingAssignmentColumns();
DROP PROCEDURE IF EXISTS AddBookingAssignmentColumns;


-- ====================================================================================================
-- PHẦN 3: QUẢN LÝ DỊCH VỤ PHÒNG & ADD-ONS (ROOM SERVICES & SERVICE REQUESTS)
-- ====================================================================================================

-- 3.1 Bảng Service_Categories (Danh mục dịch vụ)
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

-- 3.2 Bảng Room_Services (Dịch vụ phòng đầy đủ các cột nghiệp vụ và Add-ons)
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

    -- Các cột Addon nghiệp vụ
    service_type        VARCHAR(30) NOT NULL DEFAULT 'ADD_ON' COMMENT 'INCLUDED, ADD_ON, QUOTA, MINIBAR, OPERATIONAL',
    quota_per_booking   SMALLINT UNSIGNED NULL COMMENT 'Số lượng miễn phí / booking (NULL = không giới hạn)',
    quota_per_night     SMALLINT UNSIGNED NULL COMMENT 'Số lượng miễn phí / đêm (NULL = không áp dụng)',
    sla_minutes         SMALLINT UNSIGNED NULL DEFAULT 30 COMMENT 'Thời gian tối đa hoàn tất dịch vụ (phút)',
    capacity_per_hour   SMALLINT UNSIGNED NULL COMMENT 'Số slot phục vụ tối đa mỗi giờ (NULL = không giới hạn)',
    lead_time_hours     TINYINT UNSIGNED NULL DEFAULT 0 COMMENT 'Số giờ cần đặt trước (0 = không cần)',
    requires_approval   TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = cần phê duyệt Supervisor',
    department_owner    VARCHAR(60) NULL COMMENT 'Bộ phận chịu trách nhiệm',

    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_room_services PRIMARY KEY (id),
    CONSTRAINT fk_room_services_category FOREIGN KEY (category_id) REFERENCES service_categories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_room_services_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON UPDATE CASCADE ON DELETE CASCADE,
    INDEX idx_room_services_category (category_id),
    INDEX idx_room_services_hotel (hotel_id),
    INDEX idx_room_services_type (service_type),
    INDEX idx_room_services_status (status)
) ENGINE=InnoDB;

-- 3.3 Bảng Service_Requests (Yêu cầu dịch vụ đầy đủ các cột SLA và Service Recovery)
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
    accepted_at     DATETIME NULL COMMENT 'Thời điểm nhân viên confirm nhận yêu cầu',
    started_at      DATETIME NULL COMMENT 'Thời điểm bắt đầu thực hiện',
    completed_at    DATETIME NULL COMMENT 'Thời điểm hoàn tất',
    confirmed_at    DATETIME NULL COMMENT 'Thời điểm khách xác nhận hoàn tất',
    sla_due_at      DATETIME NULL COMMENT 'Deadline SLA',
    is_sla_breached TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = đã vượt SLA',

    -- Service Recovery nếu có vấn đề
    failure_reason       TEXT NULL,
    recovery_action      VARCHAR(200) NULL,
    recovery_approved_by BIGINT UNSIGNED NULL,
    recovery_cost        DECIMAL(12,2) NULL,

    status          VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_service_requests PRIMARY KEY (id),
    CONSTRAINT fk_service_requests_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_service_requests_service FOREIGN KEY (service_id) REFERENCES room_services(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_service_requests_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_service_requests_recovery_approver FOREIGN KEY (recovery_approved_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_service_requests_booking (booking_id),
    INDEX idx_service_requests_service (service_id),
    INDEX idx_service_requests_assigned (assigned_to),
    INDEX idx_service_requests_status (status),
    INDEX idx_service_requests_scheduled (scheduled_at)
) ENGINE=InnoDB;

-- 3.4 Bảng Booking_Service_Snapshots (Snapshot quyền lợi dịch vụ khi booking được xác nhận)
CREATE TABLE IF NOT EXISTS booking_service_snapshots (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id          BIGINT UNSIGNED NOT NULL,
    service_id          BIGINT UNSIGNED NOT NULL,

    service_name        VARCHAR(200) NOT NULL,
    service_type        VARCHAR(30) NOT NULL DEFAULT 'INCLUDED',
    category_name       VARCHAR(150) NULL,
    unit                VARCHAR(50) NOT NULL DEFAULT 'lần',
    base_price          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    is_complimentary    TINYINT(1) NOT NULL DEFAULT 0,

    quota_included      SMALLINT UNSIGNED NULL COMMENT 'Số lượng được hưởng miễn phí',
    quota_used          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    quota_per_night     SMALLINT UNSIGNED NULL,

    status              VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    note                TEXT NULL,

    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_booking_service_snapshots PRIMARY KEY (id),
    CONSTRAINT uq_booking_service_snapshot UNIQUE (booking_id, service_id),
    CONSTRAINT fk_bss_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_bss_service FOREIGN KEY (service_id) REFERENCES room_services(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_bss_booking (booking_id),
    INDEX idx_bss_service (service_id),
    INDEX idx_bss_type (service_type)
) ENGINE=InnoDB;

-- 3.5 Bảng Service_Recovery_Log (Log đền bù/Service Recovery)
CREATE TABLE IF NOT EXISTS service_recovery_log (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    service_request_id  BIGINT UNSIGNED NULL COMMENT 'Yêu cầu dịch vụ gốc nếu có',
    booking_id          BIGINT UNSIGNED NOT NULL,
    reported_by         BIGINT UNSIGNED NOT NULL COMMENT 'Nhân viên báo cáo',
    approved_by         BIGINT UNSIGNED NULL COMMENT 'Supervisor/Manager duyệt',

    recovery_type       VARCHAR(30) NOT NULL COMMENT 'COMPLIMENTARY, WAIVE, UPGRADE, COMPENSATION, APOLOGY',
    reason              TEXT NOT NULL,
    action_taken        TEXT NOT NULL,
    cost_incurred       DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    approved_at         DATETIME NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING',

    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_service_recovery_log PRIMARY KEY (id),
    CONSTRAINT fk_srl_request FOREIGN KEY (service_request_id) REFERENCES service_requests(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_srl_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_srl_reporter FOREIGN KEY (reported_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_srl_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_srl_booking (booking_id),
    INDEX idx_srl_request (service_request_id),
    INDEX idx_srl_reporter (reported_by),
    INDEX idx_srl_status (status)
) ENGINE=InnoDB;

-- 3.6 Seed Dữ Liệu Danh Mục Dịch Vụ
INSERT INTO service_categories (code, name, description, icon, sort_order)
VALUES
    ('HOUSEKEEPING',  'Dọn phòng',          'Dịch vụ vệ sinh và dọn dẹp phòng',         'Sparkles',     1),
    ('LAUNDRY',       'Giặt ủi',            'Giặt sấy và ủi quần áo',                   'WashingMachine',2),
    ('FOOD_BEVERAGE', 'Ăn uống tại phòng',  'Room service: đồ ăn và thức uống',         'UtensilsCrossed',3),
    ('SPA_WELLNESS',  'Spa & Sức khỏe',     'Massage, chăm sóc sức khỏe và thư giãn',  'Heart',        4),
    ('TRANSPORT',     'Vận chuyển',          'Đưa đón sân bay và thuê xe',               'Car',          5),
    ('CONCIERGE',     'Hỗ trợ đặc biệt',    'Đặt nhà hàng và hỗ trợ đặc biệt',          'Star',        6),
    ('TECH_SUPPORT',  'Hỗ trợ kỹ thuật',    'Wifi, thiết bị điện tử, sửa chữa tại phòng','Wifi',        7),
    ('CHILDCARE',     'Chăm sóc trẻ em',    'Giữ trẻ và các hoạt động dành cho trẻ',   'Baby',         8)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), icon = VALUES(icon);


-- ====================================================================================================
-- PHẦN 4: HỒ SƠ NĂNG LỰC & PHÂN CÔNG NHÂN SỰ (STAFF SKILLS & ASSIGNMENTS)
-- ====================================================================================================

-- 4.1 Bảng Skill_Categories (Danh mục kỹ năng)
CREATE TABLE IF NOT EXISTS skill_categories (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code        VARCHAR(60) NOT NULL,
    name        VARCHAR(150) NOT NULL,
    description TEXT NULL,
    department  VARCHAR(60) NULL COMMENT 'Phòng ban liên quan',
    status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_skill_categories PRIMARY KEY (id),
    CONSTRAINT uq_skill_categories_code UNIQUE (code),
    INDEX idx_skill_categories_status (status)
) ENGINE=InnoDB;

-- 4.2 Bảng Staff_Skills (Bản đồ kỹ năng nhân viên)
CREATE TABLE IF NOT EXISTS staff_skills (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id             BIGINT UNSIGNED NOT NULL,
    skill_id            BIGINT UNSIGNED NOT NULL,

    level               TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1=Cơ bản, 2=Trung cấp, 3=Thành thạo, 4=Chuyên gia, 5=Xuất sắc',
    years_exp           DECIMAL(4,1) NULL COMMENT 'Số năm kinh nghiệm',
    certificate         VARCHAR(200) NULL COMMENT 'Tên chứng chỉ nếu có',
    certificate_expiry  DATE NULL COMMENT 'Ngày hết hạn chứng chỉ (NULL = vĩnh viễn)',
    note                TEXT NULL,

    is_shadow           TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = đang học việc (shadow mode)',
    shadow_mentor_id    BIGINT UNSIGNED NULL COMMENT 'Người kèm cặp',
    eligibility_level   VARCHAR(20) NOT NULL DEFAULT 'STANDARD' COMMENT 'STANDARD, VIP, COMPLEX',

    verified_by         BIGINT UNSIGNED NULL COMMENT 'Admin/Manager xác nhận kỹ năng',
    verified_at         DATETIME NULL,

    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_staff_skills PRIMARY KEY (id),
    CONSTRAINT uq_staff_skills_user_skill UNIQUE (user_id, skill_id),
    CONSTRAINT fk_staff_skills_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_staff_skills_skill FOREIGN KEY (skill_id) REFERENCES skill_categories(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_staff_skills_mentor FOREIGN KEY (shadow_mentor_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_staff_skills_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_staff_skills_user (user_id),
    INDEX idx_staff_skills_skill (skill_id),
    INDEX idx_staff_skills_level (level),
    INDEX idx_staff_skills_eligibility (eligibility_level),
    INDEX idx_staff_skills_shadow (is_shadow)
) ENGINE=InnoDB;

-- 4.3 Bảng Staff_Language_Skills (Trình độ ngoại ngữ của nhân viên)
CREATE TABLE IF NOT EXISTS staff_language_skills (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id             BIGINT UNSIGNED NOT NULL,
    language_code       VARCHAR(10) NOT NULL COMMENT 'vi, en, zh, ja, ko, fr, de...',
    language_name       VARCHAR(60) NOT NULL,
    level               VARCHAR(20) NOT NULL DEFAULT 'BASIC' COMMENT 'BASIC, INTERMEDIATE, ADVANCED, NATIVE',
    certificate         VARCHAR(200) NULL COMMENT 'IELTS 7.0, TOEIC 850, HSK 5...',
    certificate_expiry  DATE NULL,
    verified_by         BIGINT UNSIGNED NULL,
    verified_at         DATETIME NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_staff_language_skills PRIMARY KEY (id),
    CONSTRAINT uq_staff_language UNIQUE (user_id, language_code),
    CONSTRAINT fk_sls_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_sls_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_sls_user (user_id),
    INDEX idx_sls_language (language_code),
    INDEX idx_sls_level (level)
) ENGINE=InnoDB;

-- 4.4 Bảng Staff_Assignments (Lịch sử phân công dịch vụ & Escalation)
CREATE TABLE IF NOT EXISTS staff_assignments (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    service_request_id      BIGINT UNSIGNED NOT NULL,
    assigned_staff_id       BIGINT UNSIGNED NOT NULL,
    assigned_by             BIGINT UNSIGNED NOT NULL COMMENT 'Admin/Manager phân công',

    difficulty_level        TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1-5: độ khó',
    case_complexity         VARCHAR(20) NOT NULL DEFAULT 'STANDARD' COMMENT 'STANDARD, PREMIUM, VIP, COMPLEX',
    required_language       VARCHAR(10) NULL COMMENT 'Ngôn ngữ yêu cầu (vi, en...)',
    
    is_shadow               TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = học việc',
    shadow_supervisor_id    BIGINT UNSIGNED NULL,
    is_acting               TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = tạm đảm nhận vị trí cao hơn',

    escalated_to            BIGINT UNSIGNED NULL,
    escalated_at            DATETIME NULL,
    escalation_reason       TEXT NULL,

    note                    TEXT NULL,
    started_at              DATETIME NULL,
    completed_at            DATETIME NULL,
    rating                  TINYINT UNSIGNED NULL COMMENT '1-5 sao',
    quality_score           TINYINT UNSIGNED NULL COMMENT 'Điểm QA (1-10)',

    status                  VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED' COMMENT 'ASSIGNED, ACCEPTED, IN_PROGRESS, COMPLETED, REASSIGNED',
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_staff_assignments PRIMARY KEY (id),
    CONSTRAINT fk_staff_assignments_request FOREIGN KEY (service_request_id) REFERENCES service_requests(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_staff_assignments_staff FOREIGN KEY (assigned_staff_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_staff_assignments_assigner FOREIGN KEY (assigned_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_sa_shadow_supervisor FOREIGN KEY (shadow_supervisor_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_sa_escalated_to FOREIGN KEY (escalated_to) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_staff_assignments_request (service_request_id),
    INDEX idx_staff_assignments_staff (assigned_staff_id),
    INDEX idx_staff_assignments_status (status),
    INDEX idx_staff_assignments_complexity (case_complexity),
    INDEX idx_staff_assignments_shadow (is_shadow)
) ENGINE=InnoDB;

-- 4.5 Bảng Staff_Eligibility_Rules (Quy tắc lọc đủ điều kiện trước khi tự động phân công)
CREATE TABLE IF NOT EXISTS staff_eligibility_rules (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    rule_code               VARCHAR(60) NOT NULL,
    case_complexity         VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
    description             TEXT NULL,

    min_skill_level         TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Level tối thiểu (1-5)',
    required_skill_codes    JSON NULL COMMENT 'Mảng mã kỹ năng bắt buộc VD: ["FRONT_DESK","CUSTOMER_CARE"]',
    required_language_codes JSON NULL COMMENT 'Mảng ngôn ngữ bắt buộc VD: ["en","ja"]',

    min_years_experience    DECIMAL(4,1) NOT NULL DEFAULT 0,
    min_cases_completed     SMALLINT UNSIGNED NOT NULL DEFAULT 0,

    exclude_shadow_mode     TINYINT(1) NOT NULL DEFAULT 1,
    require_verified_skills TINYINT(1) NOT NULL DEFAULT 0,

    escalation_role         VARCHAR(30) NULL,
    status                  VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_staff_eligibility_rules PRIMARY KEY (id),
    CONSTRAINT uq_eligibility_rule_code UNIQUE (rule_code),
    INDEX idx_ser_complexity (case_complexity),
    INDEX idx_ser_status (status)
) ENGINE=InnoDB;

-- 4.6 Seed Dữ Liệu Kỹ Năng Nhân Viên
INSERT INTO skill_categories (code, name, description, department)
VALUES
    ('FRONT_DESK',     'Lễ Tân & Đón Tiếp',     'Kỹ năng tiếp đón, check-in/out, giao tiếp khách hàng',        'Lễ tân'),
    ('HOUSEKEEPING',   'Quản Gia & Buồng Phòng', 'Vệ sinh, sắp xếp phòng, kiểm tra trang thiết bị',            'Buồng phòng'),
    ('FOOD_BEVERAGE',  'F&B – Ẩm Thực',          'Phục vụ bàn, pha chế, chế biến món ăn',                      'F&B'),
    ('MAINTENANCE',    'Kỹ Thuật & Bảo Trì',     'Sửa chữa điện, nước, điều hòa, trang thiết bị phòng',         'Kỹ thuật'),
    ('SPA_MASSAGE',    'Spa & Massage',            'Kỹ thuật massage, chăm sóc da, liệu pháp thư giãn',          'Spa'),
    ('SECURITY',       'An Ninh & An Toàn',        'Tuần tra, xử lý tình huống khẩn cấp, kiểm soát ra vào',     'An ninh'),
    ('MANAGEMENT',     'Quản Lý & Giám Sát',      'Lập kế hoạch, điều phối nhân sự, báo cáo vận hành',         'Ban quản lý'),
    ('CUSTOMER_CARE',  'Chăm Sóc Khách Hàng',    'Xử lý phản hồi, hỗ trợ dịch vụ, giải quyết khiếu nại',       'CSKH'),
    ('LANG_ENGLISH',   'Ngoại Ngữ – Tiếng Anh',  'Giao tiếp tiếng Anh lưu loát với khách quốc tế',             'Đa dịch vụ'),
    ('LANG_CHINESE',   'Ngoại Ngữ – Tiếng Trung', 'Giao tiếp tiếng Trung với khách quốc tế',                    'Đa dịch vụ'),
    ('VIP_HANDLING',   'Phục Vụ Khách VIP',      'Kỹ năng chăm sóc khách hàng VIP, phòng Tổng Thống Suite',     'Lễ tân'),
    ('COMPLAINT_MGMT', 'Xử Lý Khiếu Nại',         'Kỹ năng xử lý sự cố phàn nàn, đền bù và giữ chân khách hàng', 'CSKH'),
    ('FIRST_AID',      'Sơ Cứu & Y Tế Khẩn Cấp', 'Sơ cứu cơ bản, xử lý y tế tại chỗ',                          'An toàn')
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), department = VALUES(department);

-- 4.7 Seed Dữ Liệu Quy Tắc Phân Công (Eligibility Rules)
INSERT INTO staff_eligibility_rules
    (rule_code, case_complexity, description, min_skill_level, min_years_experience, min_cases_completed, exclude_shadow_mode, require_verified_skills, escalation_role)
VALUES
    ('RULE_STANDARD', 'STANDARD', 'Case thông thường – booking thường, phòng tiêu chuẩn',
        2, 0, 0, 0, 0, NULL),
    ('RULE_PREMIUM', 'PREMIUM', 'Case cao cấp – phòng Deluxe/Executive, khách doanh nhân',
        3, 1.0, 20, 1, 0, 'EMPLOYEE'),
    ('RULE_VIP', 'VIP', 'Case VIP – Suite cao cấp, khách hàng thân thiết hạng Kim Cương',
        4, 2.0, 50, 1, 1, 'ADMIN'),
    ('RULE_COMPLEX', 'COMPLEX', 'Case phức tạp – sự cố kỹ thuật, phàn nàn dịch vụ, bồi thường',
        3, 1.5, 30, 1, 0, 'ADMIN')
ON DUPLICATE KEY UPDATE description = VALUES(description);


-- ====================================================================================================
-- PHẦN 5: BẢO TOÀN DỮ LIỆU CŨ (MIGRATION PATCH FOR PRE-EXISTING TABLES)
-- Đảm bảo nếu database đã tạo bảng dở dang từ trước vẫn được bổ sung đầy đủ các cột mới mà không bị lỗi
-- ====================================================================================================

DROP PROCEDURE IF EXISTS PatchMissingAddonColumns;
DELIMITER $$
CREATE PROCEDURE PatchMissingAddonColumns()
BEGIN
    DECLARE col_exists INT DEFAULT 0;

    -- room_services patch
    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'service_type';
    IF col_exists = 0 THEN
        ALTER TABLE room_services ADD COLUMN service_type VARCHAR(30) NOT NULL DEFAULT 'ADD_ON' AFTER is_complimentary;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'quota_per_booking';
    IF col_exists = 0 THEN
        ALTER TABLE room_services ADD COLUMN quota_per_booking SMALLINT UNSIGNED NULL AFTER service_type;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'quota_per_night';
    IF col_exists = 0 THEN
        ALTER TABLE room_services ADD COLUMN quota_per_night SMALLINT UNSIGNED NULL AFTER quota_per_booking;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'sla_minutes';
    IF col_exists = 0 THEN
        ALTER TABLE room_services ADD COLUMN sla_minutes SMALLINT UNSIGNED NULL DEFAULT 30 AFTER quota_per_night;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'capacity_per_hour';
    IF col_exists = 0 THEN
        ALTER TABLE room_services ADD COLUMN capacity_per_hour SMALLINT UNSIGNED NULL AFTER sla_minutes;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'lead_time_hours';
    IF col_exists = 0 THEN
        ALTER TABLE room_services ADD COLUMN lead_time_hours TINYINT UNSIGNED NULL DEFAULT 0 AFTER capacity_per_hour;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'requires_approval';
    IF col_exists = 0 THEN
        ALTER TABLE room_services ADD COLUMN requires_approval TINYINT(1) NOT NULL DEFAULT 0 AFTER lead_time_hours;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'department_owner';
    IF col_exists = 0 THEN
        ALTER TABLE room_services ADD COLUMN department_owner VARCHAR(60) NULL AFTER requires_approval;
    END IF;

    -- service_requests patch
    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_requests' AND COLUMN_NAME = 'accepted_at';
    IF col_exists = 0 THEN
        ALTER TABLE service_requests ADD COLUMN accepted_at DATETIME NULL AFTER scheduled_at;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_requests' AND COLUMN_NAME = 'started_at';
    IF col_exists = 0 THEN
        ALTER TABLE service_requests ADD COLUMN started_at DATETIME NULL AFTER accepted_at;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_requests' AND COLUMN_NAME = 'confirmed_at';
    IF col_exists = 0 THEN
        ALTER TABLE service_requests ADD COLUMN confirmed_at DATETIME NULL AFTER completed_at;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_requests' AND COLUMN_NAME = 'sla_due_at';
    IF col_exists = 0 THEN
        ALTER TABLE service_requests ADD COLUMN sla_due_at DATETIME NULL AFTER confirmed_at;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_requests' AND COLUMN_NAME = 'is_sla_breached';
    IF col_exists = 0 THEN
        ALTER TABLE service_requests ADD COLUMN is_sla_breached TINYINT(1) NOT NULL DEFAULT 0 AFTER sla_due_at;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_requests' AND COLUMN_NAME = 'failure_reason';
    IF col_exists = 0 THEN
        ALTER TABLE service_requests ADD COLUMN failure_reason TEXT NULL AFTER is_sla_breached;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_requests' AND COLUMN_NAME = 'recovery_action';
    IF col_exists = 0 THEN
        ALTER TABLE service_requests ADD COLUMN recovery_action VARCHAR(200) NULL AFTER failure_reason;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_requests' AND COLUMN_NAME = 'recovery_approved_by';
    IF col_exists = 0 THEN
        ALTER TABLE service_requests ADD COLUMN recovery_approved_by BIGINT UNSIGNED NULL AFTER recovery_action;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_requests' AND COLUMN_NAME = 'recovery_cost';
    IF col_exists = 0 THEN
        ALTER TABLE service_requests ADD COLUMN recovery_cost DECIMAL(12,2) NULL AFTER recovery_approved_by;
    END IF;

    -- staff_skills patch
    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_skills' AND COLUMN_NAME = 'certificate_expiry';
    IF col_exists = 0 THEN
        ALTER TABLE staff_skills ADD COLUMN certificate_expiry DATE NULL AFTER certificate;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_skills' AND COLUMN_NAME = 'is_shadow';
    IF col_exists = 0 THEN
        ALTER TABLE staff_skills ADD COLUMN is_shadow TINYINT(1) NOT NULL DEFAULT 0 AFTER verified_at;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_skills' AND COLUMN_NAME = 'shadow_mentor_id';
    IF col_exists = 0 THEN
        ALTER TABLE staff_skills ADD COLUMN shadow_mentor_id BIGINT UNSIGNED NULL AFTER is_shadow;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_skills' AND COLUMN_NAME = 'eligibility_level';
    IF col_exists = 0 THEN
        ALTER TABLE staff_skills ADD COLUMN eligibility_level VARCHAR(20) NOT NULL DEFAULT 'STANDARD' AFTER shadow_mentor_id;
    END IF;

    -- staff_assignments patch
    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_assignments' AND COLUMN_NAME = 'case_complexity';
    IF col_exists = 0 THEN
        ALTER TABLE staff_assignments ADD COLUMN case_complexity VARCHAR(20) NOT NULL DEFAULT 'STANDARD' AFTER difficulty_level;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_assignments' AND COLUMN_NAME = 'required_language';
    IF col_exists = 0 THEN
        ALTER TABLE staff_assignments ADD COLUMN required_language VARCHAR(10) NULL AFTER case_complexity;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_assignments' AND COLUMN_NAME = 'is_shadow';
    IF col_exists = 0 THEN
        ALTER TABLE staff_assignments ADD COLUMN is_shadow TINYINT(1) NOT NULL DEFAULT 0 AFTER required_language;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_assignments' AND COLUMN_NAME = 'shadow_supervisor_id';
    IF col_exists = 0 THEN
        ALTER TABLE staff_assignments ADD COLUMN shadow_supervisor_id BIGINT UNSIGNED NULL AFTER is_shadow;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_assignments' AND COLUMN_NAME = 'is_acting';
    IF col_exists = 0 THEN
        ALTER TABLE staff_assignments ADD COLUMN is_acting TINYINT(1) NOT NULL DEFAULT 0 AFTER shadow_supervisor_id;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_assignments' AND COLUMN_NAME = 'escalated_to';
    IF col_exists = 0 THEN
        ALTER TABLE staff_assignments ADD COLUMN escalated_to BIGINT UNSIGNED NULL AFTER is_acting;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_assignments' AND COLUMN_NAME = 'escalated_at';
    IF col_exists = 0 THEN
        ALTER TABLE staff_assignments ADD COLUMN escalated_at DATETIME NULL AFTER escalated_to;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_assignments' AND COLUMN_NAME = 'escalation_reason';
    IF col_exists = 0 THEN
        ALTER TABLE staff_assignments ADD COLUMN escalation_reason TEXT NULL AFTER escalated_at;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_assignments' AND COLUMN_NAME = 'quality_score';
    IF col_exists = 0 THEN
        ALTER TABLE staff_assignments ADD COLUMN quality_score TINYINT UNSIGNED NULL AFTER rating;
    END IF;
END$$
DELIMITER ;

CALL PatchMissingAddonColumns();
DROP PROCEDURE IF EXISTS PatchMissingAddonColumns;

-- Bật lại kiểm tra foreign key
SET FOREIGN_KEY_CHECKS = 1;

-- ====================================================================================================
-- KIỂM TRA TỔNG QUAN SAU KHI CHẠY MIGRATION
-- ====================================================================================================
SELECT 'MIGRATION COMPLETE! TẤT CẢ CÁC BẢNG VÀ CỘT PHASE 2 ĐÃ ĐỒNG BỘ 100%' AS status;

SELECT 
    'roles' AS table_name, COUNT(*) AS total_records FROM roles
UNION ALL
SELECT 'permissions', COUNT(*) FROM permissions
UNION ALL
SELECT 'service_categories', COUNT(*) FROM service_categories
UNION ALL
SELECT 'skill_categories', COUNT(*) FROM skill_categories
UNION ALL
SELECT 'staff_eligibility_rules', COUNT(*) FROM staff_eligibility_rules;
