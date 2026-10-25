-- ==============================================================================
-- TRAVELEKE - MIGRATION ĐỢT 1: CHUẨN HÓA NĂNG LỰC, ĐƠN XIN NGHỈ/ĐI MUỘN & PHÂN CÔNG
-- Version: 1.0 (Additive migration - an toàn, không xóa hay làm mất dữ liệu cũ)
-- ==============================================================================

-- 1. Chuẩn hóa service_tier cho bảng rooms (ECONOMY, STANDARD, VIP)
SET @exist_service_tier := (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'rooms' 
      AND COLUMN_NAME = 'service_tier'
);

SET @sql_add_service_tier := IF(
    @exist_service_tier = 0,
    'ALTER TABLE `rooms` ADD COLUMN `service_tier` VARCHAR(20) NOT NULL DEFAULT ''STANDARD'' AFTER `description`;',
    'SELECT "Column service_tier already exists in rooms";'
);
PREPARE stmt_service_tier FROM @sql_add_service_tier;
EXECUTE stmt_service_tier;
DEALLOCATE PREPARE stmt_service_tier;

-- 2. Bảng quản lý đơn xin nghỉ/đi muộn của nhân viên lễ tân
CREATE TABLE IF NOT EXISTS `staff_absence_requests` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `hotel_id` BIGINT UNSIGNED NOT NULL,
    `staff_user_id` BIGINT UNSIGNED NOT NULL,
    `request_type` VARCHAR(30) NOT NULL COMMENT 'LEAVE, LATE_ARRIVAL, EARLY_LEAVE, SHORT_ABSENCE',
    `start_at` DATETIME NOT NULL COMMENT 'Thời điểm bắt đầu vắng mặt',
    `end_at` DATETIME NOT NULL COMMENT 'Thời điểm kết thúc vắng mặt',
    `expected_arrival_at` DATETIME NULL COMMENT 'Dự kiến đến với đi muộn',
    `reason` TEXT NOT NULL,
    `contact_info` VARCHAR(255) NULL,
    `evidence_ref` VARCHAR(255) NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING, APPROVED, REJECTED, WITHDRAWN, REVOCATION_REQUESTED, REVOKED',
    `decided_by` BIGINT UNSIGNED NULL,
    `decided_at` DATETIME NULL,
    `decision_note` TEXT NULL,
    `version` INT UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_staff_absence_hotel_status` (`hotel_id`, `status`),
    KEY `idx_staff_absence_staff` (`staff_user_id`, `created_at`),
    KEY `idx_staff_absence_time_range` (`hotel_id`, `staff_user_id`, `start_at`, `end_at`),
    CONSTRAINT `fk_staff_absence_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_staff_absence_user` FOREIGN KEY (`staff_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Bảng nhật ký trạng thái đơn xin nghỉ/đi muộn (audit append-only)
CREATE TABLE IF NOT EXISTS `staff_absence_request_events` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `request_id` BIGINT UNSIGNED NOT NULL,
    `old_status` VARCHAR(30) NULL,
    `new_status` VARCHAR(30) NOT NULL,
    `actor_id` BIGINT UNSIGNED NOT NULL,
    `note` TEXT NULL,
    `occurred_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY `idx_absence_event_request` (`request_id`, `occurred_at`),
    CONSTRAINT `fk_absence_event_request` FOREIGN KEY (`request_id`) REFERENCES `staff_absence_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Bảng các khoảng thời gian không khả dụng (Availability Blocks)
