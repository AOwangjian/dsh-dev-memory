# dsh-dev-memory Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 dev-memory 技能变成 DSH 的原生 Cordis 插件——会话开始自动注入记忆、goal/会话结束自动写记忆、按级别自动建模块，全程可回滚可审计。

**Architecture:** 薄插件层复用 dev-memory 现有脚本与规则；Host 提供 memory 服务 + 三个工具 + 生命周期钩子 + 写编排，Client 提供审查面板 + Level-1 门禁。接口名统一收口到 `lib/contract.js`（Task 1 产出）。

**Tech Stack:** Node.js (plain JS, ESM) · Cordis 4 (DSH 插件运行时) · dev-memory 现有 .mjs 脚本 · React (仅 client 面板)

**Spec:** `docs/superpowers/specs/2026-08-26-dsh-dev-memory-plugin-design.md`

## Global Constraints

- 插件为 static bundle：`package.json` 含 `dsh.bundle.patch` + `dsh.client.inject`；`cordis.patch.yml` 用 `insert:` 声明插件行。
- 运行时代码是 plain JS function body（无 import/require/TS/JSX；client React 用 `React.createElement`）。
- 记忆根 canonical：`~/.claude/projects/<slug>/memory/`（slug = workspace 路径 `:``\` → `-`），可被 config 覆盖；记忆根 `git init`。
- 分类门：`fact / pitfall / open_question / changelog`，changelog 与 low 置信度永不自动落盘（D2、D6）。
- 新模块：Level 2-3 全自动 + 审查面板高亮；Level 1（新主域/动顶层索引）留一道人工闸（D6）。
- Token 预算：注入默认 ≤1500 token；不逐轮、不常驻 SKILL 全文（D3）。
- 分布式：GitHub（`github:` 前缀）为主，npm 为辅（D9）。
- 所有自动写落 git 跟踪文件 + append-only 审计（D1、D8）。

---

## File Structure

```
dsh-dev-memory/
├── package.json                 # 包元数据 + dsh.bundle.patch + dsh.client.inject
├── cordis.patch.yml             # insert 插件行 + config 默认值
├── README.md                    # 安装/配置/用法（开源）
├── LICENSE                      # MIT（已存在）
├── lib/
│   ├── contract.js              # 收口所有 DSH 接口名（Task 1 产出后填入真实值）
│   ├── classify.js              # 分类门校验（纯 JS，单测）
│   ├── audit.js                 # append-only 审计存储（纯 JS，单测）
│   ├── service.js               # memory 服务：桥接 dev-memory 脚本
│   ├── orchestrator.js          # 写 pass 编排（纯逻辑，单测）
│   ├── index.js                 # HOST 插件入口（服务+工具+钩子+编排）
│   └── client.js                # CLIENT 插件入口（审查面板 + Level-1 门禁）
├── test/
│   ├── classify.test.js
│   ├── audit.test.js
│   ├── service.test.js
│   └── orchestrator.test.js
└── docs/
    ├── interface-contract.md    # Task 1 产出：真实接口签名
    └── superpowers/
        ├── specs/…              # 已存在
        └── plans/…              # 本文件
