#!/usr/bin/env node
/**
 * Fetches the OpenLayers 2.13.1 sources the tests run against and merges them
 * into one script, the way the release's own mergejs.py builds the single-file
 * distribution. The tarball is pinned by version and by SHA-256, so a test run
 * either gets exactly these sources or fails.
 *
 * The result is written to test/.cache/ (git-ignored). Run it directly, or let
 * the npm `prepare` hook do it after `npm install`.
 *
 *   node test/tools/prepare-openlayers.mjs [--force]
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.resolve(HERE, '..');
const CACHE = path.join(TEST_DIR, '.cache');

const TAG = 'release-2.13.1';
const TARBALL_URL = `https://codeload.github.com/openlayers/openlayers/tar.gz/refs/tags/${TAG}`;
const TARBALL_SHA256 = '6140a3f986c009fc5604b13a19cc47b2683fc5c8468c2fe30c6b766b80e527e5';
const OUTPUT = path.join(CACHE, 'OpenLayers-2.13.1.js');

const force = process.argv.includes('--force');

if (!force && fs.existsSync(OUTPUT)) {
  console.log(`[openlayers] ${path.relative(process.cwd(), OUTPUT)} is ready (${(fs.statSync(OUTPUT).size / 1024).toFixed(0)} kB)`);
  process.exit(0);
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

fs.mkdirSync(CACHE, { recursive: true });
const tarball = path.join(CACHE, `openlayers-${TAG}.tar.gz`);
const extractDir = path.join(CACHE, `openlayers-${TAG}`);

/**
 * Node's fetch uses its own CA store, which some environments (corporate
 * proxies, sandboxes) do not populate - curl and wget use the system one. Try
 * them in turn, and allow a pre-downloaded archive through the environment.
 */
async function download() {
  const local = process.env.GEOPORTAL_OL_TARBALL;
  if (local) {
    console.log(`[openlayers] copying ${local}`);
    fs.copyFileSync(local, tarball);
    return;
  }
  console.log(`[openlayers] downloading ${TARBALL_URL}`);
  try {
    const response = await fetch(TARBALL_URL, { redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    fs.writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
    return;
  } catch (error) {
    console.warn(`[openlayers] fetch failed (${error.message}), trying curl/wget`);
  }
  for (const [command, args] of [
    ['curl', ['-fsSL', '--retry', '2', '-o', tarball, TARBALL_URL]],
    ['wget', ['-q', '-O', tarball, TARBALL_URL]]
  ]) {
    try {
      execFileSync(command, args, { stdio: 'inherit' });
      return;
    } catch (error) {
      console.warn(`[openlayers] ${command} failed: ${error.message.split('\n')[0]}`);
    }
  }
  console.error(
    `[openlayers] could not download the OpenLayers ${TAG} sources.\n` +
    `            Download ${TARBALL_URL}\n` +
    '            yourself and set GEOPORTAL_OL_TARBALL to its path.'
  );
  process.exit(1);
}

if (!fs.existsSync(tarball)) await download();

const digest = sha256(fs.readFileSync(tarball));
if (digest !== TARBALL_SHA256) {
  console.error(`[openlayers] ${tarball} has sha256 ${digest}, expected ${TARBALL_SHA256}. Delete the file and retry.`);
  process.exit(1);
}

if (!fs.existsSync(path.join(extractDir, 'lib', 'OpenLayers.js'))) {
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  // Prefer the platform tar; fall back to a gzip+tar implementation on Windows.
  try {
    execFileSync('tar', ['xzf', tarball, '-C', extractDir, '--strip-components=1'], { stdio: 'inherit' });
  } catch (error) {
    console.error('[openlayers] could not run tar:', error.message);
    process.exit(1);
  }
}

// The development loader lists the sources in a dependency-safe order; the
// release's mergejs.py merges them in exactly that order (minus the language
// files and the loaders themselves, which the single-file build drops too).
const lib = path.join(extractDir, 'lib');
const loader = fs.readFileSync(path.join(lib, 'OpenLayers.js'), 'utf8');
const listStart = loader.indexOf('jsFiles = [');
const listEnd = loader.indexOf('];', listStart);
if (listStart < 0 || listEnd < 0) {
  console.error('[openlayers] the development loader no longer lists its sources; the merge recipe must be revisited.');
  process.exit(1);
}
const sources = [...loader.slice(listStart, listEnd).matchAll(/"([^"]+)"/g)].map(match => match[1]);
const missing = sources.filter(source => !fs.existsSync(path.join(lib, source)));
if (missing.length) {
  console.error(`[openlayers] sources listed by the loader but not in the tarball: ${missing.slice(0, 5).join(', ')}`);
  process.exit(1);
}

const parts = [fs.readFileSync(path.join(lib, 'OpenLayers/SingleFile.js'), 'utf8')];
for (const source of sources) {
  if (source.startsWith('OpenLayers/Lang/')) continue;
  parts.push(`\n/* ---- ${source} ---- */\n${fs.readFileSync(path.join(lib, source), 'utf8')}`);
}
// One marker the harness reads to tell which sources it is running against.
parts.push(`\n/* build: ${TAG}, ${sources.length} sources, sha256(archive)=${TARBALL_SHA256.slice(0, 12)} */\n`);

fs.writeFileSync(OUTPUT, parts.join('\n'));
fs.rmSync(tarball, { force: true });
console.log(`[openlayers] wrote ${path.relative(process.cwd(), OUTPUT)}: ${sources.length} sources, ${(fs.statSync(OUTPUT).size / 1024).toFixed(0)} kB`);

// Keep the licence next to the merged sources - they are redistributed inside
// the archive this repository publishes, not by this repository itself.
const license = path.join(extractDir, 'license.txt');
if (fs.existsSync(license)) fs.copyFileSync(license, path.join(CACHE, 'OpenLayers-LICENSE.txt'));
