'use strict';
/**
 * The script as a file and as a userscript: it compiles, its header is the one
 * userscript managers need, the version in it matches the constant inside and the
 * documents next to it, and it talks only to the addresses it is meant to.
 *
 * No browser page here - this suite reads the sources.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { REPO_ROOT } = require('../lib/harness.cjs');

const SCRIPT = path.join(REPO_ROOT, 'geoportal.user.js');
const README = path.join(REPO_ROOT, 'README.md');

/** Every host the script is allowed to talk to, plus the ones in the header. */
const ALLOWED_HOSTS = [
  'mapy.geoportal.gov.pl',
  'integracja.gugik.gov.pl',
  'integracja01.gugik.gov.pl',
  'update.greasyfork.org',
  'greasyfork.org',
  'www.google.com',
  'github.com'
];

module.exports = async function source(report) {
  report.suite('the script as a file and as a userscript');

  const code = fs.readFileSync(SCRIPT, 'utf8');
  const readme = fs.readFileSync(README, 'utf8');

  let compiles = true, compileError = '';
  try {
    new vm.Script(code, { filename: 'geoportal.user.js' });
  } catch (error) {
    compiles = false;
    compileError = String(error.message);
  }
  report.check('the script compiles as a script', compiles, compileError || 'no syntax errors');

  const version = code.match(/const SCRIPT_VERSION = "([^"]+)"/)?.[1];
  report.check('the version inside the script is the version in the header',
    Boolean(version) && code.includes(`// @version         ${version}`),
    `SCRIPT_VERSION=${version}`);
  report.check('the header is the one userscript managers need',
    /\/\/ @name\s+\S/.test(code) && /\/\/ @namespace\s+\S/.test(code) &&
    /\/\/ @run-at\s+document-end/.test(code) && /\/\/ @grant\s+none/.test(code) &&
    /\/\/ @license\s+MIT/.test(code) &&
    /\/\/ @downloadURL\s+https:\/\/update\.greasyfork\.org\/scripts\//.test(code) &&
    /\/\/ @updateURL\s+https:\/\/update\.greasyfork\.org\/scripts\//.test(code),
    'name/namespace/run-at/grant/license/download/update');
  const includes = [...code.matchAll(/\/\/ @include\s+(\S+)/g)].map(match => match[1]);
  report.check('the header covers the editor addresses WME uses',
    includes.length >= 4 && includes.every(pattern => pattern.includes('waze.com')) &&
    includes.some(pattern => pattern.includes('/editor')) &&
    includes.some(pattern => pattern.includes('/beta_editor')),
    includes.join(' '));

  report.check('the first changelog entry is the version being built',
    code.includes(`/* Changelog:`) && code.includes(` *  ${version} - `),
    `entry for ${version}`);
  report.check('the README states the same version',
    readme.includes(`Wersja ${version}`) && readme.includes(`Changelog [${version}]`),
    readme.match(/Wersja [\d.]+/)?.[0] || 'no version in the README');

  // The script is injected into the editor's page: it must not reach anywhere the
  // layers do not come from.
  const hosts = [...new Set([...code.matchAll(/https:\/\/([a-z0-9.\-]+)/gi)].map(match => match[1].toLowerCase()))];
  const unknown = hosts.filter(host => !ALLOWED_HOSTS.includes(host));
  report.check('the script only names the Geoportal, greasyfork and WME addresses',
    unknown.length === 0, unknown.length ? `unexpected: ${unknown.join(', ')}` : `${hosts.length} hosts, all known`);

  // The layers' services have to be the ones the layer list was checked against.
  report.check('the services are the ones the requests are tested against',
    code.includes('mapy.geoportal.gov.pl/wss/service/sdi/Przejazdy/get?REQUEST=GetMap&') &&
    code.includes('integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaBazDanychObiektowTopograficznych?') &&
    code.includes('kompozycja_BDOT10k_WMS/MapServer/WMSServer') &&
    code.includes('PZGIK/ORTO/WMTS/StandardResolution'),
    'Przejazdy, integracja gugik, kompozycja BDOT10k, orto WMTS');

  // Constants defined twice were a real bug in this file: one of the two silently
  // won. Anything top level has to be defined once.
  const constants = [...code.matchAll(/^  const ([A-Z_0-9]+) = /gm)].map(match => match[1]);
  const duplicated = constants.filter((name, index) => constants.indexOf(name) !== index);
  report.check('no top-level constant (or its value) is defined twice',
    duplicated.length === 0 && new Set(constants).size === constants.length,
    duplicated.length ? `duplicated: ${[...new Set(duplicated)].join(', ')}` : `${constants.length} constants, each once`);

  // The script must not depend on anything the editor does not have, and must not
  // bring its own copies of libraries along.
  report.check('the script carries no library of its own and no dynamic code',
    !/\beval\s*\(/.test(code.replace(/\bclassName\b/g, '')) &&
    !/document\.write/.test(code) &&
    !/\bXMLHttpRequest\b/.test(code) &&
    !/\brequire\s*\(/.test(code) &&
    code.length < 120000,
    `${(code.length / 1024).toFixed(1)} kB, no eval/fetch/XHR/require`);

  report.check('the settings key is the one the tests and the README assume',
    code.includes("this.settingsKey = 'wme_geoportal_settings'"),
    'wme_geoportal_settings');

  report.check('the script is a userscript wrapped in one function scope',
    /^\(function \(\) \{$/m.test(code) && code.trimEnd().endsWith('})();'),
    'IIFE from the first line to the last');
};
