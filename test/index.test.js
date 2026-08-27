// dsh-dev-memory — Task 7 wiring test (mock ctx, no real host).
import test from 'node:test';
import assert from 'node:assert/strict';
import { contract } from '../lib/contract.js';

const plugin = await import('../lib/index.js');

function makeCtx() {
  const registered = [];
  const sections = [];
  const handlers = new Map();
  const ctx = {
    config: {},
    get(key) {
      if (key === contract.SERVICES.TOOLS) return { register: (d) => { registered.push(d); return () => {}; } };
      if (key === contract.SERVICES.SYSTEM_PROMPT) return { section: (s) => { sections.push(s); return () => {}; } };
      if (key === contract.SERVICES.WORKSPACE_REGISTRY) return { list: () => [{ path: 'C:\\fake\\ws' }] };
      return undefined;
    },
    on(event, handler) {
      const list = handlers.get(event);
      if (list) list.push(handler); else handlers.set(event, [handler]);
      return () => {};
    },
  };
  return { ctx, registered, sections, handlers };
}

test('imports with no side effects and exposes the plugin shape', () => {
  assert.equal(plugin.name, 'dsh-dev-memory');
  assert.deepEqual(plugin.inject, ['tools', 'systemPrompt']);
  assert.equal(typeof plugin.apply, 'function');
  assert.equal(plugin.default.name, 'dsh-dev-memory');
  assert.equal(plugin.default.apply, plugin.apply);
});

test('apply registers 3 tools via ctx.tools.register and the write-pass section', () => {
  const { ctx, registered, sections } = makeCtx();
  assert.doesNotThrow(() => plugin.apply(ctx));

  assert.deepEqual(registered.map((d) => d.name).sort(), ['memory_health', 'memory_search', 'memory_write']);
  for (const d of registered) {
    assert.equal(typeof d.execute, 'function');
    assert.equal(typeof d.output.render, 'function');
    assert.equal(d.parameters.type, 'object');
    assert.ok(Array.isArray(d.output.render(undefined, { ok: 1 })));
  }

  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, 'dev-memory:write-pass');
  assert.equal(typeof sections[0].order, 'number');
  assert.equal(typeof sections[0].text, 'string');
});

test('hooks the 3 mapped events', () => {
  const { ctx, handlers } = makeCtx();
  plugin.apply(ctx);
  assert.ok(handlers.has(contract.EVENTS.AGENT_SESSION_START));
  assert.ok(handlers.has(contract.EVENTS.GOAL_CHANGED));
  assert.ok(handlers.has(contract.EVENTS.SESSION_DISPOSED));
});

test('goal/changed injects a reminder only on operation === complete', () => {
  const { ctx, handlers } = makeCtx();
  plugin.apply(ctx);

  const injected = [];
  const agent = { id: 's1', inject: (m) => injected.push(m) };

  for (const h of handlers.get(contract.EVENTS.GOAL_CHANGED)) h({ agent, change: { operation: 'complete' } });
  assert.equal(injected.length, 1);
  assert.equal(injected[0].role, 'user');
  assert.equal(injected[0].content[0].type, 'text');
  assert.equal(injected[0].source.kind, 'plugin');

  for (const h of handlers.get(contract.EVENTS.GOAL_CHANGED)) h({ agent, change: { operation: 'create' } });
  assert.equal(injected.length, 1, 'non-complete operations must not inject');
});

test('apply does not throw when every service is absent', () => {
  const ctx = { config: {}, get() { return undefined; }, on() { return () => {}; } };
  assert.doesNotThrow(() => plugin.apply(ctx));
});

test('memory_search validates its args before dispatch', async () => {
  const { ctx, registered } = makeCtx();
  plugin.apply(ctx);
  const search = registered.find((d) => d.name === 'memory_search');
  await assert.rejects(search.execute({}), /memory_search\.query/);
  await assert.rejects(search.execute({ query: '' }), /memory_search\.query/);
  await assert.rejects(search.execute({ query: 'x', top: -1 }), /memory_search\.top/);
  await assert.rejects(search.execute({ query: 'x', top: 0 }), /memory_search\.top/);
  await assert.rejects(search.execute({ query: 'x', top: 2.5 }), /memory_search\.top/);
});

