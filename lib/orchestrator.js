import { validateProposal } from './classify.js';
import { appendAudit } from './audit.js';

function summarize(proposal) {
  const content = proposal && proposal.draft && proposal.draft.content;
  let first = '';
  if (typeof content === 'string') {
    for (const raw of content.split('\n')) {
      const t = raw.trim();
      if (t) { first = t; break; }
    }
  }
  if (first) return first.length > 48 ? first.slice(0, 48) + '…' : first;
  return [proposal.module, proposal.category].filter(Boolean).join(' · ');
}

export async function runWritePass({ proposal, service, auditPath, sessionId, autoWriteLevels, writeConfidenceMin }) {
  const v = validateProposal(proposal, { writeConfidenceMin });
  if (!v.accept) return { written: false, reason: v.reason };
  if (proposal.moduleLevel === 1) return { written: false, needsConfirm: true, reason: 'Level 1 需人工确认' };
  if (Array.isArray(autoWriteLevels) && proposal.moduleLevel != null && !autoWriteLevels.includes(proposal.moduleLevel)) {
    return { written: false, needsConfirm: true, reason: 'moduleLevel 不在 autoWriteLevels' };
  }
  const writeResult = await service.write(proposal.draft);
  const action = writeResult && (writeResult.action === 'create' || writeResult.action === 'update') ? writeResult.action : 'write';
  const entry = { sessionId, module: proposal.module, category: proposal.category, confidence: proposal.confidence, evidenceSource: proposal.evidence[0], action, relPath: proposal.draft && proposal.draft.relPath ? proposal.draft.relPath : null, summary: summarize(proposal) };
  const audit = auditPath ? appendAudit(auditPath, entry) : { ...entry, ts: Date.now() };
  return { written: true, audit };
}
