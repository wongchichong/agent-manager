import React from 'react';
import { useStdout } from 'ink';

export function useTerminalWidth(): number {
  const { stdout } = useStdout();
  const [w, setW] = React.useState<number>(stdout.columns ?? 80);
  React.useEffect(() => {
    const onResize = () => setW(stdout.columns ?? 80);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return w;
}
