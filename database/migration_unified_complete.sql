-- ====================================================================================================
-- TRAVELEKE SYSTEM - TÀI LIỆU CƠ SỞ DỮ LIỆU HỢP NHẤT TOÀN DIỆN VÀ DUY NHẤT (UNIFIED MASTER DATABASE)
-- ====================================================================================================
-- TỆP SQL HỢP NHẤT 100% TOÀN BỘ DỰ ÁN TRAVELEKE (TẤT CẢ CÁC ĐỢT 1 -> 6 & 32 ONLINE PMS EXTENSIONS):
--   1. Core Platform & RBAC (Roles, Permissions, Users, Refresh Tokens, Hotels, Rooms, Bookings, Services)
--   2. Thanh toán VNPAY, Giữ chỗ tồn kho & Transactional Outbox (booking_holds, payment_transactions, outbox_events, booking_cancellation_requests)
--   3. Quản lý Ca trực, Bàn giao ca & Phê duyệt (staff_shifts, shift_handovers, approval_requests)
--   4. Đợt 1 & Đợt 2: Đơn xin nghỉ/đi muộn, Khóa điều phối, Phân công tự động 40/120 phút & Hiện diện No-Show/Check-in muộn
--   5. Đợt 3 & Đợt 4: Ủy quyền hỗ trợ tạm thời (Coverage Grants & Task Scopes), Nhiệm vụ phục vụ khách (Guest Work Tasks/Events/Evidence) & Hội thoại
--   6. Đợt 5 & Đợt 6: Đánh giá sao nhân viên, Chấm điểm KPI 100 điểm, Chiến dịch khuyến mãi (Promotions), Báo giá (Quotes) & Sổ quyền lợi (Benefit Ledger)
--   7. Online Extensions & 32 Hospitality Gaps: Phòng vật lý (Room Units & Stay Slots), Buồng phòng (Housekeeping), Bảo trì (Blocks/Stop-Sell),
--      Sự cố phòng (Room Incidents), Bảng giá động (Rate Plans & Calendar), Đổi lịch/hạng phòng (Booking Amendments), Sổ tiền (Folios/Entries/Settlements),
--      Kiểm toán đêm (Night Audit), Chứng từ (Documents), Pre-check-in Online, Thông báo đa kênh (Notifications), Voucher, Đồng bộ OTA & Waitlist
--
-- TỔNG CỘNG: 114 BẢNG DỮ LIỆU ĐẦY ĐỦ 100% + MASTER SEED DATA + THỦ TỤC ĐỒNG BỘ TỰ ĐỘNG CHO DATABASE CŨ
-- NGUYÊN TẮC AN TOÀN TUYỆT ĐỐI:
--   - Additive & Idempotent: Sử dụng CREATE TABLE IF NOT EXISTS, INSERT IGNORE / ON DUPLICATE KEY UPDATE và kiểm tra INFORMATION_SCHEMA.
--   - Chạy an toàn tuyệt đối trên cả MySQL mới tinh lẫn MySQL đã có dữ liệu sẵn mà không gây lỗi hay mất dữ liệu.
-- ====================================================================================================

-- Có thể bỏ comment dòng dưới nếu muốn khởi tạo lại toàn bộ database sạch từ đầu:
-- DROP DATABASE IF EXISTS hotel_booking_db;

-- Lưu ý (SEC-16 / BUG-DB-01): Không ép cứng USE hotel_booking_db trong migration runner.
-- Mọi bảng sẽ được tạo trên đúng schema đã kết nối qua biến môi trường DB_DATABASE.
-- CREATE DATABASE IF NOT EXISTS hotel_booking_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE hotel_booking_db;

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;


