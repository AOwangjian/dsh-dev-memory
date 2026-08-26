import test from 'node:test';
import assert from 'node:assert';
import { appendAudit, readAudit } from '../lib/audit.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('append 后能读回', () => {
  const d = mkdtempSync(join(tmpdir(), 'audit-'));
  const p = join(d, 'audit.jsonl');
  appendAudit(p, { module: 'fishing/settlement', action: 'write' });
  appendAudit(p, { module: 'system', action: 'create' });
  const rows = readAudit(p);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].module, 'fishing/settlement');
  rmSync(d, { recursive: true, force: true });
});

test('不存在的日志返回空', () => {
  assert.deepEqual(readAudit(join(tmpdir(), 'nope.jsonl')), []);
});
