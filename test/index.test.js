// dsh-dev-memory — Task 7 wiring test (mock ctx, no real host).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
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
  assert.ok(handlers.has(contract.EVENTS.AGENT_STATUS));
  assert.ok(handlers.has(contract.EVENTS.AGENT_INBOX_INSERTED));
});

test('idle status followups a write-pass once and does not loop after that turn', () => {
  const { ctx, handlers } = makeCtx();
  plugin.apply(ctx);
  const followups = [];
  const agent = {
    id: 's1',
    inject() {},
    followup(m) { followups.push(m); },
    session: { id: 's1', header: { cwd: String.raw`D:\bydk\F20_Client\Fish20` } },
  };
  const status = () => handlers.get(contract.EVENTS.AGENT_STATUS) || [];
  for (const h of status()) h({ agent, status: 'running' });
  for (const h of status()) h({ agent, status: 'idle' });
  assert.equal(followups.length, 1);
  assert.match(followups[0].content[0].text, /memory_write/);
  for (const h of status()) h({ agent, status: 'running' });
  for (const h of status()) h({ agent, status: 'idle' });
  assert.equal(followups.length, 1, 'write-pass idle must not queue another write-pass');
  for (const h of status()) h({ agent, status: 'running' });
  for (const h of status()) h({ agent, status: 'idle' });
  assert.equal(followups.length, 2, 'a later user turn may queue another write-pass');
});

test('write-pass followup reports active until idle and stop cancels only that turn', async () => {
  const { ctx, handlers } = makeCtx();
  const routes = [];
  ctx.inject = (_deps, fn) => fn({
    effect: (cb) => cb(),
    webServer: { register(def) { routes.push(def); return () => {}; } },
  });
  plugin.apply(ctx);
  const cancels = [];
  const agent = {
    id: 's1',
    inject() {},
    followup() { return true; },
    cancel(cause) { cancels.push(cause); },
    session: { id: 's1', header: { cwd: 'C:\\ws' } },
  };
  const status = () => handlers.get(contract.EVENTS.AGENT_STATUS) || [];
  const byPath = Object.fromEntries(routes.map((r) => [r.path, r]));
  const getWrite = async () => {
    let out = '';
    await byPath['/dsh-dev-memory/session-auto-write'].handler(
      { method: 'GET', headers: {}, url: '/dsh-dev-memory/session-auto-write?sessionId=s1' },
      { writeHead() {}, end(chunk = '') { out += chunk; } },
    );
    return JSON.parse(out);
  };
  const postStop = async () => {
    let out = '';
    await byPath['/dsh-dev-memory/session-auto-write'].handler({
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:5270', host: '127.0.0.1:5270' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ sessionId: 's1', action: 'stopWritePass' })); },
    }, { writeHead() {}, end(chunk = '') { out += chunk; } });
    return JSON.parse(out);
  };
  for (const h of status()) h({ agent, status: 'running' });
  assert.equal((await getWrite()).writePass.active, false, 'ordinary user turn is not a write-pass');
  for (const h of status()) h({ agent, status: 'idle' });
  assert.equal((await getWrite()).writePass.active, true, 'queued write-pass followup is visible');
  for (const h of status()) h({ agent, status: 'running' });
  assert.equal((await getWrite()).writePass.active, true);
  const stopped = await postStop();
  assert.equal(stopped.ok, true);
  assert.equal(stopped.session.writePass.active, false);
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].kind, 'user');
  for (const h of status()) h({ agent, status: 'idle' });
  assert.equal((await getWrite()).writePass.active, false);
});

