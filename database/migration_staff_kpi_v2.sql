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
  INDEX `ix_kpi_hotel_period` (`hotel_id`, `periodKey`)
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

