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
  /** Total panel height (incl. borders). Used to pad empty rows with bg-black. */
  height: number;
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

const PANEL_W = 22;
const ROW_W = PANEL_W - 2; // inner = 20

function AgentListImpl({ agents, pipes, selectedId, focused, cursor, height }: Props) {
  const [frame, setFrame] = React.useState(0);
  // Only run the spinner clock when at least one agent is in 'thinking'
  // state — otherwise the interval drives a re-render every 100ms for
  // nothing, and (combined with the screen-event firehose) is enough to
  // make the chrome flicker visibly when the terminal is tall.
  const hasThinking = agents.some((a) => a.status === 'thinking');
  React.useEffect(() => {
    if (!hasThinking) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % THINKING_FRAMES.length), 100);
    return () => clearInterval(t);
  }, [hasThinking]);

  const pipeMap = new Map(pipes.map((p) => [p.fromId, p.toId]));

  const rows: React.ReactNode[] = [];

  // AGENTS header
  rows.push(
    <Box key="hdr">
      <Text backgroundColor="black">
        <Text bold color="cyan">{' AGENTS'}</Text>
        {' '.repeat(Math.max(0, ROW_W - ' AGENTS'.length))}
      </Text>
    </Box>,
  );

  if (agents.length === 0) {
    const text = ' none — /add';
    rows.push(
      <Box key="empty">
        <Text backgroundColor="black">
          <Text color="cyan" dimColor>{text}</Text>
          {' '.repeat(Math.max(0, ROW_W - text.length))}
        </Text>
      </Box>,
    );
  }

  agents.forEach((a, i) => {
    const isSelected = a.id === selectedId;
    const isCursor = focused && i === cursor;
    const icon = a.status === 'thinking' ? THINKING_FRAMES[frame] : STATUS_ICON[a.status];
    const pipeTo = pipeMap.get(a.id);

    // Visible width: 1 leading + 2 (cursor or two spaces) + 2 (icon + space) + id.
    const used = 1 + 2 + 2 + a.id.length;
    const pad = Math.max(0, ROW_W - used);

    rows.push(
      <Box key={`a-${a.id}`}>
        <Text backgroundColor="black">
          {' '}
          {isCursor ? <Text color="cyan">▶ </Text> : '  '}
          <Text color={STATUS_COLOR[a.status] as any}>{icon} </Text>
          <Text bold={isSelected} color={isSelected ? (a.color as any) : undefined}>
            {a.id}
          </Text>
          {' '.repeat(pad)}
        </Text>
      </Box>,
    );

    if (pipeTo) {
      const pipeUsed = 4 + 2 + pipeTo.length;
      const pipePad = Math.max(0, ROW_W - pipeUsed);
      rows.push(
        <Box key={`p-${a.id}`}>
          <Text backgroundColor="black">
            {'    '}
            <Text color="yellow" dimColor>{`↳ ${pipeTo}`}</Text>
            {' '.repeat(pipePad)}
          </Text>
        </Box>,
      );
    }
  });

  if (agents.length > 0) {
    // Visual margin: blank bg row.
    rows.push(
      <Box key="margin">
        <Text backgroundColor="black">{' '.repeat(ROW_W)}</Text>
      </Box>,
    );
    const totalStr = ` ${agents.length} total`;
    rows.push(
      <Box key="total">
        <Text backgroundColor="black">
          <Text color="cyan" dimColor>{totalStr}</Text>
          {' '.repeat(Math.max(0, ROW_W - totalStr.length))}
        </Text>
      </Box>,
    );
  }

  // Pad to fill the panel's inner height (excluding top + bottom border).
  const innerHeight = Math.max(0, height - 2);
  const padCount = Math.max(0, innerHeight - rows.length);
  for (let i = 0; i < padCount; i++) {
    rows.push(
      <Box key={`pad-${i}`}>
        <Text backgroundColor="black">{' '.repeat(ROW_W)}</Text>
      </Box>,
    );
  }

  return (
    <Box
      flexDirection="column"
      width={PANEL_W}
      borderStyle="single"
      borderColor={focused ? 'cyan' : undefined}
    >
      {rows}
    </Box>
  );
}

export const AgentList = React.memo(AgentListImpl);
