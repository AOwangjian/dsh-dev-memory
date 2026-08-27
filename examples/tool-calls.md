# Tool calls — 三个工具的真实调用与 JSON 返回

> 参数（入参）字段与枚举值来自 `lib/index.js` 里手写的 ToolDefinition；
> 返回结构来自 dev-memory 脚本的 `--json` 输出。均为示例数据。

---

## 1. `memory_search`

- 必填：`query`（字符串，非空）。
- 可选：`top`（正整数，最大返回条数，默认 5）。
- 底层调用 `search-memory.mjs <root> "<query>" --top N --json`，返回 `{ query, terms, results }`。
  每条结果含 `file` / `score` / `confidence` / `matched` / `suggestedRead`。

### 入参 / Invocation

```json
{
  "query": "结算 金币",
  "top": 3
}
```

### 返回 / Result

```json
{
  "query": "结算 金币",
  "terms": ["结算 金币", "结算", "金币"],
  "results": [
    {
      "file": "modules/fishing/settlement.md",
      "score": 380,
      "confidence": "high",
      "matched": [
        { "term": "结算", "source": "keywords/aliases", "count": 1, "weight": 90 },
        { "term": "金币", "source": "keywords/aliases", "count": 1, "weight": 90 },
        { "term": "结算", "source": "heading", "count": 1, "weight": 60 },
        { "term": "结算", "source": "quick judgment", "count": 1, "weight": 55 },
        { "term": "金币", "source": "quick judgment", "count": 1, "weight": 55 },
        { "term": "结算", "source": "body", "count": 3, "weight": 30 }
      ],
      "suggestedRead": ["modules/fishing/README.md", "modules/fishing/settlement.md"]
    },
    {
      "file": "modules/fishing/currency.md",
      "score": 205,
      "confidence": "high",
      "matched": [
        { "term": "金币", "source": "keywords/aliases", "count": 1, "weight": 90 },
        { "term": "金币", "source": "heading", "count": 1, "weight": 60 },
        { "term": "金币", "source": "quick judgment", "count": 1, "weight": 55 }
      ],
      "suggestedRead": ["modules/fishing/README.md", "modules/fishing/currency.md"]
    }
  ]
}
```

## 2. `memory_write`

- 必填：`proposal`（对象，`additionalProperties: false`）。
- `proposal` 字段：`module`（字符串）、`category`（枚举 `fact` | `pitfall` | `open_question`）、
  `confidence`（枚举 `low` | `medium` | `high`）、`evidence`（非空字符串数组）、
  `draft`（对象，含 `relPath` + `content`）、可选 `moduleLevel`（整数，`1` 需人工确认）。
- 仅在 goal 完成 / 会话结束边界调用；返回 `{ written, audit }` 或 `{ written: false, ... }`。

### 入参 / Invocation（合法 proposal，Level 2 自动写入）

```json
{
  "proposal": {
    "module": "fishing/settlement",
    "category": "fact",
    "confidence": "high",
    "evidence": ["src/settlement.lua"],
    "moduleLevel": 2,
    "draft": {
      "relPath": "modules/fishing/settlement.md",
      "content": "# 结算\n\n> 状态: 已验证\n> 证据来源: src/settlement.lua\n> 最近验证: 2026-08-26\n\n## 快速判断\n\n结算使用金币。"
    }
  }
}
```

### 返回 / Result（写入成功）

```json
{
  "written": true,
  "audit": {
    "sessionId": "sess_8f2a",
    "module": "fishing/settlement",
    "category": "fact",
    "confidence": "high",
    "evidenceSource": "src/settlement.lua",
    "action": "write"
  }
}
```

> `sessionId` 取当前 agent 的 `exec.agent.id`；`evidenceSource` 取 `evidence[0]`。
> 写入路径：先写 `draft.relPath` 对应文件，再跑 `index-sync` 维护索引（exit-1 = 有断链，仅提示不失败）。

### 其它返回 / Other outcomes

Level 1（`moduleLevel: 1`，新主域需人工确认）：

```json
{ "written": false, "needsConfirm": true, "reason": "Level 1 需人工确认" }
```

被分类门拒绝（`classify.js` 的精确 reason）：

```json
{ "written": false, "reason": "changelog 不落盘" }
{ "written": false, "reason": "置信度低于 medium" }
{ "written": false, "reason": "无证据清单" }
```

## 3. `memory_health`

- 无参数；返回 `{ summary, issues }`（索引一致性 / 孤儿 / 断链 / frontmatter 缺失等）。

### 入参 / Invocation

```json
{}
```

### 返回 / Result

```json
{
  "summary": {
    "memoryRoot": "C:\\Users\\you\\.claude\\projects\\D--bydk-F20-Client-Fish20\\memory",
    "markdownFiles": 6,
    "directories": 4,
    "readmes": 3,
    "memoryIndexExists": true,
    "severityCounts": { "high": 0, "medium": 1, "low": 2 }
  },
  "issues": {
    "missingReadmeDirs": [],
    "overlongFiles": [
      { "file": "modules/fishing/settlement.md", "lines": 320, "suggestion": "超过 300 行软提醒，追加前先精简" }
    ],
    "missingMeta": [],
    "missingQuickJudgment": [],
    "missingAssociatedMemory": [],
    "missingPendingVerification": [],
    "oldLineTables": [],
    "pendingEntrypoints": [],
    "brokenLinks": [],
    "duplicateLinks": [],
    "sameNameMdAndDir": [],
    "bomFiles": [],
    "replacementCharFiles": []
  }
}
```

> `memoryRoot` 是脚本返回的绝对路径；`severityCounts` 汇总各 issue 数组长度的高/中/低优先级。
