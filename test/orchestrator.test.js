import test from 'node:test';
import assert from 'node:assert';
import { runWritePass } from '../lib/orchestrator.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ok = { category: 'fact', confidence: 'high', evidence: ['a'], module: 'fishing/settlement', draft: 'D', moduleLevel: 4 };

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
  rmSync(d, { recursive: true, force: true });
});

function fakeSvc() { return { write: async () => {}, search: async () => ({}), health: async () => ({}) }; }
