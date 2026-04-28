import type { Terminal } from '@xterm/headless';

/**
 * Render the visible viewport of an xterm-headless Terminal as ANSI-encoded
 * strings, one per row. Each row contains SGR escape codes so colors and
 * basic styles survive when written to a real terminal (or to Ink, which
 * passes ANSI through).
 *
 * Returned strings do NOT contain a trailing newline. Empty rows are returned
 * as empty strings.
 */
export function renderScreen(term: Terminal): string[] {
  const buf = term.buffer.active;
  const rows = term.rows;
  const cols = term.cols;
  // For alternate-screen TUIs (qodercli, gemini full-screen, etc.) viewportY
  // is 0 and the buffer.length === rows. For the normal buffer it tracks
  // scrollback; we only ever want the visible viewport.
  const start = buf.viewportY;
  const out: string[] = [];

  // Each row gets a leading + trailing 1-col bg-black gutter so OutputPanel
  // doesn't need to wrap content with padding Texts (which fragments Ink's
  // string-width calculation and drops the panel's right border).
  const PAD = '\x1b[48;2;0;0;0m \x1b[0m';

  for (let y = 0; y < rows; y++) {
    const line = buf.getLine(start + y);
    if (!line) {
      out.push(PAD + ' '.repeat(cols) + PAD);
      continue;
    }
    out.push(PAD + renderLine(line, cols) + PAD);
  }
  return out;
}

function renderLine(line: any, cols: number): string {
  let result = '';
  let lastSgr = '';

  // Emit every cell with explicit SGR (including bg). Default-bg cells get
  // explicit RGB black so the rendered row never falls back to the host
  // terminal's default bg (which is gray on some setups, leaking through the
  // chrome). Runs of identical SGR are coalesced via lastSgr.
  for (let x = 0; x < cols; x++) {
    const cell = line.getCell(x);
    if (!cell) {
      // Missing cell → emit one blank with forced bg-black.
      const sgr = '\x1b[48;2;0;0;0m';
      if (sgr !== lastSgr) {
        if (lastSgr) result += '\x1b[0m';
        result += sgr;
        lastSgr = sgr;
      }
      result += ' ';
      continue;
    }
    if (cell.getWidth() === 0) {
      // Right half of a wide char — the wide char at the previous index
      // already emitted both visible columns. Skip this iteration entirely
      // (emitting another space here would overflow the row by 1 cell per
      // wide char, pushing the panel's right border off-screen).
      continue;
    }

    const chars = cell.getChars();
    const sgr = cellSgr(cell);

    if (sgr !== lastSgr) {
      if (lastSgr) result += '\x1b[0m';
      result += sgr;
      lastSgr = sgr;
    }
    result += chars || ' ';
  }
  if (lastSgr) result += '\x1b[0m';
  return result;
}

function cellSgr(cell: any): string {
  const codes: number[] = [];

  if (cell.isBold()) codes.push(1);
  if (cell.isDim()) codes.push(2);
  if (cell.isItalic()) codes.push(3);
  if (cell.isUnderline()) codes.push(4);
  if (cell.isInverse()) codes.push(7);
  if (cell.isInvisible()) codes.push(8);
  if (cell.isStrikethrough()) codes.push(9);

  if (cell.isFgRGB()) {
    const c = cell.getFgColor();
    codes.push(38, 2, (c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
  } else if (cell.isFgPalette()) {
    const c = cell.getFgColor();
    if (c < 8) codes.push(30 + c);
    else if (c < 16) codes.push(90 + (c - 8));
    else codes.push(38, 5, c);
  }

  if (cell.isBgRGB()) {
    const c = cell.getBgColor();
    codes.push(48, 2, (c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
  } else if (cell.isBgPalette()) {
    const c = cell.getBgColor();
    if (c < 8) codes.push(40 + c);
    else if (c < 16) codes.push(100 + (c - 8));
    else codes.push(48, 5, c);
  } else {
    // Default bg → force RGB black so the slave's empty cells don't fall
    // through to the host terminal's default bg.
    codes.push(48, 2, 0, 0, 0);
  }

  // codes is non-empty (we always emit at least the bg above).
  return `\x1b[${codes.join(';')}m`;
}
