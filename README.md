# AgentMan

A TUI orchestrator that runs multiple AI CLI agents simultaneously. One agent acts as **supervisor** — it receives every user message, decides what to delegate, dispatches subtasks to **worker** agents, collects their responses, and synthesizes a final answer.

## Architecture

```
User message
     │
     ▼
┌─────────────┐
│  Supervisor │  (e.g. qodercli, gemini)
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

## Quick Start

```bash
npm install
npm run dev
```

## Adding Agents

Use the `/add` command in the TUI:

```
/add <id> <cmd> [args…] [flags]
```

### Flags

| Flag | Description |
|------|-------------|
| `--c` or `--continue` | Resume the agent's most recent conversation history |
| `--r latest` or `--resume latest` | Resume the latest session (gemini-style) |
| `--silenceMs <n>` | Silence timeout in ms (default: 5000). How long to wait with no output before considering the response done |
| `--flag <f>` | Enable one-shot mode with the given prompt flag (e.g. `-p`) |

### Examples

```bash
# Interactive mode (default) — agent stays alive, resumes history
/add qoder qodercli --model lite --c
/add gemini gemini --r latest
/add qwen qwen --model qwen-plus --c --silenceMs 3000

# With custom silence timeout (for slower agents)
/add qoder qodercli --model lite --c --silenceMs 8000

# One-shot mode (spawns fresh process each message)
/add claude claude -p --flag -p
```

### What `--c` means

`--c` is shorthand for `--continue`. It tells the CLI to resume its previous conversation instead of starting fresh. Each agent CLI has its own flag:
- `claude --continue` / `qwen --continue` / `qodercli --continue` → use `--c`
- `gemini --resume latest` → use `--r latest`

### What `--silenceMs` means

The app detects end-of-response by watching for stdout silence. When no new output arrives for `silenceMs` milliseconds, the response is considered complete.

- **Default**: 5000ms
- **Increase** if the agent pauses mid-response (e.g., 8000-10000ms)
- **Decrease** for fast agents to reduce wait time (e.g., 3000ms)

## Keymap (tmux-style)

AgentMan is a TUI window manager: the AgentList on the left is the **taskbar**,
the OutputPanel on the right shows the **active slave's full TUI**, and your
keystrokes go straight to that slave like a real terminal. Use the **leader
key** `Ctrl+B` to talk to the master.

| Mode | Key | Action |
|------|-----|--------|
| **default** (output focused) | _any printable, ESC, arrows, Tab, Backspace, Ctrl+letter_ | → forwarded to active slave's PTY |
| | `Ctrl+B` | arm leader (status bar shows the keymap) |
| | `Ctrl+C` | exit AgentMan |
| **after `Ctrl+B`** | `i` | open master input bar (run `/commands`) |
| | `a` | focus AgentList (taskbar) |
| | `c` | cancel current slave request |
| | `0`–`9` | jump to Nth agent |
| | `b` | send literal `Ctrl+B` to slave |
| | `?` | show keymap hint |
| | `Esc` | cancel leader (no-op) |
| **AgentList focused** | `↑` `↓` | navigate the taskbar |
| | `Enter` | bring selected agent to front + return to slave |
| | `Esc` | cancel + return to slave |
| **Master input focused** | _any_ | type a `/command` |
| | `Enter` | run command + return to slave |
| | `Esc` | cancel + return to slave |
| | `Ctrl+U` | clear input line |

### Master `/commands`

| Command | Description |
|---------|-------------|
| `/add <id> <cmd> [args…]` | Add and spawn a new agent |
| `/quit [id]` | Kill agent process (default: selected) |
| `/exit [id]` / `/kill <id>` | Aliases for `/quit` |
| `/supervisor <id>` | Designate agent as supervisor |
| `/supervisor off` | Clear supervisor |
| `/send <id> <prompt>` | Send directly to a specific agent |
| `/broadcast <prompt>` | Send to all agents |
| `/pipe <from> <to>` | Auto-pipe agent A output → agent B input |
| `/unpipe <from>` | Remove pipe |
| `/select <id>` | Select agent in panel |
| `/view chat\|raw [id]` | Switch panel between cleaned chat log and full TUI relay (raw is default) |
| `/clear [id]` | Clear session history |
| `/mem set\|get\|del\|list` | Memory store at `~/.agentman/memory.json` |
| `/list` | List active agent IDs |
| `/log` | Show last 10 log entries |
| `/help` | Show available commands |
| `/app-exit` | Exit the TUI app |

## Supervisor Flow

1. **User types a message** → routes to supervisor agent
2. **Planning** — supervisor receives the prompt and decides whether to delegate or answer directly
3. **Delegation** — `DELEGATE <worker>: <task>` lines are parsed and dispatched to workers in parallel
4. **Synthesis** — worker results are fed back to supervisor, which outputs `FINAL: <answer>`

If no `DELEGATE` lines are found, the supervisor answered directly and the response is shown immediately.

## Configuration

Agents are persisted in `~/.agentman/agents.json`:

```json
{
  "qoder": {
    "id": "qoder",
    "cmd": "qodercli",
    "args": ["--model", "lite", "--continue"],
    "silenceMs": 5000,
    "color": "cyan"
  },
  "gemini": {
    "id": "gemini",
    "cmd": "gemini",
    "args": ["--resume", "latest"],
    "silenceMs": 5000,
    "color": "yellow"
  }
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/core/Agent.ts` | Spawns CLI via PTY, manages stdin/stdout, silence timeout, cancel/kill |
| `src/core/AgentManager.ts` | Registry of agents, pipes, broadcast |
| `src/core/Supervisor.ts` | Orchestration logic: plan → dispatch → synthesize |
| `src/core/AgentStore.ts` | Persist/load agent configs to `~/.agentman/agents.json` |
| `src/core/Memory.ts` | Key-value memory store at `~/.agentman/memory.json` |
| `src/core/Session.ts` | Per-agent message history at `~/.agentman/sessions/<id>.json` |
| `src/core/stripAnsi.ts` | ANSI code stripping and TUI artifact cleaning |
| `src/app.tsx` | TUI state, command parser, keyboard input |
