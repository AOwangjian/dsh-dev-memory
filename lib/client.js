/**
 * dsh-dev-memory - client review panel (Task 8).
 *
 * STATIC 'dsh.client' bundle. This file is served verbatim at
 * '/plugins/dsh-dev-memory/client.js' as a CLASSIC <script> and registered
 * through window.__ModuleLoader__.load, exactly like dsh-codex-sync's
 * lib/client.js. It is therefore NOT an ES module: no import/export
 * statements (they would be a SyntaxError under the classic-script load), and
 * React is a platform 'seed word' reached through the factory's require.
 *
 * Verified client APIs (full source evidence in task-8-report.md):
 *   - Slot registration:  ctx.slots.inject(key, () => ctx.slots.register(opts, Component))
 *       dsh-client-runtime SlotRegistry (register + inject), canonical examples
 *       in dsh-cordis-client-runner (settings.section example) and dsh-codex-sync.
 *   - React source:       require('react') - a seed word, NOT an import.
 *       dsh-codex-sync lib/client.js; dsh-client-ui-settings-plugin-inventory.
 *   - Client->Host RPC:   host.call(method, args) exists ONLY in the DYNAMIC
 *       cordis package system (closure symbol, pairs with harness.handle on the
 *       host sandbox). A STATIC dsh.client bundle has no such channel - the
 *       static ctx.remote namespaces are a fixed compiler-enforced table - so
 *       this panel is a static placeholder and RPC wiring is DEFERRED.
 */

// Minimal inline styles (theme-aware via the native alias token where available).
const PANEL_STYLE = { padding: '16px', lineHeight: '1.5' };
const TITLE_STYLE = { fontWeight: 600, marginBottom: '4px' };
const MUTED_STYLE = { color: 'var(--dsw-alias-label-secondary, #888)', fontSize: '13px' };

/**
 * Build the client plugin object. React is passed in (never imported); when it
 * is absent the component closure still registers, but rendering (which only
 * happens in a real browser where React is always a seed word) is inert.
 */
function createClientPlugin(React) {
  const h = React && typeof React.createElement === 'function' ? React.createElement : undefined;

  /** Minimal panel: a 'dev-memory' title + a 'recent writes / health' area. */
  function DevMemoryPanel() {
    return h('div', { 'data-dev-memory': 'review-panel', style: PANEL_STYLE },
      h('div', { style: TITLE_STYLE }, 'dev-memory'),
      h('div', { style: MUTED_STYLE }, 'Recent writes / health'),
      h('div', { style: { ...MUTED_STYLE, marginTop: '8px' } },
        'No data yet - a static dsh.client bundle has no client->host RPC channel.'),
      h('div', { style: MUTED_STYLE },
        'Deferred: wire the host half and pull audit/health here (see task-8-report.md).'),
    );
  }

  return {
    name: 'dsh-dev-memory',
    inject: ['slots'],
    apply(ctx) {
      // Guard: absent slots service (or React) -> return cleanly, never throw.
      const slots =
        (ctx && ctx.slots) ||
        (ctx && typeof ctx.get === 'function' ? ctx.get('slots') : undefined);
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return;

      // Level-1 gate placeholder: when a client->host RPC channel is wired, this
      // is where the panel would pull the module-creation confirmation, e.g.:
      //   host.call('dev-memory.confirm', { module: '...' })
      // (host.call is a DYNAMIC-package closure symbol; not available here.)

      slots.inject('settings.section', () => slots.register(
        {
          name: 'settings.section',
          id: 'dev-memory',
          order: 100,
          label: 'dev-memory',
        },
        DevMemoryPanel,
      ));
    },
  };
}

// Browser: register the static bundle factory with the client module loader.
if (typeof window !== 'undefined' && window.__ModuleLoader__) {
  window.__ModuleLoader__.load({
    id: 'dsh-dev-memory',
    factory: (require) => {
      let React;
      try { React = require('react'); } catch { React = undefined; }
      return createClientPlugin(React);
    },
  });
}

// Node/test seam (no browser global): expose the factory for the mock-ctx test.
// module exists only under a CommonJS load; in this package (type: module)
// the file otherwise imports with an empty namespace and no side effects.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createClientPlugin, default: createClientPlugin };
}

