import React, { useState, useEffect, useCallback, useReducer, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { AgentManager } from './core/AgentManager.js';
import { loadSession, appendMessage, clearSession } from './core/Session.js';
import { memSet, memGet, memDel, memList } from './core/Memory.js';
import { Header } from './components/Header.js';
import { AgentList } from './components/AgentList.js';
import { OutputPanel, OutputView } from './components/OutputPanel.js';
import { MemoryBar } from './components/MemoryBar.js';
import { InputBar } from './components/InputBar.js';
import { agentStoreSave, agentStoreRemove, agentStoreList } from './core/AgentStore.js';
import { Supervisor } from './core/Supervisor.js';
import { encodeKeystroke } from './core/keys.js';
import {
  AgentConfig,
  AgentStatus,
  AgentSession,
  LogEntry,
  MemoryEntry,
  Panel,
  PipeConfig,
} from './types.js';

// ── State ─────────────────────────────────────────────────────────────────────

interface AgentRow {
  id: string;
  status: AgentStatus;
  color: string;
  lineCount: number;
  session: AgentSession;
}

interface AppState {
  agents: AgentRow[];
  pipes: PipeConfig[];
  selectedId: string | null;
  memory: MemoryEntry[];
  log: LogEntry[];
  liveChunks: Record<string, string>;
  panel: Panel;
  cursor: number;
  scrollOffset: number;
  inputValue: string;
  hint: string;
  supervisorId: string | null;
  supervisorStep: string;
  /** Per-agent view mode (chat | raw). Defaults to chat. */
  viewModes: Record<string, OutputView>;
  /** Per-agent latest screen snapshot rows (ANSI). Updated on agentScreen. */
  screens: Record<string, string[]>;
  /** Bumped to force re-read of snapshot when screen event fires. */
  screenTick: number;
  /** True between a Ctrl+B and the next keystroke (leader is armed). */
  leaderArmed: boolean;
}

type Action =
  | { type: 'SET_INPUT'; value: string }
  | { type: 'SET_HINT'; hint: string }
  | { type: 'SET_PANEL'; panel: Panel }
  | { type: 'SET_CURSOR'; cursor: number }
  | { type: 'SET_SCROLL'; offset: number }
  | { type: 'SELECT'; id: string | null }
  | { type: 'AGENTS_CHANGED'; agents: AgentRow[] }
  | { type: 'PIPES_CHANGED'; pipes: PipeConfig[] }
  | { type: 'AGENT_STATUS'; id: string; status: AgentStatus }
  | { type: 'AGENT_DATA'; id: string; chunk: string }
  | { type: 'AGENT_DONE'; id: string; full: string }
  | { type: 'AGENT_SCREEN'; id: string; rows: string[] }
  | { type: 'SET_VIEW'; id: string; view: OutputView }
  | { type: 'MEMORY_CHANGED'; memory: MemoryEntry[] }
  | { type: 'LOG'; entry: LogEntry }
  | { type: 'SET_SUPERVISOR'; id: string | null }
  | { type: 'SUPERVISOR_STEP'; step: string }
  | { type: 'LEADER_ARMED'; armed: boolean };

const AGENT_COLORS = ['cyan', 'magenta', 'yellow', 'green', 'blue', 'red', 'white'];
let colorIdx = 0;
function nextColor(): string {
  return AGENT_COLORS[colorIdx++ % AGENT_COLORS.length];
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, inputValue: action.value };
    case 'SET_HINT':
      return { ...state, hint: action.hint };
    case 'SET_PANEL':
      return { ...state, panel: action.panel };
    case 'SET_CURSOR':
      return { ...state, cursor: action.cursor };
    case 'SET_SCROLL':
      return { ...state, scrollOffset: action.offset };
    case 'SELECT':
      return { ...state, selectedId: action.id, scrollOffset: 0 };
    case 'AGENTS_CHANGED': {
      const clamped = Math.min(state.cursor, Math.max(0, action.agents.length - 1));
      return { ...state, agents: action.agents, cursor: clamped };
    }
    case 'PIPES_CHANGED':
      return { ...state, pipes: action.pipes };
    case 'AGENT_STATUS':
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === action.id ? { ...a, status: action.status } : a
        ),
      };
    case 'AGENT_DATA':
      return {
        ...state,
        liveChunks: {
          ...state.liveChunks,
          [action.id]: (state.liveChunks[action.id] ?? '') + action.chunk,
        },
      };
    case 'AGENT_DONE': {
      // Clear live chunk; session update happens via effect
      const { [action.id]: _dropped, ...rest } = state.liveChunks;
      return { ...state, liveChunks: rest };
    }
    case 'AGENT_SCREEN':
      return {
        ...state,
        screens: { ...state.screens, [action.id]: action.rows },
        screenTick: state.screenTick + 1,
      };
    case 'SET_VIEW':
      return {
        ...state,
        viewModes: { ...state.viewModes, [action.id]: action.view },
      };
    case 'MEMORY_CHANGED':
      return { ...state, memory: action.memory };
    case 'LOG': {
      const log = [...state.log, action.entry].slice(-200);
      return { ...state, log };
    }
    case 'SET_SUPERVISOR':
      return { ...state, supervisorId: action.id, supervisorStep: '' };
    case 'SUPERVISOR_STEP':
      return { ...state, supervisorStep: action.step };
    case 'LEADER_ARMED':
      return { ...state, leaderArmed: action.armed };
    default:
      return state;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function syncAgents(manager: AgentManager): AgentRow[] {
  return manager.listAgents().map((a) => ({
    id: a.config.id,
    status: a.status,
    color: a.config.color,
    lineCount: a.lines.length,
    session: loadSession(a.config.id),
  }));
}

