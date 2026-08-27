/**
 * dsh-dev-memory - client review panel (PANEL v2).
 *
 * STATIC 'dsh.client' bundle. This file is served verbatim at
 * '/plugins/dsh-dev-memory/client.js' as a CLASSIC <script> and registered
 * through window.__ModuleLoader__.load. It is therefore NOT an ES module: no
 * import/export statements, and React is a platform seed word reached through
 * the factory's require.
 *
 * Host communication is same-origin HTTP (the dsh-plugin pattern):
 *   GET  /dsh-dev-memory/state
 *   POST /dsh-dev-memory/config
 * No dynamic-package / host.call RPC is used.
 */

const PANEL_STYLE = { padding: '16px', lineHeight: '1.5' };
const TITLE_STYLE = { fontWeight: 600, marginBottom: '4px' };
const MUTED_STYLE = { color: 'var(--dsw-alias-label-secondary, #888)', fontSize: '13px' };
const ROW_STYLE = { display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0', flexWrap: 'wrap' };
const LABEL_STYLE = { fontSize: '13px', minWidth: '140px', color: 'var(--dsw-alias-label-secondary, #888)' };
const VALUE_STYLE = { fontSize: '13px', wordBreak: 'break-all' };
const INPUT_STYLE = {
  flex: 1,
  minWidth: '160px',
  padding: '4px 8px',
  background: 'var(--dsw-alias-bg-primary, transparent)',
  color: 'inherit',
  border: '1px solid var(--dsw-alias-border-primary, #444)',
  borderRadius: '4px',
};
const BTN_STYLE = {
  padding: '4px 10px',
  cursor: 'pointer',
  background: 'var(--dsw-alias-bg-secondary, transparent)',
  color: 'inherit',
  border: '1px solid var(--dsw-alias-border-primary, #444)',
  borderRadius: '4px',
};

function createClientPlugin(React) {
  const h = React && typeof React.createElement === 'function' ? React.createElement : undefined;
  const useState = React && typeof React.useState === 'function' ? React.useState : undefined;
  const useEffect = React && typeof React.useEffect === 'function' ? React.useEffect : undefined;

  function StaticPanel() {
    if (!h) return null;
    return h('div', { 'data-dev-memory': 'review-panel', style: PANEL_STYLE },
      h('div', { style: TITLE_STYLE }, 'dev-memory'),
      h('div', { style: MUTED_STYLE }, 'Recent writes / health'),
    );
  }

  function LivePanel() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [rootDraft, setRootDraft] = useState('');
    const [busy, setBusy] = useState(false);

    function load() {
      if (typeof fetch !== 'function') return;
      fetch('/dsh-dev-memory/state', { cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('state ' + res.status)); })
        .then(function (json) {
          setData(json);
          if (json && json.config && typeof json.config.memoryRoot === 'string') setRootDraft(json.config.memoryRoot);
          setError('');
        })
        .catch(function (err) { setError(err && err.message ? err.message : String(err)); });
    }

    useEffect(function () {
      load();
      if (typeof setInterval !== 'function') return undefined;
      const id = setInterval(load, 8000);
      return function () { if (typeof clearInterval === 'function') clearInterval(id); };
    }, []);

    function postConfig(body) {
      if (typeof fetch !== 'function') return;
      setBusy(true);
      fetch('/dsh-dev-memory/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('config ' + res.status)); })
        .then(function () { load(); })
        .catch(function (err) { setError(err && err.message ? err.message : String(err)); })
        .finally(function () { setBusy(false); });
    }

    const cfg = (data && data.config) || {};
    const audit = (data && Array.isArray(data.audit)) ? data.audit.slice().reverse() : [];
    const health = data && data.health;
    const healthLine = health == null
      ? 'health: (loading)'
      : (health.error ? ('health: error — ' + health.error) : ('health: ' + JSON.stringify(health)));

    return h('div', { 'data-dev-memory': 'review-panel', style: PANEL_STYLE },
      h('div', { style: TITLE_STYLE }, 'dev-memory'),
      h('div', { style: MUTED_STYLE }, 'Recent writes / health'),

      h('label', { style: ROW_STYLE },
        h('input', {
          type: 'checkbox',
          checked: !!cfg.enabled,
          disabled: busy,
          onChange: function (e) { postConfig({ enabled: !!e.target.checked }); },
        }),
        h('span', { style: VALUE_STYLE }, cfg.enabled ? 'Enabled' : 'Disabled'),
      ),

      h('div', { style: ROW_STYLE },
        h('span', { style: LABEL_STYLE }, 'memoryRoot'),
        h('input', {
          style: INPUT_STYLE,
          value: rootDraft,
          onChange: function (e) { setRootDraft(e.target.value); },
        }),
        h('button', {
          type: 'button',
          style: BTN_STYLE,
          disabled: busy,
          onClick: function () { postConfig({ memoryRoot: rootDraft }); },
        }, 'Save'),
      ),

      h('div', { style: ROW_STYLE },
        h('span', { style: LABEL_STYLE }, 'maxInjectTokens'),
        h('span', { style: VALUE_STYLE }, String(cfg.maxInjectTokens == null ? '' : cfg.maxInjectTokens)),
      ),
      h('div', { style: ROW_STYLE },
        h('span', { style: LABEL_STYLE }, 'writeConfidenceMin'),
        h('span', { style: VALUE_STYLE }, String(cfg.writeConfidenceMin || '')),
      ),
      h('div', { style: ROW_STYLE },
        h('span', { style: LABEL_STYLE }, 'autoWriteLevels'),
        h('span', { style: VALUE_STYLE }, Array.isArray(cfg.autoWriteLevels) ? cfg.autoWriteLevels.join(', ') : ''),
      ),

      h('div', { style: { ...MUTED_STYLE, marginTop: '8px' } }, healthLine),
      error ? h('div', { style: { ...MUTED_STYLE, color: 'var(--dsw-alias-label-danger, #c44)' } }, error) : null,

      h('div', { style: { ...TITLE_STYLE, marginTop: '12px', fontSize: '13px' } }, 'Recent writes'),
      audit.length === 0
        ? h('div', { style: MUTED_STYLE }, 'No audit entries yet.')
        : h('ul', { style: { ...MUTED_STYLE, paddingLeft: '18px', margin: '4px 0' } },
            audit.map(function (row, i) {
              const when = row && row.ts ? new Date(row.ts).toISOString() : '';
              const file = row && row.relPath ? row.relPath : '';
              const summary = row && row.summary ? row.summary : '';
              const meta = [when, row && row.module, row && row.category].filter(Boolean).join(' · ');
              return h('li', { key: String(row && row.ts != null ? row.ts : i) },
                file ? h('div', {}, h('strong', {}, file)) : null,
                summary ? h('div', {}, summary) : null,
                meta ? h('div', { style: { opacity: 0.55 } }, meta) : null,
              );
            }),
          ),

      h('div', { style: ROW_STYLE },
        h('button', { type: 'button', style: BTN_STYLE, disabled: busy, onClick: load }, 'Refresh'),
      ),
    );
  }

  const DevMemoryPanel = (useState && useEffect) ? LivePanel : StaticPanel;

  return {
    name: 'dsh-dev-memory',
    inject: ['slots'],
    apply(ctx) {
      const slots =
        (ctx && ctx.slots) ||
        (ctx && typeof ctx.get === 'function' ? ctx.get('slots') : undefined);
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return;

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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createClientPlugin, default: createClientPlugin };
}
