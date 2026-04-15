import { AgentManager } from './src/core/AgentManager.js';
import { Supervisor } from './src/core/Supervisor.js';
import { agentStoreList } from './src/core/AgentStore.js';
import { Agent } from './src/core/Agent.js';

const manager = new AgentManager();

// Only test with claude (supervisor) for now
const configs = agentStoreList().filter(c => c.id === 'claude');
console.log('Testing agent:', configs.map(c => c.id).join(', '));

for (const config of configs) {
  manager.add(config);
}

const agent = manager.getAgent('claude')!;
agent.on('status', (s) => console.log(`[claude] status → ${s}`));
agent.on('done',   (f) => {
  console.log(`\n[claude] DONE (${f.length} chars):`);
  console.log(JSON.stringify(f.slice(0, 300)));
  process.exit(0);
});
agent.on('stderr', (e) => process.stderr.write(`[claude/err] ${e}`));

// Patch: log all PTY data via the internal event
(agent as any).on('data', (chunk: string) => {
  process.stdout.write(`[DATA] ${JSON.stringify(chunk.slice(0, 80))}\n`);
});

console.log('\nWaiting 4s for startup, then sending prompt...\n');
setTimeout(() => {
  console.log('>>> Sending prompt now');
  agent.send('What is 2+2? Reply with just the number.');
}, 4000);

setTimeout(() => {
  console.error('\nTIMED OUT after 30s');
  process.exit(1);
}, 30_000);
