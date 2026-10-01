import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { LEGACY_VULNERABILITY_OVERRIDE_IDS } from '../shared/legacy-vulnerability-overrides.js';
import { classifyAuditRows, classificationAuditSql } from '../backend/scripts/audit-layer-classification.mjs';

const record = (id, overrides = {}) => ({ id, title: 'Nombre arbitrario', isDeleted: true, category: null, explicitCategory: false, ...overrides });

test('migration and auditor use precisely the three authorized IDs, independent of titles', async () => {
  const migration = await fs.readFile('backend/prisma/migrations/202609300001_layer_division/migration.sql', 'utf8');
  assert.equal(LEGACY_VULNERABILITY_OVERRIDE_IDS.length, 3);
  for (const id of LEGACY_VULNERABILITY_OVERRIDE_IDS) assert.equal(migration.split(`'${id}'`).length - 1, 2);
  assert.doesNotMatch(migration, /title\s+(?:LIKE|ILIKE|SIMILAR TO)|title\s*~/i);
  const rows = LEGACY_VULNERABILITY_OVERRIDE_IDS.map((id, index) => record(id, { title: `Cambio de nombre ${index}` }));
  const audit = classifyAuditRows(rows);
  assert.equal(audit.authorizedLegacyOverrides, 3);
  assert.equal(audit.distribution.vulnerability, 3);
  assert.equal(audit.ambiguous.length, 0);
  assert.ok(audit.overrideRows.every(row => row.isDeleted && row.preserved && !row.publiclyVisible && row.phenomenon === null));
});

test('active, explicitly categorized, or different-ID rows remain ambiguous', () => {
  const rows = [
    record(LEGACY_VULNERABILITY_OVERRIDE_IDS[0], { isDeleted: false }),
    record(LEGACY_VULNERABILITY_OVERRIDE_IDS[1], { category: 'geologicos', explicitCategory: true }),
    record('other-id', { title: 'VF 01 Vulnerabilidad Física VPS' }),
  ];
  const audit = classifyAuditRows(rows);
  assert.equal(audit.authorizedLegacyOverrides, 0);
  assert.deepEqual(audit.ambiguous.map(row => row.id), rows.map(row => row.id));
  assert.equal(audit.distribution.vulnerability, 0);
});

test('the read-only audit evaluates the migration category and explicit-marker logic', async () => {
  const sql = await classificationAuditSql();
  assert.match(sql, /explicitCategory/);
  assert.match(sql, /geologicos/);
  assert.doesNotMatch(sql, /UPDATE|DELETE|INSERT/);
});
