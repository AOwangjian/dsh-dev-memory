import test from 'node:test';
import assert from 'node:assert/strict';
import { makeJevTool } from '../lib/jev-tool.js';

test('jev_decide exposes a strict structured-decision schema and delegates to the service', async () => {
  const calls = [];
  const observations = [];
  const tool = makeJevTool({
    service: { decide: async (args) => { calls.push(args); return { ok: true, answers: { retry: { confidence: 0.91 } } }; } },
    onResult: (event) => observations.push(event),
  });
  assert.equal(tool.name, 'jev_decide');
  assert.equal(tool.parameters.type, 'object');
  assert.deepEqual(tool.parameters.required, ['state', 'questions']);
  assert.match(tool.description, /bounded choices/i);

  const args = {
    state: 'Three connection timeouts during login.',
    questions: { retry: { type: 'noul', instructions: 'Should this request be retried?' } },
  };
  const result = await tool.execute(args);
  assert.deepEqual(result.ok, true);
  assert.deepEqual(result.answers, { retry: { confidence: 0.91 } });
  assert.deepEqual(result.telemetry.decisionTypes, ['noul']);
  assert.equal(result.telemetry.success, true);
  assert.deepEqual(result.telemetry.confidence, { retry: 0.91 });
  assert.equal(typeof result.telemetry.latencyMs, 'number');
  assert.equal('errorCategory' in result.telemetry, false);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.deepEqual(calls, [args]);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].event, 'jev_tool_called');
  assert.deepEqual(observations[0].decisionTypes, ['noul']);
  assert.equal(observations[0].success, true);
  assert.deepEqual(observations[0].confidence, { retry: 0.91 });
  assert.equal(typeof observations[0].latencyMs, 'number');
});

test('jev_decide normalizes Choice candidate arrays and keeps unavailable output lossless JSON', async () => {
  const calls = [];
  const tool = makeJevTool({ service: { decide: async (args) => { calls.push(args); return { ok: false, error: { category: 'rate_limit', message: 'slow down' } }; } } });
  const result = await tool.execute({
    state: 'Login timed out three times and the network recovered.',
    questions: { action: { type: 'choice', instructions: 'Choose the next action.', criteria: ['retry', 'abort', 'report'] } },
  });
  assert.deepEqual(calls[0].questions.action.criteria, {
    retry: 'retry',
    abort: 'abort',
    report: 'report',
  });
  assert.equal(result.telemetry.errorCategory, 'rate_limit');
  assert.doesNotThrow(() => JSON.stringify(result));
  const schema = tool.parameters.properties.questions.additionalProperties;
  assert.equal(schema.oneOf.length, 3);
  assert.deepEqual(schema.oneOf[0].required, ['type', 'instructions', 'criteria']);
});

test('jev_decide rejects malformed structured-decision input before calling the service', async () => {
  const tool = makeJevTool({ service: { decide: async () => { throw new Error('must not run'); } } });
  await assert.rejects(() => tool.execute({ state: '', questions: {} }), /jev_decide.state/);
  await assert.rejects(() => tool.execute({ state: 'x', questions: { route: { type: 'choice', instructions: 'route' } } }), /criteria/);
  await assert.rejects(() => tool.execute({ state: 'x', questions: { route: { type: 'freeform', instructions: 'route' } } }), /type/);
});
