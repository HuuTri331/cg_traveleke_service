-- ====================================================================================================
-- TRAVELEKE SYSTEM - TỆP MIGRATION HỢP NHẤT TOÀN DIỆN VÀ DUY NHẤT (UNIFIED MASTER MIGRATION)
-- ====================================================================================================
-- Hợp nhất 100% tất cả các bảng, cột additive, ràng buộc và chỉ mục từ:
--   1. migration_vnpay_inventory_outbox.sql (VNPAY, booking_holds, payment_transactions, outbox_events)
--   2. migration_vnpay_inventory_cancellation_fix.sql (checkout_idempotency, outbox_claim, booking_cancellation_requests)
--   3. migration_staff_availability_assignment_v2.sql (ĐỢT 1: rooms.service_tier, staff_absence_requests,
--      staff_absence_request_events, staff_availability_blocks, hotel_assignment_dispatch_locks,
--      booking_assignment_state, booking_assignments, booking_assignment_command_receipts, booking_status_logs.actor_type)
--   4. migration_booking_presence_v2.sql (ĐỢT 2: actual_check_in_at, actual_check_out_at, no_show_at,
--      no_show_grace_minutes, no_show_closed_at, late_check_in_recovered_at, check_in_confirmed_by,
--      check_out_confirmed_by, presence_version, late_arrival_expected_at, late_arrival_note,
--      booking_presence_events, trạng thái NO_SHOW & CLOSED_NO_SHOW)
--
-- NGUYÊN TẮC AN TOÀN TUYỆT ĐỐI:
--   - Additive Only: Không DROP bảng, không DROP dữ liệu cũ, không làm sai lệch luồng thanh toán hoặc tồn phòng đã ổn định.
--   - Idempotent: Chạy được nhiều lần an toàn nhờ IF NOT EXISTS và kiểm tra INFORMATION_SCHEMA trước khi thêm cột/ràng buộc.
-- ====================================================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------------------------------------------------------------------------------
-- PHẦN 1: TẠO CÁC BẢNG NỀN TẢNG NẾU CHƯA CÓ (TABLES CREATION IF NOT EXISTS)
-- ----------------------------------------------------------------------------------------------------

