# dsh-dev-memory — DSH 记忆插件设计

> 日期: 2026-08-26 · 状态: 待审阅 (draft) · 仓库: https://github.com/AOwangjian/dsh-dev-memory

## 1. 目标与成功标准

**目标**：把 dev-memory 技能从「主动调用型 skill」升级为 DSH 原生环境能力——该查询时自动查询、该更新时自动更新、该创建时自动创建，同时不违背 dev-memory 的证据优先 / 精简 / 可回滚原则。

**成功标准**：

- 会话开始时，高置信记忆自动注入上下文（token 有界，默认 ≤1500）。
- goal / 会话结束时，含「稳定事实 / 活跃踩坑 / 开放问题」的增量被自动写入记忆（git 跟踪 + 审计记录）。
- 新模块按级别自动创建：Level 2-3 全自动，Level 1（新主域）保留一道人工确认。
- 任何自动写入都可回滚、可审查。
- 第三方可通过 `dsh plugin add github:...` 或 npm 安装。

## 2. 背景与动机

- **DSH 无内建长期知识记忆**：标准 preset（`config/agent-presets/standard/agent.cordis.yml`）无任何记忆模块；仅有会话持久化（`sessions/`）、会话内上下文压缩（`compaction-basic`）、操作型 storage（`workspace.json` 等），都不是「跨会话沉淀的、可检索的项目知识」。
- **dev-memory 是外部 skill**：靠触发词被 agent 主动加载，存在「忘读 / 忘写」缺口。读还容易靠习惯，写几乎全靠人喊。
- **DSH 是 Cordis 插件主机**：`@deepseek-ai/cordis ^4.0.1`，有 Service / Tool / Event / Slot 四个扩展点可承载记忆能力。插件形态已由 `dsh-codex-sync` 验证。

## 3. 关键决策记录

| # | 决策 | 说明 |
|---|---|---|
| D1 | 全自动写盘 + 事后安全网 | 事前「人点确认」换成事后「可回滚 + 可审查 + 可淘汰」三道闸 |
| D2 | **偏召回（对「宁可漏记不可乱记」的明确修正）** | 廉价分类门挡住流水账 + 接受多记一点 + 靠健康检查淘汰清理；宁可「多记后删」，不可「漏记后无」 |
| D3 | Token 锁死 | 不逐轮、不常驻 SKILL 全文；复用 `agent-instructions`(maxBytes 65536) + compaction/pruner 预算 |
| D4 | 触发架构 = C 混合 | 钩子负责「不错过时机」，工具 + 分类门负责「不乱记」 |
| D5 | 交付形态 = static bundle | `dsh.bundle.patch` + `cordis.patch.yml`(insert) + `dsh.client.inject`，同 `dsh-codex-sync` 模式 |
| D6 | 新模块门禁 | Level 4 全自动；Level 2-3 全自动 + 审查面板高亮；Level 1 留一道人工闸 |
| D7 | 存储路径 | `~/.claude/projects/<slug>/memory/`（可配）；`.cursor/memory` 废弃 |
| D8 | 回滚机制 | 记忆根 git init + 审计日志（before-image 可选） |
| D9 | 分发 | GitHub（`github:` 前缀）为主，npm 为辅 |

## 4. 架构

**核心原则：薄插件层，不重写 dev-memory。**

dev-memory 的脚本（`search-memory.mjs` / `memory-crud.mjs` / `health-check.mjs`）与规则（`routing.md` / `templates.md`）继续留作唯一真源；插件只负责「何时触发、怎么呈现、怎么兜底」。skill 一更新，插件自动跟随，无双份漂移。

**双平台**（同 `dsh-codex-sync`）：

- Host（`lib/index.js`）：文件 / 进程 / 生命周期 / 工具注册。
- Client（`lib/client.js`）：审查面板 + Level-1 门禁 UI。

**包结构**：

```
dsh-dev-memory/
├── package.json        # main→lib/index.js, exports"./client"→lib/client.js,
│                       #   dsh.bundle.patch→cordis.patch.yml, dsh.client{platform:web, inject:[...]}
├── cordis.patch.yml    # - insert: [{id: dev-memory, name: dsh-dev-memory, config: {...}}]
├── lib/
│   ├── index.js        # HOST：memory 服务 + 3 工具 + 生命周期钩子 + 写编排
│   ├── client.js       # CLIENT：最近写入审查面板 + Level-1 门禁提示
│   ├── classify.js     # 写前分类门（事实/坑/待解/流水）
│   └── audit.js        # 每次自动写的审计记录
└── docs/               # 本 spec 等
```

## 5. 组件

### Host（`lib/index.js`）

1. **`memory` Service**：`search(query)` / `write(draft)` / `health()`，内部走 host subprocess 服务跑 `node <scripts>/xxx.mjs <root> ...`。
2. **三个常驻工具**（注册进 tools 注册表）：
   - `memory_search` — 按需查询；
   - `memory_write` — 显式写（同时是钩子触发对象）；
   - `memory_health` — 体检 + 待淘汰条目。
