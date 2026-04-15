import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { builtinModules } from 'module';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const external = [
  ...builtinModules.flatMap((m) => [m, `node:${m}`]),
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
];

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'src/index.tsx',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external,
      output: {
        banner: '#!/usr/bin/env node',
      },
    },
    target: 'node18',
    outDir: 'dist',
    minify: false,
    sourcemap: true,
  },
});
