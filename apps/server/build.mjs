import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// npm dependencies stay external (installed in production); workspace packages ship as
// TypeScript sources, so they are bundled in.
const external = Object.keys(pkg.dependencies ?? {})
  .filter((name) => !name.startsWith('@mcproute/'))
  .flatMap((name) => [name, `${name}/*`]);

rmSync(new URL('./dist', import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: { index: 'src/index.ts', migrate: 'src/db/migrate.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external,
  logLevel: 'info',
});
