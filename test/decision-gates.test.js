import test from 'node:test';
import assert from 'node:assert/strict';
import { gateHealth, gateRetrieval, gateWrite } from '../lib/decision-gates.js';

test('retrieval gate keeps only candidates Jev marks relevant and fails open', async () => {
  const hits = { results: [{ file: 'network.md' }, { file: 'ui.md' }] };
  const service = { decide: async () => ({ ok: true, answers: { candidate_0: { noul: 0.93 }, candidate_1: { noul: 0.08 } } }) };
  const gated = await gateRetrieval({ service, query: 'network retry policy', hits });
  assert.deepEqual(gated.results, [{ file: 'network.md' }]);
  assert.deepEqual(gated.decision, { gated: true, candidateCount: 2, kept: 1, fallback: false });

  const fallback = await gateRetrieval({ service: { decide: async () => ({ ok: false }) }, query: 'q', hits });
  assert.deepEqual(fallback.results, hits.results);
  assert.deepEqual(fallback.decision, { gated: false, candidateCount: 2, kept: 2, fallback: true });
});

test('write gate allows write by default on failure and honors an explicit skip', async () => {
  const proposal = { module: 'network', category: 'pitfall', confidence: 'high', evidence: ['test'], draft: { relPath: 'network.md', content: '# Retry' } };
  const skip = await gateWrite({ service: { decide: async () => ({ ok: true, answers: { action: { choice: 'skip', confidence: 0.9 } } }) }, proposal });
  assert.equal(skip.allow, false);
  assert.equal(skip.choice, 'skip');

  const fallback = await gateWrite({ service: { decide: async () => ({ ok: false }) }, proposal });
  assert.equal(fallback.allow, true);
  assert.equal(fallback.gated, false);
});

test('health gate adds a non-blocking priority decision', async () => {
  const health = { summary: { markdownFiles: 9 }, issues: { brokenLinks: ['a.md'] } };
  const gated = await gateHealth({ service: { decide: async () => ({ ok: true, answers: { needs_attention: { noul: 0.88 } } }) }, health });
  assert.deepEqual(gated, { ...health, decision: { gated: true, needsAttention: 0.88 } });
});
