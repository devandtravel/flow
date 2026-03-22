import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'packages/cli/index': 'packages/cli/index.ts',
    'apps/daemon/index': 'apps/daemon/index.ts',
    'apps/worker/index': 'apps/worker/index.ts',
  },
  external: ['node:sqlite'],
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  sourcemap: false,
  clean: true,
  dts: false,
  splitting: false,
});
