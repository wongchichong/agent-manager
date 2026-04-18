import { AgentManager } from './src/core/AgentManager.js';
import { Supervisor } from './src/core/Supervisor.js';
import { agentStoreList } from './src/core/AgentStore.js';

const manager = new AgentManager();
const configs = agentStoreList();

if (configs.length === 0) {
  console.error('No agents configured.');
  process.exit(1);
}

for (const config of configs) {
  manager.add(config);
}

manager.on('agentDone', (id, full) => {
  console.log(`[done] ${id}: ${full.length} chars`);
});

// Use qoder (last config) as supervisor - it's in interactive PTY mode
const supervisorConfig = configs[configs.length - 1];
const supervisor = new Supervisor(supervisorConfig.id, manager);

supervisor.on('step', (msg) => console.log(`\n[SUPERVISOR] ${msg}`));
supervisor.on('done', (result) => {
  console.log('\n========== FINAL ==========');
  console.log(result);
  console.log('===========================');
  process.exit(0);
});
supervisor.on('error', (err) => {
  console.error('\n[SUPERVISOR ERROR]', err);
  process.exit(1);
});

console.log('\nWaiting 2s for agent startup...\n');
setTimeout(() => {
  console.log('>>> Sending: "What is 2+2? Reply with just the number."');
  supervisor.run('What is 2+2? Reply with just the number.');
}, 2000);

setTimeout(() => {
  console.error('\nTIMED OUT');
  process.exit(1);
}, 120_000);
