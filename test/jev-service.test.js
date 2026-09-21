import test from 'node:test';
import assert from 'node:assert/strict';
import { makeJevService } from '../lib/jev-service.js';

function response({ status = 200, body }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

const request = {
  state: { error: 'timeout', attempts: 3 },
  questions: {
    action: {
      type: 'choice',
      instructions: 'Choose the next action.',
      criteria: { retry: 'Retry the operation', report: 'Report the failure' },
    },
  },
};

test('Jev service sends the official System One payload and normalizes a success response', async () => {
  const timeoutCount = () => process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
  const timeoutsBefore = timeoutCount();
  const calls = [];
  const service = makeJevService({
    apiKey: 'test-key',
    model: 'jev-test',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return response({ body: {
        model: 'jev-test',
        answers: { action: { type: 'choice', choice: 'retry', confidence: 0.91, probabilities: { retry: 0.91, report: 0.09 } } },
        usage: { input_tokens: 42, output_tokens: 6 },
      } });
    },
  });

  const result = await service.decide(request);

  assert.deepEqual(result, {
    ok: true,
    model: 'jev-test',
    answers: { action: { type: 'choice', choice: 'retry', confidence: 0.91, probabilities: { retry: 0.91, report: 0.09 } } },
    usage: { input_tokens: 42, output_tokens: 6 },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: 'jev-test', ...request });
  assert.equal(timeoutCount(), timeoutsBefore);
});

test('Jev service returns an unavailable result without calling fetch when the API key is missing', async () => {
  let calls = 0;
  const service = makeJevService({ apiKey: '', fetch: async () => { calls += 1; } });
  const result = await service.decide(request);
  assert.equal(result.ok, false);
  assert.equal(result.error.category, 'missing_api_key');
  assert.equal(calls, 0);
});

test('Jev service classifies transport failures without throwing', async () => {
  const service = makeJevService({ apiKey: 'test-key', fetch: async () => { throw new Error('socket closed'); } });
  const result = await service.decide(request);
  assert.deepEqual(result, { ok: false, error: { category: 'network', message: 'socket closed' } });
});

for (const [status, category] of [[401, 'authentication'], [403, 'authentication'], [429, 'rate_limit'], [503, 'server']]) {
  test(`Jev service classifies HTTP ${status} as ${category}`, async () => {
    const service = makeJevService({ apiKey: 'test-key', fetch: async () => response({ status, body: {} }) });
    const result = await service.decide(request);
    assert.deepEqual(result, { ok: false, error: { category, message: `Jev request failed with HTTP ${status}`, status } });
  });
}

test('Jev service classifies timeout, malformed JSON, and unexpected response schema', async () => {
  const timeout = makeJevService({ apiKey: 'test-key', timeoutMs: 5, fetch: async () => new Promise(() => {}) });
  assert.equal((await timeout.decide(request)).error.category, 'timeout');

  const malformed = makeJevService({ apiKey: 'test-key', fetch: async () => response({ body: new SyntaxError('invalid JSON') }) });
  assert.equal((await malformed.decide(request)).error.category, 'malformed_response');

  const unexpected = makeJevService({ apiKey: 'test-key', fetch: async () => response({ body: { model: 'jev-test', answers: null } }) });
  assert.equal((await unexpected.decide(request)).error.category, 'unexpected_response');
});
