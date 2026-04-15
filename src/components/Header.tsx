import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  agentCount: number;
  pipeCount: number;
  supervisorId?: string | null;
  supervisorStep?: string;
}

const COLORS = ['cyan', 'magenta', 'yellow', 'green', 'blue', 'red'];
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Header({ agentCount, pipeCount, supervisorId, supervisorStep }: Props) {
  const [frame, setFrame] = React.useState(0);
  const [colorIdx, setColorIdx] = React.useState(0);

  React.useEffect(() => {
    const t = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER.length);
      setColorIdx((c) => (c + 1) % COLORS.length);
    }, 120);
    return () => clearInterval(t);
  }, []);

  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color={COLORS[colorIdx] as any}>
        {SPINNER[frame]}
      </Text>
      <Text bold color="cyan">
        {' '}AgentMan{' '}
      </Text>
      <Text dimColor>|</Text>
      <Text color="green"> {agentCount} agent{agentCount !== 1 ? 's' : ''}</Text>
      {pipeCount > 0 && (
        <>
          <Text dimColor> |</Text>
          <Text color="yellow"> {pipeCount} pipe{pipeCount !== 1 ? 's' : ''}</Text>
        </>
      )}
      {supervisorId && (
        <>
          <Text dimColor> |</Text>
          <Text color="magenta"> supervisor: {supervisorId}</Text>
          {supervisorStep && <Text dimColor> — {supervisorStep}</Text>}
        </>
      )}
      <Box flexGrow={1} />
      <Text dimColor>Ctrl+C exit  Esc cancel  Tab panel  ↑↓ navigate</Text>
    </Box>
  );
}
