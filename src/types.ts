export type AgentStatus = 'idle' | 'thinking' | 'error' | 'dead';
export type LogLevel = 'info' | 'warn' | 'error' | 'success';
export type Panel = 'agents' | 'output';

/** What gets persisted and passed to /add */
export interface AgentConfig {
  id: string;
  /** Binary to invoke, e.g. "claude", "gemini", "qodercli" */
  cmd: string;
  /** Args that come before the prompt flag, e.g. ["-m", "gpt-4"] */
  args: string[];
  /**
   * Flag that precedes the prompt text in one-shot mode.
   *   spawn(cmd, [...args, promptFlag, promptText, ...continueArgs?])
   * If omitted, uses interactive PTY stdin mode (for CLIs that work without TTY).
   */
  promptFlag?: string;
  /**
   * Args appended on every call after the first to resume the session.
   * e.g. ["--continue"] for claude/qwen, ["--resume", "latest"] for gemini.
   * Only used when promptFlag is set.
   */
  continueArgs?: string[];
  /**
   * ms of stdout silence that signals end-of-response in interactive PTY mode.
   * Default: 2500.
   */
  silenceMs?: number;
  color: string;
}

export interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  ts: number;
}

export interface AgentSession {
  agentId: string;
  messages: Message[];
  startedAt: number;
  updatedAt: number;
}

export interface MemoryEntry {
  key: string;
  value: string;
  tags: string[];
  at: number;
}

export interface PipeConfig {
  fromId: string;
  toId: string;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  ts: number;
}
