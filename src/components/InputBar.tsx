import React from 'react';
import { Box, Text, useInput } from 'ink';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  selectedAgent: string | null;
  hint?: string;
}

export function InputBar({ value, onChange, onSubmit, selectedAgent, hint }: Props) {
  useInput((input, key) => {
    if (key.return) {
      if (value.trim()) {
        onSubmit(value.trim());
        onChange('');
      }
      return;
    }
    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }
    // Ctrl+U clears line
    if (key.ctrl && input === 'u') {
      onChange('');
      return;
    }
    if (!key.ctrl && !key.meta && input) {
      onChange(value + input);
    }
  });

  const placeholder = selectedAgent
    ? `message ${selectedAgent}   or /cmd …`
    : `/add <id> <cmd> [--flag]   /help`;

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      flexDirection="column"
    >
      {hint && (
        <Box>
          <Text color="yellow">{hint}</Text>
        </Box>
      )}
      <Box>
        <Text color="cyan" bold>
          ❯{' '}
        </Text>
        <Text>{value || <Text dimColor>{placeholder}</Text>}</Text>
        <Text color="cyan">█</Text>
      </Box>
    </Box>
  );
}
