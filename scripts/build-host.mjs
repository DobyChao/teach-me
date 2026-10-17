import { build } from 'esbuild';
await build({
  entryPoints: ['src/host/main.ts', 'src/host/preload.ts'],
  outdir: 'dist/host',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
});
