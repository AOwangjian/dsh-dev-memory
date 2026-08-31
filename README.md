# dsh-dev-memory

[![npm version](https://img.shields.io/npm/v/dsh-dev-memory)](https://www.npmjs.com/package/dsh-dev-memory)
[![license](https://img.shields.io/npm/l/dsh-dev-memory)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org/)

![demo](https://raw.githubusercontent.com/AOwangjian/dsh-dev-memory/main/docs/demo.gif)

> English readers: a complete English section follows the Chinese one — see
> [English](#english).

`dsh-dev-memory` 是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（DSH）
的 **Cordis 插件**，它把外部的 *dev-memory* 技能升级成「常开、自动集成」的项目记忆。它只在
**该查时查 / 该更新时更新 / 该创建时创建**：

- **该查时查** —— 会话开始时自动检索并注入相关记忆（token 有界）；agent 需要时也可主动调用 `memory_search`。
- **该更新时更新** —— goal 完成 / 会话结束时，通过写盘指令让 agent 调用 `memory_write` 沉淀增量。
- **该创建时创建** —— 新模块按级别自动创建（Level 2-3 全自动，Level 1 保留一道人工确认）。

插件自带这三份脚本（外加 `utils.mjs`）。本机已装 `dev-memory` 技能时优先用技能目录，没有技能则用包内副本。朋友只需 `dsh plugin add dsh-dev-memory`，不必再装技能。

## 安装

`dsh plugin` 会把剩余参数转发给 profile 目录里的 pnpm，因此等价于在 profile
目录里执行 `pnpm add`（见 `dsh --help` 的示例：
`dsh plugin --profile tui add <package>`）：

```bash
# 从 npm 安装
dsh plugin --profile <name> add dsh-dev-memory

# 开发 / 本地安装
dsh plugin --profile <name> add <local-path>
```

> `dsh --help` / `dsh plugin` 帮助里未提供 `github:` 前缀的安装形式，故此处只记录上两种经过验证的写法。

## 配置

配置写在 `cordis.patch.yml` 的 `config` 段，随 profile 层挂载：

| 键 | 默认 | 含义 |
|---|---|---|
| `memoryRoot` | `''` → 见下方默认根 | 显式记忆根。空则按工作区 slug 自动选：已有 `~/.claude/projects/<slug>/memory` 继续用；否则写到 `~/.dsh/dev-memory/projects/<slug>/memory`（不依赖 Claude Code） |
| `scriptsDir` | `''` → 本机技能脚本，否则用包内副本 | 显式配置优先；空则用 `~/.dsh/skills/dev-memory/scripts`（四个 `.mjs` 都在才用）；再没有则用包内 `scripts/`。没有 dev-memory 技能也能装着用 |
| `maxInjectTokens` | `1500` | 会话开始注入记忆的 token 预算 |
| `autoWriteLevels` | `[2, 3]` | 允许自动写入的模块级别（Level 1 保留人工确认） |
| `writeConfidenceMin` | `'medium'` | 自动写入的最低置信度（低于 medium 永不自动写） |
| `autoWrite` | `true` | 新对话的自动更新默认值。输入栏「自动记忆」只改当前对话；关掉后仍在会话开始查询并注入记忆，三个工具也仍可用 |

默认记忆根不依赖 Claude Code：没有现成的 `~/.claude/projects/<slug>/memory` 时，
写到 `~/.dsh/dev-memory/projects/<slug>/memory`。本机已有 Claude 库则继续用，零迁移。
记忆根建议 `git init` 以支持回滚。

所有 DSH profile 共用一份工作区注册表：`~/.dsh/dev-memory/workspaces.json`。
会话开始时按当前 `cwd` 自动登记；设置页可以浏览任意已登记工作区的健康状态和 changelog。
**浏览目标不会改变当前会话的写入目标。**

## 三个工具

### `memory_search` — 按需查询记忆

参数：`query`（必填，查询词）、`top`（可选，最大返回条数，默认 5）。
返回 JSON：`{ query, terms, results: [{ file, score, confidence, matched, suggestedRead }] }`。

```json
{
  "query": "结算 金币",
  "top": 3
}
```

### `memory_write` — 从结构化 proposal 写入记忆

仅在 goal 完成 / 会话结束边界调用。参数 `proposal` 必填，包含
`module` / `category`（`fact` | `pitfall` | `open_question`）/
`confidence`（`low` | `medium` | `high`）/ `evidence`（非空数组）/
`draft`（`relPath` + `content`），可选 `moduleLevel`。对话里调用 `memory_write` 就是确认，不再去设置页审核。

```json
{
  "proposal": {
    "module": "fishing/settlement",
    "category": "fact",
    "confidence": "high",
    "evidence": ["src/settlement.lua"],
    "draft": {
      "relPath": "modules/fishing/settlement.md",
      "content": "# 结算"
    }
  }
}
```

### `memory_health` — 体检

无参数。返回 `{ summary, issues }`（索引一致性 / 孤儿 / 断链等）。

```json
{}
```

完整的调用与返回示例见 [examples/tool-calls.md](examples/tool-calls.md)。

## 工作原理

### 注入 & 写盘

- **会话开始**：`agent/session-start` 事件 → 按当前 workspace 检索 top-2 命中 →
  按 `maxInjectTokens` 截断（整条命中保留、不切坏 JSON，约 4 字符/token）→ 通过
  `agent.inject()` 注入上下文；无命中则跳过注入。
- **goal 完成 / 会话结束**：当 `autoWrite` 开启时，注册系统提示段
  `dev-memory:write-pass`（order 116）+ `goal/changed`(`complete`) 与 idle 的边界提醒。
  关掉后仍在会话开始查询并注入，只停自动更新。钩子只发指令、不直接落盘——真正落盘发生在
  agent 调用 `memory_write` 时，由编排器把关。设置页开关是新对话默认；输入栏「自动记忆」只改当前对话。

### 分类门（写前把关）

`memory_write` 的 proposal 必须通过 `classify.js` 校验：

- 允许分类：`fact` / `pitfall` / `open_question`。
- `changelog` 永不落盘；置信度低于 `medium` 永不自动写。
- `evidence`（证据清单）为空时拒绝。

### 创建流 & 可回滚

- 新模块：对话里 `memory_write` 通过分类门后直接落盘。自动记忆开关只控制是否催写，不拦手动工具。
- 每次落盘后追加一条 append-only 审计（`<memoryRoot>/.audit/audit.jsonl`，
  记录 何时/会话/模块/分类/置信度/证据来源/动作）。
- 记忆根 git 跟踪 + 审计，实现「可回滚 / 可审查 / 可淘汰」。

## 架构

```
lib/
├── index.js        # HOST 插件：memory service + 3 工具 + 生命周期钩子 + HTTP + 工作区登记
├── client.js       # CLIENT：设置面板、工作区选择器、对话工具卡、回合摘要
├── workspaces.js   # 全局共享工作区注册表（锁 + 原子替换）
├── contract.js     # DSH 接口契约（事件/服务/方法/工具/slot/脚本 CLI，均有源码出处）
├── service.js      # 桥接 dev-memory CLI 脚本（search / write / health）
├── orchestrator.js # 写盘编排：分类门 → Level-1 闸 → 落盘 + 审计
├── classify.js     # 写前分类门（fact / pitfall / open_question）
├── http.js         # same-origin 状态 / 配置 / 工作区路由
└── audit.js        # append-only 审计日志
```

对话里的 `memory_search` / `memory_write` / `memory_health` 会显示可折叠工具卡；
本轮若有成功写入，回答末尾会追加「记忆变更」摘要。

## 已知限制（如实说明）

- 工作区选择器只改变面板浏览目标，不会把当前会话绑定到另一个项目。
- 默认只显示已绑定工作区；点「显示仅发现」才会扫描未绑定记忆库。
- 从列表隐藏工作区登记不会删除记忆文件，可用「取消隐藏」找回。

## 开发

```bash
# 单元测试
node --test

# 端到端冒烟（加载健全性 / profile 合成 / 真实脚本功能）
node scripts/e2e-smoke.mjs

# 本地加载
dsh plugin --profile <name> add <repo-root>
# 若要 headless 启动，再把 @deepseek-ai/dsh-headless 加入 dsh.profile.bundles
```

## 示例

- [examples/README.md](examples/README.md) — 示例索引与用法说明。
- [examples/memory-tree.md](examples/memory-tree.md) — 插件产出的记忆目录树样例。
- [examples/tool-calls.md](examples/tool-calls.md) — 三个工具的真实调用与 JSON 返回。

## License

MIT

---

# English

`dsh-dev-memory` is a **Cordis plugin** for [DeepSeek Harness](https://github.com/deepseek-ai/dsh)
(DSH) that turns the external *dev-memory* skill into an always-on, auto-integrated
project memory. It auto-**queries** memory when a session starts, auto-**updates**
memory at goal/session-end boundaries, and auto-**creates** new module memory
(with a human gate at Level 1). It wraps the dev-memory CLI scripts — it never
reimplements them.

- **Query when needed** — at session start it auto-searches and injects relevant
  memory (token-bounded); agents can also call `memory_search` on demand.
- **Update when needed** — at goal-completion / session-end boundaries it
  instructs the agent to call `memory_write` and persist the increment.
- **Create when needed** — new modules are created by level (Level 2-3 fully
  automatic, Level 1 keeps one human confirmation).

The plugin ships those three scripts (plus `utils.mjs`). A local `dev-memory`
skill directory wins when present; otherwise the packaged copy is used. Friends
only need `dsh plugin add dsh-dev-memory` — the skill is optional.

## Install

`dsh plugin` forwards its remaining arguments to pnpm in the profile directory,
so it is equivalent to running `pnpm add` there (see the `dsh --help` example:
`dsh plugin --profile tui add <package>`):

```bash
# install from npm
dsh plugin --profile <name> add dsh-dev-memory

# development / local install
dsh plugin --profile <name> add <local-path>
```

> The `dsh --help` / `dsh plugin` help text does not document a `github:`
> prefixed install form, so only the two verified forms above are listed.

## Configure

Configuration lives in the `config` block of `cordis.patch.yml` and is mounted at
the profile layer:

| Key | Default | Meaning |
|---|---|---|
| `memoryRoot` | `''` → see default root below | Explicit memory root. Empty auto-selects by workspace slug: keep `~/.claude/projects/<slug>/memory` when it already exists; otherwise write to `~/.dsh/dev-memory/projects/<slug>/memory` (no Claude Code required) |
| `scriptsDir` | `''` → local skill scripts, else the bundled copy | Explicit config wins; empty uses `~/.dsh/skills/dev-memory/scripts` when the four `.mjs` files exist; otherwise the packaged `scripts/`. Works without the dev-memory skill |
| `maxInjectTokens` | `1500` | Token budget for the memory injected at session start |
| `autoWriteLevels` | `[2, 3]` | Module levels allowed to auto-write (Level 1 keeps manual confirmation) |
| `writeConfidenceMin` | `'medium'` | Minimum confidence for auto-write (below `medium` never auto-writes) |
| `autoWrite` | `true` | Default for new conversations. The composer toggle overrides only the current session. When off, session-start search still injects; the three tools stay available |

The default memory root does not require Claude Code: if `~/.claude/projects/<slug>/memory`
is missing, writes go to `~/.dsh/dev-memory/projects/<slug>/memory`. An existing Claude
library is kept (zero migration). `git init` the memory root for rollback.

All DSH profiles share `~/.dsh/dev-memory/workspaces.json`. Live session cwd is
registered automatically. The settings panel can browse another workspace's health
and changelog; **browsing never changes the current conversation write target.**

## The three tools

### `memory_search` — query memory on demand

Args: `query` (required), `top` (optional, max results, default 5).
Returns JSON: `{ query, terms, results: [{ file, score, confidence, matched, suggestedRead }] }`.

```json
{
  "query": "settlement coins",
  "top": 3
}
```

### `memory_write` — write memory from a structured proposal

Call only at a goal-completion or session-end boundary. The `proposal` argument is
required and contains `module` / `category` (`fact` | `pitfall` | `open_question`) /
`confidence` (`low` | `medium` | `high`) / `evidence` (non-empty array) /
`draft` (`relPath` + `content`), plus optional `moduleLevel`. Calling
`memory_write` in the conversation is the confirmation; there is no settings-panel gate.

```json
{
  "proposal": {
    "module": "fishing/settlement",
    "category": "fact",
    "confidence": "high",
    "evidence": ["src/settlement.lua"],
    "draft": {
      "relPath": "modules/fishing/settlement.md",
      "content": "# Settlement"
    }
  }
}
```

### `memory_health` — health check

No args. Returns `{ summary, issues }` (index consistency, orphans, broken links).

```json
{}
```

See [examples/tool-calls.md](examples/tool-calls.md) for complete invocations and
JSON results.

## How it works

### Injection & write pass

- **Session start**: the `agent/session-start` event → search top-2 hits for the
  current workspace → truncate to `maxInjectTokens` (whole hits kept, never slices
  JSON mid-string, ~4 chars/token) → inject context via `agent.inject()`; skip
  injection when there are no hits.
- **Goal completion / session end**: when `autoWrite` is on, register the
  `dev-memory:write-pass` system-prompt section (order 116) plus boundary reminders
  on `goal/changed`(`complete`) and idle. Turning it off still injects at session
  start and leaves the three tools available. Hooks only instruct; they never write
  directly — the actual write happens when the agent calls `memory_write` and is
  gated by the orchestrator. The settings toggle is the default for new
  conversations; the composer “自动记忆” control overrides only the current session.

### Classification gate (pre-write guard)

A `memory_write` proposal must pass `classify.js`:

- Allowed categories: `fact` / `pitfall` / `open_question`.
- `changelog` is never written; confidence below `medium` never auto-writes.
- An empty `evidence` list is rejected.

### Creation flow & reversibility

- New modules: a conversation `memory_write` that passes the classification gate
  is written immediately. The auto-memory toggle only controls write-pass
  reminders; it does not block the tool.
- Every write appends an append-only audit entry
  (`<memoryRoot>/.audit/audit.jsonl`, recording when / session / module / category /
  confidence / evidence source / action).
- Git-tracked memory root + audit give rollback / review / retirement.

## Architecture

```
lib/
├── index.js        # HOST plugin: memory service + 3 tools + lifecycle hooks + HTTP + workspace registry
├── client.js       # CLIENT: settings panel, workspace selector, conversation cards, turn tail
├── workspaces.js   # globally shared workspace registry (lock + atomic replace)
├── contract.js     # DSH interface contract (events/services/methods/tools/slots/script CLI, all source-traced)
├── service.js      # bridges the dev-memory CLI scripts (search / write / health)
├── orchestrator.js # write-pass orchestration: classification gate → Level-1 gate → write + audit
├── classify.js     # pre-write classification gate (fact / pitfall / open_question)
├── http.js         # same-origin state / config / workspace routes
└── audit.js        # append-only audit log
```

Conversation `memory_search` / `memory_write` / `memory_health` calls render
collapsible cards. Successful writes also appear as a compact turn-tail summary.

## Known limitations (stated honestly)

- The workspace selector changes the panel browse target only; it does not rebind
  the current conversation write root.
- The list shows bound workspaces by default; discovered-only libraries appear after
  "显示仅发现".
- Hiding a registry entry from the list never deletes memory files.

## Development

```bash
# unit tests
node --test

# end-to-end smoke (load sanity / profile composition / real script functionality)
node scripts/e2e-smoke.mjs

# local load
dsh plugin --profile <name> add <repo-root>
# for a headless boot, also add @deepseek-ai/dsh-headless to dsh.profile.bundles
```

## Examples

- [examples/README.md](examples/README.md) — example index and usage.
- [examples/memory-tree.md](examples/memory-tree.md) — a sample memory tree the plugin creates.
- [examples/tool-calls.md](examples/tool-calls.md) — real invocations and JSON results for the three tools.

## License

MIT
