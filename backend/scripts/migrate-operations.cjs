/* Unified additive migration runner using migration_unified_complete.sql. No DROP or destructive reset. */
const mysql = require('mysql2/promise');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');

const files = ['migration_unified_complete.sql'];

function stripHardcodedDatabaseSwitch(rawSql) {
  return rawSql
    .replace(/^\s*CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+`?hotel_booking_db`?[\s\S]*?;\s*$/gim, '')
    .replace(/^\s*USE\s+`?[a-zA-Z0-9_]+`?\s*;\s*$/gim, '');
}

async function executeUnifiedSql(db, rawSql) {
  const sanitizedSql = stripHardcodedDatabaseSwitch(rawSql);
  const delimStart = 'DELIMITER $$';
  const delimEnd = 'DELIMITER ;';
  if (!sanitizedSql.includes(delimStart)) {
    await db.query(sanitizedSql);
    return;
  }
  const [beforeProc, rest] = sanitizedSql.split(delimStart);
  const [procBlock, afterProc] = rest.split(delimEnd);
  if (beforeProc && beforeProc.trim()) {
    await db.query(beforeProc);
  }
  if (procBlock && procBlock.trim()) {
    const cleanProc = procBlock.replace(/END\$\$\s*$/, 'END');
    await db.query(cleanProc);
  }
  if (afterProc && afterProc.trim()) {
    await db.query(afterProc);
  }
}

async function migrate(config) {
  if (!config || !config.database) {
    throw new Error('Target database (config.database / DB_DATABASE) is required for migration.');
  }
  const db = await mysql.createConnection({ ...config, multipleStatements: true });
  let locked = false;
  try {
    const [[dbCheckBefore]] = await db.query('SELECT DATABASE() AS currentDb');
    if (dbCheckBefore.currentDb !== config.database) {
      throw new Error(`Database mismatch before migration: expected ${config.database}, got ${dbCheckBefore.currentDb}`);
    }
    const [[lock]] = await db.query("SELECT GET_LOCK('traveleke_operations_migrations', 10) AS acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Migration lock unavailable');
    locked = true;
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(180) PRIMARY KEY, checksum CHAR(64) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    for (const name of files) {
      const sql = readFileSync(resolve(__dirname, '../../database', name), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const [applied] = await db.execute('SELECT checksum FROM schema_migrations WHERE version = ?', [name]);
      if (applied.length && applied[0].checksum === hash) {
        continue;
      }
      await executeUnifiedSql(db, sql);
      await db.execute(
        'INSERT INTO schema_migrations(version,checksum) VALUES (?,?) ON DUPLICATE KEY UPDATE checksum = VALUES(checksum), applied_at = CURRENT_TIMESTAMP',
        [name, hash],
      );
    }
    for (const version of [
      '20261102-coverage-executor.cjs',
      '20261106-operations-46-fixes.cjs',
      '20261107-online-extensions-v1.cjs',
    ]) {
      const migrationPath = resolve(__dirname, 'migrations', version);
      const checksum = createHash('sha256').update(readFileSync(migrationPath)).digest('hex');
      const [prior] = await db.execute('SELECT checksum FROM schema_migrations WHERE version = ?', [version]);
      if (!prior.length || prior[0].checksum !== checksum) {
        await require(migrationPath)(db);
        await db.execute(
          'INSERT INTO schema_migrations(version,checksum) VALUES (?,?) ON DUPLICATE KEY UPDATE checksum = VALUES(checksum), applied_at = CURRENT_TIMESTAMP',
          [version, checksum],
        );
      }
    }
    const expected = [
      'booking_coverage_grants', 'booking_coverage_events', 'booking_coverage_task_scopes',
      'guest_work_tasks', 'guest_work_events', 'guest_work_evidence', 'guest_conversations', 'guest_messages',
      'guest_staff_reviews', 'guest_staff_review_revisions', 'staff_kpi_policies',
      'staff_kpi_period_scores', 'staff_kpi_metric_scores', 'staff_kpi_adjustments',
      'promotion_campaigns', 'booking_price_quotes', 'booking_benefit_accounts', 'booking_benefit_ledger',
      'promotion_refund_intents', 'benefit_consent_records', 'room_units', 'room_unit_allocations',
      'room_unit_stay_slots', 'room_unit_allocation_commands', 'housekeeping_tasks', 'room_unit_blocks',
      'booking_amendments', 'booking_active_amendments', 'folios', 'folio_entries', 'folio_settlements',
      'notification_intents', 'rate_plans', 'rate_calendar', 'precheckin_submissions', 'voucher_codes',
      'voucher_reservations',
    ];
    const [tables] = await db.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
    if (expected.some((t) => !tables.some((r) => r.name === t))) throw new Error('Unified schema incomplete');
    console.log('Unified database migration verified (all 114 tables & phases 1–6 + online extensions).');
  } finally {
    if (locked) await db.query("SELECT RELEASE_LOCK('traveleke_operations_migrations')");
    await db.end();
  }
}
module.exports = { migrate, executeUnifiedSql };
if (require.main === module) {
  if (!process.env.DB_DATABASE) throw new Error('DB_DATABASE must be explicitly set; no production default');
  migrate({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE })
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}

