import React from 'react';
import { Box, Text } from 'ink';
import { useTerminalWidth } from './useTerminalWidth.js';

interface Props {
  agentCount: number;
  pipeCount: number;
  supervisorId?: string | null;
  supervisorStep?: string;
  leaderArmed?: boolean;
  /** True when something interesting is happening (supervisor running, an
   *  agent is in 'thinking' state). Drives the spinner animation — when
   *  false, the spinner stays on a single static frame so we don't trigger
   *  Ink's render-cycle clear-and-rewrite at idle (which would visibly
   *  flicker the entire chrome region on tall terminals). */
  active?: boolean;
}

const COLORS = ['cyan', 'magenta', 'yellow', 'green', 'blue', 'red'];
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function HeaderImpl({ agentCount, pipeCount, supervisorId, supervisorStep, leaderArmed, active }: Props) {
  const [frame, setFrame] = React.useState(0);
  const [colorIdx, setColorIdx] = React.useState(0);
  const width = useTerminalWidth();

  // Animate only when there's actual activity. At idle, an interval that
  // setStates every 250ms forces Ink to re-render the entire app, which
  // (per the flicker-test harness) makes Ink emit clear sequences for the
  // bottom rows. Visible flicker on tall terminals.
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER.length);
      setColorIdx((c) => (c + 1) % COLORS.length);
    }, 250);
    return () => clearInterval(t);
  }, [active]);

  const agentsStr = `${agentCount} agent${agentCount !== 1 ? 's' : ''}`;
  const pipesStr = pipeCount > 0 ? ` | ${pipeCount} pipe${pipeCount !== 1 ? 's' : ''}` : '';
  const supStr = supervisorId
    ? ` | supervisor: ${supervisorId}${supervisorStep ? ` — ${supervisorStep}` : ''}`
    : '';

  // Plain strings used only to measure width for the gap calculation.
  const leftPlain = `${SPINNER[frame]} AgentMan | ${agentsStr}${pipesStr}${supStr}`;
  const rightPlain = leaderArmed
    ? ' Ctrl+B  i input · a agents · c cancel · 0-9 pick · b literal · ? help '
    : 'Ctrl+B leader  ·  Ctrl+C exit';

  // Inner width is total minus 2 border columns. Reserve 1 col leading and 1 col
  // trailing for visual breathing room — the rest is the gap between L & R.
  const innerWidth = Math.max(0, width - 2);
  const contentWidth = Math.max(0, innerWidth - 2);
  const gap = Math.max(1, contentWidth - leftPlain.length - rightPlain.length);

  return (
    <Box borderStyle="round" borderColor="cyan">
      <Text backgroundColor="black">
        {' '}
        <Text bold color={COLORS[colorIdx] as any}>{SPINNER[frame]}</Text>
        <Text bold color="cyan">{' AgentMan '}</Text>
        <Text color="cyan" dimColor>|</Text>
        <Text color="green">{` ${agentsStr}`}</Text>
        {pipeCount > 0 && (
          <>
            <Text color="cyan" dimColor>{' |'}</Text>
            <Text color="yellow">{` ${pipeCount} pipe${pipeCount !== 1 ? 's' : ''}`}</Text>
          </>
        )}
        {supervisorId && (
          <>
            <Text color="cyan" dimColor>{' |'}</Text>
            <Text color="magenta">{` supervisor: ${supervisorId}`}</Text>
            {supervisorStep && <Text color="magenta" dimColor>{` — ${supervisorStep}`}</Text>}
          </>
        )}
        {' '.repeat(gap)}
        {leaderArmed ? (
          <Text bold color="black" backgroundColor="yellow">{rightPlain}</Text>
        ) : (
          <Text color="cyan" dimColor>{rightPlain}</Text>
        )}
        {' '}
      </Text>
    </Box>
  );
}

export const Header = React.memo(HeaderImpl);
