import { randomUUID } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

const VERSION = 1;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRIES = 100;
const LOCK_WAIT_MS = 10;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

function emptyRegistry() { return { version: VERSION, workspaces: [] }; }
function slugOf(value) { return String(value).replace(/[:\\/]/g, '-'); }
function workspaceName(value) {
  const normalized = String(value).replace(/[\\/]+$/, '');
  return basename(normalized.replace(/\\/g, '/')) || normalized;
}
function numbers(value) { return Number.isFinite(value) ? value : null; }
function normalize(record) {
  const out = {
    id: String(record.id),
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : String(record.id),
    workspacePath: typeof record.workspacePath === 'string' ? record.workspacePath : null,
    memoryRoot: String(record.memoryRoot),
    verified: record.verified === true,
    pinned: record.pinned === true,
    firstSeenAt: numbers(record.firstSeenAt),
    lastSeenAt: numbers(record.lastSeenAt),
    lastWriteAt: numbers(record.lastWriteAt),
    sourceProfiles: [...new Set(Array.isArray(record.sourceProfiles) ? record.sourceProfiles.filter(x => typeof x === 'string') : [])].sort(),
  };
  if (record.hidden === true) out.hidden = true;
  return out;
}
function sorted(rows) {
  return [...rows].sort((a, b) => Number(b.pinned) - Number(a.pinned)
    || (b.lastWriteAt ?? -1) - (a.lastWriteAt ?? -1)
    || (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1)
    || a.id.localeCompare(b.id));
}

