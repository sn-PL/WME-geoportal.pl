'use strict';
/**
 * A WME page in jsdom, running the real OpenLayers 2.13.1 and the script under
 * test, with the WME SDK and the Layers menu mocked.
 *
 * What the mocks stand for:
 *  - `window.getWmeSdk` + `window.SDK_INITIALIZED`: the async SDK the script asks
 *    for, with the events a WME session would deliver (`wme-ready`,
 *    `wme-map-zoom-changed`, `wme-map-layer-*`).
 *  - `window.W.map`: the OpenLayers map the editor exposes.
 *  - `wz-checkbox`: WME's checkbox component, registered as a custom element.
 *  - the layer switcher markup the script appends its group to.
 *
 * Images never load in jsdom, which is exactly what the tests need: every tile
 * is either delivered, refused, or left alone by hand (see deliver/refuse/giveUp),
 * so a run says what a browser would show for that combination.
 *
 * The OpenLayers sources are built from the release tarball by
 * tools/prepare-openlayers.mjs - run `npm install` (or `npm run prepare`) first.
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { REFERENCE_POINTS, LAYER_ORDER } = require('./fixtures.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT_FILE = path.join(REPO_ROOT, 'geoportal.user.js');
const OPENLAYERS_FILE = path.join(REPO_ROOT, 'test', '.cache', 'OpenLayers-2.13.1.js');
const TEST_DIR = path.join(REPO_ROOT, 'test');
const SETTINGS_KEY = 'wme_geoportal_settings';
const WORLD = { left: -20037508.342789244, bottom: -20037508.342789244 };
const PAGE = `<!doctype html><html><head><title>WME</title></head><body>
  <div class="layer-switcher" id="layer-switcher-region">
    <ul class="menu list-unstyled"><li class="group"><div class="separator">Warstwy</div></li></ul>
  </div>
  <div id="map"></div>
</body></html>`;

/** The WME checkbox component, mimicked: a `checked` property, a click toggle, a change event. */
const CHECKBOX_COMPONENT = `
class WzCheckbox extends window.HTMLElement {
  constructor() { super(); this.__checked = false; this.__built = false; }
  connectedCallback() {
    if (this.__built) return;
    this.__built = true;
    const label = this.textContent;
    this.textContent = '';
    const box = this.ownerDocument.createElement('span');
    box.className = 'wz-checkbox-box';
    const text = this.ownerDocument.createElement('span');
    text.className = 'wz-checkbox-label';
    text.textContent = label;
    this.appendChild(box);
    this.appendChild(text);
    this.addEventListener('click', () => {
      this.checked = !this.checked;
      this.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
  }
  get checked() { return this.__checked; }
  set checked(value) {
    this.__checked = !!value;
    this.setAttribute('aria-checked', String(this.__checked));
  }
}
window.customElements.define('wz-checkbox', WzCheckbox);
`;

/** The SDK mock. `state` is the raw holder tests can change between calls. */
const SDK_FACTORY = `
window.__sdkState = { zoom: ${'${zoom}'}, ready: ${'${ready}'}, rank: ${'${rank}'}, mode: 'async' };
window.__sdkCalls = { connect: [], events: [], ready: 0 };
window.getWmeSdk = (options) => {
  window.__sdkCalls.connect.push(options);
  // One instance for the page: the script and the test drive the same handlers.
  if (window.__sdk) return Promise.resolve(window.__sdk);
  const handlers = {};
  const sdk = {
    State: {
      isReady: () => window.__sdkState.mode === 'async'
        ? Promise.resolve(window.__sdkState.ready) : window.__sdkState.ready,
      getUserInfo: () => Promise.resolve({ rank: window.__sdkState.rank, userName: 'tester' })
    },
    Map: { getZoomLevel: () => Promise.resolve(window.__sdkState.zoom) },
    Events: {
      on: ({ eventName, eventHandler }) => {
        window.__sdkCalls.events.push(eventName);
        (handlers[eventName] = handlers[eventName] || []).push(eventHandler);
        return () => { handlers[eventName] = handlers[eventName].filter(h => h !== eventHandler); };
      }
    },
    getWMEVersion: () => Promise.resolve('2.999-mock'),
    getSDKVersion: () => Promise.resolve('2.374-mock'),
    __handlers: handlers,
    __fire: (eventName, payload) => (handlers[eventName] || []).forEach(h => h(payload))
  };
  const patches = ${'${patches}'};
  Object.entries(patches).forEach(([path, value]) => {
    const parts = path.split('.');
    const last = parts.pop();
    let target = sdk;
    for (const part of parts) target = target[part];
    if (value === null) delete target[last];
    else target[last] = value;
  });
  window.__sdk = sdk;
  return Promise.resolve(sdk);
};
window.SDK_INITIALIZED = Promise.resolve(true);
`;

