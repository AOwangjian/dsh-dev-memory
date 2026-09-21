# dsh-dev-memory

[![npm version](https://img.shields.io/npm/v/dsh-dev-memory)](https://www.npmjs.com/package/dsh-dev-memory)
[![license](https://img.shields.io/npm/l/dsh-dev-memory)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org/)

![demo](https://raw.githubusercontent.com/AOwangjian/dsh-dev-memory/main/docs/demo.gif)

> English: see [English](#english).

面向 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（DSH）的 **轻量项目记忆库**。
记忆是普通 markdown；插件在会话开始检索并注入，在合适的边界提醒写入。

## 能力

- **自动检索** — 会话开始时按当前工作区检索相关记忆，按 token 预算注入上下文。
- **按需查询** — `memory_search`
- **结构化写入** — `memory_write`（分类门：`fact` / `pitfall` / `open_question`，需证据）
- **健康检查** — `memory_health`（索引、孤儿、断链）
- **自动更新（可关）** — idle / goal 完成时提醒写盘；输入栏「自动记忆」只改当前对话
- **写盘可停** — 输入框上方「正在写入记忆 / 停止」；用户排队消息会打断催写并优先处理

对话里调用 `memory_write` 即为确认，不再经过设置页审核。

## 依赖

| 需要 | 说明 |
|---|---|
| Node.js ≥ 18 | 运行时 |
| [DeepSeek Harness](https://github.com/deepseek-ai/dsh) | 作为 DSH Cordis 插件加载（例如 `dsh web`） |

运行时脚本随 npm 包发布，安装插件即可，无需额外技能或其它工具链。

## 安装

```bash
dsh plugin --profile <name> add dsh-dev-memory
```

开发安装：`dsh plugin --profile <name> add <local-path>`。

安装后 **重启 DSH**。profile 里是静态副本，当前进程不会热替换。

## 记忆存在哪

每个工作区一份 markdown 目录。slug = 工作区路径中的 `:`、`\`、`/`、`_` 换成 `-`。

默认根目录：`~/.dsh/dev-memory/projects/<slug>/memory`

若该工作区已经存在 `~/.claude/projects/<slug>/memory`，则继续使用它（兼容已有库）。也可用配置项 `memoryRoot` 指定任意路径。

建议对记忆根 `git init`。所有 DSH profile 共用 `~/.dsh/dev-memory/workspaces.json`。
设置页可浏览其它工作区，**不会改变当前会话的写入目标**。

## 配置

写在 `cordis.patch.yml` 的 `config` 段：

| 键 | 默认 | 含义 |
|---|---|---|
| `memoryRoot` | `''`（自动） | 显式记忆根；空则按上一节规则选择 |
| `scriptsDir` | `''`（包内脚本） | 覆盖运行时脚本目录；空则使用插件自带脚本 |
| `maxInjectTokens` | `1500` | 会话开始注入的 token 预算 |
| `writeConfidenceMin` | `'medium'` | 写入最低置信度 |
| `autoWrite` | `true` | 新对话是否自动催写。关掉后仍会在会话开始检索，三个工具仍可用 |
| `jev.enabled` | `false` | 开启 TypeSafe Jev 结构化决策工具与使用策略 |
| `jev.apiKeyEnv` | `'TYPESAFE_API_KEY'` | Jev API Key 的 DSH credential 引用名 |
| `jev.model` | `'jev-latest'` | Jev 模型名 |

设置页「新对话默认」写入 `~/.dsh/dev-memory/config.json`，重启后仍有效。输入栏「自动记忆」只覆盖**当前对话**（`session-auto-write.json`）。

### Jev 结构化决策（默认关闭）

Jev 是可选的结构化决策能力，不是第二个聊天模型。开启后会注册 `jev_decide`，适合有限选项、分类、评分、二元/概率判断与重复的独立判断；代码生成、架构设计、开放式研究仍由主模型处理。

```yaml
jev:
  enabled: true
  policyInjection:
    enabled: true
  apiKeyEnv: TYPESAFE_API_KEY
  model: jev-latest
```

可在插件设置页直接保存、轮换或清除 API Key：DSH credentials store 会保存实际值，普通插件配置只保存 `apiKeyEnv` 引用，页面永不回显密钥。也可由 DSH Host 环境变量提供同名 key；环境变量优先且会显示为只读。绝不要将 key 写进 `cordis.patch.yml` 或仓库。缺少 key、网络故障、限流或 API 异常时，`jev_decide` 返回可消费的 unavailable 结果，主模型可继续完成任务。

## 工具

**`memory_search`** — `query`（必填），`top`（可选，默认 5）。

**`memory_write`** — `proposal`：`module`、`category`、`confidence`、`evidence`（非空）、`draft.relPath` + `draft.content`。`changelog` 不落盘。

**`memory_health`** — 无参数。

启用 Jev 后，**`jev_decide`** 接收 `state` 和命名的 `choice`、`score`、`noul` questions，并返回 TypeSafe 的 typed answers。

示例：[examples/tool-calls.md](examples/tool-calls.md)。

## 限制

- 这是 DSH 插件，不能脱离 DSH 运行。
- 设置页浏览其它工作区不会切换当前写入根。
- 从列表隐藏工作区不会删除记忆文件。

## 开发

```bash
node --test
dsh plugin --profile <name> add <repo-root>
```

## License

MIT

---

# English

A **lightweight project memory library** for [DeepSeek Harness](https://github.com/deepseek-ai/dsh).
Memory is plain markdown. The plugin retrieves at session start and prompts for writes at the right boundaries.

## Capabilities

- **Auto retrieve** — search and inject workspace memory at session start (token-bounded)
- **On-demand search** — `memory_search`
- **Structured write** — `memory_write` (categories: `fact` / `pitfall` / `open_question`; evidence required)
- **Health check** — `memory_health`
- **Optional auto-update** — idle / goal-complete write-pass; composer toggle is per conversation
- **Stoppable write-pass** — status row above the composer; a queued user message preempts it

Calling `memory_write` in the conversation is the confirmation.

## Dependencies

| Required | Notes |
|---|---|
| Node.js ≥ 18 | Runtime |
| [DeepSeek Harness](https://github.com/deepseek-ai/dsh) | Loaded as a Cordis plugin (e.g. `dsh web`) |

Runtime scripts ship in the npm package. No extra skill or toolchain.

## Install

```bash
dsh plugin --profile <name> add dsh-dev-memory
```

Restart DSH after install.

## Where memory lives

One markdown tree per workspace. Slug = workspace path with `:` `\` `/` `_` replaced by `-`.

Default: `~/.dsh/dev-memory/projects/<slug>/memory`

If `~/.claude/projects/<slug>/memory` already exists, that library is reused. Override with `memoryRoot`.

## Configure

| Key | Default | Meaning |
|---|---|---|
| `memoryRoot` | `''` (auto) | Explicit memory root |
| `scriptsDir` | `''` (bundled) | Override script directory |
| `maxInjectTokens` | `1500` | Session-start inject budget |
| `writeConfidenceMin` | `'medium'` | Minimum write confidence |
| `autoWrite` | `true` | Auto write-pass for **new** conversations |
| `jev.enabled` | `false` | Enable the TypeSafe Jev structured-decision tool and policy |
| `jev.apiKeyEnv` | `'TYPESAFE_API_KEY'` | DSH credential reference for the Jev API key |
| `jev.model` | `'jev-latest'` | Jev model name |

The settings “new conversation default” is stored in `~/.dsh/dev-memory/config.json` and survives restart. The composer control overrides the current session only.

### Jev structured decisions (off by default)

Jev is an optional structured-decision capability, not a second chat model. When enabled it registers `jev_decide` for bounded choices, classification, scoring, binary/probabilistic judgement, and repeated independent decisions. The main model remains responsible for code generation, architecture, and open-ended research.

```yaml
jev:
  enabled: true
  policyInjection:
    enabled: true
  apiKeyEnv: TYPESAFE_API_KEY
  model: jev-latest
```

Use the plugin settings panel to save, rotate, or clear the API key. DSH credentials stores the actual value while ordinary plugin config stores only the `apiKeyEnv` reference, and the UI never returns the value. A same-named DSH Host environment variable also works; it takes precedence and is shown as read-only. Never put a key in `cordis.patch.yml` or source control. Missing keys, network failures, rate limits, and API failures return a consumable unavailable result so the main model can continue.

## License

MIT
