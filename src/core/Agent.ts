import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as pty from 'node-pty';
// @xterm/headless ships CJS without ESM named-export hints, so Node's loader
// can't pick `Terminal` out of `import { Terminal }`. The default export is
// the CJS module object itself.
import xtermHeadless from '@xterm/headless';
const { Terminal } = xtermHeadless as unknown as { Terminal: any };
type Terminal = InstanceType<typeof Terminal>;
import { AgentConfig, AgentStatus } from '../types.js';
import { stripAnsi, cleanTui, cleanTuiLine } from './stripAnsi.js';
import { buildResumeArgs } from './SessionDiscovery.js';
import { renderScreen } from './Screen.js';

export interface AgentEvents {
  data: (chunk: string) => void;
  done: (full: string) => void;
  stderr: (chunk: string) => void;
  status: (s: AgentStatus) => void;
  screen: () => void;
}

declare interface Agent {
  on<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): this;
  emit<K extends keyof AgentEvents>(event: K, ...args: Parameters<AgentEvents[K]>): boolean;
}

type PtyPhase = 'starting' | 'ready' | 'echo' | 'responding';

class Agent extends EventEmitter {
  readonly config: AgentConfig;
  status: AgentStatus = 'idle';
  lines: string[] = [];

  // One-shot state
  private proc: ChildProcess | null = null;
  private turnCount = 0;

  // Interactive PTY state (for CLIs that work without TTY, e.g. qwen)
  private ptyProc: pty.IPty | null = null;
  private ptyPhase: PtyPhase = 'starting';
  private pendingPrompt: string | null = null;

  // Headless terminal emulator — folds raw PTY bytes (cursor moves, clears,
  // colors, redraws) into a stable screen buffer that the OutputPanel can
  // mirror. Only used in PTY mode.
  private term: Terminal | null = null;
  private screenCols = 220;
  private screenRows = 50;
  private screenDirty = false;
  private screenEmitTimer: ReturnType<typeof setTimeout> | null = null;
  // 200ms = 5 fps. Plenty smooth for a terminal mirror. Lower rates flicker
  // visibly when the App re-render triggers Ink's clear-and-redraw cycle on
  // a tall terminal with many rows.
  private readonly screenEmitIntervalMs = 200;
  // Hash of the last emitted snapshot. Lets us skip the dispatch when the
  // slave's screen hasn't actually changed (cursor blink-only redraws,
  // idempotent re-paints, etc.) and avoid a pointless React re-render.
  private lastSnapshotHash = '';

  private buf = '';
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private echoTimer: ReturnType<typeof setTimeout> | null = null;
  private startupDeadline: ReturnType<typeof setTimeout> | null = null;
  private readonly silenceMs: number;
  private readonly startupMs = 4000;
  private readonly startupMaxMs = 15000;  // Hard cap for startup phase (increased for qodercli MCP init)
  private readonly echoDiscardMs = 5000;  // Increased for slower TUI transitions

  constructor(config: AgentConfig) {
    super();
    this.setMaxListeners(50);
    this.config = config;
    this.silenceMs = config.silenceMs ?? 5000;
  }

  send(prompt: string): void {
    if (this.config.promptFlag !== undefined) {
      this.spawnOneShot(prompt);
    } else {
      this.writeStdin(prompt);
    }
  }

  /**
   * Eagerly spawn the underlying interactive PTY so the slave's startup
   * (logo, banner, MCP init) is captured into the headless Terminal and
   * mirrored to the OutputPanel before the user sends anything. No-op for
   * one-shot agents (those use --flag and re-spawn per message).
   */
  start(): void {
    if (this.config.promptFlag !== undefined) return;
    if (this.ptyProc) return;
    // Pick reasonable initial dims based on host terminal size. Without this,
    // the slave's TUI bootstraps for the default 220x50 buffer and a later
    // resize() may not redraw cleanly on the slave's side (claude in particular
    // ends up with overlapping cursor / partial-frame artefacts).
    // 24 cols = AgentList width; 4 cols = OutputPanel border + paddingX;
    // 9 rows = Header + InputBar (rough, MemoryBar is usually empty).
    const termCols = process.stdout.columns ?? 120;
    const termRows = process.stdout.rows ?? 40;
    this.screenCols = Math.max(40, termCols - 24 - 4);
    this.screenRows = Math.max(10, termRows - 9);
    this.spawnPty();
  }

