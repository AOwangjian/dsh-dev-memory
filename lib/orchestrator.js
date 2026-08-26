import { validateProposal } from './classify.js';
import { appendAudit } from './audit.js';

export async function runWritePass({ proposal, service, auditPath, sessionId }) {
  const v = validateProposal(proposal);
  if (!v.accept) return { written: false, reason: v.reason };
  if (proposal.moduleLevel === 1) return { written: false, needsConfirm: true, reason: 'Level 1 需人工确认' };
  await service.write(proposal.draft);
  const entry = { sessionId, module: proposal.module, category: proposal.category, confidence: proposal.confidence, evidenceSource: proposal.evidence[0], action: 'write' };
  if (auditPath) appendAudit(auditPath, entry);
  return { written: true, audit: entry };
}
