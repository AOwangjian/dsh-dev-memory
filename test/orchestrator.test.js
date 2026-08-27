import test from 'node:test';
import assert from 'node:assert';
import { runWritePass } from '../lib/orchestrator.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ok = { category: 'fact', confidence: 'high', evidence: ['a'], module: 'fishing/settlement', draft: { relPath: 'fishing/settlement.md', content: '# token 登录\n- 刷新过期要重登' }, moduleLevel: 4 };

test('changelog 不落盘', async () => {
  const r = await runWritePass({ proposal: { ...ok, category: 'changelog' }, service: fakeSvc(), auditPath: 'x', sessionId: 's' });
  assert.equal(r.written, false);
  assert.match(r.reason, /changelog/);
});

test('Level 1 需人工确认', async () => {
  const r = await runWritePass({ proposal: { ...ok, moduleLevel: 1 }, service: fakeSvc(), auditPath: 'x', sessionId: 's' });
  assert.equal(r.written, false);
  assert.equal(r.needsConfirm, true);
});

test('合法 proposal 落盘并审计', async () => {
  const d = mkdtempSync(join(tmpdir(), 'orch-'));
  const calls = [];
  const svc = { write: async (x) => { calls.push(x); }, search: async () => ({}), health: async () => ({}) };
  const auditFile = join(d, 'a.jsonl');
  const r = await runWritePass({ proposal: ok, service: svc, auditPath: auditFile, sessionId: 's1' });
  assert.equal(r.written, true);
  assert.equal(calls.length, 1);

  const lines = readFileSync(auditFile, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.sessionId, 's1');
  assert.equal(entry.module, 'fishing/settlement');
  assert.equal(entry.category, 'fact');
  assert.equal(entry.action, 'write');
  assert.equal(entry.relPath, 'fishing/settlement.md');
  assert.equal(entry.summary, '# token 登录');
  rmSync(d, { recursive: true, force: true });
});

test('autoWriteLevels 排除的等级不自动落盘', async () => {
  const calls = [];
  const svc = { write: async (x) => { calls.push(x); } };
  const r = await runWritePass({
    proposal: { ...ok, moduleLevel: 4 },
    service: svc,
    auditPath: 'x',
    sessionId: 's',
    autoWriteLevels: [2, 3],
  });
  assert.equal(r.written, false);
  assert.equal(r.needsConfirm, true);
  assert.equal(calls.length, 0);
});

test('autoWriteLevels 命中的等级自动落盘', async () => {
  const calls = [];
  const svc = { write: async (x) => { calls.push(x); } };
  const r = await runWritePass({
    proposal: { ...ok, moduleLevel: 2 },
    service: svc,
    autoWriteLevels: [2, 3],
  });
  assert.equal(r.written, true);
  assert.equal(calls.length, 1);
});

test('Level 1 即使在 autoWriteLevels 也需确认', async () => {
  const calls = [];
  const svc = { write: async (x) => { calls.push(x); } };
  const r = await runWritePass({
    proposal: { ...ok, moduleLevel: 1 },
    service: svc,
    autoWriteLevels: [1, 2, 3],
  });
  assert.equal(r.written, false);
  assert.equal(r.needsConfirm, true);
  assert.equal(calls.length, 0);
});

test('writeConfidenceMin 传入 classify', async () => {
  const r = await runWritePass({
    proposal: { ...ok, confidence: 'medium' },
    service: fakeSvc(),
    writeConfidenceMin: 'high',
  });
  assert.equal(r.written, false);
  assert.match(r.reason, /置信度/);
});

function fakeSvc() { return { write: async () => {}, search: async () => ({}), health: async () => ({}) }; }

test('audit preserves create/update action returned by service.write', async () => {
  const created = await runWritePass({ proposal: { ...ok, moduleLevel: 2 }, service: { write: async () => ({ action: 'create' }) }, autoWriteLevels: [2] });
  const updated = await runWritePass({ proposal: { ...ok, moduleLevel: 2 }, service: { write: async () => ({ action: 'update' }) }, autoWriteLevels: [2] });
  assert.equal(created.audit.action, 'create');
  assert.equal(updated.audit.action, 'update');
});

test('successful write returns the stamped audit timestamp', async () => {
  const d = mkdtempSync(join(tmpdir(), 'orch-ts-'));
  const auditFile = join(d, 'a.jsonl');
  const r = await runWritePass({ proposal: { ...ok, moduleLevel: 2 }, service: { write: async () => ({ action: 'create' }) }, auditPath: auditFile, autoWriteLevels: [2] });
  assert.equal(typeof r.audit.ts, 'number');
  const stored = JSON.parse(readFileSync(auditFile, 'utf8').trim());
  assert.equal(stored.ts, r.audit.ts);
  rmSync(d, { recursive: true, force: true });
});
