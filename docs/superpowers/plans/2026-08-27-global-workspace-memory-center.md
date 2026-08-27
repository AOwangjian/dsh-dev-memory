# Global Workspace Memory Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a globally shared multi-workspace memory browser plus native conversation memory activity views.

**Architecture:** A new host registry service owns `~/.dsh/dev-memory/workspaces.json` with lock + atomic merge semantics. HTTP browsing passes an explicit workspace id without touching the live agent-derived write root. The static client registers settings, toolview, conversation-event, and turn-tail seats.

**Tech Stack:** Node.js ESM host, static CommonJS browser client, React via DSH seed-word require, Cordis/DSH slots, node:test.

**Spec:** `docs/superpowers/specs/2026-08-27-global-workspace-memory-center.md`

## Global Constraints

- Work directly on current `main` because the user explicitly declined a worktree.
- Preserve strict A write routing from live `agent.session.header.cwd`.
- Browsing never changes the active write target.
- Registry removal never deletes memory files.
- Use TDD for every production behavior.
- Keep static client free of import/export syntax.

---

### Task 1: Global Workspace Registry

**Files:**
- Create: `lib/workspaces.js`
- Test: `test/workspaces.test.js`

**Interfaces:**
- Produces `makeWorkspaceRegistry({ registryPath, projectsRoot, profile, now })`.
- Methods: `list()`, `scan()`, `upsertVerified(workspacePath)`, `markWrite(id)`, `mutate(command)`, `get(id)`.

- [ ] Write failing tests for empty creation, scan discoveries, verified upsert, sorting, rename/pin/remove, corruption backup, merge preservation, and non-destructive remove.
- [ ] Run `node --test test/workspaces.test.js` and verify RED.
- [ ] Implement normalized schema, safe path derivation, cross-process lock, temp write + rename, re-read-before-merge, stale-lock recovery, and corruption backup.
- [ ] Run registry tests and verify GREEN.
- [ ] Commit only registry files.

### Task 2: Multi-Workspace HTTP and Host Wiring

**Files:**
- Modify: `lib/http.js`
- Modify: `lib/index.js`
- Modify: `lib/orchestrator.js`
- Test: `test/http.test.js`
- Test: `test/index.test.js`
- Test: `test/orchestrator.test.js`

**Interfaces:**
- Adds GET `/workspaces`, POST `/workspaces`, and query-aware GET `/state?workspace=id`.
- Host registers live cwd and marks successful writes.

- [ ] Write failing route tests for list, selected state, unknown id, mutation origin guard, and browse/write isolation.
- [ ] Write failing host tests for session/tool upsert and lastWriteAt.
- [ ] Run focused tests and verify RED.
- [ ] Implement route handlers and registry wiring without changing `effectiveRoot` from browse requests.
- [ ] Run focused and full host tests GREEN.
- [ ] Commit host/API files.

### Task 3: Workspace Browser Panel

**Files:**
- Modify: `lib/client.js`
- Test: `test/client.test.js`

**Interfaces:**
- Fetches `/workspaces` and `/state?workspace=<id>`.
- Stores browse id in client state only.

- [ ] Write failing source/model tests for selector, search, verified/discovered labels, pin/rename/remove, and active-write vs browsing labels.
- [ ] Run client tests RED.
- [ ] Implement workspace card and route calls while retaining the 0.3.0 card design.
- [ ] Run client tests GREEN.
- [ ] Commit panel files.

### Task 4: Native Memory Tool Cards

**Files:**
- Modify: `lib/client.js`
- Test: `test/client.test.js`

**Interfaces:**
- Registers `tool.call.toolview` keys `memory_search`, `memory_write`, `memory_health`.
- Pure helpers parse running/settled tool blocks into view models.

- [ ] Write failing tests for block parsing and three slot registrations.
- [ ] Run client tests RED.
- [ ] Implement collapsed cards with observable query/result/write/health metadata and error states.
- [ ] Run client tests GREEN.
- [ ] Commit tool card files.

### Task 5: Per-Turn Memory Change Summary

**Files:**
- Modify: `lib/client.js`
- Test: `test/client.test.js`

**Interfaces:**
- Registers a `conversationEvents` definition for memory_write calls/results.
- Registers `conversation.chat.turnTail` with a selector that declines on zero successful writes.

- [ ] Write failing accumulator and selector tests for successful create/update, errors, non-write calls, dedupe, and closing seq cutoff.
- [ ] Run client tests RED.
- [ ] Implement event accumulation and compact turn-tail component.
- [ ] Run client and full tests GREEN.
- [ ] Commit turn-tail files.

### Task 6: Documentation, Review, Release, and Install

**Files:**
- Modify: `README.md`
- Modify: `package.json`

- [ ] Document global registry, browse/write isolation, conversation cards, and recovery behavior in Chinese and English.
- [ ] Run `node --test`, syntax checks, `git diff --check`, and `npm pack --dry-run --json`.
- [ ] Request independent review and fix every Critical/Important finding.
- [ ] Version as a minor release, commit, and push.
- [ ] Publish to npm, update the web profile dependency, reinstall, and verify installed files/version.
- [ ] Restart DSH and verify HTTP endpoints plus served client bundle; ask the user for the final visual refresh check.
