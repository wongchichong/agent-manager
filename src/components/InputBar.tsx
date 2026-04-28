import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useTerminalWidth } from './useTerminalWidth.js';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  selectedAgent: string | null;
  hint?: string;
  /** Only consume keystrokes when the master input mode is active (panel === 'input').
   *  In other modes the slave PTY gets the keys, so the bar must be silent. */
  active: boolean;
}

function InputBarImpl({ value, onChange, onSubmit, selectedAgent, hint, active }: Props) {
  const width = useTerminalWidth();

  useInput(
    (input, key) => {
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
      if (key.ctrl && input === 'u') {
        onChange('');
        return;
      }
      if (!key.ctrl && !key.meta && input) {
        onChange(value + input);
      }
    },
    { isActive: active },
  );

  const placeholder = active
    ? selectedAgent
      ? `message ${selectedAgent}   or /cmd …`
      : `/add <id> <cmd> [--flag]   /help`
    : 'Ctrl+B  i input · a agents · c cancel · 0-9 pick · ? help';

  // Width math — content fills the box width so empty cells get bg too.
  // Box has rounded border (2 cols). Reserve 1 leading + 1 trailing space.
  const innerWidth = Math.max(0, width - 2);
  const contentWidth = Math.max(0, innerWidth - 2);

  // Hint line (when present): "<hint>" left-aligned, padded to fill width.
  // Always reserve the hint row (even when empty) so the InputBar's height
  // stays at 4 rows. A hint that appears/disappears would otherwise change
  // flexHeight, forcing AgentList & OutputPanel to relayout — that shift
  // re-emits the entire chrome region as visible flicker.
  const hintText = hint ?? '';
  const hintGap = Math.max(0, contentWidth - hintText.length);

  // Prompt line: "❯ " + (value || placeholder) + cursor + padding.
  const shown = value || placeholder;
  const promptVisibleLen = 2 /* "❯ " */ + shown.length + (active ? 1 /* █ cursor */ : 0);
  const promptGap = Math.max(0, contentWidth - promptVisibleLen);

  return (
    <Box
      borderStyle="round"
      // Always cyan: borderColor=gray vanishes on gray-bg terminals.
      borderColor="cyan"
      flexDirection="column"
    >
      <Box>
        <Text backgroundColor="black">
          {' '}
          <Text color="yellow">{hintText}</Text>
          {' '.repeat(hintGap)}
          {' '}
        </Text>
      </Box>
      <Box>
        <Text backgroundColor="black">
          {' '}
          {/* dimColor gives a relative reduction, so it stays readable on any bg. */}
          <Text bold color="cyan" dimColor={!active}>
            ❯{' '}
          </Text>
          {value
            ? <Text dimColor={!active}>{value}</Text>
            : <Text color="cyan" dimColor>{placeholder}</Text>}
          {active && <Text color="cyan">█</Text>}
          {' '.repeat(promptGap)}
          {' '}
        </Text>
      </Box>
    </Box>
  );
}

export const InputBar = React.memo(InputBarImpl);
