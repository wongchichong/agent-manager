import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as pty from 'node-pty';
import { AgentConfig, AgentStatus } from '../types.js';

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
  private readonly silenceMs: number;
  private readonly startupMs = 2500;
  private readonly echoDiscardMs = 700;

  constructor(config: AgentConfig) {
    super();
    this.setMaxListeners(50);
    this.config = config;
    this.silenceMs = config.silenceMs ?? 2500;
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
    if (this.config.promptFlag !== undefined) {
      this.proc?.kill('SIGTERM');
      setTimeout(() => this.proc?.kill('SIGKILL'), 2000);
    } else {
      this.ptyProc?.kill('SIGTERM');
      this.ptyProc = null;
    }
    this.setStatus('dead');
  }

  // ── One-shot mode (with optional session continuation) ────────────────────

  private spawnOneShot(prompt: string): void {
    this.setStatus('thinking');
    this.buf = '';

    // From the 2nd turn onward, append continueArgs to resume the session
    const continueArgs = this.turnCount > 0 ? (this.config.continueArgs ?? []) : [];
    const args = [...this.config.args, ...continueArgs, this.config.promptFlag!, prompt];
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
      this.emit('data', chunk);
    });
    proc.stderr?.on('data', (chunk: string) => this.emit('stderr', chunk));
    proc.on('error', (err) => {
      this.pushLines(`[error] ${err.message}`);
      this.setStatus('error');
    });
    proc.on('close', (code) => {
      const full = this.buf;
      this.buf = '';
      this.setStatus(code === 0 ? 'idle' : 'error');
      this.emit('done', full);
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
    this.setStatus('thinking');
    this.ptyPhase = 'echo';
    this.buf = '';
    this.ptyProc!.write(prompt + '\r');

    // Wait for echo to pass, then collect real response
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (this.status !== 'thinking') return;
      this.buf = '';
      this.ptyPhase = 'responding';
      // Silence timer starts on first response chunk (model API can be slow)
    }, this.echoDiscardMs);
  }

  private spawnPty(): void {
    const term = pty.spawn(this.config.cmd, this.config.args, {
      name: 'xterm-256color',
      cols: 220,
      rows: 50,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    this.ptyProc = term;
    this.ptyPhase = 'starting';

    term.onData((chunk) => {
      this.buf += chunk;
      this.pushLines(chunk);

      if (this.ptyPhase === 'starting') {
        this.resetSilenceTimer();
      } else if (this.ptyPhase === 'responding' && this.status === 'thinking') {
        this.resetSilenceTimer();
        this.emit('data', chunk);
      }
    });

    term.onExit(({ exitCode }) => {
      this.clearSilenceTimer();
      const wasResponding = this.ptyPhase === 'responding';
      const full = this.buf;
      this.buf = '';
      this.ptyProc = null;
      this.ptyPhase = 'starting';
      if (full.trim() && wasResponding) this.emit('done', full);
      this.setStatus(exitCode === 0 ? 'dead' : 'error');
    });

    this.resetSilenceTimer();
  }

  // ── Silence timer ────────────────────────────────────────────────────────

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    const ms = this.ptyPhase === 'starting' ? this.startupMs : this.silenceMs;
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;

      if (this.ptyPhase === 'starting') {
        this.ptyPhase = 'ready';
        this.buf = '';
        if (this.status !== 'dead' && this.status !== 'error') {
          this.setStatus('idle');
        }
        if (this.pendingPrompt) {
          const p = this.pendingPrompt;
          this.pendingPrompt = null;
          this.sendToPty(p);
        }
        return;
      }

      if (this.ptyPhase === 'responding' && this.status === 'thinking') {
        const full = this.buf;
        this.buf = '';
        this.ptyPhase = 'ready';
        this.setStatus('idle');
        this.emit('done', full);
      }
    }, ms);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
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