let openLayersSource = null;
function readOpenLayers() {
  if (openLayersSource === null) {
    if (!fs.existsSync(OPENLAYERS_FILE)) {
      throw new Error(
        `The OpenLayers sources are missing: run "npm install" (or "npm run prepare") in test/.\n` +
        `Expected ${path.relative(process.cwd(), OPENLAYERS_FILE)}`
      );
    }
    openLayersSource = fs.readFileSync(OPENLAYERS_FILE, 'utf8');
  }
  return openLayersSource;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Boot a page with the script running on it.
 * @param {object} [options]
 * @param {{w: number, h: number}} [options.view] map size in pixels
 * @param {number} [options.zoom] WME zoom level at boot
 * @param {{lon: number, lat: number}} [options.center] WGS84 centre of the map
 * @param {number} [options.rank] the editor user's rank (the OSM layer needs 1)
 * @param {boolean} [options.wzCheckbox] register WME's checkbox component
 * @param {boolean} [options.tileManager] give the map OpenLayers' tile manager
 * @param {'default'|'all'|string[]} [options.enabled] which layers start enabled
 * @param {object} [options.settings] extra settings written to localStorage first
 * @param {string} [options.storage] raw string written to the settings key
 * @param {boolean} [options.ready] whether the SDK reports WME ready
 * @param {boolean} [options.awaitInitialized] wait for the script to finish booting
 * @param {boolean} [options.layerCard] render the editor's layer card (default true)
 * @param {Record<string, unknown>} [options.sdkPatches] SDK paths to replace or
 *        remove before the script sees the SDK, e.g. `{ 'Map.getZoomLevel': null }`
 * @returns {Promise<object>} the environment
 */
async function boot(options = {}) {
  const {
    view = { w: 800, h: 600 },
    zoom = 18,
    center = REFERENCE_POINTS.imbramowice,
    rank = 1,
    wzCheckbox = true,
    tileManager = true,
    enabled = 'all',
    settings = {},
    storage = null,
    ready = true,
    awaitInitialized = true,
    whenDefinedRejects = false,
    layerCard = true,
    sdkPatches = {}
  } = options;

  const dom = new JSDOM(layerCard ? PAGE : PAGE.replace(/<div class="layer-switcher"[\s\S]*?<\/div>\n/, ''), {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://www.waze.com/editor/'
  });
  const { window } = dom;
  const { document } = window;

  // Record what the script writes to the console, and keep the noise down.
  const recorded = { log: [], warn: [], error: [], uncaught: [] };
  ['log', 'warn', 'error'].forEach(level => {
    const original = window.console[level];
    window.console[level] = (...args) => {
      recorded[level].push(args.map(String).join(' '));
      if (process.env.TEST_VERBOSE) original.apply(window.console, args);
    };
  });
  window.addEventListener('error', event => {
    recorded.uncaught.push(String(event.error?.stack || event.message || event));
  });

  // jsdom has no canvas; OpenLayers only probes for it.
  window.HTMLCanvasElement.prototype.getContext = () => null;

  // jsdom does not implement innerText, which the menu labels are set with; a
  // browser maps it onto the element's text, so the harness does the same.
  if (!('innerText' in window.HTMLElement.prototype)) {
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
      get() { return this.textContent; },
      set(value) { this.textContent = String(value); },
      configurable: true
    });
  }

  window.eval(readOpenLayers());
  const OL = window.OpenLayers;
  if (!OL || !OL.Map) throw new Error('OpenLayers did not load');

  // The map div has no layout in jsdom, so give it the size under test.
  const mapDiv = document.getElementById('map');
  Object.defineProperty(mapDiv, 'clientWidth', { get: () => view.w });
  Object.defineProperty(mapDiv, 'clientHeight', { get: () => view.h });

  /** @type {any} */
  const mapOptions = { projection: 'EPSG:900913', controls: [], theme: null };
  // WME's map has OpenLayers' tile manager. The manager's own delays (a queue
  // drained two tiles per frame) only make a test slow, they do not change what
  // the script has to do - the tiles still go through the manager's queue - so
  // the harness drains it at once. TILE_MANAGER=0 gives a map without one.
  mapOptions.tileManager = tileManager
    ? { moveDelay: 0, zoomDelay: 0, frameDelay: 0, tilesPerFrame: 200 }
    : null;
  const map = new OL.Map('map', mapOptions);
  const baseLayer = new OL.Layer.XYZ('wme-base', 'https://base.invalid/${z}/${x}/${y}.png', {
    sphericalMercator: true,
    isBaseLayer: true,
    // The editor's map goes further in than the Geoportal's tile services do
    // (their last level is 19), which is what the tests about that use.
    numZoomLevels: 24,
    maxExtent: new OL.Bounds(WORLD.left, WORLD.bottom, -WORLD.left, -WORLD.bottom)
  });
  map.addLayer(baseLayer);
  const center900913 = new OL.LonLat(center.lon, center.lat).transform('EPSG:4326', 'EPSG:900913');
  map.setCenter(center900913, zoom);

  window.W = { map };

  // The user's stored settings, before the script reads them.
  const enabledNames = enabled === 'all' ? LAYER_ORDER
    : enabled === 'default' ? null : enabled;
  if (storage === 'none') {
    // A browser that has never seen the script: nothing stored at all.
  } else if (storage !== null) {
    window.localStorage.setItem(SETTINGS_KEY, storage);
  } else {
    const seed = {
      enabledLayers: enabledNames ? Object.fromEntries(enabledNames.map(name => [name, true])) : {},
      layerOpacity: {},
      collapsedCats: {},
      ...settings
    };
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(seed));
  }

  if (wzCheckbox) window.eval(CHECKBOX_COMPONENT);
  if (whenDefinedRejects) {
    // A page where the component never arrives: resolve the wait as "not found".
    window.customElements.whenDefined = () => Promise.reject(new Error('wz-checkbox never defined'));
  }

  window.eval(SDK_FACTORY
    .replace('${zoom}', String(zoom))
    .replace('${ready}', String(Boolean(ready)))
    .replace('${rank}', String(rank))
    .replace('${patches}', JSON.stringify(sdkPatches)));

  window.eval(fs.readFileSync(SCRIPT_FILE, 'utf8'));
  const integration = window.__geoportalPl;
  if (!integration) throw new Error('the script did not publish window.__geoportalPl');

  // The one SDK instance the page made (it appears while the script boots), and a
  // way to fire its events the way WME would.
  const fire = (eventName, payload) => window.__sdk.__fire(eventName, payload);

  const waitFor = async (predicate, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (predicate()) return true;
      await sleep(10);
    }
    return false;
  };
  const waitForAsync = async (predicate, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await predicate()) return true;
      await sleep(10);
    }
    return false;
  };

  const env = {
    dom, window, document, OL, map, integration, fire, waitFor, waitForAsync, sleep, view,
    get sdk() { return window.__sdk; },
    recorded,
    internals: integration.internals,
    /** The script's registry: name → { definition, hasOpacity, opacity, isEnabled, instance, … }. */
    registry: integration.layers,
    /** The name of every layer the script builds. */
    names: () => Object.keys(integration.layers),
    /** The OpenLayers layer instance of a registry entry, if it was built. */
    layer: name => integration.layers[name]?.instance || null,
    olLayers: () => map.layers.filter(layer => layer.name !== 'wme-base'),
    /** Re-draw the map in place, so that layers added since the last move draw their tiles. */
    async redraw() {
      map.setCenter(map.getCenter(), map.getZoom());
      await sleep(30);
    },
    /** Change the WME zoom: the SDK reports it and the map follows. */
    async setZoom(nextZoom, { animate = false } = {}) {
      window.__sdkState.zoom = nextZoom;
      if (map.getZoom() !== nextZoom) {
        map.setCenter(map.getCenter(), nextZoom, false, true);
      }
      fire('wme-map-zoom-changed', { zoom: nextZoom });
      await env.waitForAsync(() => integration.zoom === nextZoom);
      await sleep(20);
    },
    /** The tiles (or the single image) OpenLayers currently asks a layer for. */
    requestsOf(layer) {
      if (!layer) return [];
      return (layer.grid || []).flat()
        .map(tile => tile.imgDiv?.src)
        .filter(Boolean)
        .map(url => decodeURIComponent(String(url)));
    },
    /** The first distinct request of a layer. */
    requestOf(layer) {
      return env.requestsOf(layer)[0] || '';
    },
    /** A tile of a layer, by index into its grid. */
    tileAt(layer, row = 0, column = 0) {
      return layer?.grid?.[row]?.[column] || null;
    },
    /** The browser could not show the image: OpenLayers sees an error on the <img>. */
    refuse(tile) {
      const img = tile?.imgDiv;
      if (!img) throw new Error('refuse() needs a tile with an image');
      img.dispatchEvent(new window.Event('error'));
      return img;
    },
    /** Refuse until OpenLayers gives up (IMAGE_RELOAD_ATTEMPTS, plus the script's own attempts). */
    giveUp(tile) {
      env.refuse(tile);
      env.refuse(tile);
      return tile;
    },
    /** The browser shows the image. */
    deliver(tile) {
      const img = tile?.imgDiv;
      if (!img) throw new Error('deliver() needs a tile with an image');
      img.dispatchEvent(new window.Event('load'));
      return img;
    },
    isFailed: tile => Boolean(tile?.imgDiv?.classList?.contains('olImageLoadError')),
    /** Every tile of a layer that has an image. */
    tilesWithImage(layer) {
      return (layer?.grid || []).flat().filter(tile => tile.imgDiv && tile.imgDiv.src);
    },
    /** Wait until every tile of a layer has been asked for. */
    async waitForTiles(layer, ms = 3000) {
      return waitFor(() => env.requestsOf(layer).length > 0, ms);
    },
    /**
     * Make the map draw the whole view, and wait until every visible layer has
     * asked for its tiles. Tiles are drawn when the map moves, so a small pan and
     * back is what a boot needs to get the layers on screen.
     */
    async drawAll(ms = 5000) {
      const center = map.getCenter();
      map.setCenter(new OL.LonLat(center.lon + map.getResolution(), center.lat), map.getZoom());
      await sleep(0);
      map.setCenter(center, map.getZoom());
      const visible = () => env.olLayers().filter(layer => layer.getVisibility() && layer.grid);
      const drawn = await waitFor(() => visible().every(layer => env.requestsOf(layer).length > 0), ms);
      return { drawn, layers: visible().length };
    },
    close() {
      try { window.close(); } catch (error) { /* jsdom already gone */ }
    }
  };

  if (awaitInitialized) {
    const done = await waitFor(() => integration.initialized === true, 10000);
    if (!done) {
      throw new Error(
        `the script did not finish booting; console said:\n  ${recorded.error.concat(recorded.warn).join('\n  ')}`
      );
    }
  }
  return env;
}

