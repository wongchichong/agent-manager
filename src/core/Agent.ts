import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as pty from 'node-pty';
import { AgentConfig, AgentStatus } from '../types.js';
import { stripAnsi, cleanTui, cleanTuiLine } from './stripAnsi.js';
import { buildResumeArgs } from './SessionDiscovery.js';

export interface AgentEvents {
  data: (chunk: string) => void;
  done: (full: string) => void;
  stderr: (chunk: string) => void;
  status: (s: AgentStatus) => void;
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

  cancel(): void {
    this.clearSilenceTimer();
    this.clearEchoTimer();
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
    if (this.config.promptFlag !== undefined) {
      this.proc?.kill('SIGTERM');
      setTimeout(() => this.proc?.kill('SIGKILL'), 2000);
    } else {
      this.ptyProc?.kill('SIGTERM');
      this.ptyProc = null;
    }
    this.setStatus('dead');
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
    const cmd = isWindowsBatch ? 'C:\\Windows\\System32\\cmd.exe' : this.config.cmd;
    const finalArgs = isWindowsBatch ? ['/c', this.config.cmd, ...this.config.args] : this.config.args;

    try {
      const term = pty.spawn(cmd, finalArgs, {
        name: 'xterm-256color',
        cols: 220,
        rows: 50,
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      this.ptyProc = term;
      this.ptyPhase = 'starting';
    } catch (err: any) {
      this.pushLines(`[spawn error] Failed to spawn ${this.config.cmd}: ${err.message}`);
      this.setStatus('error');
      return;
    }

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

    term.onData((chunk) => {
      this.buf += chunk;
      this.pushLines(chunk);

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

    term.onExit(({ exitCode }) => {
      this.clearSilenceTimer();
      this.clearEchoTimer();
      if (this.startupDeadline) { clearTimeout(this.startupDeadline); this.startupDeadline = null; }
      const wasResponding = this.ptyPhase === 'responding';
      const full = this.buf;
      this.buf = '';
      this.ptyProc = null;
      this.ptyPhase = 'starting';
      if (full.trim() && wasResponding) this.emit('done', cleanTui(stripAnsi(full)));
      this.setStatus(exitCode === 0 ? 'dead' : 'error');
    });
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
