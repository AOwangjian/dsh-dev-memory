// dsh-dev-memory — host plugin entry (Task 7): services + tools + hooks.
//
// STATIC Cordis plugin (loaded into the host realm, like dsh-codex-sync). It
// must NOT import @deepseek-ai/* — those packages are not resolvable from the
// profile node_modules. Every real DSH API is reached through the injected ctx:
//
//   tools.register(definition)                -> contract.TOOLS.REGISTER       ("ctx.tools.register")
//   systemPrompt.section({ name, order, text }) -> contract.METHODS.INSTRUCT_WRITE_PASS ("systemPrompt.section")
//   agent.inject(UserMessage)                 -> contract.METHODS.INJECT_MEMORY ("Agent.inject")
//   ctx.on(event, handler)                    -> contract.EVENTS.*
//
// The ToolDefinition is built by hand (raw JSON Schema) because `defineTool`
// from @deepseek-ai/dsh-tools is not importable here. The shape matches what
// defineTool() produces: parameters = { type: "object", properties, required }
// and output.schema = {} (annotation-only schema == unconstrained JSON).

import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { contract } from './contract.js';
import { makeMemoryService } from './service.js';
import { runWritePass } from './orchestrator.js';
import { readAudit } from './audit.js';
import { mountDevMemoryRoutes } from './http.js';
import { makeWorkspaceRegistry } from './workspaces.js';

export const name = 'dsh-dev-memory';

/** Hard service dependencies — apply() is deferred until these exist. */
export const inject = ['tools', 'systemPrompt'];

// ---- brief helpers ---------------------------------------------------------

export function slugOf(workspace) {
  return String(workspace).replace(/[:\\/_]/g, '-');
}

export function searchQueryForWorkspace(workspace) {
  const path = typeof workspace === 'string' ? workspace.trim() : '';
  if (!path) return '';
  const normalized = path.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const name = normalized.split('/').filter(Boolean).pop();
  return name || path;
}

export function deriveRoot(workspace) {
  return join(homedir(), '.claude', 'projects', slugOf(workspace), 'memory');
}

function defaultScriptsDir() {
  return join(homedir(), '.dsh', 'skills', 'dev-memory', 'scripts');
}

function defaultRegistryPath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dev-memory', 'workspaces.json');
}

function defaultProjectsRoot() {
  return join(homedir(), '.claude', 'projects');
}

function readProfileArg(fallback = 'web') {
  const index = process.argv.indexOf('--profile');
  const candidate = index >= 0 ? process.argv[index + 1] : undefined;
  return candidate !== undefined && !candidate.startsWith('-') ? candidate : fallback;
}

function auditPath(root) {
  return join(root, '.audit', 'audit.jsonl');
}


// ---- memory injection helpers ----------------------------------------------

const TOKEN_CHAR_BUDGET = 4; // heuristic: ~4 chars per token

// Truncate at the HITS level: keep whole search entries until an approximate
// token budget is reached (approx tokens = ceil(chars / TOKEN_CHAR_BUDGET)),
// then let formatSearchResults stringify them. Never slices JSON mid-string, so
// the injected payload stays valid JSON.
function truncateToTokens(hits, maxTokens) {
  const budget = typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : 1500;
  const maxChars = budget * TOKEN_CHAR_BUDGET;
  const list = resultList(hits);
  const kept = [];
  let chars = 0;
  for (const entry of list) {
    const size = JSON.stringify(entry).length;
    if (kept.length > 0 && chars + size > maxChars) break;
    kept.push(entry);
    chars += size;
  }
  if (Array.isArray(hits)) return kept;
  return { ...(hits || {}), results: kept, truncated: kept.length < list.length };
}

function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name, form: 'instructions' },
  };
}

function injectText(agent, text) {
  if (!agent || typeof agent.inject !== 'function' || !text) return;
  try {
    agent.inject(userMessage(text));
  } catch {
    /* inject may reject after disposal — best effort */
  }
}

function followupText(agent, text) {
  if (!agent || typeof agent.followup !== 'function' || !text) return false;
  try {
    agent.followup(userMessage(text));
    return true;
  } catch {
    return false;
  }
}

function formatSearchResults(hits) {
  try {
    return JSON.stringify(hits, null, 2);
  } catch {
    return String(hits ?? '');
  }
}

/** The list of search hits, whether the result is an array or { results: [...] }. */
function resultList(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.results)) return result.results;
  return [];
}

// ---- write-pass instruction ------------------------------------------------

