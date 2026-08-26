#!/usr/bin/env node
// dsh-dev-memory — end-to-end smoke (Task 9).
// Automates Phases 1-3:
//   1. load sanity: node --check lib/{index,client}.js + ESM import of the host plugin
//   2. profile composition: dsh --profile <name> --dump-config must show the
//      dev-memory row with memoryRoot/scriptsDir/maxInjectTokens/autoWriteLevels/writeConfidenceMin
//   3. functional: real dev-memory scripts against a fresh temp memory root —
//      service.search / service.write (+index-sync) / service.health, then the
//      full write-pass (runWritePass) and the audit file it must append.
//
// Prereqs (one-time): a profile with the plugin installed, e.g.
//   dsh plugin --profile devmemory-test add <repo-root>
//   # then add "@deepseek-ai/dsh-headless" to dsh.profile.bundles for a headless boot
// Env overrides: DSH_DEV_MEMORY_REPO, DSH_DEV_MEMORY_PROFILE, DSH_DEV_MEMORY_SCRIPTS, DSH_BIN.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(process.env.DSH_DEV_MEMORY_REPO ?? dirname(dirname(fileURLToPath(import.meta.url))));
const profile = process.env.DSH_DEV_MEMORY_PROFILE ?? 'devmemory-test';
const scriptsDir = process.env.DSH_DEV_MEMORY_SCRIPTS ?? join(homedir(), '.dsh', 'skills', 'dev-memory', 'scripts');
const dshBin = process.env.DSH_BIN ?? 'dsh';

let failures = 0;
const ok = (name) => console.log(`  PASS  ${name}`);
const fail = (name, detail) => { failures++; console.error(`  FAIL  ${name}: ${detail}`); };
const section = (name) => console.log(`\n== ${name} ==`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: opts.cwd ?? repoRoot, shell: opts.shell ?? false });
  return { status: r.status ?? null, error: r.error?.message ?? null, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ---- Phase 1: load sanity ---------------------------------------------------
section('Phase 1 — load sanity');
for (const f of ['lib/index.js', 'lib/client.js']) {
  const r = run(process.execPath, ['--check', join(repoRoot, f)]);
  r.status === 0 ? ok(`node --check ${f}`) : fail(`node --check ${f}`, r.stderr.trim());
}
{
  const url = pathToFileURL(join(repoRoot, 'lib', 'index.js')).href;
  const r = run(process.execPath, ['--input-type=module', '-e', `await import('${url}')`]);
  r.status === 0 ? ok('ESM import lib/index.js') : fail('ESM import lib/index.js', r.stderr.trim());
}

// ---- Phase 2: profile composition -------------------------------------------
section(`Phase 2 — profile composition (${profile})`);
{
  const r = run(dshBin, ['--profile', profile, '--dump-config'], { shell: process.platform === 'win32' });
  if (r.status !== 0) {
    fail('dump-config', r.error || (r.stderr || r.stdout).trim().slice(0, 500) || `exit ${r.status}`);
    console.error(`  hint: run: dsh plugin --profile ${profile} add ${repoRoot}`);
  } else {
    const hasRow = /^\s*-\s*id:\s*dev-memory\s*$/m.test(r.stdout) || /id:\s*dev-memory/.test(r.stdout);
    hasRow ? ok('dev-memory row present') : fail('dev-memory row present', 'id: dev-memory not found in dump');
    for (const key of ['memoryRoot', 'scriptsDir', 'maxInjectTokens', 'autoWriteLevels', 'writeConfidenceMin']) {
      new RegExp(`\\b${key}:`).test(r.stdout) ? ok(`config key ${key}`) : fail(`config key ${key}`, 'missing from dump');
    }
  }
}

// ---- Phase 3: functional ----------------------------------------------------
section('Phase 3 — functional (real scripts + temp root)');
const { makeMemoryService } = await import(pathToFileURL(join(repoRoot, 'lib', 'service.js')).href);
const { runWritePass } = await import(pathToFileURL(join(repoRoot, 'lib', 'orchestrator.js')).href);

const MEMORY_DOC = (title, fact) => [
  `# ${title}`,
  '',
  '> 状态: 已验证',
  '',
  '> 证据来源: 源码',
  '',
  '> 最近验证: 2026-08-26',
  '',
  '## 快速判断',
  '',
  fact,
  '',
  '## 关联记忆',
  '',
  '无',
  '',
  '## 待验证',
  '',
  '无',
].join('\n');

const root = mkdtempSync(join(tmpdir(), 'devmemory-e2e-'));
try {
  const service = makeMemoryService({ memoryRoot: root, scriptsDir });
  const w = service.write({ relPath: 'modules/fishing/settlement.md', content: MEMORY_DOC('结算', '结算使用金币。') });
  existsSync(w.written) ? ok('write: file exists') : fail('write: file exists', String(w.written));

  let hits;
  try { hits = service.search('结算 金币', 3); } catch (e) { hits = null; }
  (hits && typeof hits === 'object') ? ok('search: JSON parsed') : fail('search: JSON parsed', String(hits));
  console.log('  search ->', JSON.stringify(hits).slice(0, 220));

  let health;
  try { health = service.health(); } catch (e) { health = null; }
  (health && health.summary) ? ok('health: summary present') : fail('health: summary present', String(health));
  console.log('  health.summary ->', JSON.stringify(health?.summary));

  const auditPath = join(root, '.audit', 'audit.jsonl');
  const rp = await runWritePass({
    proposal: {
      module: 'fishing/currency',
      category: 'fact',
      confidence: 'high',
      evidence: ['src/settlement.lua'],
      moduleLevel: 2,
      draft: { relPath: 'modules/fishing/currency.md', content: MEMORY_DOC('货币', '金币是主货币。') },
    },
    service,
    auditPath,
    sessionId: 'e2e-smoke',
  });
  (rp.written === true) ? ok('write-pass: written') : fail('write-pass: written', JSON.stringify(rp));
  existsSync(auditPath) ? ok('audit file written') : fail('audit file written', auditPath);
  if (existsSync(auditPath)) console.log('  audit ->', readFileSync(auditPath, 'utf8').trim());
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
