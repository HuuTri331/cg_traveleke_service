import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Booking assignment: MySQL schema regression guard', () => {
  const service =
    readFileSync(resolve(__dirname, 'booking-assignment.service.ts'), 'utf8') +
    '\n' +
    readFileSync(resolve(__dirname, 'candidate-loader.ts'), 'utf8');
  const schema = readFileSync(
    resolve(__dirname, '../../../database/bootstrap/phase-2-unified-complete.sql'),
    'utf8',
  );

  it('joins skill_id to skill_categories.code; never uses ss.skill_code', () => {
    expect(service).toContain("JOIN skill_categories sc ON sc.id = ss.skill_id");
    expect(service).toContain('sc.code');
    expect(service).not.toContain('ss.skill_code');
    expect(schema).toContain('`skill_id` bigint unsigned NOT NULL');
    expect(schema).toContain('`code` varchar(60)');
  });

  it('uses case_complexity + status instead of nonexistent policy columns', () => {
    expect(service).toContain("WHERE case_complexity = ? AND status = 'ACTIVE'");
    expect(service).not.toContain('AND service_tier = ? AND active = 1');
    expect(schema).toContain('`case_complexity` varchar(20)');
    expect(schema).toContain('`status` varchar(20)');
  });

  it('fails instead of silently ignoring missing or malformed eligibility schema', () => {
    expect(service).toContain('ServiceUnavailableException');
    expect(service).not.toContain('catch {}');
  });
});
