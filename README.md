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

插件只是薄薄一层编排：dev-memory 的脚本（`search-memory.mjs` / `memory-crud.mjs` /
`health-check.mjs`）与规则仍是唯一真源，skill 一更新插件自动跟随，无双份漂移。

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
| `memoryRoot` | `''` → `~/.claude/projects/<slug>/memory` | 记忆根目录；slug = workspace 路径把冒号与目录分隔符替换成 `-` |
| `scriptsDir` | `''` → `~/.dsh/skills/dev-memory/scripts` | dev-memory 脚本目录 |
| `maxInjectTokens` | `1500` | 会话开始注入记忆的 token 预算 |
| `autoWriteLevels` | `[2, 3]` | 允许自动写入的模块级别（Level 1 保留人工确认） |
| `writeConfidenceMin` | `'medium'` | 自动写入的最低置信度（低于 medium 永不自动写） |

canonical 记忆根 = `~/.claude/projects/<slug>/memory`（dev-memory 官方默认，
与 Claude Code 共享、零迁移）。记忆根建议 `git init` 以支持回滚。

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
`draft`（`relPath` + `content`），可选 `moduleLevel`（整数，1 需人工确认）。

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
- **goal 完成 / 会话结束**：注册系统提示段 `dev-memory:write-pass`（order 116）
  + `goal/changed`(`complete`) 的边界提醒。钩子只发指令、不直接落盘——真正落盘发生在
  agent 调用 `memory_write` 时，由编排器把关。

### 分类门（写前把关）

`memory_write` 的 proposal 必须通过 `classify.js` 校验：

- 允许分类：`fact` / `pitfall` / `open_question`。
- `changelog` 永不落盘；置信度低于 `medium` 永不自动写。
- `evidence`（证据清单）为空时拒绝。

### 创建流 & 可回滚

- 新模块：Level 2-3 全自动创建，Level 1（新主域）返回 `needsConfirm`，需人工确认。
- 每次落盘后追加一条 append-only 审计（`<memoryRoot>/.audit/audit.jsonl`，
  记录 何时/会话/模块/分类/置信度/证据来源/动作）。
- 记忆根 git 跟踪 + 审计，实现「可回滚 / 可审查 / 可淘汰」。

## 架构

```
lib/
├── index.js        # HOST 插件：memory service + 3 工具 + 生命周期钩子 + 写盘编排
├── client.js       # CLIENT：审查面板（静态骨架）
├── contract.js     # DSH 接口契约（事件/服务/方法/工具/slot/脚本 CLI，均有源码出处）
├── service.js      # 桥接 dev-memory CLI 脚本（search / write / health）
├── orchestrator.js # 写盘编排：分类门 → Level-1 闸 → 落盘 + 审计
├── classify.js     # 写前分类门（fact / pitfall / open_question）
└── audit.js        # append-only 审计日志
```

## 已知限制（如实说明）

- **客户端面板是静态骨架**：`lib/client.js` 是静态 `dsh.client` bundle，静态插件没有
  `host.call` 的 Client→Host RPC 通道，因此实时数据绑定（最近写入 / health）与
  Level-1 门禁 UI 尚未接通，面板目前只渲染占位内容。
- **`autoWriteLevels` / `writeConfidenceMin` 已声明但尚未接线**：
  `writeConfidenceMin` 在 `classify.js` 中硬编码为 `'medium'`；Level-1 人工确认在
  `orchestrator.js` 中硬编码（`moduleLevel === 1`）；`autoWriteLevels` 尚未被读取。
  配置接线是已记录的 TODO。

## 开发

```bash
# 单元测试（30 个用例）
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

The plugin is only a thin orchestration layer: the dev-memory scripts
(`search-memory.mjs` / `memory-crud.mjs` / `health-check.mjs`) and rules remain
the single source of truth, so the plugin follows skill updates automatically with
no double drift.

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
| `memoryRoot` | `''` → `~/.claude/projects/<slug>/memory` | Memory root; slug = workspace path with the colon and directory separator replaced by `-` |
| `scriptsDir` | `''` → `~/.dsh/skills/dev-memory/scripts` | dev-memory scripts directory |
| `maxInjectTokens` | `1500` | Token budget for the memory injected at session start |
| `autoWriteLevels` | `[2, 3]` | Module levels allowed to auto-write (Level 1 keeps manual confirmation) |
| `writeConfidenceMin` | `'medium'` | Minimum confidence for auto-write (below `medium` never auto-writes) |

The canonical memory root is `~/.claude/projects/<slug>/memory` (the dev-memory
official default, shared with Claude Code with zero migration). `git init` the
memory root for rollback.

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
`draft` (`relPath` + `content`), plus optional `moduleLevel` (integer; `1`
requires manual confirmation).

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
- **Goal completion / session end**: register the `dev-memory:write-pass`
  system-prompt section (order 116) + a boundary reminder on
  `goal/changed`(`complete`). Hooks only instruct; they never write directly —
  the actual write happens when the agent calls `memory_write` and is gated by the
  orchestrator.

### Classification gate (pre-write guard)

A `memory_write` proposal must pass `classify.js`:

- Allowed categories: `fact` / `pitfall` / `open_question`.
- `changelog` is never written; confidence below `medium` never auto-writes.
- An empty `evidence` list is rejected.

### Creation flow & reversibility

- New modules: Level 2-3 are created fully automatically; Level 1 (a new primary
  domain) returns `needsConfirm` and requires manual confirmation.
- Every write appends an append-only audit entry
  (`<memoryRoot>/.audit/audit.jsonl`, recording when / session / module / category /
  confidence / evidence source / action).
- Git-tracked memory root + audit give rollback / review / retirement.

## Architecture

```
lib/
├── index.js        # HOST plugin: memory service + 3 tools + lifecycle hooks + write-pass orchestration
├── client.js       # CLIENT: review panel (static skeleton)
├── contract.js     # DSH interface contract (events/services/methods/tools/slots/script CLI, all source-traced)
├── service.js      # bridges the dev-memory CLI scripts (search / write / health)
├── orchestrator.js # write-pass orchestration: classification gate → Level-1 gate → write + audit
├── classify.js     # pre-write classification gate (fact / pitfall / open_question)
└── audit.js        # append-only audit log
```

## Known limitations (stated honestly)

- **The client panel is a static skeleton**: `lib/client.js` is a static
  `dsh.client` bundle, and a static plugin has no `host.call` Client→Host RPC
  channel, so the live data binding (recent writes / health) and the Level-1 gate UI
  are not yet wired — the panel currently renders placeholder content only.
- **`autoWriteLevels` / `writeConfidenceMin` are declared but not yet threaded**:
  `writeConfidenceMin` is hard-coded to `'medium'` in `classify.js`; the Level-1
  manual confirmation is hard-coded in `orchestrator.js` (`moduleLevel === 1`);
  `autoWriteLevels` is not yet read. Wiring the config is a recorded TODO.

## Development

```bash
# unit tests (30 cases)
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
