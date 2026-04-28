import { EventEmitter } from 'events';
import { Agent } from './Agent.js';
import { AgentConfig, PipeConfig } from '../types.js';

export interface ManagerEvents {
  /** Any agent produced a data chunk */
  agentData: (agentId: string, chunk: string) => void;
  /** Any agent finished a response */
  agentDone: (agentId: string, full: string) => void;
  /** Any agent's status changed */
  agentStatus: (agentId: string) => void;
  /** Any agent's screen buffer changed (PTY mode only). Throttled. */
  agentScreen: (agentId: string) => void;
  /** Agent list changed (add/remove) */
  agentsChanged: () => void;
  /** Pipe list changed */
  pipesChanged: () => void;
}

declare interface AgentManager {
  on<K extends keyof ManagerEvents>(event: K, listener: ManagerEvents[K]): this;
  emit<K extends keyof ManagerEvents>(event: K, ...args: Parameters<ManagerEvents[K]>): boolean;
}

class AgentManager extends EventEmitter {
  private agents = new Map<string, Agent>();
  /** fromId → toId */
  private pipes = new Map<string, string>();

  add(config: AgentConfig): Agent {
    if (this.agents.has(config.id)) {
      throw new Error(`Agent "${config.id}" already exists`);
    }
    const agent = new Agent(config);

    agent.on('data', (chunk) => this.emit('agentData', config.id, chunk));
    agent.on('status', () => this.emit('agentStatus', config.id));
    agent.on('screen', () => this.emit('agentScreen', config.id));
    agent.on('done', (full) => {
      this.emit('agentDone', config.id, full);
      // Auto-pipe
      const toId = this.pipes.get(config.id);
      if (toId && full.trim()) {
        const target = this.agents.get(toId);
        if (target) target.send(full.trim());
      }
    });

    this.agents.set(config.id, agent);
    this.emit('agentsChanged');
    // Eagerly start interactive agents so their startup screen (logo,
    // banner, MCP init) is captured by the headless Terminal and visible
    // in the OutputPanel raw view before the user sends anything.
    agent.start();
    return agent;
  }

  remove(id: string): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.kill();
    agent.removeAllListeners();
    this.agents.delete(id);
    // Remove any pipes that reference this agent
    this.pipes.delete(id);
    for (const [from, to] of this.pipes) {
      if (to === id) this.pipes.delete(from);
    }
    this.emit('agentsChanged');
    this.emit('pipesChanged');
  }

  send(id: string, prompt: string): void {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent "${id}" not found`);
    agent.send(prompt);
  }

  broadcast(prompt: string): void {
    for (const agent of this.agents.values()) {
      agent.send(prompt);
    }
  }

  pipe(fromId: string, toId: string): void {
    if (!this.agents.has(fromId)) throw new Error(`Agent "${fromId}" not found`);
    if (!this.agents.has(toId)) throw new Error(`Agent "${toId}" not found`);
    if (fromId === toId) throw new Error('Cannot pipe agent to itself');
    this.pipes.set(fromId, toId);
    this.emit('pipesChanged');
  }

  unpipe(fromId: string): void {
    this.pipes.delete(fromId);
    this.emit('pipesChanged');
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  listAgents(): Agent[] {
    return [...this.agents.values()];
  }

  listPipes(): PipeConfig[] {
    return [...this.pipes.entries()].map(([fromId, toId]) => ({ fromId, toId }));
  }

  ids(): string[] {
    return [...this.agents.keys()];
  }
}

export { AgentManager };