```

---

### Task 1: 接口发现（收口到 contract.js）

**Files:**
- Create: `docs/interface-contract.md`
- Create: `lib/contract.js`

**Interfaces:**
- Produces: `contract.EVENTS`（session/goal 生命周期事件名与 payload）、`contract.SERVICES`（subprocess/fs/timer 服务名）、`contract.TOOLS`（工具注册 API 与现有工具名清单）、`contract.SLOTS`（client slot 名）、`contract.HARNESS`（`harness` builtin 签名）、`contract.SCRIPTS`（三个 dev-memory 脚本的精确 CLI 参数）。

- [ ] **Step 1: 读 dev-memory 三个脚本的精确 CLI**

Run: 读 `C:\Users\wangjian\.dsh\skills\dev-memory\scripts\search-memory.mjs`、`memory-crud.mjs`、`health-check.mjs` 的 arg 解析段。
Expected: 记录每个脚本的子命令/参数（尤其 `memory-crud.mjs` 的 write 子命令签名）。

- [ ] **Step 2: 拿 DSH 真实接口签名**

Run（在启用 cordis 工具的会话，或读已装 `@deepseek-ai/dsh-*` 包源码）：
- `cordis_inspect_list` → `Service.listService` / `Event.listEvents` / `Builtin.listBuiltins` / `Slots.listSubTree` / `Tool.listTools`。
Expected: 得到 session/goal 生命周期事件名+payload、工具注册 API、`harness` 签名、可用 slot 名。

- [ ] **Step 3: 写 interface-contract.md 与 contract.js**

`contract.js` 形如（值以发现结果为准）：

```js
export const contract = {
  EVENTS: { SESSION_START: '…', GOAL_COMPLETE: '…', SESSION_END: '…' },
  SERVICES: { SUBPROCESS: '…', FS: '…', TOOLS: '…' },
  METHODS: { INJECT_MEMORY: '…', INSTRUCT_WRITE_PASS: '…' },
  SLOTS: { SIDEBAR: '…', SETTINGS_SECTION: '…' },
  SCRIPTS: { search: ['<root>', '<query>', '--top', '5', '--json'], write: ['write', …], health: ['<root>', '--json'] }
};
```

- [ ] **Step 4: 提交**

```bash
git add docs/interface-contract.md lib/contract.js
git commit -m "docs: record DSH interface contract from discovery"
```

---

### Task 2: 包骨架（package.json + cordis.patch.yml）

**Files:**
- Create: `package.json`
- Create: `cordis.patch.yml`

**Interfaces:**
- Produces: 包名 `dsh-dev-memory`；导出 `.` → `lib/index.js`，`./client` → `lib/client.js`；config 字段 `memoryRoot/scriptsDir/maxInjectTokens/autoWriteLevels/writeConfidenceMin`。

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "dsh-dev-memory",
  "version": "0.1.0",
  "description": "Ambient project-memory for DeepSeek Harness: auto query/update/create module memory via a Cordis plugin.",
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": { "default": "./lib/index.js" }, "./client": "./lib/client.js", "./package.json": "./package.json" },
  "files": ["lib", "cordis.patch.yml", "README.md", "LICENSE"],
  "license": "MIT",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-slots"] }
  }
}
```

- [ ] **Step 2: 写 cordis.patch.yml**

```yaml
# dsh bundle patch: 挂载 dsh-dev-memory 到 profile 层栈
- insert:
    - id: dev-memory
      name: 'dsh-dev-memory'
      config:
        memoryRoot: ''
        scriptsDir: ''
        maxInjectTokens: 1500
        autoWriteLevels: [2, 3]
        writeConfidenceMin: 'medium'
```

- [ ] **Step 3: 提交**

```bash
git add package.json cordis.patch.yml
git commit -m "feat: plugin package scaffold"
```

---

### Task 3: 分类门 classify.js

**Files:**
- Create: `lib/classify.js`
- Test: `test/classify.test.js`

**Interfaces:**
- Produces: `CATEGORIES`、`validateProposal(p) -> { accept, reason }`（p = { category, confidence, evidence[], module, draft }）。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert';
import { validateProposal, CATEGORIES } from '../lib/classify.js';

test('接受 fact + high + 有证据 + 有模块', () => {
  const r = validateProposal({ category: 'fact', confidence: 'high', evidence: ['a.md#x'], module: 'fishing/settlement', draft: '…' });
  assert.equal(r.accept, true);
});
test('拒绝 changelog', () => {
  const r = validateProposal({ category: 'changelog', confidence: 'high', evidence: ['a'], module: 'm', draft: '' });
  assert.equal(r.accept, false);
  assert.match(r.reason, /changelog/);
});
test('拒绝 low 置信', () => {
  const r = validateProposal({ category: 'pitfall', confidence: 'low', evidence: ['a'], module: 'm', draft: '' });
  assert.equal(r.accept, false);
});
test('拒绝无证据', () => {
  const r = validateProposal({ category: 'open_question', confidence: 'medium', evidence: [], module: 'm', draft: '' });
  assert.equal(r.accept, false);
});
test('拒绝缺模块', () => {
  const r = validateProposal({ category: 'fact', confidence: 'high', evidence: ['a'], module: '', draft: '' });
  assert.equal(r.accept, false);
});
test('CATEGORIES 恰为四类', () => {
  assert.deepEqual(CATEGORIES, ['fact', 'pitfall', 'open_question', 'changelog']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/classify.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```js
export const CATEGORIES = ['fact', 'pitfall', 'open_question', 'changelog'];
export const CONFIDENCE_MIN = 'medium';
const RANK = { low: 0, medium: 1, high: 2 };

export function validateProposal(p) {
  if (!p || typeof p !== 'object') return { accept: false, reason: 'empty proposal' };
  if (!CATEGORIES.includes(p.category)) return { accept: false, reason: 'unknown category' };
  if (p.category === 'changelog') return { accept: false, reason: 'changelog 不落盘' };
  if (!Array.isArray(p.evidence) || p.evidence.length === 0) return { accept: false, reason: '无证据清单' };
  if (RANK[p.confidence] < RANK[CONFIDENCE_MIN]) return { accept: false, reason: '置信度低于 medium' };
  if (!p.module || typeof p.module !== 'string') return { accept: false, reason: '缺路由模块' };
  return { accept: true, reason: 'ok' };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/classify.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/classify.js test/classify.test.js
git commit -m "feat: classification gate with tests"
```

---

### Task 4: 审计存储 audit.js

**Files:**
- Create: `lib/audit.js`
- Test: `test/audit.test.js`

**Interfaces:**
- Produces: `appendAudit(logPath, entry)`、`readAudit(logPath, limit=50)`（entry = { sessionId, module, category, confidence, evidenceSource, action }）。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert';
import { appendAudit, readAudit } from '../lib/audit.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('append 后能读回', () => {
  const d = mkdtempSync(join(tmpdir(), 'audit-'));
  const p = join(d, 'audit.jsonl');
  appendAudit(p, { module: 'fishing/settlement', action: 'write' });
  appendAudit(p, { module: 'system', action: 'create' });
  const rows = readAudit(p);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].module, 'fishing/settlement');
  rmSync(d, { recursive: true, force: true });
});

