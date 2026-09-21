import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makePluginConfigStore } from '../lib/plugin-config.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'plugin-cfg-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'config.json');
  return { root, path, store: makePluginConfigStore({ path }) };
}

test('missing file inherits the boot default', (t) => {
  const { store } = fixture(t);
  assert.equal(store.read(true).autoWrite, true);
  assert.equal(store.read(false).autoWrite, false);
});

test('set writes autoWrite and a new store reads it back', (t) => {
  const { path, store } = fixture(t);
  const saved = store.set({ autoWrite: false });
  assert.equal(saved.autoWrite, false);
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(stored.version, 1);
  assert.equal(stored.autoWrite, false);
  assert.equal(makePluginConfigStore({ path }).read(true).autoWrite, false);
});

test('set persists Jev settings without accepting a secret value', (t) => {
  const { path, store } = fixture(t);
  const saved = store.set({
    jev: { enabled: true, policyInjectionEnabled: false, apiKeyEnv: 'TYPESAFE_API_KEY', model: 'jev-1.13.0' },
  });
  assert.deepEqual(saved.jev, { enabled: true, policyInjectionEnabled: false, apiKeyEnv: 'TYPESAFE_API_KEY', model: 'jev-1.13.0' });
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(stored.jev, saved.jev);
  assert.equal(JSON.stringify(stored).includes('apikey_'), false);
  assert.deepEqual(makePluginConfigStore({ path }).read(false).jev, saved.jev);
});

test('corrupt file falls back to the boot default', (t) => {
  const { path } = fixture(t);
  writeFileSync(path, '{not json');
  assert.equal(makePluginConfigStore({ path }).read(true).autoWrite, true);
});
