import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeMemoryService, runScript } from '../lib/service.js';

test('search: run 被精确调用且解析 JSON', () => {
  const calls = [];
  const run = (node, script, args) => {
    calls.push({ node, script, args });
    return JSON.stringify({ hits: [{ file: 'a.md', score: 0.9 }] });
  };
  const svc = makeMemoryService({ memoryRoot: 'M', scriptsDir: 'S', node: 'node', run });
  const out = svc.search('结算 金币', 5);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['M', '结算 金币', '--top', '5', '--json']);
  assert.equal(calls[0].script, join('S', 'search-memory.mjs'));
  assert.deepEqual(out, { hits: [{ file: 'a.md', score: 0.9 }] });
});

test('write: 落盘到正确路径且 index-sync 被调用', () => {
  const d = mkdtempSync(join(tmpdir(), 'mem-svc-'));
  try {
    const calls = [];
    const indexPayload = { subcommand: 'index-sync', memoryRoot: d, result: { totalFiles: 1, indexedTargets: 0, orphans: [], brokenLinks: [] } };
    const run = (node, script, args) => {
      calls.push({ node, script, args });
      return JSON.stringify(indexPayload);
    };
    const svc = makeMemoryService({ memoryRoot: d, scriptsDir: 'S', node: 'node', run });
    const draft = { relPath: 'modules/gameplay/pitfalls.md', content: '# Pitfalls\n\n一些踩坑。\n' };
    const r = svc.write(draft);

    assert.equal(readFileSync(join(d, 'modules', 'gameplay', 'pitfalls.md'), 'utf8'), draft.content);
    assert.equal(r.written, join(d, 'modules', 'gameplay', 'pitfalls.md'));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ['index-sync', d, '--json']);
    assert.equal(calls[0].script, join('S', 'memory-crud.mjs'));
    assert.deepEqual(r.index, indexPayload);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('write: index-sync 非零退出不使写失败', () => {
  const d = mkdtempSync(join(tmpdir(), 'mem-svc-'));
  try {
    const run = () => { throw new Error('script failed (1): broken links'); };
    const svc = makeMemoryService({ memoryRoot: d, scriptsDir: 'S', node: 'node', run });
    const draft = { relPath: 'a/b.md', content: '# B\n' };
    const r = svc.write(draft);

    assert.equal(readFileSync(join(d, 'a', 'b.md'), 'utf8'), draft.content);
    assert.equal(r.index, null);
    assert.equal(r.written, join(d, 'a', 'b.md'));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('health: run 被精确调用且解析 JSON', () => {
  const calls = [];
  const run = (node, script, args) => {
    calls.push({ node, script, args });
    return JSON.stringify({ ok: true, issues: [] });
  };
  const svc = makeMemoryService({ memoryRoot: 'M', scriptsDir: 'S', node: 'node', run });
  const out = svc.health();

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['M', '--json']);
  assert.equal(calls[0].script, join('S', 'health-check.mjs'));
  assert.deepEqual(out, { ok: true, issues: [] });
});

test('runScript: 非零退出抛错', () => {
  const d = mkdtempSync(join(tmpdir(), 'mem-svc-exit-'));
  try {
    const script = join(d, 'exit1.mjs');
    writeFileSync(script, 'process.exit(1);\n', 'utf8');
    assert.throws(() => runScript(process.execPath, script, []), /script failed \(1\)/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
