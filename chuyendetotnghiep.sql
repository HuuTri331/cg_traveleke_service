-- ====================================================================================================
-- TRAVELEKE SYSTEM - TÀI LIỆU CƠ SỞ DỮ LIỆU CHUẨN HOÀN CHỈNH TOÀN DIỆN (CHUYÊN ĐỀ TỐT NGHIỆP)
-- ====================================================================================================
-- TỆP SQL HỢP NHẤT TOÀN DIỆN VÀ DUY NHẤT CHO TOÀN BỘ DỰ ÁN TRAVELEKE:
--   - Cốt lõi bản cũ: chuyendetotnghiep.sql
--   - Tính năng thanh toán & outbox: migration_vnpay_inventory_outbox.sql
--   - Sửa lỗi giữ chỗ & hủy phòng: migration_vnpay_inventory_cancellation_fix.sql
--   - Mở rộng phân quyền & quản lý: phase-2-unified-complete.sql
--
-- TỔNG CỘNG: 34 BẢNG DỮ LIỆU ĐẦY ĐỦ 100% + MASTER SEED DATA + TỰ ĐỘNG ĐỒNG BỘ CHO DATABASE CŨ
-- ====================================================================================================
-- MỤC LỤC DANH SÁCH 34 BẢNG ĐÃ ĐƯỢC HỢP NHẤT:
--   PHẦN 1: HỆ THỐNG PHÂN QUYỀN (RBAC), TÀI KHOẢN & PHIÊN ĐĂNG NHẬP
--      1. roles                        - Vai trò người dùng (ADMIN, EMPLOYEE, CUSTOMER)
--      2. permissions                  - 24 quyền hạn chi tiết các chức năng
--      3. role_permissions             - Bảng liên kết vai trò - quyền hạn
--      4. users                        - Tài khoản khách hàng, nhân viên, quản trị viên
--      5. users_roles                  - Bảng liên kết tài khoản - vai trò
--      6. refresh_tokens               - Quản lý xoay vòng opaque refresh token, chống lộ phiên
--   PHẦN 2: ĐỊA DANH, LOẠI HÌNH LƯU TRÚ & CƠ SỞ KHÁCH SẠN
--      7. locations                    - Quốc gia, Tỉnh/Thành phố phân cấp cha - con
--      8. hotel_types                  - Khách sạn, Resort, Villa, Homestay, Hostel
--      9. hotels                       - Chi tiết cơ sở lưu trú, xếp hạng sao, tọa độ, giờ nhận/trả phòng
--     10. hotel_images                 - Thư viện hình ảnh khách sạn (kèm cờ ảnh đại diện chính)
--     11. hotel_staff                  - Phân công nhân sự phụ trách cơ sở khách sạn
--   PHẦN 3: QUẢN LÝ PHÒNG NGHỈ & THƯ VIỆN HÌNH ẢNH PHÒNG
--     12. rooms                        - Hạng phòng, giá theo đêm, số lượng thực tế & khả dụng
--     13. room_images                  - Bộ sưu tập ảnh chi tiết cho từng loại phòng
--   PHẦN 4: KẾ HOẠCH LỘ TRÌNH & ĐƠN ĐẶT PHÒNG (BOOKINGS)
--     14. trip_plans                   - Kế hoạch du lịch cá nhân, điểm đi, điểm đến, ngân sách
--     15. bookings                     - Đơn đặt phòng (kèm checkout_idempotency_key, hash, 9 trạng thái)
--     16. booking_rooms                - Chi tiết các hạng phòng và đơn giá trong đơn đặt
--     17. booking_status_logs          - Lịch sử biến động trạng thái đơn đặt phòng
--   PHẦN 5: GIỮ CHỖ TẠM THỜI, THANH TOÁN VNPAY, OUTBOX EVENTS & HỦY PHÒNG
--     18. booking_holds                - Giữ chỗ tạm thời theo khoảng [check_in_at, check_out_at) (Unique hold)
--     19. payment_transactions         - Lịch sử giao dịch thanh toán VNPAY (txn_ref, attempt_no, IPN, refund)
--     20. outbox_events                - Transactional Outbox gửi email/socket bất đồng bộ (locked_at, locked_by)
--     21. booking_cancellation_requests - Đơn yêu cầu hủy phòng & quy trình duyệt hoàn tiền
--   PHẦN 6: DỊCH VỤ PHÒNG, GỌI DỊCH VỤ & NHẬT KÝ ĐỀN BÙ SỰ CỐ
--     22. service_categories           - 9 danh mục phân loại dịch vụ phòng
--     23. room_services                - Bảng giá dịch vụ phòng (Miễn phí & Add-on có phí)
--     24. room_service_assignments     - Gán dịch vụ phòng đi kèm theo loại phòng
--     25. service_requests             - Yêu cầu gọi dịch vụ phát sinh kèm SLA cam kết
--     26. booking_service_snapshots    - Bản lưu chụp trạng thái dịch vụ tại thời điểm chốt đơn
--     27. service_recovery_log         - Nhật ký đền bù và xử lý khiếu nại dịch vụ
--   PHẦN 7: MA TRẬN NĂNG LỰC, KỸ NĂNG NHÂN VIÊN & ĐIỀU PHỐI NHIỆM VỤ
--     28. skill_categories             - Tiêu chuẩn kỹ năng nghiệp vụ khách sạn
--     29. staff_skills                 - Hồ sơ năng lực chuyên môn, chứng chỉ và thâm niên
--     30. staff_language_skills        - Năng lực ngoại ngữ và chứng chỉ quốc tế
--     31. staff_assignments            - Lịch sử phân công giao việc theo yêu cầu dịch vụ
--     32. staff_eligibility_rules      - Bộ quy tắc tự động phân công nhân sự thông minh
--   PHẦN 8: NHẬT KÝ HỆ THỐNG & THEO DÕI HÀNH VI CHO AI
--     33. audit_logs                   - Nhật ký kiểm toán thao tác hệ thống
--     34. hotel_tracking_events        - Theo dõi sự kiện xem chi tiết/tìm kiếm để gợi ý AI
--   PHẦN 9: BỘ DỮ LIỆU MẪU MẶC ĐỊNH CHUẨN (MASTER SEEDS DATA - NẠP SẴN CHẠY NGAY)
--   PHẦN 10: TỰ ĐỘNG ĐỒNG BỘ CỘT CHO DATABASE CŨ (MIGRATION COMPATIBILITY CHECK)
-- ====================================================================================================

