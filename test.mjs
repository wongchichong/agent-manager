/**
 * Smoke-test for core modules (no Ink/React needed).
 * Run: node test.mjs
 */
import { AgentManager } from './dist/index.js';

// ── We can't import internal modules from the bundled file,
//    so let's test the sub-modules via tsx directly.
//    This file just verifies the dist bundle loads cleanly.
console.log('✓ dist/index.js loaded (ESM import OK)');