CREATE TABLE IF NOT EXISTS `staff_availability_blocks` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `hotel_id` BIGINT UNSIGNED NOT NULL,
    `staff_user_id` BIGINT UNSIGNED NOT NULL,
    `request_id` BIGINT UNSIGNED NULL,
    `block_type` VARCHAR(30) NOT NULL COMMENT 'LEAVE, LATE_ARRIVAL, EMERGENCY_UNAVAILABLE',
    `start_at` DATETIME NOT NULL,
    `end_at` DATETIME NOT NULL,
    `reason` VARCHAR(255) NULL,
    `active` TINYINT(1) NOT NULL DEFAULT 1,
    `source` VARCHAR(30) NOT NULL DEFAULT 'APPROVED_REQUEST' COMMENT 'APPROVED_REQUEST, MANAGER_OVERRIDE',
    `created_by` BIGINT UNSIGNED NOT NULL,
    `ended_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_availability_lookup` (`hotel_id`, `staff_user_id`, `active`, `start_at`, `end_at`),
    CONSTRAINT `fk_avail_block_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_avail_block_user` FOREIGN KEY (`staff_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Bảng khóa phân công theo khách sạn (chống race condition khi 2 callback đồng thời)
CREATE TABLE IF NOT EXISTS `hotel_assignment_dispatch_locks` (
    `hotel_id` BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    `version` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_dispatch_lock_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed khóa cho các khách sạn hiện có
INSERT IGNORE INTO `hotel_assignment_dispatch_locks` (`hotel_id`, `version`, `updated_at`)
SELECT `id`, 0, NOW() FROM `hotels`;

-- 6. Bảng trạng thái phân công hiện tại của booking (Tối đa 1 phân công chính đang active)
CREATE TABLE IF NOT EXISTS `booking_assignment_state` (
    `booking_id` BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    `current_assignment_id` BIGINT UNSIGNED NULL,
    `current_staff_id` BIGINT UNSIGNED NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED' COMMENT 'ASSIGNED, UNASSIGNED_CRITICAL, REPAIR_PENDING',
    `version` INT UNSIGNED NOT NULL DEFAULT 1,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_assignment_state_staff` (`current_staff_id`),
    CONSTRAINT `fk_assignment_state_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Bảng lịch sử phân công booking (không bao giờ xóa, version tăng dần)
CREATE TABLE IF NOT EXISTS `booking_assignments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `booking_id` BIGINT UNSIGNED NOT NULL,
    `hotel_id` BIGINT UNSIGNED NOT NULL,
    `staff_user_id` BIGINT UNSIGNED NULL COMMENT 'Null khi UNASSIGNED_CRITICAL',
    `assignment_version` INT UNSIGNED NOT NULL DEFAULT 1,
    `assignment_type` VARCHAR(30) NOT NULL DEFAULT 'AUTO' COMMENT 'AUTO, MANAGER_FALLBACK, MANUAL_OVERRIDE',
    `competency_level` VARCHAR(30) NULL COMMENT 'M1, M2, M3, M4, MANAGER',
    `freshness_bucket` VARCHAR(30) NULL COMMENT 'FRESH, SOFT_RECENT, HARD_COOLDOWN, OVERRIDE',
    `reason` TEXT NULL,
    `assigned_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `ended_at` DATETIME NULL,
    `assigned_by` BIGINT UNSIGNED NULL COMMENT 'NULL nếu SYSTEM auto',
    `previous_assignment_id` BIGINT UNSIGNED NULL,
    `policy_version` VARCHAR(20) NOT NULL DEFAULT '1.0',
    `source_event_id` VARCHAR(100) NULL,
    UNIQUE KEY `ux_booking_version` (`booking_id`, `assignment_version`),
    KEY `idx_hotel_staff_assigned_time` (`hotel_id`, `staff_user_id`, `assigned_at`),
    CONSTRAINT `fk_booking_assignments_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_booking_assignments_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Bảng command receipt chống xử lý phân công lặp (Idempotency)
CREATE TABLE IF NOT EXISTS `booking_assignment_command_receipts` (
    `booking_id` BIGINT UNSIGNED NOT NULL,
    `command_key` VARCHAR(120) NOT NULL,
    `status` VARCHAR(20) NOT NULL COMMENT 'SUCCESS, FAILED, SKIPPED',
    `attempts` INT UNSIGNED NOT NULL DEFAULT 1,
    `last_error` TEXT NULL,
    `processed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`booking_id`, `command_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Tương thích booking_status_logs: cho phép changed_by NULL cho hành động tự động hệ thống
SET @exist_actor_type := (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'booking_status_logs' 
      AND COLUMN_NAME = 'actor_type'
);

SET @sql_add_actor_type := IF(
    @exist_actor_type = 0,
    'ALTER TABLE `booking_status_logs` ADD COLUMN `actor_type` VARCHAR(20) NOT NULL DEFAULT ''USER'' AFTER `changed_by`;',
    'SELECT "Column actor_type already exists in booking_status_logs";'
);
PREPARE stmt_actor_type FROM @sql_add_actor_type;
EXECUTE stmt_actor_type;
DEALLOCATE PREPARE stmt_actor_type;

-- Bỏ NOT NULL trên changed_by để hệ thống ghi log SYSTEM không bị chặn
ALTER TABLE `booking_status_logs` MODIFY COLUMN `changed_by` BIGINT UNSIGNED NULL;
