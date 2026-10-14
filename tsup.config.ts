import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts', 'mcp/server': 'src/mcp/server.ts' },
    format: ['esm', 'cjs'],
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    sourcemap: true,
    clean: true,
    target: 'node22',
    splitting: false,
  },
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    sourcemap: true,
    target: 'node22',
    splitting: false,
  },
]);
