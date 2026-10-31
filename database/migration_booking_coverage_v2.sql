-- =============================================================================
-- TRAVELEKE: MIGRATION BOOKING COVERAGE V2 (ĐỢT 3)
-- Bàn giao tạm thời (Temporary Coverage) & Chuyển giao hoàn toàn (Permanent Transfer)
-- =============================================================================

CREATE TABLE IF NOT EXISTS `booking_coverage_grants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `principal_staff_id` BIGINT UNSIGNED NOT NULL,
  `delegate_staff_id` BIGINT UNSIGNED NOT NULL,
  `mode` VARCHAR(30) NOT NULL DEFAULT 'TEMPORARY',
  `start_at` DATETIME NOT NULL,
  `end_at` DATETIME NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `allowed_task_types` TEXT NOT NULL,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `reason` VARCHAR(255) NULL,
  `command_key` VARCHAR(128) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `ix_coverage_booking_time` (`booking_id`, `start_at`, `end_at`),
  INDEX `ix_coverage_delegate_status` (`delegate_staff_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `booking_coverage_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `grant_id` BIGINT UNSIGNED NULL,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `event_type` VARCHAR(30) NOT NULL,
  `actor_id` BIGINT UNSIGNED NULL,
  `old_value` TEXT NULL,
  `new_value` TEXT NULL,
  `note` VARCHAR(255) NULL,
  `occurred_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `ix_coverage_events_booking` (`booking_id`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