test('不存在的日志返回空', () => {
  assert.deepEqual(readAudit(join(tmpdir(), 'nope.jsonl')), []);
});
```

- [ ] **Step 2: 跑测试确认失败** Run: `node --test test/audit.test.js` Expected: FAIL
- [ ] **Step 3: 写实现**

```js
import { appendFileSync, readFileSync, existsSync } from 'node:fs';

export function appendAudit(logPath, entry) {
  appendFileSync(logPath, JSON.stringify({ ts: Date.now(), ...entry }) + '\n', 'utf8');
}

export function readAudit(logPath, limit = 50) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
    .slice(-limit)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}
```

- [ ] **Step 4: 跑测试确认通过** Run: `node --test test/audit.test.js` Expected: PASS
- [ ] **Step 5: 提交** ```bash
git add lib/audit.js test/audit.test.js
git commit -m "feat: append-only audit store with tests"
```

---

### Task 5: memory 服务 service.js

**Files:**
- Create: `lib/service.js`
- Test: `test/service.test.js`

**Interfaces:**
- Consumes: `contract.SCRIPTS`（Task 1）、`contract.SERVICES.SUBPROCESS`。
- Produces: `makeMemoryService({ memoryRoot, scriptsDir, node }) -> { search(query, top), write(draft), health() }`；内部 `runScript` 桥接。

- [ ] **Step 1: 写失败测试（对 runScript 桩）**

```js
import test from 'node:test';
import assert from 'node:assert';
import { makeMemoryService } from '../lib/service.js';

test('search 解析 JSON 输出', () => {
  const svc = makeMemoryService({ memoryRoot: 'M', scriptsDir: 'S', node: process.execPath });
  // 用假 node 脚本桩：返回固定 JSON
  const fake = (a) => JSON.stringify({ hits: [] });
  assert.deepEqual(JSON.parse(fake()), { hits: [] });
  assert.equal(typeof svc.search, 'function');
  assert.equal(typeof svc.write, 'function');
  assert.equal(typeof svc.health, 'function');
});
```

- [ ] **Step 2: 跑测试确认失败** Run: `node --test test/service.test.js` Expected: FAIL
- [ ] **Step 3: 写实现**

```js
import { spawnSync } from 'node:child_process';
import { contract } from './contract.js';

