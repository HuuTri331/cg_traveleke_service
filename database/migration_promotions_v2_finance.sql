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
