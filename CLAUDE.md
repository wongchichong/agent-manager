# AgentMan — Design & Implementation Spec

## What This Is

A TUI orchestrator that runs multiple AI CLI agents simultaneously. One agent acts as
**supervisor** — it receives every user message, decides what to delegate, dispatches
subtasks to **worker** agents, collects their responses, and synthesizes a final answer.

---

## Architecture

```
User message
     │
     ▼
┌─────────────┐
│  Supervisor │  (e.g. claude)
│   Agent     │  — receives full user prompt
│             │  — outputs DELEGATE lines for subtasks
└──────┬──────┘
       │  parses DELEGATE <worker>: <task>
       ▼
┌──────────────────────────────────────────┐
│              AgentManager                │
│  routes tasks to workers via their stdin │
└──┬──────────┬──────────┬─────────────────┘
   │          │          │
   ▼          ▼          ▼
 qoder      gemini      qwen        (all persistent processes)
   │          │          │
   └──────────┴──────────┘
              │
     worker responses collected
              │
              ▼
┌─────────────────────┐
│  Supervisor (again) │  receives all worker results
│  synthesizes        │  outputs FINAL: <answer>
└─────────────────────┘
              │
              ▼
        shown in TUI
```

---

## Agent Lifecycle

### Startup
- All saved agents are loaded from `~/.agentman/agents.json`
- Each agent is spawned **once** in interactive mode (no `-p` flag)
- The process stays alive for the entire session
- Communication is via **stdin** (prompts in) / **stdout** (responses out)

### Resume / History
Each CLI has a continue flag to resume its own conversation history:
- `claude  --continue` (`-c`)
- `gemini  --resume latest` (`-r latest`)
- `qwen    --continue` (`-c`)
- `qodercli --continue` (`-c`)

These flags are passed at **spawn time** (in `args`), not per message. The CLI handles
its own history internally — the app does not manage conversation history for workers.

### Response Detection (Silence Timeout)
Because interactive processes don't exit after each response, the app detects
end-of-response by watching for **stdout silence**:
- Each stdout chunk resets a timer
- When `silenceMs` elapses with no new output, `done` is emitted with the full buffer
- Default: `silenceMs = 1500` (configurable per agent in agents.json)
- Buffer is cleared before each new `send()`

### Process Control
| Action | Mechanism |
|--------|-----------|
| Cancel current request | `agent.cancel()` → sends SIGINT to process, clears buffer, status → idle |
| Kill agent permanently | `agent.kill()` → SIGTERM then SIGKILL, status → dead |
| ESC key | calls `cancel()` on selected agent if status is `thinking` |
| `/quit [id]` | calls `kill()` + removes from store |
| Ctrl+C | exits the entire TUI app |

---

## Supervisor Flow (Step by Step)

1. **User types a message** (non-slash command)
2. If a supervisor is set, message routes to `Supervisor.run(prompt)`
3. **Step 1 — Planning**: supervisor agent receives:
   ```
   You are an AI orchestrator. Workers available: qoder, gemini, qwen.
   To delegate: DELEGATE <worker_id>: <task>
   To answer directly: FINAL: <answer>

   User request: <prompt>
   ```
4. Supervisor stdout is collected until silence timeout fires
5. App parses all `DELEGATE <id>: <task>` lines from the response
6. **Step 2 — Parallel dispatch**: each delegation is sent to the worker's stdin simultaneously
7. All worker responses are collected (each via their own silence timeout)
8. **Step 3 — Synthesis**: app sends back to supervisor stdin:
   ```
   Worker results:
   [qoder]: <response>
   [gemini]: <response>
   [qwen]: <response>

   Now synthesize. Begin with FINAL:
   ```
9. Supervisor responds with `FINAL: <answer>`
10. Final answer is stored in supervisor's session and shown in output panel

**No delegation found** → supervisor answered directly with `FINAL:` → shown immediately.

---

## Agent Configuration (`~/.agentman/agents.json`)

```json
{
  "claude": {
    "id": "claude",
    "cmd": "claude",
    "args": ["--model", "claude-haiku-4-5-20251001", "--continue"],
    "silenceMs": 1500,
    "color": "blue"
  },
  "gemini": {
    "id": "gemini",
    "cmd": "gemini",
    "args": ["--resume", "latest"],
    "silenceMs": 1500,
    "color": "yellow"
  },
  "qwen": {
    "id": "qwen",
    "cmd": "qwen",
    "args": ["--continue"],
    "silenceMs": 1500,
    "color": "magenta"
  },
  "qoder": {
    "id": "qoder",
    "cmd": "qodercli",
    "args": ["--continue", "--model", "lite"],
    "silenceMs": 1500,
    "color": "cyan"
  }
}
```

No `promptFlag` → all agents use interactive stdin mode.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/core/Agent.ts` | Spawns CLI, manages stdin/stdout, silence timeout, cancel/kill |
| `src/core/AgentManager.ts` | Registry of agents, pipes, broadcast |
| `src/core/Supervisor.ts` | Orchestration logic: plan → dispatch → synthesize |
| `src/core/AgentStore.ts` | Persist/load agent configs to `~/.agentman/agents.json` |
| `src/core/Memory.ts` | Key-value memory store at `~/.agentman/memory.json` |
| `src/core/Session.ts` | Per-agent message history at `~/.agentman/sessions/<id>.json` |
| `src/app.tsx` | TUI state, command parser, keyboard input |
| `src/components/Header.tsx` | Top bar: agent count, pipes, supervisor status |
| `src/components/AgentList.tsx` | Left panel: agent list with status indicators |
| `src/components/OutputPanel.tsx` | Right panel: selected agent's conversation |
| `src/components/InputBar.tsx` | Bottom: command/message input |

---

## TUI Commands

```
/add <id> <cmd> [args…]     Add and spawn a new agent
/quit [id]                  Kill agent process (default: selected)
/exit [id]                  Alias for /quit
/kill <id>                  Alias for /quit
/supervisor <id>            Designate agent as supervisor
/supervisor off             Clear supervisor
/send <id> <prompt>         Send directly to a specific agent
/broadcast <prompt>         Send to all agents
/pipe <from> <to>           Auto-pipe agent A output → agent B input
/unpipe <from>              Remove pipe
/select <id>                Select agent in panel
/clear [id]                 Clear session history
/mem set <key> <value>      Store memory entry
/mem get <key>              Read memory entry
/mem del <key>              Delete memory entry
/mem list                   List all memory
/list                       List active agent IDs
/log                        Show last 10 log entries
/app-exit                   Exit the TUI app
ESC                         Cancel current in-progress request
Ctrl+C                      Exit the TUI app
```

---

## What Needs Implementing

The following are **not yet done** — implement in order:

### 1. `Agent.ts` — Silence timeout for interactive mode
- Add `silenceMs` from config (default 1500)
- In `spawnInteractive()`: on each stdout chunk, reset a silence timer
- When timer fires and status is `thinking`: emit `done(buf)`, clear buf, set status idle
- `send()` in interactive mode: clear buf before writing to stdin
- `cancel()`: send SIGINT, clear buf, cancel timer, set idle

### 2. `agents.json` — Switch all agents to interactive mode
- Remove `promptFlag` from all entries
- Add `-c`/`--continue` or `--resume latest` to `args`
- Add cheapest model to `args`
- Add `silenceMs: 1500`

### 3. `Supervisor.ts` — Already written, verify it works with interactive agents
- `callAgent()` uses `agent.send()` which now routes to stdin → silence timeout → done
- No changes needed if Agent.ts is correct

### 4. `types.ts` — Add `silenceMs?: number` to `AgentConfig`
