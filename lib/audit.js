import { appendFileSync, readFileSync, existsSync } from 'node:fs';

export function appendAudit(logPath, entry) {
  appendFileSync(logPath, JSON.stringify({ ts: Date.now(), ...entry }) + '\n', 'utf8');
}

export function readAudit(logPath, limit = 50) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
    .slice(-limit)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}
