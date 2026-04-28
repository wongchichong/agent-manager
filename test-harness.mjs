#!/usr/bin/env node
// Headless test harness — same pattern as missbjs/pty's serve+snapshot.
// Spawns `pnpm dev` inside a PTY, folds its output into @xterm/headless,
// and periodically dumps the visible screen to stdout. Optional commands
// arrive on a tiny readline that types into the PTY.
//
// Usage:
//   node test-harness.mjs                  # spawn pnpm dev, snapshot every 1s
//   node test-harness.mjs --once 5000      # snapshot once after 5s, exit
//   node test-harness.mjs --send "/help"   # type a command after startup

import * as pty from 'node-pty';
import xtermHeadless from '@xterm/headless';
import { argv, env, exit, stdout } from 'node:process';

const { Terminal } = xtermHeadless;

const args = argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1] ?? true;
}

const cols = parseInt(flag('cols', 120), 10);
const rows = parseInt(flag('rows', 40), 10);
const onceMs = flag('once') ? parseInt(flag('once'), 10) : null;
const tickMs = parseInt(flag('tick', 1500), 10);
const sendAfter = flag('send'); // string to type after the first snapshot
const sendDelay = parseInt(flag('sendDelay', 4000), 10);
const stopAfter = parseInt(flag('stopAfter', 20000), 10);

const cmd = 'C:\\Windows\\System32\\cmd.exe';
const cmdArgs = ['/c', 'pnpm', 'dev'];

console.log(`[harness] spawning: ${cmd} ${cmdArgs.join(' ')}  (${cols}x${rows})`);

const ptyProc = pty.spawn(cmd, cmdArgs, {
  name: 'xterm-256color',
  cols,
  rows,
  cwd: process.cwd(),
  env: { ...env, TERM: 'xterm-256color' },
});

const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 500 });

ptyProc.onData((chunk) => {
  try { term.write(chunk); } catch {}
});

ptyProc.onExit(({ exitCode }) => {
  console.log(`\n[harness] pty exited (code=${exitCode})`);
  exit(exitCode ?? 0);
});

// SGR-preserving line render. xterm-headless ships translateToString that
// strips formatting (giving us "gray everywhere"); we have to walk cells
// and rebuild SGR codes ourselves to keep the colors intact for terminal
// playback. Mirrors src/core/Screen.ts.
// Mirrors src/core/Screen.ts — emits every cell with explicit SGR (incl. bg)
// so default-bg cells render as RGB black instead of falling back to the
// host terminal's default. No "drop trailing blanks" optimisation.
function renderLine(line, lineCols) {
  let out = '';
  let lastSgr = '';
  for (let x = 0; x < lineCols; x++) {
    const cell = line.getCell(x);
    if (!cell) {
      const sgr = '\x1b[48;2;0;0;0m';
      if (sgr !== lastSgr) {
        if (lastSgr) out += '\x1b[0m';
        out += sgr;
        lastSgr = sgr;
      }
      out += ' ';
      continue;
    }
    if (cell.getWidth() === 0) continue; // skip right-half of wide char
    const chars = cell.getChars();
    const sgr = cellSgr(cell);
    if (sgr !== lastSgr) {
      if (lastSgr) out += '\x1b[0m';
      out += sgr;
      lastSgr = sgr;
    }
    out += chars || ' ';
  }
  if (lastSgr) out += '\x1b[0m';
  return out;
}

function cellSgr(cell) {
  const codes = [];
  if (cell.isBold())          codes.push(1);
  if (cell.isDim())           codes.push(2);
  if (cell.isItalic())        codes.push(3);
  if (cell.isUnderline())     codes.push(4);
  if (cell.isInverse())       codes.push(7);
  if (cell.isInvisible())     codes.push(8);
  if (cell.isStrikethrough()) codes.push(9);
  if (cell.isFgRGB()) {
    const c = cell.getFgColor();
    codes.push(38, 2, (c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
  } else if (cell.isFgPalette()) {
    const c = cell.getFgColor();
    if (c < 8)       codes.push(30 + c);
    else if (c < 16) codes.push(90 + (c - 8));
    else             codes.push(38, 5, c);
  }
  if (cell.isBgRGB()) {
    const c = cell.getBgColor();
    codes.push(48, 2, (c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
  } else if (cell.isBgPalette()) {
    const c = cell.getBgColor();
    if (c < 8)       codes.push(40 + c);
    else if (c < 16) codes.push(100 + (c - 8));
    else             codes.push(48, 5, c);
  } else {
    codes.push(48, 2, 0, 0, 0); // force RGB black for default-bg cells
  }
  return codes.length ? `\x1b[${codes.join(';')}m` : '';
}

function snapshot(label) {
  const buf = term.buffer.active;
  const lines = [];
  for (let y = 0; y < term.rows; y++) {
    const line = buf.getLine(buf.viewportY + y);
    if (!line) { lines.push(''); continue; }
    lines.push(renderLine(line, term.cols));
  }
  const sep = '─'.repeat(Math.min(cols, 100));
  stdout.write(`\n${sep}\n[snapshot ${label}]\n${sep}\n`);
  stdout.write(lines.join('\n') + '\n');
}

let snapCount = 0;
const tick = setInterval(() => {
  snapCount++;
  snapshot(`#${snapCount}`);
  if (onceMs !== null && snapCount >= 1) {
    cleanupAndExit();
  }
}, onceMs ?? tickMs);

if (typeof sendAfter === 'string') {
  // Allow embedded escape sequences via JSON-string form. Recognised tokens:
  //   {tab}, {esc}, {enter}, {ctrl-c}, {ctrl-b}, {pause} (250ms gap)
  const tokens = sendAfter.split(/(\{tab\}|\{esc\}|\{enter\}|\{ctrl-c\}|\{ctrl-b\}|\{pause\})/g)
    .filter((t) => t.length > 0);
  let cursor = sendDelay;
  for (const tok of tokens) {
    let payload;
    let pause = 0;
    if (tok === '{tab}')        payload = '\t';
    else if (tok === '{esc}')   payload = '\x1b';
    else if (tok === '{enter}') payload = '\r';
    else if (tok === '{ctrl-c}') payload = '\x03';
    else if (tok === '{ctrl-b}') payload = '\x02';
    else if (tok === '{pause}') { pause = 250; payload = ''; }
    else payload = tok;
    if (payload) {
      const send = payload;
      setTimeout(() => {
        console.log(`\n[harness] typing: ${JSON.stringify(send)}`);
        ptyProc.write(send);
      }, cursor);
    }
    cursor += pause + 100; // 100ms between every emitted chunk
  }
}

setTimeout(cleanupAndExit, stopAfter);

function cleanupAndExit() {
  clearInterval(tick);
  snapshot('final');
  try { ptyProc.kill(); } catch {}
  setTimeout(() => exit(0), 300);
}
