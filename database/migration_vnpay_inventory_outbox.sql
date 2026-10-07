-- ====================================================================================================
-- MIGRATION: TÍCH HỢP VNPAY, BOOKING HOLDS THEO KHOẢNG THỜI GIAN, PAYMENT TRANSACTIONS & OUTBOX EVENTS
-- ====================================================================================================

-- 1. CẬP NHẬT CHECK CONSTRAINT CHO TRẠNG THÁI BOOKING & LOGS
ALTER TABLE bookings DROP CHECK chk_bookings_status;
ALTER TABLE bookings ADD CONSTRAINT chk_bookings_status 
  CHECK (status IN ('PAYMENT_PENDING', 'PENDING', 'CONFIRMED', 'REJECTED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'PAYMENT_EXPIRED', 'PAYMENT_REVIEW'));

ALTER TABLE booking_status_logs DROP CHECK chk_booking_status_logs_new_status;
ALTER TABLE booking_status_logs ADD CONSTRAINT chk_booking_status_logs_new_status 
  CHECK (new_status IN ('PAYMENT_PENDING', 'PENDING', 'CONFIRMED', 'REJECTED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'PAYMENT_EXPIRED', 'PAYMENT_REVIEW'));

ALTER TABLE booking_status_logs DROP CHECK chk_booking_status_logs_old_status;
ALTER TABLE booking_status_logs ADD CONSTRAINT chk_booking_status_logs_old_status 
  CHECK (old_status IS NULL OR old_status IN ('PAYMENT_PENDING', 'PENDING', 'CONFIRMED', 'REJECTED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'PAYMENT_EXPIRED', 'PAYMENT_REVIEW'));

-- 2. TẠO BẢNG BOOKING_HOLDS (Giữ chỗ tạm thời theo khoảng thời gian [check_in_at, check_out_at))
CREATE TABLE IF NOT EXISTS booking_holds (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id          BIGINT UNSIGNED NOT NULL,
    room_id             BIGINT UNSIGNED NOT NULL,
    quantity            SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    check_in_at         DATETIME NOT NULL,
    check_out_at        DATETIME NOT NULL,
    status              VARCHAR(30) NOT NULL DEFAULT 'HELD' COMMENT 'HELD, COMMITTED, RELEASED, EXPIRED',
    hold_expires_at     DATETIME NOT NULL,
    released_at         DATETIME NULL,
    committed_at        DATETIME NULL,
    release_reason      VARCHAR(255) NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_booking_holds PRIMARY KEY (id),
    CONSTRAINT fk_booking_holds_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_booking_holds_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_booking_holds_quantity CHECK (quantity >= 1),
    CONSTRAINT chk_booking_holds_dates CHECK (check_out_at > check_in_at),
    CONSTRAINT chk_booking_holds_status CHECK (status IN ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED')),
    INDEX idx_booking_holds_overlap (room_id, status, check_in_at, check_out_at),
    INDEX idx_booking_holds_booking_id (booking_id),
    INDEX idx_booking_holds_expiry (status, hold_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. TẠO BẢNG PAYMENT_TRANSACTIONS (Lịch sử từng lượt attempt thanh toán với cổng VNPAY)
CREATE TABLE IF NOT EXISTS payment_transactions (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id          BIGINT UNSIGNED NOT NULL,
    provider            VARCHAR(30) NOT NULL DEFAULT 'VNPAY',
    attempt_no          INT UNSIGNED NOT NULL DEFAULT 1,
    txn_ref             VARCHAR(100) NOT NULL,
    amount              DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    currency            VARCHAR(10) NOT NULL DEFAULT 'VND',
    status              VARCHAR(30) NOT NULL DEFAULT 'CREATED' COMMENT 'CREATED, PENDING, PAID, FAILED, EXPIRED, PAID_REQUIRES_REVIEW, REFUND_PENDING, REFUNDED',
    response_code       VARCHAR(20) NULL,
    transaction_status  VARCHAR(20) NULL,
    vnp_transaction_no  VARCHAR(50) NULL,
    bank_code           VARCHAR(30) NULL,
    card_type           VARCHAR(30) NULL,
    pay_date            DATETIME NULL,
    gateway_expire_at   DATETIME NULL,
    paid_at             DATETIME NULL,
    failed_at           DATETIME NULL,
    expired_at          DATETIME NULL,
    refund_amount       DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    refunded_at         DATETIME NULL,
    refund_note         TEXT NULL,
    raw_ipn_response    JSON NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_payment_transactions PRIMARY KEY (id),
    CONSTRAINT fk_payment_transactions_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT uq_payment_transactions_txn_ref UNIQUE (txn_ref),
    CONSTRAINT uq_payment_transactions_attempt UNIQUE (booking_id, attempt_no),
    CONSTRAINT chk_payment_transactions_amount CHECK (amount >= 0),
    CONSTRAINT chk_payment_transactions_status CHECK (status IN ('CREATED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'PAID_REQUIRES_REVIEW', 'REFUND_PENDING', 'REFUNDED')),
    INDEX idx_payment_transactions_booking_id (booking_id),
    INDEX idx_payment_transactions_status (status),
    INDEX idx_payment_transactions_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. TẠO BẢNG OUTBOX_EVENTS (Transactional Outbox Pattern - gửi Email, Socket và xử lý sau khi commit DB)
CREATE TABLE IF NOT EXISTS outbox_events (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_type          VARCHAR(100) NOT NULL,
    aggregate_type      VARCHAR(50) NOT NULL,
    aggregate_id        VARCHAR(50) NOT NULL,
    payload             JSON NOT NULL,
    status              VARCHAR(30) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING, PROCESSING, COMPLETED, FAILED',
    retry_count         INT UNSIGNED NOT NULL DEFAULT 0,
    max_retries         INT UNSIGNED NOT NULL DEFAULT 5,
    error_message       TEXT NULL,
    available_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at        DATETIME NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_outbox_events PRIMARY KEY (id),
    CONSTRAINT chk_outbox_events_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    INDEX idx_outbox_events_poll (status, available_at),
    INDEX idx_outbox_events_aggregate (aggregate_type, aggregate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