// ── App ───────────────────────────────────────────────────────────────────────

const manager = new AgentManager();
let supervisor: Supervisor | null = null;

export default function App() {
  const { exit } = useApp();

  const [state, dispatch] = useReducer(reducer, {
    agents: [],
    pipes: [],
    selectedId: null,
    memory: memList(),
    log: [],
    liveChunks: {},
    panel: 'output',
    cursor: 0,
    scrollOffset: 0,
    inputValue: '',
    hint: '',
    supervisorId: null,
    supervisorStep: '',
    viewModes: {},
    screens: {},
    screenTick: 0,
    leaderArmed: false,
  });

  // ── Subscribe to manager events ───────────────────────────────────────────
  useEffect(() => {
    const log = (level: LogEntry['level'], message: string) =>
      dispatch({ type: 'LOG', entry: { level, message, ts: Date.now() } });

    const onChanged = () => {
      dispatch({ type: 'AGENTS_CHANGED', agents: syncAgents(manager) });
    };
    const onPipes = () => {
      dispatch({ type: 'PIPES_CHANGED', pipes: manager.listPipes() });
    };
    const onStatus = (id: string) => {
      const agent = manager.getAgent(id);
      if (agent) {
        dispatch({ type: 'AGENT_STATUS', id, status: agent.status });
        if (agent.status === 'error') log('error', `agent "${id}" errored`);
        if (agent.status === 'dead') log('warn', `agent "${id}" process exited`);
      }
    };
    const onData = (id: string, chunk: string) => {
      // Skip when not relevant to the current view. Raw mode shows the
      // snapshot, never the streaming liveChunks; non-selected agents
      // aren't shown either. Both cases would re-render App for nothing
      // and (with lots of slave output) flicker the chrome.
      if (id !== selectedIdRef.current) return;
      const view = viewModesRef.current[id] ?? 'raw';
      if (view === 'raw') return;
      dispatch({ type: 'AGENT_DATA', id, chunk });
    };
    const onDone = (id: string, full: string) => {
      dispatch({ type: 'AGENT_DONE', id, full });
      // Persist to session
      const agent = manager.getAgent(id);
      if (agent && full.trim()) {
        const session = loadSession(id);
        appendMessage(session, { role: 'agent', content: full.trim(), ts: Date.now() });
        // Refresh agents (session updated)
        dispatch({ type: 'AGENTS_CHANGED', agents: syncAgents(manager) });
        log('success', `agent "${id}" replied (${full.trim().length} chars)`);
      }
    };
    const onScreen = (id: string) => {
      // Only update screens for the currently-selected agent — others aren't
      // shown anywhere, so re-rendering on every byte they emit is wasted
      // work that flickers the chrome via Ink's clear-and-redraw cycle.
      if (id !== selectedIdRef.current) return;
      const agent = manager.getAgent(id);
      if (!agent) return;
      dispatch({ type: 'AGENT_SCREEN', id, rows: agent.snapshot() });
    };

    manager.on('agentsChanged', onChanged);
    manager.on('pipesChanged', onPipes);
    manager.on('agentStatus', onStatus);
    manager.on('agentData', onData);
    manager.on('agentDone', onDone);
    manager.on('agentScreen', onScreen);

    return () => {
      manager.off('agentsChanged', onChanged);
      manager.off('pipesChanged', onPipes);
      manager.off('agentStatus', onStatus);
      manager.off('agentData', onData);
      manager.off('agentDone', onDone);
      manager.off('agentScreen', onScreen);
    };
  }, []);

  // ── Load persisted agents on startup ─────────────────────────────────────
  useEffect(() => {
    const saved = agentStoreList();
    for (const config of saved) {
      try {
        manager.add(config);
      } catch {
        // Already exists or broken config — skip silently
      }
    }
    if (saved.length > 0) {
      dispatch({ type: 'SELECT', id: saved[0].id });
    }
  }, []);

  // Clear hint after 3s
  useEffect(() => {
    if (!state.hint) return;
    const t = setTimeout(() => dispatch({ type: 'SET_HINT', hint: '' }), 3000);
    return () => clearTimeout(t);
  }, [state.hint]);

  // Ref mirror of panel — keeps Tab cycling correct when keystrokes arrive
  // back-to-back within a single React tick (state hasn't re-rendered yet).
  const panelRef = useRef(state.panel);
  panelRef.current = state.panel;

  // Ref mirror of selectedId — used by the screen-event handler to skip
  // dispatches for non-selected agents (their snapshots aren't shown, so
  // re-rendering on every byte they emit is pure waste).
  const selectedIdRef = useRef(state.selectedId);
  selectedIdRef.current = state.selectedId;

  // Ref mirror of viewModes — onData skips dispatch in raw mode (snapshot
  // is the source of truth there; liveChunks would just churn re-renders).
  const viewModesRef = useRef(state.viewModes);
  viewModesRef.current = state.viewModes;

  // Leader-key state. When true, the NEXT keystroke is a master command.
  // tmux-style: Ctrl+B then i / a / c / 0..9 / b / ?.
  const leaderArmedRef = useRef(false);

  // ── Keyboard input ────────────────────────────────────────────────────────
  // Routing precedence:
  //   1. Leader-armed?           → consume one key as a master command
  //   2. Ctrl+B (the leader key) → arm, swallow
  //   3. panel === 'output'      → forward keystrokes to slave PTY
  //   4. panel === 'agents'      → arrow / enter navigate the taskbar
  //   5. panel === 'input'       → InputBar consumes (its own useInput)
  useInput((input, key) => {
    // 1. Leader command: previous keystroke was Ctrl+B; this one is the verb.
    if (leaderArmedRef.current) {
      leaderArmedRef.current = false;
      dispatch({ type: 'LEADER_ARMED', armed: false });
      // Cancel leader on Esc
      if (key.escape) { hint('leader cancelled'); return; }

      if (input === 'i' || input === ':') {
        panelRef.current = 'input';
        dispatch({ type: 'SET_PANEL', panel: 'input' });
        hint('input: type a /command, Enter to run, Esc to cancel');
        return;
      }
      if (input === 'a') {
        panelRef.current = 'agents';
        dispatch({ type: 'SET_PANEL', panel: 'agents' });
        return;
      }
      if (input === 'c') {
        if (state.selectedId) {
          const agent = manager.getAgent(state.selectedId);
          if (agent?.status === 'thinking') {
            agent.cancel();
            hint(`cancelled "${state.selectedId}"`);
          }
        }
        return;
      }
      // 0-9 picks the Nth agent and brings it forward
      if (input && /^[0-9]$/.test(input)) {
        const idx = parseInt(input, 10);
        const target = state.agents[idx];
        if (target) {
          dispatch({ type: 'SELECT', id: target.id });
          dispatch({ type: 'SET_CURSOR', cursor: idx });
          panelRef.current = 'output';
          dispatch({ type: 'SET_PANEL', panel: 'output' });
        }
        return;
      }
      // 'b' = forward a literal Ctrl+B to the slave (escape the leader)
      if (input === 'b' && state.selectedId) {
        manager.getAgent(state.selectedId)?.write('\x02');
        return;
      }
      if (input === '?') {
        hint('Ctrl+B then  i input · a agents · c cancel · 0-9 pick · b literal');
        return;
      }
      hint(`leader: unknown "${input || '?'}"`);
      return;
    }

    // 2. Arm leader on Ctrl+B
    if (key.ctrl && (input === 'b' || input === 'B')) {
      leaderArmedRef.current = true;
      dispatch({ type: 'LEADER_ARMED', armed: true });
      return;
    }

    // 3. Output panel = slave passthrough. Encode and forward everything.
    if (panelRef.current === 'output' && state.selectedId) {
      const bytes = encodeKeystroke(input, key);
      if (bytes !== null) manager.getAgent(state.selectedId)?.write(bytes);
      return;
    }

    // 4. Taskbar (agents panel) navigation
    if (panelRef.current === 'agents') {
      if (key.upArrow) {
        const next = Math.max(0, state.cursor - 1);
        dispatch({ type: 'SET_CURSOR', cursor: next });
        const agent = state.agents[next];
        if (agent) dispatch({ type: 'SELECT', id: agent.id });
        return;
      }
      if (key.downArrow) {
        const next = Math.min(state.agents.length - 1, state.cursor + 1);
        dispatch({ type: 'SET_CURSOR', cursor: next });
        const agent = state.agents[next];
        if (agent) dispatch({ type: 'SELECT', id: agent.id });
        return;
      }
      if (key.return && state.agents[state.cursor]) {
        dispatch({ type: 'SELECT', id: state.agents[state.cursor].id });
        panelRef.current = 'output';
        dispatch({ type: 'SET_PANEL', panel: 'output' });
        return;
      }
      if (key.escape) {
        panelRef.current = 'output';
        dispatch({ type: 'SET_PANEL', panel: 'output' });
        return;
      }
      return;
    }

    // 5. panel === 'input' — InputBar handles it via its own useInput.
    //    We only intercept Esc to bail back to output mode.
    if (panelRef.current === 'input' && key.escape) {
      panelRef.current = 'output';
      dispatch({ type: 'SET_PANEL', panel: 'output' });
      dispatch({ type: 'SET_INPUT', value: '' });
      return;
    }
  });

  // ── Command parser ────────────────────────────────────────────────────────
  const hint = useCallback((msg: string) => dispatch({ type: 'SET_HINT', hint: msg }), []);
  // Stable onChange so memoised InputBar isn't invalidated every parent render.
  const onInputChange = useCallback(
    (v: string) => dispatch({ type: 'SET_INPUT', value: v }),
    [],
  );

  const handleSubmit = useCallback(
    (raw: string) => {
      // After every submit, return to slave-passthrough mode.
      const finish = () => {
        panelRef.current = 'output';
        dispatch({ type: 'SET_PANEL', panel: 'output' });
      };
      if (!raw.trim()) { finish(); return; }

      if (!raw.startsWith('/')) {
        // Route through supervisor if one is set
        if (state.supervisorId && supervisor) {
          if (supervisor.running) {
            hint('Supervisor is busy — wait for it to finish');
            finish(); return;
          }
          // Record user message in supervisor's session
          const supSession = loadSession(state.supervisorId);
          appendMessage(supSession, { role: 'user', content: raw, ts: Date.now() });
          dispatch({ type: 'AGENTS_CHANGED', agents: syncAgents(manager) });
          supervisor.run(raw);
          finish(); return;
        }
        // Direct message to selected agent
        if (!state.selectedId) {
          hint('No agent selected — use /add or /supervisor first');
          finish(); return;
        }
        try {
          const session = loadSession(state.selectedId);
          appendMessage(session, { role: 'user', content: raw, ts: Date.now() });
          manager.send(state.selectedId, raw);
          dispatch({ type: 'AGENTS_CHANGED', agents: syncAgents(manager) });
        } catch (e: any) {
          hint(`Error: ${e.message}`);
        }
        finish(); return;
      }

      // Parse slash command
      // Tokenise respecting quoted strings
      const tokens = tokenise(raw.slice(1));
      const cmd = tokens[0]?.toLowerCase();
      const args = tokens.slice(1);

      switch (cmd) {
        case 'add': {
          // /add <id> <cmd> [args…] [--resume latest|<id>|new] [--silenceMs <n>] [--flag <flag>]
          // One-shot with resume:  /add qoder qodercli --model lite --flag -p --resume latest
          // One-shot new session: /add qoder qodercli --model lite --flag -p --resume new
          if (args.length < 2) {
            hint('Usage: /add <id> <cmd> [args…] --flag -p --resume latest|new|<sessionId>');
            break;
          }
          const id = args[0];
          const binCmd = args[1];

          let promptFlag: string | undefined;
          let sessionResume: string | undefined;
          let silenceMs: number | undefined;
          const restArgs: string[] = [];

          for (let i = 2; i < args.length; i++) {
            if (args[i] === '--flag' && args[i + 1]) {
              promptFlag = args[i + 1];
              i++;
            } else if (args[i] === '--resume' && args[i + 1]) {
              sessionResume = args[i + 1];
              i++;
            } else if (args[i] === '--silenceMs' && args[i + 1]) {
              silenceMs = parseInt(args[i + 1], 10);
              i++;
            } else {
              restArgs.push(args[i]);
            }
          }

          try {
            const config: AgentConfig = {
              id,
              cmd: binCmd,
              args: restArgs,
              promptFlag,
              sessionResume,
              silenceMs,
              color: nextColor(),
            };
            manager.add(config);
            agentStoreSave(config);
            dispatch({ type: 'SELECT', id });
            const mode = promptFlag ? `one-shot` : 'interactive';
            hint(`Added "${id}" → ${binCmd}${restArgs.length ? ' ' + restArgs.join(' ') : ''} [${mode}]${sessionResume ? ` --resume ${sessionResume}` : ''}${silenceMs ? ` ${silenceMs}ms` : ''}`);
          } catch (e: any) {
            hint(`Error: ${e.message}`);
          }
          break;
        }

        case 'remove':
        case 'rm':
        case 'kill': {
          const id = args[0];
          if (!id) { hint('Usage: /kill <id>'); break; }
          manager.remove(id);
          agentStoreRemove(id);
          if (state.selectedId === id) dispatch({ type: 'SELECT', id: null });
          hint(`Removed agent "${id}"`);
          break;
        }

        case 'send': {
          const id = args[0];
          const prompt = args.slice(1).join(' ');
          if (!id || !prompt) { hint('Usage: /send <id> <prompt>'); break; }
          try {
            const session = loadSession(id);
            appendMessage(session, { role: 'user', content: prompt, ts: Date.now() });
            manager.send(id, prompt);
            dispatch({ type: 'AGENTS_CHANGED', agents: syncAgents(manager) });
            dispatch({ type: 'SELECT', id });
          } catch (e: any) {
            hint(`Error: ${e.message}`);
          }
          break;
        }

        case 'broadcast':
        case 'bc': {
          const prompt = args.join(' ');
          if (!prompt) { hint('Usage: /broadcast <prompt>'); break; }
          manager.broadcast(prompt);
          hint(`Broadcast to ${manager.ids().length} agents`);
          break;
        }

        case 'pipe': {
          const [from, to] = args;
          if (!from || !to) { hint('Usage: /pipe <from> <to>'); break; }
          try {
            manager.pipe(from, to);
            hint(`Piped ${from} → ${to}`);
            dispatch({ type: 'PIPES_CHANGED', pipes: manager.listPipes() });
          } catch (e: any) {
            hint(`Error: ${e.message}`);
          }
          break;
        }

        case 'unpipe': {
          const id = args[0];
          if (!id) { hint('Usage: /unpipe <from>'); break; }
          manager.unpipe(id);
          hint(`Removed pipe from ${id}`);
          dispatch({ type: 'PIPES_CHANGED', pipes: manager.listPipes() });
          break;
        }

        case 'supervisor': {
          const id = args[0];
          if (!id) {
            hint(state.supervisorId ? `Supervisor: "${state.supervisorId}"` : 'Usage: /supervisor <agent-id>');
            break;
          }
          if (id === 'off' || id === 'none') {
            supervisor = null;
            dispatch({ type: 'SET_SUPERVISOR', id: null });
            hint('Supervisor cleared — messages go to selected agent');
            break;
          }
          if (!manager.getAgent(id)) { hint(`Agent "${id}" not found`); break; }
          // Wire up a new Supervisor instance
          supervisor = new Supervisor(id, manager);
          supervisor.on('step', (step) => dispatch({ type: 'SUPERVISOR_STEP', step }));
          supervisor.on('done', (result) => {
            dispatch({ type: 'SUPERVISOR_STEP', step: '' });
            // Save result into supervisor's session so it shows in output panel
            const session = loadSession(id);
            appendMessage(session, { role: 'agent', content: result, ts: Date.now() });
            dispatch({ type: 'AGENTS_CHANGED', agents: syncAgents(manager) });
            dispatch({ type: 'SELECT', id });
            dispatch({ type: 'SET_PANEL', panel: 'output' });
          });
          supervisor.on('error', (err) => {
            dispatch({ type: 'SUPERVISOR_STEP', step: '' });
            hint(`Supervisor error: ${err.message}`);
          });
          dispatch({ type: 'SET_SUPERVISOR', id });
          dispatch({ type: 'SELECT', id });
          hint(`Supervisor set to "${id}" — all messages now route through it`);
          break;
        }

        case 'view': {
          // /view chat|raw [id]
          const mode = args[0];
          const id = args[1] ?? state.selectedId;
          if (!id) { hint('Usage: /view chat|raw [id]'); break; }
          if (mode !== 'chat' && mode !== 'raw') { hint('Usage: /view chat|raw [id]'); break; }
          dispatch({ type: 'SET_VIEW', id, view: mode });
          hint(`View "${id}" → ${mode}`);
          break;
        }

        case 'select': {
          const id = args[0];
          if (!id) { hint('Usage: /select <id>'); break; }
          const idx = state.agents.findIndex((a) => a.id === id);
          if (idx === -1) { hint(`Agent "${id}" not found`); break; }
          dispatch({ type: 'SELECT', id });
          dispatch({ type: 'SET_CURSOR', cursor: idx });
          break;
        }

        case 'mem':
        case 'memory': {
          const sub = args[0];
          if (sub === 'set') {
            const [, key, ...rest] = args;
            if (!key || !rest.length) { hint('Usage: /mem set <key> <value>'); break; }
            memSet(key, rest.join(' '));
            dispatch({ type: 'MEMORY_CHANGED', memory: memList() });
            hint(`Memory: ${key} set`);
          } else if (sub === 'get') {
            const key = args[1];
            const entry = memGet(key);
            hint(entry ? `${key} = ${entry.value}` : `Key "${key}" not found`);
          } else if (sub === 'del') {
            const key = args[1];
            const ok = memDel(key);
            dispatch({ type: 'MEMORY_CHANGED', memory: memList() });
            hint(ok ? `Deleted "${key}"` : `Key "${key}" not found`);
          } else if (sub === 'list' || !sub) {
            const entries = memList();
            if (!entries.length) { hint('Memory is empty'); break; }
            hint(entries.map((e) => `${e.key}=${e.value}`).join('  '));
          } else {
            hint('Usage: /mem set|get|del|list');
          }
          break;
        }

        case 'clear': {
          const id = args[0] ?? state.selectedId;
          if (!id) { hint('Usage: /clear <id>'); break; }
          clearSession(id);
          dispatch({ type: 'AGENTS_CHANGED', agents: syncAgents(manager) });
          hint(`Session cleared for ${id}`);
          break;
        }

        case 'list':
        case 'ls': {
          const ids = manager.ids();
          hint(ids.length ? `Agents: ${ids.join(', ')}` : 'No agents');
          break;
        }

        case 'log': {
          const recent = state.log.slice(-10);
          if (!recent.length) { hint('No log entries yet'); break; }
          hint(recent.map((e) => `[${e.level}] ${e.message}`).join('  '));
          break;
        }

        case 'help': {
          hint(
            'ESC cancel  /view chat|raw  /add /send /supervisor /pipe /unpipe /broadcast /kill /quit /select /clear /mem /list /log /app-exit'
          );
          break;
        }

        case 'exit':
        case 'quit': {
          // Kill the currently selected agent process
          const target = args[0] ?? state.selectedId;
          if (!target) { hint('No agent selected — use /quit <id> or select one first'); break; }
          manager.remove(target);
          agentStoreRemove(target);
          if (state.selectedId === target) dispatch({ type: 'SELECT', id: null });
          hint(`Terminated agent "${target}"`);
          break;
        }

        case 'app-exit': {
          exit();
          break;
        }

        default:
          hint(`Unknown command: /${cmd}  — try /help`);
      }
      finish();
    },
    [state.selectedId, state.supervisorId, state.agents, hint]
  );

  // ── Derived ────────────────────────────────────────────────────────────────
  const selectedRow = state.agents.find((a) => a.id === state.selectedId) ?? null;
  const termHeight = process.stdout.rows ?? 40;
  const termWidth = process.stdout.columns ?? 120;
  // Compute the actual height of the row that contains AgentList + OutputPanel.
  // Header is 3 rows (rounded border + 1 content). InputBar is 3 (or 4 with a
  // hint). MemoryBar adds 2 rows when there are entries, else 0.
  const headerH = 3;
  const memBarH = state.memory.length > 0 ? 2 : 0;
  // InputBar always reserves 4 rows (round border + hint row + prompt row +
  // bottom border), even when no hint is present. Keeps flexHeight stable
  // so toggling a hint doesn't relayout the panels above.
  const inputBarH = 4;
  const flexHeight = Math.max(8, termHeight - headerH - memBarH - inputBarH);
  // AgentList consumes the left column (22 cols incl. border); the output
  // panel gets the rest.
  const outputWidth = Math.max(40, termWidth - 22);
  const selectedView: OutputView = state.selectedId
    ? (state.viewModes[state.selectedId] ?? 'raw')
    : 'raw';
  const selectedScreen = state.selectedId ? (state.screens[state.selectedId] ?? []) : [];

  // Resize the slave PTY/terminal of the selected agent in raw mode so its
  // output matches the visible viewport. OutputPanel's content area =
  // outerWidth - 4 (border + paddingX) cols × outerHeight - 4 rows (border +
  // header content + header bottom border + bottom border).
  useEffect(() => {
    if (!state.selectedId || selectedView !== 'raw') return;
    const agent = manager.getAgent(state.selectedId);
    if (!agent) return;
    agent.resize(
      Math.max(40, outputWidth - 4),
      Math.max(5, flexHeight - 4),
    );
  }, [state.selectedId, selectedView, outputWidth, flexHeight]);

  // When the selected agent changes, eagerly load its current snapshot — we
  // skip per-agent screen dispatches when not selected (see onScreen above),
  // so the cached state.screens entry might be stale on switch.
  useEffect(() => {
    if (!state.selectedId) return;
    const agent = manager.getAgent(state.selectedId);
    if (!agent) return;
    dispatch({ type: 'AGENT_SCREEN', id: state.selectedId, rows: agent.snapshot() });
  }, [state.selectedId]);

  return (
    <Box flexDirection="column" height={termHeight}>
      <Header
        agentCount={state.agents.length}
        pipeCount={state.pipes.length}
        supervisorId={state.supervisorId}
        supervisorStep={state.supervisorStep}
        leaderArmed={state.leaderArmed}
        active={state.agents.some((a) => a.status === 'thinking') || !!state.supervisorStep}
      />

      <Box flexGrow={1}>
        <AgentList
          agents={state.agents}
          pipes={state.pipes}
          selectedId={state.selectedId}
          focused={state.panel === 'agents'}
          cursor={state.cursor}
          height={flexHeight}
        />
        <OutputPanel
          agentId={state.selectedId}
          agentColor={selectedRow?.color ?? 'cyan'}
          messages={selectedRow?.session.messages ?? []}
          liveChunk={state.selectedId ? (state.liveChunks[state.selectedId] ?? '') : ''}
          focused={state.panel === 'output'}
          height={flexHeight}
          width={outputWidth}
          scrollOffset={state.scrollOffset}
          view={selectedView}
          screen={selectedScreen}
        />
      </Box>

      <MemoryBar entries={state.memory} />

      <InputBar
        value={state.inputValue}
        onChange={onInputChange}
        onSubmit={handleSubmit}
        selectedAgent={state.selectedId}
        hint={state.hint}
        active={state.panel === 'input'}
      />
    </Box>
  );
}

// ── Tokeniser — respects "quoted strings" ─────────────────────────────────────
function tokenise(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const ch of input) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ') {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}
