/**
 * Session discovery for CLI resume flags.
 * 
 * Discovers sessions from CLI-specific storage directories based on CWD,
 * so that `-p` mode can resume the correct conversation.
 * 
 * qodercli: ~/.qoder/projects/<project-dir>/<sessionId>.jsonl
 * gemini:   ~/.gemini/tmp/<project-dir>/chats/session-<timestamp>-<shortId>.json
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  title?: string;
  updatedAt: number;
  messageCount?: number;
  /** CLI-specific resume argument (e.g. sessionId for qodercli, "latest" for gemini) */
  resumeArg: string;
}

// ── Path resolution ────────────────────────────────────────────────────────────

function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || '';
}

/**
 * Derive the project directory key from CWD.
 * For qodercli: full path with dashes "D--Developments-tslib-agent-manager"
 * For gemini: just the project name "agent-manager"
 */
function projectKey(cwd?: string): string {
  const dir = cwd || process.cwd();
  return dir.replace(/:/g, '-').replace(/[\\/]/g, '-').replace(/^-+/, '');
}

function projectName(cwd?: string): string {
  const dir = cwd || process.cwd();
  // Get the last component of the path
  const parts = dir.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

// ── Qodercli session discovery ─────────────────────────────────────────────────

interface QoderSessionJson {
  id: string;
  title: string;
  message_count: number;
  updated_at: number;
  working_dir: string;
}

interface QoderJsonlLine {
  type: string;
  message?: {
    role: string;
    content?: Array<{ type: string; text?: string }>;
  };
}

function discoverQoderSessions(cwd?: string): SessionInfo[] {
  const key = projectKey(cwd);
  const dir = join(homeDir(), '.qoder', 'projects', key);
  if (!existsSync(dir)) return [];

  const sessions: SessionInfo[] = [];
  const files = readdirSync(dir);

  for (const file of files) {
    if (!file.endsWith('-session.json')) continue;
    const sessionId = file.replace('-session.json', '');

    try {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const meta: QoderSessionJson = JSON.parse(raw);
      sessions.push({
        id: sessionId,
        title: meta.title || undefined,
        updatedAt: meta.updated_at,
        messageCount: meta.message_count,
        resumeArg: sessionId,
      });
    } catch {
      // Skip corrupted files
    }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

// ── Gemini session discovery ───────────────────────────────────────────────────

interface GeminiSessionJson {
  sessionId: string;
  startTime: string;
  lastUpdated: string;
  messages?: Array<{ type: string; content?: string }>;
}

function discoverGeminiSessions(cwd?: string): SessionInfo[] {
  // Gemini stores sessions by project NAME (not full path): ~/.gemini/tmp/<projectName>/chats/
  // Also try the hashed path: ~/.gemini/tmp/<projectHash>/
  const dirsToTry: string[] = [];
  
  const name = projectName(cwd);
  if (name) dirsToTry.push(join(homeDir(), '.gemini', 'tmp', name, 'chats'));
  
  // Also check hashed project paths
  const tmpDir = join(homeDir(), '.gemini', 'tmp');
  if (existsSync(tmpDir)) {
    try {
      const entries = readdirSync(tmpDir);
      for (const entry of entries) {
        // Check if this hashed dir has a chats/ subdir with our project's sessions
        const chatsDir = join(tmpDir, entry, 'chats');
        if (existsSync(chatsDir)) dirsToTry.push(chatsDir);
      }
    } catch { /* skip */ }
  }

  const sessions: SessionInfo[] = [];
  const seen = new Set<string>();

  for (const dir of dirsToTry) {
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        if (!file.startsWith('session-') || !file.endsWith('.json')) continue;
        if (seen.has(file)) continue;
        seen.add(file);

        const match = file.match(/session-.*?-([a-f0-9]+)\.json$/);
        if (!match) continue;

        try {
          const raw = readFileSync(join(dir, file), 'utf-8');
          const meta: GeminiSessionJson = JSON.parse(raw);
          // Don't add duplicates
          if (sessions.find(s => s.id === meta.sessionId)) continue;
          
          const msgCount = meta.messages?.filter(m => m.type === 'user' || m.type === 'gemini').length || 0;
          sessions.push({
            id: meta.sessionId,
            updatedAt: new Date(meta.lastUpdated).getTime(),
            messageCount: msgCount,
            resumeArg: meta.sessionId,
          });
        } catch { /* skip corrupted */ }
      }
    } catch { /* skip unreadable */ }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * List available sessions for a given CLI agent, filtered by CWD.
 */
export function listSessions(agentId: string, cwd?: string): SessionInfo[] {
  if (agentId === 'qoder' || agentId === 'qodercli') {
    return discoverQoderSessions(cwd);
  }
  if (agentId === 'gemini') {
    return discoverGeminiSessions(cwd);
  }
  return [];
}

/**
 * Get the latest session for an agent, or undefined if none exist.
 * Used for `-c` / `--continue` / `--resume latest` behavior.
 */
export function getLatestSession(agentId: string, cwd?: string): SessionInfo | undefined {
  const sessions = listSessions(agentId, cwd);
  return sessions[0];
}

/**
 * Build the CLI args for resuming a session.
 * 
 * For qodercli: `-r <sessionId>` or `-c` for latest
 * For gemini: `--resume <sessionId>` or `--resume latest`
 * 
 * @param agentId - "qoder" or "gemini"
 * @param sessionId - specific session ID, or "latest"/"continue" for most recent
 * @param cwd - working directory (defaults to process.cwd())
 */
export function buildResumeArgs(agentId: string, sessionId: string, cwd?: string): string[] {
  if (sessionId === 'latest' || sessionId === 'continue' || sessionId === 'new') {
    // For "new", don't add any resume flag — fresh session
    if (sessionId === 'new') return [];

    // For qodercli: `-c` continues the most recent session
    if (agentId === 'qoder' || agentId === 'qodercli') {
      return ['-c'];
    }
    // For gemini: `--resume latest`
    if (agentId === 'gemini') {
      return ['--resume', 'latest'];
    }
    return [];
  }

  // Specific session ID
  if (agentId === 'qoder' || agentId === 'qodercli') {
    return ['-r', sessionId];
  }
  if (agentId === 'gemini') {
    return ['--resume', sessionId];
  }
  return [];
}
