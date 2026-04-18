import { stripAnsi, cleanTuiLine, cleanTui } from "./src/core/stripAnsi";
import { listSessions, getLatestSession, buildResumeArgs } from "./src/core/SessionDiscovery";

// ===== PART 1: Test cleanTuiLine (streaming filter) =====
console.log("========== cleanTuiLine (per-line streaming filter) ==========\n");

const lineTests = [
  // TUI chrome — should DROP
  { input: "──────────────────────────────────────────────────────────────────", expect: null },
  { input: ">   Type your message or @path/to/file for shortcuts", expect: null },
  { input: "D:\\Developments\\tslib\\agent-manager (master*)no sandbox (see /docs)Auto", expect: null },
  { input: "| Generating...(0 s · esc to interrupt)", expect: null },
  { input: "4 MCP servers · 2 skills", expect: null },
  { input: "workspace (/directory)", expect: null },
  { input: "branch", expect: null },
  { input: "sandbox", expect: null },
  { input: "Shift+Tab to accept edits", expect: null },
  { input: "/model", expect: null },
  { input: "Press ? for shortcuts", expect: null },
  { input: "Welcome to qodercli", expect: null },
  { input: "cwd: D:\\Developments\\tslib\\agent-manager", expect: null },
  { input: "Tips for getting started", expect: null },
  { input: "✦ Hello! How can I help you today?", expect: null },
  { input: "Do you trust the files in this folder?", expect: null },
  { input: "1. Trust folder (agent-manager)", expect: null },
  { input: "Gemini CLI v0.38.0", expect: null },
  { input: "Signed in with Google", expect: null },
  { input: "no sandbox", expect: null },
  { input: "(master*)", expect: null },
  { input: "(see /docs)", expect: null },
  { input: "Auto", expect: null },
  { input: "Waiting for authentication...", expect: null },
  { input: "⠋ Waiting for authentication... (Press Esc or Ctrl+C to cancel)", expect: null },
  { input: "⠙ Waiting for authentication...", expect: null },
  { input: "⠹ Waiting for authentication...", expect: null },
  { input: "⠸ Waiting for authentication...", expect: null },
  { input: "⠼ Waiting for authentication...", expect: null },
  { input: "⠴ Waiting for authentication...", expect: null },
  { input: "⠦ Waiting for authentication...", expect: null },
  { input: "⠧ Waiting for authentication...", expect: null },
  { input: "⠇ Waiting for authentication...", expect: null },
  { input: "⠏ Waiting for authentication...", expect: null },
  { input: "(Press Esc or Ctrl+C to cancel)", expect: null },
  { input: "1. Create GEMINI.md files", expect: null },
  { input: "2. /help for more information", expect: null },
  { input: "3. Ask coding questions", expect: null },
  { input: "4. Be specific for the best results", expect: null },
  // Tool call / thinking messages — should DROP
  { input: "⊶  GoogleSearch  Searching the web for: \"current weather in Kuala Lumpur today April 15 2026\"", expect: null },
  { input: "⊶  WebSearch  Searching...", expect: null },
  { input: "Searching the web for: \"KL weather today\"", expect: null },
  // Box-drawing wrapped lines — should DROP
  { input: "│ Welcome to qodercli │", expect: null },
  { input: "│ cwd: D:\\path │", expect: null },
  // Real content — should KEEP
  { input: "Q> what is 7*5", expect: "Q> what is 7*5" },
  { input: "35", expect: "35" },
  { input: "The answer is 4.", expect: "The answer is 4." },
  { input: "Here's a breakdown:", expect: "Here's a breakdown:" },
  { input: "1. First point", expect: "1. First point" },
  { input: "2. Second point", expect: "2. Second point" },
  { input: "  indented code block", expect: "indented code block" },
];

let linePass = 0, lineFail = 0;
for (const t of lineTests) {
  const result = cleanTuiLine(stripAnsi(t.input));
  const ok = result === t.expect;
  if (ok) linePass++; else lineFail++;
  console.log(`  ${ok ? "PASS" : "FAIL"} "${t.input.substring(0, 60)}"`);
  if (!ok) console.log(`    expected: ${JSON.stringify(t.expect)}, got: ${JSON.stringify(result)}`);
}
console.log(`\n  cleanTuiLine: ${linePass}/${linePass + lineFail} passed\n`);

// ===== PART 2: Test cleanTui (full buffer filter) =====
console.log("========== cleanTui (full buffer filter) ==========\n");

