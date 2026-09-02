import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const VERSION = 1;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRIES = 100;
const LOCK_WAIT_MS = 10;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

function emptyStore() {
  return { version: VERSION };
}

function normalize(raw) {
  const out = { version: VERSION };
  if (raw && typeof raw === 'object' && typeof raw.autoWrite === 'boolean') out.autoWrite = raw.autoWrite;
  return out;
}

export function makePluginConfigStore({ path }) {
  if (!path) throw new TypeError('path is required');
  const lockPath = path + '.lock';
  const previousPath = path + '.previous';
  const ownerFile = join(lockPath, 'owner');

  function acquire() {
    mkdirSync(dirname(path), { recursive: true });
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
      try {
        mkdirSync(lockPath);
        try { writeFileSync(ownerFile, String(process.pid)); }
        catch (error) { rmSync(lockPath, { recursive: true, force: true }); throw error; }
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
            rmSync(lockPath, { recursive: true, force: true });
            continue;
          }
        } catch (statError) {
          if (statError.code !== 'ENOENT') throw statError;
        }
        Atomics.wait(sleeper, 0, 0, LOCK_WAIT_MS);
      }
    }
    throw new Error('plugin config store lock timeout');
  }

  function release() {
    try {
      if (readFileSync(ownerFile, 'utf8') !== String(process.pid)) return;
    } catch { return; }
    rmSync(lockPath, { recursive: true, force: true });
  }

  function parseStore(file) {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || parsed.version !== VERSION || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid plugin config schema');
    }
    return normalize(parsed);
  }

  function readLatest() {
    if (!existsSync(path)) {
      if (!existsSync(previousPath)) return emptyStore();
      try {
        const recovered = parseStore(previousPath);
        renameSync(previousPath, path);
        return recovered;
      } catch { return emptyStore(); }
    }
    try {
      const current = parseStore(path);
      rmSync(previousPath, { force: true });
      return current;
    } catch {
      return emptyStore();
    }
  }

  function atomicWrite(data) {
    const temp = join(dirname(path), `.plugin-config.${process.pid}.${randomUUID()}.tmp`);
    writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    let movedPrevious = false;
    try {
      rmSync(previousPath, { force: true });
      if (existsSync(path)) { renameSync(path, previousPath); movedPrevious = true; }
      renameSync(temp, path);
      if (movedPrevious) rmSync(previousPath, { force: true });
    } catch (error) {
      rmSync(temp, { force: true });
      if (movedPrevious && !existsSync(path) && existsSync(previousPath)) renameSync(previousPath, path);
      throw error;
    }
  }

  return {
    read(fallbackAutoWrite) {
      const data = readLatest();
      return { autoWrite: typeof data.autoWrite === 'boolean' ? data.autoWrite : fallbackAutoWrite === true };
    },
    set(patch = {}) {
      acquire();
      try {
        const current = readLatest();
        if (typeof patch.autoWrite === 'boolean') current.autoWrite = patch.autoWrite;
        current.version = VERSION;
        atomicWrite(current);
        return { autoWrite: current.autoWrite };
      } finally { release(); }
    },
  };
}