-- Tùy chọn xóa và khởi tạo lại database sạch sẽ nếu người dùng có quyền DROP DATABASE:
-- DROP DATABASE IF EXISTS hotel_booking_db;

CREATE DATABASE IF NOT EXISTS hotel_booking_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE hotel_booking_db;

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- Tắt tạm thời kiểm tra ràng buộc khóa ngoại để đảm bảo quá trình khởi tạo cấu trúc và nạp dữ liệu diễn ra trơn tru
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
    CONSTRAINT `fk_bookings_customer` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_bookings_handled_by` FOREIGN KEY (`handled_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_bookings_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_bookings_trip_plan` FOREIGN KEY (`trip_plan_id`) REFERENCES `trip_plans` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `chk_bookings_dates` CHECK ((`check_out_at` > `check_in_at`)),
    CONSTRAINT `chk_bookings_estimated_total` CHECK ((`estimated_total` >= 0)),
    CONSTRAINT `chk_bookings_guests` CHECK ((`total_guests` >= 1)),
    CONSTRAINT `chk_bookings_room_count` CHECK ((`requested_room_count` >= 1)),
    CONSTRAINT `chk_bookings_status` CHECK ((`status` in (_utf8mb4'PAYMENT_PENDING',_utf8mb4'PENDING',_utf8mb4'CONFIRMED',_utf8mb4'REJECTED',_utf8mb4'CHECKED_IN',_utf8mb4'COMPLETED',_utf8mb4'CANCELLED',_utf8mb4'PAYMENT_EXPIRED',_utf8mb4'PAYMENT_REVIEW')))
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
    `changed_by` bigint unsigned NOT NULL,
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
    CONSTRAINT `chk_booking_status_logs_new_status` CHECK ((`new_status` in (_utf8mb4'PAYMENT_PENDING',_utf8mb4'PENDING',_utf8mb4'CONFIRMED',_utf8mb4'REJECTED',_utf8mb4'CHECKED_IN',_utf8mb4'COMPLETED',_utf8mb4'CANCELLED',_utf8mb4'PAYMENT_EXPIRED',_utf8mb4'PAYMENT_REVIEW'))),
    CONSTRAINT `chk_booking_status_logs_old_status` CHECK (((`old_status` is null) or (`old_status` in (_latin1'PAYMENT_PENDING',_latin1'PENDING',_latin1'CONFIRMED',_latin1'REJECTED',_latin1'CHECKED_IN',_latin1'COMPLETED',_latin1'CANCELLED',_latin1'PAYMENT_EXPIRED',_latin1'PAYMENT_REVIEW'))))
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
    CONSTRAINT `chk_payment_transactions_status` CHECK ((`status` in (_latin1'CREATED',_latin1'PENDING',_latin1'PAID',_latin1'FAILED',_latin1'EXPIRED',_latin1'PAID_REQUIRES_REVIEW',_latin1'REFUND_PENDING',_latin1'REFUNDED')))
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

-- ====================================================================================================
-- PHẦN 10: TỰ ĐỘNG ĐỒNG BỘ CỘT & RÀNG BUỘC CHO DATABASE CŨ (MIGRATION COMPATIBILITY CHECK)
-- ====================================================================================================
-- Stored Procedure này kiểm tra và tự động bổ sung mọi cột, chỉ mục, ràng buộc mới nếu tệp này được chạy
-- trên một database đã tồn tại từ trước mà không cần phải drop database cũ.
-- ====================================================================================================

DROP PROCEDURE IF EXISTS SyncExistingDatabaseColumns;
DELIMITER $$
CREATE PROCEDURE SyncExistingDatabaseColumns()
BEGIN
    DECLARE col_cnt INT DEFAULT 0;

    -- 1. Bảng bookings: kiểm tra các cột phân công nhân viên
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

    -- 2. Bảng bookings: kiểm tra các cột Idempotency khóa thanh toán
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'checkout_idempotency_key';
    IF col_cnt = 0 THEN
        ALTER TABLE bookings ADD COLUMN checkout_idempotency_key VARCHAR(100) NULL AFTER updated_at;
        ALTER TABLE bookings ADD UNIQUE KEY uq_checkout_idempotency (checkout_idempotency_key);
    END IF;

    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'checkout_request_hash';
    IF col_cnt = 0 THEN
        ALTER TABLE bookings ADD COLUMN checkout_request_hash CHAR(64) NULL AFTER checkout_idempotency_key;
    END IF;

    -- 3. Bảng users: kiểm tra cột address
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'address';
    IF col_cnt = 0 THEN
        ALTER TABLE users ADD COLUMN address VARCHAR(255) NULL AFTER phone;
    END IF;

    -- 4. Bảng room_services: kiểm tra room_type_id và max_quantity
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'room_type_id';
    IF col_cnt = 0 THEN
        ALTER TABLE room_services ADD COLUMN room_type_id BIGINT UNSIGNED NULL AFTER hotel_id;
    END IF;

    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'max_quantity';
    IF col_cnt = 0 THEN
        ALTER TABLE room_services ADD COLUMN max_quantity SMALLINT UNSIGNED NULL AFTER quota_per_night;
    END IF;

    -- 5. Bảng outbox_events: kiểm tra locked_at và locked_by
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbox_events' AND COLUMN_NAME = 'locked_at';
    IF col_cnt = 0 THEN
        ALTER TABLE outbox_events ADD COLUMN locked_at DATETIME NULL;
        ALTER TABLE outbox_events ADD COLUMN locked_by VARCHAR(100) NULL;
        ALTER TABLE outbox_events ADD INDEX idx_outbox_claim (status, available_at, locked_at);
    END IF;

    -- 6. Bảng booking_holds: đảm bảo unique key uq_booking_holds_booking
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_holds' AND CONSTRAINT_NAME = 'uq_booking_holds_booking';
    IF col_cnt = 0 THEN
        ALTER TABLE booking_holds ADD CONSTRAINT uq_booking_holds_booking UNIQUE (booking_id);
    END IF;
END$$
DELIMITER ;

CALL SyncExistingDatabaseColumns();
DROP PROCEDURE IF EXISTS SyncExistingDatabaseColumns;

-- Bật lại kiểm tra foreign key sau khi hoàn tất toàn bộ cấu trúc và dữ liệu
SET FOREIGN_KEY_CHECKS = 1;

-- ====================================================================================================
-- KIỂM TRA BÁO CÁO TỔNG QUAN TẤT CẢ CÁC BẢNG SAU KHI THỰC THI THÀNH CÔNG
-- ====================================================================================================
SHOW TABLES;