3. **生命周期钩子**（`ctx.on`，概念事件名，实现前用 `cordis_inspect_list` 取真实签名）：
   - `session/start` → 检索 + 注入 top-1~2 命中；
   - `goal/complete` → 写 pass（最强信号）；
   - `session/end` → 写 pass（兜底）。
4. **写 pass 编排器**：分类门 → 路由 → 证据清单 → 草稿 → 落盘 + 审计。
5. **审计存储**：append-only，每条「何时 / 会话 / 模块 / 分类 / 置信度 / 证据来源」。

### Client（`lib/client.js`）

1. **最近写入审查面板**（sidebar 或 settings.section）：列出近期自动写，每条带「回滚」；新建模块（Level 2-3）置顶高亮。
2. **Level-1 门禁提示**：建「新主域 / 动顶层索引」时弹「是否创建新主域 X？」。

### 配置（`cordis.patch.yml` 的 config）

| 项 | 默认 |
|---|---|
| `memoryRoot` | `~/.claude/projects/<slug>/memory/`（slug = workspace 路径把 `:``\` 换成 `-`） |
| `scriptsDir` | `~/.dsh/skills/dev-memory/scripts` |
| `maxInjectTokens` | 1500 |
| `autoWriteLevels` | `[2,3]`（Level 1 留闸） |
| `writeConfidenceMin` | `medium`（low 永不自动写） |

## 6. 数据流

**查询流**：`session/start` → `memory.search(当前任务上下文)` → 注入 top-1~2 + 最近一级 README（≤1500 token）；agent 碰新模块时按需 `memory_search`。

**写流（心脏）**：`goal/complete` 或 `session/end` → 写 pass 编排器拿「本轮增量 + 现有记忆状态」→ ① 分类门（事实/坑/待解，否则停）→ ② 路由（置信度 high/medium，low 停）→ ③ 证据清单 → ④ 套模板草稿 → ⑤ 落盘 git + 审计；目标模块不存在 → 创建流。

**创建流**：路由提新模块路径 + 级别 → Level 4 全自动写；Level 2-3 全自动建 + 高亮；Level 1 弹窗确认。

## 7. 错误处理

| 情况 | 处理 |
|---|---|
| 脚本崩 | catch → 记审计 → 绝不阻塞会话；search 失败不注入，write 失败面板标「失败」 |
| 记忆根不存在 | 惰性初始化；真没有就跳过注入并记日志 |
| 低置信 | 永不自动写（分类门 + 路由双闸） |
| 并发写冲突 | 文件 git 跟踪为回滚机制；审计日志记「谁何时写了啥」 |
| 事件名缺失 | `ctx.on` 前查存在性，缺失 no-op（对齐 cordis「处理缺失」约定） |
| 审计日志膨胀 | 环形缓冲 / 周期裁剪（操作日志，非记忆） |

## 8. 测试

- 分类门单测（合成摘要断言 事实/坑/待解/流水）。
- 写 pass 集成测（假增量 + 假记忆树断言 写/不写 + 草稿）。
- 路由测（模块引用断言路由到正确模块/主域）。
- 体检测（`health-check.mjs` 跑带已知问题的假树断言标红）。
- 检索测（复用 `retrieval-benchmark.mjs` + `search-memory-cases.json`）。
- 端到端冒烟（测试 profile 模拟 session/goal 事件断言注入/写入）。

## 9. 存储路径

- canonical = `~/.claude/projects/<slug>/memory/`（dev-memory 官方默认，零迁移，与 Claude Code 共享）。
- slug 推导：workspace 路径 `:` / `\` → `-`（`D:\bydk\F20_Client\Fish20` → `D--bydk-F20_Client-Fish20`）。
- 记忆根 `git init` 以支持回滚。
- `.cursor/memory`（Cursor 平铺记忆）废弃；其存量（如 30KB DevLog）作为独立一次性迁移任务，后续处理，不属插件范围。

## 10. 分发

- **GitHub 为主**：`dsh plugin add github:AOwangjian/dsh-dev-memory`（profile 已有此模式先例）。
- **npm 为辅**：`npm publish`（需 `npm login`）；包名 `dsh-dev-memory`，`files` 只含 lib/config/docs。
- 开源要求：通用化（不写死 Fish20）、README（安装/配置/用法）、LICENSE(MIT)、规范版本号。

## 11. 风险与开放问题

- **事件真实签名未确认**：概念事件名（`session/start` 等）需实现前 `cordis_inspect_list` 确认。
- **偏召回代价**：多记会产生噪声，依赖健康检查淘汰兜底；若淘汰不及时，检索质量下降。
- **通用化程度**：dev-memory 路由主域（fishing/activities/system…）是默认值还是需做成可配 schema，实现时定。
- **并发会话写同模块**：以 git 冲突 + 审计兜底，是否需要文件级锁实现时评估。