-- 1. Bảng giữ chỗ tạm thời (Booking Holds)
CREATE TABLE IF NOT EXISTS `booking_holds` (
    `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `booking_id`          BIGINT UNSIGNED NOT NULL,
    `room_id`             BIGINT UNSIGNED NOT NULL,
    `quantity`            SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    `check_in_at`         DATETIME NOT NULL,
    `check_out_at`        DATETIME NOT NULL,
    `status`              VARCHAR(30) NOT NULL DEFAULT 'HELD' COMMENT 'HELD, COMMITTED, RELEASED, EXPIRED',
    `hold_expires_at`     DATETIME NOT NULL,
    `released_at`         DATETIME NULL,
    `committed_at`        DATETIME NULL,
    `release_reason`      VARCHAR(255) NULL,
    `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uq_booking_holds_booking` (`booking_id`),
    INDEX `idx_booking_holds_overlap` (`room_id`, `status`, `check_in_at`, `check_out_at`),
    INDEX `idx_booking_holds_booking_id` (`booking_id`),
    INDEX `idx_booking_holds_expiry` (`status`, `hold_expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Bảng giao dịch thanh toán VNPay (Payment Transactions)
CREATE TABLE IF NOT EXISTS `payment_transactions` (
    `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `booking_id`          BIGINT UNSIGNED NOT NULL,
    `provider`            VARCHAR(30) NOT NULL DEFAULT 'VNPAY',
    `attempt_no`          INT UNSIGNED NOT NULL DEFAULT 1,
    `txn_ref`             VARCHAR(100) NOT NULL,
    `amount`              DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `currency`            VARCHAR(10) NOT NULL DEFAULT 'VND',
    `status`              VARCHAR(30) NOT NULL DEFAULT 'CREATED' COMMENT 'CREATED, PENDING, PAID, FAILED, EXPIRED, PAID_REQUIRES_REVIEW, REFUND_PENDING, REFUNDED',
    `response_code`       VARCHAR(20) NULL,
    `transaction_status`  VARCHAR(20) NULL,
    `vnp_transaction_no`  VARCHAR(50) NULL,
    `bank_code`           VARCHAR(30) NULL,
    `card_type`           VARCHAR(30) NULL,
    `pay_date`            DATETIME NULL,
    `gateway_expire_at`   DATETIME NULL,
    `paid_at`             DATETIME NULL,
    `failed_at`           DATETIME NULL,
    `expired_at`          DATETIME NULL,
    `refund_amount`       DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `refunded_at`         DATETIME NULL,
    `refund_note`         TEXT NULL,
    `raw_ipn_response`    JSON NULL,
    `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uq_payment_transactions_txn_ref` (`txn_ref`),
    UNIQUE KEY `uq_payment_transactions_attempt` (`booking_id`, `attempt_no`),
    INDEX `idx_payment_transactions_booking_id` (`booking_id`),
    INDEX `idx_payment_transactions_status` (`status`),
    INDEX `idx_payment_transactions_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Bảng Transactional Outbox (Outbox Events)
CREATE TABLE IF NOT EXISTS `outbox_events` (
    `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `event_type`          VARCHAR(100) NOT NULL,
    `aggregate_type`      VARCHAR(50) NOT NULL,
    `aggregate_id`        VARCHAR(50) NOT NULL,
    `payload`             JSON NOT NULL,
    `status`              VARCHAR(30) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING, PROCESSING, COMPLETED, FAILED',
    `retry_count`         INT UNSIGNED NOT NULL DEFAULT 0,
    `max_retries`         INT UNSIGNED NOT NULL DEFAULT 5,
    `error_message`       TEXT NULL,
    `available_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `processed_at`        DATETIME NULL,
    `locked_at`           DATETIME NULL,
    `locked_by`           VARCHAR(100) NULL,
    `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_outbox_events_poll` (`status`, `available_at`),
    INDEX `idx_outbox_events_aggregate` (`aggregate_type`, `aggregate_id`),
    INDEX `idx_outbox_claim` (`status`, `available_at`, `locked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Bảng yêu cầu hủy phòng & hoàn tiền (Booking Cancellation Requests)
CREATE TABLE IF NOT EXISTS `booking_cancellation_requests` (
    `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `booking_id`          BIGINT UNSIGNED NOT NULL,
    `requested_by`        BIGINT UNSIGNED NOT NULL,
    `requester_type`      VARCHAR(30) NOT NULL DEFAULT 'CUSTOMER',
    `reason`              TEXT NOT NULL,
    `status`              VARCHAR(30) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING, APPROVED, REJECTED, REFUNDED',
    `reviewed_by`         BIGINT UNSIGNED NULL,
    `reviewed_at`         DATETIME NULL,
    `review_note`         TEXT NULL,
    `refund_amount`       DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_bcr_booking_id` (`booking_id`),
    INDEX `idx_bcr_status` (`status`),
    INDEX `idx_bcr_requested_by` (`requested_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Bảng đơn xin nghỉ/đi muộn của nhân viên lễ tân (Staff Absence Requests - Đợt 1)
CREATE TABLE IF NOT EXISTS `staff_absence_requests` (
    `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `hotel_id`            BIGINT UNSIGNED NOT NULL,
    `staff_user_id`       BIGINT UNSIGNED NOT NULL,
    `request_type`        VARCHAR(30) NOT NULL COMMENT 'LEAVE, LATE_ARRIVAL, EARLY_LEAVE, SHORT_ABSENCE',
    `start_at`            DATETIME NOT NULL COMMENT 'Thời điểm bắt đầu vắng mặt',
    `end_at`              DATETIME NOT NULL COMMENT 'Thời điểm kết thúc vắng mặt',
    `expected_arrival_at` DATETIME NULL COMMENT 'Dự kiến đến với đi muộn',
    `reason`              TEXT NOT NULL,
    `contact_info`        VARCHAR(255) NULL,
    `evidence_ref`        VARCHAR(255) NULL,
    `status`              VARCHAR(30) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING, APPROVED, REJECTED, WITHDRAWN, REVOCATION_REQUESTED, REVOKED',
    `decided_by`          BIGINT UNSIGNED NULL,
    `decided_at`          DATETIME NULL,
    `decision_note`       TEXT NULL,
    `version`             INT UNSIGNED NOT NULL DEFAULT 1,
    `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_staff_absence_hotel_status` (`hotel_id`, `status`),
    INDEX `idx_staff_absence_staff` (`staff_user_id`, `created_at`),
    INDEX `idx_staff_absence_time_range` (`hotel_id`, `staff_user_id`, `start_at`, `end_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Bảng nhật ký trạng thái đơn xin nghỉ/đi muộn (Staff Absence Request Events - Đợt 1)
CREATE TABLE IF NOT EXISTS `staff_absence_request_events` (
    `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `request_id`          BIGINT UNSIGNED NOT NULL,
    `old_status`          VARCHAR(30) NULL,
    `new_status`          VARCHAR(30) NOT NULL,
    `actor_id`            BIGINT UNSIGNED NOT NULL,
    `note`                TEXT NULL,
    `occurred_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_absence_event_request` (`request_id`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Bảng các khoảng thời gian không khả dụng (Staff Availability Blocks - Đợt 1)
CREATE TABLE IF NOT EXISTS `staff_availability_blocks` (
    `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `hotel_id`            BIGINT UNSIGNED NOT NULL,
    `staff_user_id`       BIGINT UNSIGNED NOT NULL,
    `request_id`          BIGINT UNSIGNED NULL,
    `block_type`          VARCHAR(30) NOT NULL COMMENT 'LEAVE, LATE_ARRIVAL, EMERGENCY_UNAVAILABLE',
    `start_at`            DATETIME NOT NULL,
    `end_at`              DATETIME NOT NULL,
    `reason`              VARCHAR(255) NULL,
    `active`              TINYINT(1) NOT NULL DEFAULT 1,
    `source`              VARCHAR(30) NOT NULL DEFAULT 'APPROVED_REQUEST' COMMENT 'APPROVED_REQUEST, MANAGER_OVERRIDE',
    `created_by`          BIGINT UNSIGNED NOT NULL,
    `ended_by`            BIGINT UNSIGNED NULL,
    `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_availability_lookup` (`hotel_id`, `staff_user_id`, `active`, `start_at`, `end_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Bảng khóa điều phối phân công theo khách sạn (Dispatch Locks - Đợt 1)
CREATE TABLE IF NOT EXISTS `hotel_assignment_dispatch_locks` (
    `hotel_id`            BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    `version`             BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed khóa dispatch cho tất cả khách sạn hiện có
INSERT IGNORE INTO `hotel_assignment_dispatch_locks` (`hotel_id`, `version`, `updated_at`)
SELECT `id`, 0, NOW() FROM `hotels`;

-- 9. Bảng trạng thái phân công chính hiện tại của booking (Assignment State - Đợt 1)
CREATE TABLE IF NOT EXISTS `booking_assignment_state` (
    `booking_id`          BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    `current_assignment_id` BIGINT UNSIGNED NULL,
    `current_staff_id`    BIGINT UNSIGNED NULL,
    `status`              VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED' COMMENT 'ASSIGNED, UNASSIGNED_CRITICAL, REPAIR_PENDING',
    `version`             INT UNSIGNED NOT NULL DEFAULT 1,
    `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_assignment_state_staff` (`current_staff_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Bảng lịch sử phân công booking (Booking Assignments - Đợt 1)
CREATE TABLE IF NOT EXISTS `booking_assignments` (
    `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `booking_id`          BIGINT UNSIGNED NOT NULL,
    `hotel_id`            BIGINT UNSIGNED NOT NULL,
    `staff_user_id`       BIGINT UNSIGNED NULL COMMENT 'Null khi UNASSIGNED_CRITICAL',
    `assignment_version`  INT UNSIGNED NOT NULL DEFAULT 1,
    `assignment_type`     VARCHAR(30) NOT NULL DEFAULT 'AUTO' COMMENT 'AUTO, MANAGER_FALLBACK, MANUAL_OVERRIDE',
    `competency_level`    VARCHAR(30) NULL COMMENT 'M1, M2, M3, M4, MANAGER',
    `freshness_bucket`    VARCHAR(30) NULL COMMENT 'FRESH, SOFT_RECENT, HARD_COOLDOWN, OVERRIDE',
    `reason`              TEXT NULL,
    `assigned_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `ended_at`            DATETIME NULL,
    `assigned_by`         BIGINT UNSIGNED NULL COMMENT 'NULL nếu SYSTEM auto',
    `previous_assignment_id` BIGINT UNSIGNED NULL,
    `policy_version`      VARCHAR(20) NOT NULL DEFAULT '1.0',
    `source_event_id`     VARCHAR(100) NULL,
    UNIQUE KEY `ux_booking_version` (`booking_id`, `assignment_version`),
    INDEX `idx_hotel_staff_assigned_time` (`hotel_id`, `staff_user_id`, `assigned_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Bảng lưu vết chống thực thi phân công trùng lặp (Idempotency Command Receipts - Đợt 1)
CREATE TABLE IF NOT EXISTS `booking_assignment_command_receipts` (
    `booking_id`          BIGINT UNSIGNED NOT NULL,
    `command_key`         VARCHAR(120) NOT NULL,
    `status`              VARCHAR(20) NOT NULL COMMENT 'SUCCESS, FAILED, SKIPPED',
    `attempts`            INT UNSIGNED NOT NULL DEFAULT 1,
    `last_error`          TEXT NULL,
    `processed_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`booking_id`, `command_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Bảng theo dõi dòng đời hiện diện của khách (Booking Presence Events - Đợt 2)
CREATE TABLE IF NOT EXISTS `booking_presence_events` (
    `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `booking_id`          BIGINT UNSIGNED NOT NULL,
    `hotel_id`            BIGINT UNSIGNED NOT NULL,
    `from_status`         VARCHAR(30) NOT NULL,
    `to_status`           VARCHAR(30) NOT NULL,
    `actor_type`          ENUM('USER', 'SYSTEM') NOT NULL DEFAULT 'USER',
    `actor_id`            BIGINT UNSIGNED NULL,
    `event_type`          VARCHAR(50) NOT NULL COMMENT 'ARRIVAL_CONFIRMED, NO_SHOW_MARKED, LATE_CHECK_IN_RECOVERED, DEPARTURE_CONFIRMED, NO_SHOW_CLOSED, LATE_ARRIVAL_NOTICED',
    `late_minutes`        INT NULL,
    `reason`              TEXT NULL,
    `idempotency_key`     VARCHAR(100) NULL,
    `occurred_at`         DATETIME NOT NULL,
    `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_presence_booking_occurred` (`booking_id`, `occurred_at`),
    INDEX `idx_presence_hotel_event` (`hotel_id`, `event_type`),
    INDEX `idx_presence_idempotency` (`idempotency_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------------------------------
-- PHẦN 2: THỦ TỤC ĐỒNG BỘ CỘT, RÀNG BUỘC VÀ CHỈ MỤC ADDITIVE CHO CÁC BẢNG ĐÃ CÓ
-- ----------------------------------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS SyncUnifiedAllPhases;
DELIMITER $$
CREATE PROCEDURE SyncUnifiedAllPhases()
BEGIN
    DECLARE col_cnt INT DEFAULT 0;

    -- 1. BẢNG ROOMS: Cột service_tier (Đợt 1)
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rooms' AND COLUMN_NAME = 'service_tier';
    IF col_cnt = 0 THEN
        ALTER TABLE `rooms` ADD COLUMN `service_tier` VARCHAR(20) NOT NULL DEFAULT 'STANDARD' AFTER `description`;
    END IF;

    -- 2. BẢNG USERS: Cột address
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'address';
    IF col_cnt = 0 THEN
        ALTER TABLE `users` ADD COLUMN `address` VARCHAR(255) NULL AFTER `phone`;
    END IF;

    -- 3. BẢNG OUTBOX_EVENTS: Cột locked_at & locked_by
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbox_events' AND COLUMN_NAME = 'locked_at';
    IF col_cnt = 0 THEN
        ALTER TABLE `outbox_events` ADD COLUMN `locked_at` DATETIME NULL, ADD COLUMN `locked_by` VARCHAR(100) NULL;
    END IF;

    -- 4. BẢNG BOOKING_STATUS_LOGS: Cột actor_type và nới lỏng changed_by nullable
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_status_logs' AND COLUMN_NAME = 'actor_type';
    IF col_cnt = 0 THEN
        ALTER TABLE `booking_status_logs` ADD COLUMN `actor_type` VARCHAR(20) NOT NULL DEFAULT 'USER' AFTER `changed_by`;
    END IF;

    ALTER TABLE `booking_status_logs` MODIFY COLUMN `changed_by` BIGINT UNSIGNED NULL;

    -- 5. BẢNG BOOKINGS: Cột Idempotency & Phân công
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'checkout_idempotency_key';
    IF col_cnt = 0 THEN
        ALTER TABLE `bookings` ADD COLUMN `checkout_idempotency_key` VARCHAR(100) NULL AFTER `updated_at`;
        ALTER TABLE `bookings` ADD UNIQUE KEY `uq_checkout_idempotency` (`checkout_idempotency_key`);
    END IF;

    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'checkout_request_hash';
    IF col_cnt = 0 THEN
        ALTER TABLE `bookings` ADD COLUMN `checkout_request_hash` CHAR(64) NULL AFTER `checkout_idempotency_key`;
    END IF;

    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'assignment_type';
    IF col_cnt = 0 THEN
        ALTER TABLE `bookings` ADD COLUMN `assignment_type` VARCHAR(20) NOT NULL DEFAULT 'AUTO' AFTER `handled_by`;
        ALTER TABLE `bookings` ADD COLUMN `assignment_note` TEXT NULL AFTER `assignment_type`;
        ALTER TABLE `bookings` ADD COLUMN `reassigned_at` DATETIME NULL AFTER `assignment_note`;
        ALTER TABLE `bookings` ADD COLUMN `reassigned_by` BIGINT UNSIGNED NULL AFTER `reassigned_at`;
    END IF;

    -- 6. BẢNG BOOKINGS: Các cột Hiện diện & No-Show (Đợt 2)
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'actual_check_in_at';
    IF col_cnt = 0 THEN
        ALTER TABLE `bookings`
            ADD COLUMN `actual_check_in_at` DATETIME NULL AFTER `check_in_at`,
            ADD COLUMN `actual_check_out_at` DATETIME NULL AFTER `check_out_at`,
            ADD COLUMN `no_show_at` DATETIME NULL AFTER `actual_check_out_at`,
            ADD COLUMN `no_show_grace_minutes` SMALLINT UNSIGNED NOT NULL DEFAULT 360 AFTER `no_show_at`,
            ADD COLUMN `no_show_closed_at` DATETIME NULL AFTER `no_show_grace_minutes`,
            ADD COLUMN `late_check_in_recovered_at` DATETIME NULL AFTER `no_show_closed_at`,
            ADD COLUMN `check_in_confirmed_by` BIGINT UNSIGNED NULL AFTER `late_check_in_recovered_at`,
            ADD COLUMN `check_out_confirmed_by` BIGINT UNSIGNED NULL AFTER `check_in_confirmed_by`,
            ADD COLUMN `presence_version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `check_out_confirmed_by`,
            ADD COLUMN `late_arrival_expected_at` DATETIME NULL AFTER `presence_version`,
            ADD COLUMN `late_arrival_note` TEXT NULL AFTER `late_arrival_expected_at`;
    END IF;

    -- 7. BẢNG ROOM_SERVICES: room_type_id & max_quantity
    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'room_type_id';
    IF col_cnt = 0 THEN
        ALTER TABLE `room_services` ADD COLUMN `room_type_id` BIGINT UNSIGNED NULL AFTER `hotel_id`;
    END IF;

    SELECT COUNT(*) INTO col_cnt FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_services' AND COLUMN_NAME = 'max_quantity';
    IF col_cnt = 0 THEN
        ALTER TABLE `room_services` ADD COLUMN `max_quantity` SMALLINT UNSIGNED NULL AFTER `quota_per_night`;
    END IF;

    -- 8. BẢO ĐẢM RÀNG BUỘC STATUS CHO BOOKINGS & BOOKING_STATUS_LOGS
    -- Cập nhật check constraint để nhận đầy đủ 11 trạng thái hợp lệ
    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND CONSTRAINT_NAME = 'chk_bookings_status'
    ) THEN
        ALTER TABLE `bookings` DROP CHECK `chk_bookings_status`;
    END IF;
    ALTER TABLE `bookings` ADD CONSTRAINT `chk_bookings_status`
        CHECK (`status` IN ('PAYMENT_PENDING','PENDING','CONFIRMED','REJECTED','CHECKED_IN','COMPLETED','CANCELLED','PAYMENT_EXPIRED','PAYMENT_REVIEW','NO_SHOW','CLOSED_NO_SHOW'));

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_status_logs' AND CONSTRAINT_NAME = 'chk_booking_status_logs_new_status'
    ) THEN
        ALTER TABLE `booking_status_logs` DROP CHECK `chk_booking_status_logs_new_status`;
    END IF;
    ALTER TABLE `booking_status_logs` ADD CONSTRAINT `chk_booking_status_logs_new_status`
        CHECK (`new_status` IN ('PAYMENT_PENDING','PENDING','CONFIRMED','REJECTED','CHECKED_IN','COMPLETED','CANCELLED','PAYMENT_EXPIRED','PAYMENT_REVIEW','NO_SHOW','CLOSED_NO_SHOW'));

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking_status_logs' AND CONSTRAINT_NAME = 'chk_booking_status_logs_old_status'
    ) THEN
        ALTER TABLE `booking_status_logs` DROP CHECK `chk_booking_status_logs_old_status`;
    END IF;
    ALTER TABLE `booking_status_logs` ADD CONSTRAINT `chk_booking_status_logs_old_status`
        CHECK (`old_status` IS NULL OR `old_status` IN ('PAYMENT_PENDING','PENDING','CONFIRMED','REJECTED','CHECKED_IN','COMPLETED','CANCELLED','PAYMENT_EXPIRED','PAYMENT_REVIEW','NO_SHOW','CLOSED_NO_SHOW'));

    -- 9. ĐẢM BẢO CHỈ MỤC TỐI ƯU PRESENCE SCHEDULER & DISPATCH
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND INDEX_NAME = 'idx_bookings_presence_scheduler'
    ) THEN
        ALTER TABLE `bookings` ADD INDEX `idx_bookings_presence_scheduler` (`status`, `check_in_at`, `check_out_at`);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND INDEX_NAME = 'idx_bookings_hotel_status'
    ) THEN
        ALTER TABLE `bookings` ADD INDEX `idx_bookings_hotel_status` (`hotel_id`, `status`);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbox_events' AND INDEX_NAME = 'idx_outbox_claim'
    ) THEN
        ALTER TABLE `outbox_events` ADD INDEX `idx_outbox_claim` (`status`, `available_at`, `locked_at`);
    END IF;
END$$
DELIMITER ;

CALL SyncUnifiedAllPhases();
DROP PROCEDURE IF EXISTS SyncUnifiedAllPhases;

SET FOREIGN_KEY_CHECKS = 1;

-- ====================================================================================================
-- HOÀN TẤT: TOÀN BỘ 100% CẤU TRÚC DATABASE ĐÃ ĐƯỢC ĐỒNG BỘ HỢP NHẤT AN TOÀN
-- ====================================================================================================
