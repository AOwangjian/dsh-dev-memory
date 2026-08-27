// dsh-dev-memory - Task 8 client bundle test (mock browser seam + mock ctx).
import test from 'node:test';
import assert from 'node:assert/strict';

// ---- mock the browser module-loader seam BEFORE the bundle evaluates ----
let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(registration) { captured = registration; },
  },
};

const fakeReact = {
  createElement(type, props, ...children) { return { type, props, children }; },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}]; },
  useEffect() {},
};

await import('../lib/client.js');

function materialize() {
  assert.ok(captured, 'bundle registered a factory via window.__ModuleLoader__.load');
  assert.equal(captured.id, 'dsh-dev-memory');
  const plugin = captured.factory((spec) => {
    if (spec === 'react') return fakeReact;
    throw new Error('unexpected require: ' + spec);
  });
  assert.equal(typeof plugin.apply, 'function');
  return plugin;
}

function makeCtx() {
  const registrations = [];
  const ctx = {
    slots: {
      inject(_key, callback) {
        const disposer = callback();
        assert.equal(typeof disposer, 'function', 'inject callback returned a disposer');
        return () => {};
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {}; // disposer
      },
    },
  };
  return { ctx, registrations };
}

test('registers a settings.section panel named dev-memory', () => {
  const plugin = materialize();
  assert.equal(plugin.name, 'dsh-dev-memory');
  assert.deepEqual(plugin.inject, ['slots']);

  const { ctx, registrations } = makeCtx();
  assert.doesNotThrow(() => plugin.apply(ctx));

  const section = registrations.find((row) => row.options.name === 'settings.section');
  assert.ok(section);
  assert.equal(section.options.id, 'dev-memory');
  assert.equal(section.options.label, 'dev-memory');
  assert.equal(typeof section.component, 'function');
});

test('component renders through React.createElement (no JSX)', () => {
  const plugin = materialize();
  const { ctx, registrations } = makeCtx();
  plugin.apply(ctx);
  const section = registrations.find((row) => row.options.name === 'settings.section');
  const tree = section.component();
  assert.equal(tree.type, 'div');
  assert.equal(tree.props['data-dev-memory'], 'review-panel');
});

test('apply no-throws when slots service is absent', () => {
  const plugin = materialize();
  assert.doesNotThrow(() => plugin.apply({}));
  assert.doesNotThrow(() => plugin.apply({ get: () => undefined }));
  assert.doesNotThrow(() => plugin.apply({ slots: {} })); // no inject/register
});

test('imports cleanly without a browser global (importability)', async () => {
  const had = globalThis.window;
  delete globalThis.window;
  try {
    await assert.doesNotReject(() => import('../lib/client.js?fresh=' + Date.now()));
  } finally {
    globalThis.window = had;
  }
});

test('panel source fetches /dsh-dev-memory/state and posts /config', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../lib/client.js'), 'utf8');
  assert.match(src, /\/dsh-dev-memory\/state/);
  assert.match(src, /fetch\(['"]\/dsh-dev-memory\/config['"]/);
  assert.match(src, /browseStateUrl/);
  assert.match(src, /useState/);
  assert.match(src, /useEffect/);
  assert.match(src, /8000/);
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /^\s*export\s/m);
});


test('health issue objects render a readable file/detail instead of [object Object]', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../lib/client.js'), 'utf8');
  const sandbox = { module: { exports: {} }, exports: {} };
  runInNewContext(src, sandbox);
  const format = sandbox.module.exports.formatIssueValue;
  assert.equal(typeof format, 'function');
  assert.equal(format({ file: 'fishing/core/a.md', meta: '缺少状态' }), 'fishing/core/a.md — 缺少状态');
  assert.notEqual(format({ file: 'a.md' }), '[object Object]');
});

test('panel exposes automatic root mode and workspace source', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../lib/client.js'), 'utf8');
  assert.match(src, /rootMode/);
  assert.match(src, /workspacePath/);
  assert.match(src, /恢复自动/);
  assert.match(src, /memoryRoot:s*''/);
  assert.match(src, /auto-waiting/);
  assert.match(src, /等待活跃会话工作区/);
});

test('change-log helpers provide action labels, local timestamps, and relative time', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../lib/client.js'), 'utf8');
  const sandbox = { module: { exports: {} }, exports: {} };
  runInNewContext(src, sandbox);
  const api = sandbox.module.exports;
  assert.equal(JSON.stringify(api.actionPresentation('create')), JSON.stringify({ icon: '+', label: '新增', tone: 'create' }));
  assert.equal(JSON.stringify(api.actionPresentation('update')), JSON.stringify({ icon: '✎', label: '更新', tone: 'update' }));
  assert.equal(JSON.stringify(api.actionPresentation('write')), JSON.stringify({ icon: '•', label: '写入', tone: 'write' }));
  assert.equal(api.formatLocalTime(Date.UTC(2026, 7, 27, 7, 42, 7), 0), '2026-08-27 07:42:07');
  assert.equal(api.formatRelativeTime(1000, 31_000), '刚刚');
  assert.equal(api.formatRelativeTime(1000, 181_000), '3 分钟前');
});

