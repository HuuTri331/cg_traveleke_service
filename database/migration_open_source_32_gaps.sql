-- =============================================================================
-- TRAVELEKE: EXPAND-ONLY MIGRATION FOR 32 HOSPITALITY GAPS (IMP-01 .. IMP-32)
-- Part 1: Property Settings, Room Units, Housekeeping, Blocks, Incidents, Holds
-- =============================================================================
SET NAMES utf8mb4;

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
  `room_number` VARCHAR(30) NOT NULL,
  `floor` VARCHAR(20) NULL,
  `building` VARCHAR(50) NULL,
  `bed_config` VARCHAR(80) NULL,
  `is_accessible` TINYINT(1) NOT NULL DEFAULT 0,
  `is_smoking` TINYINT(1) NOT NULL DEFAULT 0,
  `operational_status` VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  `housekeeping_state` VARCHAR(30) NOT NULL DEFAULT 'READY',
  `last_cleaned_at` DATETIME NULL,
  `last_inspected_at` DATETIME NULL,
  `last_inspected_by` BIGINT UNSIGNED NULL,
  `notes` TEXT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_room_units_hotel_number` (`hotel_id`, `room_number`),
  KEY `IDX_room_units_hotel_type_state` (`hotel_id`, `room_type_id`, `operational_status`, `housekeeping_state`)
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
  `allocation_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NOT NULL,
  `unit_id` BIGINT UNSIGNED NOT NULL,
  `stay_date` DATE NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `active_unit_key` BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN `status` = 'ACTIVE' THEN `unit_id` ELSE NULL END) STORED,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_room_unit_active_stay_date` (`active_unit_key`, `stay_date`),
  KEY `IDX_room_unit_slots_booking` (`booking_id`, `status`)
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
  `unit_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NULL,
  `next_arrival_booking_id` BIGINT UNSIGNED NULL,
  `kind` VARCHAR(30) NOT NULL DEFAULT 'CHECKOUT_CLEAN',
  `priority` VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  `status` VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  `assigned_to` BIGINT UNSIGNED NULL,
  `cleaned_by` BIGINT UNSIGNED NULL,
  `inspector_id` BIGINT UNSIGNED NULL,
  `due_at` DATETIME NOT NULL,
  `started_at` DATETIME NULL,
  `cleaned_at` DATETIME NULL,
  `inspected_at` DATETIME NULL,
  `checklist_json` JSON NULL,
  `issue_note` TEXT NULL,
  `source_event_key` VARCHAR(120) NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_housekeeping_source_key` (`source_event_key`),
  KEY `IDX_housekeeping_hotel_status_due` (`hotel_id`, `status`, `due_at`)
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
  `room_type_id` BIGINT UNSIGNED NOT NULL,
  `room_unit_id` BIGINT UNSIGNED NOT NULL,
  `block_type` VARCHAR(30) NOT NULL DEFAULT 'OUT_OF_ORDER',
  `status` VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  `start_date` DATE NOT NULL,
  `end_exclusive_date` DATE NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `requested_by` BIGINT UNSIGNED NOT NULL,
  `approved_by` BIGINT UNSIGNED NULL,
  `released_by` BIGINT UNSIGNED NULL,
  `released_at` DATETIME NULL,
  `impacted_booking_ids_json` JSON NULL,
  `command_id` VARCHAR(100) NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_room_unit_block_cmd` (`command_id`)
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
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `meal_plan` VARCHAR(30) NOT NULL DEFAULT 'ROOM_ONLY',
  `is_refundable` TINYINT(1) NOT NULL DEFAULT 1,
  `cancellation_policy_id` BIGINT UNSIGNED NULL,
  `base_occupancy` SMALLINT UNSIGNED NOT NULL DEFAULT 2,
  `extra_adult_fee_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `extra_child_fee_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `floor_price_vnd` DECIMAL(15,2) NOT NULL DEFAULT 100000.00,
  `ceiling_price_vnd` DECIMAL(15,2) NULL,
  `priority` INT NOT NULL DEFAULT 100,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_rate_plans_hotel_room_code` (`hotel_id`, `room_type_id`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rate_calendar` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rate_plan_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `room_type_id` BIGINT UNSIGNED NOT NULL,
  `stay_date` DATE NOT NULL,
  `base_vnd` DECIMAL(15,2) NOT NULL,
  `adjustment_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `minimum_nights` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `closed` TINYINT(1) NOT NULL DEFAULT 0,
  `season_label` VARCHAR(60) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_rate_calendar_plan_date` (`rate_plan_id`, `stay_date`)
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
  `previous_snapshot_json` JSON NOT NULL,
  `requested_change_json` JSON NOT NULL,
  `quote_hash` CHAR(64) NOT NULL,
  `quote_expires_at` DATETIME NOT NULL,
  `old_total_vnd` DECIMAL(15,2) NOT NULL,
  `new_total_vnd` DECIMAL(15,2) NOT NULL,
  `delta_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `penalty_fee_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `requested_by` BIGINT UNSIGNED NOT NULL,
  `reviewed_by` BIGINT UNSIGNED NULL,
  `customer_consent_at` DATETIME NULL,
  `payment_txn_id` BIGINT UNSIGNED NULL,
  `committed_at` DATETIME NULL,
  `command_key` VARCHAR(100) NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_booking_amendments_cmd` (`booking_id`, `command_key`)
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
  `folio_number` VARCHAR(40) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'VND',
  `status` VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  `total_debit_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `total_payment_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `total_credit_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `total_refund_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `outstanding_balance_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `closed_at` DATETIME NULL,
  `closed_by` BIGINT UNSIGNED NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_folios_booking_id` (`booking_id`),
  UNIQUE KEY `UQ_folios_number` (`folio_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `folio_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `folio_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `entry_kind` VARCHAR(40) NOT NULL,
  `direction` VARCHAR(10) NOT NULL,
  `amount_vnd` DECIMAL(15,2) NOT NULL,
  `tax_amount_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `business_date` DATE NOT NULL,
  `source_type` VARCHAR(40) NOT NULL,
  `source_id` VARCHAR(80) NOT NULL,
  `reverses_entry_id` BIGINT UNSIGNED NULL,
  `description` VARCHAR(255) NOT NULL,
  `actor_id` BIGINT UNSIGNED NULL,
  `approved_by` BIGINT UNSIGNED NULL,
  `idempotency_key` VARCHAR(120) NOT NULL,
  `posted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_folio_entries_idempotency` (`idempotency_key`),
  UNIQUE KEY `UQ_folio_entries_source` (`source_type`, `source_id`, `entry_kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `folio_settlements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `folio_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `method` VARCHAR(30) NOT NULL,
  `amount_vnd` DECIMAL(15,2) NOT NULL,
  `provider_ref` VARCHAR(100) NOT NULL,
  `evidence_url` VARCHAR(500) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'VERIFIED',
  `paid_at` DATETIME NOT NULL,
  `verified_at` DATETIME NOT NULL,
  `recorded_by` BIGINT UNSIGNED NOT NULL,
  `approved_by` BIGINT UNSIGNED NULL,
  `command_id` VARCHAR(100) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_folio_settlements_cmd` (`command_id`)
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
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  `eta` DATETIME NULL,
  `arrival_transport` VARCHAR(50) NULL,
  `bed_preference` VARCHAR(80) NULL,
  `special_requests` TEXT NULL,
  `guest_data_minimal_json` JSON NULL,
  `submitted_at` DATETIME NULL,
  `reviewed_by` BIGINT UNSIGNED NULL,
  `reviewed_at` DATETIME NULL,
  `review_note` TEXT NULL,
  `current_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `command_id` VARCHAR(100) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_precheckin_booking` (`booking_id`)
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
  `booking_id` BIGINT UNSIGNED NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `source_event_id` VARCHAR(120) NOT NULL,
  `template_key` VARCHAR(60) NOT NULL,
  `template_version` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `channel` VARCHAR(20) NOT NULL DEFAULT 'EMAIL',
  `recipient_key` VARCHAR(180) NOT NULL,
  `payload_json` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
  `retry_count` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `last_error` VARCHAR(255) NULL,
  `delivered_at` DATETIME NULL,
  `command_key` VARCHAR(120) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_notification_intent_dedup` (`source_event_id`, `template_key`, `channel`, `recipient_key`)
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
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `discount_type` VARCHAR(20) NOT NULL DEFAULT 'FIXED_AMOUNT',
  `discount_value` DECIMAL(15,2) NOT NULL,
  `max_discount_vnd` DECIMAL(15,2) NULL,
  `min_nights` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `min_spend_vnd` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `allow_stack_with_campaign` TINYINT(1) NOT NULL DEFAULT 0,
  `max_uses_total` INT UNSIGNED NOT NULL DEFAULT 100,
  `max_uses_per_user` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `used_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `valid_from` DATETIME NOT NULL,
  `valid_to` DATETIME NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_voucher_hotel_code` (`hotel_id`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `voucher_reservations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `voucher_id` BIGINT UNSIGNED NOT NULL,
  `quote_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `discount_vnd` DECIMAL(15,2) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME NULL,
  `released_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_voucher_res_quote_code` (`quote_id`, `code`)
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







