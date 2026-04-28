// Tiny wrapper: run test-harness.mjs, capture its stdout (preserving ESC),
// write to file, then report counts of problematic SGR sequences.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const child = spawn(process.execPath, ['test-harness.mjs', '--once', '13000', '--stopAfter', '15000'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let buf = Buffer.alloc(0);
child.stdout.on('data', (d) => { buf = Buffer.concat([buf, d]); });
child.stderr.on('data', () => {});
child.on('close', () => {
  writeFileSync('snap.bin', buf);
  const s = buf.toString('binary');
  const re = /\x1b\[[0-9;]+m/g;
  const counts = new Map();
  let m;
  while ((m = re.exec(s))) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  // Pull out anything that includes ;2m or starts with [2m
  const dimOnly = [...counts].filter(([k]) => /(^|;)2m$/.test(k) || /\[2m$/.test(k));
  console.log(`total bytes: ${buf.length}`);
  console.log(`unique SGR codes: ${counts.size}`);
  console.log(`dim-only (no color) sequences: ${dimOnly.length === 0 ? 'NONE — good' : ''}`);
  for (const [k, v] of dimOnly) console.log(`  ${JSON.stringify(k)} × ${v}`);
  // Top 10 frequencies for inspection
  console.log('top SGR sequences:');
  for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${JSON.stringify(k)} × ${v}`);
  }
});