test('panel source includes card layout, status switch, button interaction, and save feedback', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../lib/client.js'), 'utf8');
  assert.match(src, /dm-card/);
  assert.match(src, /dm-status-dot/);
  assert.match(src, /dm-switch/);
  assert.match(src, /:hover/);
  assert.match(src, /:active/);
  assert.match(src, /保存中/);
  assert.match(src, /已保存/);
  assert.match(src, /change-time/);
});

function loadClientExports() {
  return import('node:fs').then(async ({ readFileSync }) => {
    const { runInNewContext } = await import('node:vm');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../lib/client.js'), 'utf8');
    const sandbox = { module: { exports: {} }, exports: {} };
    runInNewContext(src, sandbox);
    return sandbox.module.exports;
  });
}

test('workspace helpers filter, label, and keep browse URLs read-only', async () => {
  const api = await loadClientExports();
  const rows = [
    { id: 'D--fish', name: 'Fish20', verified: true, pinned: true, workspacePath: 'D:\\fish' },
    { id: 'D--other', name: 'Other', verified: false, pinned: false, workspacePath: null },
  ];
  assert.deepEqual(api.filterWorkspaces(rows, 'fish').map((x) => x.id), ['D--fish']);
  assert.equal(api.workspaceStatusLabel(rows[0], 'D--fish'), '当前会话');
  assert.equal(api.workspaceStatusLabel(rows[1], 'D--fish'), '仅发现记忆库');
  assert.equal(api.browseStateUrl('D--other'), '/dsh-dev-memory/state?workspace=D--other');
  assert.equal(api.browseStateUrl(''), '/dsh-dev-memory/state');
});

test('panel source loads workspaces and never posts browse selection to /config', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../lib/client.js'), 'utf8');
  assert.match(src, /\/dsh-dev-memory\/workspaces/);
  assert.match(src, /当前会话写入/);
  assert.match(src, /当前面板浏览/);
  assert.match(src, /browseWorkspaceId/);
  assert.match(src, /state\?workspace=/);
  assert.match(src, /action:'pin'/);
  assert.match(src, /action:'rename'/);
  assert.match(src, /action:'remove'/);
  assert.match(src, /打开工作目录/);
  assert.match(src, /打开记忆目录/);
  assert.match(src, /\/dsh-dev-memory\/open/);
  assert.doesNotMatch(src, /postConfig\(\{[^}]*workspace/);
});

test('memory tool cards parse search, write, and health blocks', async () => {
  const api = await loadClientExports();
  const search = api.memoryToolCardModel('memory_search', {
    kind: 'result',
    call: { argsRaw: JSON.stringify({ query: 'Fish20', top: 2 }) },
    output: JSON.stringify({ query: 'Fish20', results: [{ file: 'a.md' }, { file: 'b.md' }], workspace: { name: 'Fish20', memoryRoot: 'C:\\mem' } }),
  });
  assert.equal(search.title, '查询项目记忆');
  assert.equal(search.state, 'ok');
  assert.equal(search.count, 2);
  assert.equal(JSON.stringify(search.files), JSON.stringify(['a.md', 'b.md']));
  assert.equal(search.memoryRoot, 'C:\\mem');
  const write = api.memoryToolCardModel('memory_write', {
    kind: 'result',
    call: { argsRaw: JSON.stringify({ proposal: { module: 'fishing/core', category: 'fact', confidence: 'high', evidence: ['src'], draft: { relPath: 'fishing/core.md' } } }) },
    output: JSON.stringify({ written: true, audit: { action: 'update', relPath: 'fishing/core.md', summary: '补充回收时序', module: 'fishing/core', category: 'fact', confidence: 'high', evidenceSource: 'src', ts: 1 }, workspace: { id: 'D--fish', name: 'Fish20', memoryRoot: 'C:\\mem' } }),
  });
  assert.equal(write.title, '更新项目记忆');
  assert.equal(write.file, 'fishing/core.md');
  assert.equal(write.workspaceName, 'Fish20');
  assert.equal(write.module, 'fishing/core');
  assert.equal(write.category, 'fact');
  assert.equal(write.confidence, 'high');
  assert.equal(write.evidence, 'src');
  assert.equal(write.ts, 1);
  const health = api.memoryToolCardModel('memory_health', {
    kind: 'result',
    output: JSON.stringify({ summary: { directories: 4, markdownFiles: 17, memoryIndexExists: true, severityCounts: { high: 2, medium: 2, low: 11 } }, issues: { brokenLinks: [1, 2] }, workspace: { name: 'Fish20' } }),
  });
  assert.match(health.summary, /17/);
  assert.equal(health.directories, 4);
  assert.equal(health.index, true);
  assert.equal(health.issueCount, 2);
});