const WRITE_PASS_INSTRUCTION = [
  'Development memory (dsh-dev-memory): when you reach a goal-completion or',
  'session-end boundary, review what you just worked on and record any durable',
  'development memory — a new module, a non-obvious decision, a pitfall, or an',
  'open question — by calling the `memory_write` tool with a structured proposal.',
  'Do not call it mid-task; only at a boundary.',
].join(' ');

const BOUNDARY_REMINDER = [
  'You just reached a goal/session boundary — review what to record, then call',
  'the `memory_write` tool to store durable development memory.',
].join(' ');

// ---- tool definitions ------------------------------------------------------

function jsonRender(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

// ---- tool arg validation ---------------------------------------------------
// The hand-built ToolDefinitions are raw JSON Schema; unlike defineTool's
// wrapper, nothing validates args for us. Validate before dispatch so a
// malformed call never reaches spawnSync with undefined fields.

function requireNonEmptyString(v, name) {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(name + ' must be a non-empty string');
}

function requirePositiveInt(v, name) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) throw new Error(name + ' must be a positive integer');
  return v;
}

function requireObject(v, name) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(name + ' must be an object');
}

function requireConfidence(v) {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error('memory_write.proposal.confidence must be a non-empty string');
  }
  if (!['low', 'medium', 'high'].includes(v)) {
    throw new Error('memory_write.proposal.confidence must be one of low, medium, or high');
  }
}

function validateProposalArgs(proposal) {
  requireObject(proposal, 'memory_write.proposal');
  requireNonEmptyString(proposal.module, 'memory_write.proposal.module');
  requireNonEmptyString(proposal.category, 'memory_write.proposal.category');
  requireConfidence(proposal.confidence);
  if (!Array.isArray(proposal.evidence) || proposal.evidence.length === 0) {
    throw new Error('memory_write.proposal.evidence must be a non-empty array');
  }
  requireObject(proposal.draft, 'memory_write.proposal.draft');
  requireNonEmptyString(proposal.draft.relPath, 'memory_write.proposal.draft.relPath');
  requireNonEmptyString(proposal.draft.content, 'memory_write.proposal.draft.content');
}

// ---- apply -----------------------------------------------------------------

export function apply(ctx, config = {}) {
  try {
    applyInner(ctx, config);
  } catch {
    /* never fail the DSH loader — errors belong on the settings panel */
  }
}

