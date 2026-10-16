'use strict';
/**
 * The boot: the SDK handshake the script does with the editor, the order it does
 * it in, what it does when WME is slow or a method is missing, and that a failure
 * anywhere leaves the rest of the page alone.
 */
const { boot } = require('../lib/harness.cjs');

module.exports = async function startup(report) {
  report.suite('starting up with the editor');

  const env = await boot({ storage: 'none' });

  report.check('the script asks for the SDK in async mode, under its own id and name',
    env.window.__sdkCalls.connect.length === 1 &&
    env.window.__sdkCalls.connect[0].mode === 'async' &&
    env.window.__sdkCalls.connect[0].scriptId === 'wme-geoportal-pl' &&
    env.window.__sdkCalls.connect[0].scriptName === 'Geoportal Waze integration',
    JSON.stringify(env.window.__sdkCalls.connect[0]));

  const subscribed = env.window.__sdkCalls.events;
  report.check('the script subscribes to the SDK events a WME session sends',
    ['wme-ready', 'wme-map-zoom-changed', 'wme-map-layer-added', 'wme-map-layer-changed', 'wme-map-layer-removed']
      .every(event => subscribed.includes(event)),
    subscribed.join(', '));

  report.check('the script also hooks the map\'s own events, for a renamed SDK event',
    env.integration.wms.watching === true && env.integration.wms.olMap === env.map,
    `watching=${env.integration.wms.watching}`);
  const mapEvents = Object.keys(env.integration.wms.olMap.events.listeners)
    .filter(name => (env.integration.wms.olMap.events.listeners[name] || []).length > 0);
  report.check('the map events it hooks are the ones that renumber and re-zoom',
    ['movestart', 'moveend', 'addlayer', 'removelayer', 'changelayer'].every(name => mapEvents.includes(name)),
    mapEvents.join(', '));

  report.check('the script reports its version and the SDK baseline it was checked against',
    env.recorded.log.some(message => message.includes('Version 1.6.0')) &&
    env.recorded.log.some(message => message.includes('v2.374-5-g0024d1fa65')),
    env.recorded.log.find(message => message.includes('Version')) || 'no version line');

  // The zoom level WME reports is what decides which layers are in range.
  report.check('the zoom level the SDK reports is stored and drives the layers',
    env.integration.zoom === 18, `zoom=${env.integration.zoom}`);
  await env.setZoom(20);
  report.check('a zoom event updates the layers without a reload',
    env.integration.zoom === 20 && env.integration.wms.zoomLevel === 20,
    `zoom=${env.integration.zoom}`);
  await env.setZoom(18);

  // A slow editor: the script waits for the ready state instead of giving up, and
  // the layers are built only then.
  const slow = await boot({ enabled: [], ready: false, awaitInitialized: false });
  await slow.sleep(200);
  report.check('with WME not ready yet the script waits and builds nothing of its own',
    slow.integration.initialized === false && Object.keys(slow.registry).length === 0,
    `ready=${slow.sdk === undefined ? 'starting' : 'waiting'}, layers=${Object.keys(slow.registry).length}`);
  slow.window.__sdkState.ready = true;
  slow.fire('wme-ready', {});
  const came = await slow.waitFor(() => slow.integration.initialized === true, 3000);
  report.check('when WME reports ready the script carries on',
    came && Object.keys(slow.registry).length > 0,
    came ? `${Object.keys(slow.registry).length} layers built` : 'still not initialized');
  slow.close();

  // A WME whose SDK no longer has a method the script needs: it must say so and
  // stop, not half-work.
  const missing = await boot({ storage: 'none', awaitInitialized: false, sdkPatches: { 'Map.getZoomLevel': null } });
  const stopped = await missing.waitFor(() => missing.recorded.error.length > 0, 3000);
  report.check('a missing SDK method stops the script with a message that names it',
    stopped && missing.recorded.error.some(message => message.includes('Map.getZoomLevel')) &&
    missing.integration.initialized === false,
    missing.recorded.error.join(' | ') || 'no error reported');
  missing.close();

  // The layers menu of a page where WME never shows a layer card: the script must
  // still build the layers and their switches, not throw.
  const noCard = await boot({ storage: 'none', layerCard: false });
  report.check('a page without the layer card still boots and builds the layers',
    noCard.integration.initialized === true && noCard.names().length > 0 &&
    noCard.document.getElementById('geoportal-layers-group') === null,
    `${noCard.names().length} layers, no menu group`);
  report.check('and it does not throw over the missing card',
    noCard.recorded.error.length === 0 && noCard.recordsNothing === undefined &&
    noCard.integration.uiGroup === undefined,
    noCard.recorded.error.join(' | ') || 'no error, nothing built into the menu');
  noCard.close();

  report.check('the boot produced no uncaught error',
    env.recorded.uncaught.length === 0, env.recorded.uncaught.join(' | ') || 'none');
  report.check('the boot left no error in the console',
    env.recorded.error.length === 0, env.recorded.error.join(' | ') || 'none');
  env.close();
};
