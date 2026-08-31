// dsh-dev-memory — DSH interface contract (Task 1: interface discovery).
//
// HARD RULE honored: nothing here is invented. Every non-null value traces to a
// real @deepseek-ai/dsh-* source file. Full evidence (package + file + line) is
// recorded in docs/interface-contract.md, which must stay in sync with this file.
//
// Discovery source root:
//   C:\Users\wangjian\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\

export const contract = {
  // ---- Lifecycle event names (ctx.on / ctx.once) ----------------------------
  EVENTS: {
    // dsh-session — session store lifecycle (payload documented in interface-contract.md)
    SESSION_CREATED: "session/created",
    SESSION_DISPOSED: "session/disposed",
    SESSION_EVENT: "session/event", // (session, event) — post-commit append feed
    SESSION_FLUSH: "session/flush", // (session) — awaited durability checkpoint

    // dsh-agent-loop — agent lifecycle (scope-filtered; `this` is Scoped<Agent>)
    AGENT_CREATED: "agent/created", // payload { agent }
    AGENT_SESSION_START: "agent/session-start", // payload { agent, source } — use agent.inject() to seed memory
    AGENT_DISPOSED: "agent/disposed", // payload { agent }
    AGENT_STATUS: "agent/status", // payload { agent, status }
    AGENT_INBOX_INSERTED: "agent/inbox/inserted", // payload { agent, message } — user queue items can preempt a write-pass

    // dsh-goal — goal lifecycle
    GOAL_CHANGED: "goal/changed", // payload { agent, change: GoalChanged }; filter change.operation === "complete" for the write pass
    GOAL_CHANGE_SESSION_EVENT: "goal/change", // durable session-log event type (SessionEventMap), NOT a ctx.on event
  },

  // ---- Service keys (ctx.<key> / ctx.get("<key>")) --------------------------
  SERVICES: {
    SUBPROCESS: "subprocess", // dsh-subprocess: spawn(argv/cwd/stdio/signal)
    FS: "fs", // dsh-fs: resolve/stat/readText/writeText/editText/listDir
    TOOLS: "tools", // dsh-tools ToolRuntime: register/execute/schemas/restrict/guard
    TIMER: "timer", // cordis-plugin-timer: timeout/interval/throttle/debounce
    SESSIONS: "sessions", // dsh-session SessionStore: create/enter/get/list/flush/fork
    SESSION_QUERY: "sessionQuery", // dsh-session-query: searchSessions/searchEvents/readSession/listSessions
    GOALS: "goals", // dsh-goal: get/create/edit/pause/resume/complete/block/clear
    WORKSPACE_REGISTRY: "workspaceRegistry", // dsh-workspace: create/get/list/resolveByPath/delete
    SKILLS: "skills", // dsh-skill: registerProvider/register/list/get/snapshot
    SYSTEM_PROMPT: "systemPrompt", // dsh-system-prompt: section/context/tools/variable/assemble
  },

  // ---- Real DSH methods the host plugin wires against ------------------------
  // (these are DSH methods, not plugin-invented names)
  METHODS: {
    // Seed memory into the model-facing context at agent/session-start.
    INJECT_MEMORY: "Agent.inject", // inject(input: UserMessage): void — dsh-agent-loop Agent
    // Register a system-prompt section that instructs the write pass.
    INSTRUCT_WRITE_PASS: "systemPrompt.section", // section(section: PromptSection): () => void
  },

  // ---- Tool registration API + representative existing tool ids --------------
  TOOLS: {
    REGISTER: "ctx.tools.register", // register(definition: ToolDefinition): () => void
    DEFINE: "defineTool", // defineTool(options: DefineToolOptions): ToolDefinition — from @deepseek-ai/dsh-tools
    // Representative existing tool ids (dsh-tool-* packages):
    IDS: [
      "ask_user_question",
      "bash",
      "cordis_define",
      "cordis_inspect_list",
      "cordis_inspect_query",
      "cordis_inspect_self",
      "cordis_run",
      "cordis_stop",
      "cordis_undefine",
      "create_goal",
      "edit",
      "get_goal",
      "glob",
      "grep",
      "interrupt_agent",
      "job_kill",
      "job_list",
      "job_output",
      "pwsh",
      "ralph",
      "read",
      "read_image",
      "report",
      "send_message",
      "skill",
      "str_replace_editor",
      "subagent",
      "todo_write",
      "update_goal",
      "web_fetch",
      "web_search",
      "workflow",
      "write",
    ],
  },

  // ---- Client slot-name strings (register via client `slots` service) -------
  SLOTS: {
    // Primary seats for this plugin's client panel:
    SETTINGS_SECTION: "settings.section", // list, root — one settings page per entry
    SETTINGS_GENERAL_ITEM: "settings.general.item", // list, root — single preference row
    SETTINGS_PLUGINS_TAB: "settings.plugins.tab", // list, root — one Plugins settings tab
    SETTINGS_TRIGGER: "settings.trigger", // single, root — sidebar-foot settings trigger content
    SIDEBAR_SETTINGS: "sidebar.settings", // single, root — settings seat at sidebar foot
    SIDEBAR: "sidebar", // single, root
    CONVERSATION_INPUT_DOCK: "conversation.input.dock", // list, session
    SHELL_OVERLAY: "shell.overlay", // list, root
    TOOL_VIEW_CORDIS: "tool.view.cordis", // keyed, session — Package-owned region in a cordis_run card
    // Complete shipped slot surface (48 keys):
    ALL: [
      "conversation",
      "conversation.chat.assistant-actions",
      "conversation.chat.commandview",
      "conversation.chat.node",
      "conversation.chat.turnTail",
      "conversation.composer",
      "conversation.composer.bar",
      "conversation.composer.dock",
      "conversation.details.tool",
      "conversation.hero.agentPreset",
      "conversation.hero.brand.mark",
      "conversation.hero.workspace",
      "conversation.hero.workspace.directoryFlow",
      "conversation.input.attachments",
      "conversation.input.dock",
      "conversation.input.left",
      "conversation.input.model",
      "conversation.input.overlay",
      "conversation.input.plan",
      "conversation.input.right",
      "conversation.message.images",
      "conversation.session",
      "conversation.session.header",
      "conversation.session.header.actions",
      "conversation.session.header.lineage",
      "conversation.session.header.utilities",
      "conversation.view",
      "details",
      "root",
      "settings.action",
      "settings.close",
      "settings.general.item",
      "settings.header",
      "settings.onboarding",
      "settings.plugin.item",
      "settings.plugins.tab",
      "settings.section",
      "settings.trigger",
      "shell.overlay",
      "sidebar",
      "sidebar.brand.mark",
      "sidebar.brand.name",
      "sidebar.footer.action",
      "sidebar.settings",
      "sidebar.workspaces",
      "sidebar.workspaces.directoryFlow",
      "tool.call.toolview",
      "tool.view.cordis",
    ],
  },

  // ---- `harness` builtin (dynamic Host half) --------------------------------
  HARNESS: {
    // harness.handle — Package-private Client→Host JSON RPC registration.
    HANDLE: "harness.handle(method: string, handler: (args: JsonValue) => JsonValue | Promise<JsonValue>): () => void",
    // harness.defineTool — define a model-visible dynamic tool.
    DEFINE_TOOL: "harness.defineTool(definition: ToolDefinition): ToolDefinition",
    // harness.registerTool — register that tool onto a Host context.
    REGISTER_TOOL: "harness.registerTool(ctx: Context, tool: ToolDefinition): () => void",
    // Peer builtins available beside harness in the Host closure (documented in interface-contract.md):
    CTX: "ctx", // ctx.get / ctx.on / ctx.provide / ctx.effect
  },

  // ---- dev-memory scripts: exact CLI -----------------------------------------
  // (from C:\Users\wangjian\.dsh\skills\dev-memory\scripts\)
  SCRIPTS: {
    search: ["node", "search-memory.mjs", "<memory-root>", "<query>", "--top", "5", "--json", "--explain"],
    // NOTE: memory-crud.mjs has NO `write` subcommand — it is read-only.
    // Real subcommands: validate | dup-check | index-sync.
    write: ["node", "memory-crud.mjs", "<validate|dup-check|index-sync>", "<memory-root>", "[file]", "--json"],
    health: ["node", "health-check.mjs", "<memory-root>", "--json"],
  },
};
