import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { makeWorkspaceRegistry } from '../lib/workspaces.js';

function fixture(t, times = [1000]) {
  const root = mkdtempSync(join(tmpdir(), 'workspaces-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let i = 0;
  const registryPath = join(root, '.dsh', 'dev-memory', 'workspaces.json');
  const projectsRoot = join(root, '.claude', 'projects');
  const registry = makeWorkspaceRegistry({ registryPath, projectsRoot, profile: 'web', now: () => times[Math.min(i++, times.length - 1)] });
  return { root, registryPath, projectsRoot, registry };
}

function stored(path) { return JSON.parse(readFileSync(path, 'utf8')); }

test('list creates an empty normalized registry', (t) => {
  const { registry, registryPath } = fixture(t);
  assert.deepEqual(registry.list(), []);
  assert.deepEqual(stored(registryPath), { version: 1, workspaces: [] });
});

test('scan discovers A-convention memory directories without inventing workspace paths', (t) => {
  const { registry, projectsRoot } = fixture(t, [1100]);
  mkdirSync(join(projectsRoot, 'D--one', 'memory'), { recursive: true });
  mkdirSync(join(projectsRoot, 'ignored'), { recursive: true });
  const [record] = registry.scan();
  assert.equal(record.id, 'D--one');
  assert.equal(record.workspacePath, null);
  assert.equal(record.memoryRoot, join(projectsRoot, 'D--one', 'memory'));
  assert.equal(record.verified, false);
  assert.equal(record.lastSeenAt, 1100);
  assert.deepEqual(record.sourceProfiles, ['web']);
});

test('upsertVerified derives the exact strict slug and preserves first seen metadata', (t) => {
  const { registry, projectsRoot } = fixture(t, [1200, 1300]);
  const first = registry.upsertVerified(String.raw`D:\bydk\F20_Client\Fish20`);
  const second = registry.upsertVerified(String.raw`D:\bydk\F20_Client\Fish20`);
  assert.equal(first.id, 'D--bydk-F20_Client-Fish20');
  assert.equal(first.memoryRoot, join(projectsRoot, first.id, 'memory'));
  assert.equal(second.firstSeenAt, 1200);
  assert.equal(second.lastSeenAt, 1300);
  assert.equal(second.name, 'Fish20');
  assert.equal(second.verified, true);
});

test('list sorts pinned first, then lastWriteAt, then lastSeenAt', (t) => {
  const { registry } = fixture(t, [1, 2, 3, 4, 5, 6]);
  const a = registry.upsertVerified(String.raw`C:\a`);
  const b = registry.upsertVerified(String.raw`C:\b`);
  const c = registry.upsertVerified(String.raw`C:\c`);
  registry.markWrite(a.id);
  registry.markWrite(b.id);
  registry.mutate({ action: 'pin', id: c.id, pinned: true });
  assert.deepEqual(registry.list().map(x => x.id), [c.id, b.id, a.id]);
});

test('mutate renames, pins, adds, and removes registration without deleting memory', (t) => {
  const { registry, projectsRoot } = fixture(t, [10, 20, 30, 40]);
  const added = registry.mutate({ action: 'add', workspacePath: String.raw`C:\repo` });
  mkdirSync(added.memoryRoot, { recursive: true });
  writeFileSync(join(added.memoryRoot, 'keep.md'), 'keep');
  registry.mutate({ action: 'rename', id: added.id, name: 'Custom' });
  registry.mutate({ action: 'pin', id: added.id, pinned: true });
  assert.equal(registry.get(added.id).name, 'Custom');
  assert.equal(registry.get(added.id).pinned, true);
  registry.mutate({ action: 'remove', id: added.id });
  assert.equal(registry.get(added.id), null);
  assert.equal(existsSync(join(projectsRoot, added.id, 'memory', 'keep.md')), true);
});

test('corrupt registry is backed up before replacement', (t) => {
  const { registry, registryPath } = fixture(t, [777]);
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, '{broken');
  assert.deepEqual(registry.list(), []);
  assert.equal(readFileSync(join(dirname(registryPath), 'workspaces.corrupt.777.json'), 'utf8'), '{broken');
  assert.deepEqual(stored(registryPath), { version: 1, workspaces: [] });
});

test('each mutation re-reads and merges changes written by another registry instance', (t) => {
  const { registryPath, projectsRoot } = fixture(t);
  const a = makeWorkspaceRegistry({ registryPath, projectsRoot, profile: 'one', now: () => 100 });
  const b = makeWorkspaceRegistry({ registryPath, projectsRoot, profile: 'two', now: () => 200 });
  a.upsertVerified(String.raw`C:\alpha`);
  b.upsertVerified(String.raw`C:\beta`);
  assert.deepEqual(a.list().map(x => x.id).sort(), ['C--alpha', 'C--beta']);
});