  /**
   * Raw passthrough: write bytes straight into the slave's PTY. Used by the
   * focused-output-panel keystroke forwarding so the slave handles input
   * exactly like it would in a real terminal. No-op for one-shot agents
   * (they have no persistent stdin).
   */
  write(data: string): void {
    if (this.config.promptFlag !== undefined) return;
    if (!this.ptyProc) return;
    try { this.ptyProc.write(data); } catch { /* pty may be exiting */ }
  }

  cancel(): void {
    this.clearSilenceTimer();
    this.clearEchoTimer();
    this.clearScreenTimer();
    if (this.startupDeadline) { clearTimeout(this.startupDeadline); this.startupDeadline = null; }
    if (this.config.promptFlag !== undefined) {
      this.proc?.kill('SIGINT');
    } else {
      this.ptyProc?.write('\x03');
    }
    this.buf = '';
    this.setStatus('idle');
  }

  kill(): void {
    this.clearSilenceTimer();
    this.clearEchoTimer();
    this.clearScreenTimer();
    if (this.config.promptFlag !== undefined) {
      this.proc?.kill('SIGTERM');
      setTimeout(() => this.proc?.kill('SIGKILL'), 2000);
    } else {
      this.ptyProc?.kill('SIGTERM');
      this.ptyProc = null;
      this.term?.dispose();
      this.term = null;
    }
    this.setStatus('dead');
  }

  /** Resize the underlying PTY and headless screen buffer. */
  resize(cols: number, rows: number): void {
    if (cols < 20 || rows < 5) return;
    if (cols === this.screenCols && rows === this.screenRows) return;
    this.screenCols = cols;
    this.screenRows = rows;
    try { this.ptyProc?.resize(cols, rows); } catch { /* pty may be gone */ }
    try { this.term?.resize(cols, rows); } catch { /* term may be gone */ }
    this.markScreenDirty();
  }

  /** Visible screen rows as ANSI-encoded strings. Empty array if no PTY. */
  snapshot(): string[] {
    if (!this.term) return [];
    return renderScreen(this.term);
  }

  screenSize(): { cols: number; rows: number } {
    return { cols: this.screenCols, rows: this.screenRows };
  }

  // ── One-shot mode (with session resume based on CWD) ───────────────────────

