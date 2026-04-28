import React from 'react';
import { Box, Text } from 'ink';
import { Message } from '../types.js';

export type OutputView = 'chat' | 'raw';

interface Props {
  agentId: string | null;
  agentColor: string;
  messages: Message[];
  liveChunk: string;
  focused: boolean;
  height: number;
  width: number;
  scrollOffset: number;
  view: OutputView;
  /** Snapshot rows (ANSI-encoded) for the current agent. Used when view='raw'. */
  screen: string[];
}

function roleColor(role: Message['role']): string {
  if (role === 'user') return 'cyan';
  if (role === 'agent') return 'green';
  return 'gray';
}

function roleLabel(role: Message['role']): string {
  if (role === 'user') return 'you';
  if (role === 'agent') return 'agent';
  return 'sys';
}

export function OutputPanel({
  agentId,
  agentColor,
  messages,
  liveChunk,
  focused,
  height,
  width,
  scrollOffset,
  view,
  screen,
}: Props) {
  if (!agentId) {
    return (
      <Box
        flexGrow={1}
        borderStyle="single"
        borderColor={undefined}
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
      >
        <Text color="cyan" dimColor>No agent selected</Text>
        <Text color="cyan" dimColor>Use /add, then Ctrl+B a to focus the agent list</Text>
      </Box>
    );
  }

  // Chrome rows: 1 outer top border + 1 header content + 1 header bottom
  // border + 1 outer bottom border = 4. Content rows = height - 4.
  const available = Math.max(2, height - 4);

  const header = (
    <Box paddingX={1} borderStyle="classic" borderBottom borderTop={false} borderLeft={false} borderRight={false} borderColor={undefined}>
      <Text bold color={agentColor as any}>
        ▸ {agentId}
      </Text>
      <Text color="cyan" dimColor>  {view === 'raw' ? `raw TUI (${screen.length} rows)` : `${messages.length} messages`}</Text>
    </Box>
  );

  if (view === 'raw') {
    // Show the bottom `available` rows of the slave's screen — that's the
    // actual viewport the worker is rendering. ANSI codes pass through Ink
    // verbatim, so colors and styles survive. Screen.ts emits explicit black
    // bg for default cells so the slave row fills the panel width.
    const slaveRows = screen.slice(-available);
    const padCount = Math.max(0, available - slaveRows.length);

    return (
      <Box
        flexGrow={1}
        borderStyle="single"
        borderColor={focused ? 'cyan' : undefined}
        flexDirection="column"
      >
        {header}
        {/* No paddingX here — each slave row gets manual 1-col bg-black gutters
            so the cells right against the panel border are also black, not the
            host terminal's default bg (gray on some setups). */}
        <Box flexDirection="column" flexGrow={1}>
          {Array.from({ length: padCount }).map((_, i) => (
            <Text key={`pad-${i}`} backgroundColor="black">
              {' '.repeat(Math.max(0, width - 2))}
            </Text>
          ))}
          {slaveRows.map((line, i) => (
            <Text key={`s-${i}`} wrap="truncate-end">{line || ' '}</Text>
          ))}
        </Box>
      </Box>
    );
  }

  // ── chat mode (original behavior) ──────────────────────────────────────────
  const allLines: Array<{ label: string; color: string; text: string }> = [];
  for (const msg of messages) {
    const lines = msg.content.split('\n');
    lines.forEach((line, idx) => {
      allLines.push({
        label: idx === 0 ? `[${roleLabel(msg.role)}]` : '      ',
        color: roleColor(msg.role),
        text: line,
      });
    });
  }

  if (liveChunk) {
    const lines = liveChunk.split('\n');
    lines.forEach((line, idx) => {
      allLines.push({
        label: idx === 0 ? '[…]' : '   ',
        color: 'yellow',
        text: line,
      });
    });
  }

  const maxOffset = Math.max(0, allLines.length - available);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const visibleStart = Math.max(0, allLines.length - available - clampedOffset);
  const visible = allLines.slice(visibleStart, visibleStart + available);
  const isScrolled = clampedOffset > 0;

  return (
    <Box
      flexGrow={1}
      borderStyle="single"
      borderColor={focused ? 'cyan' : undefined}
      flexDirection="column"
    >
      <Box paddingX={1} borderStyle="classic" borderBottom borderTop={false} borderLeft={false} borderRight={false} borderColor={undefined}>
        <Text bold color={agentColor as any}>
          ▸ {agentId}
        </Text>
        <Text color="cyan" dimColor>  {messages.length} messages</Text>
        {isScrolled && (
          <Text color="yellow" dimColor>  ↑ scrolled ({clampedOffset} lines)  ↓ to follow</Text>
        )}
      </Box>

      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {visible.length === 0 && (
          <Text color="cyan" dimColor>No output yet — send a prompt with /send {agentId} "…"</Text>
        )}
        {visible.map((line, i) => (
          <Box key={i}>
            <Text color={line.color as any} dimColor>
              {line.label}{' '}
            </Text>
            <Text wrap="truncate-end">{line.text}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
