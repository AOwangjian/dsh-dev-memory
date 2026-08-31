import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const VERSION = 1;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRIES = 100;
const LOCK_WAIT_MS = 10;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

function emptyStore() {
  return { version: VERSION, sessions: {} };
}

function normalizeSessions(raw) {
  const sessions = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return sessions;
  for (const [id, value] of Object.entries(raw)) {
    if (!id || !value || typeof value !== 'object' || typeof value.autoWrite !== 'boolean') continue;
    sessions[id] = { autoWrite: value.autoWrite };
  }
  return sessions;
}

export function makeSessionAutoWriteStore({ path }) {
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
    throw new Error('session auto-write store lock timeout');
  }

  function release() {
    try {
      if (readFileSync(ownerFile, 'utf8') !== String(process.pid)) return;
    } catch { return; }
    rmSync(lockPath, { recursive: true, force: true });
  }

  function parseStore(file) {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || parsed.version !== VERSION || typeof parsed.sessions !== 'object' || parsed.sessions == null || Array.isArray(parsed.sessions)) {
      throw new Error('invalid session auto-write store schema');
    }
    return { version: VERSION, sessions: normalizeSessions(parsed.sessions) };
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
    const temp = join(dirname(path), `.session-auto-write.${process.pid}.${randomUUID()}.tmp`);
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

  function transaction(change) {
    acquire();
    try {
      const current = readLatest();
      const next = change(current) || current;
      next.version = VERSION;
      next.sessions = normalizeSessions(next.sessions);
      atomicWrite(next);
      return next;
    } finally { release(); }
  }

  function lookup(data, sessionId, fallback, parentSessionId, seen = new Set()) {
    if (!sessionId) return { sessionId: sessionId || null, autoWrite: fallback, inherited: true };
    const own = data.sessions[sessionId];
    if (own && typeof own.autoWrite === 'boolean') {
      return { sessionId, autoWrite: own.autoWrite, inherited: false };
    }
    if (!parentSessionId || seen.has(parentSessionId)) {
      return { sessionId, autoWrite: fallback, inherited: true };
    }
    seen.add(parentSessionId);
    const parent = lookup(data, parentSessionId, fallback, undefined, seen);
    return { sessionId, autoWrite: parent.autoWrite, inherited: true };
  }

  return {
    resolve(sessionId, fallback, extras = {}) {
      const data = readLatest();
      return lookup(data, sessionId, fallback === true, extras.parentSessionId);
    },
    set(sessionId, autoWrite) {
      if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('sessionId is required');
      if (typeof autoWrite !== 'boolean') throw new Error('autoWrite must be a boolean');
      const id = sessionId.trim();
      transaction((data) => {
        data.sessions[id] = { autoWrite };
        return data;
      });
      return { sessionId: id, autoWrite, inherited: false };
    },
  };
}