test('queued user message preempts an active write-pass without stopping plugin followups', async () => {
  const { ctx, handlers } = makeCtx();
  const routes = [];
  ctx.inject = (_deps, fn) => fn({
    effect: (cb) => cb(),
    webServer: { register(def) { routes.push(def); return () => {}; } },
  });
  plugin.apply(ctx);
  const cancels = [];
  const agent = {
    id: 's1',
    inject() {},
    followup() { return true; },
    cancel(cause) { cancels.push(cause); },
    session: { id: 's1', header: { cwd: 'C:\\ws' } },
  };
  const status = () => handlers.get(contract.EVENTS.AGENT_STATUS) || [];
  const inbox = () => handlers.get(contract.EVENTS.AGENT_INBOX_INSERTED) || [];
  const byPath = Object.fromEntries(routes.map((r) => [r.path, r]));
  const getWrite = async () => {
    let out = '';
    await byPath['/dsh-dev-memory/session-auto-write'].handler(
      { method: 'GET', headers: {}, url: '/dsh-dev-memory/session-auto-write?sessionId=s1' },
      { writeHead() {}, end(chunk = '') { out += chunk; } },
    );
    return JSON.parse(out);
  };
  for (const h of status()) h({ agent, status: 'running' });
  for (const h of status()) h({ agent, status: 'idle' });
  for (const h of status()) h({ agent, status: 'running' });
  assert.equal((await getWrite()).writePass.active, true);
  for (const h of inbox()) h({ agent, message: { source: { kind: 'plugin', plugin: 'dsh-dev-memory' } } });
  assert.equal(cancels.length, 0, 'plugin followup must not preempt itself');
  assert.equal((await getWrite()).writePass.active, true);
  for (const h of inbox()) h({ agent, message: { source: { kind: 'user' } } });
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].kind, 'user');
  assert.equal((await getWrite()).writePass.active, false);
});

