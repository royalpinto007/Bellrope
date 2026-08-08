/**
 * Build the four bundles the manifest and the worker reference.
 *
 * The picker is bundled separately and as an IIFE because it is injected into
 * arbitrary pages: nothing from the worker's scope should ever be serialised
 * into someone else's document.
 */
import { build } from 'esbuild';
import fs from 'node:fs';

fs.rmSync('dist', { recursive: true, force: true });
const common = { bundle: true, minify: true, target: 'chrome120', logLevel: 'warning' };

await Promise.all([
  build({
    ...common,
    entryPoints: ['background.ts'],
    outfile: 'dist/background.js',
    format: 'esm',
  }),
  build({ ...common, entryPoints: ['sidepanel.ts'], outfile: 'dist/sidepanel.js', format: 'esm' }),
  build({ ...common, entryPoints: ['offscreen.ts'], outfile: 'dist/offscreen.js', format: 'esm' }),
  build({ ...common, entryPoints: ['picker-entry.ts'], outfile: 'dist/picker.js', format: 'iife' }),
]);

for (const f of fs.readdirSync('dist')) {
  console.log(`dist/${f}  ${(fs.statSync(`dist/${f}`).size / 1024).toFixed(1)} KB`);
}