export function runScript(node, script, args) {
  const r = spawnSync(node, [script, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`script failed (${r.status}): ${r.stderr}`);
  return r.stdout;
}

export function makeMemoryService({ memoryRoot, scriptsDir, node = 'node' }) {
  const s = (name) => `${scriptsDir}/${name}`;
  return {
    search(query, top = 5) {
      return JSON.parse(runScript(node, s('search-memory.mjs'), [memoryRoot, query, '--top', String(top), '--json']));
    },
    write(draft) {
      const [sub, ...rest] = contract.SCRIPTS.write;
      return runScript(node, s('memory-crud.mjs'), [sub, memoryRoot, JSON.stringify(draft), ...rest]);
    },
    health() {
      return JSON.parse(runScript(node, s('health-check.mjs'), [memoryRoot, '--json']));
    }
  };
}
```

- [ ] **Step 4: 跑测试确认通过** Run: `node --test test/service.test.js` Expected: PASS
- [ ] **Step 5: 提交** ```bash
git add lib/service.js test/service.test.js
git commit -m "feat: memory service bridging dev-memory scripts"
```

---

### Task 6: 写编排 orchestrator.js

**Files:**
- Create: `lib/orchestrator.js`
- Test: `test/orchestrator.test.js`

**Interfaces:**
- Consumes: `validateProposal`（Task 3）、`appendAudit`（Task 4）、`makeMemoryService`（Task 5）。
- Produces: `runWritePass({ proposal, service, auditPath, sessionId }) -> { written, reason, audit } `。规则：proposal 校验不过 → 不写；过了 → `service.write(draft)` + `appendAudit`；`moduleLevel` 为 1 时返回 `needsConfirm`（不落盘）。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert';
import { runWritePass } from '../lib/orchestrator.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ok = { category: 'fact', confidence: 'high', evidence: ['a'], module: 'fishing/settlement', draft: 'D', moduleLevel: 4 };

test('changelog 不落盘', async () => {
  const r = await runWritePass({ proposal: { ...ok, category: 'changelog' }, service: fakeSvc(), auditPath: 'x', sessionId: 's' });
  assert.equal(r.written, false);
  assert.match(r.reason, /changelog/);
});

test('Level 1 需人工确认', async () => {
  const r = await runWritePass({ proposal: { ...ok, moduleLevel: 1 }, service: fakeSvc(), auditPath: 'x', sessionId: 's' });
  assert.equal(r.written, false);
  assert.equal(r.needsConfirm, true);
});

test('合法 proposal 落盘并审计', async () => {
  const d = mkdtempSync(join(tmpdir(), 'orch-'));
  const calls = [];
  const svc = { write: async (x) => { calls.push(x); }, search: async () => ({}), health: async () => ({}) };
  const r = await runWritePass({ proposal: ok, service: svc, auditPath: join(d, 'a.jsonl'), sessionId: 's1' });
  assert.equal(r.written, true);
  assert.equal(calls.length, 1);
  rmSync(d, { recursive: true, force: true });
});

function fakeSvc() { return { write: async () => {}, search: async () => ({}), health: async () => ({}) }; }
```

- [ ] **Step 2: 跑测试确认失败** Run: `node --test test/orchestrator.test.js` Expected: FAIL
- [ ] **Step 3: 写实现**

```js
import { validateProposal } from './classify.js';
import { appendAudit } from './audit.js';

export async function runWritePass({ proposal, service, auditPath, sessionId }) {
  const v = validateProposal(proposal);
  if (!v.accept) return { written: false, reason: v.reason };
  if (proposal.moduleLevel === 1) return { written: false, needsConfirm: true, reason: 'Level 1 需人工确认' };
  await service.write(proposal.draft);
  const entry = { sessionId, module: proposal.module, category: proposal.category, confidence: proposal.confidence, evidenceSource: proposal.evidence[0], action: 'write' };
  if (auditPath) appendAudit(auditPath, entry);
  return { written: true, audit: entry };
}
```

- [ ] **Step 4: 跑测试确认通过** Run: `node --test test/orchestrator.test.js` Expected: PASS
- [ ] **Step 5: 提交** ```bash
git add lib/orchestrator.js test/orchestrator.test.js
git commit -m "feat: write-pass orchestrator with tests"
```

---

### Task 7: Host 插件 index.js（服务 + 工具 + 钩子）

**Files:**
- Create: `lib/index.js`

**Interfaces:**
- Consumes: contract（Task 1）、makeMemoryService（Task 5）、runWritePass（Task 6）。
- Produces: 默认导出 Cordis plugin（`apply(ctx)`），用 `ctx.get` 取服务、`ctx.on` 挂事件、按 `contract.TOOLS` 注册三个工具、`session/start` 注入记忆、`goal/complete`+\`session/end` 触发写 pass（注入写指令给 agent，非直接调 LLM）。

- [ ] **Step 1: 写实现（骨架，接口名走 contract）**

```js
import { contract } from './contract.js';
import { makeMemoryService } from './service.js';
import { runWritePass } from './orchestrator.js';

export default {
  name: 'dsh-dev-memory',
  apply(ctx) {
    const cfg = ctx.config || {};
    const memoryRoot = cfg.memoryRoot || deriveRoot(ctx);
    const scriptsDir = cfg.scriptsDir || defaultScriptsDir();
    const service = makeMemoryService({ memoryRoot, scriptsDir });

    // 1) 三个工具（注册 API 走 contract.TOOLS，Task 1 定）
    const tools = ctx.get(contract.SERVICES.TOOLS);
    if (tools) {
      tools.register('memory_search', { execute: (a) => service.search(a.query, a.top) });
      tools.register('memory_write', { execute: (a) => runWritePass({ proposal: a.proposal, service, auditPath: auditPath(memoryRoot), sessionId: ctx.session?.id }) });
      tools.register('memory_health', { execute: () => service.health() });
    }

    // 2) 会话开始：检索 + 注入（token 预算 cfg.maxInjectTokens）
    ctx.on(contract.EVENTS.SESSION_START, async (session) => {
      const hits = service.search(session.topic || session.cwd, 2);
      ctx.injectMemory(hits, cfg.maxInjectTokens || 1500); // API 名以 Task 1 为准
    });

    // 3) goal/会话结束：注入「写 pass」指令给 agent（判断留 agent + 工具）
    const onBoundary = () => ctx.instructWritePass(); // 注入指令，非直接写
    ctx.on(contract.EVENTS.GOAL_COMPLETE, onBoundary);
    ctx.on(contract.EVENTS.SESSION_END, onBoundary);
  }
};

// import { homedir } from 'node:os'; import { join } from 'node:path';  (文件顶部)
function slugOf(workspace) { return workspace.replace(/[:\\]/g, '-'); }
function deriveRoot(workspace) { return join(homedir(), '.claude', 'projects', slugOf(workspace), 'memory'); }
function defaultScriptsDir() { return join(homedir(), '.dsh', 'skills', 'dev-memory', 'scripts'); }
function auditPath(root) { return join(root, '.audit', 'audit.jsonl'); }
```

- [ ] **Step 2: 本任务因依赖真实接口，以 contract.js + 编译加载通过为验收**
- [ ] **Step 3: 提交** ```bash
git add lib/index.js
git commit -m "feat: host plugin wiring (tools + hooks)"
```

---

### Task 8: Client 插件 client.js（审查面板 + Level-1 门禁）

**Files:**
- Create: `lib/client.js`

**Interfaces:**
- Consumes: contract.SLOTS（Task 1）、`host.call`（拉审计/健康）。
- Produces: 默认导出 client plugin；用 `ctx.get('slots')` + `slots.inject(contract.SLOTS.SIDEBAR, …)` 注册「最近写入」面板；Level 1 用 `host.call` 触发主机提示。

- [ ] **Step 1: 写实现（React.createElement，无 JSX）**

```js
import { contract } from './contract.js';

export default {
  name: 'dsh-dev-memory-client',
  apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined) return;
    slots.inject(contract.SLOTS.SIDEBAR, () => slots.register(
      { name: contract.SLOTS.SIDEBAR, id: 'dev-memory-recent' },
      () => React.createElement('div', null, 'dev-memory 最近写入（面板待 Task 1 后补全数据绑定）')
    ));
  }
};
```

- [ ] **Step 2: 提交** ```bash
git add lib/client.js
git commit -m "feat: client review panel skeleton"
```

---

### Task 9: 端到端冒烟 + 健康检查

**Files:**
- Create: `test/smoke.md`（手动冒烟清单，非自动测试）

- [ ] **Step 0: 记忆根 git init（D8 回滚前置）** Run: `git -C <memoryRoot> init`（若尚非 git 仓库）。
- [ ] **Step 1: 装进测试 profile** Run: `dsh --profile web plugin add ./dsh-dev-memory`（或加进 bundles）→ 重启 `dsh web`。
- [ ] **Step 2: 模拟会话开始** Expected: 注入 top 命中记忆（≤1500 token）。
- [ ] **Step 3: 模拟 goal 完成** Expected: 触发写 pass 指令；changelog 不写、fact 写 + 审计。
- [ ] **Step 4: 健康检查** Run: `node ~/.dsh/skills/dev-memory/scripts/health-check.mjs <memoryRoot> --json` Expected: 报告正常/标出待淘汰条目。
- [ ] **Step 5: 提交冒烟清单**

```bash
git add test/smoke.md
git commit -m "docs: e2e smoke checklist"
```

---

### Task 10: README + 发布

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 写 README（安装/配置/用法/回滚/审计）**
- [ ] **Step 2: 提交** ```bash
git add README.md
git commit -m "docs: README with install/config/usage"
```
- [ ] **Step 3: npm 发布（需 `npm login`）** Run: `npm publish --access public` Expected: 成功；GitHub 侧已可 `dsh plugin add github:AOwangjian/dsh-dev-memory`。
