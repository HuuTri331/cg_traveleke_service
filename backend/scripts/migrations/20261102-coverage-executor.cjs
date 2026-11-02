// Restartable additive migration. Never infer claims/credit from current assignees.
module.exports = async function up(db) {
  async function column(table, name, definition) {
    const [rows] = await db.execute(`SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, name]);
    if (!rows.length) await db.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  await column('booking_coverage_grants', 'scope_mode', "VARCHAR(20) NOT NULL DEFAULT 'TASK_TYPES'");
  await column('booking_coverage_grants', 'absence_request_id', 'BIGINT UNSIGNED NULL');
  await column('booking_coverage_grants', 'completion_deadline', 'DATETIME NULL');
  await column('guest_work_tasks', 'active_executor_id', 'BIGINT UNSIGNED NULL');
  await column('guest_work_tasks', 'coverage_grant_id', 'BIGINT UNSIGNED NULL');
  await column('guest_work_tasks', 'execution_lease_until', 'DATETIME NULL');
  await db.query(`CREATE TABLE IF NOT EXISTS booking_coverage_task_scopes (
    grant_id BIGINT UNSIGNED NOT NULL, task_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (grant_id, task_id), INDEX ix_coverage_scope_task (task_id),
    CONSTRAINT fk_scope_grant FOREIGN KEY (grant_id) REFERENCES booking_coverage_grants(id),
    CONSTRAINT fk_scope_task FOREIGN KEY (task_id) REFERENCES guest_work_tasks(id)
  ) ENGINE=InnoDB`);
  for (const [table, name, definition] of [
    ['booking_coverage_grants', 'fk_coverage_absence', 'FOREIGN KEY (absence_request_id) REFERENCES staff_absence_requests(id)'],
    ['guest_work_tasks', 'fk_task_executor', 'FOREIGN KEY (active_executor_id) REFERENCES users(id)'],
    ['guest_work_tasks', 'fk_task_coverage', 'FOREIGN KEY (coverage_grant_id) REFERENCES booking_coverage_grants(id)'],
  ]) {
    const [rows] = await db.execute(`SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`, [table, name]);
    if (!rows.length) await db.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
  }
  const [duplicates] = await db.query(`SELECT source_table, source_id, COUNT(*) AS n FROM guest_work_tasks
    WHERE source_table IS NOT NULL AND source_id IS NOT NULL GROUP BY source_table, source_id HAVING n > 1 LIMIT 1`);
  if (duplicates.length) throw new Error('Duplicate task source: reconcile manually; migration will NOT delete history');
  const [indexes] = await db.query(`SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'guest_work_tasks' AND INDEX_NAME = 'ux_tasks_source'`);
  if (!indexes.length) await db.query('ALTER TABLE guest_work_tasks ADD UNIQUE INDEX ux_tasks_source (source_table,source_id)');
};
