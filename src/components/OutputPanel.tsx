import React from 'react';
import { Box, Text } from 'ink';
import { Message } from '../types.js';

interface Props {
  agentId: string | null;
  agentColor: string;
  messages: Message[];
  liveChunk: string;
  focused: boolean;
  height: number;
  scrollOffset: number;
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

export function OutputPanel({ agentId, agentColor, messages, liveChunk, focused, height, scrollOffset }: Props) {
  if (!agentId) {
    return (
      <Box
        flexGrow={1}
        borderStyle="single"
        borderColor="gray"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
      >
        <Text dimColor>No agent selected</Text>
        <Text dimColor>Use /add to create one, then Tab to focus the list</Text>
      </Box>
    );
  }

  // Reserve 2 lines for border + header, 1 for padding
  const available = Math.max(2, height - 4);

  // Flatten to renderable lines — truncate long text lines to prevent overflow
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

  // Live streaming chunk
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

  // Clamp scroll offset to valid range
  const maxOffset = Math.max(0, allLines.length - available);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const visibleStart = Math.max(0, allLines.length - available - clampedOffset);
  const visible = allLines.slice(visibleStart, visibleStart + available);
  const isScrolled = clampedOffset > 0;

  return (
    <Box
      flexGrow={1}
      borderStyle="single"
      borderColor={focused ? 'cyan' : 'gray'}
      flexDirection="column"
    >
      <Box paddingX={1} borderStyle="classic" borderBottom borderTop={false} borderLeft={false} borderRight={false} borderColor="gray">
        <Text bold color={agentColor as any}>
          ▸ {agentId}
        </Text>
        <Text dimColor>  {messages.length} messages</Text>
        {isScrolled && (
          <Text color="yellow" dimColor>  ↑ scrolled ({clampedOffset} lines)  ↓ to follow</Text>
        )}
      </Box>

      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {visible.length === 0 && (
          <Text dimColor>No output yet — send a prompt with /send {agentId} "…"</Text>
        )}
        {visible.map((line, i) => (
          <Box key={i}>
            <Text color={line.color as any} dimColor>
              {line.label}{' '}
            </Text>
            <Text>{line.text}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
