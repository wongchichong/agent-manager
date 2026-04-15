import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { AgentSession, Message } from '../types.js';

const DIR = join(homedir(), '.agentman', 'sessions');
mkdirSync(DIR, { recursive: true });

function sessionPath(agentId: string): string {
  return join(DIR, `${agentId}.json`);
}

export function loadSession(agentId: string): AgentSession {
  const p = sessionPath(agentId);
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as AgentSession;
    } catch {
      // corrupt file — start fresh
    }
  }
  return { agentId, messages: [], startedAt: Date.now(), updatedAt: Date.now() };
}

export function appendMessage(session: AgentSession, msg: Omit<Message, 'id'>): Message {
  const full: Message = {
    ...msg,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
  session.messages.push(full);
  session.updatedAt = Date.now();
  saveSession(session);
  return full;
}

export function saveSession(session: AgentSession): void {
  writeFileSync(sessionPath(session.agentId), JSON.stringify(session, null, 2));
}

export function clearSession(agentId: string): AgentSession {
  const fresh: AgentSession = {
    agentId,
    messages: [],
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveSession(fresh);
  return fresh;
}
