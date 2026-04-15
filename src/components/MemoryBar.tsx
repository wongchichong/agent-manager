import React from 'react';
import { Box, Text } from 'ink';
import { MemoryEntry } from '../types.js';

interface Props {
  entries: MemoryEntry[];
}

export function MemoryBar({ entries }: Props) {
  if (entries.length === 0) return null;

  const preview = entries
    .slice(0, 6)
    .map((e) => `${e.key}=${e.value.slice(0, 20)}${e.value.length > 20 ? '…' : ''}`)
    .join('  ');

  return (
    <Box paddingX={1} borderStyle="classic" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray">
      <Text color="magenta" bold>
        MEM{' '}
      </Text>
      <Text dimColor>{preview}</Text>
      {entries.length > 6 && <Text dimColor>  +{entries.length - 6} more</Text>}
    </Box>
  );
}