test('session-start search uses the workspace name instead of the raw path', () => {
  assert.equal(plugin.searchQueryForWorkspace(String.raw`D:\bydk\F20_Client\Fish20`), 'Fish20');
  assert.doesNotMatch(plugin.searchQueryForWorkspace(String.raw`D:\bydk\F20_Client\Fish20`), /D:\\/);
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

test('apply swallows service failures and reports them on the panel snapshot', () => {
  const routes = [];
  const ctx = {
    get(key) {
      if (key === contract.SERVICES.TOOLS) return { register() { throw new Error('tools exploded'); } };
      if (key === contract.SERVICES.SYSTEM_PROMPT) return { section() { throw new Error('prompt exploded'); } };
      return undefined;
    },
    on() { throw new Error('events exploded'); },
    inject(_deps, fn) {
      return fn({
        effect: (cb) => cb(),
        webServer: { register(def) { routes.push(def); return () => {}; } },
      });
    },
  };
  assert.doesNotThrow(() => plugin.apply(ctx));
  const stateRoute = routes.find((r) => r.path === '/dsh-dev-memory/state');
  assert.ok(stateRoute, 'HTTP panel routes must still mount after a service failure');
  let body = '';
  stateRoute.handler({ method: 'GET', url: '/dsh-dev-memory/state', headers: {} }, { writeHead() {}, end(chunk = '') { body += chunk; } });
  const state = JSON.parse(body);
  assert.match(String(state.pluginError || ''), /exploded/);
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

test('autoWrite false skips write-pass section, goal reminder, and idle followup', () => {
  const { ctx, handlers, sections } = makeCtx();
  plugin.apply(ctx, { autoWrite: false });
  assert.equal(sections.length, 0, 'write-pass systemPrompt section skipped when autoWrite is off');

  const injected = [];
  const followups = [];
  const agent = {
    id: 's1',
    inject: (m) => injected.push(m),
    followup: (m) => followups.push(m),
    session: { id: 's1', header: { cwd: 'C:\\ws' } },
  };
  for (const h of handlers.get(contract.EVENTS.GOAL_CHANGED)) h({ agent, change: { operation: 'complete' } });
  assert.equal(injected.length, 0, 'goal-complete reminder skipped when autoWrite is off');
  for (const h of handlers.get(contract.EVENTS.AGENT_STATUS) || []) h({ agent, status: 'running' });
  for (const h of handlers.get(contract.EVENTS.AGENT_STATUS) || []) h({ agent, status: 'idle' });
  assert.equal(followups.length, 0, 'idle followup skipped when autoWrite is off');
});

test('autoWrite false still injects memory at session start when search hits', (t) => {
  const scriptsDir = mkdtempSync(join(tmpdir(), 'dsh-auto-write-scripts-'));
  t.after(() => rmSync(scriptsDir, { recursive: true, force: true }));
  writeFileSync(join(scriptsDir, 'search-memory.mjs'), [
    'const hits = { query: process.argv[3], results: [{ file: "plugin/overview.md", score: 1, confidence: "high" }] };',
    'process.stdout.write(JSON.stringify(hits));',
  ].join('\n'));
  const { ctx, handlers } = makeCtx();
  plugin.apply(ctx, { autoWrite: false, scriptsDir, memoryRoot: scriptsDir });
  const injected = [];
  const agent = {
    id: 's1',
    inject: (m) => injected.push(m),
    session: { id: 's1', header: { cwd: 'D:\\Projects\\dsh-dev-memory' } },
  };
  for (const h of handlers.get(contract.EVENTS.AGENT_SESSION_START)) h({ agent });
  assert.equal(injected.length, 1, 'session-start inject still runs when autoWrite is off');
  assert.match(injected[0].content[0].text, /plugin\/overview\.md/);
});

test('session autoWrite override skips idle followup for that session only', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-session-aw-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { ctx, handlers } = makeCtx();
  const routes = [];
  ctx.inject = (_deps, fn) => fn({
    effect: (cb) => cb(),
    webServer: { register(def) { routes.push(def); return () => {}; } },
  });
  plugin.apply(ctx, {
    autoWrite: true,
    sessionAutoWritePath: join(root, 'session-auto-write.json'),
    registryPath: join(root, 'workspaces.json'),
    projectsRoot: join(root, 'projects'),
    scriptsDir: join(root, 'scripts'),
  });
  mkdirSync(join(root, 'projects'), { recursive: true });
  const followups = [];
  const agentA = {
    id: 'sess-a',
    followup(m) { followups.push('a:' + m.content[0].text); },
    session: { id: 'sess-a', header: { cwd: 'C:\\ws-a', parentSession: undefined } },
  };
  const agentB = {
    id: 'sess-b',
    followup(m) { followups.push('b:' + m.content[0].text); },
    session: { id: 'sess-b', header: { cwd: 'C:\\ws-b' } },
  };
  const byPath = Object.fromEntries(routes.map((r) => [r.path, r]));
  const post = async (body) => {
    let out = '';
    await byPath['/dsh-dev-memory/session-auto-write'].handler({
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:5270', host: '127.0.0.1:5270' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
    }, { writeHead() {}, end(chunk = '') { out += chunk; } });
    return JSON.parse(out);
  };
  return post({ sessionId: 'sess-a', autoWrite: false }).then((saved) => {
    assert.equal(saved.ok, true);
    assert.equal(saved.session.autoWrite, false);
    assert.equal(saved.session.inherited, false);
    for (const h of handlers.get(contract.EVENTS.AGENT_STATUS) || []) h({ agent: agentA, status: 'running' });
    for (const h of handlers.get(contract.EVENTS.AGENT_STATUS) || []) h({ agent: agentA, status: 'idle' });
    for (const h of handlers.get(contract.EVENTS.AGENT_STATUS) || []) h({ agent: agentB, status: 'running' });
    for (const h of handlers.get(contract.EVENTS.AGENT_STATUS) || []) h({ agent: agentB, status: 'idle' });
    assert.equal(followups.some((x) => x.startsWith('a:')), false, 'overridden session must not followup');
    assert.equal(followups.some((x) => x.startsWith('b:')), true, 'other session still follows the default');
  });
});

test('child session inherits parent autoWrite override', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-session-aw-child-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'session-auto-write.json'), JSON.stringify({
    version: 1,
    sessions: { 'parent-1': { autoWrite: false } },
  }));
  const { ctx, handlers } = makeCtx();
  plugin.apply(ctx, {
    autoWrite: true,
    sessionAutoWritePath: join(root, 'session-auto-write.json'),
    registryPath: join(root, 'workspaces.json'),
    projectsRoot: join(root, 'projects'),
    scriptsDir: join(root, 'scripts'),
  });
  const followups = [];
  const child = {
    id: 'child-1',
    followup(m) { followups.push(m); },
    session: { id: 'child-1', header: { cwd: 'C:\\ws', parentSession: 'parent-1' } },
  };
  for (const h of handlers.get(contract.EVENTS.AGENT_STATUS) || []) h({ agent: child, status: 'running' });
  for (const h of handlers.get(contract.EVENTS.AGENT_STATUS) || []) h({ agent: child, status: 'idle' });
  assert.equal(followups.length, 0);
});

