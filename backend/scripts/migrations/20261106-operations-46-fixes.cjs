// Restartable additive migration for 46 operational fixes (shifts planned window, coverage acceptance, incidents, service snapshots).
module.exports = async function up(db) {
  async function column(table, name, definition) {
    const [tables] = await db.execute(
      `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    if (!tables.length) return;
    const [rows] = await db.execute(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, name],
    );
    if (!rows.length) await db.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }

  // P1-02: staff_shifts planned start/end & attendance audit fields
  await column('staff_shifts', 'planned_start_at', 'DATETIME NULL');
  await column('staff_shifts', 'planned_end_at', 'DATETIME NULL');
  await column('staff_shifts', 'hotel_timezone', "VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh'");
  await column('staff_shifts', 'actual_clock_in_at', 'DATETIME NULL');
  await column('staff_shifts', 'actual_clock_out_at', 'DATETIME NULL');
  await column('staff_shifts', 'attendance_confirmed_by', 'BIGINT UNSIGNED NULL');
  await column('staff_shifts', 'version', 'INT UNSIGNED NOT NULL DEFAULT 1');

  // P0-02, P1-28: booking_coverage_grants request/approval/acceptance lifecycle columns
  await column('booking_coverage_grants', 'requested_by', 'BIGINT UNSIGNED NULL');
  await column('booking_coverage_grants', 'approved_by', 'BIGINT UNSIGNED NULL');
  await column('booking_coverage_grants', 'approved_at', 'DATETIME NULL');
  await column('booking_coverage_grants', 'accepted_by', 'BIGINT UNSIGNED NULL');
  await column('booking_coverage_grants', 'accepted_at', 'DATETIME NULL');
  await column('booking_coverage_grants', 'accept_deadline', 'DATETIME NULL');

  // P1-23: service_requests campaign & price snapshot columns
  await column('service_requests', 'applied_campaign_id', 'BIGINT UNSIGNED NULL');
  await column('service_requests', 'campaign_version', 'INT UNSIGNED NULL');
  await column('service_requests', 'original_price_snapshot', 'DECIMAL(12,2) NULL');

  // P2-03, P0-04, P1-17: booking_assignment_incidents table
  await db.query(`CREATE TABLE IF NOT EXISTS booking_assignment_incidents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    booking_id BIGINT UNSIGNED NOT NULL,
    hotel_id BIGINT UNSIGNED NOT NULL,
    kind VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'CRITICAL',
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    due_at DATETIME NULL,
    current_owner_id BIGINT UNSIGNED NULL,
    retry_count INT UNSIGNED NOT NULL DEFAULT 0,
    last_error VARCHAR(255) NULL,
    resolved_at DATETIME NULL,
    command_key VARCHAR(128) NULL,
    INDEX ix_incident_hotel_status (hotel_id, status, due_at),
    INDEX ix_incident_booking_kind (booking_id, kind, status)
  ) ENGINE=InnoDB`);
};
