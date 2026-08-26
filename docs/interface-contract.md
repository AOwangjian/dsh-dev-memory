# DSH Interface Contract — Discovery Record

> Task 1 (interface discovery) for the `dsh-dev-memory` plugin.
> Branch: `feat/plugin`. This file is the source-of-truth evidence for every
> value in `lib/contract.js`. Every non-null entry below carries a real source
> pointer: `package` + `file` + `line` (1-based, or "byte offset ≈" where a
> bundled compiled file has no stable line numbering).

## Discovery root

Packages were read from the NESTED install (not the top-level npm
`node_modules`):

```
C:\Users\wangjian\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\
```

The `cordis` framework itself is at
`…\node_modules\@deepseek-ai\cordis\` (ships `lib/types/*.d.ts` + `src`).

The authoritative machine-readable catalog for harness services/events/builtins
is GENERATED into `@deepseek-ai/dsh-tool-cordis/lib/index.js` (bundled) —
`SERVICE_API` (line 19) and `EVENT_API` (line 3720) — with its TypeScript
interfaces in `dsh-tool-cordis/lib/types/api-catalog.d.ts`. The same data is
served to the model by the `cordis_inspect_list` / `cordis_inspect_query`
tools.

---

## 1. EVENTS (lifecycle event names + payload)

Cordis dispatch modes (`cordis/lib/types/events.d.ts`): `on` (L197),
`once` (L206), `emit` (L142), `parallel` (L136), `waterfall` (L167).
Each event's `@mode` tag in the catalog names its dispatch mode.

### session lifecycle — `@deepseek-ai/dsh-session`
Source: `dsh-session/lib/types/index.d.ts` (the `Events` interface augmenting
cordis). Line numbers below refer to that file.

| contract key | event name | payload | line |
|---|---|---|---|
| `SESSION_CREATED` | `session/created` | `(this: Scoped<Session>, session: Session)` | L43 |
| `SESSION_DISPOSED` | `session/disposed` | `(this: Scoped<Session>, session: Session)` | L53 |
| `SESSION_EVENT` | `session/event` | `(this: Scoped<Session>, session: Session, event: SessionEvent)` | L65 |
| `SESSION_FLUSH` | `session/flush` | `(this: Scoped<Session>, session: Session): Promise<void> | void` | L74 |

Notes:
- `session/created` is a veto point (synchronous throw rolls back with a paired
  disposal). `session/event` is a fire-and-forget post-commit append feed.
  `session/flush` is the awaited parallel durability checkpoint
  (`@mode parallel`).
- The `Session` class is a plain class (not a Service) — create live instances
  via `ctx.sessions.create()` (`dsh-session/lib/types/index.d.ts` L105).

### agent lifecycle — `@deepseek-ai/dsh-agent-loop`
Source: the generated `EVENT_API` in `dsh-tool-cordis/lib/index.js` (line
3720 onward); the `Agent` class lives in
`dsh-agent-loop/lib/types/agent.d.ts`.

| contract key | event name | payload | mode |
|---|---|---|---|
| `AGENT_CREATED` | `agent/created` | `(this: Scoped<Agent>, { agent: Agent })` | emit |
| `AGENT_SESSION_START` | `agent/session-start` | `(this: Scoped<Agent>, { agent, source: SessionStartSource })` | emit |
| `AGENT_DISPOSED` | `agent/disposed` | `(this: Scoped<Agent>, { agent: Agent })` | emit |
| `AGENT_STATUS` | `agent/status` | `(this: Scoped<Agent>, { agent, status: AgentStatus })` | emit |

Note: `agent/session-start` runs once before the first turn; the catalog
explicitly says "Use `agent.inject()` to seed model-facing context" — this is
the hook for memory injection (see §3).

### goal lifecycle — `@deepseek-ai/dsh-goal`
Source: `dsh-goal/lib/types/domain.d.ts`.

| contract key | event name | payload | line |
|---|---|---|---|
| `GOAL_CHANGED` | `goal/changed` | `(this: Scoped<Agent>, { agent: Agent; change: GoalChanged })` | L86 |
| `GOAL_CHANGE_SESSION_EVENT` | `goal/change` | durable session-log event type (NOT a ctx.on event) | see below |

Supporting types (`dsh-goal/lib/types/domain.d.ts`):

```ts
type GoalOperation = 'create' | 'edit' | 'pause' | 'resume' | 'complete' | 'block' | 'clear'; // L12
interface GoalChanged {           // L68
  readonly operation: GoalOperation;
  readonly ref: GoalRef;
  readonly goal?: GoalView;       // absent for a clear tombstone
}
```

Emission facts (from `dsh-goal/lib/index.js`):
- `agent.session.append("goal/change", change)` — the durable log event.
- `agentEvents(this.ctx, agent).emit("goal/changed", { change: notification })`
  where `notification = { operation, ref, goal? }`.

**Mapping the design spec's concept events → real events:**
- concept `session/start` → `agent/session-start` (and `session/created`).
- concept `goal/complete` → `goal/changed` filtered on
  `change.operation === 'complete'` (there is no dedicated "goal/complete" event).
- concept `session/end` → `session/disposed` (and `agent/disposed`).

---

## 2. SERVICES (exact `ctx.<key>` keys)

Source: generated `SERVICE_API` in `dsh-tool-cordis/lib/index.js` (line 19),
cross-checked against each package's own `super(ctx, "<key>")` and `lib/types`.

| contract key | service key | package | representative methods (from catalog) |
|---|---|---|---|
| `SUBPROCESS` | `subprocess` | `dsh-subprocess` | `resolveExecutable`, `spawn(spec)`, `spawnTerminal(spec)` |
| `FS` | `fs` | `dsh-fs` | `resolve`, `stat`, `readText`, `writeText`, `editText`, `listDir` |
| `TOOLS` | `tools` | `dsh-tools` | `register`, `execute`, `schemas`, `restrict`, `guard`, `get` |
| `TIMER` | `timer` | `cordis-plugin-timer` | `timeout`, `interval`, `throttle`, `debounce` |
| `SESSIONS` | `sessions` | `dsh-session` | `create`, `prepare`, `enter`, `announce`, `get`, `list`, `flush`, `fork` |
| `SESSION_QUERY` | `sessionQuery` | `dsh-session-query` | `searchSessions`, `searchEvents`, `listSessions`, `readSession`, `readTitle` |
| `GOALS` | `goals` | `dsh-goal` | `get`, `create`, `edit`, `pause`, `resume`, `complete`, `block`, `clear` |
| `WORKSPACE_REGISTRY` | `workspaceRegistry` | `dsh-workspace` | `create`, `get`, `list`, `delete`, `resolveByPath` |
| `SKILLS` | `skills` | `dsh-skill` | `registerProvider`, `register`, `list`, `snapshot`, `get` |
| `SYSTEM_PROMPT` | `systemPrompt` | `dsh-system-prompt` | `section`, `context`, `tools`, `variable`, `assemble` |

Key shapes (for the plugin's subprocess + workspace use):
- `SubprocessSpawnSpec` — `dsh-subprocess/lib/types/types.d.ts` L67:
  `{ argv: readonly string[]; cwd: string; stdio: SubprocessStdio; graceMs: number; signal?: AbortSignal; env… }`.
  `SubprocessHandle` exposes `pid`, `stdin/stdout/stderr`, `collected`,
  `done: Promise<SubprocessOutcome>`, `terminate()`.
- `Workspace` — `dsh-workspace/lib/types/types.d.ts` L20:
  `{ id: WorkspaceId; path: string; title: string; createdAt: string; updatedAt: string; … }`.
  `path` is the `fs.realpath`-canonicalized directory; the slug is derived by
  replacing `:` and `\` with `-` (design spec §9).

---

## 3. METHODS (real DSH methods the plugin calls)

These are DSH methods — not plugin-invented names — so a downstream task wires
against them exactly.

| contract key | real target | signature | source |
|---|---|---|---|
| `INJECT_MEMORY` | `Agent.inject` | `inject(input: UserMessage): void` | `dsh-agent-loop/lib/types/agent.d.ts` L35 (Agent class) |
| `INSTRUCT_WRITE_PASS` | `systemPrompt.section` | `section(section: PromptSection): () => void` | `SERVICE_API` catalog (`dsh-tool-cordis/lib/index.js`); service key `systemPrompt` |

- `Agent.inject` is the documented way to seed model-facing context at
  `agent/session-start` (see the `agent/session-start` catalog description).
- `systemPrompt.section({ name, order, text })` registers a prompt section; the
  usage pattern is shown verbatim in `dsh-tool-cordis/lib/index.js`
  (`ctx.systemPrompt.section({ name: "tool:cordis", order: 115, text: … })`).

---

## 4. TOOLS (registration API + existing tool ids)

### Registration API
Source: `dsh-tools/lib/types/schema.d.ts` (L239) and
`dsh-tools/lib/types/index.d.ts` (L603).

```ts
// @deepseek-ai/dsh-tools
declare function defineTool<const S, const O>(options: DefineToolOptions<S, O>): ToolDefinition;

// DefineToolOptions: { name, description, parameters, output: { schema, render, presentationMeta? }, timeoutMs?, isConcurrencySafe?, presentCall?, presentResult? }

// ToolDefinition adds: execute(args, exec): Promise<unknown>, finalizeContent?, …
// register on the tools service:  ctx.tools.register(definition): () => void
```

The canonical registration call (as every `dsh-tool-*` package does) is:

```js
ctx.tools.register(defineTool({ name: "…", description: "…", parameters: {…}, output: { schema, render }, execute(args, exec) { … } }));
```

### Representative existing tool ids (from `dsh-tool-*` packages)
All 33 ids in `contract.TOOLS.IDS` were extracted from each package's
`lib/index.js` `defineTool({ … name: "…" })` call.

| tool id | package |
|---|---|
| `ask_user_question` | dsh-tool-ask-user |
| `bash` | dsh-tool-bash |
| `cordis_define` | dsh-tool-cordis |
| `cordis_inspect_list` | dsh-tool-cordis |
| `cordis_inspect_query` | dsh-tool-cordis |
| `cordis_inspect_self` | dsh-tool-cordis |
| `cordis_run` | dsh-tool-cordis |
| `cordis_stop` | dsh-tool-cordis |
| `cordis_undefine` | dsh-tool-cordis |
| `create_goal` | dsh-tool-goal |
| `edit` | dsh-tool-fs |
| `get_goal` | dsh-tool-goal |
| `glob` | dsh-tool-fs-search |
| `grep` | dsh-tool-fs-search |
| `interrupt_agent` | dsh-tool-subagent-control |
| `job_kill` | dsh-tool-jobs |
| `job_list` | dsh-tool-jobs |
| `job_output` | dsh-tool-jobs |
| `pwsh` | dsh-tool-pwsh |
| `ralph` | dsh-tool-ralph |
| `read` | dsh-tool-fs |
| `read_image` | dsh-tool-fs |
| `report` | dsh-tool-subagent-report |
| `send_message` | dsh-tool-subagent-control |
| `skill` | dsh-tool-skill |
| `str_replace_editor` | dsh-tool-str-replace-editor |
| `subagent` | dsh-tool-subagent |
| `todo_write` | dsh-tool-todo |
| `update_goal` | dsh-tool-goal |
| `web_fetch` | dsh-tool-web |
| `web_search` | dsh-tool-web |
| `workflow` | dsh-tool-workflow |
| `write` | dsh-tool-fs |

Notes:
- `subagent` (dsh-tool-subagent) and `workflow` (dsh-tool-workflow) names are
  CONFIGURABLE (`Config.toolName` defaults: `"subagent"`, `"workflow"`) —
  the model-facing id is the config value, not a literal.
- `cordis_*` (7 ids) come from `dsh-tool-cordis` — these are the
  enumeration/definition tools whose source reveals the whole harness API.
- Additional model-facing tools not in the `dsh-tool-*` set (e.g.
  `subagent_fork`, `list_agents`, `image_generate`, `video_generate`,
  `x_search`) are registered by other packages and were not enumerated here.

---

## 5. SLOTS (client slot-name strings)

Source: generated `CLIENT_SLOT_API` in `dsh-cordis-client-runner/lib/client.js`
(line 2121) + per-package `declare module '@deepseek-ai/dsh-client-ui-slots'`
`interface SlotMap` blocks.

**Registration API** (client half): the `slots` service
(`ctx.get("slots")` / `ctx.slots`) exposes
`slots.register(options, component): () => void` where `options.name` is the
slot key (see `dsh-cordis-client-runner/lib/client.js`, `guardedSlots`
`slots.register(options, component)` guard + `SlotCore` declaration).

Primary seats for this plugin's client panel:

| contract key | slot name | kind | scope | source |
|---|---|---|---|---|
| `SETTINGS_SECTION` | `settings.section` | list | root | `dsh-client-ui-settings/lib/types/client/contract/slots.d.ts` |
| `SETTINGS_GENERAL_ITEM` | `settings.general.item` | list | root | same file |
| `SETTINGS_PLUGINS_TAB` | `settings.plugins.tab` | list | root | same file |
| `SETTINGS_TRIGGER` | `settings.trigger` | single | root | same file |
| `SIDEBAR_SETTINGS` | `sidebar.settings` | single | root | `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts` |
| `SIDEBAR` | `sidebar` | single | root | `CLIENT_SLOT_API` catalog |
| `CONVERSATION_INPUT_DOCK` | `conversation.input.dock` | list | session | `CLIENT_SLOT_API` catalog |
| `SHELL_OVERLAY` | `shell.overlay` | list | root | `CLIENT_SLOT_API` catalog |
| `TOOL_VIEW_CORDIS` | `tool.view.cordis` | keyed | session | `dsh-client-ui-cordis/lib/types/client/slots.d.ts` |

The complete shipped surface is 48 keys, recorded in
`contract.SLOTS.ALL` (extracted from `CLIENT_SLOT_API`,
`dsh-cordis-client-runner/lib/client.js` L2121). All 48:

| slot key | kind | scope |
|---|---|---|
| `conversation` | single | session-maybe |
| `conversation.chat.assistant-actions` | list | session |
| `conversation.chat.commandview` | keyed | session |
| `conversation.chat.node` | keyed | session |
| `conversation.chat.turnTail` | chain | session |
| `conversation.composer` | chain | session |
| `conversation.composer.bar` | single | session-maybe |
| `conversation.composer.dock` | list | session |
| `conversation.details.tool` | single | session |
| `conversation.hero.agentPreset` | single | root |
| `conversation.hero.brand.mark` | single | root |
| `conversation.hero.workspace` | single | root |
| `conversation.hero.workspace.directoryFlow` | single | root |
| `conversation.input.attachments` | single | session-maybe |
| `conversation.input.dock` | list | session |
| `conversation.input.left` | list | session |
| `conversation.input.model` | single | session |
| `conversation.input.overlay` | list | session |
| `conversation.input.plan` | single | session |
| `conversation.input.right` | list | session |
| `conversation.message.images` | single | session |
| `conversation.session` | single | session |
| `conversation.session.header` | single | session |
| `conversation.session.header.actions` | list | session |
| `conversation.session.header.lineage` | single | session |
| `conversation.session.header.utilities` | list | session |
| `conversation.view` | list | session |
| `details` | single | session |
| `root` | single | root |
| `settings.action` | list | root |
| `settings.close` | single | root |
| `settings.general.item` | list | root |
| `settings.header` | single | root |
| `settings.onboarding` | list | root |
| `settings.plugin.item` | keyed | root |
| `settings.plugins.tab` | list | root |
| `settings.section` | list | root |
| `settings.trigger` | single | root |
| `shell.overlay` | list | root |
| `sidebar` | single | root |
| `sidebar.brand.mark` | single | root |
| `sidebar.brand.name` | single | root |
| `sidebar.footer.action` | list | root |
| `sidebar.settings` | single | root |
| `sidebar.workspaces` | single | root |
| `sidebar.workspaces.directoryFlow` | single | root |
| `tool.call.toolview` | keyed | session |
| `tool.view.cordis` | keyed | session |

---

## 6. HARNESS (`harness` builtin + peer builtins)

Source: `HOST_BUILTIN_INSPECTION` in
`dsh-cordis-host-runner/lib/index.js` (L1083; `harness` entry L1095).

`harness` (Host half) exposes:
```ts
harness.handle(method: string, handler: (args: JsonValue) => JsonValue | Promise<JsonValue>): () => void
harness.defineTool(definition: ToolDefinition): ToolDefinition
harness.registerTool(ctx: Context, tool: ToolDefinition): () => void
```

Peer Host builtins (same array):
`ctx` (`get/on/provide/effect`), `console` (`log/error`), `btoa`,
`atob`, `TextEncoder`, `TextDecoder`.

Client-half builtins (`CLIENT_BUILTIN_INSPECTION` in
`dsh-cordis-client-runner/lib/client.js` L3668):
`ctx`, `React`, `host.call(method, args?)` (Client→Host RPC), `styles.insert(css)`,
`console`.

The RPC direction is Client→Host: Host uses `harness.handle`, Client uses
`host.call`; only lossless JSON crosses (per `dsh-tool-cordis/lib/index.js`
`cordis_define` description).

---

## 7. SCRIPTS (exact dev-memory CLI)

Source: `C:\Users\wangjian\.dsh\skills\dev-memory\scripts\`.

### search-memory.mjs (read-only)
```
node search-memory.mjs <memory-root> "<query>" [--top N] [--json] [--explain] [--help]
```
Arg parsing at the top of the file: positional `<memory-root>` (argv[0]) and
`<query>` (argv[1]); `--top` (positive int, default 5), `--json`,
`--explain`.

### memory-crud.mjs (read-only — NO `write` subcommand)
```
node memory-crud.mjs <validate|dup-check|index-sync> <memory-root> [file] [--json] [--soft-lines N] [--split-lines N] [--max-lines N]
```
- `validate <root> <file>` — structural validation of one memory file.
- `dup-check <root> <file>` — duplicate detection.
- `index-sync <root>` — index/orphan/broken-link audit (optional `--check` in
  the README, though the implementation treats `--check` as an unknown arg —
  see discovery note).
- Defaults: `--soft-lines 300`, `--split-lines 500`, `--max-lines 800`
  (must satisfy soft < split < max).

> **Discrepancy vs. brief:** the brief asked for a `write` subcommand
> signature. It does not exist — the script's own header says "Read-only:
> validates / dedup-checks / index-checks. Never writes memory files." The
> write path is performed by the plugin (via `fs.writeText`/git), not by this
> script.

### health-check.mjs (read-only)
```
node health-check.mjs <memory-root> [--json] [--help]
```
Positional `<memory-root>` at argv[2]; `--json` for machine output.

---

## Discovery notes

- **.d.ts vs .js**: `cordis` and most `dsh-*` packages ship both
  `lib/types/*.d.ts` (typed declarations) and compiled `lib/*.js`. The
  harness's single authoritative API catalog is GENERATED and inlined into
  `dsh-tool-cordis/lib/index.js` (no separate `api-catalog.js` file), so
  event/service/builtin names were read from there.
- **`dsh-client-ui-slots` is not shipped as a standalone package**: it is
  referenced by every client UI package's `declare module
  '@deepseek-ai/dsh-client-ui-slots'` `SlotMap` merge, but no
  `node_modules/@deepseek-ai/dsh-client-ui-slots` directory exists (its types
  are a source-repo workspace package bundled into the web frontend). The slot
  KEYS were therefore taken from the generated `CLIENT_SLOT_API` in
  `dsh-cordis-client-runner/lib/client.js` and the per-package `slots.d.ts`
  declarations.
- **Session events are emitted scope-filtered**, not via a bare
  `ctx.emit("session/created")`: `dsh-session` collects scoped callbacks
  (`collectSessionCallbacks` in `dsh-session/lib/index.js`), and
  `dsh-goal` emits via `agentEvents(ctx, agent).emit("goal/changed", …)`.
  The plain `ctx.emit`/`ctx.on` methods still exist on the cordis Context
  (`cordis/lib/types/events.d.ts`).
- **Tool name configurability**: `subagent` and `workflow` tool ids are
  config defaults, not literals.
- **`--check` flag ambiguity**: `scripts/README.md` documents
  `index-sync <root> [--check]`, but `memory-crud.mjs` only parses
  `--json`/`--soft-lines`/`--split-lines`/`--max-lines`; `--check` is
  not in the implementation's accepted flags (it would hit the "Unknown option"
  path). Treat the script source as authoritative.
