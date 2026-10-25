-- ============================================================================
-- MIGRATION: ĐỢT 2 - HOÀN THIỆN VÒNG ĐỜI BOOKING, NO-SHOW VÀ CHECK-IN MUỘN
-- Mục tiêu:
--  1. Thêm các trường lưu trữ mốc thời gian thực tế vào bảng `bookings`
--     (actual_check_in_at, actual_check_out_at, no_show_at, no_show_grace_minutes,
--      no_show_closed_at, late_check_in_recovered_at, check_in_confirmed_by,
--      check_out_confirmed_by, presence_version, late_arrival_expected_at, late_arrival_note)
--  2. Hỗ trợ giá trị enum mới trong logic: 'NO_SHOW', 'CLOSED_NO_SHOW' (cột status là VARCHAR(30))
--  3. Tạo bảng append-only `booking_presence_events` theo dõi dòng đời hiện diện của khách
-- Nguyên tắc bất biến:
--  - ADDITIVE ONLY: Không DROP bảng, không đổi kiểu dữ liệu cũ, không xóa dữ liệu
--  - Không đụng tới logic giữ chỗ phòng COMMITTED (INV-03)
-- ============================================================================

-- 1. Thêm các cột theo dõi hiện diện và mốc thời gian thực tế vào bảng `bookings`
ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `actual_check_in_at` DATETIME NULL AFTER `check_in_at`,
  ADD COLUMN IF NOT EXISTS `actual_check_out_at` DATETIME NULL AFTER `check_out_at`,
  ADD COLUMN IF NOT EXISTS `no_show_at` DATETIME NULL AFTER `actual_check_out_at`,
  ADD COLUMN IF NOT EXISTS `no_show_grace_minutes` SMALLINT UNSIGNED NOT NULL DEFAULT 360 AFTER `no_show_at`,
  ADD COLUMN IF NOT EXISTS `no_show_closed_at` DATETIME NULL AFTER `no_show_grace_minutes`,
  ADD COLUMN IF NOT EXISTS `late_check_in_recovered_at` DATETIME NULL AFTER `no_show_closed_at`,
  ADD COLUMN IF NOT EXISTS `check_in_confirmed_by` BIGINT UNSIGNED NULL AFTER `late_check_in_recovered_at`,
  ADD COLUMN IF NOT EXISTS `check_out_confirmed_by` BIGINT UNSIGNED NULL AFTER `check_in_confirmed_by`,
  ADD COLUMN IF NOT EXISTS `presence_version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `check_out_confirmed_by`,
  ADD COLUMN IF NOT EXISTS `late_arrival_expected_at` DATETIME NULL AFTER `presence_version`,
  ADD COLUMN IF NOT EXISTS `late_arrival_note` TEXT NULL AFTER `late_arrival_expected_at`;

-- Index hỗ trợ PresenceScheduler quét booking đến hạn No-Show hoặc Closed No-Show
CREATE INDEX IF NOT EXISTS `idx_bookings_presence_scheduler`
  ON `bookings` (`status`, `check_in_at`, `check_out_at`);

CREATE INDEX IF NOT EXISTS `idx_bookings_hotel_status`
  ON `bookings` (`hotel_id`, `status`);

-- 2. Tạo bảng `booking_presence_events` ghi nhận từng sự kiện hiện diện
CREATE TABLE IF NOT EXISTS `booking_presence_events` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `from_status` VARCHAR(30) NOT NULL,
  `to_status` VARCHAR(30) NOT NULL,
  `actor_type` ENUM('USER', 'SYSTEM') NOT NULL DEFAULT 'USER',
  `actor_id` BIGINT UNSIGNED NULL,
  `event_type` VARCHAR(50) NOT NULL COMMENT 'ARRIVAL_CONFIRMED | NO_SHOW_MARKED | LATE_CHECK_IN_RECOVERED | DEPARTURE_CONFIRMED | NO_SHOW_CLOSED | LATE_ARRIVAL_NOTICED',
  `late_minutes` INT NULL,
  `reason` TEXT NULL,
  `idempotency_key` VARCHAR(100) NULL,
  `occurred_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_presence_booking_occurred` (`booking_id`, `occurred_at`),
  INDEX `idx_presence_hotel_event` (`hotel_id`, `event_type`),
  INDEX `idx_presence_idempotency` (`idempotency_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
