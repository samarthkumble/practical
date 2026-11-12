// Bundles the renderer (src/app.js) into dist/app.bundle.js.
//
//   node scripts/build.mjs          real mode: uses the Presage SDK and your camera
//   node scripts/build.mjs --demo   demo mode: a replay SDK with synthetic data, no camera,
//                                    no API key, zero credits (for UI work only)
import { build } from 'esbuild';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = process.argv.includes('--demo');

function readKey() {
  if (process.env.PRESAGE_API_KEY) return process.env.PRESAGE_API_KEY.trim();
  const envFile = path.join(root, '.env');
  if (!existsSync(envFile)) return '';
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*PRESAGE_API_KEY\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^['"]|['"]$/g, '').trim();
  }
  return '';
}

const key = demo ? '' : readKey();
if (!demo && !key) {
  console.error('\n  No API key found. Copy .env.example to .env and paste your key after PRESAGE_API_KEY=\n' +
                '  (or run "npm run demo" to try the app with synthetic data and no camera).\n');
  process.exit(1);
}

mkdirSync(path.join(root, 'dist'), { recursive: true });
writeFileSync(path.join(root, 'dist', 'mode.json'), JSON.stringify({ demo }));

const mock = path.join(root, 'src', 'mock-sdk.js');
const alias = demo ? {
  '@smartspectra/node-sdk/renderer': mock,
  '@smartspectra/node-sdk/messages': mock,
} : {};

await build({
  entryPoints: [path.join(root, 'src', 'app.js')],
  bundle: true,
  outfile: path.join(root, 'dist', 'app.bundle.js'),
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  logLevel: 'warning',
  alias,
  define: {
    __PRESAGE_KEY__: JSON.stringify(key),
    __DEMO__: JSON.stringify(demo),
  },
});
console.log(demo ? 'Built in DEMO mode (synthetic data, no camera, no credits).'
                 : 'Built in LIVE mode (Presage SDK + camera).');
