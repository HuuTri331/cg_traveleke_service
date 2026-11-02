-- =============================================================================
-- TRAVELEKE: MIGRATION GUEST WORK & MESSAGING (ĐỢT 4)
-- Quản lý nhiệm vụ, nhật ký có bằng chứng, SLA và tin nhắn khách hàng
-- =============================================================================

CREATE TABLE IF NOT EXISTS `guest_work_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `type` VARCHAR(30) NOT NULL,
  `source_table` VARCHAR(50) NULL,
  `source_id` VARCHAR(50) NULL,
  `assigned_staff_id` BIGINT UNSIGNED NULL,
  `owner_at_create` BIGINT UNSIGNED NULL,
  `status` VARCHAR(25) NOT NULL DEFAULT 'CREATED',
  `priority` VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  `title` VARCHAR(255) NULL,
  `description` TEXT NULL,
  `response_sla_due_at` DATETIME NULL,
  `resolution_sla_due_at` DATETIME NULL,
  `first_response_at` DATETIME NULL,
  `started_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `verified_at` DATETIME NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `ix_tasks_hotel_assignee_status` (`hotel_id`, `assigned_staff_id`, `status`),
  INDEX `ix_tasks_booking_type` (`booking_id`, `type`),
  UNIQUE INDEX `ux_tasks_source` (`source_table`, `source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `guest_work_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `actor_type` VARCHAR(20) NOT NULL DEFAULT 'USER',
  `actor_staff_id` BIGINT UNSIGNED NULL,
  `event_type` VARCHAR(30) NOT NULL,
  `from_status` VARCHAR(25) NULL,
  `to_status` VARCHAR(25) NOT NULL,
  `occurred_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `evidence_type` VARCHAR(30) NULL,
  `evidence_ref` VARCHAR(255) NULL,
  `idempotency_key` VARCHAR(128) NULL,
  `recorded_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `ix_work_events_task` (`task_id`, `occurred_at`),
  INDEX `ix_work_events_actor` (`actor_staff_id`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `guest_work_evidence` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `submitted_by` BIGINT UNSIGNED NOT NULL,
  `type` VARCHAR(30) NOT NULL,
  `storage_ref` VARCHAR(255) NOT NULL,
  `verification_status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `verified_by` BIGINT UNSIGNED NULL,
  `verified_at` DATETIME NULL,
  `note` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `ix_evidence_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `guest_conversations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `hotel_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX `ux_conversation_booking` (`booking_id`),
  INDEX `ix_conversation_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `guest_messages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `conversation_id` BIGINT UNSIGNED NOT NULL,
  `sender_user_id` BIGINT UNSIGNED NOT NULL,
  `sender_role` VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER',
  `body` TEXT NOT NULL,
  `client_msg_id` VARCHAR(128) NULL,
  `sent_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `ix_messages_conversation` (`conversation_id`, `sent_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

