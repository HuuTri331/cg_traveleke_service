// Restartable additive migration for 32 open-source hospitality gaps & online extensions v1.
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

  // Additive columns on existing core tables (Section 3 & Section 5)
  await column('bookings', 'version', 'INT UNSIGNED NOT NULL DEFAULT 1');
  await column('payment_transactions', 'purpose', "VARCHAR(40) NOT NULL DEFAULT 'INITIAL_BOOKING'");
  await column('payment_transactions', 'amendment_id', 'BIGINT UNSIGNED NULL');

  // Ensure additive columns on newly created or pre-existing extension tables
  await column('room_units', 'floor_code', 'VARCHAR(40) NULL');
  await column('room_units', 'verification_status', "VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED'");
  await column('room_units', 'operational_state', "VARCHAR(20) NOT NULL DEFAULT 'IN_SERVICE'");
  await column('room_unit_stay_slots', 'room_unit_id', 'BIGINT UNSIGNED NULL');
  await column('room_unit_stay_slots', 'allocated_by', 'BIGINT UNSIGNED NULL');
  await column('room_unit_stay_slots', 'source_command_key', 'VARCHAR(128) NULL');
  await column('room_unit_stay_slots', 'allocated_at', 'DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)');
  await column('room_unit_stay_slots', 'released_at', 'DATETIME(3) NULL');
  await column('folios', 'is_backfilled_verified', 'TINYINT(1) NOT NULL DEFAULT 1');
  await column('folio_entries', 'actor_user_id', 'BIGINT UNSIGNED NULL');
  await column('folio_entries', 'metadata_json', 'JSON NULL');
  await column('folio_settlements', 'settlement_kind', "VARCHAR(30) NOT NULL DEFAULT 'DESK_SETTLEMENT'");
  await column('folio_settlements', 'receipt_ref', 'VARCHAR(120) NULL');
  await column('folio_settlements', 'verified_by', 'BIGINT UNSIGNED NULL');
  await column('folio_settlements', 'idempotency_key', 'VARCHAR(180) NULL');
};

