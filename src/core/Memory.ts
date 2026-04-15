import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { MemoryEntry } from '../types.js';

const BASE = join(homedir(), '.agentman');
const FILE = join(BASE, 'memory.json');
mkdirSync(BASE, { recursive: true });

type Store = Record<string, MemoryEntry>;

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

export function memSet(key: string, value: string, tags: string[] = []): MemoryEntry {
  const store = load();
  const entry: MemoryEntry = { key, value, tags, at: Date.now() };
  store[key] = entry;
  persist(store);
  return entry;
}

export function memGet(key: string): MemoryEntry | undefined {
  return load()[key];
}

export function memDel(key: string): boolean {
  const store = load();
  if (!(key in store)) return false;
  delete store[key];
  persist(store);
  return true;
}

export function memList(): MemoryEntry[] {
  return Object.values(load());
}

export function memAll(): Store {
  return load();
}

/** Format all entries as "key=value" for injecting into prompts */
export function memContext(): string {
  return Object.values(load())
    .map((e) => `${e.key}=${e.value}`)
    .join('\n');
}
