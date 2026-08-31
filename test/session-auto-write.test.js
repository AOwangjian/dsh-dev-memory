import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeSessionAutoWriteStore } from '../lib/session-auto-write.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'session-aw-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'session-auto-write.json');
  return { root, path, store: makeSessionAutoWriteStore({ path }) };
}

test('missing file inherits the default', (t) => {
  const { store } = fixture(t);
  const resolved = store.resolve('sess-a', true);
  assert.equal(resolved.autoWrite, true);
  assert.equal(resolved.inherited, true);
  assert.equal(resolved.sessionId, 'sess-a');
});

test('set writes only an override and resolve reads it back', (t) => {
  const { path, store } = fixture(t);
  const saved = store.set('sess-a', false);
  assert.equal(saved.autoWrite, false);
  assert.equal(saved.inherited, false);
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(stored.version, 1);
  assert.equal(stored.sessions['sess-a'].autoWrite, false);
  assert.equal(store.resolve('sess-a', true).autoWrite, false);
  assert.equal(store.resolve('sess-b', true).autoWrite, true);
});

test('child inherits parent override until it has its own', (t) => {
  const { path } = fixture(t);
  writeFileSync(path, JSON.stringify({
    version: 1,
    sessions: { 'parent-1': { autoWrite: false } },
  }));
  const store = makeSessionAutoWriteStore({ path });
  const child = store.resolve('child-1', true, { parentSessionId: 'parent-1' });
  assert.equal(child.autoWrite, false);
  assert.equal(child.inherited, true);
  store.set('child-1', true);
  assert.equal(store.resolve('child-1', false, { parentSessionId: 'parent-1' }).autoWrite, true);
});