// Realistic full qodercli TUI output
const fullBuffer1 = String.raw`
╭──────────────────────────────────────────────────────────────────────────────────────╮
│ Welcome to qodercli                                                                  │
│ cwd: D:\Developments\tslib\agent-manager                                             │
│ Tips for getting started                                                             │
╰──────────────────────────────────────────────────────────────────────────────────────╯
| Generating...(0 s · esc to interrupt)
D:\Developments\tslib\agent-manager (master*)no sandbox (see /docs)Auto
──────────────────────────────────────────────────────────────────────────────────────
>   Type your message or @path/to/file for shortcuts
──────────────────────────────────────────────────────────────────────────────────────
✦ Hello! How can I help you today?
──────────────────────────────────────────────────────────────────────────────────────
> What is 2+2?

D:\Developments\tslib\agent-manager (master*)no sandbox (see /docs)Auto
| Generating...(2 s · esc to interrupt)
──────────────────────────────────────────────────────────────────────────────────────
The answer is 4.

Here's a breakdown:
1. 2 + 2 = 4
2. This is basic arithmetic

──────────────────────────────────────────────────────────────────────────────────────
>   Type your message or @path/to/file
Press ? for shortcuts
`;

const result1 = cleanTui(stripAnsi(fullBuffer1));
const check1 = [
  { name: "no separators", test: !result1.includes("──") },
  { name: "no prompt text", test: !result1.includes("Type your message") },
  { name: "no path/footer", test: !result1.includes("D:\\") && !result1.includes("(master") },
  { name: "no welcome banner", test: !result1.includes("Welcome to") && !result1.includes("cwd:") },
  { name: "no generating", test: !result1.includes("Generating") },
  { name: "no shortcuts", test: !result1.includes("shortcuts") },
  { name: "has Q>", test: result1.includes("Q>") },
  { name: "has answer", test: result1.includes("The answer is 4") },
  { name: "no MCP/skills", test: !result1.includes("MCP server") && !result1.includes("skills") },
  { name: "no workspace/branch", test: !result1.includes("workspace") && !result1.includes("branch") },
  { name: "no Shift+Tab", test: !result1.includes("Shift+Tab") },
  { name: "no /model", test: !result1.includes("/model") },
];

let buf1Pass = 0, buf1Fail = 0;
for (const c of check1) {
  if (c.test) buf1Pass++; else buf1Fail++;
  console.log(`  ${c.test ? "PASS" : "FAIL"} ${c.name}`);
}

console.log("\n  Cleaned output:");
console.log("  " + result1.split('\n').join('\n  '));
console.log(`\n  cleanTui full buffer 1: ${buf1Pass}/${buf1Pass + buf1Fail} passed\n`);

// Realistic full gemini TUI output
const fullBuffer2 = String.raw`
⠋ Waiting for authentication... (Press Esc or Ctrl+C to cancel)
Do you trust the files in this folder?
Trusting a folder allows Gemini CLI to load its local configurations
1. Trust folder (agent-manager)
2. Trust parent folder (tslib)
3. Don't trust
▝▜▄     Gemini CLI v0.38.0
▗▟▀    Signed in with Google /auth
▝▀      Plan: Gemini Code Assist in Google One AI Pro /upgrade
╭─────────────────────────────────────────────────────────────────────╮
We're making changes to Gemini CLI that may impact your workflow.
What's Changing: We are adding more robust detection
How it affects you: This may result in higher capacity errors
Read more: https://goo.gle/geminicli-updates
──────────────────────────────────────────────────────────────────────╯
Tips for getting started:
1. Create GEMINI.md files
2. /help for more information
3. Ask coding questions
4. Be specific for the best results
ℹ Skipping project agents due to untrusted folder
⚠  Skill conflict detected: "find-skills"
⚠  Skill conflict detected: "agent-browser"
4 MCP servers
✦ Hello! How can I help you today?
──────────────────────────────────────────────────────────────────────
> hello
▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
D:\path\to\project (master*)no sandbox (see /docs)Auto
Hi! How can I help you today?
──────────────────────────────────────────────────────────────────────
>   Type your message or @path/to/file
`;

const result2 = cleanTui(stripAnsi(fullBuffer2));
const check2 = [
  { name: "no separators", test: !result2.includes("──") },
  { name: "no trust prompt", test: !result2.includes("Do you trust") },
  { name: "no Gemini version", test: !result2.includes("Gemini CLI") },
  { name: "no skill conflict", test: !result2.includes("Skill conflict") },
  { name: "no MCP count", test: !result2.includes("MCP server") },
  { name: "no greeting", test: !result2.includes("Hello") },
  { name: "no block fill", test: !result2.includes("▄▄") && !result2.includes("▝▜") },
  { name: "has response", test: result2.includes("Hi") || result2.includes("help") },
];

