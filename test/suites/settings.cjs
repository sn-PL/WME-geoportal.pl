'use strict';
/**
 * What the script does with the settings an earlier version left behind in the
 * editor: which layers it brings back, which it refuses to be confused by, and
 * what it writes back.
 */
const { boot, SETTINGS_KEY } = require('../lib/harness.cjs');
const { LAYERS, LAYER_ORDER } = require('../lib/fixtures.cjs');

module.exports = async function settings(report) {
  report.suite('saved settings');

  // A fresh editor with nothing stored: the address layer is on, everything else off.
  const fresh = await boot({ storage: 'none' });
  const defaults = fresh.registry;
  report.check('a first visit starts with the address layer on and the rest off',
    defaults['Geoportal - adresy'].isEnabled === true &&
    LAYER_ORDER.filter(name => defaults[name].isEnabled).length === 1,
    LAYER_ORDER.filter(name => defaults[name].isEnabled).join(', '));
  report.check('the address layer is built straight away',
    Boolean(defaults['Geoportal - adresy'].instance), 'built at boot');
  fresh.close();

  // Settings written by this version come back as they were left.
  const returning = await boot({
    enabled: [],
    storage: JSON.stringify({
      enabledLayers: {
        'Geoportal - przejazdy kolejowe (wymagany duży zoom)': true,
        'BDOT - Numer drogi': true,
        'Geoportal - ortofoto': false
      },
      layerOpacity: { 'Geoportal - ortofoto': 0.5 },
      collapsedCats: { 'Adresy i Ulice': true }
    })
  });
  report.check('the layers the user had on come back on, and only those',
    returning.registry['Geoportal - przejazdy kolejowe (wymagany duży zoom)'].isEnabled === true &&
    returning.registry['BDOT - Numer drogi'].isEnabled === true &&
    returning.registry['Geoportal - ortofoto'].isEnabled === false &&
    LAYER_ORDER.filter(name => returning.registry[name].isEnabled).length === 2,
    LAYER_ORDER.filter(name => returning.registry[name].isEnabled).map(name => name.replace('Geoportal - ', '')).join(', '));
  report.check('a remembered opacity is applied to the layer',
    Math.abs(returning.registry['Geoportal - ortofoto'].opacity - 0.5) < 0.001,
    `ortofoto opacity ${returning.registry['Geoportal - ortofoto'].opacity}`);
  const collapsedHeader = [...returning.document.querySelectorAll('.geoportal-cat-header')]
    .find(element => element.textContent.trim() === 'Adresy i Ulice');
  report.check('a category remembered as collapsed comes back collapsed',
    collapsedHeader.classList.contains('collapsed') &&
    collapsedHeader.parentNode.querySelector('.geoportal-cat-body').classList.contains('collapsed'),
    'Adresy i Ulice collapsed');
  returning.close();

  // A settings file from a version with a different layer list: unknown names are
  // kept in the store but cannot break the boot, and a layer without a slider is
  // never dimmed by a value that old version saved for it.
  const strange = await boot({
    enabled: [],
    storage: JSON.stringify({
      enabledLayers: { 'Geoportal - a layer that no longer exists': true, 'BDOT - Numer drogi': true },
      layerOpacity: { 'Geoportal - drogi': 0.1, 'Geoportal - a layer that no longer exists': 0.3 },
      collapsedCats: { 'A category that no longer exists': true }
    })
  });
  report.check('an unknown layer name in the settings does not stop the script',
    strange.integration.initialized === true && strange.names().length === LAYER_ORDER.length,
    `${strange.names().length} layers built`);
  report.check('a saved opacity for a slider-less layer is ignored',
    strange.registry['Geoportal - drogi'].instance === null ||
    strange.registry['Geoportal - drogi'].opacity === 1,
    `drogi opacity ${strange.registry['Geoportal - drogi'].opacity}`);
  report.check('the settings of the layers that exist are still used',
    strange.registry['BDOT - Numer drogi'].isEnabled === true,
    'BDOT - Numer drogi on');
  strange.close();

  // Broken JSON: the script must still start.
  const broken = await boot({ enabled: [], storage: '{ not json at all' });
  report.check('unreadable settings do not stop the script',
    broken.integration.initialized === true &&
    broken.registry['Geoportal - adresy'].isEnabled === true,
    'booted with the default settings');
  broken.close();

  // What this version writes back: the state of every layer, in one object.
  const writing = await boot({ enabled: [] });
  writing.registry['Geoportal - gminy'].setVisibility(true);
  writing.registry['Geoportal - ortofoto'].setOpacity(0.75);
  writing.integration.saveSettings();
  const stored = JSON.parse(writing.window.localStorage.getItem(SETTINGS_KEY));
  report.check('saving writes the state of every layer, addressed by name',
    Object.keys(stored.enabledLayers).length === LAYER_ORDER.length &&
    stored.enabledLayers['Geoportal - gminy'] === true &&
    stored.enabledLayers['Geoportal - powiaty'] === false &&
    Math.abs(stored.layerOpacity['Geoportal - ortofoto'] - 0.75) < 0.001,
    `${Object.keys(stored.enabledLayers).length} names, ` +
    `${Object.values(stored.enabledLayers).filter(Boolean).length} enabled`);
  report.check('the settings key stays the one every version has used',
    SETTINGS_KEY === 'wme_geoportal_settings' &&
    Object.keys(stored).sort().join(',') === 'collapsedCats,enabledLayers,layerOpacity',
    Object.keys(stored).join(', '));
  report.check('nothing in the settings is layer-instance state',
    Object.values(stored).every(value => typeof value === 'object' && value !== null &&
      Object.values(value).every(entry => typeof entry !== 'object')),
    'only booleans and numbers');
  // The layer list of this version is what decides the menu: a layer the settings
  // mention but the script does not build stays out of the registry.
  report.check('every layer of the list has a settings entry, and no other has',
    LAYER_ORDER.every(name => Object.prototype.hasOwnProperty.call(writing.registry, name)) &&
    !Object.prototype.hasOwnProperty.call(writing.registry, 'Geoportal - a layer that no longer exists'),
    `${Object.keys(writing.registry).length} names`);
  report.check('each layer knows whether it has a slider',
    LAYER_ORDER.every(name => writing.registry[name].hasOpacity === LAYERS[name].hasOpacity),
    `${LAYER_ORDER.filter(name => writing.registry[name].hasOpacity).length} with a slider`);
  writing.close();
};