-- ====================================================================================================
-- PHẦN 1: HỆ THỐNG PHÂN QUYỀN (RBAC), TÀI KHOẢN NGƯỜI DÙNG & PHIÊN ĐĂNG NHẬP
-- ====================================================================================================
-- Mô tả: Quản lý vai trò (roles), quyền hạn (permissions), tài khoản (users), phân quyền (users_roles, role_permissions) và xoay vòng Refresh Token an toàn (refresh_tokens).
-- ====================================================================================================
-- ----------------------------------------------------------------------------------------------------
-- Bảng: ROLES - Danh mục vai trò người dùng (ADMIN, EMPLOYEE, CUSTOMER)
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `roles` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
    `display_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
    `description` text COLLATE utf8mb4_unicode_ci,
    `is_system` tinyint(1) NOT NULL DEFAULT '0',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_roles_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: PERMISSIONS - Danh mục quyền hạn chi tiết theo module chức năng
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `permissions` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `module` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
    `action` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
    `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_permissions_name` (`name`),
    KEY `idx_permissions_module` (`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: ROLE_PERMISSIONS - Bảng liên kết vai trò và quyền hạn được cấp
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `role_permissions` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `role_id` bigint unsigned NOT NULL,
    `permission_id` bigint unsigned NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_role_permissions` (`role_id`,`permission_id`),
    KEY `fk_rp_permission` (`permission_id`),
    CONSTRAINT `fk_rp_permission` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_rp_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: USERS - Tài khoản khách hàng, nhân viên và quản trị viên
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `full_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `avatar_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `date_of_birth` date DEFAULT NULL,
    `gender` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `role` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'CUSTOMER',
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
    `email_verified_at` datetime DEFAULT NULL,
    `last_login_at` datetime DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` datetime DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_users_email` (`email`),
    UNIQUE KEY `uq_users_phone` (`phone`),
    KEY `idx_users_status` (`status`),
    CONSTRAINT `chk_users_gender` CHECK (((`gender` is null) or (`gender` in (_utf8mb4'MALE',_utf8mb4'FEMALE',_utf8mb4'OTHER')))),
    CONSTRAINT `chk_users_status` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'BLOCKED',_utf8mb4'INACTIVE')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: USERS_ROLES - Bảng liên kết tài khoản người dùng và vai trò
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users_roles` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `user_id` bigint unsigned NOT NULL,
    `role_id` bigint unsigned NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_users_roles` (`user_id`,`role_id`),
    KEY `idx_users_roles_user_id` (`user_id`),
    KEY `idx_users_roles_role_id` (`role_id`),
    CONSTRAINT `fk_users_roles_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_users_roles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: REFRESH_TOKENS - Quản lý opaque refresh tokens, cơ chế token rotation và phát hiện xâm nhập
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `refresh_tokens` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `user_id` bigint unsigned NOT NULL,
    `session_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
    `family_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
    `token_hash` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
    `parent_token_id` bigint unsigned DEFAULT NULL,
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
    `expires_at` datetime NOT NULL,
    `used_at` datetime DEFAULT NULL,
    `revoked_at` datetime DEFAULT NULL,
    `absolute_expires_at` datetime NOT NULL,
    `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `user_agent` text COLLATE utf8mb4_unicode_ci,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_rf_user_id` (`user_id`),
    KEY `idx_rf_session_id` (`session_id`),
    KEY `idx_rf_family_id` (`family_id`),
    KEY `idx_rf_token_hash` (`token_hash`),
    CONSTRAINT `fk_refresh_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `chk_refresh_tokens_status` CHECK ((`status` in (_latin1'ACTIVE',_latin1'USED',_latin1'REVOKED',_latin1'EXPIRED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ====================================================================================================
-- PHẦN 2: ĐỊA DANH, LOẠI HÌNH LƯU TRÚ & CƠ SỞ KHÁCH SẠN
-- ====================================================================================================
-- Mô tả: Cấu trúc phân cấp địa lý (locations), loại hình lưu trú (hotel_types), thông tin khách sạn (hotels), album ảnh (hotel_images) và phân công nhân viên khách sạn (hotel_staff).
-- ====================================================================================================
-- ----------------------------------------------------------------------------------------------------
-- Bảng: LOCATIONS - Danh mục quốc gia, tỉnh/thành phố phân cấp cha - con
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `locations` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `parent_id` bigint unsigned DEFAULT NULL,
    `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    `type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
    `latitude` decimal(10,7) DEFAULT NULL,
    `longitude` decimal(10,7) DEFAULT NULL,
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_locations_code` (`code`),
    KEY `idx_locations_parent_id` (`parent_id`),
    KEY `idx_locations_name` (`name`),
    KEY `idx_locations_type` (`type`),
    CONSTRAINT `fk_locations_parent` FOREIGN KEY (`parent_id`) REFERENCES `locations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `chk_locations_status` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'INACTIVE'))),
    CONSTRAINT `chk_locations_type` CHECK ((`type` in (_utf8mb4'COUNTRY',_utf8mb4'PROVINCE',_utf8mb4'CITY',_utf8mb4'DISTRICT',_utf8mb4'WARD',_utf8mb4'AREA')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: HOTEL_TYPES - Phân loại khách sạn, resort, homestay, villa, hostel
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hotel_types` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
    `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    `description` text COLLATE utf8mb4_unicode_ci,
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_hotel_types_code` (`code`),
    CONSTRAINT `chk_hotel_types_status` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'INACTIVE')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: HOTELS - Thông tin chi tiết cơ sở lưu trú, xếp hạng sao, tọa độ, chính sách nhận/trả phòng
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hotels` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `hotel_type_id` bigint unsigned NOT NULL,
    `location_id` bigint unsigned NOT NULL,
    `created_by` bigint unsigned DEFAULT NULL,
    `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
    `slug` varchar(220) COLLATE utf8mb4_unicode_ci NOT NULL,
    `description` longtext COLLATE utf8mb4_unicode_ci,
    `star_rating` tinyint unsigned DEFAULT NULL,
    `address` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `latitude` decimal(10,7) DEFAULT NULL,
    `longitude` decimal(10,7) DEFAULT NULL,
    `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `check_in_time` time NOT NULL DEFAULT '14:00:00',
    `check_out_time` time NOT NULL DEFAULT '12:00:00',
    `cover_image_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` datetime DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_hotels_slug` (`slug`),
    KEY `idx_hotels_hotel_type_id` (`hotel_type_id`),
    KEY `idx_hotels_location_id` (`location_id`),
    KEY `idx_hotels_created_by` (`created_by`),
    KEY `idx_hotels_status` (`status`),
    CONSTRAINT `fk_hotels_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_hotels_hotel_type` FOREIGN KEY (`hotel_type_id`) REFERENCES `hotel_types` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_hotels_location` FOREIGN KEY (`location_id`) REFERENCES `locations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `chk_hotels_star_rating` CHECK (((`star_rating` is null) or (`star_rating` between 1 and 5))),
    CONSTRAINT `chk_hotels_status` CHECK ((`status` in (_utf8mb4'DRAFT',_utf8mb4'ACTIVE',_utf8mb4'INACTIVE')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: HOTEL_IMAGES - Thư viện hình ảnh cơ sở khách sạn, hỗ trợ gắn cờ ảnh đại diện chính
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hotel_images` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `hotel_id` bigint unsigned NOT NULL,
    `image_url` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
    `caption` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `sort_order` smallint unsigned NOT NULL DEFAULT '0',
    `is_primary` tinyint(1) NOT NULL DEFAULT '0',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_hotel_images_hotel_id` (`hotel_id`),
    KEY `idx_hotel_images_sort` (`hotel_id`,`sort_order`),
    CONSTRAINT `fk_hotel_images_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: HOTEL_STAFF - Phân công quản lý và nhân sự vận hành theo từng cơ sở khách sạn
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hotel_staff` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `hotel_id` bigint unsigned NOT NULL,
    `staff_user_id` bigint unsigned NOT NULL,
    `staff_role` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'EMPLOYEE',
    `assigned_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_hotel_staff_assignment` (`hotel_id`,`staff_user_id`),
    KEY `idx_hotel_staff_hotel_id` (`hotel_id`),
    KEY `idx_hotel_staff_user_id` (`staff_user_id`),
    CONSTRAINT `fk_hotel_staff_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_hotel_staff_user` FOREIGN KEY (`staff_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `chk_hotel_staff_role` CHECK ((`staff_role` in (_utf8mb4'MANAGER',_utf8mb4'EMPLOYEE'))),
    CONSTRAINT `chk_hotel_staff_status` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'INACTIVE')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ====================================================================================================
-- PHẦN 3: QUẢN LÝ PHÒNG NGHỈ & THƯ VIỆN HÌNH ẢNH PHÒNG
-- ====================================================================================================
-- Mô tả: Danh mục các hạng phòng/loại phòng nghỉ (rooms), giá thuê theo đêm, sức chứa, số giường và album ảnh chi tiết từng phòng (room_images).
-- ====================================================================================================
-- ----------------------------------------------------------------------------------------------------
-- Bảng: ROOMS - Thông tin loại phòng nghỉ, giá niêm yết, số lượng phòng thực tế và kiểm kê khả dụng
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `rooms` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `hotel_id` bigint unsigned NOT NULL,
    `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    `slug` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
    `description` text COLLATE utf8mb4_unicode_ci,
    `service_tier` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'STANDARD' COMMENT 'ECONOMY, STANDARD, VIP',
    `price_per_night` decimal(15,2) NOT NULL DEFAULT '0.00',
    `check_in_time` time NOT NULL DEFAULT '14:00:00',
    `check_out_time` time NOT NULL DEFAULT '12:00:00',
    `max_adults` tinyint unsigned NOT NULL DEFAULT '2',
    `max_children` tinyint unsigned NOT NULL DEFAULT '0',
    `total_rooms` smallint unsigned NOT NULL DEFAULT '1',
    `available_rooms` smallint unsigned NOT NULL DEFAULT '1',
    `bed_count` tinyint unsigned NOT NULL DEFAULT '1',
    `bed_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Giường Đôi',
    `room_size` smallint unsigned DEFAULT NULL,
    `rating` decimal(3,2) NOT NULL DEFAULT '5.00',
    `review_count` int unsigned NOT NULL DEFAULT '0',
    `cover_image_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'AVAILABLE',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` datetime DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_rooms_hotel_slug` (`hotel_id`,`slug`),
    KEY `idx_rooms_hotel_id` (`hotel_id`),
    KEY `idx_rooms_status` (`status`),
    KEY `idx_rooms_price` (`price_per_night`),
    CONSTRAINT `fk_rooms_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `chk_rooms_adults` CHECK ((`max_adults` >= 1)),
    CONSTRAINT `chk_rooms_bed_count` CHECK ((`bed_count` between 1 and 2)),
    CONSTRAINT `chk_rooms_price` CHECK ((`price_per_night` >= 0)),
    CONSTRAINT `chk_rooms_status` CHECK ((`status` in (_utf8mb4'AVAILABLE',_utf8mb4'UNAVAILABLE',_utf8mb4'MAINTENANCE'))),
    CONSTRAINT `chk_rooms_total_rooms` CHECK ((`total_rooms` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: ROOM_IMAGES - Bộ sưu tập ảnh chi tiết cho từng loại phòng nghỉ
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `room_images` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `room_id` bigint unsigned NOT NULL,
    `image_url` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
    `caption` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `sort_order` smallint unsigned NOT NULL DEFAULT '0',
    `is_primary` tinyint(1) NOT NULL DEFAULT '0',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_room_images_room_id` (`room_id`),
    KEY `idx_room_images_sort` (`room_id`,`sort_order`),
    CONSTRAINT `fk_room_images_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ====================================================================================================
-- PHẦN 4: KẾ HOẠCH LỘ TRÌNH CHUYẾN ĐI & ĐƠN ĐẶT PHÒNG (BOOKINGS)
-- ====================================================================================================
-- Mô tả: Lập kế hoạch du lịch cá nhân (trip_plans), đơn đặt phòng (bookings), chi tiết phòng đặt (booking_rooms) và nhật ký trạng thái (booking_status_logs).
-- ====================================================================================================
-- ----------------------------------------------------------------------------------------------------
-- Bảng: TRIP_PLANS - Kế hoạch hành trình cá nhân, điểm xuất phát, điểm đến và ngân sách dự kiến
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `trip_plans` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `user_id` bigint unsigned NOT NULL,
    `origin_location_id` bigint unsigned NOT NULL,
    `destination_location_id` bigint unsigned NOT NULL,
    `departure_at` datetime NOT NULL,
    `arrival_at` datetime DEFAULT NULL,
    `traveler_count` smallint unsigned NOT NULL DEFAULT '1',
    `budget` decimal(15,2) DEFAULT NULL,
    `note` text COLLATE utf8mb4_unicode_ci,
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_trip_plans_user_id` (`user_id`),
    KEY `idx_trip_plans_origin_id` (`origin_location_id`),
    KEY `idx_trip_plans_destination_id` (`destination_location_id`),
    KEY `idx_trip_plans_departure_at` (`departure_at`),
    KEY `idx_trip_plans_status` (`status`),
    CONSTRAINT `fk_trip_plans_destination` FOREIGN KEY (`destination_location_id`) REFERENCES `locations` (`id`),
    CONSTRAINT `fk_trip_plans_origin` FOREIGN KEY (`origin_location_id`) REFERENCES `locations` (`id`),
    CONSTRAINT `fk_trip_plans_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `chk_trip_plans_budget` CHECK (((`budget` is null) or (`budget` >= 0))),
    CONSTRAINT `chk_trip_plans_locations` CHECK ((`origin_location_id` <> `destination_location_id`)),
    CONSTRAINT `chk_trip_plans_status` CHECK ((`status` in (_utf8mb4'DRAFT',_utf8mb4'PLANNED',_utf8mb4'COMPLETED',_utf8mb4'CANCELLED'))),
    CONSTRAINT `chk_trip_plans_times` CHECK (((`arrival_at` is null) or (`arrival_at` > `departure_at`))),
    CONSTRAINT `chk_trip_plans_travelers` CHECK ((`traveler_count` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: BOOKINGS - Đơn đặt phòng chính, mã booking, idempotency key chống trùng lặp, thông tin liên hệ và trạng thái thanh toán
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bookings` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `booking_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
    `user_id` bigint unsigned NOT NULL,
    `hotel_id` bigint unsigned NOT NULL,
    `trip_plan_id` bigint unsigned DEFAULT NULL,
    `handled_by` bigint unsigned DEFAULT NULL,
    `assignment_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'AUTO',
    `assignment_note` text COLLATE utf8mb4_unicode_ci,
    `booking_source` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'WEBSITE',
    `created_by_staff_id` bigint unsigned DEFAULT NULL,
    `reassigned_at` datetime DEFAULT NULL,
    `reassigned_by` bigint unsigned DEFAULT NULL,
    `contact_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    `contact_email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `contact_phone` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
    `check_in_at` datetime NOT NULL,
    `check_out_at` datetime NOT NULL,
    `total_guests` smallint unsigned NOT NULL DEFAULT '1',
    `requested_room_count` smallint unsigned NOT NULL DEFAULT '1',
    `estimated_total` decimal(15,2) NOT NULL DEFAULT '0.00',
    `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
    `special_request` text COLLATE utf8mb4_unicode_ci,
    `confirmed_at` datetime DEFAULT NULL,
    `rejected_at` datetime DEFAULT NULL,
    `cancelled_at` datetime DEFAULT NULL,
    `actual_check_in_at` datetime DEFAULT NULL,
    `actual_check_out_at` datetime DEFAULT NULL,
    `no_show_at` datetime DEFAULT NULL,
    `no_show_grace_minutes` smallint unsigned NOT NULL DEFAULT '360',
    `no_show_closed_at` datetime DEFAULT NULL,
    `late_check_in_recovered_at` datetime DEFAULT NULL,
    `check_in_confirmed_by` bigint unsigned DEFAULT NULL,
    `check_out_confirmed_by` bigint unsigned DEFAULT NULL,
    `presence_version` int unsigned NOT NULL DEFAULT '1',
    `version` int unsigned NOT NULL DEFAULT '1',
    `late_arrival_expected_at` datetime DEFAULT NULL,
    `late_arrival_note` text COLLATE utf8mb4_unicode_ci,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `checkout_idempotency_key` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `checkout_request_hash` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_bookings_code` (`booking_code`),
    UNIQUE KEY `uq_checkout_idempotency` (`checkout_idempotency_key`),
    KEY `idx_bookings_user_id` (`user_id`),
    KEY `idx_bookings_hotel_id` (`hotel_id`),
    KEY `idx_bookings_trip_plan_id` (`trip_plan_id`),
    KEY `idx_bookings_handled_by` (`handled_by`),
    KEY `idx_bookings_dates` (`check_in_at`,`check_out_at`),
    KEY `idx_bookings_status` (`status`),
    KEY `idx_bookings_presence_scheduler` (`status`, `check_in_at`, `check_out_at`),
    KEY `idx_bookings_hotel_status` (`hotel_id`, `status`),
    CONSTRAINT `fk_bookings_customer` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_bookings_handled_by` FOREIGN KEY (`handled_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_bookings_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_bookings_trip_plan` FOREIGN KEY (`trip_plan_id`) REFERENCES `trip_plans` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `chk_bookings_dates` CHECK ((`check_out_at` > `check_in_at`)),
    CONSTRAINT `chk_bookings_estimated_total` CHECK ((`estimated_total` >= 0)),
    CONSTRAINT `chk_bookings_guests` CHECK ((`total_guests` >= 1)),
    CONSTRAINT `chk_bookings_room_count` CHECK ((`requested_room_count` >= 1)),
    CONSTRAINT `chk_bookings_status` CHECK ((`status` in (_utf8mb4'PAYMENT_PENDING',_utf8mb4'PENDING',_utf8mb4'CONFIRMED',_utf8mb4'REJECTED',_utf8mb4'CHECKED_IN',_utf8mb4'COMPLETED',_utf8mb4'CANCELLED',_utf8mb4'PAYMENT_EXPIRED',_utf8mb4'PAYMENT_REVIEW',_utf8mb4'NO_SHOW',_utf8mb4'CLOSED_NO_SHOW')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: BOOKING_ROOMS - Chi tiết các hạng phòng, số lượng và thành tiền trong đơn đặt phòng
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `booking_rooms` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `booking_id` bigint unsigned NOT NULL,
    `room_id` bigint unsigned NOT NULL,
    `quantity` smallint unsigned NOT NULL DEFAULT '1',
    `price_per_night` decimal(15,2) NOT NULL DEFAULT '0.00',
    `nights` smallint unsigned NOT NULL DEFAULT '1',
    `subtotal` decimal(15,2) NOT NULL DEFAULT '0.00',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_booking_rooms_booking_id` (`booking_id`),
    KEY `idx_booking_rooms_room_id` (`room_id`),
    CONSTRAINT `fk_booking_rooms_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_booking_rooms_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `chk_booking_rooms_nights` CHECK ((`nights` >= 1)),
    CONSTRAINT `chk_booking_rooms_price` CHECK ((`price_per_night` >= 0)),
    CONSTRAINT `chk_booking_rooms_quantity` CHECK ((`quantity` >= 1)),
    CONSTRAINT `chk_booking_rooms_subtotal` CHECK ((`subtotal` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: BOOKING_STATUS_LOGS - Lịch sử biến động trạng thái đơn đặt phòng và người thực hiện thay đổi
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `booking_status_logs` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `booking_id` bigint unsigned NOT NULL,
    `changed_by` bigint unsigned DEFAULT NULL,
    `actor_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'USER',
    `old_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `new_status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
    `note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `changed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_booking_status_logs_booking_id` (`booking_id`),
    KEY `idx_booking_status_logs_changed_by` (`changed_by`),
    KEY `idx_booking_status_logs_changed_at` (`changed_at`),
    CONSTRAINT `fk_booking_status_logs_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_booking_status_logs_user` FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `chk_booking_status_logs_new_status` CHECK ((`new_status` in (_utf8mb4'PAYMENT_PENDING',_utf8mb4'PENDING',_utf8mb4'CONFIRMED',_utf8mb4'REJECTED',_utf8mb4'CHECKED_IN',_utf8mb4'COMPLETED',_utf8mb4'CANCELLED',_utf8mb4'PAYMENT_EXPIRED',_utf8mb4'PAYMENT_REVIEW',_utf8mb4'NO_SHOW',_utf8mb4'CLOSED_NO_SHOW'))),
    CONSTRAINT `chk_booking_status_logs_old_status` CHECK (((`old_status` is null) or (`old_status` in (_utf8mb4'PAYMENT_PENDING',_utf8mb4'PENDING',_utf8mb4'CONFIRMED',_utf8mb4'REJECTED',_utf8mb4'CHECKED_IN',_utf8mb4'COMPLETED',_utf8mb4'CANCELLED',_utf8mb4'PAYMENT_EXPIRED',_utf8mb4'PAYMENT_REVIEW',_utf8mb4'NO_SHOW',_utf8mb4'CLOSED_NO_SHOW'))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ====================================================================================================
-- PHẦN 5: GIỮ CHỖ TẠM THỜI, THANH TOÁN VNPAY, OUTBOX EVENTS & YÊU CẦU HỦY ĐƠN
-- ====================================================================================================
-- Mô tả: Cơ chế khóa giữ chỗ tạm thời (booking_holds), lịch sử giao dịch cổng VNPAY (payment_transactions), mô hình Transactional Outbox (outbox_events) và xử lý yêu cầu hủy phòng (booking_cancellation_requests).
-- ====================================================================================================
-- ----------------------------------------------------------------------------------------------------
-- Bảng: BOOKING_HOLDS - Giữ chỗ phòng tạm thời theo khoảng thời gian lưu trú [check_in_at, check_out_at), đảm bảo 1 booking có 1 logical hold
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `booking_holds` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `booking_id` bigint unsigned NOT NULL,
    `room_id` bigint unsigned NOT NULL,
    `quantity` smallint unsigned NOT NULL DEFAULT '1',
    `check_in_at` datetime NOT NULL,
    `check_out_at` datetime NOT NULL,
    `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'HELD' COMMENT 'HELD, COMMITTED, RELEASED, EXPIRED',
    `hold_expires_at` datetime NOT NULL,
    `released_at` datetime DEFAULT NULL,
    `committed_at` datetime DEFAULT NULL,
    `release_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_booking_holds_booking` (`booking_id`),
    KEY `idx_booking_holds_overlap` (`room_id`,`status`,`check_in_at`,`check_out_at`),
    KEY `idx_booking_holds_booking_id` (`booking_id`),
    KEY `idx_booking_holds_expiry` (`status`,`hold_expires_at`),
    CONSTRAINT `fk_booking_holds_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_booking_holds_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `chk_booking_holds_dates` CHECK ((`check_out_at` > `check_in_at`)),
    CONSTRAINT `chk_booking_holds_quantity` CHECK ((`quantity` >= 1)),
    CONSTRAINT `chk_booking_holds_status` CHECK ((`status` in (_utf8mb4'HELD',_utf8mb4'COMMITTED',_utf8mb4'RELEASED',_utf8mb4'EXPIRED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: PAYMENT_TRANSACTIONS - Lịch sử các lượt thanh toán VNPAY, theo dõi txn_ref, checksum, mã phản hồi IPN và hoàn tiền
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `payment_transactions` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `booking_id` bigint unsigned NOT NULL,
    `provider` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'VNPAY',
    `attempt_no` int unsigned NOT NULL DEFAULT '1',
    `txn_ref` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    `amount` decimal(15,2) NOT NULL DEFAULT '0.00',
    `currency` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'VND',
    `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'CREATED' COMMENT 'CREATED, PENDING, PAID, FAILED, EXPIRED, PAID_REQUIRES_REVIEW, REFUND_PENDING, REFUNDED',
    `response_code` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `transaction_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `vnp_transaction_no` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `bank_code` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `card_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `pay_date` datetime DEFAULT NULL,
    `gateway_expire_at` datetime DEFAULT NULL,
    `paid_at` datetime DEFAULT NULL,
    `failed_at` datetime DEFAULT NULL,
    `expired_at` datetime DEFAULT NULL,
    `refund_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
    `refunded_at` datetime DEFAULT NULL,
    `refund_note` text COLLATE utf8mb4_unicode_ci,
    `raw_ipn_response` json DEFAULT NULL,
    `purpose` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'INITIAL_BOOKING',
    `amendment_id` bigint unsigned DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_payment_transactions_txn_ref` (`txn_ref`),
    UNIQUE KEY `uq_payment_transactions_attempt` (`booking_id`,`attempt_no`),
    KEY `idx_payment_transactions_booking_id` (`booking_id`),
    KEY `idx_payment_transactions_status` (`status`),
    KEY `idx_payment_transactions_created_at` (`created_at`),
    CONSTRAINT `fk_payment_transactions_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `chk_payment_transactions_amount` CHECK ((`amount` >= 0)),
    CONSTRAINT `chk_payment_transactions_status` CHECK ((`status` in (_utf8mb4'CREATED',_utf8mb4'PENDING',_utf8mb4'PAID',_utf8mb4'FAILED',_utf8mb4'EXPIRED',_utf8mb4'PAID_REQUIRES_REVIEW',_utf8mb4'RECONCILIATION_REQUIRED',_utf8mb4'REFUND_PENDING',_utf8mb4'REFUNDED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: OUTBOX_EVENTS - Transactional Outbox Pattern - gửi Email, Socket và xử lý nền sau khi commit DB an toàn tuyệt đối
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `outbox_events` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `event_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    `aggregate_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
    `aggregate_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
    `payload` json NOT NULL,
    `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING, PROCESSING, COMPLETED, FAILED',
    `retry_count` int unsigned NOT NULL DEFAULT '0',
    `max_retries` int unsigned NOT NULL DEFAULT '5',
    `error_message` text COLLATE utf8mb4_unicode_ci,
    `available_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `processed_at` datetime DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `locked_at` datetime DEFAULT NULL,
    `locked_by` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_outbox_events_poll` (`status`,`available_at`),
    KEY `idx_outbox_events_aggregate` (`aggregate_type`,`aggregate_id`),
    KEY `idx_outbox_claim` (`status`,`available_at`,`locked_at`),
    CONSTRAINT `chk_outbox_events_status` CHECK ((`status` in (_utf8mb4'PENDING',_utf8mb4'PROCESSING',_utf8mb4'COMPLETED',_utf8mb4'FAILED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: BOOKING_CANCELLATION_REQUESTS - Yêu cầu hủy phòng từ khách hàng/nhân viên, quy trình thẩm định duyệt hoàn tiền
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `booking_cancellation_requests` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `booking_id` bigint unsigned NOT NULL,
    `requested_by` bigint unsigned NOT NULL,
    `requester_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'CUSTOMER',
    `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
    `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
    `reviewed_by` bigint unsigned DEFAULT NULL,
    `reviewed_at` datetime DEFAULT NULL,
    `review_note` text COLLATE utf8mb4_unicode_ci,
    `refund_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_bcr_booking_id` (`booking_id`),
    KEY `idx_bcr_status` (`status`),
    KEY `idx_bcr_requested_by` (`requested_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ====================================================================================================
-- PHẦN 6: DỊCH VỤ PHÒNG, GỌI DỊCH VỤ & NHẬT KÝ ĐỀN BÙ SỰ CỐ
-- ====================================================================================================
-- Mô tả: Danh mục phân loại dịch vụ (service_categories), bảng giá dịch vụ (room_services), dịch vụ đính kèm phòng (room_service_assignments), gọi dịch vụ phát sinh (service_requests), snapshot dịch vụ tại thời điểm đặt (booking_service_snapshots) và xử lý sự cố (service_recovery_log).
-- ====================================================================================================
-- ----------------------------------------------------------------------------------------------------
-- Bảng: SERVICE_CATEGORIES - Danh mục phân loại dịch vụ khách sạn (Ẩm thực, Buồng phòng, Spa, Di chuyển...)
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `service_categories` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `code` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
    `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    `description` text COLLATE utf8mb4_unicode_ci,
    `icon` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Tên icon Lucide hoặc emoji',
    `sort_order` smallint unsigned NOT NULL DEFAULT '0',
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_service_categories_code` (`code`),
    KEY `idx_service_categories_status` (`status`),
    KEY `idx_service_categories_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: ROOM_SERVICES - Bảng giá và thông tin chi tiết dịch vụ phòng (Miễn phí đi kèm & Add-on trả phí)
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `room_services` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `category_id` bigint unsigned NOT NULL,
    `hotel_id` bigint unsigned DEFAULT NULL COMMENT 'NULL = Dịch vụ chung toàn hệ thống, có ID = Dịch vụ riêng của khách sạn',
    `room_type_id` bigint unsigned DEFAULT NULL,
    `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    `description` text COLLATE utf8mb4_unicode_ci,
    `unit` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'lần' COMMENT 'lần, giờ, ngày, món, bộ, suất, người, phòng',
    `base_price` decimal(12,2) NOT NULL DEFAULT '0.00',
    `is_complimentary` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1 = Miễn phí đi kèm phòng, 0 = Có thu phí',
    `service_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ADD_ON' COMMENT 'INCLUDED, ADD_ON, UPGRADE, HOURLY',
    `quota_per_booking` smallint unsigned DEFAULT NULL COMMENT 'Số lượt miễn phí/giới hạn mỗi booking',
    `quota_per_night` smallint unsigned DEFAULT NULL COMMENT 'Số lượt miễn phí mỗi đêm',
    `max_quantity` smallint unsigned DEFAULT NULL,
    `sla_minutes` smallint unsigned DEFAULT '30' COMMENT 'Cam kết thời gian phục vụ tính bằng phút',
    `capacity_per_hour` smallint unsigned DEFAULT NULL COMMENT 'Công suất phục vụ tối đa trong 1 giờ',
    `lead_time_hours` tinyint unsigned DEFAULT '0' COMMENT 'Cần đặt trước bao nhiêu giờ',
    `requires_approval` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'Cần Quản lý duyệt trước khi thực hiện',
    `department_owner` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Phòng ban chịu trách nhiệm (F&B, HOUSEKEEPING, FRONT_DESK, SPA...)',
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `fk_room_services_category` (`category_id`),
    KEY `idx_room_services_hotel` (`hotel_id`),
    KEY `idx_room_services_type` (`service_type`),
    KEY `idx_room_services_status` (`status`),
    KEY `idx_room_services_complimentary` (`is_complimentary`),
    CONSTRAINT `fk_room_services_category` FOREIGN KEY (`category_id`) REFERENCES `service_categories` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_room_services_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: ROOM_SERVICE_ASSIGNMENTS - Liên kết các dịch vụ phòng mặc định theo từng loại phòng nghỉ
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `room_service_assignments` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `room_id` bigint unsigned NOT NULL,
    `service_id` bigint unsigned NOT NULL,
    `is_complimentary` tinyint(1) NOT NULL DEFAULT '0',
    `custom_price` decimal(12,2) DEFAULT NULL COMMENT 'Giá riêng cho phòng này nếu khác giá base_price',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_rsa_room_service` (`room_id`,`service_id`),
    KEY `idx_rsa_room` (`room_id`),
    KEY `idx_rsa_service` (`service_id`),
    CONSTRAINT `fk_rsa_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_rsa_service` FOREIGN KEY (`service_id`) REFERENCES `room_services` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: SERVICE_REQUESTS - Yêu cầu gọi dịch vụ phát sinh của khách lưu trú kèm cam kết SLA
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `service_requests` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `booking_id` bigint unsigned NOT NULL,
    `service_id` bigint unsigned NOT NULL,
    `assigned_to` bigint unsigned DEFAULT NULL COMMENT 'Nhân viên trực tiếp thực hiện (users.id)',
    `service_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
    `requested_quantity` smallint unsigned NOT NULL DEFAULT '1',
    `unit_price` decimal(12,2) NOT NULL DEFAULT '0.00',
    `quantity` smallint unsigned NOT NULL DEFAULT '1',
    `total_price` decimal(12,2) NOT NULL DEFAULT '0.00',
    `applied_campaign_id` bigint unsigned DEFAULT NULL,
    `campaign_version` int unsigned DEFAULT NULL,
    `original_price_snapshot` decimal(12,2) DEFAULT NULL,
    `note` text COLLATE utf8mb4_unicode_ci,
    `total_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
    `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'REQUESTED' COMMENT 'REQUESTED, SCHEDULED, ACCEPTED, IN_PROGRESS, COMPLETED, CONFIRMED, REJECTED, CANCELLED',
    `scheduled_at` datetime DEFAULT NULL COMMENT 'Thời gian hẹn phục vụ',
    `accepted_at` datetime DEFAULT NULL COMMENT 'Thời điểm nhân viên nhận việc',
    `started_at` datetime DEFAULT NULL COMMENT 'Thời điểm bắt đầu thực hiện',
    `completed_at` datetime DEFAULT NULL COMMENT 'Thời điểm nhân viên báo xong',
    `confirmed_at` datetime DEFAULT NULL COMMENT 'Thời điểm khách hoặc lễ tân xác nhận hoàn tất',
    `sla_due_at` datetime DEFAULT NULL COMMENT 'Hạn chót SLA cam kết hoàn thành',
    `is_sla_breached` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1 = Bị trễ hạn SLA',
    `failure_reason` text COLLATE utf8mb4_unicode_ci COMMENT 'Lý do dịch vụ bị trễ hoặc thất bại nếu có',
    `recovery_action` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Biện pháp đền bù/khắc phục',
    `recovery_approved_by` bigint unsigned DEFAULT NULL COMMENT 'Người phê duyệt đền bù',
    `recovery_cost` decimal(12,2) DEFAULT NULL COMMENT 'Chi phí đền bù cho khách nếu có',
    `special_instructions` text COLLATE utf8mb4_unicode_ci COMMENT 'Yêu cầu cụ thể từ khách',
    `staff_notes` text COLLATE utf8mb4_unicode_ci COMMENT 'Ghi chú nội bộ của nhân viên',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `fk_service_requests_recovery_approver` (`recovery_approved_by`),
    KEY `idx_sr_booking` (`booking_id`),
    KEY `idx_sr_service` (`service_id`),
    KEY `idx_sr_assigned` (`assigned_to`),
    KEY `idx_sr_status` (`status`),
    KEY `idx_sr_sla` (`sla_due_at`,`is_sla_breached`),
    CONSTRAINT `fk_service_requests_assigned` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_service_requests_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_service_requests_recovery_approver` FOREIGN KEY (`recovery_approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_service_requests_service` FOREIGN KEY (`service_id`) REFERENCES `room_services` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: BOOKING_SERVICE_SNAPSHOTS - Bản lưu chụp trạng thái dịch vụ tại thời điểm chốt đơn đặt phòng
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `booking_service_snapshots` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `booking_id` bigint unsigned NOT NULL,
    `service_id` bigint unsigned NOT NULL,
    `service_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    `service_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'INCLUDED',
    `category_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    `unit` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
    `base_price` decimal(12,2) NOT NULL DEFAULT '0.00',
    `unit_price` decimal(12,2) NOT NULL,
    `quantity` smallint unsigned NOT NULL DEFAULT '1',
    `total_amount` decimal(12,2) NOT NULL,
    `is_complimentary` tinyint(1) NOT NULL DEFAULT '0',
    `quota_included` smallint unsigned DEFAULT NULL,
    `quota_used` smallint unsigned NOT NULL DEFAULT '0',
    `quota_per_night` smallint unsigned DEFAULT NULL,
    `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
    `note` text COLLATE utf8mb4_unicode_ci,
    `snapshotted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `fk_bss_service` (`service_id`),
    KEY `idx_bss_booking` (`booking_id`),
    CONSTRAINT `fk_bss_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_bss_service` FOREIGN KEY (`service_id`) REFERENCES `room_services` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: SERVICE_RECOVERY_LOG - Nhật ký xử lý khiếu nại, đền bù dịch vụ và khắc phục sự cố trải nghiệm khách hàng
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `service_recovery_log` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `service_request_id` bigint unsigned DEFAULT NULL,
    `booking_id` bigint unsigned NOT NULL,
    `reported_by` bigint unsigned NOT NULL,
    `approved_by` bigint unsigned DEFAULT NULL,
    `recovery_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'COMPLIMENTARY',
    `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
    `issue_type` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'DELAY, QUALITY, WRONG_ITEM, STAFF_ATTITUDE, CANCELLATION',
    `root_cause` text COLLATE utf8mb4_unicode_ci,
    `action_taken` text COLLATE utf8mb4_unicode_ci NOT NULL,
    `cost_incurred` decimal(12,2) NOT NULL DEFAULT '0.00',
    `approved_at` datetime DEFAULT NULL,
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
    `compensation_type` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NONE' COMMENT 'NONE, VOUCHER, DISCOUNT, FREE_SERVICE, REFUND',
    `compensation_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
    `guest_satisfaction` tinyint unsigned DEFAULT NULL COMMENT 'Đánh giá hài lòng từ 1 đến 5 sao',
    `resolved_at` datetime DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `fk_srl_request` (`service_request_id`),
    KEY `fk_srl_reporter` (`reported_by`),
    KEY `fk_srl_approver` (`approved_by`),
    KEY `idx_srl_booking` (`booking_id`),
    KEY `idx_srl_issue` (`issue_type`),
    CONSTRAINT `fk_srl_approver` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_srl_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_srl_reporter` FOREIGN KEY (`reported_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_srl_request` FOREIGN KEY (`service_request_id`) REFERENCES `service_requests` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ====================================================================================================
-- PHẦN 7: MA TRẬN NĂNG LỰC, HỒ SƠ KỸ NĂNG NHÂN VIÊN & ĐIỀU PHỐI NHIỆM VỤ
-- ====================================================================================================
-- Mô tả: Danh mục kỹ năng chuẩn (skill_categories), hồ sơ kỹ năng nhân viên (staff_skills), trình độ ngoại ngữ (staff_language_skills), lịch sử phân công (staff_assignments) và quy tắc điều phối thông minh (staff_eligibility_rules).
-- ====================================================================================================
-- ----------------------------------------------------------------------------------------------------
-- Bảng: SKILL_CATEGORIES - Danh mục tiêu chuẩn kỹ năng nghiệp vụ khách sạn
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `skill_categories` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `code` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
    `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
    `description` text COLLATE utf8mb4_unicode_ci,
    `department` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'HOUSEKEEPING, F&B, FRONT_DESK, CONCIERGE, SPA, MAINTENANCE',
    `weight_multiplier` decimal(3,2) NOT NULL DEFAULT '1.00' COMMENT 'Hệ số độ khó kỹ năng',
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_skill_categories_code` (`code`),
    KEY `idx_skill_dept` (`department`),
    KEY `idx_skill_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: STAFF_SKILLS - Hồ sơ năng lực chuyên môn, năm kinh nghiệm và chứng chỉ nhân viên
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `staff_skills` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `user_id` bigint unsigned NOT NULL,
    `skill_id` bigint unsigned NOT NULL,
    `level` tinyint unsigned NOT NULL DEFAULT '1',
    `years_exp` decimal(4,1) DEFAULT NULL,
    `proficiency_level` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'BASIC' COMMENT 'BASIC, INTERMEDIATE, ADVANCED, EXPERT',
    `certificate` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Tên chứng chỉ nghiệp vụ',
    `certificate_expiry` date DEFAULT NULL,
    `note` text COLLATE utf8mb4_unicode_ci,
    `verified_by` bigint unsigned DEFAULT NULL COMMENT 'Admin/Manager đã duyệt kỹ năng',
    `verified_at` datetime DEFAULT NULL,
    `is_shadow` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1 = Đang thực tập kèm cặp',
    `shadow_mentor_id` bigint unsigned DEFAULT NULL COMMENT 'Nhân viên kinh nghiệm hướng dẫn',
    `eligibility_level` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'STANDARD' COMMENT 'STANDARD, HIGH_COMPLEXITY, VIP_ONLY',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_staff_skill` (`user_id`,`skill_id`),
    KEY `fk_staff_skills_mentor` (`shadow_mentor_id`),
    KEY `fk_staff_skills_verifier` (`verified_by`),
    KEY `idx_staff_skills_user` (`user_id`),
    KEY `idx_staff_skills_skill` (`skill_id`),
    KEY `idx_staff_skills_level` (`proficiency_level`),
    CONSTRAINT `fk_staff_skills_mentor` FOREIGN KEY (`shadow_mentor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_staff_skills_skill` FOREIGN KEY (`skill_id`) REFERENCES `skill_categories` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_staff_skills_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_staff_skills_verifier` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: STAFF_LANGUAGE_SKILLS - Hồ sơ năng lực ngoại ngữ và chứng chỉ quốc tế của nhân viên
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `staff_language_skills` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `user_id` bigint unsigned NOT NULL,
    `language_code` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'vi, en, zh, ja, ko, fr, de, ru',
    `language_name` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
    `level` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'BASIC',
    `proficiency_level` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'INTERMEDIATE' COMMENT 'BASIC, INTERMEDIATE, FLUENT, NATIVE',
    `certificate` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'IELTS, TOEIC, HSK, JLPT...',
    `certificate_expiry` date DEFAULT NULL,
    `verified_by` bigint unsigned DEFAULT NULL,
    `verified_at` datetime DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_staff_language` (`user_id`,`language_code`),
    KEY `fk_sls_verifier` (`verified_by`),
    KEY `idx_sls_user` (`user_id`),
    KEY `idx_sls_lang` (`language_code`),
    CONSTRAINT `fk_sls_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_sls_verifier` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: STAFF_ASSIGNMENTS - Lịch sử điều phối công việc cho nhân viên theo từng yêu cầu dịch vụ
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `staff_assignments` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `service_request_id` bigint unsigned NOT NULL,
    `assigned_staff_id` bigint unsigned NOT NULL,
    `assigned_by` bigint unsigned NOT NULL,
    `assigned_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `difficulty_level` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'STANDARD' COMMENT 'STANDARD, HIGH, CRITICAL, VIP',
    `case_complexity` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'STANDARD' COMMENT 'STANDARD, HIGH, CRITICAL',
    `required_language` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Ngoại ngữ yêu cầu cho ca phục vụ',
    `is_shadow` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1 = Nhân viên đi kèm học việc',
    `shadow_supervisor_id` bigint unsigned DEFAULT NULL COMMENT 'Người giám sát trực tiếp',
    `is_acting` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1 = Làm nhiệm vụ kiêm nhiệm vượt cấp',
    `escalated_to` bigint unsigned DEFAULT NULL COMMENT 'Chuyển giao cho người khác khi khẩn cấp',
    `escalated_at` datetime DEFAULT NULL,
    `escalation_reason` text COLLATE utf8mb4_unicode_ci,
    `performance_score` tinyint unsigned DEFAULT NULL COMMENT 'Chấm điểm hiệu suất (1 - 100)',
    `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ASSIGNED' COMMENT 'ASSIGNED, IN_PROGRESS, COMPLETED, ESCALATED, REJECTED',
    `notes` text COLLATE utf8mb4_unicode_ci,
    `rating` decimal(2,1) DEFAULT NULL COMMENT 'Khách đánh giá (1.0 đến 5.0 sao)',
    `quality_score` tinyint unsigned DEFAULT NULL COMMENT 'Đánh giá chất lượng từ quản lý',
    `feedback` text COLLATE utf8mb4_unicode_ci,
    `completed_at` datetime DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `fk_staff_assignments_assigner` (`assigned_by`),
    KEY `fk_sa_shadow_supervisor` (`shadow_supervisor_id`),
    KEY `fk_sa_escalated_to` (`escalated_to`),
    KEY `idx_sa_request` (`service_request_id`),
    KEY `idx_sa_staff` (`assigned_staff_id`),
    KEY `idx_sa_status` (`status`),
    CONSTRAINT `fk_sa_escalated_to` FOREIGN KEY (`escalated_to`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_sa_shadow_supervisor` FOREIGN KEY (`shadow_supervisor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_staff_assignments_assigner` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_staff_assignments_request` FOREIGN KEY (`service_request_id`) REFERENCES `service_requests` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_staff_assignments_staff` FOREIGN KEY (`assigned_staff_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: STAFF_ELIGIBILITY_RULES - Bộ quy tắc điều phối nhân viên thông minh dựa trên độ phức tạp và cấp độ dịch vụ
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `staff_eligibility_rules` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `rule_code` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
    `case_complexity` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'STANDARD',
    `description` text COLLATE utf8mb4_unicode_ci,
    `min_skill_level` tinyint unsigned NOT NULL DEFAULT '1',
    `required_skill_codes` json DEFAULT NULL,
    `required_language_codes` json DEFAULT NULL,
    `min_years_experience` decimal(4,1) NOT NULL DEFAULT '0.0',
    `min_cases_completed` smallint unsigned NOT NULL DEFAULT '0',
    `exclude_shadow_mode` tinyint(1) NOT NULL DEFAULT '1',
    `require_verified_skills` tinyint(1) NOT NULL DEFAULT '0',
    `escalation_role` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MANAGER',
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_rule_code` (`rule_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ====================================================================================================
-- PHẦN 8: NHẬT KÝ HỆ THỐNG (AUDIT LOGS) & THEO DÕI HÀNH VI CHO AI (TRACKING)
-- ====================================================================================================
-- Mô tả: Nhật ký kiểm toán truy vết thao tác hệ thống (audit_logs) và ghi nhận hành vi tìm kiếm/xem phòng hỗ trợ AI gợi ý cá nhân hóa (hotel_tracking_events).
-- ====================================================================================================
-- ----------------------------------------------------------------------------------------------------
-- Bảng: AUDIT_LOGS - Nhật ký kiểm toán hệ thống ghi lại mọi biến động dữ liệu quan trọng
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `audit_logs` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `entity_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    `entity_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    `action` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
    `old_values` json DEFAULT NULL,
    `new_values` json DEFAULT NULL,
    `performed_by` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'SYSTEM',
    `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `user_agent` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `request_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_audit_entity` (`entity_name`,`entity_id`),
    KEY `idx_audit_action` (`action`),
    KEY `idx_audit_performed_by` (`performed_by`),
    KEY `idx_audit_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng: HOTEL_TRACKING_EVENTS - Ghi nhận sự kiện xem chi tiết khách sạn, tìm kiếm khoảng giá để huấn luyện mô hình gợi ý AI
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hotel_tracking_events` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `hotel_id` bigint unsigned NOT NULL,
    `event_type` enum('VIEW_DETAIL','SEARCH') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'VIEW_DETAIL',
    `user_id` bigint unsigned DEFAULT NULL,
    `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci NOT NULL,
    `price_min` decimal(15,2) DEFAULT NULL,
    `price_max` decimal(15,2) DEFAULT NULL,
    `viewed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_tracking_ip_time` (`ip_address`,`viewed_at`),
    KEY `idx_tracking_hotel_time` (`hotel_id`,`viewed_at`),
    KEY `idx_tracking_time` (`viewed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ====================================================================================================
-- PHẦN 8B: ĐỢT 1 & ĐỢT 2 - NĂNG LỰC, ĐƠN XIN NGHỈ/ĐI MUỘN, PHÂN CÔNG TỰ ĐỘNG & THEO DÕI HIỆN DIỆN NO-SHOW
-- ====================================================================================================
-- Mô tả: Các bảng hỗ trợ phân công tự động 40/120 phút, đơn nghỉ/đi muộn của nhân viên, khóa dispatch, và theo dõi sự kiện hiện diện/No-Show/Check-in muộn.
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- Bảng 35: STAFF_ABSENCE_REQUESTS - Đơn xin nghỉ / đi muộn của nhân viên lễ tân
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `staff_absence_requests` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `hotel_id` bigint unsigned NOT NULL,
    `staff_user_id` bigint unsigned NOT NULL,
    `request_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'LEAVE, LATE_ARRIVAL, EARLY_LEAVE, SHORT_ABSENCE',
    `start_at` datetime NOT NULL COMMENT 'Thời điểm bắt đầu vắng mặt',
    `end_at` datetime NOT NULL COMMENT 'Thời điểm kết thúc vắng mặt',
    `expected_arrival_at` datetime DEFAULT NULL,
    `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
    `contact_info` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `evidence_ref` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING, APPROVED, REJECTED, WITHDRAWN, REVOCATION_REQUESTED, REVOKED',
    `decided_by` bigint unsigned DEFAULT NULL,
    `decided_at` datetime DEFAULT NULL,
    `decision_note` text COLLATE utf8mb4_unicode_ci,
    `version` int unsigned NOT NULL DEFAULT '1',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_staff_absence_hotel_status` (`hotel_id`,`status`),
    KEY `idx_staff_absence_staff` (`staff_user_id`,`created_at`),
    KEY `idx_staff_absence_time_range` (`hotel_id`,`staff_user_id`,`start_at`,`end_at`),
    CONSTRAINT `fk_staff_absence_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_staff_absence_user` FOREIGN KEY (`staff_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 36: STAFF_ABSENCE_REQUEST_EVENTS - Nhật ký sự kiện duyệt/từ chối đơn xin nghỉ (append-only)
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `staff_absence_request_events` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `request_id` bigint unsigned NOT NULL,
    `old_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `new_status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
    `actor_id` bigint unsigned NOT NULL,
    `note` text COLLATE utf8mb4_unicode_ci,
    `occurred_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY `idx_absence_event_request` (`request_id`,`occurred_at`),
    CONSTRAINT `fk_absence_event_request` FOREIGN KEY (`request_id`) REFERENCES `staff_absence_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 37: STAFF_AVAILABILITY_BLOCKS - Các khoảng thời gian không khả dụng đã được duyệt
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `staff_availability_blocks` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `hotel_id` bigint unsigned NOT NULL,
    `staff_user_id` bigint unsigned NOT NULL,
    `request_id` bigint unsigned DEFAULT NULL,
    `block_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'LEAVE, LATE_ARRIVAL, EMERGENCY_UNAVAILABLE',
    `start_at` datetime NOT NULL,
    `end_at` datetime NOT NULL,
    `reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `active` tinyint(1) NOT NULL DEFAULT '1',
    `source` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'APPROVED_REQUEST' COMMENT 'APPROVED_REQUEST, MANAGER_OVERRIDE',
    `created_by` bigint unsigned NOT NULL,
    `ended_by` bigint unsigned DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_availability_lookup` (`hotel_id`,`staff_user_id`,`active`,`start_at`,`end_at`),
    CONSTRAINT `fk_avail_block_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_avail_block_user` FOREIGN KEY (`staff_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 38: HOTEL_ASSIGNMENT_DISPATCH_LOCKS - Khóa logic chống race condition phân công theo khách sạn
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hotel_assignment_dispatch_locks` (
    `hotel_id` bigint unsigned NOT NULL PRIMARY KEY,
    `version` bigint unsigned NOT NULL DEFAULT '0',
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_dispatch_lock_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 39: BOOKING_ASSIGNMENT_STATE - Trạng thái phân công chính hiện tại của booking
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `booking_assignment_state` (
    `booking_id` bigint unsigned NOT NULL PRIMARY KEY,
    `current_assignment_id` bigint unsigned DEFAULT NULL,
    `current_staff_id` bigint unsigned DEFAULT NULL,
    `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ASSIGNED' COMMENT 'ASSIGNED, UNASSIGNED_CRITICAL, REPAIR_PENDING',
    `version` int unsigned NOT NULL DEFAULT '1',
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_assignment_state_staff` (`current_staff_id`),
    CONSTRAINT `fk_assignment_state_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 40: BOOKING_ASSIGNMENTS - Lịch sử từng lượt phân công booking (append-only)
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `booking_assignments` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `booking_id` bigint unsigned NOT NULL,
    `hotel_id` bigint unsigned NOT NULL,
    `staff_user_id` bigint unsigned DEFAULT NULL COMMENT 'Null khi UNASSIGNED_CRITICAL',
    `assignment_version` int unsigned NOT NULL DEFAULT '1',
    `assignment_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'AUTO' COMMENT 'AUTO, MANAGER_FALLBACK, MANUAL_OVERRIDE',
    `competency_level` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `freshness_bucket` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `reason` text COLLATE utf8mb4_unicode_ci,
    `assigned_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `ended_at` datetime DEFAULT NULL,
    `assigned_by` bigint unsigned DEFAULT NULL COMMENT 'NULL nếu SYSTEM auto',
    `previous_assignment_id` bigint unsigned DEFAULT NULL,
    `policy_version` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1.0',
    `source_event_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    UNIQUE KEY `ux_booking_version` (`booking_id`,`assignment_version`),
    KEY `idx_hotel_staff_assigned_time` (`hotel_id`,`staff_user_id`,`assigned_at`),
    CONSTRAINT `fk_booking_assignments_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_booking_assignments_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 41: BOOKING_ASSIGNMENT_COMMAND_RECEIPTS - Chống xử lý phân công lặp (Idempotency)
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `booking_assignment_command_receipts` (
    `booking_id` bigint unsigned NOT NULL,
    `command_key` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SUCCESS, FAILED, SKIPPED',
    `attempts` int unsigned NOT NULL DEFAULT '1',
    `last_error` text COLLATE utf8mb4_unicode_ci,
    `processed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`booking_id`,`command_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 42: BOOKING_PRESENCE_EVENTS - Nhật ký theo dõi dòng đời hiện diện của khách (Đợt 2)
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `booking_presence_events` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `booking_id` bigint unsigned NOT NULL,
    `hotel_id` bigint unsigned NOT NULL,
    `from_status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
    `to_status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
    `actor_type` enum('USER','SYSTEM') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'USER',
    `actor_id` bigint unsigned DEFAULT NULL,
    `event_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ARRIVAL_CONFIRMED, NO_SHOW_MARKED, LATE_CHECK_IN_RECOVERED, DEPARTURE_CONFIRMED, NO_SHOW_CLOSED, LATE_ARRIVAL_NOTICED',
    `late_minutes` int DEFAULT NULL,
    `reason` text COLLATE utf8mb4_unicode_ci,
    `idempotency_key` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `occurred_at` datetime NOT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY `idx_presence_booking_occurred` (`booking_id`,`occurred_at`),
    KEY `idx_presence_hotel_event` (`hotel_id`,`event_type`),
    KEY `idx_presence_idempotency` (`idempotency_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ====================================================================================================
-- PHẦN 8C: QUẢN LÝ CA TRỰC (STAFF SHIFTS & HANDOVERS), PHÊ DUYỆT (APPROVALS) & SỰ CỐ ĐIỀU PHỐI
-- ====================================================================================================
-- Mô tả: Quản lý lịch phân ca lễ tân, chấm công vào/ra ca, bàn giao ca kèm quỹ tiền mặt, phê duyệt ngoại lệ và hàng đợi sự cố điều phối.
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- Bảng 43: STAFF_SHIFTS - Lịch phân ca trực, khung giờ kế hoạch, chấm công thực tế và đối soát két tiền mặt
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `staff_shifts` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `hotel_id` bigint unsigned NOT NULL,
    `staff_user_id` bigint unsigned NOT NULL,
    `shift_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    `shift_date` date NOT NULL,
    `planned_start_at` datetime DEFAULT NULL,
    `planned_end_at` datetime DEFAULT NULL,
    `hotel_timezone` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    `start_time` datetime DEFAULT NULL,
    `end_time` datetime DEFAULT NULL,
    `actual_clock_in_at` datetime DEFAULT NULL,
    `actual_clock_out_at` datetime DEFAULT NULL,
    `attendance_confirmed_by` bigint unsigned DEFAULT NULL,
    `version` int unsigned NOT NULL DEFAULT '1',
    `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SCHEDULED' COMMENT 'SCHEDULED, ACTIVE, COMPLETED, CANCELLED',
    `opening_cash_float` decimal(15,2) NOT NULL DEFAULT '0.00',
    `closing_cash_counted` decimal(15,2) DEFAULT NULL,
    `cash_variance` decimal(15,2) DEFAULT NULL,
    `handover_note` text COLLATE utf8mb4_unicode_ci,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_staff_shifts_hotel_staff_status` (`hotel_id`,`staff_user_id`,`status`),
    KEY `idx_staff_shifts_hotel_date` (`hotel_id`,`shift_date`),
    CONSTRAINT `fk_staff_shifts_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_staff_shifts_user` FOREIGN KEY (`staff_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 44: SHIFT_HANDOVERS - Biên bản bàn giao ca trực, công việc tồn đọng và bàn giao tiền mặt giữa nhân viên
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `shift_handovers` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `shift_id` bigint unsigned NOT NULL,
    `hotel_id` bigint unsigned NOT NULL,
    `from_staff_id` bigint unsigned NOT NULL,
    `to_staff_id` bigint unsigned NOT NULL,
    `pending_tasks` text COLLATE utf8mb4_unicode_ci,
    `cash_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
    `special_notes` text COLLATE utf8mb4_unicode_ci,
    `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING, ACCEPTED, REJECTED',
    `accepted_at` datetime DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY `idx_shift_handovers_shift` (`shift_id`),
    KEY `idx_shift_handovers_hotel_status` (`hotel_id`,`status`),
    CONSTRAINT `fk_shift_handovers_shift` FOREIGN KEY (`shift_id`) REFERENCES `staff_shifts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 45: APPROVAL_REQUESTS - Yêu cầu phê duyệt hoàn tiền, ghi đè giá, giảm giá, miễn phí và đền bù dịch vụ
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `approval_requests` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `hotel_id` bigint unsigned NOT NULL,
    `booking_id` bigint unsigned DEFAULT NULL,
    `request_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'REFUND, RATE_OVERRIDE, DISCOUNT, COMPLIMENTARY, SERVICE_RECOVERY',
    `requested_by` bigint unsigned NOT NULL,
    `amount` decimal(15,2) NOT NULL DEFAULT '0.00',
    `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
    `evidence_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING, APPROVED, REJECTED',
    `reviewed_by` bigint unsigned DEFAULT NULL,
    `reviewed_at` datetime DEFAULT NULL,
    `review_note` text COLLATE utf8mb4_unicode_ci,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_approval_requests_hotel_status` (`hotel_id`,`status`),
    KEY `idx_approval_requests_booking` (`booking_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 46: BOOKING_ASSIGNMENT_INCIDENTS - Hàng đợi sự cố điều phối (UNASSIGNED_CRITICAL, COVERAGE_GAP_CRITICAL)
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `booking_assignment_incidents` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `booking_id` bigint unsigned NOT NULL,
    `hotel_id` bigint unsigned NOT NULL,
    `kind` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
    `severity` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'CRITICAL',
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
    `opened_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `due_at` datetime DEFAULT NULL,
    `current_owner_id` bigint unsigned DEFAULT NULL,
    `retry_count` int unsigned NOT NULL DEFAULT '0',
    `last_error` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `resolved_at` datetime DEFAULT NULL,
    `command_key` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    KEY `ix_incident_hotel_status` (`hotel_id`,`status`,`due_at`),
    KEY `ix_incident_booking_kind` (`booking_id`,`kind`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 47: SCHEMA_MIGRATIONS - Sổ đăng ký phiên bản migration và checksum SHA-256 chống chạy trùng
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `schema_migrations` (
    `version` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
    `checksum` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
    `applied_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ====================================================================================================
-- PHẦN 8D: ĐỢT 3 & ĐỢT 4 - BÀN GIAO TẠM THỜI (COVERAGE), NHIỆM VỤ PHỤC VỤ KHÁCH (GUEST WORK) & HỘI THOẠI
-- ====================================================================================================
-- Mô tả: Ủy quyền hỗ trợ tạm thời A -> B giữ nguyên A là người chịu trách nhiệm chính, quản lý task SLA, bằng chứng và chat.
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- Bảng 48: BOOKING_COVERAGE_GRANTS - Ủy quyền hỗ trợ tạm thời (A giữ handled_by, B được phép thao tác trong [start_at, end_at])
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `booking_coverage_grants` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `booking_id` bigint unsigned NOT NULL,
    `hotel_id` bigint unsigned NOT NULL,
    `principal_staff_id` bigint unsigned NOT NULL,
    `delegate_staff_id` bigint unsigned NOT NULL,
    `mode` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'TEMPORARY',
    `start_at` datetime NOT NULL,
    `end_at` datetime NOT NULL,
    `status` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE' COMMENT 'REQUESTED, APPROVED_PENDING_ACCEPTANCE, SCHEDULED, ACTIVE, DECLINED, EXPIRED, REVOKED',
    `requested_by` bigint unsigned DEFAULT NULL,
    `approved_by` bigint unsigned DEFAULT NULL,
    `approved_at` datetime DEFAULT NULL,
    `accepted_by` bigint unsigned DEFAULT NULL,
    `accepted_at` datetime DEFAULT NULL,
    `accept_deadline` datetime DEFAULT NULL,
    `scope_mode` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'TASK_TYPES' COMMENT 'TASK_TYPES, TASK_IDS, BOOKING_TASKS',
    `absence_request_id` bigint unsigned DEFAULT NULL,
    `completion_deadline` datetime DEFAULT NULL,
    `allowed_task_types` text COLLATE utf8mb4_unicode_ci NOT NULL,
    `created_by` bigint unsigned NOT NULL,
    `reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `command_key` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `version` int unsigned NOT NULL DEFAULT '1',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `ix_coverage_booking_time` (`booking_id`,`start_at`,`end_at`),
    KEY `ix_coverage_delegate_status` (`delegate_staff_id`,`status`),
    CONSTRAINT `fk_coverage_absence` FOREIGN KEY (`absence_request_id`) REFERENCES `staff_absence_requests` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 49: BOOKING_COVERAGE_Events - Nhật ký sự kiện bàn giao tạm thời & chuyển giao hoàn toàn
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `booking_coverage_events` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `grant_id` bigint unsigned DEFAULT NULL,
    `booking_id` bigint unsigned NOT NULL,
    `event_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
    `actor_id` bigint unsigned DEFAULT NULL,
    `old_value` text COLLATE utf8mb4_unicode_ci,
    `new_value` text COLLATE utf8mb4_unicode_ci,
    `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `occurred_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY `ix_coverage_events_booking` (`booking_id`,`occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 50: GUEST_WORK_TASKS - Nhiệm vụ phục vụ khách lưu trú gắn SLA phản hồi và SLA hoàn thành
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `guest_work_tasks` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `hotel_id` bigint unsigned NOT NULL,
    `booking_id` bigint unsigned NOT NULL,
    `type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
    `source_table` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `source_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `assigned_staff_id` bigint unsigned DEFAULT NULL,
    `active_executor_id` bigint unsigned DEFAULT NULL,
    `coverage_grant_id` bigint unsigned DEFAULT NULL,
    `execution_lease_until` datetime DEFAULT NULL,
    `owner_at_create` bigint unsigned DEFAULT NULL,
    `status` varchar(25) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'CREATED',
    `priority` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NORMAL',
    `title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `description` text COLLATE utf8mb4_unicode_ci,
    `response_sla_due_at` datetime DEFAULT NULL,
    `resolution_sla_due_at` datetime DEFAULT NULL,
    `first_response_at` datetime DEFAULT NULL,
    `started_at` datetime DEFAULT NULL,
    `completed_at` datetime DEFAULT NULL,
    `verified_at` datetime DEFAULT NULL,
    `version` int unsigned NOT NULL DEFAULT '1',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `ux_tasks_source` (`source_table`,`source_id`),
    KEY `ix_tasks_hotel_assignee_status` (`hotel_id`,`assigned_staff_id`,`status`),
    KEY `ix_tasks_booking_type` (`booking_id`,`type`),
    CONSTRAINT `fk_task_executor` FOREIGN KEY (`active_executor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_task_coverage` FOREIGN KEY (`coverage_grant_id`) REFERENCES `booking_coverage_grants` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 51: BOOKING_COVERAGE_TASK_SCOPES - Phạm vi nhiệm vụ cụ thể (TASK_IDS) được phép thao tác trong Coverage Grant
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `booking_coverage_task_scopes` (
    `grant_id` bigint unsigned NOT NULL,
    `task_id` bigint unsigned NOT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`grant_id`,`task_id`),
    KEY `ix_coverage_scope_task` (`task_id`),
    CONSTRAINT `fk_scope_grant` FOREIGN KEY (`grant_id`) REFERENCES `booking_coverage_grants` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_scope_task` FOREIGN KEY (`task_id`) REFERENCES `guest_work_tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 52: GUEST_WORK_EVENTS - Nhật ký sự kiện thực thi nhiệm vụ phục vụ khách (append-only, phục vụ tính KPI)
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `guest_work_events` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `task_id` bigint unsigned NOT NULL,
    `booking_id` bigint unsigned NOT NULL,
    `hotel_id` bigint unsigned NOT NULL,
    `actor_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'USER',
    `actor_staff_id` bigint unsigned DEFAULT NULL,
    `event_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
    `from_status` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `to_status` varchar(25) COLLATE utf8mb4_unicode_ci NOT NULL,
    `occurred_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `evidence_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `evidence_ref` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `idempotency_key` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `recorded_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY `ix_work_events_task` (`task_id`,`occurred_at`),
    KEY `ix_work_events_actor` (`actor_staff_id`,`occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 53: GUEST_WORK_EVIDENCE - Bằng chứng hoàn thành công việc phục vụ khách
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `guest_work_evidence` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `task_id` bigint unsigned NOT NULL,
    `submitted_by` bigint unsigned NOT NULL,
    `type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
    `storage_ref` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `verification_status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
    `verified_by` bigint unsigned DEFAULT NULL,
    `verified_at` datetime DEFAULT NULL,
    `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY `ix_evidence_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 54: GUEST_CONVERSATIONS - Kênh hội thoại hỗ trợ trực tiếp theo từng đơn đặt phòng
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `guest_conversations` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `booking_id` bigint unsigned NOT NULL,
    `hotel_id` bigint unsigned NOT NULL,
    `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `ux_conversation_booking` (`booking_id`),
    KEY `ix_conversation_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- Bảng 55: GUEST_MESSAGES - Tin nhắn trao đổi giữa khách hàng và nhân viên phụ trách/hỗ trợ
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `guest_messages` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `conversation_id` bigint unsigned NOT NULL,
    `sender_user_id` bigint unsigned NOT NULL,
    `sender_role` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'CUSTOMER',
    `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
    `client_msg_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    `sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY `ix_messages_conversation` (`conversation_id`,`sent_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ====================================================================================================
-- PHẦN 8E: ĐỢT 5 & ĐỢT 6 - ĐÁNH GIÁ SAO NHÂN VIÊN, HỆ THỐNG KPI 100 ĐIỂM & KHUYẾN MÃI / SỔ QUYỀN LỢI
-- ====================================================================================================
-- =============================================================================
-- TRAVELEKE: MIGRATION STAFF KPI & REVIEWS (ĐỢT 5)
-- Hệ thống chấm điểm KPI 100 điểm, đánh giá sao khách hàng & điều chỉnh của Quản lý
-- =============================================================================

CREATE TABLE IF NOT EXISTS `guest_staff_reviews` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `reviewer_user_id` BIGINT UNSIGNED NOT NULL,
  `staff_user_id` BIGINT UNSIGNED NOT NULL,
  `stage` VARCHAR(30) NOT NULL,
  `stars` INT UNSIGNED NOT NULL,
  `comment` TEXT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `current_revision` INT UNSIGNED NOT NULL DEFAULT 1,
  `submitted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX `ux_review_booking_staff_stage_user` (`booking_id`, `staff_user_id`, `stage`, `reviewer_user_id`),
  INDEX `ix_review_staff_stage` (`staff_user_id`, `stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `guest_staff_review_revisions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `review_id` BIGINT UNSIGNED NOT NULL,
  `version` INT UNSIGNED NOT NULL,
  `old_stars` INT UNSIGNED NOT NULL,
  `new_stars` INT UNSIGNED NOT NULL,
  `old_comment` TEXT NULL,
  `new_comment` TEXT NULL,
  `changed_by` BIGINT UNSIGNED NOT NULL,
  `reason` VARCHAR(255) NULL,
  `changed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `ix_revisions_review` (`review_id`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `staff_kpi_policies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `hotel_id` BIGINT UNSIGNED NULL,
  `policy_version` VARCHAR(20) NOT NULL DEFAULT 'v1.0',
  `effective_from` DATETIME NOT NULL,
  `weights_json` TEXT NOT NULL,
  `sla_rules_json` TEXT NULL,
  `min_sample_json` TEXT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `staff_kpi_period_scores` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `staff_user_id` BIGINT UNSIGNED NOT NULL,
  `period_key` VARCHAR(20) NOT NULL,
  `policy_version` VARCHAR(20) NOT NULL DEFAULT 'v1.0',
  `calculation_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `total_score` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `coverage_ratio` DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  `sample_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `source_hash` VARCHAR(64) NULL,
  `calculated_at` DATETIME NOT NULL,
  `approved_by` BIGINT UNSIGNED NULL,
  `approved_at` DATETIME NULL,
  `review_note` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX `ux_kpi_period_staff_calc` (`hotel_id`, `staff_user_id`, `period_key`, `calculation_version`),
  INDEX `ix_kpi_hotel_period` (`hotel_id`, `period_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `staff_kpi_metric_scores` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `period_score_id` BIGINT UNSIGNED NOT NULL,
  `metric_code` VARCHAR(50) NOT NULL,
  `weight` DECIMAL(5,2) NOT NULL,
  `eligible` TINYINT(1) NOT NULL DEFAULT 1,
  `numerator` INT UNSIGNED NOT NULL DEFAULT 0,
  `denominator` INT UNSIGNED NOT NULL DEFAULT 0,
  `raw_value` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `score` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `evidence_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `no_data_reason` VARCHAR(255) NULL,
  INDEX `ix_metric_period_score` (`period_score_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `staff_kpi_adjustments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `staff_user_id` BIGINT UNSIGNED NOT NULL,
  `period_key` VARCHAR(20) NOT NULL,
  `metric_code` VARCHAR(50) NOT NULL,
  `delta` DECIMAL(5,2) NOT NULL,
  `evidence_ref` VARCHAR(255) NULL,
  `reason` VARCHAR(255) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
  `requested_by` BIGINT UNSIGNED NOT NULL,
  `reviewed_by` BIGINT UNSIGNED NULL,
  `reviewed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `ix_adjustments_staff_period` (`hotel_id`, `staff_user_id`, `period_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- TRAVELEKE: MIGRATION PRICING & PROMOTIONS MODULE (V1)
-- Quản lý chiến dịch giảm giá, gói ưu đãi, báo giá từng đêm & sổ quyền lợi/cấn trừ
-- =============================================================================

CREATE TABLE IF NOT EXISTS `promotion_campaigns` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(60) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `description` TEXT NULL,
  `campaign_type` VARCHAR(40) NOT NULL DEFAULT 'STAY_DATE',
  `status` VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  `charge_component_type` VARCHAR(30) NOT NULL DEFAULT 'ROOM_NIGHT',
  `target_scope` VARCHAR(30) NOT NULL DEFAULT 'ROOM_IDS',
  `target_room_ids_json` TEXT NULL,
  `target_service_ids_json` TEXT NULL,
  `stay_start_date` VARCHAR(10) NOT NULL COMMENT 'YYYY-MM-DD local hotel date inclusive',
  `stay_end_exclusive_date` VARCHAR(10) NOT NULL COMMENT 'YYYY-MM-DD local hotel date exclusive [start, end)',
  `bookable_start_at` DATETIME NULL,
  `bookable_end_at` DATETIME NULL,
  `service_start_hour` TINYINT UNSIGNED NULL,
  `service_end_hour` TINYINT UNSIGNED NULL,
  `discount_type` VARCHAR(30) NOT NULL DEFAULT 'FIXED_AMOUNT',
  `discount_value` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `floor_price` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `max_discount_per_night` DECIMAL(15,2) NULL,
  `max_discount_per_booking` DECIMAL(15,2) NULL,
  `min_nights` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `min_rooms` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `min_guests` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `min_order_amount` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `benefit_kind` VARCHAR(40) NOT NULL DEFAULT 'ROOM_PRICE_ADJUSTMENT',
  `existing_bookings_eligible` TINYINT(1) NOT NULL DEFAULT 1,
  `retroactive_mode` TINYINT(1) NOT NULL DEFAULT 0,
  `combinability_policy` VARCHAR(20) NOT NULL DEFAULT 'EXCLUSIVE',
  `sponsor_type` VARCHAR(20) NOT NULL DEFAULT 'HOTEL',
  `hotel_timezone` VARCHAR(50) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  `budget_total` DECIMAL(15,2) NULL,
  `budget_reserved` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `budget_consumed` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `budget_reversed` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `max_redemptions` INT UNSIGNED NULL,
  `redemptions_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `package_config_json` TEXT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `approved_by` BIGINT UNSIGNED NULL,
  `approved_at` DATETIME NULL,
  `published_at` DATETIME NULL,
  `paused_reason` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX `ux_promo_hotel_code_ver` (`hotel_id`, `code`, `version`),
  INDEX `ix_promo_hotel_status_dates` (`hotel_id`, `status`, `stay_start_date`, `stay_end_exclusive_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `booking_price_quotes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `quote_code` VARCHAR(64) NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `room_id` BIGINT UNSIGNED NOT NULL,
  `room_quantity` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `total_guests` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `check_in_local_date` VARCHAR(10) NOT NULL,
  `check_out_local_date` VARCHAR(10) NOT NULL,
  `nights_count` SMALLINT UNSIGNED NOT NULL,
  `base_total` DECIMAL(15,2) NOT NULL,
  `discount_total` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `payable_total` DECIMAL(15,2) NOT NULL,
  `currency` VARCHAR(10) NOT NULL DEFAULT 'VND',
  `hotel_timezone` VARCHAR(50) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  `price_hash` VARCHAR(64) NOT NULL,
  `nightly_lines_json` TEXT NOT NULL,
  `applied_campaigns_json` TEXT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `expires_at` DATETIME NOT NULL,
  `confirmed_at` DATETIME NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX `ux_price_quote_code` (`quote_code`),
  INDEX `ix_price_quotes_booking` (`booking_id`),
  INDEX `ix_price_quotes_hotel` (`hotel_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `booking_benefit_accounts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `campaign_id` BIGINT UNSIGNED NULL,
  `benefit_kind` VARCHAR(40) NOT NULL DEFAULT 'ROOM_PRICE_ADJUSTMENT' COMMENT 'ROOM_PRICE_ADJUSTMENT, SERVICE_BENEFIT_CREDIT, INCLUDED_QUOTA',
  `source_type` VARCHAR(40) NOT NULL DEFAULT 'CAMPAIGN_RETROACTIVE',
  `status` VARCHAR(30) NOT NULL DEFAULT 'APPROVED' COMMENT 'PENDING_REVIEW, APPROVED, SETTLED, EXPIRED, CANCELLED',
  `currency` VARCHAR(10) NOT NULL DEFAULT 'VND',
  `granted_amount` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `redeemed_amount` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `reversed_amount` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `refunded_amount` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `available_amount` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `granted_quota` INT UNSIGNED NOT NULL DEFAULT 0,
  `used_quota` INT UNSIGNED NOT NULL DEFAULT 0,
  `available_quota` INT UNSIGNED NOT NULL DEFAULT 0,
  `allowed_service_ids_json` TEXT NULL,
  `customer_accepted_credit` TINYINT(1) NOT NULL DEFAULT 0,
  `expires_at` DATETIME NULL,
  `dedupe_key` VARCHAR(160) NOT NULL,
  `approved_by` BIGINT UNSIGNED NULL,
  `approved_at` DATETIME NULL,
  `note` VARCHAR(255) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX `ux_benefit_account_dedupe` (`dedupe_key`),
  INDEX `ix_benefit_account_booking` (`booking_id`, `status`),
  INDEX `ix_benefit_account_hotel` (`hotel_id`, `benefit_kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `booking_benefit_ledger` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `account_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `campaign_id` BIGINT UNSIGNED NULL,
  `entry_type` VARCHAR(30) NOT NULL COMMENT 'GRANT, REDEEM, REVERSAL, REFUND_SETTLEMENT, EXPIRE',
  `amount_delta` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `balance_after` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `quota_delta` INT NOT NULL DEFAULT 0,
  `quota_after` INT UNSIGNED NOT NULL DEFAULT 0,
  `service_request_id` BIGINT UNSIGNED NULL,
  `reference_entry_id` BIGINT UNSIGNED NULL,
  `performed_by` BIGINT UNSIGNED NULL,
  `coverage_grant_id` BIGINT UNSIGNED NULL,
  `idempotency_key` VARCHAR(160) NOT NULL,
  `reason` VARCHAR(255) NULL,
  `metadata_json` TEXT NULL,
  `occurred_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX `ux_benefit_ledger_idem` (`idempotency_key`),
  INDEX `ix_benefit_ledger_booking` (`booking_id`, `occurred_at`),
  INDEX `ix_benefit_ledger_service_req` (`service_request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- TRAVELEKE: MIGRATION PRICING & PROMOTIONS V2 FINANCE & CONSENT (ADDITIVE)
-- Bảng quản lý ý định hoàn tiền thực (Refund Intents) & Bản ghi đồng ý của khách hàng (Consent Records)
-- =============================================================================

CREATE TABLE IF NOT EXISTS `promotion_refund_intents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `account_id` BIGINT UNSIGNED NOT NULL,
  `payment_id` BIGINT UNSIGNED NULL,
  `amount` DECIMAL(15,2) NOT NULL,
  `channel` VARCHAR(30) NOT NULL DEFAULT 'VNPAY_PROVIDER' COMMENT 'VNPAY_PROVIDER, BANK_TRANSFER_PROOF, CASH_RECEIPT',
  `status` VARCHAR(30) NOT NULL DEFAULT 'REQUESTED' COMMENT 'REQUESTED, PROCESSING, SUCCEEDED, FAILED, UNKNOWN_RECONCILE',
  `provider_ref` VARCHAR(120) NULL,
  `payout_receipt_ref` VARCHAR(160) NULL,
  `idempotency_key` VARCHAR(160) NOT NULL,
  `requested_by` BIGINT UNSIGNED NOT NULL,
  `verified_by` BIGINT UNSIGNED NULL,
  `reason` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX `ux_promo_refund_intent_idem` (`idempotency_key`),
  INDEX `ix_promo_refund_intent_booking` (`booking_id`, `status`),
  INDEX `ix_promo_refund_intent_account` (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `benefit_consent_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `account_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `guest_user_id` BIGINT UNSIGNED NOT NULL,
  `channel` VARCHAR(30) NOT NULL DEFAULT 'CUSTOMER_APP',
  `terms_version` VARCHAR(20) NOT NULL DEFAULT 'v1.0',
  `evidence_ref` VARCHAR(255) NULL,
  `consented_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `ix_benefit_consent_account` (`account_id`),
  INDEX `ix_benefit_consent_booking` (`booking_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



-- ====================================================================================================
-- PHẦN 8F: ONLINE EXTENSIONS & 32 HOSPITALITY GAPS - PHÒNG VẬT LÝ, BUỒNG PHÒNG, FOLIO, ĐỔI LỊCH, RATE PLANS, VOUCHER, PRE-CHECK-IN & THÔNG BÁO
-- ====================================================================================================
CREATE TABLE IF NOT EXISTS `hotel_business_settings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `iana_timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  `locale` VARCHAR(16) NOT NULL DEFAULT 'vi-VN',
  `currency` CHAR(3) NOT NULL DEFAULT 'VND',
  `cutoff_time` TIME NOT NULL DEFAULT '04:00:00',
  `require_room_inspection` TINYINT(1) NOT NULL DEFAULT 1,
  `allow_guest_room_number_reveal` TINYINT(1) NOT NULL DEFAULT 0,
  `free_early_checkin_minutes` SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  `free_late_checkout_minutes` SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_hotel_business_settings_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hotel_feature_flags` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `flag_key` VARCHAR(64) NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `config_json` JSON NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_hotel_feature_flag` (`hotel_id`, `flag_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `room_units` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NOT NULL,
  `room_number` VARCHAR(40) NOT NULL,
  `floor` VARCHAR(20) NULL,
  `floor_code` VARCHAR(40) NULL,
  `building` VARCHAR(50) NULL,
  `bed_config` VARCHAR(80) NULL,
  `is_accessible` TINYINT(1) NOT NULL DEFAULT 0,
  `is_smoking` TINYINT(1) NOT NULL DEFAULT 0,
  `verification_status` VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED',
  `housekeeping_state` VARCHAR(30) NOT NULL DEFAULT 'READY',
  `operational_state` VARCHAR(20) NOT NULL DEFAULT 'IN_SERVICE',
  `operational_status` VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  `last_cleaned_at` DATETIME NULL,
  `last_inspected_at` DATETIME NULL,
  `last_inspected_by` BIGINT UNSIGNED NULL,
  `notes` TEXT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_room_unit_number` (`hotel_id`, `room_number`),
  KEY `ix_room_unit_type` (`hotel_id`, `room_type_id`),
  KEY `IDX_room_units_hotel_type_state` (`hotel_id`, `room_type_id`, `operational_status`, `housekeeping_state`),
  CONSTRAINT `fk_unit_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels`(`id`),
  CONSTRAINT `fk_unit_type` FOREIGN KEY (`room_type_id`) REFERENCES `rooms`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `room_unit_allocations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `booking_room_id` BIGINT UNSIGNED NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NOT NULL,
  `room_unit_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED',
  `check_in_date` DATE NOT NULL,
  `check_out_date` DATE NOT NULL,
  `assigned_by` BIGINT UNSIGNED NOT NULL,
  `assigned_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `checked_in_at` DATETIME NULL,
  `released_at` DATETIME NULL,
  `release_reason` VARCHAR(100) NULL,
  `command_id` VARCHAR(100) NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_room_unit_alloc_cmd` (`command_id`),
  KEY `IDX_room_unit_alloc_booking` (`booking_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `room_unit_stay_slots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `allocation_id` BIGINT UNSIGNED NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NULL,
  `room_unit_id` BIGINT UNSIGNED NULL,
  `unit_id` BIGINT UNSIGNED NULL,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `stay_date` DATE NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `allocated_by` BIGINT UNSIGNED NULL,
  `source_command_key` VARCHAR(128) NULL,
  `allocated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `released_at` DATETIME(3) NULL,
  `active_unit_key` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE
      WHEN `released_at` IS NULL AND `status` = 'ACTIVE' THEN COALESCE(`room_unit_id`, `unit_id`)
      ELSE NULL
    END
  ) STORED,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_active_unit_per_night` (`active_unit_key`, `stay_date`),
  KEY `ix_booking_slots` (`booking_id`, `stay_date`, `released_at`),
  KEY `ix_hotel_slots` (`hotel_id`, `stay_date`),
  CONSTRAINT `fk_slot_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `room_unit_allocation_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `allocation_id` BIGINT UNSIGNED NULL,
  `from_unit_id` BIGINT UNSIGNED NULL,
  `to_unit_id` BIGINT UNSIGNED NULL,
  `from_room_type_id` BIGINT UNSIGNED NULL,
  `to_room_type_id` BIGINT UNSIGNED NULL,
  `event_type` VARCHAR(40) NOT NULL,
  `move_type` VARCHAR(30) NULL,
  `price_delta_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `reason` VARCHAR(255) NULL,
  `actor_id` BIGINT UNSIGNED NOT NULL,
  `approved_by` BIGINT UNSIGNED NULL,
  `command_id` VARCHAR(100) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_room_unit_alloc_event_cmd` (`command_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Part 2: Housekeeping, Maintenance Blocks, Room Incidents, Multi-Line Hold Items
CREATE TABLE IF NOT EXISTS `housekeeping_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `unit_id` BIGINT UNSIGNED NULL,
  `room_unit_id` BIGINT UNSIGNED NULL,
  `booking_id` BIGINT UNSIGNED NULL,
  `next_arrival_booking_id` BIGINT UNSIGNED NULL,
  `kind` VARCHAR(30) NOT NULL DEFAULT 'CHECKOUT_CLEAN',
  `task_type` VARCHAR(30) NOT NULL DEFAULT 'CHECKOUT_CLEAN',
  `priority` VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  `status` VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  `assigned_to` BIGINT UNSIGNED NULL,
  `assignee_user_id` BIGINT UNSIGNED NULL,
  `cleaned_by` BIGINT UNSIGNED NULL,
  `inspector_id` BIGINT UNSIGNED NULL,
  `inspector_user_id` BIGINT UNSIGNED NULL,
  `inspected_by` BIGINT UNSIGNED NULL,
  `due_at` DATETIME(3) NULL,
  `sla_due_at` DATETIME NULL,
  `started_at` DATETIME NULL,
  `cleaned_at` DATETIME NULL,
  `inspected_at` DATETIME NULL,
  `checklist_json` JSON NULL,
  `issue_note` TEXT NULL,
  `rejection_reason` TEXT NULL,
  `notes` TEXT NULL,
  `source_event_key` VARCHAR(128) NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_housekeeping_source_event` (`source_event_key`),
  KEY `ix_housekeeping_hotel_work` (`hotel_id`, `status`, `due_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `housekeeping_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `unit_id` BIGINT UNSIGNED NOT NULL,
  `event_type` VARCHAR(40) NOT NULL,
  `from_status` VARCHAR(30) NULL,
  `to_status` VARCHAR(30) NOT NULL,
  `actor_id` BIGINT UNSIGNED NOT NULL,
  `note` TEXT NULL,
  `command_id` VARCHAR(100) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_housekeeping_events_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `room_unit_blocks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NULL,
  `room_unit_id` BIGINT UNSIGNED NOT NULL,
  `block_type` VARCHAR(30) NOT NULL DEFAULT 'OUT_OF_ORDER',
  `start_date` DATE NOT NULL,
  `end_exclusive_date` DATE NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  `requested_by` BIGINT UNSIGNED NULL,
  `approved_by` BIGINT UNSIGNED NULL,
  `released_by` BIGINT UNSIGNED NULL,
  `released_at` DATETIME NULL,
  `impacted_booking_ids_json` JSON NULL,
  `source_command_key` VARCHAR(128) NULL,
  `command_id` VARCHAR(100) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_block_command` (`hotel_id`, `source_command_key`),
  KEY `ix_blocks_room_dates` (`room_unit_id`, `start_date`, `end_exclusive_date`, `status`),
  CONSTRAINT `fk_block_unit` FOREIGN KEY (`room_unit_id`) REFERENCES `room_units`(`id`),
  CONSTRAINT `chk_room_unit_block_dates` CHECK (`end_exclusive_date` > `start_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `room_type_stop_sell_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NOT NULL,
  `start_date` DATE NOT NULL,
  `end_exclusive_date` DATE NOT NULL,
  `blocked_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `stop_sell` TINYINT(1) NOT NULL DEFAULT 1,
  `reason` VARCHAR(255) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `created_by` BIGINT UNSIGNED NOT NULL,
  `command_id` VARCHAR(100) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_stop_sell_cmd` (`command_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `room_incidents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NOT NULL,
  `affected_unit_id` BIGINT UNSIGNED NULL,
  `incident_type` VARCHAR(40) NOT NULL DEFAULT 'ROOM_NOT_READY',
  `severity` VARCHAR(20) NOT NULL DEFAULT 'HIGH',
  `status` VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  `owner_user_id` BIGINT UNSIGNED NOT NULL,
  `manager_user_id` BIGINT UNSIGNED NULL,
  `sla_due_at` DATETIME NOT NULL,
  `resolution_type` VARCHAR(40) NULL,
  `proposed_unit_id` BIGINT UNSIGNED NULL,
  `proposed_room_type_id` BIGINT UNSIGNED NULL,
  `compensation_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `customer_consent_at` DATETIME NULL,
  `resolved_at` DATETIME NULL,
  `resolved_by` BIGINT UNSIGNED NULL,
  `source_key` VARCHAR(120) NOT NULL,
  `notes` TEXT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_room_incident_source_key` (`source_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Part 3: Pricing, Amendments, Folio, Night Audit, Documents, Precheckin, CRM & Optional R5
CREATE TABLE IF NOT EXISTS `incident_actions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `incident_id` BIGINT UNSIGNED NOT NULL,
  `action_type` VARCHAR(40) NOT NULL,
  `from_status` VARCHAR(30) NULL,
  `to_status` VARCHAR(30) NOT NULL,
  `actor_id` BIGINT UNSIGNED NOT NULL,
  `payload_json` JSON NULL,
  `note` TEXT NULL,
  `command_id` VARCHAR(100) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_incident_actions_incident` (`incident_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `booking_hold_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hold_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NOT NULL,
  `rate_plan_id` BIGINT UNSIGNED NULL,
  `line_index` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `quantity` SMALLINT UNSIGNED NOT NULL,
  `adults` SMALLINT UNSIGNED NOT NULL DEFAULT 2,
  `children` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `unit_base_price_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `check_in_date` DATE NOT NULL,
  `check_out_date` DATE NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'HELD',
  `expires_at` DATETIME NOT NULL,
  `committed_at` DATETIME NULL,
  `released_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_booking_hold_items_line` (`booking_id`, `line_index`, `room_type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rate_plans` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(150) NOT NULL DEFAULT 'Standard Rate',
  `meal_plan` VARCHAR(30) NOT NULL DEFAULT 'ROOM_ONLY',
  `refundable` TINYINT NOT NULL DEFAULT 1,
  `is_refundable` TINYINT(1) NOT NULL DEFAULT 1,
  `cancellation_policy_id` BIGINT UNSIGNED NULL,
  `base_occupancy` SMALLINT UNSIGNED NOT NULL DEFAULT 2,
  `extra_adult_fee_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `extra_child_fee_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `floor_price_vnd` DECIMAL(15,2) NOT NULL DEFAULT 100000.00,
  `ceiling_price_vnd` DECIMAL(15,2) NULL,
  `priority` INT NOT NULL DEFAULT 100,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hotel_rate_code` (`hotel_id`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rate_calendar` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rate_plan_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NULL,
  `room_type_id` BIGINT UNSIGNED NULL,
  `stay_date` DATE NOT NULL,
  `base_vnd` BIGINT NOT NULL,
  `adjustment_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `min_nights` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `minimum_nights` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `closed` TINYINT(1) NOT NULL DEFAULT 0,
  `closed_to_arrival` TINYINT NOT NULL DEFAULT 0,
  `closed_to_departure` TINYINT NOT NULL DEFAULT 0,
  `season_label` VARCHAR(60) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rate_night` (`rate_plan_id`, `stay_date`),
  CONSTRAINT `fk_rate_calendar_plan` FOREIGN KEY (`rate_plan_id`) REFERENCES `rate_plans`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `booking_restrictions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NULL,
  `rate_plan_id` BIGINT UNSIGNED NULL,
  `stay_date` DATE NOT NULL,
  `min_nights` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `max_nights` SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  `closed_to_arrival` TINYINT(1) NOT NULL DEFAULT 0,
  `closed_to_departure` TINYINT(1) NOT NULL DEFAULT 0,
  `stop_sell` TINYINT(1) NOT NULL DEFAULT 0,
  `cutoff_at` TIME NULL,
  `advance_min_hours` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `advance_max_days` SMALLINT UNSIGNED NOT NULL DEFAULT 365,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tax_fee_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `kind` VARCHAR(20) NOT NULL DEFAULT 'TAX',
  `calc_type` VARCHAR(30) NOT NULL DEFAULT 'PERCENT',
  `rate_or_amount` DECIMAL(15,4) NOT NULL,
  `is_inclusive` TINYINT(1) NOT NULL DEFAULT 0,
  `applies_to` VARCHAR(30) NOT NULL DEFAULT 'ROOM_AND_SERVICE',
  `compound_order` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `effective_from` DATE NOT NULL,
  `effective_to` DATE NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_tax_fee_hotel_code_ver` (`hotel_id`, `code`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cancellation_policies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `policy_type` VARCHAR(30) NOT NULL DEFAULT 'FLEXIBLE',
  `free_cancel_cutoff_hours` SMALLINT UNSIGNED NOT NULL DEFAULT 48,
  `late_cancel_penalty_type` VARCHAR(30) NOT NULL DEFAULT 'FIRST_NIGHT',
  `late_cancel_penalty_value` DECIMAL(10,2) NOT NULL DEFAULT 100.00,
  `no_show_penalty_type` VARCHAR(30) NOT NULL DEFAULT 'FIRST_NIGHT',
  `no_show_penalty_value` DECIMAL(10,2) NOT NULL DEFAULT 100.00,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_cancellation_policy_hotel_code_ver` (`hotel_id`, `code`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `booking_cancellation_policy_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `policy_id` BIGINT UNSIGNED NULL,
  `policy_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `policy_snapshot_json` JSON NOT NULL,
  `quote_hash` CHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_booking_cancel_policy_snapshot` (`booking_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `booking_amendments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `amendment_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `amendment_type` VARCHAR(40) NOT NULL DEFAULT 'DATE_CHANGE',
  `status` VARCHAR(40) NOT NULL DEFAULT 'QUOTED',
  `command_key` VARCHAR(128) NOT NULL,
  `expected_booking_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `previous_snapshot_json` JSON NULL,
  `before_snapshot_json` JSON NULL,
  `proposed_json` JSON NULL,
  `requested_change_json` JSON NULL,
  `old_total_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `new_total_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `delta_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `penalty_fee_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `quote_hash` CHAR(64) NOT NULL,
  `quote_expires_at` DATETIME(3) NOT NULL,
  `consented_at` DATETIME(3) NULL,
  `customer_consent_at` DATETIME NULL,
  `surcharge_payment_id` BIGINT UNSIGNED NULL,
  `payment_txn_id` BIGINT UNSIGNED NULL,
  `requested_by` BIGINT UNSIGNED NULL,
  `reviewed_by` BIGINT UNSIGNED NULL,
  `approved_by` BIGINT UNSIGNED NULL,
  `committed_at` DATETIME NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_amendment_booking_command` (`booking_id`, `command_key`),
  KEY `ix_amendment_state` (`booking_id`, `status`),
  CONSTRAINT `fk_amendment_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `amendment_hold_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `amendment_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NOT NULL,
  `stay_date` DATE NOT NULL,
  `delta_quantity` SMALLINT NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'HELD',
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `IDX_amendment_hold_items_amendment` (`amendment_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stay_time_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_unit_id` BIGINT UNSIGNED NULL,
  `request_type` VARCHAR(30) NOT NULL,
  `requested_time` DATETIME NOT NULL,
  `fee_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `is_complimentary` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
  `requested_by` BIGINT UNSIGNED NOT NULL,
  `approved_by` BIGINT UNSIGNED NULL,
  `approved_at` DATETIME NULL,
  `folio_entry_id` BIGINT UNSIGNED NULL,
  `command_id` VARCHAR(100) NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_stay_time_req_cmd` (`command_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `folios` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `folio_number` VARCHAR(40) NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'VND',
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `is_backfilled_verified` TINYINT(1) NOT NULL DEFAULT 1,
  `total_debit_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `total_payment_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `total_credit_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `total_refund_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `outstanding_balance_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `closed_at` DATETIME NULL,
  `closed_by` BIGINT UNSIGNED NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_folio_booking` (`booking_id`),
  CONSTRAINT `fk_folio_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `folio_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `folio_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NULL,
  `entry_kind` VARCHAR(40) NOT NULL,
  `direction` VARCHAR(10) NOT NULL DEFAULT 'DEBIT',
  `source_type` VARCHAR(50) NOT NULL,
  `source_id` VARCHAR(100) NOT NULL,
  `amount_vnd` BIGINT NOT NULL,
  `tax_amount_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `business_date` DATE NULL,
  `reverses_entry_id` BIGINT UNSIGNED NULL,
  `description` VARCHAR(255) NULL,
  `idempotency_key` VARCHAR(180) NOT NULL,
  `actor_user_id` BIGINT UNSIGNED NULL,
  `actor_id` BIGINT UNSIGNED NULL,
  `approved_by` BIGINT UNSIGNED NULL,
  `posted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `metadata_json` JSON NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_folio_post_once` (`idempotency_key`),
  KEY `ix_folio_entries` (`folio_id`, `posted_at`),
  KEY `ix_folio_source` (`source_type`, `source_id`),
  CONSTRAINT `fk_folio_entry_parent` FOREIGN KEY (`folio_id`) REFERENCES `folios`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `folio_settlements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `folio_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NULL,
  `hotel_id` BIGINT UNSIGNED NULL,
  `settlement_kind` VARCHAR(30) NOT NULL DEFAULT 'DESK_SETTLEMENT',
  `method` VARCHAR(30) NOT NULL DEFAULT 'VN_QR_TRANSFER',
  `amount_vnd` BIGINT NOT NULL,
  `provider_ref` VARCHAR(120) NULL,
  `receipt_ref` VARCHAR(120) NULL,
  `evidence_url` VARCHAR(500) NULL,
  `paid_at` DATETIME(3) NULL,
  `verified_at` DATETIME(3) NULL,
  `verified_by` BIGINT UNSIGNED NULL,
  `recorded_by` BIGINT UNSIGNED NULL,
  `approved_by` BIGINT UNSIGNED NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'PENDING_VERIFICATION',
  `idempotency_key` VARCHAR(180) NULL,
  `command_id` VARCHAR(100) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_settlement_once` (`idempotency_key`),
  KEY `ix_folio_settlement` (`folio_id`, `status`),
  CONSTRAINT `fk_folio_settlement` FOREIGN KEY (`folio_id`) REFERENCES `folios`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `business_day_closures` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `business_date` DATE NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  `rooms_available` INT UNSIGNED NOT NULL DEFAULT 0,
  `rooms_sold` INT UNSIGNED NOT NULL DEFAULT 0,
  `occupancy_rate` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `room_revenue_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `service_revenue_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `verified_payments_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `open_folios_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `exceptions_json` JSON NULL,
  `snapshot_hash` CHAR(64) NULL,
  `closed_by` BIGINT UNSIGNED NULL,
  `closed_at` DATETIME NULL,
  `command_id` VARCHAR(100) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_business_day_closure_hotel_date` (`hotel_id`, `business_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `booking_documents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `folio_id` BIGINT UNSIGNED NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `document_number` VARCHAR(50) NOT NULL,
  `type` VARCHAR(30) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ISSUED',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `amount_vnd` DECIMAL(15,2) NOT NULL,
  `buyer_info_json` JSON NULL,
  `source_folio_snapshot` JSON NOT NULL,
  `storage_key` VARCHAR(255) NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `issued_by` BIGINT UNSIGNED NULL,
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `voided_at` DATETIME NULL,
  `void_reason` VARCHAR(255) NULL,
  `command_id` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_booking_doc_number` (`document_number`),
  UNIQUE KEY `UQ_booking_doc_type_ver` (`booking_id`, `type`, `version`),
  UNIQUE KEY `UQ_booking_doc_cmd` (`command_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `service_packages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `description` TEXT NULL,
  `charge_basis` VARCHAR(30) NOT NULL DEFAULT 'PER_STAY',
  `package_price_vnd` DECIMAL(15,2) NOT NULL,
  `daily_capacity` SMALLINT UNSIGNED NULL,
  `available_from_hour` TINYINT UNSIGNED NULL,
  `available_to_hour` TINYINT UNSIGNED NULL,
  `included_services_json` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_service_package_hotel_code` (`hotel_id`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `precheckin_submissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NULL,
  `submitted_by` BIGINT UNSIGNED NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `current_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `status` VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED',
  `expected_arrival_at` DATETIME(3) NULL,
  `eta` DATETIME NULL,
  `arrival_transport` VARCHAR(50) NULL,
  `bed_preference` VARCHAR(80) NULL,
  `special_requests` TEXT NULL,
  `guest_data_json` JSON NULL,
  `guest_data_minimal_json` JSON NULL,
  `reviewed_by` BIGINT UNSIGNED NULL,
  `reviewed_at` DATETIME NULL,
  `review_note` TEXT NULL,
  `command_id` VARCHAR(100) NULL,
  `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_precheckin_version` (`booking_id`, `version`),
  CONSTRAINT `fk_precheckin_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `precheckin_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_precheckin_token_hash` (`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `booking_guest_occupants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_line_id` BIGINT UNSIGNED NULL,
  `unit_id` BIGINT UNSIGNED NULL,
  `contact_role` VARCHAR(20) NOT NULL DEFAULT 'OCCUPANT',
  `full_name` VARCHAR(150) NOT NULL,
  `is_adult` TINYINT(1) NOT NULL DEFAULT 1,
  `child_age` TINYINT UNSIGNED NULL,
  `phone` VARCHAR(25) NULL,
  `lead_guest` TINYINT(1) NOT NULL DEFAULT 0,
  `verified_at` DATETIME NULL,
  `verified_by` BIGINT UNSIGNED NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notification_intents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NULL,
  `source_event_id` VARCHAR(128) NOT NULL,
  `template_key` VARCHAR(80) NOT NULL,
  `template_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `channel` VARCHAR(20) NOT NULL,
  `recipient_key` VARCHAR(160) NOT NULL,
  `payload_json` JSON NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `retry_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(3) NULL,
  `next_retry_at` DATETIME NULL,
  `last_error` TEXT NULL,
  `delivered_at` DATETIME NULL,
  `command_key` VARCHAR(180) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notification_intent` (`source_event_id`, `template_key`, `channel`, `recipient_key`),
  KEY `ix_notification_due` (`status`, `next_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notification_deliveries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `intent_id` BIGINT UNSIGNED NOT NULL,
  `attempt_no` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `status` VARCHAR(20) NOT NULL,
  `provider_ref` VARCHAR(120) NULL,
  `error_code` VARCHAR(60) NULL,
  `error_message` VARCHAR(255) NULL,
  `delivered_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hotel_stay_reviews` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `reviewer_user_id` BIGINT UNSIGNED NOT NULL,
  `overall_rating` TINYINT UNSIGNED NOT NULL,
  `cleanliness_rating` TINYINT UNSIGNED NOT NULL,
  `room_quality_rating` TINYINT UNSIGNED NOT NULL,
  `service_rating` TINYINT UNSIGNED NOT NULL,
  `location_rating` TINYINT UNSIGNED NOT NULL,
  `comment` TEXT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED',
  `manager_response` TEXT NULL,
  `responded_by` BIGINT UNSIGNED NULL,
  `responded_at` DATETIME NULL,
  `moderation_reason` VARCHAR(255) NULL,
  `feedback_case_status` VARCHAR(30) NULL,
  `feedback_owner_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_stay_review_booking_user` (`booking_id`, `reviewer_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `guest_preferences` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `preferred_bed_type` VARCHAR(50) NULL,
  `preferred_floor` VARCHAR(30) NULL,
  `quiet_room` TINYINT(1) NOT NULL DEFAULT 0,
  `dietary_notes` VARCHAR(255) NULL,
  `preference_consent` TINYINT(1) NOT NULL DEFAULT 0,
  `marketing_consent` TINYINT(1) NOT NULL DEFAULT 0,
  `consent_updated_at` DATETIME NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_guest_preferences_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `guest_data_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `request_type` VARCHAR(30) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
  `notes` TEXT NULL,
  `processed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `voucher_codes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NULL,
  `campaign_id` BIGINT UNSIGNED NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(150) NOT NULL DEFAULT '',
  `discount_type` VARCHAR(20) NOT NULL DEFAULT 'FIXED_AMOUNT',
  `discount_value` DECIMAL(15,2) NOT NULL,
  `max_discount_vnd` DECIMAL(15,2) NULL,
  `min_spend_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `min_nights` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `max_uses_total` INT UNSIGNED NOT NULL DEFAULT 100,
  `total_quota` INT UNSIGNED NOT NULL DEFAULT 100,
  `used_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `redeemed_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `max_uses_per_user` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `per_customer_limit` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `allow_stack_with_campaign` TINYINT(1) NOT NULL DEFAULT 0,
  `valid_from` DATETIME NOT NULL,
  `valid_to` DATETIME NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_voucher_codes_code` (`code`),
  UNIQUE KEY `UQ_voucher_hotel_code` (`hotel_id`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `voucher_reservations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `voucher_id` BIGINT UNSIGNED NULL,
  `voucher_code_id` BIGINT UNSIGNED NULL,
  `quote_id` BIGINT UNSIGNED NULL,
  `booking_id` BIGINT UNSIGNED NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `customer_id` BIGINT UNSIGNED NULL,
  `code` VARCHAR(50) NOT NULL DEFAULT '',
  `discount_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `discount_amount_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `status` VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
  `command_key` VARCHAR(128) NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME NULL,
  `released_at` DATETIME NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_voucher_res_quote` (`quote_id`, `code`),
  KEY `ix_voucher_res_booking` (`booking_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hotel_listing_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `checkin_policy` TEXT NOT NULL,
  `child_policy` TEXT NOT NULL,
  `pet_policy` VARCHAR(255) NOT NULL DEFAULT 'NO_PETS',
  `smoking_policy` VARCHAR(255) NOT NULL DEFAULT 'NON_SMOKING',
  `cancellation_summary` TEXT NOT NULL,
  `amenities_json` JSON NOT NULL,
  `quality_score` TINYINT UNSIGNED NOT NULL DEFAULT 100,
  `published_by` BIGINT UNSIGNED NULL,
  `published_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_hotel_listing_ver` (`hotel_id`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Part 4: R5 Optional Tables (Strictly OFF by default via FeatureFlagsService)
CREATE TABLE IF NOT EXISTS `payment_schedules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `installment_no` TINYINT UNSIGNED NOT NULL,
  `purpose` VARCHAR(30) NOT NULL DEFAULT 'DEPOSIT',
  `amount_vnd` DECIMAL(15,2) NOT NULL,
  `due_at` DATETIME NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `payment_txn_id` BIGINT UNSIGNED NULL,
  `paid_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_payment_schedule_installment` (`booking_id`, `installment_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `security_deposits` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `held_amount_vnd` DECIMAL(15,2) NOT NULL,
  `deducted_amount_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `refunded_amount_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `status` VARCHAR(30) NOT NULL DEFAULT 'HELD_IN_ESCROW',
  `damage_reason` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_security_deposits_booking` (`booking_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `channel_connections` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NOT NULL,
  `channel_code` VARCHAR(40) NOT NULL,
  `feed_url` VARCHAR(500) NULL,
  `export_token_hash` CHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'INACTIVE',
  `last_synced_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_channel_conn_export_token` (`export_token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `external_reservations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `connection_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NOT NULL,
  `channel_code` VARCHAR(40) NOT NULL,
  `external_reservation_id` VARCHAR(150) NOT NULL,
  `start_date` DATE NOT NULL,
  `end_exclusive_date` DATE NOT NULL,
  `quantity` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_external_reservation_uid` (`channel_code`, `external_reservation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `guest_booking_access_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `scopes_json` JSON NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `claimed_by_user_id` BIGINT UNSIGNED NULL,
  `revoked_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_guest_access_token_hash` (`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `waitlist_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NOT NULL,
  `customer_id` BIGINT UNSIGNED NOT NULL,
  `start_date` DATE NOT NULL,
  `end_exclusive_date` DATE NOT NULL,
  `quantity` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `max_price_per_night_vnd` DECIMAL(15,2) NULL,
  `consent` TINYINT(1) NOT NULL DEFAULT 1,
  `status` VARCHAR(20) NOT NULL DEFAULT 'WAITING',
  `notified_at` DATETIME NULL,
  `offer_expires_at` DATETIME NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `room_unit_allocation_commands` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `command_key` VARCHAR(128) NOT NULL,
  `actor_user_id` BIGINT UNSIGNED NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `result_json` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_booking_allocation_command` (`booking_id`, `command_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `booking_active_amendments` (
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `amendment_id` BIGINT UNSIGNED NOT NULL,
  `lease_until` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`booking_id`),
  UNIQUE KEY `uq_active_amendment_id` (`amendment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;









-- ====================================================================================================
-- PHẦN 9: BỘ DỮ LIỆU MẪU MẶC ĐỊNH CHUẨN (MASTER SEEDS DATA - NẠP SẴN HOẠT ĐỘNG NGAY)
-- ====================================================================================================

-- 9.1 Seed Danh Mục Vai Trò (3 vai trò chính trong hệ thống)
INSERT INTO roles (id, name, display_name, description, is_system) VALUES
    (1, 'ADMIN',    'Quản Trị Viên', 'Toàn quyền quản trị hệ thống', 1),
    (2, 'EMPLOYEE', 'Nhân Viên',     'Quản lý khách sạn, phòng, đơn đặt phòng và dịch vụ', 1),
    (3, 'CUSTOMER', 'Khách Hàng',    'Đặt phòng và quản lý chuyến đi cá nhân', 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- 9.2 Seed Danh Mục Quyền Hạn (24 quyền hạn chi tiết các modules chức năng)
INSERT INTO permissions (id, module, action, name, description) VALUES
    (1,  'hotels',   'create',        'hotels.create',        'Tạo khách sạn mới'),
    (2,  'hotels',   'read',          'hotels.read',          'Xem danh sách và chi tiết khách sạn'),
    (3,  'hotels',   'update',        'hotels.update',        'Cập nhật thông tin khách sạn'),
    (4,  'hotels',   'delete',        'hotels.delete',        'Xóa khách sạn'),
    (5,  'hotels',   'manage_images', 'hotels.manage_images', 'Upload và quản lý album ảnh khách sạn'),
    (6,  'rooms',    'create',        'rooms.create',         'Tạo phòng mới'),
    (7,  'rooms',    'read',          'rooms.read',           'Xem danh sách và chi tiết phòng'),
    (8,  'rooms',    'update',        'rooms.update',         'Cập nhật thông tin phòng'),
    (9,  'rooms',    'delete',        'rooms.delete',         'Xóa phòng'),
    (10, 'rooms',    'manage_images', 'rooms.manage_images',  'Upload và quản lý album ảnh phòng'),
    (11, 'bookings', 'read',          'bookings.read',        'Xem danh sách và chi tiết đơn đặt phòng'),
    (12, 'bookings', 'update_status', 'bookings.update_status','Duyệt, xác nhận, từ chối đơn đặt phòng'),
    (13, 'bookings', 'delete',        'bookings.delete',      'Xóa đơn đặt phòng'),
    (14, 'users',    'read',          'users.read',           'Xem danh sách tài khoản nhân viên'),
    (15, 'users',    'create',        'users.create',         'Tạo tài khoản nhân viên mới'),
    (16, 'users',    'update',        'users.update',         'Cập nhật thông tin tài khoản nhân viên'),
    (17, 'users',    'delete',        'users.delete',         'Xóa tài khoản nhân viên'),
    (18, 'users',    'manage_staff',  'users.manage_staff',   'Quản lý và phân công nhân viên'),
    (19, 'users',    'update_role',   'users.update_role',    'Thay đổi quyền/role của tài khoản'),
    (20, 'users',    'update_status', 'users.update_status',  'Khoá/Mở khoá tài khoản nhân viên'),
    (21, 'services', 'read',          'services.read',        'Xem danh sách dịch vụ và yêu cầu dịch vụ'),
    (22, 'services', 'manage',        'services.manage',      'Thêm, sửa cấu hình bảng giá và phân loại dịch vụ'),
    (23, 'skills',   'read',          'skills.read',          'Xem hồ sơ năng lực và ma trận kỹ năng nhân viên'),
    (24, 'skills',   'manage',        'skills.manage',        'Đánh giá, phê duyệt chứng chỉ và kỹ năng nhân viên')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- 9.3 Gán Toàn Quyền Cho Vai Trò Quản Trị Viên (ADMIN)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions;

-- 9.4 Gán Quyền Vận Hành Cơ Bản Cho Vai Trò Nhân Viên (EMPLOYEE)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions
WHERE name IN (
    'hotels.create', 'hotels.read', 'hotels.update', 'hotels.manage_images',
    'rooms.create',  'rooms.read',  'rooms.update',  'rooms.manage_images',
    'bookings.read', 'bookings.update_status',
    'services.read', 'skills.read'
);

-- 9.5 Seed Danh Mục Địa Điểm Du Lịch Tiêu Biểu
INSERT INTO locations (id, code, name, type, status) VALUES
    (1, 'HCM', 'TP. Hồ Chí Minh', 'CITY', 'ACTIVE'),
    (2, 'HN',  'Hà Nội',         'CITY', 'ACTIVE'),
    (3, 'DN',  'Đà Nẵng',         'CITY', 'ACTIVE')
ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status);

-- 9.6 Seed Danh Mục Loại Hình Khách Sạn & Nghỉ Dưỡng
INSERT INTO hotel_types (id, code, name, description, status) VALUES
    (1, 'HOTEL',    'Khách sạn',             'Cơ sở lưu trú dạng khách sạn tiêu chuẩn', 'ACTIVE'),
    (2, 'RESORT',   'Khu nghỉ dưỡng',         'Khu nghỉ dưỡng có nhiều dịch vụ cao cấp', 'ACTIVE'),
    (3, 'HOMESTAY', 'Homestay',              'Mô hình lưu trú gần gũi địa phương',      'ACTIVE'),
    (4, 'HOSTEL',   'Hostel',                'Lưu trú tiết kiệm hoặc phòng tập thể',     'ACTIVE'),
    (5, 'VILLA',    'Biệt thự nghỉ dưỡng',    'Biệt thự dành cho nhóm hoặc gia đình',    'ACTIVE')
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description);

-- 9.7 Seed Danh Sách Tài Khoản Mặc Định
-- Mật khẩu mặc định chung: 123456789 (Bcrypt hash salt 12)
INSERT INTO users (id, full_name, email, phone, password, role, status, email_verified_at) VALUES
    (1, 'Super Admin',           'admin@traveleke.vn',          '0901234567', '$2b$12$u0KyTp2ztwRmR0/Bo7IPL.ovoNv5EUr4lF8UYuQr/Z6cHxixIMEMu', 'ADMIN',    'ACTIVE', NOW()),
    (2, 'Nhân Viên Vận Hành',    'nhanvien@traveleke.vn',       '0902345678', '$2b$12$u0KyTp2ztwRmR0/Bo7IPL.ovoNv5EUr4lF8UYuQr/Z6cHxixIMEMu', 'EMPLOYEE', 'ACTIVE', NOW()),
    (3, 'Khách Hàng Trải Nghiệm','khachhang@traveleke.vn',      '0903456789', '$2b$12$u0KyTp2ztwRmR0/Bo7IPL.ovoNv5EUr4lF8UYuQr/Z6cHxixIMEMu', 'CUSTOMER', 'ACTIVE', NOW()),
    (4, 'Quản Trị Viên (Traveloka)','admintraveloka@gmail.com',  '0904567890', '$2b$12$u0KyTp2ztwRmR0/Bo7IPL.ovoNv5EUr4lF8UYuQr/Z6cHxixIMEMu', 'ADMIN',    'ACTIVE', NOW()),
    (5, 'Nhân Viên (Traveloka)', 'nhanvientraveloka@gmail.com', '0905678901', '$2b$12$u0KyTp2ztwRmR0/Bo7IPL.ovoNv5EUr4lF8UYuQr/Z6cHxixIMEMu', 'EMPLOYEE', 'ACTIVE', NOW()),
    (6, 'Khách Hàng (Demo)',     'user@traveleke.vn',           '0906789012', '$2b$12$u0KyTp2ztwRmR0/Bo7IPL.ovoNv5EUr4lF8UYuQr/Z6cHxixIMEMu', 'CUSTOMER', 'ACTIVE', NOW())
ON DUPLICATE KEY UPDATE
    password = VALUES(password),
    role = VALUES(role),
    status = VALUES(status),
    email_verified_at = NOW();

-- Gán quyền vào bảng liên kết users_roles
INSERT IGNORE INTO users_roles (user_id, role_id)
SELECT u.id, 1 FROM users u WHERE u.email IN ('admin@traveleke.vn', 'admintraveloka@gmail.com');

INSERT IGNORE INTO users_roles (user_id, role_id)
SELECT u.id, 2 FROM users u WHERE u.email IN ('nhanvien@traveleke.vn', 'nhanvientraveloka@gmail.com');

INSERT IGNORE INTO users_roles (user_id, role_id)
SELECT u.id, 3 FROM users u WHERE u.email IN ('khachhang@traveleke.vn', 'user@traveleke.vn');

-- 9.8 Seed Danh Sách Khách Sạn Tiêu Biểu
INSERT INTO hotels (id, hotel_type_id, location_id, name, slug, description, star_rating, address, phone, email, cover_image_url, status) VALUES
    (1, 1, 1, 'Khách sạn Caravelle Sài Gòn', 'khach-san-caravelle-sai-gon', 'Khách sạn 5 sao sang trọng ngay trung tâm Quận 1 với tầm nhìn tráng lệ ra toàn cảnh thành phố.', 5, '19-23 Công Trường Lam Sơn, Bến Nghé, Quận 1, TP. Hồ Chí Minh', '02838234999', 'caravelle@traveleke.vn', '/uploads/hotels/hotels-1786794920215-472320896.png', 'ACTIVE'),
    (2, 1, 3, 'Furama Resort Đà Nẵng', 'furama-resort-da-nang', 'Khu nghỉ dưỡng 5 sao hướng biển Bắc Mỹ An tuyệt đẹp với hệ sinh thái ẩm thực và hồ bơi vô cực đẳng cấp.', 5, '105 Võ Nguyên Giáp, Ngũ Hành Sơn, Đà Nẵng', '02363847333', 'furama@traveleke.vn', '/uploads/hotels/hotels-1786798592187-334845302.png', 'ACTIVE'),
    (3, 1, 2, 'Lotte Hotel Hà Nội', 'lotte-hotel-ha-noi', 'Tọa lạc trên các tầng cao của tòa nhà Lotte Center, mang đến trải nghiệm nghỉ dưỡng 5 sao trên tầng mây.', 5, '54 Liễu Giai, Ba Đình, Hà Nội', '02433331000', 'lotte@traveleke.vn', '/uploads/hotels/hotels-1788620536254-73388191.png', 'ACTIVE')
ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address), cover_image_url = VALUES(cover_image_url);

-- 9.9 Seed Thư Viện Hình Ảnh Khách Sạn
INSERT INTO hotel_images (hotel_id, image_url, caption, sort_order, is_primary) VALUES
    (1, '/uploads/hotels/hotels-1786794920215-472320896.png', 'Mặt tiền khách sạn Caravelle', 0, 1),
    (1, '/uploads/hotels/hotels-1786795692411-620859.png',     'Sảnh chính Caravelle', 1, 0),
    (2, '/uploads/hotels/hotels-1786798592187-334845302.png', 'Khuôn viên Furama Resort', 0, 1),
    (2, '/uploads/hotels/hotels-1786798592184-324501.jpg',     'Hồ bơi hướng biển Furama', 1, 0),
    (3, '/uploads/hotels/hotels-1788620536254-73388191.png',  'Toàn cảnh Lotte Hotel Hà Nội', 0, 1)
ON DUPLICATE KEY UPDATE caption = VALUES(caption);

-- 9.10 Seed Danh Sách Hạng Phòng Nghỉ Chuẩn
INSERT INTO rooms (id, hotel_id, name, slug, description, price_per_night, max_adults, max_children, total_rooms, available_rooms, bed_count, bed_type, room_size, rating, review_count, cover_image_url, status) VALUES
    (1, 1, 'Phòng Deluxe City View', 'phong-deluxe-city-view-caravelle', 'Phòng nghỉ tiện nghi hiện đại với cửa kính panorama view ngắm trung tâm thành phố Sài Gòn rực rỡ ánh đèn.', 1850000, 2, 1, 10, 8, 1, 'Giường Đôi', 38, 4.90, 48, '/uploads/rooms/rooms-1786797511481-837351127.png', 'AVAILABLE'),
    (2, 1, 'Phòng Premium Suite King', 'phong-premium-suite-king-caravelle', 'Suite cao cấp với phòng khách riêng biệt, bồn tắm nằm massage và đặc quyền sử dụng Signature Lounge.', 3200000, 2, 2, 5, 4, 1, 'Giường Đôi King', 56, 5.00, 32, '/uploads/rooms/rooms-1786797511488-924455364.png', 'AVAILABLE'),
    (3, 2, 'Phòng Ocean Deluxe Biển Mỹ An', 'phong-ocean-deluxe-bien-my-an', 'Phòng hướng biển với ban công thoáng mát, đón gió biển tự nhiên trong lành và không gian thư giãn tuyệt đối.', 2450000, 2, 1, 12, 10, 1, 'Giường Đôi', 45, 4.95, 75, '/uploads/rooms/rooms-1786798401064-252341834.jpg', 'AVAILABLE'),
    (4, 2, 'Biệt Thự Hướng Vườn Furama Villa', 'biet-thu-huong-vuon-furama-villa', 'Villa sân vườn nhiệt đới với hồ bơi riêng biệt, không gian nghỉ dưỡng biệt lập lý tưởng cho gia đình.', 5900000, 4, 2, 4, 3, 2, '2 Giường Đôi King', 120, 5.00, 26, '/uploads/rooms/rooms-1786803009948-438879937.png', 'AVAILABLE'),
    (5, 3, 'Phòng Grand Deluxe Lotte', 'phong-grand-deluxe-lotte', 'Thiết kế phong cách tối giản thanh lịch với view hồ Tây thơ mộng từ trên cao cùng giường nệm êm ái.', 2100000, 2, 1, 15, 12, 1, 'Giường Đôi', 42, 4.88, 54, '/uploads/rooms/rooms-1788621367940-828756673.png', 'AVAILABLE'),
    (6, 3, 'Phòng Club Junior Suite', 'phong-club-junior-suite-lotte', 'Không gian sang trọng với bàn làm việc cao cấp, bồn tắm ngắm mây và bữa sáng buffet thượng hạng miễn phí.', 3800000, 2, 1, 6, 5, 1, 'Giường Đôi King', 65, 4.96, 41, '/uploads/rooms/rooms-1788621480468-810683228.png', 'AVAILABLE')
ON DUPLICATE KEY UPDATE name = VALUES(name), price_per_night = VALUES(price_per_night), cover_image_url = VALUES(cover_image_url);

-- 9.11 Seed Thư Viện Hình Ảnh Phòng Nghỉ
INSERT INTO room_images (room_id, image_url, caption, sort_order, is_primary) VALUES
    (1, '/uploads/rooms/rooms-1786797511481-837351127.png', 'Ảnh phòng Deluxe City View', 0, 1),
    (2, '/uploads/rooms/rooms-1786797511488-924455364.png', 'Ảnh phòng Premium Suite King', 0, 1),
    (3, '/uploads/rooms/rooms-1786798401064-252341834.jpg', 'Ảnh phòng Ocean Deluxe', 0, 1),
    (4, '/uploads/rooms/rooms-1786803009948-438879937.png', 'Ảnh Biệt Thự Hướng Vườn', 0, 1),
    (5, '/uploads/rooms/rooms-1788621367940-828756673.png', 'Ảnh phòng Grand Deluxe Lotte', 0, 1),
    (6, '/uploads/rooms/rooms-1788621480468-810683228.png', 'Ảnh phòng Club Junior Suite', 0, 1)
ON DUPLICATE KEY UPDATE caption = VALUES(caption);

-- 9.12 Seed Danh Mục Dịch Vụ Khách Sạn Chuẩn
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

-- 9.13 Seed Dịch Vụ Phòng Chuẩn (5 Dịch Vụ Miễn Phí Đi Kèm + 5 Dịch Vụ Trả Phí Add-on)
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

-- 9.14 Gán Mặc Định Toàn Bộ Dịch Vụ Miễn Phí Cho Toàn Bộ Các Phòng
INSERT IGNORE INTO room_service_assignments (room_id, service_id, is_complimentary)
SELECT r.id, rs.id, 1
FROM rooms r
CROSS JOIN room_services rs
WHERE rs.is_complimentary = 1;

-- 9.15 Seed Danh Mục Kỹ Năng Nghiệp Vụ Chuẩn (Skill Categories)
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

-- 9.16 Seed Bộ Quy Tắc Điều Phối Nhân Viên Chuẩn (Staff Eligibility Rules)
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


-- 9.17 Seed Chính Sách Chấm Điểm KPI Mặc Định (Staff KPI Policy v1.0)
INSERT INTO staff_kpi_policies (hotel_id, policy_version, effective_from, weights_json, sla_rules_json, min_sample_json, status)
SELECT NULL, 'v1.0', '2026-01-01 00:00:00',
       '{"CHECKIN_ON_TIME":20,"CHECKOUT_ON_TIME":15,"SERVICE_SLA":25,"GUEST_REVIEW":25,"EVIDENCE_COMPLIANCE":15}',
       '{"PRE_ARRIVAL_RESPONSE_MIN":30,"SERVICE_RESPONSE_MIN":15,"SERVICE_RESOLUTION_MIN":45}',
       '{"MIN_TASKS":3,"MIN_REVIEWS":1}',
       'ACTIVE'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM staff_kpi_policies WHERE hotel_id IS NULL AND policy_version = 'v1.0');

-- 9.18 Seed Cấu Hình Vận Hành Khách Sạn Mặc Định (Hotel Business Settings) Cho Tất Cả Khách Sạn
INSERT IGNORE INTO hotel_business_settings (
    hotel_id, iana_timezone, locale, currency, cutoff_time,
    require_room_inspection, allow_guest_room_number_reveal,
    free_early_checkin_minutes, free_late_checkout_minutes, version
)
SELECT h.id, 'Asia/Ho_Chi_Minh', 'vi-VN', 'VND', '04:00:00', 1, 0, 60, 30, 1
FROM hotels h;

-- 9.19 Seed Chính Sách Hủy Phòng Mặc Định (Cancellation Policies) Cho Tất Cả Khách Sạn
INSERT IGNORE INTO cancellation_policies (
    hotel_id, code, name, policy_type, free_cancel_cutoff_hours,
    late_cancel_penalty_type, late_cancel_penalty_value,
    no_show_penalty_type, no_show_penalty_value, status, version
)
SELECT h.id, 'FLEX_48H', 'Hủy miễn phí trước 48 giờ nhận phòng', 'FLEXIBLE', 48,
       'FIRST_NIGHT', 100.00, 'FIRST_NIGHT', 100.00, 'ACTIVE', 1
FROM hotels h;

-- 9.20 Seed Quy Tắc Thuế GTGT (VAT) & Phí Phục Vụ Chuẩn Cho Tất Cả Khách Sạn
INSERT IGNORE INTO tax_fee_rules (
    hotel_id, code, name, kind, calc_type, rate_or_amount,
    is_inclusive, applies_to, compound_order, effective_from, status, version
)
SELECT h.id, 'SERVICE_CHARGE_5', 'Phí phục vụ 5%', 'FEE', 'PERCENT', 5.0000,
       1, 'ROOM_AND_SERVICE', 1, '2026-01-01', 'ACTIVE', 1
FROM hotels h;

INSERT IGNORE INTO tax_fee_rules (
    hotel_id, code, name, kind, calc_type, rate_or_amount,
    is_inclusive, applies_to, compound_order, effective_from, status, version
)
SELECT h.id, 'VAT_8', 'Thuế GTGT (VAT 8%)', 'TAX', 'PERCENT', 8.0000,
       1, 'ROOM_AND_SERVICE', 2, '2026-01-01', 'ACTIVE', 1
FROM hotels h;

-- 9.21 Seed Khóa Điều Phối Phân Công (Hotel Assignment Dispatch Locks) Cho Tất Cả Khách Sạn
INSERT IGNORE INTO hotel_assignment_dispatch_locks (hotel_id, version, updated_at)
SELECT h.id, 0, NOW() FROM hotels h;


-- ====================================================================================================
-- PHẦN 10: TỰ ĐỘNG ĐỒNG BỘ CỘT, CHỈ MỤC & RÀNG BUỘC CHO DATABASE CŨ (IDEMPOTENT SCHEMA UPGRADE)
-- ====================================================================================================
-- Stored Procedure này tự động kiểm tra từng cột/chỉ mục/ràng buộc qua INFORMATION_SCHEMA và bổ sung
-- an toàn nếu chạy trên Database đã tồn tại từ trước (Additive Only - Không làm mất dữ liệu cũ).
-- ====================================================================================================

DROP PROCEDURE IF EXISTS SyncExistingDatabaseColumns;
DELIMITER $$
CREATE PROCEDURE SyncExistingDatabaseColumns()
BEGIN
    -- 1. Bảng users: cột address
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'address') THEN
        ALTER TABLE `users` ADD COLUMN `address` VARCHAR(255) NULL AFTER `phone`;
    END IF;

    -- 2. Bảng rooms: cột service_tier
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rooms' AND COLUMN_NAME = 'service_tier') THEN
        ALTER TABLE `rooms` ADD COLUMN `service_tier` VARCHAR(20) NOT NULL DEFAULT 'STANDARD' AFTER `description`;
    END IF;

    -- 3. Bảng room_services: cột room_type_id và max_quantity
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'room_type_id') THEN
        ALTER TABLE `room_services` ADD COLUMN `room_type_id` BIGINT UNSIGNED NULL AFTER `hotel_id`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'max_quantity') THEN
        ALTER TABLE `room_services` ADD COLUMN `max_quantity` SMALLINT UNSIGNED NULL AFTER `quota_per_night`;
    END IF;

    -- 4. Bảng service_requests: các cột chiến dịch khuyến mãi & snapshot giá gốc
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_requests' AND COLUMN_NAME = 'applied_campaign_id') THEN
        ALTER TABLE `service_requests` ADD COLUMN `applied_campaign_id` BIGINT UNSIGNED NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_requests' AND COLUMN_NAME = 'campaign_version') THEN
        ALTER TABLE `service_requests` ADD COLUMN `campaign_version` INT UNSIGNED NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_requests' AND COLUMN_NAME = 'original_price_snapshot') THEN
        ALTER TABLE `service_requests` ADD COLUMN `original_price_snapshot` DECIMAL(12,2) NULL;
    END IF;

    -- 5. Bảng outbox_events: cột locked_at và locked_by
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbox_events' AND COLUMN_NAME = 'locked_at') THEN
        ALTER TABLE `outbox_events` ADD COLUMN `locked_at` DATETIME NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbox_events' AND COLUMN_NAME = 'locked_by') THEN
        ALTER TABLE `outbox_events` ADD COLUMN `locked_by` VARCHAR(100) NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbox_events' AND INDEX_NAME = 'idx_outbox_claim') THEN
        ALTER TABLE `outbox_events` ADD INDEX `idx_outbox_claim` (`status`, `available_at`, `locked_at`);
    END IF;

    -- 6. Bảng booking_status_logs: cột actor_type và cho phép changed_by NULL
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_status_logs' AND COLUMN_NAME = 'actor_type') THEN
        ALTER TABLE `booking_status_logs` ADD COLUMN `actor_type` VARCHAR(20) NOT NULL DEFAULT 'USER' AFTER `changed_by`;
    END IF;
    ALTER TABLE `booking_status_logs` MODIFY COLUMN `changed_by` BIGINT UNSIGNED NULL;

    -- 7. Bảng bookings: toàn bộ cột phân công, hiện diện No-Show, nguồn đặt phòng, version & idempotency
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'assignment_type') THEN
        ALTER TABLE `bookings` ADD COLUMN `assignment_type` VARCHAR(20) NOT NULL DEFAULT 'AUTO' AFTER `handled_by`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'assignment_note') THEN
        ALTER TABLE `bookings` ADD COLUMN `assignment_note` TEXT NULL AFTER `assignment_type`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'booking_source') THEN
        ALTER TABLE `bookings` ADD COLUMN `booking_source` VARCHAR(30) NOT NULL DEFAULT 'WEBSITE' AFTER `assignment_note`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'created_by_staff_id') THEN
        ALTER TABLE `bookings` ADD COLUMN `created_by_staff_id` BIGINT UNSIGNED NULL AFTER `booking_source`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'reassigned_at') THEN
        ALTER TABLE `bookings` ADD COLUMN `reassigned_at` DATETIME NULL AFTER `created_by_staff_id`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'reassigned_by') THEN
        ALTER TABLE `bookings` ADD COLUMN `reassigned_by` BIGINT UNSIGNED NULL AFTER `reassigned_at`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'actual_check_in_at') THEN
        ALTER TABLE `bookings` ADD COLUMN `actual_check_in_at` DATETIME NULL AFTER `cancelled_at`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'actual_check_out_at') THEN
        ALTER TABLE `bookings` ADD COLUMN `actual_check_out_at` DATETIME NULL AFTER `actual_check_in_at`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'no_show_at') THEN
        ALTER TABLE `bookings` ADD COLUMN `no_show_at` DATETIME NULL AFTER `actual_check_out_at`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'no_show_grace_minutes') THEN
        ALTER TABLE `bookings` ADD COLUMN `no_show_grace_minutes` SMALLINT UNSIGNED NOT NULL DEFAULT 360 AFTER `no_show_at`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'no_show_closed_at') THEN
        ALTER TABLE `bookings` ADD COLUMN `no_show_closed_at` DATETIME NULL AFTER `no_show_grace_minutes`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'late_check_in_recovered_at') THEN
        ALTER TABLE `bookings` ADD COLUMN `late_check_in_recovered_at` DATETIME NULL AFTER `no_show_closed_at`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'check_in_confirmed_by') THEN
        ALTER TABLE `bookings` ADD COLUMN `check_in_confirmed_by` BIGINT UNSIGNED NULL AFTER `late_check_in_recovered_at`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'check_out_confirmed_by') THEN
        ALTER TABLE `bookings` ADD COLUMN `check_out_confirmed_by` BIGINT UNSIGNED NULL AFTER `check_in_confirmed_by`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'presence_version') THEN
        ALTER TABLE `bookings` ADD COLUMN `presence_version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `check_out_confirmed_by`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'version') THEN
        ALTER TABLE `bookings` ADD COLUMN `version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `presence_version`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'late_arrival_expected_at') THEN
        ALTER TABLE `bookings` ADD COLUMN `late_arrival_expected_at` DATETIME NULL AFTER `version`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'late_arrival_note') THEN
        ALTER TABLE `bookings` ADD COLUMN `late_arrival_note` TEXT NULL AFTER `late_arrival_expected_at`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'checkout_idempotency_key') THEN
        ALTER TABLE `bookings` ADD COLUMN `checkout_idempotency_key` VARCHAR(100) NULL;
        ALTER TABLE `bookings` ADD UNIQUE KEY `uq_checkout_idempotency` (`checkout_idempotency_key`);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'checkout_request_hash') THEN
        ALTER TABLE `bookings` ADD COLUMN `checkout_request_hash` CHAR(64) NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND INDEX_NAME = 'idx_bookings_presence_scheduler') THEN
        ALTER TABLE `bookings` ADD INDEX `idx_bookings_presence_scheduler` (`status`, `check_in_at`, `check_out_at`);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND INDEX_NAME = 'idx_bookings_hotel_status') THEN
        ALTER TABLE `bookings` ADD INDEX `idx_bookings_hotel_status` (`hotel_id`, `status`);
    END IF;

    -- 8. Bảng payment_transactions: cột purpose & amendment_id
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_transactions' AND COLUMN_NAME = 'purpose') THEN
        ALTER TABLE `payment_transactions` ADD COLUMN `purpose` VARCHAR(40) NOT NULL DEFAULT 'INITIAL_BOOKING';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_transactions' AND COLUMN_NAME = 'amendment_id') THEN
        ALTER TABLE `payment_transactions` ADD COLUMN `amendment_id` BIGINT UNSIGNED NULL;
    END IF;

    -- 9. Bảng staff_shifts: các cột planned window & attendance
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_shifts' AND COLUMN_NAME = 'planned_start_at') THEN
        ALTER TABLE `staff_shifts` ADD COLUMN `planned_start_at` DATETIME NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_shifts' AND COLUMN_NAME = 'planned_end_at') THEN
        ALTER TABLE `staff_shifts` ADD COLUMN `planned_end_at` DATETIME NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_shifts' AND COLUMN_NAME = 'hotel_timezone') THEN
        ALTER TABLE `staff_shifts` ADD COLUMN `hotel_timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_shifts' AND COLUMN_NAME = 'actual_clock_in_at') THEN
        ALTER TABLE `staff_shifts` ADD COLUMN `actual_clock_in_at` DATETIME NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_shifts' AND COLUMN_NAME = 'actual_clock_out_at') THEN
        ALTER TABLE `staff_shifts` ADD COLUMN `actual_clock_out_at` DATETIME NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_shifts' AND COLUMN_NAME = 'attendance_confirmed_by') THEN
        ALTER TABLE `staff_shifts` ADD COLUMN `attendance_confirmed_by` BIGINT UNSIGNED NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_shifts' AND COLUMN_NAME = 'version') THEN
        ALTER TABLE `staff_shifts` ADD COLUMN `version` INT UNSIGNED NOT NULL DEFAULT 1;
    END IF;

    -- 10. Bảng booking_coverage_grants & guest_work_tasks: các cột ủy quyền & thực thi
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_coverage_grants' AND COLUMN_NAME = 'requested_by') THEN
        ALTER TABLE `booking_coverage_grants` ADD COLUMN `requested_by` BIGINT UNSIGNED NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_coverage_grants' AND COLUMN_NAME = 'approved_by') THEN
        ALTER TABLE `booking_coverage_grants` ADD COLUMN `approved_by` BIGINT UNSIGNED NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_coverage_grants' AND COLUMN_NAME = 'approved_at') THEN
        ALTER TABLE `booking_coverage_grants` ADD COLUMN `approved_at` DATETIME NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_coverage_grants' AND COLUMN_NAME = 'accepted_by') THEN
        ALTER TABLE `booking_coverage_grants` ADD COLUMN `accepted_by` BIGINT UNSIGNED NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_coverage_grants' AND COLUMN_NAME = 'accepted_at') THEN
        ALTER TABLE `booking_coverage_grants` ADD COLUMN `accepted_at` DATETIME NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_coverage_grants' AND COLUMN_NAME = 'accept_deadline') THEN
        ALTER TABLE `booking_coverage_grants` ADD COLUMN `accept_deadline` DATETIME NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_coverage_grants' AND COLUMN_NAME = 'scope_mode') THEN
        ALTER TABLE `booking_coverage_grants` ADD COLUMN `scope_mode` VARCHAR(20) NOT NULL DEFAULT 'TASK_TYPES';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_coverage_grants' AND COLUMN_NAME = 'absence_request_id') THEN
        ALTER TABLE `booking_coverage_grants` ADD COLUMN `absence_request_id` BIGINT UNSIGNED NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_coverage_grants' AND COLUMN_NAME = 'completion_deadline') THEN
        ALTER TABLE `booking_coverage_grants` ADD COLUMN `completion_deadline` DATETIME NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guest_work_tasks' AND COLUMN_NAME = 'active_executor_id') THEN
        ALTER TABLE `guest_work_tasks` ADD COLUMN `active_executor_id` BIGINT UNSIGNED NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guest_work_tasks' AND COLUMN_NAME = 'coverage_grant_id') THEN
        ALTER TABLE `guest_work_tasks` ADD COLUMN `coverage_grant_id` BIGINT UNSIGNED NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guest_work_tasks' AND COLUMN_NAME = 'execution_lease_until') THEN
        ALTER TABLE `guest_work_tasks` ADD COLUMN `execution_lease_until` DATETIME NULL;
    END IF;

    -- 11. Bảng Online Extensions (room_units, room_unit_stay_slots, folios, folio_entries, folio_settlements)
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_units' AND COLUMN_NAME = 'floor_code') THEN
        ALTER TABLE `room_units` ADD COLUMN `floor_code` VARCHAR(40) NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_units' AND COLUMN_NAME = 'verification_status') THEN
        ALTER TABLE `room_units` ADD COLUMN `verification_status` VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_units' AND COLUMN_NAME = 'operational_state') THEN
        ALTER TABLE `room_units` ADD COLUMN `operational_state` VARCHAR(20) NOT NULL DEFAULT 'IN_SERVICE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_unit_stay_slots' AND COLUMN_NAME = 'room_unit_id') THEN
        ALTER TABLE `room_unit_stay_slots` ADD COLUMN `room_unit_id` BIGINT UNSIGNED NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_unit_stay_slots' AND COLUMN_NAME = 'allocated_by') THEN
        ALTER TABLE `room_unit_stay_slots` ADD COLUMN `allocated_by` BIGINT UNSIGNED NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_unit_stay_slots' AND COLUMN_NAME = 'source_command_key') THEN
        ALTER TABLE `room_unit_stay_slots` ADD COLUMN `source_command_key` VARCHAR(128) NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_unit_stay_slots' AND COLUMN_NAME = 'allocated_at') THEN
        ALTER TABLE `room_unit_stay_slots` ADD COLUMN `allocated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_unit_stay_slots' AND COLUMN_NAME = 'released_at') THEN
        ALTER TABLE `room_unit_stay_slots` ADD COLUMN `released_at` DATETIME(3) NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'folios' AND COLUMN_NAME = 'is_backfilled_verified') THEN
        ALTER TABLE `folios` ADD COLUMN `is_backfilled_verified` TINYINT(1) NOT NULL DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'folio_entries' AND COLUMN_NAME = 'actor_user_id') THEN
        ALTER TABLE `folio_entries` ADD COLUMN `actor_user_id` BIGINT UNSIGNED NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'folio_entries' AND COLUMN_NAME = 'metadata_json') THEN
        ALTER TABLE `folio_entries` ADD COLUMN `metadata_json` JSON NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'folio_settlements' AND COLUMN_NAME = 'settlement_kind') THEN
        ALTER TABLE `folio_settlements` ADD COLUMN `settlement_kind` VARCHAR(30) NOT NULL DEFAULT 'DESK_SETTLEMENT';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'folio_settlements' AND COLUMN_NAME = 'receipt_ref') THEN
        ALTER TABLE `folio_settlements` ADD COLUMN `receipt_ref` VARCHAR(120) NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'folio_settlements' AND COLUMN_NAME = 'verified_by') THEN
        ALTER TABLE `folio_settlements` ADD COLUMN `verified_by` BIGINT UNSIGNED NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'folio_settlements' AND COLUMN_NAME = 'idempotency_key') THEN
        ALTER TABLE `folio_settlements` ADD COLUMN `idempotency_key` VARCHAR(180) NULL;
    END IF;

    -- 12. Cập nhật Check Constraints trạng thái cho bookings, booking_status_logs & payment_transactions
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND CONSTRAINT_NAME = 'chk_bookings_status') THEN
        ALTER TABLE `bookings` DROP CHECK `chk_bookings_status`;
    END IF;
    ALTER TABLE `bookings` ADD CONSTRAINT `chk_bookings_status`
        CHECK (`status` IN ('PAYMENT_PENDING','PENDING','CONFIRMED','REJECTED','CHECKED_IN','COMPLETED','CANCELLED','PAYMENT_EXPIRED','PAYMENT_REVIEW','NO_SHOW','CLOSED_NO_SHOW'));

    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_status_logs' AND CONSTRAINT_NAME = 'chk_booking_status_logs_new_status') THEN
        ALTER TABLE `booking_status_logs` DROP CHECK `chk_booking_status_logs_new_status`;
    END IF;
    ALTER TABLE `booking_status_logs` ADD CONSTRAINT `chk_booking_status_logs_new_status`
        CHECK (`new_status` IN ('PAYMENT_PENDING','PENDING','CONFIRMED','REJECTED','CHECKED_IN','COMPLETED','CANCELLED','PAYMENT_EXPIRED','PAYMENT_REVIEW','NO_SHOW','CLOSED_NO_SHOW'));

    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_status_logs' AND CONSTRAINT_NAME = 'chk_booking_status_logs_old_status') THEN
        ALTER TABLE `booking_status_logs` DROP CHECK `chk_booking_status_logs_old_status`;
    END IF;
    ALTER TABLE `booking_status_logs` ADD CONSTRAINT `chk_booking_status_logs_old_status`
        CHECK (`old_status` IS NULL OR `old_status` IN ('PAYMENT_PENDING','PENDING','CONFIRMED','REJECTED','CHECKED_IN','COMPLETED','CANCELLED','PAYMENT_EXPIRED','PAYMENT_REVIEW','NO_SHOW','CLOSED_NO_SHOW'));

    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_transactions' AND CONSTRAINT_NAME = 'chk_payment_transactions_status') THEN
        ALTER TABLE `payment_transactions` DROP CHECK `chk_payment_transactions_status`;
    END IF;
    ALTER TABLE `payment_transactions` ADD CONSTRAINT `chk_payment_transactions_status`
        CHECK (`status` IN ('CREATED','PENDING','PAID','FAILED','EXPIRED','PAID_REQUIRES_REVIEW','RECONCILIATION_REQUIRED','REFUND_PENDING','REFUNDED'));
END$$
DELIMITER ;

CALL SyncExistingDatabaseColumns();
DROP PROCEDURE IF EXISTS SyncExistingDatabaseColumns;

-- Bật lại kiểm tra foreign key sau khi hoàn tất toàn bộ cấu trúc và dữ liệu
SET FOREIGN_KEY_CHECKS = 1;

-- ====================================================================================================
-- PHẦN 11: TRUY VẤN ĐỐI SOÁT CHỈ ĐỌC TRƯỚC PHÁT HÀNH (READ-ONLY PRE-RELEASE RECONCILIATION CHECKS)
-- ====================================================================================================
-- Các truy vấn dưới đây để ở dạng comment tham chiếu dùng cho Quản trị viên đối soát chỉ đọc (Section 10.3):
-- 1. Booking đã PAID có hold COMMITTED nhưng chưa có người phụ trách:
--    SELECT DISTINCT b.id, b.booking_code, b.hotel_id, b.handled_by FROM bookings b
--    JOIN payment_transactions p ON p.booking_id = b.id AND p.status = 'PAID'
--    JOIN booking_holds h ON h.booking_id = b.id AND h.status = 'COMMITTED'
--    WHERE b.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN') AND b.handled_by IS NULL;
-- 2. Booking PAID chưa có Folio:
--    SELECT DISTINCT b.id, b.booking_code FROM bookings b
--    JOIN payment_transactions p ON p.booking_id = b.id AND p.status = 'PAID'
--    LEFT JOIN folios f ON f.booking_id = b.id WHERE f.id IS NULL;
-- 3. Kiểm tra không có xung đột UNIT x DATE active trong room_unit_stay_slots:
--    SELECT active_unit_key, stay_date, COUNT(*) AS n FROM room_unit_stay_slots
--    WHERE released_at IS NULL GROUP BY active_unit_key, stay_date HAVING COUNT(*) > 1;
-- 4. Đối soát số lượng phòng vật lý (room_units) so với tồn kho thương mại (rooms.total_rooms):
--    SELECT r.hotel_id, r.id AS room_type_id, r.name, r.total_rooms AS commercial_count, COUNT(u.id) AS declared_physical_units
--    FROM rooms r LEFT JOIN room_units u ON u.room_type_id = r.id AND u.hotel_id = r.hotel_id
--    WHERE r.deleted_at IS NULL GROUP BY r.hotel_id, r.id, r.name, r.total_rooms HAVING COUNT(u.id) <> r.total_rooms;

-- ====================================================================================================
-- KIỂM TRA BÁO CÁO TỔNG QUAN TẤT CẢ CÁC BẢNG SAU KHI THỰC THI THÀNH CÔNG
-- ====================================================================================================
SHOW TABLES;
