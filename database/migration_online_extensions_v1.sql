-- =============================================================================
-- TRAVELEKE: ONLINE EXTENSIONS MIGRATION V1 (NP-01/02/04/05/07/10/13)
-- Expand-only DDL for MySQL 8+. Execute via migration runner, never raw paste.
-- =============================================================================
SET NAMES utf8mb4;

-- 1.1. Room units + exclusive stay slots + allocation commands (IMP-01)
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
  `housekeeping_state` VARCHAR(30) NOT NULL DEFAULT 'DIRTY',
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
  CONSTRAINT `fk_unit_hotel` FOREIGN KEY (`hotel_id`) REFERENCES `hotels`(`id`),
  CONSTRAINT `fk_unit_type` FOREIGN KEY (`room_type_id`) REFERENCES `rooms`(`id`)
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


-- 1.2. Housekeeping + unit stop sell / blocks (IMP-02/03)
CREATE TABLE IF NOT EXISTS `housekeeping_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_unit_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NULL,
  `task_type` VARCHAR(30) NOT NULL,
  `priority` VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  `status` VARCHAR(25) NOT NULL DEFAULT 'CREATED',
  `assignee_user_id` BIGINT UNSIGNED NULL,
  `assigned_to` BIGINT UNSIGNED NULL,
  `cleaned_by` BIGINT UNSIGNED NULL,
  `inspector_user_id` BIGINT UNSIGNED NULL,
  `inspected_by` BIGINT UNSIGNED NULL,
  `due_at` DATETIME(3) NULL,
  `sla_due_at` DATETIME NULL,
  `started_at` DATETIME NULL,
  `cleaned_at` DATETIME NULL,
  `inspected_at` DATETIME NULL,
  `rejection_reason` TEXT NULL,
  `notes` TEXT NULL,
  `source_event_key` VARCHAR(128) NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_housekeeping_source_event` (`source_event_key`),
  KEY `ix_housekeeping_hotel_work` (`hotel_id`, `status`, `due_at`),
  CONSTRAINT `fk_housekeeping_unit` FOREIGN KEY (`room_unit_id`) REFERENCES `room_units`(`id`)
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

-- 1.3. Amendments & Active Amendment Lock + Folio Ledger (IMP-05/12)
CREATE TABLE IF NOT EXISTS `booking_amendments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `amendment_type` VARCHAR(40) NOT NULL DEFAULT 'DATE_OR_ROOM_CHANGE',
  `status` VARCHAR(40) NOT NULL DEFAULT 'QUOTED',
  `command_key` VARCHAR(128) NOT NULL,
  `expected_booking_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `previous_snapshot_json` JSON NULL,
  `before_snapshot_json` JSON NULL,
  `proposed_json` JSON NULL,
  `requested_change_json` JSON NULL,
  `old_total_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `new_total_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `delta_vnd` BIGINT NOT NULL DEFAULT 0,
  `penalty_fee_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `quote_hash` CHAR(64) NOT NULL,
  `quote_expires_at` DATETIME(3) NOT NULL,
  `consented_at` DATETIME(3) NULL,
  `customer_consent_at` DATETIME NULL,
  `surcharge_payment_id` BIGINT UNSIGNED NULL,
  `payment_txn_id` BIGINT UNSIGNED NULL,
  `requested_by` BIGINT UNSIGNED NULL,
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

CREATE TABLE IF NOT EXISTS `booking_active_amendments` (
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `amendment_id` BIGINT UNSIGNED NOT NULL,
  `lease_until` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`booking_id`),
  UNIQUE KEY `uq_active_amendment_id` (`amendment_id`),
  CONSTRAINT `fk_active_amendment_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`)
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

-- 1.4. Notification intents, Rate Plans, Precheckin, Vouchers (IMP-08/18/20/25)
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

CREATE TABLE IF NOT EXISTS `voucher_codes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hotel_id` BIGINT UNSIGNED NULL,
  `campaign_id` BIGINT UNSIGNED NULL,
  `code` VARCHAR(50) NOT NULL,
  `discount_type` VARCHAR(20) NOT NULL DEFAULT 'FIXED_VND',
  `discount_value` DECIMAL(15,2) NOT NULL,
  `max_discount_vnd` DECIMAL(15,2) NULL,
  `min_spend_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `min_nights` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `total_quota` INT UNSIGNED NOT NULL DEFAULT 100,
  `redeemed_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `per_customer_limit` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `allow_stack_with_campaign` TINYINT(1) NOT NULL DEFAULT 0,
  `valid_from` DATETIME NOT NULL,
  `valid_to` DATETIME NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_voucher_codes_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `voucher_reservations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `voucher_code_id` BIGINT UNSIGNED NOT NULL,
  `voucher_id` BIGINT UNSIGNED NULL,
  `quote_id` BIGINT UNSIGNED NULL,
  `booking_id` BIGINT UNSIGNED NULL,
  `customer_id` BIGINT UNSIGNED NULL,
  `discount_amount_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME NULL,
  `released_at` DATETIME NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'HELD',
  `command_key` VARCHAR(128) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_voucher_quote` (`voucher_code_id`, `quote_id`),
  UNIQUE KEY `uq_voucher_command` (`voucher_code_id`, `command_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

