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
    const run = () => { const e = new Error('script failed (1): broken links'); e.status = 1; e.stderr = 'broken links'; throw e; };
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

test('write: index-sync 真实失败（exit-2）向上传播', () => {
  const d = mkdtempSync(join(tmpdir(), 'mem-svc-'));
  try {
    const run = () => { const e = new Error('script failed (2): boom'); e.status = 2; e.stderr = 'boom'; throw e; };
    const svc = makeMemoryService({ memoryRoot: d, scriptsDir: 'S', node: 'node', run });
    const draft = { relPath: 'a/b.md', content: '# B\n' };
    assert.throws(() => svc.write(draft), /script failed \(2\)/);
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

test('runScript: spawn 失败报告 r.error 而非 (null)', () => {
  assert.throws(() => runScript('definitely-not-a-real-node-exe', 'x.mjs', []), /script spawn failed/);
});

test('memoryRoot getter is resolved on each search/write/health call', () => {
  const d1 = mkdtempSync(join(tmpdir(), 'mem-root-a-'));
  const d2 = mkdtempSync(join(tmpdir(), 'mem-root-b-'));
  try {
    let root = d1;
    const calls = [];
    const run = (node, script, args) => {
      calls.push({ script, args: args.slice() });
      return JSON.stringify({ ok: true });
    };
    const svc = makeMemoryService({ memoryRoot: () => root, scriptsDir: 'S', node: 'node', run });
    svc.search('q', 1);
    assert.equal(calls[0].args[0], d1);
    root = d2;
    svc.search('q', 1);
    assert.equal(calls[1].args[0], d2);
    svc.health();
    assert.equal(calls[2].args[0], d2);
    svc.write({ relPath: 'n.md', content: '# n\n' });
    assert.equal(calls[3].args[1], d2);
    assert.equal(readFileSync(join(d2, 'n.md'), 'utf8'), '# n\n');
  } finally {
    rmSync(d1, { recursive: true, force: true });
    rmSync(d2, { recursive: true, force: true });
  }
});
