import React from 'react';
import { render } from 'ink';
import App from './app.js';

const { waitUntilExit } = render(<App />, {
  exitOnCtrlC: true,
});

waitUntilExit().then(() => {
  process.exit(0);
});