export function makeWorkspaceRegistry({ registryPath, projectsRoot, profile, now = Date.now }) {
  if (!registryPath || !projectsRoot) throw new TypeError('registryPath and projectsRoot are required');
  const lockPath = registryPath + '.lock';
  const previousPath = registryPath + '.previous';
  const ownerFile = join(lockPath, 'owner');

  function acquire() {
    mkdirSync(dirname(registryPath), { recursive: true });
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
      try {
        mkdirSync(lockPath);
        try { writeFileSync(ownerFile, String(process.pid)); }
        catch (error) { rmSync(lockPath, { recursive: true, force: true }); throw error; }
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) { rmSync(lockPath, { recursive: true, force: true }); continue; }
        } catch (statError) { if (statError.code !== 'ENOENT') throw statError; }
        Atomics.wait(sleeper, 0, 0, LOCK_WAIT_MS);
      }
    }
    throw new Error('workspace registry lock timeout');
  }
  function release() {
    try {
      if (readFileSync(ownerFile, 'utf8') !== String(process.pid)) return;
    } catch { return; }
    rmSync(lockPath, { recursive: true, force: true });
  }
  function parseRegistry(path) {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || parsed.version !== VERSION || !Array.isArray(parsed.workspaces)) throw new Error('invalid workspace registry schema');
    return { version: VERSION, workspaces: parsed.workspaces.filter(x => x && x.id && x.memoryRoot).map(normalize) };
  }
  function backupCorrupt(path) {
    const dir = dirname(path);
    const stamp = now();
    let dest = join(dir, `workspaces.corrupt.${stamp}.json`);
    let n = 0;
    while (existsSync(dest)) dest = join(dir, `workspaces.corrupt.${stamp}.${++n}.json`);
    copyFileSync(path, dest);
  }
  function readLatest() {
    if (!existsSync(registryPath)) {
      if (!existsSync(previousPath)) return emptyRegistry();
      try {
        const recovered = parseRegistry(previousPath);
        renameSync(previousPath, registryPath);
        return recovered;
      } catch { return emptyRegistry(); }
    }
    try {
      const current = parseRegistry(registryPath);
      rmSync(previousPath, { force: true });
      return current;
    } catch {
      backupCorrupt(registryPath);
      return emptyRegistry();
    }
  }
  function atomicWrite(data) {
    const temp = join(dirname(registryPath), `.workspaces.${process.pid}.${randomUUID()}.tmp`);
    const previous = previousPath;
    writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    let movedPrevious = false;
    try {
      rmSync(previous, { force: true });
      if (existsSync(registryPath)) { renameSync(registryPath, previous); movedPrevious = true; }
      renameSync(temp, registryPath);
      if (movedPrevious) rmSync(previous, { force: true });
    } catch (error) {
      rmSync(temp, { force: true });
      if (movedPrevious && !existsSync(registryPath) && existsSync(previous)) renameSync(previous, registryPath);
      throw error;
    }
  }
  function transaction(change = x => x) {
    acquire();
    try {
      const current = readLatest();
      const next = change(current) || current;
      next.version = VERSION;
      next.workspaces = next.workspaces.map(normalize);
      atomicWrite(next);
      return sorted(next.workspaces.filter(x => x.hidden !== true));
    } finally { release(); }
  }
  function ensureFile() {
    return transaction(current => current);
  }
  function mergeRecord(data, incoming) {
    const index = data.workspaces.findIndex(x => x.id === incoming.id);
    if (index < 0) data.workspaces.push(incoming);
    else {
      const old = data.workspaces[index];
      const discoveryCannotDowngrade = old.verified && !incoming.verified;
      const keepHidden = old.hidden === true && incoming.verified !== true;
      data.workspaces[index] = { ...old, ...incoming,
        name: old.name && old.name !== old.id ? old.name : incoming.name,
        workspacePath: discoveryCannotDowngrade ? old.workspacePath : incoming.workspacePath,
        verified: discoveryCannotDowngrade ? true : incoming.verified,
        pinned: old.pinned,
        firstSeenAt: old.firstSeenAt ?? incoming.firstSeenAt,
        lastSeenAt: keepHidden || discoveryCannotDowngrade ? old.lastSeenAt : incoming.lastSeenAt,
        lastWriteAt: old.lastWriteAt,
        sourceProfiles: [...new Set([...old.sourceProfiles, ...incoming.sourceProfiles])],
        hidden: incoming.verified === true ? false : (old.hidden === true || incoming.hidden === true),
      };
    }
  }
  function upsertVerified(workspacePath) {
    if (typeof workspacePath !== 'string' || !workspacePath.trim()) throw new TypeError('workspacePath is required');
    const path = workspacePath.trim(); const id = slugOf(path); const timestamp = now();
    const rows = transaction(data => { mergeRecord(data, normalize({ id, name: workspaceName(path), workspacePath: path,
      memoryRoot: join(projectsRoot, id, 'memory'), verified: true, pinned: false, firstSeenAt: timestamp,
      lastSeenAt: timestamp, lastWriteAt: null, sourceProfiles: profile ? [profile] : [] })); return data; });
    return rows.find(x => x.id === id);
  }
  return {
    list: ensureFile,
    scan() {
      const timestamp = now();
      return transaction(data => {
        if (!existsSync(projectsRoot)) return data;
        for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
          const memoryRoot = join(projectsRoot, entry.name, 'memory');
          if (!entry.isDirectory() || !existsSync(memoryRoot)) continue;
          mergeRecord(data, normalize({ id: entry.name, name: entry.name, workspacePath: null, memoryRoot,
            verified: false, pinned: false, firstSeenAt: timestamp, lastSeenAt: timestamp, lastWriteAt: null,
            sourceProfiles: profile ? [profile] : [] }));
        }
        return data;
      });
    },
    upsertVerified,
    markWrite(id) {
      const timestamp = now();
      const rows = transaction(data => { const row = data.workspaces.find(x => x.id === id); if (!row) throw new Error('unknown workspace: ' + id); row.lastWriteAt = timestamp; return data; });
      return rows.find(x => x.id === id);
    },
    mutate(command = {}) {
      if (command.action === 'add') return upsertVerified(command.workspacePath);
      let result = null;
      transaction(data => {
        const index = data.workspaces.findIndex(x => x.id === command.id);
        if (index < 0) throw new Error('unknown workspace: ' + command.id);
        if (command.action === 'remove') { data.workspaces[index].hidden = true; return data; }
        if (command.action === 'rename') {
          if (typeof command.name !== 'string' || !command.name.trim()) throw new TypeError('name is required');
          data.workspaces[index].name = command.name.trim();
        } else if (command.action === 'pin') data.workspaces[index].pinned = command.pinned === true;
        else throw new Error('unknown workspace mutation: ' + command.action);
        result = normalize(data.workspaces[index]); return data;
      });
      return result;
    },
    get(id) { return ensureFile().find(x => x.id === id) || null; },
  };
}