test('POST autoWrite unmounts and remounts the write-pass section', async () => {
  const { ctx, sections } = makeCtx();
  let live = 0;
  ctx.get = ((orig) => (key) => {
    if (key === contract.SERVICES.SYSTEM_PROMPT) {
      return {
        section(s) {
          sections.push(s);
          live += 1;
          return () => { live -= 1; };
        },
      };
    }
    return orig(key);
  })(ctx.get.bind(ctx));
  const routes = [];
  ctx.inject = (_deps, fn) => fn({
    effect: (cb) => cb(),
    webServer: { register(def) { routes.push(def); return () => {}; } },
  });
  plugin.apply(ctx);
  assert.equal(live, 1);
  const route = routes.find((r) => r.path === '/dsh-dev-memory/config');
  const post = async (body) => {
    let out = '';
    await route.handler({
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:5270', host: '127.0.0.1:5270' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
    }, { writeHead() {}, end(chunk = '') { out += chunk; } });
    return JSON.parse(out);
  };
  const off = await post({ autoWrite: false });
  assert.equal(off.config.autoWrite, false);
  assert.equal(off.config.enabled, false);
  assert.equal(live, 0);
  const on = await post({ autoWrite: true });
  assert.equal(on.config.autoWrite, true);
  assert.equal(live, 1);
});

test('auto mode waits for a live session cwd instead of using host or registry cwd', () => {
  const { ctx } = makeCtx();
  const routes = [];
  ctx.inject = (_deps, fn) => fn({
    effect: (cb) => cb(),
    webServer: { register(def) { routes.push(def); return () => {}; } },
  });
  plugin.apply(ctx);
  const stateRoute = routes.find((r) => r.path === '/dsh-dev-memory/state');
  let body = '';
  stateRoute.handler({ method: 'GET', headers: {} }, { writeHead() {}, end(chunk = '') { body += chunk; } });
  const state = JSON.parse(body);
  assert.equal(state.config.memoryRoot, null);
  assert.equal(state.config.workspacePath, null);
  assert.equal(state.config.rootMode, 'auto-waiting');
  assert.match(state.health.error, /active session workspace/i);
  assert.deepEqual(state.audit, []);
});

test('A-convention slug replaces POSIX separators without escaping the projects root', () => {
  assert.equal(plugin.slugOf('/work/app'), '-work-app');
  assert.match(plugin.deriveRoot('/work/app'), /[\\/]\.claude[\\/]projects[\\/]-work-app[\\/]memory$/);
});

test('A-convention slug also replaces underscores so F20_Client maps to F20-Client', () => {
  assert.equal(plugin.slugOf(String.raw`D:\bydk\F20_Client\Fish20`), 'D--bydk-F20-Client-Fish20');
  assert.match(plugin.deriveRoot(String.raw`D:\bydk\F20_Client\Fish20`), /[\\/]D--bydk-F20-Client-Fish20[\\/]memory$/);
});

test('session cwd becomes the A-convention memoryRoot used by the panel', () => {
  const { ctx, handlers } = makeCtx();
  const routes = [];
  ctx.inject = (_deps, fn) => fn({
    effect: (cb) => cb(),
    webServer: { register(def) { routes.push(def); return () => {}; } },
  });
  plugin.apply(ctx);

  const agent = {
    id: 's1',
    session: { id: 's1', header: { cwd: 'D:\\bydk\\F20_Client\\Fish20' } },
    inject() {},
  };
  for (const h of handlers.get(contract.EVENTS.AGENT_SESSION_START)) h({ agent });

  const stateRoute = routes.find((r) => r.path === '/dsh-dev-memory/state');
  let body = '';
  stateRoute.handler(
    { method: 'GET', headers: {} },
    { writeHead() {}, end(chunk = '') { body += chunk; } },
  );
  const state = JSON.parse(body);
  assert.match(state.config.memoryRoot, /D--bydk-F20-Client-Fish20[\\/]memory$/);
  assert.equal(state.config.workspacePath, 'D:\\bydk\\F20_Client\\Fish20');
  assert.equal(state.config.rootMode, 'auto');
});

test('empty memoryRoot override switches configured root back to automatic session cwd', async () => {
  const { ctx, handlers } = makeCtx();
  const routes = [];
  ctx.inject = (_deps, fn) => fn({
    effect: (cb) => cb(),
    webServer: { register(def) { routes.push(def); return () => {}; } },
  });
  plugin.apply(ctx, { memoryRoot: 'C:\\fixed\\memory' });
  const agent = { id: 's1', session: { id: 's1', header: { cwd: 'D:\\bydk\\F20_Client\\Fish20' } }, inject() {} };
  for (const h of handlers.get(contract.EVENTS.AGENT_SESSION_START)) h({ agent });

  const route = routes.find((r) => r.path === '/dsh-dev-memory/config');
  const chunks = [Buffer.from(JSON.stringify({ memoryRoot: '' }))];
  const request = {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:5270', host: '127.0.0.1:5270' },
    async *[Symbol.asyncIterator]() { yield* chunks; },
  };
  let body = '';
  await route.handler(request, { writeHead() {}, end(chunk = '') { body += chunk; } });
  const response = JSON.parse(body);
  assert.equal(response.config.rootMode, 'auto');
  assert.match(response.config.memoryRoot, /D--bydk-F20-Client-Fish20[\\/]memory$/);
});