  private spawnOneShot(prompt: string): void {
    this.setStatus('thinking');
    this.buf = '';

    // Build resume args from session discovery
    // sessionResume can be: "latest"|"continue"|"new"|<sessionId>
    const resumeMode = this.config.sessionResume || 'latest';
    const resumeArgs = buildResumeArgs(this.config.id, resumeMode, process.cwd());

    const args = [...this.config.args, ...resumeArgs, this.config.promptFlag!, prompt];
    this.turnCount++;

    const proc = spawn(this.config.cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc = proc;

    proc.stdout?.setEncoding('utf8');
    proc.stderr?.setEncoding('utf8');

    proc.stdout?.on('data', (chunk: string) => {
      this.buf += chunk;
      this.pushLines(chunk);
      const cleaned = stripAnsi(chunk)
        .split('\n')
        .map(cleanTuiLine)
        .filter((l): l is string => l !== null)
        .join('\n');
      if (cleaned) this.emit('data', cleaned);
    });
    proc.stderr?.on('data', (chunk: string) => this.emit('stderr', chunk));
    proc.on('error', (err) => {
      this.pushLines(`[error] ${err.message}`);
      this.setStatus('error');
    });
    proc.on('close', (code) => {
      const full = cleanTui(stripAnsi(this.buf));
      this.buf = '';
      // Emit 'done' BEFORE setting status — this ensures the supervisor's
      // onDone handler can resolve the promise before onStatus sees 'error'.
      // Some CLIs exit with non-zero codes even when successful (e.g. due to
      // stderr warnings). We treat any non-crashed exit as 'idle' so the
      // response is still returned.
      this.emit('done', full);
      this.setStatus(code === 0 ? 'idle' : 'idle');
    });
  }

  // ── Interactive PTY mode (for qwen and other pipe-friendly CLIs) ──────────

  private writeStdin(prompt: string): void {
    if (!this.ptyProc) {
      this.pendingPrompt = prompt;
      this.setStatus('thinking');
      this.spawnPty();
      return;
    }
    if (this.ptyPhase === 'starting') {
      this.pendingPrompt = prompt;
      this.setStatus('thinking');
      return;
    }
    this.sendToPty(prompt);
  }

  private sendToPty(prompt: string): void {
    if (!this.ptyProc) {
      this.pushLines(`[error] PTY process not available`);
      this.setStatus('error');
      return;
    }
    this.setStatus('thinking');
    this.ptyPhase = 'echo';
    // Don't clear buffer here — startup TUI noise will be filtered by cleanTui
    // TUI-based CLIs (like qodercli) need the prompt typed first, then Enter
    // sent separately. Sending \n or \r together with the text just types
    // the characters — it doesn't submit. A bare \r acts as Enter key.
    this.ptyProc.write(prompt);
    // Small delay then press Enter
    setTimeout(() => {
      if (this.ptyProc && this.status === 'thinking') {
        this.ptyProc.write('\r');
        // Start echo timer AFTER Enter is pressed — this gives the TUI time
        // to transition from input mode to "Generating..." mode
        this.clearEchoTimer();
        this.echoTimer = setTimeout(() => {
          this.echoTimer = null;
          if (this.status !== 'thinking') return;
          // Don't clear the buffer here — AI response data accumulates from this point.
          // The cleanTui() function will strip TUI artifacts from the final output.
          this.ptyPhase = 'responding';
          this.resetSilenceTimer();
        }, this.echoDiscardMs);
      }
    }, 500);
  }

  private spawnPty(): void {
    // On Windows, .cmd/.bat files can't be spawned directly with node-pty.
    // Must use cmd /c to execute them properly.
    const isWindowsBatch = this.config.cmd.endsWith('.cmd') || this.config.cmd.endsWith('.bat');
    let cmd: string;
    let finalArgs: string[];
    if (isWindowsBatch) {
      cmd = 'C:\\Windows\\System32\\cmd.exe';
      finalArgs = ['/c', this.config.cmd, ...this.config.args];
    } else {
      // node-pty (Windows ConPTY) does NOT search PATH like child_process does
      // — it requires an absolute file path. Resolve `cmd` against PATH so
      // configs can stay portable ("node" instead of "C:\Program Files\…").
      cmd = resolveCommand(this.config.cmd) ?? this.config.cmd;
      finalArgs = this.config.args;
    }

    try {
      const ptyTerm = pty.spawn(cmd, finalArgs, {
        name: 'xterm-256color',
        cols: this.screenCols,
        rows: this.screenRows,
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      this.ptyProc = ptyTerm;
      this.ptyPhase = 'starting';

      // Headless emulator mirrors the slave's screen for the OutputPanel.
      this.term = new Terminal({
        cols: this.screenCols,
        rows: this.screenRows,
        allowProposedApi: true,
        scrollback: 2000,
      });
    } catch (err: any) {
      this.pushLines(`[spawn error] Failed to spawn ${this.config.cmd}: ${err.message}`);
      this.setStatus('error');
      return;
    }
    const ptyProc = this.ptyProc;

    // Set a hard deadline for startup — the TUI may continuously output
    // small chunks (cursor blink, status updates) that would reset the
    // silence timer indefinitely. After startupMaxMs, force transition.
    this.startupDeadline = setTimeout(() => {
      this.startupDeadline = null;
      if (this.ptyPhase !== 'starting') return;
      this.ptyPhase = 'ready';
      this.buf = '';
      if (this.status !== 'dead' && this.status !== 'error') {
        this.setStatus('idle');
      }
      // Some TUI CLIs (like qodercli) need an initial Enter to dismiss
      // the welcome screen before accepting input. Send it now.
      if (this.ptyProc) {
        this.ptyProc.write('\r');
      }
      if (this.pendingPrompt) {
        const p = this.pendingPrompt;
        this.pendingPrompt = null;
        this.sendToPty(p);
      }
    }, this.startupMaxMs);

    ptyProc.onData((chunk) => {
      this.buf += chunk;
      this.pushLines(chunk);
      // Mirror raw bytes (with cursor moves, redraws, colors) into the
      // headless emulator so the OutputPanel can show a true screen view.
      if (this.term) {
        try { this.term.write(chunk); } catch { /* terminal may be disposing */ }
        this.markScreenDirty();
      }

      if (this.ptyPhase === 'starting') {
        // Don't reset timer during startup — the hard deadline handles it
      } else if (this.ptyPhase === 'echo' && this.status === 'thinking') {
        // Detect transition from echo to responding by looking for
        // "Generating" or "Thinking" in the chunk (TUI switched to response mode)
        const stripped = stripAnsi(chunk);
        if (/Generating|Thinking|Processing|Loading/i.test(stripped)) {
          this.ptyPhase = 'responding';
          this.clearEchoTimer();
          this.resetSilenceTimer();
        }
        // Still emit filtered data during responding
        const cleaned = stripAnsi(chunk)
          .split('\n')
          .map(cleanTuiLine)
          .filter((l): l is string => l !== null)
          .join('\n');
        if (cleaned) this.emit('data', cleaned);
      } else if (this.ptyPhase === 'responding' && this.status === 'thinking') {
        this.resetSilenceTimer();
        // Filter live chunks through cleanTuiLine to strip TUI chrome
        // from each line before emitting to the TUI display
        const cleaned = stripAnsi(chunk)
          .split('\n')
          .map(cleanTuiLine)
          .filter((l): l is string => l !== null)
          .join('\n');
        if (cleaned) this.emit('data', cleaned);
      }
    });

    ptyProc.onExit(({ exitCode }) => {
      this.clearSilenceTimer();
      this.clearEchoTimer();
      this.clearScreenTimer();
      if (this.startupDeadline) { clearTimeout(this.startupDeadline); this.startupDeadline = null; }
      const wasResponding = this.ptyPhase === 'responding';
      const full = this.buf;
      this.buf = '';
      this.ptyProc = null;
      this.ptyPhase = 'starting';
      // Emit one last screen snapshot synchronously so subscribers can read
      // whatever the slave printed (errors, banner) before we dispose the
      // headless Terminal. Listeners call snapshot() in the same tick.
      this.emit('screen');
      this.term?.dispose();
      this.term = null;
      if (full.trim() && wasResponding) this.emit('done', cleanTui(stripAnsi(full)));
      this.setStatus(exitCode === 0 ? 'dead' : 'error');
    });
  }

  // ── Screen emit throttling ───────────────────────────────────────────────

  private markScreenDirty(): void {
    this.screenDirty = true;
    if (this.screenEmitTimer) return;
    this.screenEmitTimer = setTimeout(() => {
      this.screenEmitTimer = null;
      if (!this.screenDirty) return;
      this.screenDirty = false;
      // Skip if the rendered snapshot is byte-identical to the last one.
      // A slave that emits cursor-blink toggles or other no-op control bytes
      // would otherwise drive Ink at 10 fps re-renders for nothing.
      const snap = this.snapshot().join('\n');
      if (snap === this.lastSnapshotHash) return;
      this.lastSnapshotHash = snap;
      this.emit('screen');
    }, this.screenEmitIntervalMs);
  }

  private clearScreenTimer(): void {
    if (this.screenEmitTimer) {
      clearTimeout(this.screenEmitTimer);
      this.screenEmitTimer = null;
    }
    this.screenDirty = false;
  }

  // ── Silence timer ────────────────────────────────────────────────────────

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;

      if (this.ptyPhase === 'responding' && this.status === 'thinking') {
        const full = cleanTui(stripAnsi(this.buf));
        this.buf = '';
        this.ptyPhase = 'ready';
        this.setStatus('idle');
        this.emit('done', full);
      }
    }, this.silenceMs);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private clearEchoTimer(): void {
    if (this.echoTimer) {
      clearTimeout(this.echoTimer);
      this.echoTimer = null;
    }
  }

  // ── Shared helpers ───────────────────────────────────────────────────────

  private pushLines(text: string): void {
    const incoming = text.split('\n').filter((l) => l.length > 0);
    this.lines.push(...incoming);
    if (this.lines.length > 2000) this.lines = this.lines.slice(-2000);
  }

  private setStatus(s: AgentStatus): void {
    this.status = s;
    this.emit('status', s);
  }
}

export { Agent };

/**
 * Resolve a bare command name (e.g. "node") against PATH + PATHEXT, returning
 * an absolute path. Returns null if not found. Needed because node-pty on
 * Windows uses ConPTY, which requires an absolute path and does not perform
 * PATH lookup the way child_process.spawn does.
 */
function resolveCommand(cmd: string): string | null {
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) return cmd;
  const PATH = process.env.PATH || process.env.Path || '';
  const dirs = PATH.split(path.delimiter).filter(Boolean);
  const isWin = process.platform === 'win32';
  const exts = isWin
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  // If the cmd already has an extension, try it as-is first.
  const hasExt = path.extname(cmd).length > 0;
  const candidates = hasExt ? [''] : exts;
  for (const dir of dirs) {
    for (const ext of candidates) {
      const full = path.join(dir, cmd + ext);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch { /* skip */ }
    }
  }
  return null;
}
