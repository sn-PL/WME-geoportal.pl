'use strict';
/**
 * The test entry point.
 *
 *   node run.cjs                 # every suite, each in its own page
 *   node run.cjs requests tiles  # only these suites
 *   TEST_VERBOSE=1 node run.cjs  # let the page's console through
 *   TILE_MANAGER=0 node run.cjs  # every page without OpenLayers' tile manager
 *
 * Exits non-zero if any check failed.
 */
const path = require('node:path');
const { Report } = require('./lib/report.cjs');

const SUITES = ['source', 'types', 'startup', 'layers', 'requests', 'tiles', 'recovery', 'menu', 'settings', 'coordinates'];

(async () => {
  const selected = process.argv.slice(2).filter(argument => !argument.startsWith('-'));
  const names = selected.length ? selected : SUITES;
  const unknown = names.filter(name => !SUITES.includes(name));
  if (unknown.length) {
    console.error(`Unknown suite(s): ${unknown.join(', ')}\nAvailable: ${SUITES.join(', ')}`);
    process.exit(2);
  }

  const report = new Report();
  console.log(
    `geoportal.user.js test run: ${names.length} suite(s), ` +
    `OpenLayers tile manager ${process.env.TILE_MANAGER === '0' ? 'off' : 'on'}`
  );

  for (const name of names) {
    const suite = require(path.join(__dirname, 'suites', `${name}.cjs`));
    try {
      await suite(report);
    } catch (error) {
      report.check(`${name} suite ran to the end`, false, String(error && error.stack || error));
    }
  }

  process.exit(report.summary() ? 0 : 1);
})();