test('apply still registers tools when autoWrite is false', () => {
  const { ctx, registered } = makeCtx();
  plugin.apply(ctx, { autoWrite: false });
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
  assert.deepEqual(routes.map((r) => r.path).sort(), ['/dsh-dev-memory/config', '/dsh-dev-memory/open', '/dsh-dev-memory/session-auto-write', '/dsh-dev-memory/state', '/dsh-dev-memory/workspaces']);
});

function isolatedApply(t, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ws-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { ctx, registered, handlers } = makeCtx();
  const routes = [];
  ctx.inject = (_deps, fn) => fn({
    effect: (cb) => cb(),
    webServer: { register(def) { routes.push(def); return () => {}; } },
  });
  const registryPath = join(root, 'workspaces.json');
  const projectsRoot = join(root, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  plugin.apply(ctx, { registryPath, projectsRoot, profile: 'web', scriptsDir: join(root, 'scripts'), ...extra });
  const byPath = Object.fromEntries(routes.map((r) => [r.path, r]));
  return { root, ctx, registered, handlers, byPath, registryPath, projectsRoot };
}

function getJson(route, request) {
  let body = '';
  const res = { status: 200, writeHead(status) { this.status = status; }, end(chunk = '') { body += chunk; } };
  return Promise.resolve(route.handler(request, res)).then(() => ({ status: res.status, json: body ? JSON.parse(body) : null }));
}

test('session start registers the live cwd as a verified workspace', (t) => {
  const { handlers, registryPath } = isolatedApply(t);
  const agent = { id: 's1', session: { id: 's1', header: { cwd: 'D:\\bydk\\F20_Client\\Fish20' } }, inject() {} };
  for (const h of handlers.get(contract.EVENTS.AGENT_SESSION_START) || []) h({ agent });
  const stored = JSON.parse(readFileSync(registryPath, 'utf8'));
  const row = stored.workspaces.find((x) => x.id === 'D--bydk-F20-Client-Fish20');
  assert.equal(row.verified, true);
  assert.equal(row.workspacePath, 'D:\\bydk\\F20_Client\\Fish20');
});

test('browsing another workspace does not change the active write target', async (t) => {
  const { handlers, byPath, projectsRoot } = isolatedApply(t);
  const agent = { id: 's1', session: { id: 's1', header: { cwd: 'D:\\bydk\\F20_Client\\Fish20' } }, inject() {} };
  for (const h of handlers.get(contract.EVENTS.AGENT_SESSION_START) || []) h({ agent });
  const otherId = 'D--other';
  mkdirSync(join(projectsRoot, otherId, 'memory'), { recursive: true });
  writeFileSync(join(projectsRoot, otherId, 'memory', 'note.md'), '# other');
  const listed = await getJson(byPath['/dsh-dev-memory/workspaces'], { method: 'GET', headers: {}, url: '/dsh-dev-memory/workspaces' });
  assert.equal(listed.json.activeWorkspaceId, 'D--bydk-F20-Client-Fish20');
  assert.equal((listed.json.workspaces || []).some((row) => row.id === otherId), false);
  const browse = await getJson(byPath['/dsh-dev-memory/state'], { method: 'GET', headers: {}, url: '/dsh-dev-memory/state?workspace=' + otherId });
  assert.equal(browse.status, 200);
  assert.match(browse.json.config.memoryRoot, /D--bydk-F20-Client-Fish20[\\/]memory$/);
  assert.equal(browse.json.config.workspacePath, 'D:\\bydk\\F20_Client\\Fish20');
  assert.equal(browse.json.browseWorkspaceId, otherId);
  assert.equal(browse.json.browseWorkspace.id, otherId);
  assert.match(browse.json.browseWorkspace.memoryRoot, /D--other[\\/]memory$/);
  const active = await getJson(byPath['/dsh-dev-memory/state'], { method: 'GET', headers: {}, url: '/dsh-dev-memory/state' });
  assert.match(active.json.config.memoryRoot, /D--bydk-F20-Client-Fish20[\\/]memory$/);
  assert.equal(active.json.config.workspacePath, 'D:\\bydk\\F20_Client\\Fish20');
});

test('memory tools enrich results with workspace metadata and mark lastWriteAt only on success', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ws-write-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const memoryRoot = join(root, 'isolated-memory');
  mkdirSync(memoryRoot, { recursive: true });
  writeFileSync(join(memoryRoot, 'note.md'), '# fish');
  const { registered, handlers, registryPath, byPath } = isolatedApply(t, {
    autoWriteLevels: [2, 3],
    memoryRoot,
    scriptsDir: join(homedir(), '.dsh', 'skills', 'dev-memory', 'scripts'),
  });
  const agent = { id: 's1', session: { id: 's1', header: { cwd: 'D:\\bydk\\F20_Client\\Fish20' } }, inject() {} };
  for (const h of handlers.get(contract.EVENTS.AGENT_SESSION_START) || []) h({ agent });
  const search = registered.find((d) => d.name === 'memory_search');
  const write = registered.find((d) => d.name === 'memory_write');
  const health = registered.find((d) => d.name === 'memory_health');
  search.execute = async () => ({ query: 'q', results: [{ file: 'note.md' }] });
  const originalWrite = write.execute;
  const level1 = await write.execute({
    proposal: {
      module: 'fishing/core', category: 'fact', confidence: 'high', evidence: ['a'],
      draft: { relPath: 'fishing/core.md', content: '# skipped' }, moduleLevel: 1,
    },
  }, { agent });
  assert.equal(level1.written, true);
  const pending = await getJson(byPath['/dsh-dev-memory/state'], { method: 'GET', headers: {}, url: '/dsh-dev-memory/state' });
  assert.equal((pending.json.pendingLevel1 || []).length, 0);
  const created = await originalWrite.call(write, {
    proposal: {
      module: 'fishing/core', category: 'fact', confidence: 'high', evidence: ['a'],
      draft: { relPath: 'fishing/core.md', content: '# kept' }, moduleLevel: 2,
    },
  }, { agent });
  assert.equal(created.written, true);
  assert.equal(created.workspace.id, 'D--bydk-F20-Client-Fish20');
  assert.equal(typeof created.audit.ts, 'number');
  const after = JSON.parse(readFileSync(registryPath, 'utf8')).workspaces[0].lastWriteAt;
  assert.equal(typeof after, 'number');
  const healthy = await health.execute({}, { agent });
  assert.equal(healthy.workspace.id, 'D--bydk-F20-Client-Fish20');
});

