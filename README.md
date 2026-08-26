# dsh-dev-memory

> **English summary** — `dsh-dev-memory` is a Cordis plugin for
> [DeepSeek Harness](https://github.com/deepseek-ai/dsh) (DSH) that turns the
> external *dev-memory* skill into an always-on, auto-integrated project memory.
> It auto-**queries** memory when a session starts, auto-**updates** memory at
> goal/session-end boundaries, and auto-**creates** new module memory (with a
> human gate at Level 1). It wraps the dev-memory CLI scripts — it never
> reimplements them.

## 它是什么

把 dev-memory 技能从「主动调用型 skill」升级为 DSH 原生环境能力：

- **该查询时查询** — 会话开始时自动检索并注入相关记忆（token 有界）；agent 需要时也可主动调用 `memory_search`。
- **该更新时更新** — goal 完成 / 会话结束时，通过写盘指令让 agent 调用 `memory_write` 沉淀增量。
- **该创建时创建** — 新模块按级别自动创建（Level 2-3 全自动，Level 1 保留人工确认）。

插件只是薄薄一层编排：dev-memory 的脚本（`search-memory.mjs` /
`memory-crud.mjs` / `health-check.mjs`）与规则仍是唯一真源，skill 一更新插件自动跟随，无双份漂移。

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
| `memoryRoot` | `''` → `~/.claude/projects/<slug>/memory` | 记忆根目录；slug = workspace 路径把 `:` 与 `\` 替换成 `-` |
| `scriptsDir` | `''` → `~/.dsh/skills/dev-memory/scripts` | dev-memory 脚本目录 |
| `maxInjectTokens` | `1500` | 会话开始注入记忆的 token 预算 |
| `autoWriteLevels` | `[2, 3]` | 允许自动写入的模块级别（Level 1 保留人工确认） |
| `writeConfidenceMin` | `'medium'` | 自动写入的最低置信度（低于 medium 永不自动写） |

canonical 记忆根 = `~/.claude/projects/<slug>/memory`（dev-memory 官方默认，
与 Claude Code 共享、零迁移）。记忆根建议 `git init` 以支持回滚。

## 工作原理

### 三个工具

- `memory_search` — 按需查询记忆（事实 / 踩坑 / 开放问题 / changelog）。
- `memory_write` — 从结构化 proposal 写入记忆（仅在 goal 完成 / 会话结束边界调用）。
- `memory_health` — 体检（索引一致性 / 孤儿 / 断链）。

### 注入 & 写盘

- **会话开始**：`agent/session-start` 事件 → 按当前 workspace 检索 top-2 命中 →
  按 `maxInjectTokens` 截断（整条命中保留、不切坏 JSON）→ 通过 `agent.inject()`
  注入上下文；无命中则跳过注入。
- **goal 完成 / 会话结束**：注册系统提示段 `dev-memory:write-pass`（order 116）
  + `goal/changed`(complete) 的边界提醒。钩子只发指令、不直接落盘——真正落盘发生在
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

## License

MIT
