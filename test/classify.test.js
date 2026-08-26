import test from 'node:test';
import assert from 'node:assert';
import { validateProposal, CATEGORIES } from '../lib/classify.js';

test('接受 fact + high + 有证据 + 有模块', () => {
  const r = validateProposal({ category: 'fact', confidence: 'high', evidence: ['a.md#x'], module: 'fishing/settlement', draft: '…' });
  assert.equal(r.accept, true);
});
test('拒绝 changelog', () => {
  const r = validateProposal({ category: 'changelog', confidence: 'high', evidence: ['a'], module: 'm', draft: '' });
  assert.equal(r.accept, false);
  assert.match(r.reason, /changelog/);
});
test('拒绝 low 置信', () => {
  const r = validateProposal({ category: 'pitfall', confidence: 'low', evidence: ['a'], module: 'm', draft: '' });
  assert.equal(r.accept, false);
});
test('拒绝无证据', () => {
  const r = validateProposal({ category: 'open_question', confidence: 'medium', evidence: [], module: 'm', draft: '' });
  assert.equal(r.accept, false);
});
test('拒绝缺模块', () => {
  const r = validateProposal({ category: 'fact', confidence: 'high', evidence: ['a'], module: '', draft: '' });
  assert.equal(r.accept, false);
});
test('CATEGORIES 恰为四类', () => {
  assert.deepEqual(CATEGORIES, ['fact', 'pitfall', 'open_question', 'changelog']);
});
