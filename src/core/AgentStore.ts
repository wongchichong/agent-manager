import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { AgentConfig } from '../types.js';

const BASE = join(homedir(), '.agentman');
const FILE = join(BASE, 'agents.json');
mkdirSync(BASE, { recursive: true });

type Store = Record<string, AgentConfig>;

function load(): Store {
  if (!existsSync(FILE)) return {};
  try {
    return JSON.parse(readFileSync(FILE, 'utf-8')) as Store;
  } catch {
    return {};
  }
}

function persist(store: Store): void {
  writeFileSync(FILE, JSON.stringify(store, null, 2));
}

export function agentStoreSave(config: AgentConfig): void {
  const store = load();
  store[config.id] = config;
  persist(store);
}

export function agentStoreRemove(id: string): void {
  const store = load();
  delete store[id];
  persist(store);
}

export function agentStoreList(): AgentConfig[] {
  return Object.values(load());
}
