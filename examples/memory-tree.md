# Memory tree — 记忆目录树样例

> 这是插件落盘后，`~/.claude/projects/<slug>/memory` 下的**目录结构**与**文件内容**样例。
> slug = workspace 路径把冒号与目录分隔符替换成 `-`。下面以 workspace
> `D:ydkF20_ClientFish20` 为例，其 slug 为 `D--bydk-F20_Client-Fish20`。

canonical 根（文档用 POSIX 形式）：

```
~/.claude/projects/D--bydk-F20_Client-Fish20/memory/
```

Windows 下的真实绝对路径：

```
C:Users<you>.claudeprojectsD--bydk-F20_Client-Fish20memory
```

> This is a sample **directory layout** and **file contents** under
> `~/.claude/projects/<slug>/memory` after the plugin writes. slug = workspace path
> with the colon and directory separator replaced by `-`. Below, for workspace
> `D:ydkF20_ClientFish20`, the slug is `D--bydk-F20_Client-Fish20`.

## 目录结构 / Layout

```
D--bydk-F20_Client-Fish20/memory/
├── MEMORY.md                    # 全局索引（health 检查其存在性）
├── README.md                    # 顶层 README 索引
├── .audit/
│   └── audit.jsonl              # append-only 审计日志
└── modules/
    ├── fishing/
    │   ├── README.md            # 模块索引，链接到子文档
    │   ├── settlement.md        # fact — 结算规则
    │   ├── currency.md          # fact — 货币
    │   └── pitfalls.md          # pitfall — 踩坑记录
    └── system/
        ├── README.md
        └── build.md             # fact — 构建/打包
```

## MEMORY.md — 全局索引

```markdown
# 项目记忆索引

- [fishing](modules/fishing/README.md) — 捕鱼玩法
- [system](modules/system/README.md) — 系统/构建
```

## modules/fishing/README.md — 模块索引

```markdown
# fishing 模块

- [结算](settlement.md)
- [货币](currency.md)
- [踩坑](pitfalls.md)
```

## modules/fishing/settlement.md — fact 文件

```markdown
# 结算

> 状态: 已验证
> 证据来源: src/settlement.lua
> 最近验证: 2026-08-26

## 检索索引

```yaml
keywords:
  - 结算
  - settlement
aliases:
  - 金币结算
entrypoints:
  - src/settlement.lua
related:
  - currency.md
```

## 快速判断

结算使用金币；结算结果由服务端下发，客户端只做展示。

## 关联记忆

- [货币](currency.md)

## 待验证

无
```

## modules/fishing/pitfalls.md — pitfall 文件

```markdown
# 结算踩坑

> 状态: 已验证
> 证据来源: src/settlement.lua
> 最近验证: 2026-08-26

## 检索索引

```yaml
keywords:
  - 踩坑
  - 结算
aliases:
  - 结算bug
entrypoints: []
related:
  - settlement.md
```

## 快速判断

结算面板复用导致金币数未刷新——必须每次进入都重置本地缓存。

## 关联记忆

- [结算](settlement.md)

## 待验证

- 新版本是否已修复该复用问题。
```

## .audit/audit.jsonl — 审计日志（append-only，每行一条）

```jsonl
{"ts":1724668800000,"sessionId":"sess_8f2a","module":"fishing/settlement","category":"fact","confidence":"high","evidenceSource":"src/settlement.lua","action":"write"}
{"ts":1724669000000,"sessionId":"sess_8f2a","module":"fishing/pitfalls","category":"pitfall","confidence":"medium","evidenceSource":"src/settlement.lua","action":"write"}
```

> 每条记录由 `lib/audit.js` 追加：`{ ts, sessionId, module, category, confidence, evidenceSource, action }`。
> `ts` 为写入时刻的 epoch 毫秒；`evidenceSource` 取 `evidence[0]`。
