import { EventEmitter } from 'events';
import { AgentManager } from './AgentManager.js';

export interface SupervisorEvents {
  /** Status update during orchestration (e.g. "Delegating to: qoder, gemini") */
  step: (msg: string) => void;
  /** Final synthesized answer */
  done: (result: string) => void;
  /** Unrecoverable error */
  error: (err: Error) => void;
}

declare interface Supervisor {
  on<K extends keyof SupervisorEvents>(e: K, l: SupervisorEvents[K]): this;
  emit<K extends keyof SupervisorEvents>(e: K, ...a: Parameters<SupervisorEvents[K]>): boolean;
}

class Supervisor extends EventEmitter {
  readonly supervisorId: string;
  private manager: AgentManager;
  running = false;

  constructor(supervisorId: string, manager: AgentManager) {
    super();
    this.supervisorId = supervisorId;
    this.manager = manager;
  }

  async run(userPrompt: string): Promise<void> {
    if (this.running) {
      this.emit('error', new Error('Supervisor already running'));
      return;
    }
    this.running = true;

    try {
      const workerIds = this.manager.ids().filter((id) => id !== this.supervisorId);

      // ── Step 1: Ask supervisor to plan / delegate ──────────────────────────
      const planPrompt = buildPlanPrompt(userPrompt, workerIds);
      this.emit('step', 'Supervisor planning…');
      const planResponse = await this.callAgent(this.supervisorId, planPrompt);

      // ── Parse DELEGATE lines ───────────────────────────────────────────────
      const delegations = parseDelegations(planResponse);

      if (delegations.length === 0) {
        // Supervisor answered directly
        const final = extractFinal(planResponse) ?? planResponse.trim();
        this.emit('done', final);
        return;
      }

      // ── Step 2: Run workers in parallel ───────────────────────────────────
      this.emit(
        'step',
        `Delegating to: ${delegations.map((d) => d.workerId).join(', ')}`
      );

      const settled = await Promise.allSettled(
        delegations.map(({ workerId, task }) =>
          this.callAgent(workerId, task).then((r) => ({ workerId, result: r }))
        )
      );

      // ── Step 3: Feed results back to supervisor for synthesis ──────────────
      const workerLines = settled.map((r, i) => {
        const { workerId } = delegations[i];
        if (r.status === 'fulfilled') {
          return `[${workerId}]:\n${r.value.result.trim()}`;
        }
        return `[${workerId}]: ERROR — ${(r.reason as Error)?.message ?? 'failed'}`;
      });

      const synthesisPrompt = [
        'Your delegation plan:',
        planResponse.trim(),
        '',
        'Worker responses:',
        workerLines.join('\n\n'),
        '',
        'Synthesize all results into a final answer. Begin with FINAL:',
      ].join('\n');

      this.emit('step', 'Synthesizing…');
      const finalResponse = await this.callAgent(this.supervisorId, synthesisPrompt);
      const final = extractFinal(finalResponse) ?? finalResponse.trim();
      this.emit('done', final);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.running = false;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private callAgent(id: string, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const agent = this.manager.getAgent(id);
      if (!agent) {
        reject(new Error(`Agent "${id}" not found`));
        return;
      }

      const onDone = (full: string) => {
        cleanup();
        resolve(full);
      };
      const onStatus = (s: string) => {
        if (s === 'error') {
          cleanup();
          reject(new Error(`Agent "${id}" errored`));
        }
      };
      const cleanup = () => {
        agent.off('done', onDone);
        agent.off('status', onStatus);
      };

      agent.once('done', onDone);
      agent.on('status', onStatus);
      agent.send(prompt);
    });
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function buildPlanPrompt(userPrompt: string, workerIds: string[]): string {
  return [
    `You are an AI orchestrator with access to these worker agents: ${workerIds.join(', ')}.`,
    `To delegate a subtask output one line per delegation in this exact format:`,
    `  DELEGATE <worker_id>: <task description>`,
    `You may delegate to multiple workers simultaneously — they run in parallel.`,
    `If the request is simple and needs no delegation, answer directly with:`,
    `  FINAL: <your answer>`,
    ``,
    `User request: ${userPrompt}`,
  ].join('\n');
}

function parseDelegations(text: string): Array<{ workerId: string; task: string }> {
  const results: Array<{ workerId: string; task: string }> = [];
  for (const line of text.split('\n')) {
    const m = /^DELEGATE\s+([\w-]+)\s*:\s*(.+)$/i.exec(line.trim());
    if (m) results.push({ workerId: m[1], task: m[2].trim() });
  }
  return results;
}

function extractFinal(text: string): string | null {
  const m = /FINAL:\s*([\s\S]+)/i.exec(text);
  return m ? m[1].trim() : null;
}

export { Supervisor };