let buf2Pass = 0, buf2Fail = 0;
for (const c of check2) {
  if (c.test) buf2Pass++; else buf2Fail++;
  console.log(`  ${c.test ? "PASS" : "FAIL"} ${c.name}`);
}

console.log("\n  Cleaned output:");
console.log("  " + result2.split('\n').join('\n  '));
console.log(`\n  cleanTui full buffer 2: ${buf2Pass}/${buf2Pass + buf2Fail} passed\n`);

// ===== PART 3: Test session discovery =====
console.log("========== Session discovery ==========\n");

// Qodercli sessions
const qoderSessions = listSessions('qoder', 'D:\\Developments\\tslib\\agent-manager');
console.log(`  Qoder sessions: ${qoderSessions.length} found`);
for (const s of qoderSessions) {
  console.log(`    ${s.id.substring(0, 8)}... resumeArg="${s.resumeArg}" title="${s.title || 'untitled'}"`);
}
const qoderLatest = getLatestSession('qoder', 'D:\\Developments\\tslib\\agent-manager');
console.log(`  Latest qoder session: ${qoderLatest ? qoderLatest.id.substring(0, 8) + '...' : 'none'}`);

// Gemini sessions
const geminiSessions = listSessions('gemini', 'D:\\Developments\\tslib\\agent-manager');
console.log(`\n  Gemini sessions: ${geminiSessions.length} found`);
for (const s of geminiSessions) {
  console.log(`    ${s.id.substring(0, 8)}... resumeArg="${s.resumeArg}" msgs=${s.messageCount || 0}`);
}
const geminiLatest = getLatestSession('gemini', 'D:\\Developments\\tslib\\agent-manager');
console.log(`  Latest gemini session: ${geminiLatest ? geminiLatest.id.substring(0, 8) + '...' : 'none'}`);

// Build resume args
console.log("\n  Resume args:");
console.log(`    qoder latest: ${JSON.stringify(buildResumeArgs('qoder', 'latest'))}`);
console.log(`    qoder specific: ${JSON.stringify(buildResumeArgs('qoder', 'abc123'))}`);
console.log(`    qoder new: ${JSON.stringify(buildResumeArgs('qoder', 'new'))}`);
console.log(`    gemini latest: ${JSON.stringify(buildResumeArgs('gemini', 'latest'))}`);
console.log(`    gemini specific: ${JSON.stringify(buildResumeArgs('gemini', 'xyz789'))}`);

const sessionChecks = [
  { name: "qoder sessions found", test: qoderSessions.length > 0 },
  { name: "gemini sessions found", test: geminiSessions.length > 0 },
  { name: "qoder -r flag correct", test: JSON.stringify(buildResumeArgs('qoder', 'abc')) === JSON.stringify(['-r', 'abc']) },
  { name: "qoder -c flag correct", test: JSON.stringify(buildResumeArgs('qoder', 'latest')) === JSON.stringify(['-c']) },
  { name: "qoder new = no args", test: JSON.stringify(buildResumeArgs('qoder', 'new')) === JSON.stringify([]) },
  { name: "gemini --resume flag correct", test: JSON.stringify(buildResumeArgs('gemini', 'xyz')) === JSON.stringify(['--resume', 'xyz']) },
  { name: "gemini --resume latest", test: JSON.stringify(buildResumeArgs('gemini', 'latest')) === JSON.stringify(['--resume', 'latest']) },
];

let sessionPass = 0, sessionFail = 0;
for (const c of sessionChecks) {
  if (c.test) sessionPass++; else sessionFail++;
  console.log(`  ${c.test ? "PASS" : "FAIL"} ${c.name}`);
}
console.log(`\n  Session discovery: ${sessionPass}/${sessionPass + sessionFail} passed\n`);

// ===== TOTAL =====
const totalPass = linePass + buf1Pass + buf2Pass + sessionPass;
const totalAll = linePass + lineFail + buf1Pass + buf1Fail + buf2Pass + buf2Fail + sessionPass + sessionFail;
console.log("========== TOTAL ==========");
console.log(`  ${totalPass}/${totalAll} passed`);
if (totalPass === totalAll) {
  console.log("  ALL TESTS PASSED");
} else {
  console.log("  SOME TESTS FAILED");
  process.exit(1);
}
