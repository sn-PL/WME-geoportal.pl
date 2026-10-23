'use strict';
/**
 * The script against the WME SDK typings this repository pins: every SDK call the
 * script makes has to type-check against the SDK version it says it was checked
 * against. This is the check that sees a renamed or dropped SDK method before the
 * editor does.
 *
 * Runs `tools/check-types.mjs` (itself checkable: the last checks here break a
 * copy of the script on purpose and require the check to notice).
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT, TEST_DIR } = require('../lib/harness.cjs');

const TYPESCRIPT = path.join(TEST_DIR, 'node_modules', 'typescript', 'bin', 'tsc');
const CHECK = path.join(TEST_DIR, 'tools', 'check-types.mjs');

/** @returns {{code: number, output: string}} */
function runTsc(configPath) {
  try {
    return { code: 0, output: execFileSync(process.execPath, [TYPESCRIPT, '-p', configPath], { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

module.exports = async function types(report) {
  report.suite('the script against the WME SDK typings');

  if (!fs.existsSync(TYPESCRIPT)) {
    report.check('typescript is installed for the type check',
      false, `missing ${path.relative(REPO_ROOT, TYPESCRIPT)} - run "npm install" in test/`);
    return;
  }

  const summary = JSON.parse(execFileSync(process.execPath, [CHECK, '--json'], { encoding: 'utf8', stdio: 'pipe' }));
  report.check('the script type-checks against the pinned WME SDK typings',
    summary.errors === 0,
    summary.errors ? summary.output.split('\n').slice(0, 3).join(' | ') : `${summary.typings}, 0 errors`);

  // The typings the check uses must be the SDK version the script says it was
  // checked against - otherwise the check is measuring a different SDK.
  const script = fs.readFileSync(path.join(REPO_ROOT, 'geoportal.user.js'), 'utf8');
  const baseline = script.match(/const SDK_BASELINE = "([^"]+)"/)?.[1];
  report.check('the typings are the SDK version the script declares as its baseline',
    Boolean(baseline) && baseline === summary.typings,
    `script ${baseline} vs typings ${summary.typings}`);

  // The typings are the generated bundle, minus the one import that cannot exist
  // outside the editor. What matters is that they still declare the methods the
  // script says it cannot work without.
  const typings = fs.readFileSync(path.join(TEST_DIR, '.cache', 'wme-sdk-typings', 'index.d.ts'), 'utf8');
  const requiredBlock = script.match(/const REQUIRED_SDK_METHODS = \{([\s\S]*?)\n  \};/)?.[1] || '';
  const required = [...requiredBlock.matchAll(/(\w+): \['([^']+)'\]/g)]
    .map(match => `${match[1]}.${match[2]}`);
  const missing = required.filter(name => !typings.includes(name.split('.')[1]));
  report.check('every SDK method in the script\'s required list is declared in the typings',
    required.length >= 3 && missing.length === 0,
    required.length ? `${required.join(', ')}${missing.length ? ` - missing ${missing.join(', ')}` : ', all declared'}` : 'no required list found');
  report.check('the typings no longer carry the editor-internal import',
    !/from "Waze\//.test(typings) && !/from 'Waze\//.test(typings),
    'no Waze/* import in the extracted bundle');

  // Is the check able to fail? A copy of the script with one SDK method renamed
  // has to produce an error naming that method.
  const broken = path.join(TEST_DIR, '.cache', 'typecheck-should-fail.js');
  fs.writeFileSync(broken, script.replace(/this\.sdk\.Map\.getZoomLevel\(\)/g, 'this.sdk.Map.getZoomLevelz()'));
  const config = JSON.parse(fs.readFileSync(summary.config, 'utf8'));
  const brokenConfig = path.join(TEST_DIR, '.cache', 'tsconfig-should-fail.json');
  fs.writeFileSync(brokenConfig, JSON.stringify({
    ...config,
    files: [broken, path.join(TEST_DIR, 'tools', 'ts-shims.d.ts')],
    '//': 'a copy of the script with one SDK method misspelled, to prove the check can fail'
  }, null, 2));
  const brokenRun = runTsc(brokenConfig);
  report.check('the type check fails on a misspelled SDK method, and names it',
    brokenRun.code !== 0 && /getZoomLevelz/.test(brokenRun.output),
    brokenRun.output.split('\n').find(line => line.includes('error TS')) || 'no error at all');
  fs.rmSync(broken, { force: true });
  fs.rmSync(brokenConfig, { force: true });
};
