// dsh-dev-memory — memory service (Task 5).
// Bridges the dev-memory CLI scripts (search-memory.mjs / health-check.mjs /
// memory-crud.mjs) behind a plain object the orchestrator consumes.
//
// NOTE: memory-crud.mjs is READ-ONLY — it has NO write subcommand. The write
// path is: write the markdown file directly, then run `index-sync` for index
// maintenance. index-sync exits non-zero when brokenLinks > 0, which is
// INFORMATIONAL (an audit finding), not a write failure — never let it fail
// the write.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { contract } from './contract.js';

// Runs a dev-memory script and returns its stdout. Throws on non-zero exit.
export function runScript(node, script, args) {
  const r = spawnSync(node, [script, ...args], { encoding: 'utf8' });
  if (r.error) {
    const err = new Error('script spawn failed: ' + r.error.message);
    err.status = null;
    err.stderr = r.stderr;
    throw err;
  }
  if (r.status !== 0) {
    const err = new Error('script failed (' + r.status + '): ' + r.stderr);
    err.status = r.status;
    err.stderr = r.stderr;
    throw err;
  }
  return r.stdout;
}

// Script names come from the interface contract (element [1] of each SCRIPTS
// entry, after the 'node' executable). Arg order/flags follow the amendment,
// NOT the contract templates — those drift: search carries an extra --explain,
// and write names a subcommand that does not exist.
const searchScript = contract.SCRIPTS.search[1]; // 'search-memory.mjs'
const crudScript = contract.SCRIPTS.write[1];    // 'memory-crud.mjs'
const healthScript = contract.SCRIPTS.health[1]; // 'health-check.mjs'

export function makeMemoryService({ memoryRoot, scriptsDir, node = 'node', run = runScript }) {
  const s = (name) => join(scriptsDir, name);
  return {
    search(query, top = 5) {
      return JSON.parse(run(node, s(searchScript), [memoryRoot, query, '--top', String(top), '--json']));
    },
    write(draft) {
      const abs = join(memoryRoot, draft.relPath);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, draft.content, 'utf8');

      let index = null;
      try {
        index = JSON.parse(run(node, s(crudScript), ['index-sync', memoryRoot, '--json']));
      } catch (err) {
        // index-sync exits 1 when brokenLinks > 0 — informational, not a write
        // failure. The file is already written; surface the null index. Any
        // other failure (exit-2, ENOENT, bad JSON) is a real error: rethrow.
        if (err && err.status === 1) return { written: abs, index: null };
        throw err;
      }
      return { written: abs, index };
    },
    health() {
      return JSON.parse(run(node, s(healthScript), [memoryRoot, '--json']));
    },
  };
}
