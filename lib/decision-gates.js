function resultList(hits) {
  if (Array.isArray(hits)) return hits;
  return hits && Array.isArray(hits.results) ? hits.results : [];
}

function candidateState(query, hits) {
  return JSON.stringify({
    query: String(query || '').slice(0, 240),
    candidates: hits.slice(0, 8).map((hit, index) => ({
      id: index,
      file: String(hit && (hit.file || hit.relPath || '')).slice(0, 180),
      text: String(hit && (hit.title || hit.heading || hit.summary || '')).slice(0, 240),
    })),
  });
}

export async function gateRetrieval({ service, query, hits }) {
  const candidates = resultList(hits);
  if (!service || typeof service.decide !== 'function' || candidates.length === 0) {
    return { ...(Array.isArray(hits) ? { results: hits } : hits), decision: { gated: false } };
  }
  const questions = Object.fromEntries(candidates.slice(0, 8).map((hit, index) => [
    `candidate_${index}`,
    { type: 'noul', instructions: `Is candidate ${index} relevant to the query?` },
  ]));
  try {
    const result = await service.decide({ state: candidateState(query, candidates), questions });
    if (!result || result.ok !== true || !result.answers) throw new Error('unavailable');
    const kept = candidates.filter((_hit, index) => Number(result.answers[`candidate_${index}`] && result.answers[`candidate_${index}`].noul) >= 0.5);
    return {
      ...(Array.isArray(hits) ? {} : hits),
      results: kept.length ? kept : candidates,
      decision: { gated: true, kept: kept.length || candidates.length },
    };
  } catch {
    return { ...(Array.isArray(hits) ? {} : hits), results: candidates, decision: { gated: false } };
  }
}

export async function gateWrite({ service, proposal }) {
  if (!service || typeof service.decide !== 'function') return { allow: true, gated: false };
  const state = JSON.stringify({
    module: proposal && proposal.module,
    category: proposal && proposal.category,
    confidence: proposal && proposal.confidence,
    evidenceCount: Array.isArray(proposal && proposal.evidence) ? proposal.evidence.length : 0,
    relPath: proposal && proposal.draft && proposal.draft.relPath,
    content: String(proposal && proposal.draft && proposal.draft.content || '').slice(0, 600),
  });
  try {
    const result = await service.decide({
      state,
      questions: {
        action: {
          type: 'choice',
          instructions: 'Decide whether this durable development memory should be persisted now.',
          criteria: {
            write: 'Persist the proposed durable memory.',
            skip: 'Do not persist because it is not durable or lacks evidence.',
          },
        },
      },
    });
    const answer = result && result.ok === true && result.answers && result.answers.action;
    if (!answer || typeof answer.choice !== 'string') throw new Error('unavailable');
    return { allow: answer.choice !== 'skip', gated: true, choice: answer.choice, confidence: answer.confidence };
  } catch {
    return { allow: true, gated: false };
  }
}

export async function gateHealth({ service, health }) {
  if (!service || typeof service.decide !== 'function') return health;
  const state = JSON.stringify({ summary: health && health.summary, issueGroups: Object.keys(health && health.issues || {}) });
  try {
    const result = await service.decide({
      state,
      questions: { needs_attention: { type: 'noul', instructions: 'Does this health report need agent attention now?' } },
    });
    const answer = result && result.ok === true && result.answers && result.answers.needs_attention;
    if (!answer || !Number.isFinite(answer.noul)) return health;
    return { ...health, decision: { gated: true, needsAttention: answer.noul } };
  } catch {
    return health;
  }
}