test('adding a workspace requires an existing directory', async (t) => {
  const { byPath } = isolatedApply(t);
  const missing = await getJson(byPath['/dsh-dev-memory/workspaces'], {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:5270', host: '127.0.0.1:5270', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ action: 'add', workspacePath: join(tmpdir(), 'no-such-ws') })); },
  });
  assert.equal(missing.status, 400);
});

test('removing a workspace stays gone after the next workspaces list', async (t) => {
  const { handlers, byPath, projectsRoot } = isolatedApply(t);
  const agent = { id: 's1', session: { id: 's1', header: { cwd: 'D:\\bydk\\F20_Client\\Fish20' } }, inject() {} };
  for (const h of handlers.get(contract.EVENTS.AGENT_SESSION_START) || []) h({ agent });
  mkdirSync(join(projectsRoot, 'D--bydk-F20-Client-Fish20', 'memory'), { recursive: true });
  writeFileSync(join(projectsRoot, 'D--bydk-F20-Client-Fish20', 'memory', 'keep.md'), '# keep');
  const removed = await getJson(byPath['/dsh-dev-memory/workspaces'], {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:5270', host: '127.0.0.1:5270', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ action: 'remove', id: 'D--bydk-F20-Client-Fish20' })); },
  });
  assert.equal(removed.status, 200);
  const listed = await getJson(byPath['/dsh-dev-memory/workspaces'], { method: 'GET', headers: {}, url: '/dsh-dev-memory/workspaces' });
  assert.equal(listed.status, 200);
  assert.equal((listed.json.workspaces || []).some((row) => row.id === 'D--bydk-F20-Client-Fish20'), false);
});