test('memory_write validates proposal before dispatch', async () => {
  const { ctx, registered } = makeCtx();
  plugin.apply(ctx);
  const write = registered.find((d) => d.name === 'memory_write');
  await assert.rejects(write.execute({}), /memory_write\.proposal/);
  await assert.rejects(write.execute({ proposal: null }), /memory_write\.proposal/);
  await assert.rejects(write.execute({ proposal: {} }), /memory_write\.proposal\.module/);
  await assert.rejects(write.execute({ proposal: { module: 'm', category: 'fact', confidence: 'high', evidence: [] } }), /memory_write\.proposal\.evidence/);
  await assert.rejects(write.execute({ proposal: { module: 'm', category: 'fact', confidence: 'high', evidence: ['e'] } }), /memory_write\.proposal\.draft/);
  await assert.rejects(write.execute({ proposal: { module: 'm', category: 'fact', confidence: 'high', evidence: ['e'], draft: {} } }), /memory_write\.proposal\.draft\.relPath/);
  await assert.rejects(write.execute({ proposal: { module: 'm', category: 'fact', confidence: 'high', evidence: ['e'], draft: { relPath: 'a.md' } } }), /memory_write\.proposal\.draft\.content/);
});

test('memory_write rejects missing or bogus confidence', async () => {
  const { ctx, registered } = makeCtx();
  plugin.apply(ctx);
  const write = registered.find((d) => d.name === 'memory_write');
  const base = { module: 'm', category: 'fact', evidence: ['e'], draft: { relPath: 'a.md', content: '# x' } };
  await assert.rejects(write.execute({ proposal: { ...base } }), /memory_write\.proposal\.confidence/);
  await assert.rejects(write.execute({ proposal: { ...base, confidence: '' } }), /memory_write\.proposal\.confidence/);
  await assert.rejects(write.execute({ proposal: { ...base, confidence: 'extreme' } }), /memory_write\.proposal\.confidence/);
});

test('session-start inject and goal-complete reminder skip when enabled is false', () => {
  const { ctx, handlers, sections } = makeCtx();
  plugin.apply(ctx, { enabled: false });
  assert.equal(sections.length, 0, 'write-pass systemPrompt section skipped when disabled');

  const injected = [];
  const agent = { id: 's1', inject: (m) => injected.push(m), session: { id: 's1', header: { cwd: 'C:\\ws' } } };
  for (const h of handlers.get(contract.EVENTS.AGENT_SESSION_START)) h({ agent });
  assert.equal(injected.length, 0, 'session-start inject skipped when disabled');

  for (const h of handlers.get(contract.EVENTS.GOAL_CHANGED)) h({ agent, change: { operation: 'complete' } });
  assert.equal(injected.length, 0, 'goal-complete reminder skipped when disabled');
});

test('apply still registers tools when enabled is false', () => {
  const { ctx, registered } = makeCtx();
  plugin.apply(ctx, { enabled: false });
  assert.deepEqual(registered.map((d) => d.name).sort(), ['memory_health', 'memory_search', 'memory_write']);
});

test('ctx.inject(["webServer"]) mounts state and config routes', () => {
  const { ctx } = makeCtx();
  const routes = [];
  let injected;
  ctx.inject = (deps, fn) => {
    injected = deps;
    fn({
      effect: (cb) => cb(),
      webServer: {
        register(def) {
          routes.push(def);
          return () => {};
        },
      },
    });
  };
  plugin.apply(ctx);
  assert.deepEqual(injected, ['webServer']);
  assert.deepEqual(routes.map((r) => r.path).sort(), ['/dsh-dev-memory/config', '/dsh-dev-memory/state']);
});
