// Flicker detector. Spawns AgentMan in a tall PTY, sends keystrokes to
// switch to qoder, takes rapid-fire snapshots, then diffs each row across
// snapshots. Any chrome row that changes when nothing should be moving is
// flicker.
import * as pty from 'node-pty';
import xtermHeadless from '@xterm/headless';
import { argv, env } from 'node:process';
const { Terminal } = xtermHeadless;

const COLS = 120;
const ROWS = 50;

const ptyProc = pty.spawn('C:\\Windows\\System32\\cmd.exe', ['/c', 'pnpm', 'dev'], {
  name: 'xterm-256color', cols: COLS, rows: ROWS,
  cwd: process.cwd(), env: { ...env, TERM: 'xterm-256color' },
});

const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
ptyProc.onData((c) => { try { term.write(c); } catch {} });
ptyProc.onExit(() => process.exit(0));

function snapshotPlain() {
  const buf = term.buffer.active;
  const out = [];
  for (let y = 0; y < term.rows; y++) {
    const line = buf.getLine(buf.viewportY + y);
    if (!line) { out.push(''); continue; }
    let s = '';
    for (let x = 0; x < term.cols; x++) {
      const cell = line.getCell(x);
      if (!cell || cell.getWidth() === 0) { if (cell) continue; s += ' '; continue; }
      s += cell.getChars() || ' ';
    }
    out.push(s.trimEnd());
  }
  return out;
}

function snapshotWithSgr() {
  const buf = term.buffer.active;
  const out = [];
  for (let y = 0; y < term.rows; y++) {
    const line = buf.getLine(buf.viewportY + y);
    if (!line) { out.push(''); continue; }
    let s = '';
    for (let x = 0; x < term.cols; x++) {
      const cell = line.getCell(x);
      if (!cell || cell.getWidth() === 0) { if (cell) continue; s += ' '; continue; }
      // Encode SGR briefly so we can detect color flicker too.
      let attrs = [];
      if (cell.isBold()) attrs.push('B');
      if (cell.isDim()) attrs.push('D');
      if (cell.isFgPalette()) attrs.push('p' + cell.getFgColor());
      else if (cell.isFgRGB()) attrs.push('r' + cell.getFgColor());
      if (cell.isBgPalette()) attrs.push('q' + cell.getBgColor());
      else if (cell.isBgRGB()) attrs.push('s' + cell.getBgColor());
      const sgr = attrs.length ? '[' + attrs.join('') + ']' : '';
      s += sgr + (cell.getChars() || ' ');
    }
    out.push(s);
  }
  return out;
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function send(s) { ptyProc.write(s); }

(async () => {
  console.log(`[flicker] spawned PTY ${COLS}x${ROWS}, waiting 8s for startup…`);
  await sleep(8000);

  // PHASE 1: idle baseline.
  console.log('[flicker] phase 1: idle baseline, 10 snapshots over 3s…');
  const phase1 = [];
  for (let i = 0; i < 10; i++) {
    phase1.push({ plain: snapshotPlain(), sgr: snapshotWithSgr() });
    await sleep(300);
  }
  let p1Plain = 0, p1Sgr = 0;
  for (let y = 0; y < ROWS; y++) {
    if (new Set(phase1.map((s) => s.plain[y])).size > 1) p1Plain++;
    if (new Set(phase1.map((s) => s.sgr[y])).size > 1) p1Sgr++;
  }
  console.log(`[flicker] phase 1 result: ${p1Plain} plain rows / ${p1Sgr} SGR rows changed`);

  // PHASE 2: switch to qoder via Ctrl+B a, ↓↓.
  console.log('[flicker] phase 2: Ctrl+B a, ↓↓ to qoder, then 10 snapshots over 3s…');
  send('\x02'); await sleep(150);
  send('a'); await sleep(500);
  send('\x1b[B'); await sleep(300);
  send('\x1b[B'); await sleep(800);

  console.log('[flicker] taking 10 snapshots over 3s…');
  const snaps = [];
  for (let i = 0; i < 10; i++) {
    snaps.push({ plain: snapshotPlain(), sgr: snapshotWithSgr() });
    await sleep(300);
  }

  // Diff each row across snapshots. Identify rows whose CONTENT (ignoring
  // ANSI) or whose SGR changed between snapshots — anything other than 0
  // unique values means that row flickered.
  const ROW_NAMES = {
    0: 'top border',
    1: 'Header content',
    2: 'Header bottom',
    3: 'AgentList top + OutputPanel top',
    4: 'AgentList AGENTS row + OutputPanel header',
    [ROWS - 4]: 'OutputPanel bottom border + InputBar top',
    [ROWS - 3]: 'InputBar hint row',
    [ROWS - 2]: 'InputBar prompt',
    [ROWS - 1]: 'InputBar bottom border',
  };

  console.log('\n[flicker] === plain-text variations per row ===');
  let plainFlicker = 0;
  for (let y = 0; y < ROWS; y++) {
    const variants = new Set(snaps.map((s) => s.plain[y]));
    if (variants.size > 1) {
      plainFlicker++;
      console.log(`row ${String(y).padStart(2)}: ${variants.size} variants${ROW_NAMES[y] ? ` (${ROW_NAMES[y]})` : ''}`);
      for (const v of variants) console.log(`    ${JSON.stringify(v.slice(0, 100))}`);
    }
  }
  if (plainFlicker === 0) console.log('  → no plain-text changes across snapshots');

  console.log('\n[flicker] === SGR variations per row ===');
  let sgrFlicker = 0;
  for (let y = 0; y < ROWS; y++) {
    const variants = new Set(snaps.map((s) => s.sgr[y]));
    if (variants.size > 1) {
      sgrFlicker++;
      console.log(`row ${String(y).padStart(2)}: ${variants.size} SGR variants${ROW_NAMES[y] ? ` (${ROW_NAMES[y]})` : ''}`);
    }
  }
  if (sgrFlicker === 0) console.log('  → no SGR changes across snapshots');

  console.log(`\n[flicker] summary: ${plainFlicker} rows with plain-text flicker, ${sgrFlicker} rows with SGR flicker`);

  ptyProc.kill();
})();
