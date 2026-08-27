# Examples — dsh-dev-memory

本目录存放 `dsh-dev-memory` 插件的示例文件，用来直观展示「记忆长什么样」以及「三个工具怎么调用」。

This directory holds examples for `dsh-dev-memory`: what the memory looks like and
how to call the three tools.

## 文件清单 / Files

| 文件 | 内容 |
|---|---|
| [memory-tree.md](memory-tree.md) | 插件产出的记忆目录树样例（模块文件 + 索引 + `.audit/audit.jsonl`） |
| [tool-calls.md](tool-calls.md) | 三个工具的真实调用参数与 JSON 返回（`memory_search` / `memory_write` / `memory_health`） |

## 怎么用 / How to use these examples

- **memory-tree.md** 展示的是插件写入后记忆根的**目录结构**和**单文件内容**，不含可执行脚本；
  把它当作记忆格式的参考即可（字段名、段落名、frontmatter 均与 dev-memory 技能一致）。
- **tool-calls.md** 里的 JSON 就是 agent 实际传给工具的参数，以及工具返回的 JSON。
  字段名、枚举值（`fact` / `pitfall` / `open_question`、`low` / `medium` / `high`）
  都来自 `lib/index.js` 里手写的 ToolDefinition；返回结构来自 dev-memory 脚本的 `--json` 输出。

> 这些是**示例数据**，不是真实会话产物。要跑真实数据，先安装插件并在会话边界让 agent 调用
> `memory_write`，然后到 `~/.claude/projects/<slug>/memory` 下查看真实落盘结果。

---

- **memory-tree.md** shows the **directory layout** and **file contents** the plugin
  writes; it contains no executable script. Use it as a format reference (field names,
  section names, and frontmatter all match the dev-memory skill).
- **tool-calls.md** shows the exact JSON the agent passes to each tool and the JSON
  each tool returns. Field names and enum values (`fact` / `pitfall` / `open_question`,
  `low` / `medium` / `high`) come from the hand-written ToolDefinitions in
  `lib/index.js`; return shapes come from the dev-memory scripts' `--json` output.

> These are **sample data**, not real session output. To see real data, install the
> plugin, let the agent call `memory_write` at a boundary, then look under
> `~/.claude/projects/<slug>/memory`.