function collectText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (typeof node === 'object') {
    const kids = node.children || (node.props && node.props.children) || [];
    return collectText(Array.isArray(kids) ? kids : [kids]);
  }
  return '';
}

test('apply never throws on undeclared Cordis properties and keeps the settings panel', () => {
  const plugin = materialize();
  assert.deepEqual(plugin.inject, ['slots']);
  const registrations = [];
  const target = {
    slots: {
      inject(_key, callback) {
        const value = callback();
        return typeof value === 'function' ? value : () => {};
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
    get(name) {
      if (name === 'slots') return this.slots;
      throw new Error(`cannot get property "${name}" without inject`);
    },
  };
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (typeof prop === 'symbol') return obj[prop];
      if (prop === 'get' || prop === 'inject' || prop === 'on') return obj[prop];
      if (!plugin.inject.includes(String(prop))) {
        throw new Error(`cannot get property "${String(prop)}" without inject`);
      }
      return obj[prop];
    },
  });
  assert.doesNotThrow(() => plugin.apply(ctx));
  const section = registrations.find((row) => row.options.name === 'settings.section');
  assert.ok(section, 'settings panel must still register when conversationEvents is unavailable');
  const tail = registrations.find((row) => row.options.name === 'conversation.chat.turnTail');
  assert.equal(tail, undefined);
});

test('optional conversation wiring failures surface in the panel instead of crashing apply', () => {
  const plugin = materialize();
  const registrations = [];
  const ctx = {
    slots: {
      inject(_key, callback) {
        const value = callback();
        return typeof value === 'function' ? value : () => {};
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
    get(name) {
      if (name === 'slots') return this.slots;
      if (name === 'conversationEvents') {
        return { register() { throw new Error('cannot get property "conversationEvents" without inject'); } };
      }
      return undefined;
    },
  };
  assert.doesNotThrow(() => plugin.apply(ctx));
  const section = registrations.find((row) => row.options.name === 'settings.section');
  assert.ok(section);
  const tree = section.component();
  const text = collectText(tree);
  assert.match(text, /conversationEvents/);
  assert.match(text, /without inject/);
});

test('registers memory toolviews and a turn-tail selector for successful writes', () => {
  const plugin = materialize();
  const registrations = [];
  const events = [];
  const ctx = {
    slots: {
      inject(_key, callback) {
        const value = callback();
        if (typeof value === 'function') return value;
        return () => {};
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
    conversationEvents: { register(def) { events.push(def); } },
    get(name) {
      if (name === 'slots') return this.slots;
      if (name === 'conversationEvents') return this.conversationEvents;
      return undefined;
    },
  };
  plugin.apply(ctx);
  const keys = registrations.map((row) => row.options.key).filter(Boolean);
  assert.deepEqual(keys.filter((k) => String(k).startsWith('memory_')).sort(), ['memory_health', 'memory_search', 'memory_write']);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'dev-memory-writes');
  const tail = registrations.find((row) => row.options.name === 'conversation.chat.turnTail');
  assert.ok(tail);
  assert.equal(typeof tail.options.select, 'function');
  assert.equal(tail.options.select({ turn: { data: { get: () => ({ writes: [] }) } }, seq: 9 }), null);
});

test('turn accumulator keeps successful create/update writes and ignores search or errors', async () => {
  const api = await loadClientExports();
  const def = api.memoryWriteEventDefinition;
  let state = def.start({}, { event: { type: 'turn/start', data: { turn: 3 } } });
  state = def.update({ state }, { event: { type: 'tool/call', data: { turn: 3, callId: '1', name: 'memory_write', argsRaw: JSON.stringify({ proposal: { draft: { relPath: 'a.md' } } }) } } });
  state = def.update({ state }, { event: { type: 'tool/result', data: { turn: 3, message: { source: { callId: '1' }, content: [{ isError: false, text: JSON.stringify({ written: true, audit: { action: 'create', relPath: 'a.md', summary: 'new' } }) }] } }, seq: 4 } });
  state = def.update({ state }, { event: { type: 'tool/call', data: { turn: 3, callId: '2', name: 'memory_search', argsRaw: '{}' } } });
  state = def.update({ state }, { event: { type: 'tool/result', data: { turn: 3, message: { source: { callId: '2' }, content: [{ isError: false, text: '{}' }] } }, seq: 5 } });
  state = def.update({ state }, { event: { type: 'tool/result', data: { turn: 3, message: { source: { callId: '1' }, content: [{ isError: true, text: 'nope' }] } }, seq: 6 } });
  const selected = api.selectMemoryWrites({ turn: { data: { get: () => state } }, seq: 9 });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].action, 'create');
  assert.equal(selected[0].relPath, 'a.md');
});
