import React from 'react';
import { Box, Text } from 'ink';
import { MemoryEntry } from '../types.js';
import { useTerminalWidth } from './useTerminalWidth.js';

interface Props {
  entries: MemoryEntry[];
}

function MemoryBarImpl({ entries }: Props) {
  const width = useTerminalWidth();
  if (entries.length === 0) return null;

  const preview = entries
    .slice(0, 6)
    .map((e) => `${e.key}=${e.value.slice(0, 20)}${e.value.length > 20 ? '…' : ''}`)
    .join('  ');

  const overflow = entries.length > 6 ? `  +${entries.length - 6} more` : '';
  // Border classic with only top → no left/right border, so inner width = total
  // width minus paddingX*2 (we use paddingX=1 inside the Box).
  const contentWidth = Math.max(0, width - 2);
  const usedLen = 'MEM '.length + preview.length + overflow.length;
  const gap = Math.max(0, contentWidth - usedLen);

  return (
    <Box borderStyle="classic" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
      <Text backgroundColor="black">
        {' '}
        <Text color="magenta" bold>MEM </Text>
        <Text color="magenta" dimColor>{preview}</Text>
        {overflow && <Text color="magenta" dimColor>{overflow}</Text>}
        {' '.repeat(gap)}
        {' '}
      </Text>
    </Box>
  );
}

export const MemoryBar = React.memo(MemoryBarImpl);
