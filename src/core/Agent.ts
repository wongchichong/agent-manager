import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AgentConfig, AgentStatus } from '../types.js';

export interface AgentEvents {
  /** Incremental stdout chunk */
  data: (chunk: string) => void;
  /** Full response collected — fires after process exit (one-shot) or silence timeout (interactive) */
  done: (full: string) => void;
  /** stderr chunk */
  stderr: (chunk: string) => void;
  /** Status changed */
  status: (s: AgentStatus) => void;
}

declare interface Agent {
  on<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): this;
  emit<K extends keyof AgentEvents>(event: K, ...args: Parameters<AgentEvents[K]>): boolean;
}

class Agent extends EventEmitter {
  readonly config: AgentConfig;
  status: AgentStatus = 'idle';
  /** Rolling log of output lines (capped at 2 000) */
  lines: string[] = [];

  private proc: ChildProcess | null = null;
  private buf = '';
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly silenceMs: number;

  constructor(config: AgentConfig) {
    super();
    this.setMaxListeners(50);
    this.config = config;
    this.silenceMs = config.silenceMs ?? 1500;
  }

  send(prompt: string): void {
    if (this.config.promptFlag !== undefined) {
      this.spawnOneShot(prompt);
    } else {
      this.writeStdin(prompt);
    }
  }

  /** Cancel current in-flight request without killing the process.
   *  Sends SIGINT so the CLI stops generating; process stays alive for next send. */
  cancel(): void {
    if (!this.proc || this.status !== 'thinking') return;
    this.clearSilenceTimer();
    this.proc.kill('SIGINT');
    this.buf = '';
    this.setStatus('idle');
  }

  kill(): void {
    this.clearSilenceTimer();
    this.proc?.kill('SIGTERM');
    setTimeout(() => this.proc?.kill('SIGKILL'), 2000);
    this.setStatus('dead');
  }

  // ── One-shot mode ────────────────────────────────────────────────────────

  private spawnOneShot(prompt: string): void {
    this.setStatus('thinking');
    this.buf = '';

    const args = [...this.config.args, this.config.promptFlag!, prompt];
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

    proc.stderr?.on('data', (chunk: string) => {
      this.emit('stderr', chunk);
    });

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

  // ── Interactive (persistent) mode ────────────────────────────────────────

  private writeStdin(prompt: string): void {
    if (!this.proc || this.proc.exitCode !== null) {
      this.spawnInteractive();
    }
    this.buf = '';
    this.setStatus('thinking');
    this.resetSilenceTimer();
    this.proc?.stdin?.write(prompt + '\n');
  }

  private spawnInteractive(): void {
    this.proc = spawn(this.config.cmd, this.config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout?.setEncoding('utf8');
    this.proc.stderr?.setEncoding('utf8');

    this.proc.stdout?.on('data', (chunk: string) => {
      this.buf += chunk;
      this.pushLines(chunk);
      this.emit('data', chunk);
      // Each chunk resets the silence timer — response ends when output goes quiet
      if (this.status === 'thinking') {
        this.resetSilenceTimer();
      }
    });

    this.proc.stderr?.on('data', (chunk: string) => {
      this.emit('stderr', chunk);
    });

    this.proc.on('error', (err) => {
      this.pushLines(`[error] ${err.message}`);
      this.clearSilenceTimer();
      this.setStatus('error');
    });

    this.proc.on('close', () => {
      // Process died — flush whatever was in the buffer
      this.clearSilenceTimer();
      const full = this.buf;
      this.buf = '';
      if (full.trim()) this.emit('done', full);
      this.setStatus('dead');
    });
  }

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      if (this.status === 'thinking') {
        const full = this.buf;
        this.buf = '';
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

  // ── Shared helpers ───────────────────────────────────────────────────────

  private pushLines(text: string): void {
    const incoming = text.split('\n').filter((l) => l.length > 0);
    this.lines.push(...incoming);
    if (this.lines.length > 2000) {
      this.lines = this.lines.slice(-2000);
    }
  }

  private setStatus(s: AgentStatus): void {
    this.status = s;
    this.emit('status', s);
  }
}

export { Agent };
