-- ============================================================
-- PHASE 2 MIGRATION: RBAC (Role-Based Access Control)
-- Chạy file này trong MySQL Workbench sau khi đã có database hotel_booking_db
-- ============================================================

USE hotel_booking_db;

-- B1. BẢNG ROLES
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

-- B2. BẢNG PERMISSIONS
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

-- B3. BẢNG ROLE_PERMISSIONS
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

-- SEED: 3 Roles mặc định
INSERT INTO roles (id, name, display_name, description, is_system) VALUES
    (1, 'ADMIN',    'Quản Trị Viên', 'Toàn quyền quản trị hệ thống', 1),
    (2, 'EMPLOYEE', 'Nhân Viên',     'Quản lý khách sạn, phòng và đơn đặt phòng', 1),
    (3, 'CUSTOMER', 'Khách Hàng',    'Đặt phòng và quản lý lịch trình cá nhân', 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- SEED: Permissions
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
    ('users',    'update_status', 'users.update_status',  'Khoá/Mở khoá tài khoản nhân viên')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- SEED: ADMIN có toàn bộ quyền
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions;

-- SEED: EMPLOYEE chỉ có quyền vận hành (không được xóa, không được quản lý users)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions
WHERE name IN (
    'hotels.create', 'hotels.read', 'hotels.update', 'hotels.manage_images',
    'rooms.create',  'rooms.read',  'rooms.update',  'rooms.manage_images',
    'bookings.read', 'bookings.update_status'
);

-- Kiểm tra
SELECT r.name AS role, COUNT(rp.id) AS so_quyen
FROM roles r
LEFT JOIN role_permissions rp ON rp.role_id = r.id
GROUP BY r.id, r.name;
