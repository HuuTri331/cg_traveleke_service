/* Additive upgrade after platform + assignment/presence migrations. No seeds, DROP or reset. */
const mysql = require('mysql2/promise');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');
const files = [
  'migration_booking_coverage_v2.sql',
  'migration_guest_work_and_messages.sql',
  'migration_staff_kpi_v2.sql',
  'migration_promotions_v1.sql',
  'migration_promotions_v2_finance.sql',
];
const requiredBase = ['users', 'hotels', 'hotel_staff', 'rooms', 'bookings', 'booking_rooms',
  'booking_holds', 'payment_transactions', 'outbox_events', 'skill_categories', 'staff_skills',
  'staff_eligibility_rules', 'staff_language_skills', 'staff_availability_blocks',
  'booking_assignments', 'booking_assignment_state', 'booking_presence_events', 'hotel_assignment_dispatch_locks'];
async function migrate(config) {
  const db = await mysql.createConnection({ ...config, multipleStatements: true });
  let locked = false;
  try {
    const [[lock]] = await db.query("SELECT GET_LOCK('traveleke_operations_migrations', 10) AS acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Migration lock unavailable');
    locked = true;
    const [rows] = await db.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
    const names = new Set(rows.map((r) => r.name));
    const missing = requiredBase.filter((t) => !names.has(t));
    if (missing.length) throw new Error(`Apply platform, assignment and presence migrations first. Missing: ${missing.join(', ')}`);
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(180) PRIMARY KEY, checksum CHAR(64) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    for (const name of files) {
      const sql = readFileSync(resolve(__dirname, '../../database', name), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const [applied] = await db.execute('SELECT checksum FROM schema_migrations WHERE version = ?', [name]);
      if (applied.length) {
        if (applied[0].checksum !== hash) throw new Error(`Checksum mismatch: ${name}. Add a new migration; do not edit applied files.`);
        continue;
      }
      // MySQL DDL commits implicitly. Files are restartable CREATE IF NOT EXISTS;
      // receipt is written only after all statements succeed.
      await db.query(sql);
      await db.execute('INSERT INTO schema_migrations(version,checksum) VALUES (?,?)', [name, hash]);
    }
    const version = '20261102-coverage-executor.cjs';
    const migrationPath = resolve(__dirname, 'migrations', version);
    const checksum = createHash('sha256').update(readFileSync(migrationPath)).digest('hex');
    const [prior] = await db.execute('SELECT checksum FROM schema_migrations WHERE version = ?', [version]);
    if (prior.length && prior[0].checksum !== checksum) throw new Error(`Checksum mismatch: ${version}`);
    if (!prior.length) {
      await require(migrationPath)(db);
      await db.execute('INSERT INTO schema_migrations(version,checksum) VALUES (?,?)', [version, checksum]);
    }
    const expected = ['booking_coverage_grants', 'booking_coverage_events', 'guest_work_tasks',
      'guest_work_events', 'guest_work_evidence', 'guest_conversations', 'guest_messages',
      'guest_staff_reviews', 'guest_staff_review_revisions', 'staff_kpi_policies',
      'staff_kpi_period_scores', 'staff_kpi_metric_scores', 'staff_kpi_adjustments',
      'promotion_campaigns', 'booking_price_quotes', 'booking_benefit_accounts', 'booking_benefit_ledger',
      'promotion_refund_intents', 'benefit_consent_records'];
    const [tables] = await db.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
    if (expected.some((t) => !tables.some((r) => r.name === t))) throw new Error('Operations schema incomplete');
    console.log('Operations migrations verified (phases 3–5).');
  } finally {
    if (locked) await db.query("SELECT RELEASE_LOCK('traveleke_operations_migrations')");
    await db.end();
  }
}
module.exports = { migrate };
if (require.main === module) {
  if (!process.env.DB_DATABASE) throw new Error('DB_DATABASE must be explicitly set; no production default');
  migrate({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE })
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
