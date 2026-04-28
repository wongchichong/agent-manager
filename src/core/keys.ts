/**
 * Translate Ink's `useInput((input, key) => …)` pair into the bytes a
 * VT/xterm-style PTY expects. Returns null if the key shouldn't be
 * forwarded (e.g. a no-op modifier press).
 *
 * Reference: xterm control sequences. Ink already does the heavy lifting of
 * recognising keys cross-platform — we just translate its abstract `key`
 * back into the literal bytes the slave's terminal driver wants.
 */
export interface InkKey {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
  meta?: boolean;
}

export function encodeKeystroke(input: string, key: InkKey): string | null {
  // Special keys take precedence over `input` (which is sometimes set to
  // a control character that would double-encode if passed through).
  if (key.return)    return '\r';
  if (key.tab)       return key.shift ? '\x1b[Z' : '\t';
  if (key.escape)    return '\x1b';

  // Ctrl+Backspace / Alt+Backspace = word-delete-backward. Most slave TUIs
  // (claude, gemini, qoder, bash, zsh) respond to Ctrl-W (\x17) for this.
  // Must be checked BEFORE the bare backspace/delete cases since key.ctrl
  // is set in addition to key.backspace.
  if ((key.ctrl || key.meta) && (key.backspace || key.delete)) return '\x17';

  if (key.backspace) return '\x7f';
  // `key.delete` is ambiguous: Ink sets it for both `\x08` (BS — what legacy
  // Windows consoles send for the Backspace key) and `\x1b[3~` (real
  // forward-delete). On Windows we can't tell them apart at this layer, and
  // users care far more about Backspace working in the slave TUI than about
  // forward-delete. Map to `\x7f` on Windows so Backspace behaves; users who
  // need forward-delete can press Ctrl+D (the Unix erase-char-forward).
  if (key.delete)    return process.platform === 'win32' ? '\x7f' : '\x1b[3~';
  if (key.upArrow)    return '\x1b[A';
  if (key.downArrow)  return '\x1b[B';
  if (key.rightArrow) return '\x1b[C';
  if (key.leftArrow)  return '\x1b[D';
  if (key.pageUp)     return '\x1b[5~';
  if (key.pageDown)   return '\x1b[6~';

  if (key.ctrl && input) {
    const lower = input.toLowerCase();
    if (lower >= 'a' && lower <= 'z') {
      return String.fromCharCode(lower.charCodeAt(0) - 96); // 'a' → 0x01
    }
    // Ctrl+@/[/\]/^/_ — rarely used, but standard
    const map: Record<string, string> = {
      '@': '\x00', '[': '\x1b', '\\': '\x1c', ']': '\x1d', '^': '\x1e', '_': '\x1f',
      ' ': '\x00',
    };
    if (map[input]) return map[input];
    return null;
  }

  if (key.meta) {
    // Alt-prefixed: ESC + the literal key.
    if (input) return '\x1b' + input;
    return null;
  }

  // Plain printable input
  if (input) return input;
  return null;
}