function applyInner(ctx, config = {}) {
  // config is the Loader-validated config passed as apply's second argument
  // (ctx.config would require 'config' in `inject`; the param is the canonical
  // form, matching dsh-codex-sync).
  const cfg = config || {};
  let configuredRoot = typeof cfg.memoryRoot === 'string' && cfg.memoryRoot.trim() ? cfg.memoryRoot.trim() : null;
  const scriptsDir = cfg.scriptsDir || defaultScriptsDir();
  const autoWriteLevels = Array.isArray(cfg.autoWriteLevels) ? cfg.autoWriteLevels : [2, 3];
  const writeConfidenceMin = cfg.writeConfidenceMin || 'medium';
  const registryPath = typeof cfg.registryPath === 'string' && cfg.registryPath.trim() ? cfg.registryPath.trim() : defaultRegistryPath();
  const projectsRoot = typeof cfg.projectsRoot === 'string' && cfg.projectsRoot.trim() ? cfg.projectsRoot.trim() : defaultProjectsRoot();
  const profile = typeof cfg.profile === 'string' && cfg.profile.trim() ? cfg.profile.trim() : readProfileArg('web');
  const registry = makeWorkspaceRegistry({ registryPath, projectsRoot, profile });
  // Mutable runtime state: panel POST /config mutates enabled + memoryRootOverride.
  // memoryRootOverride null = use boot config. Resolved at WRITE/SEARCH time.
  const state = {
    enabled: cfg.enabled !== false,
    workspacePath: null,
    memoryRootOverride: null,
    maxInjectTokens: cfg.maxInjectTokens || 1500,
    lastError: null,
    pendingLevel1: [],
    showDiscovered: false,
  };
  const writePassByAgent = new Map();
  const remember = (err, where) => {
    const message = (where ? where + ': ' : '') + (err && err.message ? err.message : String(err));
    state.lastError = state.lastError ? state.lastError + ' | ' + message : message;
  };
  const bindAgentWorkspace = (agent) => {
    const cwd = agent && agent.session && agent.session.header ? agent.session.header.cwd : undefined;
    if (typeof cwd !== 'string' || !cwd.trim()) return;
    state.workspacePath = cwd.trim();
    try { registry.upsertVerified(state.workspacePath); } catch { /* registry is best-effort */ }
  };
  const effectiveRoot = () => state.memoryRootOverride || configuredRoot ||
    (state.workspacePath ? deriveRoot(state.workspacePath) : null);
  const requireEffectiveRoot = () => {
    const root = effectiveRoot();
    if (!root) throw new Error('active session workspace is required before using automatic memoryRoot');
    return root;
  };
  const activeWorkspaceId = () => state.workspacePath ? slugOf(state.workspacePath) : null;
  const workspaceInfo = (id = activeWorkspaceId()) => {
    if (!id) return null;
    try { return registry.get(id); } catch { return null; }
  };
  const withWorkspace = (value) => {
    const workspace = workspaceInfo();
    if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value, workspace };
    return { result: value, workspace };
  };
  const snapshotForRoot = (root, extras = {}) => {
    let health = { error: 'unavailable' };
    try {
      if (!root) throw new Error('active session workspace is required before using automatic memoryRoot');
      health = makeMemoryService({ memoryRoot: root, scriptsDir }).health();
    } catch (err) {
      health = { error: err && err.message ? err.message : String(err) };
    }
    let audit = [];
    if (root) {
      try { audit = readAudit(auditPath(root), 15); } catch { audit = []; }
    }
    return {
      config: extras.config || effectiveConfig(),
      audit,
      health,
      pendingLevel1: extras.pendingLevel1 || state.pendingLevel1,
      ...extras,
      pluginError: extras.pluginError || state.lastError || undefined,
    };
  };
  const service = makeMemoryService({ memoryRoot: requireEffectiveRoot, scriptsDir });
  const effectiveConfig = () => ({
    memoryRoot: effectiveRoot(),
    workspacePath: state.workspacePath,
    rootMode: state.memoryRootOverride || configuredRoot ? 'configured' : (state.workspacePath ? 'auto' : 'auto-waiting'),
    scriptsDir,
    maxInjectTokens: state.maxInjectTokens,
    autoWriteLevels,
    writeConfidenceMin,
    enabled: state.enabled,
  });

  // 1) three tools — ctx.tools.register(definition)
  let tools;
  try { tools = ctx.get(contract.SERVICES.TOOLS); } catch (err) { remember(err, 'tools'); }
  try {
  if (tools && typeof tools.register === 'function') {
    tools.register({
      name: 'memory_search',
      description: 'Search development memory for facts, pitfalls, open questions, and changelog entries relevant to a query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for in development memory.' },
          top: { type: 'integer', description: 'Maximum number of results to return (default 5).' },
        },
        required: ['query'],
      },
      output: { schema: {}, render: jsonRender },
      async execute(args = {}, exec) {
        bindAgentWorkspace(exec && exec.agent);
        requireNonEmptyString(args.query, 'memory_search.query');
        const top = requirePositiveInt(args.top, 'memory_search.top');
        return withWorkspace(service.search(args.query, top));
      },
    });

    tools.register({
      name: 'memory_write',
      description: 'Record durable development memory (module decision, pitfall, or open question) from a structured proposal. Use only at a goal-completion or session-end boundary.',
      parameters: {
        type: 'object',
        properties: {
          proposal: {
            type: 'object',
            additionalProperties: false,
            description: 'Structured write proposal: module, category, confidence, evidence, draft.',
            properties: {
              module: { type: 'string', description: 'Module route (e.g. fishing/settlement).' },
              category: { type: 'string', enum: ['fact', 'pitfall', 'open_question'], description: 'Memory category.' },
              confidence: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Confidence in the memory.' },
              evidence: { type: 'array', items: { type: 'string' }, description: 'Non-empty list of evidence sources.' },
              draft: {
                type: 'object',
                additionalProperties: false,
                description: 'Draft markdown file to write.',
                properties: {
                  relPath: { type: 'string', description: 'Path relative to the memory root.' },
                  content: { type: 'string', description: 'Markdown content to write.' },
                },
                required: ['relPath', 'content'],
              },
              moduleLevel: { type: 'integer', description: 'Module confidence level; 1 requires manual confirmation.' },
            },
            required: ['module', 'category', 'confidence', 'evidence', 'draft'],
          },
        },
        required: ['proposal'],
      },
      output: { schema: {}, render: jsonRender },
      async execute(args = {}, exec) {
        bindAgentWorkspace(exec && exec.agent);
        validateProposalArgs(args.proposal);
        const result = await runWritePass({
          proposal: args.proposal,
          service,
          auditPath: auditPath(effectiveRoot()),
          sessionId: exec && exec.agent ? exec.agent.id : undefined,
          autoWriteLevels,
          writeConfidenceMin,
        });
        const workspace = workspaceInfo();
        if (result && result.written === true && workspace && workspace.id) {
          try { registry.markWrite(workspace.id); } catch { /* best effort */ }
        }
        if (result && result.needsConfirm === true) {
          state.pendingLevel1 = [...state.pendingLevel1, {
            id: randomUUID(),
            proposal: args.proposal,
            reason: result.reason,
            workspace,
          }];
        }
        return { ...result, workspace };
      },
    });

    tools.register({
      name: 'memory_health',
      description: 'Check the health of the development memory store (index consistency, orphans, broken links).',
      parameters: { type: 'object', properties: {} },
      output: { schema: {}, render: jsonRender },
      async execute(_args, exec) {
        bindAgentWorkspace(exec && exec.agent);
        return withWorkspace(service.health());
      },
    });
  }
  } catch (err) { remember(err, 'tools'); }

  // 2) permanent write-pass instruction (the plugin instructs; it never writes directly)
  // Skip when disabled so passive auto actions stay off (tools still register).
  try {
  const systemPrompt = ctx.get(contract.SERVICES.SYSTEM_PROMPT);
  if (state.enabled && systemPrompt && typeof systemPrompt.section === 'function') {
    systemPrompt.section({
      name: 'dev-memory:write-pass',
      order: 116,
      text: WRITE_PASS_INSTRUCTION,
    });
  }
  } catch (err) { remember(err, 'systemPrompt'); }

  // 3) event hooks — intent -> real event mapping (see contract.EVENTS)
  //    "session start -> inject memory"
  try {
  ctx.on(contract.EVENTS.AGENT_SESSION_START, ({ agent } = {}) => {
    bindAgentWorkspace(agent);
    if (!state.enabled) return;
    if (!agent) return;
    let hits;
    try {
      const cwd = agent.session && agent.session.header ? agent.session.header.cwd : undefined;
      const query = searchQueryForWorkspace(cwd) || (agent.session && agent.session.id) || agent.id || '';
      hits = service.search(query, 2);
    } catch {
      return; // scripts unavailable / empty memory — best effort
    }
    if (resultList(hits).length === 0) return; // no hits — skip the empty inject
    const truncated = truncateToTokens(hits, state.maxInjectTokens);
    const text = 'Development memory (relevant to this workspace):\n' + formatSearchResults(truncated);
    injectText(agent, text);
  });

  //    "goal complete -> write pass" (instruct, not write)
  ctx.on(contract.EVENTS.GOAL_CHANGED, ({ agent, change } = {}) => {
    if (!state.enabled) return;
    if (change && change.operation === 'complete') injectText(agent, BOUNDARY_REMINDER);
  });

  ctx.on(contract.EVENTS.AGENT_STATUS, ({ agent, status } = {}) => {
    if (!state.enabled || !agent) return;
    const id = agent.id || (agent.session && agent.session.id);
    if (!id) return;
    const current = writePassByAgent.get(id) || { queued: false, fromWritePass: false };
    if (status === 'running') {
      if (!current.fromWritePass) writePassByAgent.set(id, { queued: false, fromWritePass: false });
      return;
    }
    if (status !== 'idle') return;
    if (current.fromWritePass) {
      writePassByAgent.set(id, { queued: false, fromWritePass: false });
      return;
    }
    if (current.queued) return;
    if (followupText(agent, BOUNDARY_REMINDER)) writePassByAgent.set(id, { queued: true, fromWritePass: true });
  });

  //    "session end -> write pass". There is no live agent in this payload and the
  //    session is already leaving the store; the permanent system-prompt section
  //    above carries the write-pass instruction into every session.
  ctx.on(contract.EVENTS.SESSION_DISPOSED, () => {});
  } catch (err) { remember(err, 'events'); }

  // 4) same-origin HTTP routes on host.webServer (dsh-plugin pattern).
  try {
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (host) => {
      if (!host || !host.webServer) return;
      const mount = () => mountDevMemoryRoutes(host.webServer, {
        getSnapshot(request) {
          const url = new URL(request && request.url ? request.url : '/', 'http://localhost');
          const browseId = url.searchParams.get('workspace');
          if (browseId) {
            try { registry.scan(); } catch { /* scan is best-effort */ }
            const record = registry.get(browseId);
            if (!record) {
              const err = new Error('unknown workspace: ' + browseId);
              err.status = 404;
              throw err;
            }
            return snapshotForRoot(record.memoryRoot, {
              browseWorkspaceId: browseId,
              browseWorkspace: record,
            });
          }
          return snapshotForRoot(effectiveRoot());
        },
        updateConfig(body) {
          const payload = body && typeof body === 'object' ? body : {};
          if (typeof payload.enabled === 'boolean') state.enabled = payload.enabled;
          if (typeof payload.memoryRoot === 'string') {
            const next = payload.memoryRoot.trim();
            if (next) state.memoryRootOverride = next;
            else {
              state.memoryRootOverride = null;
              configuredRoot = null;
            }
          }
          if (typeof payload.maxInjectTokens === 'number' && Number.isInteger(payload.maxInjectTokens) && payload.maxInjectTokens > 0) {
            state.maxInjectTokens = payload.maxInjectTokens;
          }
          return effectiveConfig();
        },
        listWorkspaces() {
          const rows = state.showDiscovered ? registry.scan() : registry.list();
          const workspaces = rows.filter((row) => state.showDiscovered ? true : row.verified === true);
          return { workspaces, activeWorkspaceId: activeWorkspaceId(), showDiscovered: state.showDiscovered };
        },
        mutateWorkspace(body) {
          const payload = body && typeof body === 'object' ? body : {};
          if (payload.action === 'showDiscovered') {
            state.showDiscovered = payload.showDiscovered === true;
            return { showDiscovered: state.showDiscovered };
          }
          if (payload.action === 'confirmLevel1') {
            const id = typeof payload.id === 'string' ? payload.id : '';
            const index = state.pendingLevel1.findIndex((row) => row.id === id);
            if (index < 0) {
              const err = new Error('unknown pending Level 1 proposal');
              err.status = 404;
              throw err;
            }
            const pending = state.pendingLevel1[index];
            return runWritePass({
              proposal: pending.proposal,
              service,
              auditPath: auditPath(effectiveRoot()),
              sessionId: pending.sessionId,
              autoWriteLevels,
              writeConfidenceMin,
              confirmLevel1: true,
            }).then((result) => {
              state.pendingLevel1 = state.pendingLevel1.filter((row) => row.id !== id);
              const workspace = workspaceInfo();
              if (result && result.written === true && workspace && workspace.id) {
                try { registry.markWrite(workspace.id); } catch { /* best effort */ }
              }
              return { ...result, workspace, pendingLevel1: state.pendingLevel1 };
            });
          }
          if (payload.action === 'dismissLevel1') {
            const id = typeof payload.id === 'string' ? payload.id : '';
            state.pendingLevel1 = state.pendingLevel1.filter((row) => row.id !== id);
            return { pendingLevel1: state.pendingLevel1 };
          }
          if (payload.action === 'add') {
            const path = typeof payload.workspacePath === 'string' ? payload.workspacePath.trim() : '';
            let directory = false;
            try { directory = path && existsSync(path) && statSync(path).isDirectory(); } catch { directory = false; }
            if (!directory) {
              const err = new Error('workspacePath must be an existing directory');
              err.status = 400;
              throw err;
            }
          }
          return registry.mutate(payload);
        },
        openPath(body) {
          const requested = body && typeof body.path === 'string' ? body.path.trim() : '';
          if (!requested) {
            const err = new Error('path is required');
            err.status = 400;
            throw err;
          }
          const allowed = new Set();
          for (const row of registry.list()) {
            if (row.workspacePath) allowed.add(row.workspacePath);
            if (row.memoryRoot) allowed.add(row.memoryRoot);
          }
          if (state.workspacePath) allowed.add(state.workspacePath);
          const root = effectiveRoot();
          if (root) allowed.add(root);
          if (![...allowed].includes(requested) || !existsSync(requested)) {
            const err = new Error('path is not a registered workspace or memory directory');
            err.status = 400;
            throw err;
          }
          if (process.platform === 'win32') spawn('explorer.exe', [requested], { detached: true, stdio: 'ignore' }).unref();
          else spawn('xdg-open', [requested], { detached: true, stdio: 'ignore' }).unref();
          return { path: requested };
        },
      });
      if (typeof host.effect === 'function') host.effect(mount, 'dsh-dev-memory: http routes');
      else mount();
    });
  }
  } catch (err) { remember(err, 'http'); }
}

export default { name, inject, apply };
