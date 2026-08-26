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

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].options.name, 'settings.section');
  assert.equal(registrations[0].options.id, 'dev-memory');
  assert.equal(registrations[0].options.label, 'dev-memory');
  assert.equal(typeof registrations[0].component, 'function');
});

test('component renders through React.createElement (no JSX)', () => {
  const plugin = materialize();
  const { ctx, registrations } = makeCtx();
  plugin.apply(ctx);
  const tree = registrations[0].component();
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

