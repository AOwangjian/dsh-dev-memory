import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function appendAudit(logPath, entry) {
  mkdirSync(dirname(logPath), { recursive: true });
  const stamped = { ts: Date.now(), ...entry };
  if (!Number.isFinite(stamped.ts)) stamped.ts = Date.now();
  appendFileSync(logPath, JSON.stringify(stamped) + '\n', 'utf8');
  return stamped;
}

export function readAudit(logPath, limit = 50) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
    .slice(-limit)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}