/**
 * The settings object the script stores for a page, read back out of jsdom's
 * localStorage.
 */
function savedSettings(env) {
  const raw = env.window.localStorage.getItem(SETTINGS_KEY);
  return raw ? JSON.parse(raw) : null;
}

/** A URL with no cache-busting timestamp, and no OL parameter noise. */
function plain(url) {
  return decodeURIComponent(String(url)).replace(/&_=\d+/, '');
}

/** The query parameters of a URL, upper-cased names, as one object. */
function params(url) {
  const query = String(url).slice(String(url).indexOf('?') + 1);
  const out = {};
  for (const pair of query.split('&')) {
    const [name, value = ''] = pair.split('=');
    if (name) out[name.toUpperCase()] = decodeURIComponent(value);
  }
  return out;
}

/** The slippy-map indices of a WGS84 point, computed here and not by the script. */
function slippyTile(point, zoom) {
  const lat = point.lat * Math.PI / 180;
  const n = Math.pow(2, zoom);
  return {
    x: Math.floor((point.lon + 180) / 360 * n),
    y: Math.floor((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * n)
  };
}

module.exports = { boot, savedSettings, plain, params, slippyTile, sleep, SETTINGS_KEY, REPO_ROOT, TEST_DIR, SCRIPT_FILE };
