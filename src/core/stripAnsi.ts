/**
 * Strip ANSI escape codes from a string.
 */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, '')
    .replace(/\x1b[^\[\]][^\x1b]*/g, '')
    .replace(/\x1b/g, '');
}

/**
 * Filter a single line of TUI output. Returns the cleaned line or null if it
 * should be dropped entirely. Used for streaming (live chunk) filtering.
 */
export function cleanTuiLine(line: string): string | null {
  let s = line.trim();
  if (!s) return null;

  // Strip box-drawing borders first
  s = s.replace(/^[│┃╭╮╰╯╔╗╚╝╟╢╤╧╪╞╡┌┐└┘├┤┬┴┼]+/, '')
       .replace(/[│┃╭╮╰╯╔╗╚╝╟╢╤╧╪╞╡┌┐└┘├┤┬┴┼]+$/, '')
       .trim();
  if (!s) return null;

  // Strip leading block chars
  s = s.replace(/^[▀▄█▌▐▝▜▗▟▚▛▜▞▟]+\s*/, '').trim();
  if (!s) return null;

  // Drop TUI chrome lines
  if (/^[▀▄█▌▐▝▜▗▟▚▛▜▞▟]+$/.test(s)) return null;
  if (/^[─═━\s\-_=~*#]{3,}$/.test(s)) return null;
  if (/^(Press |Model: |\? for shortcuts|ctrl\+[jcf]|esc to (interrupt|cancel))/.test(s)) return null;
  if (/^>\s*(Type your message|@path|for shortcuts|\s*$)/.test(s)) return null;
  if (/^>\s+Type your message/.test(s)) return null;
  if (/^(Welcome to|cwd:|Tips for getting started|Ask questions|Be specific|Type \/help)/.test(s)) return null;
  if (/^[|/\\-]\s+(?:Generating|Thinking|Loading|Processing)/.test(s)) return null;
  if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]+\s+.*\(esc to cancel/.test(s)) return null;
  if (/^[A-Z]:\\.*\(master/.test(s)) return null;
  if (/^[A-Z]:\\.*no sandbox/.test(s)) return null;
  if (/^[A-Z]:\\.*\(see \/docs\)/.test(s)) return null;
  if (/^[A-Z]:\\.*\s+\(master[^)]*\)/.test(s)) return null;
  if (/^\(master[^)]*\)/.test(s)) return null;
  if (/^no sandbox/.test(s)) return null;
  if (/^\(see \/docs\)/.test(s)) return null;
  if (/^(Auto|Pro|Plus)\s*$/.test(s)) return null;
  if (/^\d+\s+MCP server/i.test(s)) return null;
  if (/^✦\s+Hello!?\s*How can I help/i.test(s)) return null;
  if (/^(no sandbox|sandbox|Auto)\s*$/.test(s)) return null;

  // Auth / spinner waiting lines — catch all Braille spinner chars
  if (/^Waiting for authentication/i.test(s)) return null;
  if (/^\s*\(Press Esc/i.test(s)) return null;
  if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*Waiting for authentication/i.test(s)) return null;
  if (/⠋.*\(Press Esc/i.test(s)) return null;

  // Tool call / thinking messages (Gemini/qodercli showing what it's doing)
  if (/^⊶\s+\w+/.test(s)) return null;
  if (/^Searching the web for:/i.test(s)) return null;

  // Do you trust / trust options
  if (/^Do you trust the files/i.test(s)) return null;
  if (/^Trusting a folder allows/i.test(s)) return null;
  if (/^\d+\.\s+(Trust|Don'?t trust)/i.test(s)) return null;

  // Gemini startup tips section (numbered tips after welcome banner)
  if (/^\d+\.\s+(Create GEMINI\.md|\/help|Ask coding|Be specific)/i.test(s)) return null;
  if (/^Gemini CLI v\d/i.test(s)) return null;
  if (/^Signed in with Google/i.test(s)) return null;
  if (/^Plan:\s/i.test(s)) return null;
  if (/^We're making changes to Gemini CLI/i.test(s)) return null;
  if (/^What's Changing:/i.test(s)) return null;
  if (/^How it affects you:/i.test(s)) return null;
  if (/^Read more:\s/i.test(s)) return null;
  if (/^[ℹ⚠⚡]\s+/.test(s)) return null;
  if (/^Skipping project agents/i.test(s)) return null;
  if (/^Skill conflict detected:/i.test(s)) return null;
  if (/^Gemini Code Assist in Google One AI Pro/i.test(s)) return null;
  if (/^\/upgrade/.test(s)) return null;
  if (/^Waiting for authentication/i.test(s)) return null;
  if (/^\| (Generating|Thinking|Loading|Processing)/.test(s)) return null;

  // Gemini/qodercli status bar items
  if (/^\d+\s+MCP server/i.test(s)) return null;
  if (/^\d+\s+skill/i.test(s)) return null;
  if (/^workspace\s/i.test(s)) return null;
  if (/^\/directory/.test(s)) return null;
  if (/^\(\/directory\)/.test(s)) return null;
  if (/^branch\s*$/.test(s)) return null;
  if (/^sandbox\s*$/.test(s)) return null;
  if (/^Shift\+Tab to accept edits/i.test(s)) return null;
  if (/^\/model\b/.test(s)) return null;

  // Strip leading bullets
  s = s.replace(/^[●■◆★►]\s+/, '');

  // Strip inline spinner
  s = s.replace(/\s*[|/\\-]\s+(?:Generating|Thinking|Loading|Processing)[\s\S]*$/, '').trim();
  if (!s) return null;

  // Strip inline gemini spinner
  s = s.replace(/\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+\w+.*\(esc to cancel.*$/, '').trim();
  if (!s) return null;

  return s;
}

/**
 * Extract only the meaningful conversation content from a TUI buffer.
 * Strips ALL TUI chrome: frames, separators, status bars, spinners,
 * input prompts, progress indicators — leaving only Q> and A> style content.
 */
export function cleanTui(text: string): string {
  const lines = text.split('\n');
  const messages: string[] = [];
  let currentMessage = '';

  const SPINNER_RE = /[|/\\-]\s+(?:Generating|Thinking|Loading|Processing)[\s(…\.]/;

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // ── Step 1: Strip TUI frame borders from the line first ──────────────
    // Remove leading/trailing box-drawing chars so content filters can match
    line = line.replace(/^[│┃╭╮╰╯╔╗╚╝╟╢╤╧╪╞╡┌┐└┘├┤┬┴┼]+/, '')
               .replace(/[│┃╭╮╰╯╔╗╚╝╟╢╤╧╪╞╡┌┐└┘├┤┬┴┼]+$/, '')
               .trim();
    if (!line) continue;

    // Remove leading block chars (decorative prefixes)
    line = line.replace(/^[▀▄█▌▐▝▜▗▟▚▛▜▞▟]+\s*/, '').trim();
    if (!line) continue;

    // ── Step 2: Skip entire TUI chrome lines ─────────────────────────────

    // Pure block fill: ▀▀▀▀, ▄▄▄▄
    if (/^[▀▄█▌▐▝▜▗▟▚▛▜▞▟]+$/.test(line)) continue;

    // Separator / border lines (pure separator chars, minimum 3)
    if (/^[─═━\s\-_=~*#]{3,}$/.test(line)) continue;

    // Footer / status bar
    if (/^(Press |Model: |\? for shortcuts|ctrl\+[jcf]|esc to (interrupt|cancel))/.test(line)) continue;

    // Input prompt area
    if (/^>\s*(Type your message|@path|for shortcuts|\s*$)/.test(line)) continue;
    if (/^>\s+Type your message/.test(line)) continue;

    // Welcome / startup banner
    if (/^(Welcome to|cwd:|Tips for getting started|Ask questions|Be specific|Type \/help)/.test(line)) continue;

    // Pure spinner line
    if (/^[|/\\-]\s+(?:Generating|Thinking|Loading|Processing)/.test(line)) continue;

    // Gemini spinner
    if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]+\s+.*\(esc to cancel/.test(line)) continue;

    // Status bar: "D:\path\to\project (master*)..."
    if (/^[A-Z]:\\.*\(master/.test(line)) continue;
    if (/^[A-Z]:\\.*no sandbox/.test(line)) continue;
    if (/^[A-Z]:\\.*\(see \/docs\)/.test(line)) continue;
    if (/^[A-Z]:\\.*\s+\(master[^)]*\)/.test(line)) continue;

    // Status bar fragments
    if (/^\(master[^)]*\)/.test(line)) continue;
    if (/^no sandbox/.test(line)) continue;
    if (/^\(see \/docs\)/.test(line)) continue;
    if (/^(Auto|Pro|Plus)\s*$/.test(line)) continue;

    // Gemini MCP / qodercli status bar
    if (/^\d+\s+MCP server/i.test(line)) continue;
    if (/^\d+\s+skill/i.test(line)) continue;
    if (/^workspace\s/i.test(line)) continue;
    if (/^\/directory/.test(line)) continue;
    if (/^\(\/directory\)/.test(line)) continue;
    if (/^branch\s*$/.test(line)) continue;
    if (/^sandbox\s*$/.test(line)) continue;
    if (/^Shift\+Tab to accept edits/i.test(line)) continue;
    if (/^\/model\b/.test(line)) continue;

    // Gemini greeting
    if (/^✦\s+Hello!?\s*How can I help/i.test(line)) continue;

    // Gemini sandbox
    if (/^(no sandbox|sandbox|Auto)\s*$/.test(line)) continue;

    // Gemini trust
    if (/^Do you trust the files/i.test(line)) continue;
    if (/^Trusting a folder allows/i.test(line)) continue;
    if (/^\d+\.\s+(Trust|Don'?t trust)/i.test(line)) continue;

    // Gemini version/auth
    if (/^Gemini CLI v\d/i.test(line)) continue;
    if (/^Signed in with Google/i.test(line)) continue;
    if (/^Plan:\s/i.test(line)) continue;

    // Gemini announcements
    if (/^We're making changes to Gemini CLI/i.test(line)) continue;
    if (/^What's Changing:/i.test(line)) continue;
    if (/^How it affects you:/i.test(line)) continue;
    if (/^Read more:\s/i.test(line)) continue;

    // Gemini info/warning
    if (/^[ℹ⚠⚡]\s+/.test(line)) continue;
    if (/^Skipping project agents/i.test(line)) continue;
    if (/^Skill conflict detected:/i.test(line)) continue;

    // Gemini upgrade
    if (/^Gemini Code Assist in Google One AI Pro/i.test(line)) continue;
    if (/^\/upgrade/.test(line)) continue;

    // Auth waiting — catch all Braille spinner variants
    if (/^Waiting for authentication/i.test(line)) continue;
    if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*Waiting for authentication/i.test(line)) continue;
    if (/^\s*\(Press Esc/i.test(line)) continue;
    if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏].*\(Press Esc/i.test(line)) continue;

    // Tool call / thinking messages (Gemini/qodercli showing what it's doing)
    if (/^⊶\s+\w+/.test(line)) continue;
    if (/^Searching the web for:/i.test(line)) continue;

    // Gemini startup tips (numbered tips after welcome banner)
    if (/^\d+\.\s+(Create GEMINI\.md|\/help|Ask coding|Be specific)/i.test(line)) continue;

    // qodercli generating
    if (/^\| (Generating|Thinking|Loading|Processing)/.test(line)) continue;

    // ── Step 3: Strip inline artifacts from content lines ────────────────

    // Strip leading bullet markers
    line = line.replace(/^[●■◆★►]\s+/, '');

    // Strip inline spinner
    if (SPINNER_RE.test(line)) {
      line = line.replace(/\s*[|/\\-]\s+(?:Generating|Thinking|Loading|Processing)[\s\S]*$/, '').trim();
      if (!line) continue;
    }

    // Strip inline gemini spinner
    if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+\w+.*\(esc to cancel/.test(line)) {
      line = line.replace(/\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+\w+.*$/, '').trim();
      if (!line) continue;
    }

    // ── Step 4: Handle user prompt echoes ────────────────────────────────

    if (line.startsWith('> ') && line.length > 2) {
      if (currentMessage) messages.push(currentMessage);
      currentMessage = 'Q> ' + line.slice(2);
      continue;
    }

    // ── Step 5: Accumulate content ───────────────────────────────────────

    if (currentMessage) {
      const lastLine = currentMessage.split('\n').pop() || '';
      if (line.startsWith(lastLine) && line.length > lastLine.length) {
        const parts = currentMessage.split('\n');
        parts[parts.length - 1] = line;
        currentMessage = parts.join('\n');
      } else if (lastLine.startsWith(line) && lastLine.length > line.length) {
        continue;
      } else {
        currentMessage += '\n' + line;
      }
    } else {
      currentMessage = line;
    }
  }

  if (currentMessage) messages.push(currentMessage);
  if (messages.length === 0) return '';

  return messages.join('\n\n');
}
