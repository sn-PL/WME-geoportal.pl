#!/usr/bin/env node
/**
 * Type-check the userscript against the WME SDK typings this repository pins
 * (`wme-sdk-typings.tgz` in the repository root, version v2.374-*), the way the
 * script itself names it in its baseline constant.
 *
 * jsdoc types are how the script documents which SDK methods it calls, so this
 * catches a WME update that renames or drops one *before* it is noticed in the
 * editor - the type check sees `sdk.Map.getZoomLevel` where the running script
 * can only see whatever the SDK happens to expose at runtime.
 *
 *   node tools/check-types.mjs            # 0 errors, exit 0
 *   node tools/check-types.mjs --json     # a one-line summary for other tools
 *   node tools/check-types.mjs --force    # re-extract the typings
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.resolve(HERE, '..');
const REPO = path.resolve(TEST_DIR, '..');
const CACHE = path.join(TEST_DIR, '.cache');
const TYPINGS_DIR = path.join(CACHE, 'wme-sdk-typings');
const TARBALL = path.join(REPO, 'wme-sdk-typings.tgz');
const CONFIG = path.join(CACHE, 'tsconfig-check.json');
const SCRIPT = path.join(REPO, 'geoportal.user.js');
const SHIMS = path.join(HERE, 'ts-shims.d.ts');
const TSC = path.join(TEST_DIR, 'node_modules', 'typescript', 'bin', 'tsc');

const json = process.argv.includes('--json');
const force = process.argv.includes('--force');

/**
 * Read one file out of a .tar.gz with the standard library only, so the check
 * works on a machine with nothing installed but the test's own devDependencies.
 */
function readFromTarGz(tarball, wanted) {
  const tar = zlib.gunzipSync(fs.readFileSync(tarball));
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
    offset += 512;
    if (name === wanted) return tar.subarray(offset, offset + size).toString('utf8');
    if (!name) continue;
    offset += Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wanted} is not in ${path.basename(tarball)}`);
}

function prepareTypings() {
  const target = path.join(TYPINGS_DIR, 'index.d.ts');
  fs.mkdirSync(TYPINGS_DIR, { recursive: true });
  const pkg = JSON.parse(readFromTarGz(TARBALL, 'package/package.json'));
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (existing && !force) return pkg;
  // The generated bundle ends with an `import type` from a WME-internal path that
  // exists only inside the editor. Dropping that one line is what makes the
  // typings loadable outside WME; nothing the script uses comes from it.
  const source = readFromTarGz(TARBALL, 'package/index.d.ts')
    .split('\n')
    .filter(line => !/^import type \{ WmeSDK \} from "Waze\//.test(line))
    .join('\n');
  fs.writeFileSync(target, source);
  fs.writeFileSync(path.join(TYPINGS_DIR, 'package.json'),
    JSON.stringify({ name: 'wme-sdk-typings', version: pkg.version, types: './index.d.ts' }, null, 2) + '\n');
  return pkg;
}

function config(files, out) {
  return {
    compilerOptions: {
      target: 'ES2021',
      module: 'ESNext',
      moduleResolution: 'node',
      lib: ['ES2021', 'DOM', 'DOM.Iterable'],
      allowJs: true,
      checkJs: true,
      noEmit: true,
      strict: false,
      noImplicitAny: false,
      skipLibCheck: true,
      types: [],
      // The script names its types as `import('wme-sdk-typings')`, which is also
      // how the editor resolves this package; inside the test it comes from .cache.
      paths: { 'wme-sdk-typings': [path.join(TYPINGS_DIR, 'index.d.ts')] },
      baseUrl: TEST_DIR
    },
    files,
    '//': out
  };
}

function runTsc(configPath) {
  try {
    return { output: execFileSync(process.execPath, [TSC, '-p', configPath], { encoding: 'utf8', stdio: 'pipe' }), code: 0 };
  } catch (error) {
    return { output: `${error.stdout || ''}${error.stderr || ''}`, code: error.status ?? 1 };
  }
}

if (!fs.existsSync(TSC)) {
  console.error(`[types] typescript is not installed - run "npm install" in ${path.relative(process.cwd(), TEST_DIR) || '.'} first`);
  process.exit(2);
}

const pkg = prepareTypings();
fs.writeFileSync(CONFIG, JSON.stringify(config([SCRIPT, SHIMS], 'type check of the userscript'), null, 2) + '\n');
const checked = runTsc(CONFIG);
const errors = (checked.output.match(/error TS\d+/g) || []).length;

if (json) {
  console.log(JSON.stringify({ typings: pkg.version, config: CONFIG, errors, output: checked.output.trim() }));
  process.exit(errors ? 1 : 0);
}

console.log(`[types] WME SDK typings ${pkg.version} (${path.relative(REPO, TYPINGS_DIR)}), checking ${path.relative(REPO, SCRIPT)}`);
if (checked.output.trim()) console.log(checked.output.trim());
console.log(errors ? `[types] ${errors} error(s)` : '[types] no errors');
process.exit(errors ? 1 : 0);
