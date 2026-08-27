# Global Workspace Memory Center — Design Spec

**Status:** Approved
**Date:** 2026-08-27

## Goal

Turn dsh-dev-memory into a shared local memory center: all DSH profiles share a registry of known workspaces; the settings panel can browse each workspace's health and changelog without changing the current conversation's write target; memory tool activity is visible inside the conversation as native tool cards and a per-turn write summary.

## Invariants

1. **Strict A write routing:** the current conversation writes only to `~/.claude/projects/<agent.session.header.cwd slug>/memory` unless an explicit current-session override already exists. Browsing another workspace never changes this target.
2. **Global registry:** all profiles use `~/.dsh/dev-memory/workspaces.json`.
3. **Non-destructive registry operations:** removing a registry entry never deletes workspace or memory files.
4. **Atomic concurrent updates:** registry mutations acquire a cross-process lock, re-read the latest file, merge, write a temp file, and atomically rename it.
5. **Discovered vs verified:** scanning `~/.claude/projects/*/memory` creates discovered records. Only a live session cwd creates a verified workspace binding.
6. **Conversation UI uses native seats:** `tool.call.toolview` for memory tool cards and `conversation.chat.turnTail` plus `conversationEvents` for successful per-turn memory write summaries.
7. **No hidden reasoning:** tool cards report observable memory operations and results only.

## Global Registry

Path: `~/.dsh/dev-memory/workspaces.json`.

Schema:

```json
{
  "version": 1,
  "workspaces": [
    {
      "id": "D--bydk-F20_Client-Fish20",
      "name": "Fish20",
      "workspacePath": "D:\\bydk\\F20_Client\\Fish20",
      "memoryRoot": "C:\\Users\\wangjian\\.claude\\projects\\D--bydk-F20_Client-Fish20\\memory",
      "verified": true,
      "pinned": false,
      "firstSeenAt": 1787810000000,
      "lastSeenAt": 1787813600000,
      "lastWriteAt": 1787813500000,
      "sourceProfiles": ["web"]
    }
  ]
}
```

For discovered-only records, `workspacePath` is null and `verified` is false. The id is the Claude project slug. Sorting is pinned first, then lastWriteAt, then lastSeenAt.

## Host APIs

- `GET /dsh-dev-memory/workspaces`
  - Scans existing A-convention memory directories, merges discoveries, returns registry records and current session workspace id.
- `GET /dsh-dev-memory/state?workspace=<id>`
  - Reads the selected registry record's memory root and returns config, health, and audit.
  - Without `workspace`, returns the current session workspace state.
  - Selection is read-only and never mutates the active write root.
- `POST /dsh-dev-memory/workspaces`
  - Mutations: rename, pin/unpin, remove registration, or add a verified workspace path.
  - Same-origin only. Remove affects the registry only.
- Existing `POST /dsh-dev-memory/config` remains for enable/path controls of the active session.

## Registration Flow

At `agent/session-start` and before each memory tool execution:

1. Read `agent.session.header.cwd`.
2. Derive strict A id/root.
3. Upsert verified registry record.
4. Update `lastSeenAt` and source profile.
5. On successful memory_write, update `lastWriteAt`.

At HTTP workspace-list requests, scan `~/.claude/projects/*/memory` and add unknown discovered-only records.

## Settings Panel

Add a workspace browser card above the current cards:

- searchable selector/list;
- pinned and recent workspace indicators;
- verified/discovered status;
- current conversation write target vs panel browse target shown separately;
- rename, pin, remove registration, open workspace path, and open memory path controls where possible;
- selecting a workspace only changes client browse state and reloads state with `?workspace=id`.

Health and Recent Changes display data for the selected browse workspace. The active-write configuration card remains explicitly labeled as the current conversation target.

## Conversation Tool Cards

Register native tool views:

- `memory_search`: collapsed summary with query, result count, matched files, workspace, and memory root.
- `memory_write`: create/update/write badge, relative file, summary, module/category/confidence/evidence, workspace, memory root, and timestamp.
- `memory_health`: file/directory/index/severity summary and expandable issue counts.

Cards render running, success, and error states from the standard tool block.

## Turn Tail

A client `conversationEvents` accumulator tracks calls/results for `memory_write` per turn. At turn close, `conversation.chat.turnTail` renders only successful writes:

```text
记忆变更 · 本轮 2 项
＋ 新增 fishing/settlement/new-rule.md
✎ 更新 fishing/core/live-fish-lifecycle.md
```

Search and health calls do not create turn-tail noise.

## Testing

- Registry: initial creation, discovered scan, verified upsert, merge preservation, lock/atomic write, corruption backup, pin/rename/remove non-destructive behavior.
- Routes: list, selected state, invalid workspace, mutations, same-origin guard, and browse/write isolation.
- Host: session/tool registration and lastWriteAt update.
- Client: selector requests, browsing isolation labels, toolview registrations and models, conversation event accumulator, turn-tail select behavior.
- Existing strict A and panel tests remain green.
