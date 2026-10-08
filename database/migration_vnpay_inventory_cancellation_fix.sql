-- Migration: Fixes for Inventory Holds, Checkout Idempotency, Outbox Locking, and Booking Cancellation Requests

-- 1. Unique constraint: One booking has exactly one logical hold
ALTER TABLE booking_holds
ADD CONSTRAINT uq_booking_holds_booking UNIQUE (booking_id);

-- 2. Bookings checkout idempotency
ALTER TABLE bookings
ADD COLUMN checkout_idempotency_key VARCHAR(100) NULL,
ADD COLUMN checkout_request_hash CHAR(64) NULL,
ADD UNIQUE KEY uq_checkout_idempotency (checkout_idempotency_key);

-- 3. Outbox locking for atomic worker claiming
ALTER TABLE outbox_events
ADD COLUMN locked_at DATETIME NULL,
ADD COLUMN locked_by VARCHAR(100) NULL,
ADD INDEX idx_outbox_claim (status, available_at, locked_at);

-- 4. Booking cancellation requests table
CREATE TABLE IF NOT EXISTS booking_cancellation_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  requester_type VARCHAR(30) NOT NULL DEFAULT 'CUSTOMER',
  reason TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  review_note TEXT NULL,
  refund_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_bcr_booking_id (booking_id),
  INDEX idx_bcr_status (status),
  INDEX idx_bcr_requested_by (requested_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
