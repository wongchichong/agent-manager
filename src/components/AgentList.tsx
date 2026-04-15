import React from 'react';
import { Box, Text } from 'ink';
import { AgentStatus, PipeConfig } from '../types.js';

interface AgentRow {
  id: string;
  status: AgentStatus;
  color: string;
  lineCount: number;
}

interface Props {
  agents: AgentRow[];
  pipes: PipeConfig[];
  selectedId: string | null;
  focused: boolean;
  cursor: number;
}

const STATUS_ICON: Record<AgentStatus, string> = {
  idle: '●',
  thinking: '◌',
  error: '✖',
  dead: '○',
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: 'green',
  thinking: 'yellow',
  error: 'red',
  dead: 'gray',
};

const THINKING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function AgentList({ agents, pipes, selectedId, focused, cursor }: Props) {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % THINKING_FRAMES.length), 100);
    return () => clearInterval(t);
  }, []);

  const pipeMap = new Map(pipes.map((p) => [p.fromId, p.toId]));

  return (
    <Box
      flexDirection="column"
      width={22}
      borderStyle="single"
      borderColor={focused ? 'cyan' : 'gray'}
    >
      <Box paddingX={1}>
        <Text bold color="cyan">
          AGENTS
        </Text>
      </Box>

      {agents.length === 0 && (
        <Box paddingX={1}>
          <Text dimColor>none — /add &lt;id&gt; &lt;cmd&gt;</Text>
        </Box>
      )}

      {agents.map((a, i) => {
        const isSelected = a.id === selectedId;
        const isCursor = focused && i === cursor;
        const icon =
          a.status === 'thinking' ? THINKING_FRAMES[frame] : STATUS_ICON[a.status];
        const pipeTo = pipeMap.get(a.id);

        return (
          <Box key={a.id} paddingX={1} flexDirection="column">
            <Box>
              {isCursor && <Text color="cyan">▶ </Text>}
              {!isCursor && <Text>  </Text>}
              <Text color={STATUS_COLOR[a.status] as any}>{icon} </Text>
              <Text
                bold={isSelected}
                color={isSelected ? (a.color as any) : undefined}
              >
                {a.id}
              </Text>
            </Box>
            {pipeTo && (
              <Box marginLeft={4}>
                <Text dimColor>↳ </Text>
                <Text color="yellow" dimColor>
                  {pipeTo}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}

      {agents.length > 0 && (
        <Box paddingX={1} marginTop={1}>
          <Text dimColor>{agents.length} total</Text>
        </Box>
      )}
    </Box>
  );
}
