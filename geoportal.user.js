// ==UserScript==
// @name            Geoportal Waze integration (fork by snPL)
// @version         1.5.5
// @description     Dodaje warstwy geoportal.gov.pl ("podkład satelitarny", numery domów, nazwy miejscowości) do WME (integracja z WME SDK)
// @include         https://*.waze.com/*/editor*
// @include         https://*.waze.com/editor*
// @include         https://*.waze.com/map-editor*
// @include         https://*.waze.com/beta_editor*
// @copyright       2013-2026+, Patryk Ściborek, Paweł Pyrczak, Kamil Marud, snPL, sledzik1984
// @run-at          document-end
// @grant           none
// @license         MIT
// @icon            https://www.google.com/s2/favicons?sz=64&domain=geoportal.gov.pl
// @namespace       https://github.com/med-zz-eis/WME-geoportal.pl
// @downloadURL     https://update.greasyfork.org/scripts/572377/Geoportal%20Waze%20integration%20%28fork%20by%20snPL%29.user.js
// @updateURL       https://update.greasyfork.org/scripts/572377/Geoportal%20Waze%20integration%20%28fork%20by%20snPL%29.meta.js
// ==/UserScript==

/**
 * Credits:
 * This script is based on "geoportal.gov.pl layers for WME without translating PROXY" by Paweł Pyrczak
 * and Strah's (https://github.com/strah/WME-geoportal.pl) and Kamil Marud (https://github.com/kmarud/WME-geoportal.pl) adjustments.
 */

/* Changelog:
 *  1.5.5 - WME SDK v2.374: async SDK mode; version-tolerant startup, events, zoom filtering and controls; photo layers request JPEG without the needless transparency flag, as one image per view instead of a tile grid (the ortho WMS answers whole tile batches with 404); a refused image is requested three times - once immediately, then twice at a growing distance - and a view image that OpenLayers gave up on is requested again instead of leaving the map empty.
 *  1.5.4 - Use SDK readiness, state and events; guard WMS and preserve the Layers menu.
 *  1.5.2 - New layer names address, streets WMS endpoint
 *  1.5.1 - Allow selective opacity sliders (checkbox-only for boundaries/addresses).
 *  1.5.0 - Release (WME March 2026 API Update):
 *          - Complete refactor into ES6 Classes.
 *          - Full support for WME's new modular "Draggable Cards" UI.
 *          - Added MutationObserver for stable UI persistence.
 *          - Added opacity sliders with auto-enable/disable logic.
 *          - Implemented lazy loading and zoom-level filtering for performance.
 *          - Full compatibility with WME Dark Theme.
 *  1.4.3 - Fix issue with checkboxes logic.
 *  1.4.2 - Fix map update and layer switching issues.
 *  1.4.1 - Fix orto resolution issues.
 *  1.4.0 - Add BDOT10k layers.
 *  1.3.1 - Update WMS service URLs.
 *  1.2.0 - Add administrative boundaries layers.
 *  1.1.0 - Add parcels and addresses layers.
 */

(function () {
  'use strict';

  const SCRIPT_VERSION = "1.5.7";
  // WME SDK typings this version was checked against (wme-sdk-typings.tgz).
  const SDK_BASELINE = "v2.374-5-g0024d1fa65";
  const WAIT_TIMEOUT = 120000;
  const CHECKBOX_TIMEOUT = 30000;
  // Enabled overlays are stacked upwards from this z-index, in definition order.
  const Z_INDEX_BASE = 2040;
  // The Geoportal serves the standard ortho in the editor's own tile grid: Web
  // Mercator EPSG:3857, 256 px tiles, levels 0-19, the same z/x/y tiles the map
  // is drawn from. Above level 19 there are no tiles, so OpenLayers keeps asking
  // for level 19 and stretches it - which is the detail the data has anyway.
  const ORTO_TILE_MAX_ZOOM = 19;
  // Resolution of a 256 px Web Mercator tile at level 0 (the whole world).
  const MERCATOR_WORLD_RESOLUTION = 156543.03392804097;
  // The high-res ortho has no tile service of its own to draw from (its only
  // matrix sets are EPSG:2180 and EPSG:4326, 512 px, level 16 at most), so its
  // tiles are cut on the client and every one of them is a WMS render. A tile of
  // 512 px keeps that number down to a quarter of what 256 px tiles cost, while
  // staying a multiple of the editor's own 256 px cells, and a refused one is
  // still a hole of 512 px rather than the whole view.
  const HIGH_RES_TILE_SIZE = 512;
  // The script cannot work without these SDK methods; everything else is optional.
  const REQUIRED_SDK_METHODS = {
    State: ['isReady'],
    Map: ['getZoomLevel'],
    Events: ['on']
  };
  // A refused image is not requested again by OpenLayers: it counts as loaded and
  // the layer stays empty until the next big pan or zoom. The first re-request is
  // OpenLayers' own (IMAGE_RELOAD_ATTEMPTS, set where the layers are built); these
  // are the delays (ms) of the ones after it - past the burst that the front-end
  // refuses, and with a fresh timestamp so the answer cannot come from a cache.
  const IMAGE_RETRY_DELAYS = [1000, 3000];

  /** @typedef {import('wme-sdk-typings').AsyncWmeSDK} AsyncWmeSDK */
  /** @typedef {Parameters<import('wme-sdk-typings').WmeSDK['Events']['on']>[0]['eventName']} SdkEventName */

  /**
   * Resolve with the first truthy value of getValue(), polling until the timeout.
   * A returned promise (e.g. SDK_INITIALIZED) is awaited within the same timeout.
   */
  async function waitFor(getValue, description, timeout = WAIT_TIMEOUT) {
    let timer, retry;
    try {
      return await Promise.race([
        new Promise((resolve, reject) => {
          const poll = () => {
            try {
              const value = getValue();
              if (value) resolve(value);
              else retry = setTimeout(poll, 500);
            } catch (error) { reject(error); }
          };
          poll();
        }),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error(
            `Timed out waiting for ${description}. Reload WME or update the script.`
          )), timeout);
        })
      ]);
    } finally {
      clearTimeout(timer);
      clearTimeout(retry);
    }
  }

  /**
   * Public WME SDK access. The SDK is requested in the recommended async mode
   * (the default sync mode is deprecated and scheduled for removal). Every call
   * is awaited, so the same code also works if WME returns plain values.
   */
  class SdkAdapter {
    /**
     * @param {{ scriptId: string, scriptName: string }} script
     * @returns {Promise<SdkAdapter>}
     */
    static async connect(script) {
      const getSdk = () => {
        const sdk = window.getWmeSdk;
        // SDK_INITIALIZED may appear only after the script runs, and getWmeSdk
        // after it; inside a try, so that a throwing global counts as "not yet".
        try {
          return window.SDK_INITIALIZED && typeof sdk === 'function' ? sdk : false;
        } catch (error) {
          return false;
        }
      };
      const getWmeSdk = await waitFor(getSdk, 'the WME SDK');
      // `mode` is documented since v2.371; the global typings still declare only the sync SDK.
      /** @type {AsyncWmeSDK} */
      const sdk = await /** @type {any} */ (getWmeSdk)({ ...script, mode: 'async' });
      const missing = Object.entries(REQUIRED_SDK_METHODS).flatMap(([module, methods]) => methods
        .filter(method => typeof sdk?.[module]?.[method] !== 'function')
        .map(method => `${module}.${method}`));
      if (missing.length) {
        throw new Error(`Required WME SDK methods missing: ${missing.join(', ')}. Update the script.`);
      }
      return new SdkAdapter(sdk);
    }

    /** @param {AsyncWmeSDK} sdk */
    constructor(sdk) {
      this.sdk = sdk;
    }

    /** Versions and SDK mode, for diagnosing problems after a WME update. */
    async describe() {
      const read = async method => {
        try {
          const value = typeof this.sdk[method] === 'function' ? await this.sdk[method]() : null;
          // WME answered 0 for getSDKVersion, so report only a real version.
          return typeof value === 'string' && value ? value : '?';
        } catch (error) {
          return '?';
        }
      };
      let mode = '?';
      try {
        const probe = this.sdk.State.isReady();
        mode = typeof probe?.then === 'function' ? 'async' : 'sync';
        await probe;
      } catch (error) { /* reported later by waitForReady() */ }
      return `WME ${await read('getWMEVersion')}, SDK ${await read('getSDKVersion')}, ${mode} mode`;
    }

    /**
     * Subscribe to an SDK event. A renamed or removed event must not stop the
     * script, so a failure is reported and null is returned. Handler errors stay
     * here and never reach the event bus shared with other scripts.
     * @param {SdkEventName} eventName
     * @param {() => unknown} handler
     * @returns {(() => void) | null} unsubscribe function
     */
    on(eventName, handler) {
      const eventHandler = () => {
        try {
          handler();
        } catch (error) {
          console.error(`[Geoportal] Could not handle "${eventName}":`, error);
        }
      };
      try {
        const off = this.sdk.Events.on({ eventName, eventHandler });
        return () => {
          try {
            if (typeof off === 'function') off();
          } catch (error) { /* already unsubscribed */ }
        };
      } catch (error) {
        console.warn(`[Geoportal] WME SDK event "${eventName}" is not available:`, error);
        return null;
      }
    }

    /**
     * Resolve once WME is initialized, the user is logged in and the initial map
     * data is loaded. No hard timeout: logging in can take any amount of time.
     */
    async waitForReady() {
      let finish, retry, done = false, reported = false;
      const ready = new Promise(resolve => { finish = resolve; });
      // Subscribe before the first check, so the one-time event cannot be missed.
      // The state check also covers an event that is no longer dispatched.
      const off = this.on('wme-ready', () => finish());
      const check = async () => {
        try {
          if (await this.sdk.State.isReady()) return finish();
        } catch (error) {
          if (!reported) console.warn('[Geoportal] Could not read WME readiness:', error);
          reported = true;
        }
        if (!done) retry = setTimeout(check, 1000);
      };
      const slow = setTimeout(() => console.warn(
        '[Geoportal] Still waiting for WME to become ready (login and map data).'), WAIT_TIMEOUT);
      check();
      try {
        await ready;
      } finally {
        done = true;
        clearTimeout(retry);
        clearTimeout(slow);
        off?.();
      }
    }

    /** Optional: only the OSM layer needs the user data, and only for its rank. */
    async getUserInfo() {
      try {
        return await this.sdk.State.getUserInfo();
      } catch (error) {
        return null;
      }
    }

    async getZoomLevel() {
      const zoom = await this.sdk.Map.getZoomLevel();
      if (!Number.isFinite(zoom)) throw new Error(`Unexpected zoom level from the WME SDK: ${zoom}`);
      return zoom;
    }
  }

  // The SDK builds only XYZ tile URLs (${z}/${x}/${y}), while WMS GetMap needs a
  // bounding box per tile. Keep private WME/OpenLayers rendering access here only.
  class WmsAdapter {
    static connect() {
      try {
        const OL = window.OpenLayers;
        const mapWrapper = window.W?.map;
        const map = typeof mapWrapper?.addLayer === 'function'
          ? mapWrapper : (typeof mapWrapper?.getOLMap === 'function' ? mapWrapper.getOLMap() : null);
        const methods = ['setVisibility', 'setOpacity', 'setZIndex', 'adjustBounds',
          'getImageSize', 'getFullRequestString'];
        if (typeof OL?.Projection !== 'function' || typeof OL?.Layer?.WMS !== 'function' ||
            typeof OL?.Layer?.Grid?.prototype?.getFullRequestString !== 'function' ||
            !methods.every(method => typeof OL.Layer.WMS.prototype[method] === 'function') ||
            typeof map?.addLayer !== 'function') return null;
        // The ortho front-end refuses part of the valid GetMap requests in bursts
        // with an empty 404 page. One immediate re-request is what such a
        // short-lived refusal needs; the refused images that remain are picked up
        // by IMAGE_RETRY_DELAYS. The limit is a global OpenLayers setting and is
        // zero by default.
        OL.IMAGE_RELOAD_ATTEMPTS = 1;
        return new WmsAdapter(OL, map);
      } catch (error) {
        return null;
      }
    }

    constructor(OL, map) {
      this.OL = OL;
      this.map = map;
      this.olMap = null; // OpenLayers map holding our layers, known after the first one is added.
      this.mapHandlers = null; // callbacks to run on the map's own events
      this.watching = false; // the map's events are hooked
      this.recoveries = []; // image-recovery resets, one per WMS layer
      this.zoomLevel = null;
      this.zoomResolution = null;
      this.sourceProjection = new OL.Projection("EPSG:900913");
      this.targetProjection = new OL.Projection("EPSG:4326");
    }

    /** Store the SDK zoom level together with the map resolution it belongs to. */
    setZoomLevel(level) {
      this.zoomLevel = level;
      this.zoomResolution = this.getMapResolution();
    }

    getMapResolution() {
      try {
        const resolution = this.olMap?.getResolution?.();
        return Number.isFinite(resolution) && resolution > 0 ? resolution : null;
      } catch (error) {
        return null;
      }
    }

    /**
     * Zoom level of a tile request. In async mode the zoom level is known only
     * after wme-map-zoom-changed, but OpenLayers requests tiles before that event.
     * Derive the change from the request resolution (one zoom level = factor 2).
     */
    zoomAt(resolution) {
      if (!this.zoomResolution || !(resolution > 0)) return this.zoomLevel;
      return this.zoomLevel + Math.round(Math.log2(this.zoomResolution / resolution));
    }

    createLayer(definition, opacity) {
      if (definition.kind === "wmts") return this.createTileLayer(definition, opacity);
      const { name, url, layers, format, options } = definition;
      const adapter = this;
      const minZoom = options.minZ ?? 0;
      const singleTile = options.singleTile ?? true;
      const tileSize = options.tileSize ?? 0;
      // State of this layer's image recovery, shared with retryMissingImage.
      const recovery = { tried: 0, timer: null, stamp: null, holding: false };
      // The photo layers are opaque mosaics: transparency is a contradiction there
      // and OpenLayers answered it by switching their JPEG to PNG. Only the PNG
      // overlays ask for it, so the requests stay as they were before 1.5.0.
      /** @type {Record<string, string>} */
      const params = { layers, format, version: "1.3.0" };
      if (format !== "image/jpeg") params.transparent = "true";
      const layer = new this.OL.Layer.WMS(name, url, params,
        {
          isBaseLayer: false, visibility: false,
          singleTile,
          // Bigger tiles of the same grid: OpenLayers steps its grid by this size
          // and asks for one image of that many pixels per step, so a 512 px tile
          // covers four of the map's own cells with one request.
          ...(tileSize ? { tileSize: new this.OL.Size(tileSize, tileSize) } : {}),
          transitionEffect: "resize",
          noMagic: true, // never let OpenLayers rewrite the format
          getURL: function (bounds) {
            bounds = this.adjustBounds(bounds.clone());
            const imageSize = this.getImageSize(bounds);
            if (adapter.zoomAt((bounds.right - bounds.left) / imageSize.w) < minZoom) return null;
            bounds.transform(adapter.sourceProjection, adapter.targetProjection);
            // WMS 1.3.0 / EPSG:4326 uses latitude, longitude axis order. As long as
            // the view image is missing, every request asks under a fresh address,
            // so no cache can answer it with the refused response.
            const request = { BBOX: bounds.toArray(true), WIDTH: imageSize.w, HEIGHT: imageSize.h };
            if (recovery.stamp) request._ = recovery.stamp;
            return this.getFullRequestString(request);
          },
          getFullRequestString: function () {
            this.params.CRS = "EPSG:4326";
            return adapter.OL.Layer.Grid.prototype.getFullRequestString.apply(this, arguments);
          },
          // OpenLayers drops its back buffer - the image the layer is showing -
          // as soon as the replacement counts as loaded, and a refused image
          // counts as loaded too. In single-tile mode that image is the whole
          // view, so a refused refresh used to wipe the photo layer off the map
          // until a retry arrived. Keep the delivered view, and let go of it
          // only when a replacement really is delivered.
          removeBackBuffer: function () {
            if (singleTile && recovery.holding) return;
            return adapter.OL.Layer.Grid.prototype.removeBackBuffer.apply(this, arguments);
          }
        });
      layer.setOpacity(opacity);
      this.map.addLayer(layer);
      this.retryMissingImage(layer, recovery);
      if (!this.olMap && layer.map) {
        this.olMap = layer.map;
        if (this.zoomResolution === null) this.zoomResolution = this.getMapResolution();
        this.attachMapEvents();
      }
      return layer;
    }

    /**
     * The standard ortho as the editor's own tiles. The Geoportal publishes it as
     * Web Mercator tiles (EPSG:3857, 256 px, levels 0-19) whose indices are the
     * ordinary z/x/y of the grid the editor's map is drawn from, so OpenLayers
     * asks the service for exactly the tile that belongs in each cell of that
     * grid. A refused tile is one hole with the editor's base map behind it,
     * instead of a whole-view image whose refusal used to leave the view empty.
     * Level 19 is the last one the service has: above it OpenLayers keeps asking
     * for level 19 and stretches that tile, which carries the detail the data has.
     * @param {{ name: string, url: string, options: any }} definition
     * @param {number} opacity
     */
    createTileLayer({ name, url, options }, opacity) {
      const adapter = this;
      const minZoom = options.minZ ?? 0;
      const maxZoom = Math.min(options.maxZ ?? ORTO_TILE_MAX_ZOOM, ORTO_TILE_MAX_ZOOM);
      // State of this layer's image recovery, shared with retryMissingImage.
      const recovery = { tried: 0, timer: null, stamp: null, holding: false };
      // The service's levels as resolutions of the standard grid, i.e. the same
      // values as the editor's zoom levels, so its tiles line up with the tiles
      // the map is drawn from and a hole is exactly one tile of that map.
      const resolutions = [];
      for (let zoom = 0; zoom <= maxZoom; zoom++) {
        resolutions.push(MERCATOR_WORLD_RESOLUTION / Math.pow(2, zoom));
      }
      const world = new this.OL.Bounds(-20037508.342789244, -20037508.342789244,
        20037508.342789244, 20037508.342789244);
      const layer = new this.OL.Layer.XYZ(name, url, {
        isBaseLayer: false, visibility: false,
        sphericalMercator: true,
        tileSize: new this.OL.Size(256, 256),
        maxExtent: world,
        tileOriginCorner: "tl",
        resolutions,
        serverResolutions: resolutions,
        // Above the last level the layer still draws the stretched level-19
        // tiles, so OpenLayers must not hide it as out of range there.
        alwaysInRange: true,
        transitionEffect: "resize",
        getURL: function (bounds) {
          const level = Math.round(Math.log2(MERCATOR_WORLD_RESOLUTION / this.getServerResolution()));
          if (level < minZoom || level > maxZoom) return null;
          const tileUrl = adapter.OL.Layer.XYZ.prototype.getURL.call(this, bounds);
          // As long as this layer misses an image, ask under a fresh address, so
          // that no cache can answer with the refused response.
          return recovery.stamp && tileUrl ? tileUrl + "&_=" + recovery.stamp : tileUrl;
        }
      });
      layer.setOpacity(opacity);
      this.map.addLayer(layer);
      this.retryMissingImage(layer, recovery);
      if (!this.olMap && layer.map) {
        this.olMap = layer.map;
        if (this.zoomResolution === null) this.zoomResolution = this.getMapResolution();
        this.attachMapEvents();
      }
      return layer;
    }

    /**
     * OpenLayers counts a refused image as loaded and never asks for it again, so
     * a refused tile stays a hole and a refused view image stays an empty layer.
     * The view image is kept on screen through the refusal (removeBackBuffer in
     * createLayer) and whatever is missing is asked for again at the delays in
     * IMAGE_RETRY_DELAYS - through mergeNewParams, because OpenLayers' tile
     * manager keeps a refused draw in a queue that the layer's params event
     * flushes, while a plain redraw would leave it there. A new map view and a
     * delivered image start the attempts over.
     * @param {any} layer layer built by createLayer
     * @param {{tried: number, timer: any, stamp: number|null, holding: boolean}} recovery its state
     */
    retryMissingImage(layer, recovery) {
      const restart = () => {
        recovery.tried = 0;
        recovery.stamp = null;
        clearTimeout(recovery.timer);
        recovery.timer = null;
      };
      const recover = () => {
        recovery.timer = null;
        if (!layer.visibility) return;
        layer.mergeNewParams({});
      };
      this.recoveries.push(restart);
      layer.events.on({
        // A delivered image ends the recovery. OpenLayers reports a refused image
        // as loaded as well, and marks that one; only the others count. It is also
        // what ends the hold on the image the layer is showing. A layer of tiles
        // starts over only once no tile of the current grid is missing: a tile
        // that is still refused has to keep its pending retry, or a neighbour
        // arriving a moment later would cancel the only request that can fill it.
        tileloaded: event => {
          if (event?.tile?.imgDiv?.classList?.contains('olImageLoadError')) return;
          const missing = layer.grid?.some(row => row.some(tile =>
            tile.imgDiv?.classList?.contains('olImageLoadError')));
          if (!missing) {
            recovery.holding = false;
            restart();
          }
        },
        tileerror: () => {
          // The refused refresh must not take the delivered view with it; that is
          // what removeBackBuffer in createLayer holds back until a replacement is
          // delivered.
          recovery.holding = true;
          recovery.stamp = Date.now();
          if (recovery.timer || recovery.tried >= IMAGE_RETRY_DELAYS.length) return;
          recovery.timer = setTimeout(recover, IMAGE_RETRY_DELAYS[recovery.tried++]);
        },
        // A hidden layer cannot show the image kept for it, and after a zoom that
        // image sits outside the layer's own div, where hiding the layer would
        // leave the old picture on the map.
        visibilitychanged: () => {
          if (layer.visibility || !layer.backBuffer) return;
          if (layer.backBuffer.parentNode === layer.div) return;
          recovery.holding = false;
          this.OL.Layer.Grid.prototype.removeBackBuffer.call(layer);
        }
      });
    }

    /**
     * Watch the map itself. Remembered until the map is known, i.e. until the
     * first WMS layer is attached to it.
     * @param {{ onZoom: () => void, onLayers: () => void }} handlers
     */
    watchMap(handlers) {
      this.mapHandlers = handlers;
      this.attachMapEvents();
    }

    /**
     * The SDK events are the documented channel; these are the events of the map
     * that actually renumbers z-indexes and changes the zoom. They keep the
     * script working when WME renames or drops an SDK event, and moveend is
     * dispatched after the animation, when zoom and resolution already match.
     */
    attachMapEvents() {
      if (this.watching) return;
      const events = this.olMap?.events;
      const { onZoom, onLayers } = this.mapHandlers ?? {};
      if (typeof events?.on !== 'function' ||
          typeof onZoom !== 'function' || typeof onLayers !== 'function') return;
      events.on({
        // A new view gets a fresh set of image-recovery attempts. movestart,
        // not moveend: the requests of that view are built before the move ends.
        movestart: () => this.recoveries.forEach(reset => reset()),
        moveend: onZoom,
        addlayer: onLayers,
        removelayer: onLayers,
        // Only a reorder renumbers z-indexes; our own opacity/visibility changes
        // also report through this event and must not re-enter the z-index loop.
        changelayer: event => { if (event?.property === 'order') onLayers(); }
      });
      this.watching = true;
    }
  }

  // The SDK LayerSwitcher only offers flat checkboxes, not our categories/sliders.
  // Isolate private markup here so a WME UI change needs only one compatibility fix.
  class LayerMenuAdapter {
    static findList() {
      for (const selector of ['#layer-switcher-region', '.layer-switcher', '#sidepanel-layers']) {
        const root = document.querySelector(selector);
        const list = root?.querySelector('.menu .list-unstyled') || root?.querySelector('.list-unstyled');
        if (list) return list;
      }
      return null;
    }

    static hasWmeCheckbox() {
      return Boolean(window.customElements?.get('wz-checkbox'));
    }

    /** Resolve true once wz-checkbox is registered, or false after the timeout. */
    static whenWmeCheckbox(timeout) {
      if (LayerMenuAdapter.hasWmeCheckbox()) return Promise.resolve(true);
      if (typeof window.customElements?.whenDefined !== 'function') return Promise.resolve(false);
      return new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), timeout);
        window.customElements.whenDefined('wz-checkbox').then(() => {
          clearTimeout(timer);
          resolve(true);
        }, () => resolve(false));
      });
    }

    /**
     * @param {string} name
     * @param {boolean} checked
     * @param {(checked: boolean) => void} onChange
     * @returns {{ element: HTMLElement, setChecked: (checked: boolean) => void }}
     */
    static createCheckbox(name, checked, onChange) {
      if (LayerMenuAdapter.hasWmeCheckbox()) {
        /** @type {HTMLElement & { checked?: unknown }} */
        const checkbox = document.createElement('wz-checkbox');
        checkbox.appendChild(document.createTextNode(name));
        checkbox.checked = checked;
        const changed = () => {
          // Read the host after its own click handler, not a retargeted inner input.
          // Some WME versions emit change, others only click. Deduplicate both.
          queueMicrotask(() => {
            const value = checkbox.checked;
            if (typeof value === 'boolean') onChange(value);
          });
        };
        checkbox.addEventListener('change', changed);
        checkbox.addEventListener('click', changed);
        return { element: checkbox, setChecked: value => { checkbox.checked = value; } };
      }
      // Same behaviour with a native checkbox if WME stops providing wz-checkbox.
      const label = document.createElement('label');
      label.className = 'geoportal-native-checkbox';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.addEventListener('change', () => onChange(input.checked));
      label.appendChild(input);
      label.appendChild(document.createTextNode(name));
      return { element: label, setChecked: value => { input.checked = value; } };
    }
  }

  class GeoportalIntegration {
    constructor() {
      this.ver = SCRIPT_VERSION;
      this.layers = {};
      this.settingsKey = 'wme_geoportal_settings';
      this.settings = this.loadSettings();
      this.initializing = false;
      this.initialized = false;
      this.zoom = null;
      this.refreshRequest = 0;
      this.refreshError = null;

      this.WMS_SERVICES = {
        orto_high: "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution?",
        osm: "https://mapy.geoportal.gov.pl/wss/ext/OSM/BaseMap/service?",
        adresy: "https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaNumeracjiAdresowej?request=GetMap&",
        rail: "https://mapy.geoportal.gov.pl/wss/service/sdi/Przejazdy/get?REQUEST=GetMap&",
        mileage: "https://mapy.geoportal.gov.pl/wss/ext/OSM/SiecDrogowaOSM?",
        topo: "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaBazDanychObiektowTopograficznych?",
        parcels: "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow?",
        border_city: "https://mapy.geoportal.gov.pl/wss/service/PZGIK/PRG/WMS/AdministrativeBoundaries?REQUEST=GetMap&",
        kompozycja: "https://mapy.geoportal.gov.pl/wss/service/pub/guest/kompozycja_BDOT10k_WMS/MapServer/WMSServer"
      };

      // The standard ortho as tiles of the editor's own grid. The service has one
      // Web Mercator matrix set (EPSG:3857, 256 px, levels 0-19) whose indices are
      // the ordinary z/x/y of that grid, so these are literally the tiles the map
      // is built from - a refused one is a hole, not a blank photo layer.
      this.TILE_SERVICES = {
        orto: "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?" +
          "SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg" +
          "&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:${z}&TILEROW=${y}&TILECOL=${x}"
      };

      this.CATEGORIES = {
        "Satellite / Orto": ["Geoportal - ortofoto", "Geoportal - ortofoto high res", "Geoportal - OSM"],
        "Adresy i Ulice": ["Geoportal - adresy", "Geoportal - ulice", "Geoportal - place", "Geoportal - adresy, place i ulice w jednym"],
        "Podział Administracyjny": ["Geoportal - podział adm", "Geoportal - Miasta", "Geoportal - gminy", "Geoportal - powiaty", "Geoportal - województwa", "Geoportal - Granica PL"],
        "Topografia / Inne": ["Geoportal - drogi", "Geoportal - przejazdy kolejowe (wymagany duży zoom)", "Geoportal - obiekty topograficzne"],
        "BDOT (Szczegółowa)": [
          "BDOT - Gruntowa", "BDOT - Utwardzona", "BDOT - Twarda", "BDOT - Główna",
          "BDOT - W budowie (Ekspr./Główna)", "BDOT - Jezdnia (Ekspr./Główna)",
          "BDOT - Autostrada", "BDOT - Numer drogi"
        ]
      };

      this.init();
    }

    log(msg) {
      console.log(`%c[Geoportal] ${msg}`, 'color: #00aaff; font-weight: bold;');
    }

    loadSettings() {
      const saved = localStorage.getItem(this.settingsKey);
      const defaults = {
        enabledLayers: { "Geoportal - adresy": true },
        layerOpacity: {},
        collapsedCats: {}
      };
      const settings = saved ? JSON.parse(saved) : defaults;
      settings.enabledLayers = settings.enabledLayers || {};
      settings.layerOpacity = settings.layerOpacity || {};
      settings.collapsedCats = settings.collapsedCats || {};
      return settings;
    }

    saveSettings() {
      const enabledLayers = {};
      const layerOpacity = {};
      Object.keys(this.layers).forEach(name => {
        enabledLayers[name] = this.layers[name].isEnabled;
        layerOpacity[name] = this.layers[name].opacity;
      });
      this.settings.enabledLayers = enabledLayers;
      this.settings.layerOpacity = layerOpacity;
      localStorage.setItem(this.settingsKey, JSON.stringify(this.settings));
    }

    init() {
      this.log(`Version ${this.ver} initialization started`);
      this.bootstrap().catch(error => {
        console.error('[Geoportal] Initialization stopped:', error);
      });
    }

    async bootstrap() {
      if (this.initializing || this.initialized) return;
      this.initializing = true;
      this.sdk = await SdkAdapter.connect({
        scriptId: 'wme-geoportal-pl',
        scriptName: 'Geoportal Waze integration'
      });
      this.log(`Connected to ${await this.sdk.describe()} (checked against SDK ${SDK_BASELINE})`);
      await this.sdk.waitForReady();
      this.user = await this.sdk.getUserInfo();
      this.wms = await waitFor(() => WmsAdapter.connect(), 'the legacy WMS renderer');

      this.setupUI();
      this.createLayersDefinition();
      const refresh = () => this.refreshLayers().then(() => {
        this.refreshError = null;
      }, error => {
        // Report each distinct problem once; the next map event retries anyway.
        const message = String(error?.message ?? error);
        if (message !== this.refreshError) console.error('[Geoportal] Could not refresh WMS layers:', error);
        this.refreshError = message;
      });
      this.sdk.on('wme-map-zoom-changed', refresh);
      // OpenLayers renumbers z-indexes when layers are added, removed or reordered.
      const fixZIndex = () => this.fixZIndex();
      this.sdk.on('wme-map-layer-added', fixZIndex);
      this.sdk.on('wme-map-layer-changed', fixZIndex);
      this.sdk.on('wme-map-layer-removed', fixZIndex);
      // The same signals straight from the map that the SDK events mirror.
      this.wms.watchMap({ onZoom: refresh, onLayers: fixZIndex });
      await refresh();
      this.startMutationObserver();
      this.injectUI();
      this.initialized = true;
      this.log('Initialization complete (WME SDK)');
    }

    setupUI() {
      if (document.getElementById('geoportal-styles')) return;
      const style = document.createElement('style');
      style.id = 'geoportal-styles';
      style.innerHTML = `
                #geoportal-layers-group {
                    color: inherit;
                    --geoportal-item-bg: rgba(128, 128, 128, 0.05);
                }
                #geoportal-layers-group .geoportal-separator {
                    border-top: 1px solid rgba(128, 128, 128, 0.2);
                    margin: 12px 0 8px 0;
                    padding-top: 6px;
                    font-weight: bold;
                    font-size: 0.95em;
                    color: #00aaff;
                    text-align: center;
                }
                .geoportal-category { margin-bottom: 6px; }
                .geoportal-cat-header {
                    background: var(--geoportal-item-bg);
                    padding: 8px 12px;
                    cursor: pointer;
                    font-size: 0.9em;
                    font-weight: 600;
                    border-radius: 6px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    transition: background 0.2s;
                }
                .geoportal-cat-header:hover { background: rgba(128, 128, 128, 0.15); }
                .geoportal-cat-header::after { content: '▼'; font-size: 0.75em; transition: transform 0.2s; }
                .geoportal-cat-header.collapsed::after { transform: rotate(-90deg); }
                .geoportal-cat-body { padding: 4px 0 4px 8px; overflow: hidden; transition: max-height 0.3s ease; }
                .geoportal-cat-body.collapsed { max-height: 0; display: block!important; }
                
                .geoportal-layer-item { padding: 8px 0; border-bottom: 1px solid rgba(128, 128, 128, 0.05); }
                .geoportal-layer-control { display: flex; flex-direction: column; gap: 4px; }
                
                .geoportal-slider-container {
                    padding-left: 28px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .geoportal-opacity-slider {
                    flex: 1;
                    height: 4px;
                    accent-color: #00aaff;
                    cursor: pointer;
                    opacity: 0.7;
                    transition: opacity 0.2s;
                    margin: 0;
                }
                .geoportal-opacity-slider:hover { opacity: 1; }
                .geoportal-opacity-value { font-size: 10px; color: #888; width: 22px; text-align: right; }
                
                .geoportal-info {
                    font-size: 0.75em;
                    color: #888;
                    font-style: italic;
                    margin-top: 12px;
                    padding: 0 4px;
                    line-height: 1.3;
                }
                .geoportal-native-checkbox { display: flex; align-items: center; gap: 8px; cursor: pointer; }

                /* OpenLayers shows the element of a refused image again (empty,
                   possibly with the browser's broken-image mark) and marks it with
                   this class. It must not cover the view kept on screen. */
                img.olImageLoadError { visibility: hidden !important; }
            `;
      document.head.appendChild(style);
    }

    createLayersDefinition() {
      const usrRank = this.user?.rank ?? 0;

      // The photo layers are the only ones that cover the whole view, so a refused
      // image used to be the whole view - the editor's base map had nothing to
      // show through. Both now come as tiles of the editor's own grid: the
      // standard ortho straight from the Geoportal tile service (the same z/x/y
      // tiles the map draws, levels 0-19), the high-res ortho cut into that grid
      // on the client, because its service publishes no such tiles. A refused tile
      // is one hole in the view, with the editor's base map behind it. The
      // high-res service renders each tile on demand - there is no tile cache
      // behind it - so that layer asks for tiles of HIGH_RES_TILE_SIZE px: a
      // quarter of the requests of 256 px tiles for the same view.
      this.createTileLayer("Geoportal - ortofoto", this.TILE_SERVICES.orto, { maxZ: ORTO_TILE_MAX_ZOOM });
      this.createWMSLayer("Geoportal - ortofoto high res", this.WMS_SERVICES.orto_high, "Raster", "image/jpeg", { singleTile: false, tileSize: HIGH_RES_TILE_SIZE, minZ: 14 });

      if (usrRank >= 1) {
        this.createWMSLayer("Geoportal - OSM", this.WMS_SERVICES.osm, "osm", "image/png");
      }

      this.createWMSLayer("Geoportal - adresy", this.WMS_SERVICES.adresy, "A07_Punkty_adresowe", "image/png", { singleTile: false, minZ: 14, hasOpacity: false });
      this.createWMSLayer("Geoportal - ulice", this.WMS_SERVICES.adresy, "A08_Ulice_Linie", "image/png", { singleTile: false, minZ: 14, hasOpacity: false });
      this.createWMSLayer("Geoportal - place", this.WMS_SERVICES.adresy, "A08_Ulice_Powierzchnie", "image/png", { singleTile: false, minZ: 14, hasOpacity: false });
      this.createWMSLayer("Geoportal - adresy, place i ulice w jednym", this.WMS_SERVICES.adresy, "A07_Punkty_adresowe,A08_Ulice_Powierzchnie,A08_Ulice_Linie", "image/png", { singleTile: false, minZ: 14, hasOpacity: false });

      this.createWMSLayer("Geoportal - przejazdy kolejowe (wymagany duży zoom)", this.WMS_SERVICES.rail, "PMT_Linie_Kolejowe_Sp__z_o_o_,Kopalnia_Piasku_KOTLARNIA_-_Linie_Kolejowe_Sp__z__o_o_,Jastrzębska_Spółka_Kolejowa_Sp__z_o_o_,Infra_SILESIA_S_A_,EUROTERMINAL_Sławków_Sp__z_o_o_,Dolnośląska_Służba_Dróg_i_Kolei_we_Wrocławiu,CARGOTOR_Sp__z_o_o_,PKP_SKM_w_Trójmieście_Sp__z_o_o_,PKP_Linia_Hutnicza_Szerokotorowa_Sp__z_o__o_,PKP_Polskie_Linie_Kolejowe", "image/png", { minZ: 15 });
      this.createWMSLayer("Geoportal - drogi", this.WMS_SERVICES.mileage, "planowane,wbudowie,pikietaz,drugorzedne,glowne,ekspresowe,autostrady", "image/png", { minZ: 12 });
      this.createWMSLayer("Geoportal - podział adm", this.WMS_SERVICES.parcels, "dzialki,numery_dzialek", "image/png", { singleTile: false, minZ: 15, hasOpacity: false });

      this.createWMSLayer("Geoportal - Miasta", this.WMS_SERVICES.border_city, "A06_Granice_obrebow_ewidencyjnych,A05_Granice_jednostek_ewidencyjnych,A04_Granice_miast", "image/png", { singleTile: false,  minZ: 12, hasOpacity: false });
      this.createWMSLayer("Geoportal - gminy", this.WMS_SERVICES.border_city, "A03_Granice_gmin", "image/png", { singleTile: false, minZ: 10, hasOpacity: false });
      this.createWMSLayer("Geoportal - powiaty", this.WMS_SERVICES.border_city, "A02_Granice_powiatow", "image/png", { singleTile: false, minZ: 10, hasOpacity: false });
      this.createWMSLayer("Geoportal - województwa", this.WMS_SERVICES.border_city, "A01_Granice_wojewodztw", "image/png", { singleTile: false, minZ: 8, hasOpacity: false });
      this.createWMSLayer("Geoportal - Granica PL", this.WMS_SERVICES.border_city, "A00_Granice_panstwa", "image/png", { singleTile: false, minZ: 0, hasOpacity: false });

      this.createWMSLayer("Geoportal - obiekty topograficzne", this.WMS_SERVICES.topo, "bdot", "image/png", { singleTile: false, minZ: 16 });

      const bdotMap = {
        "BDOT - Gruntowa": "DrDGr,DrLGr",
        "BDOT - Utwardzona": "JDrLNUt",
        "BDOT - Twarda": "JDLNTw,JDrZTw",
        "BDOT - Główna": "JDrG",
        "BDOT - W budowie (Ekspr./Główna)": "DrEk",
        "BDOT - Jezdnia (Ekspr./Główna)": "JDrEk",
        "BDOT - Autostrada": "JAu",
        "BDOT - Numer drogi": "NrDr"
      };

      Object.entries(bdotMap).forEach(([name, sub]) => {
        this.createWMSLayer(name, this.WMS_SERVICES.kompozycja, sub, "image/png", { minZ: 16 });
      });
    }

    createWMSLayer(name, url, layers, format = "image/png", options = {}) {
      this.registerLayer(name, { name, url, layers, format, options }, options);
    }

    /** A layer fetched from a tile service as the editor's own z/x/y tiles. */
    createTileLayer(name, url, options = {}) {
      this.registerLayer(name, { name, url, options, kind: "wmts" }, options);
    }

    registerLayer(name, definition, options) {
      const integration = this;
      this.layers[name] = {
        definition,
        hasOpacity: options.hasOpacity !== false,
        instance: null,
        opacity: this.settings.layerOpacity[name] ?? 1.0,
        isEnabled: this.settings.enabledLayers[name] ?? false,
        updateVisibility: function () {
          const visible = this.isEnabled && integration.zoom !== null &&
            integration.zoom >= (options.minZ ?? 0);
          if (visible && !this.instance) {
            this.instance = integration.wms.createLayer(this.definition, this.opacity);
          }
          if (this.instance) this.instance.setVisibility(visible);
        },
        setVisibility: function (visible) {
          this.isEnabled = visible;
          this.updateVisibility();
          integration.fixZIndex();
        },
        setOpacity: function (val) {
          this.opacity = val;
          if (this.instance) this.instance.setOpacity(val);
        },
        getVisibility: function () { return this.isEnabled; }
      };
    }

    injectUI() {
      const list = LayerMenuAdapter.findList();
      if (!list) return;
      if (!this.uiGroup) {
        if (!this.checkboxesReady()) return;
        this.uiGroup = this.createUIGroup();
      }
      // Reattach the same controls if WME replaces the entire layer card.
      if (this.uiGroup.parentNode !== list) list.appendChild(this.uiGroup);
    }

    // Build the controls once WME's checkbox component is registered (setting
    // `checked` earlier would shadow its setter). Fall back to native checkboxes
    // if a future WME no longer provides the component.
    checkboxesReady() {
      if (this.uiReady || LayerMenuAdapter.hasWmeCheckbox()) {
        this.uiReady = true;
        return true;
      }
      if (!this.uiWaiting) {
        this.uiWaiting = true;
        LayerMenuAdapter.whenWmeCheckbox(CHECKBOX_TIMEOUT).then(found => {
          if (!found) console.warn('[Geoportal] WME checkbox component not found, using native checkboxes.');
          this.uiReady = true;
          this.injectUI();
        });
      }
      return false;
    }

    createUIGroup() {
      const groupLi = document.createElement('li');
      groupLi.id = 'geoportal-layers-group';
      groupLi.className = 'group';

      const header = document.createElement('div');
      header.className = 'geoportal-separator';
      header.innerText = "-- Geoportal PL --";
      groupLi.appendChild(header);

      Object.entries(this.CATEGORIES).forEach(([catName, layerNames]) => {
        const catDiv = document.createElement('div');
        catDiv.className = 'geoportal-category';
        const catHeader = document.createElement('div');
        catHeader.className = 'geoportal-cat-header';
        const isCollapsed = this.settings.collapsedCats[catName] === true;
        if (isCollapsed) catHeader.classList.add('collapsed');
        catHeader.innerText = catName;
        const catBody = document.createElement('div');
        catBody.className = 'geoportal-cat-body';
        if (isCollapsed) catBody.classList.add('collapsed');
        catHeader.addEventListener('click', () => {
          const nowCollapsed = catBody.classList.toggle('collapsed');
          catHeader.classList.toggle('collapsed');
          this.settings.collapsedCats[catName] = nowCollapsed;
          localStorage.setItem(this.settingsKey, JSON.stringify(this.settings));
        });
        layerNames.forEach(lName => {
          if (this.layers[lName]) catBody.appendChild(this.createUIItem(lName));
        });
        catDiv.appendChild(catHeader);
        catDiv.appendChild(catBody);
        groupLi.appendChild(catDiv);
      });

      const info = document.createElement('div');
      info.className = 'geoportal-info';
      info.innerText = "Przesunięcie suwaka przezroczystości w prawo włącza warstwę.\nWarstwa ukrywa się automatycznie przy małym przybliżeniu.";
      groupLi.appendChild(info);
      return groupLi;
    }

    createUIItem(lName) {
      const lData = this.layers[lName];
      const item = document.createElement('div');
      item.className = 'geoportal-layer-item';
      const control = document.createElement('div');
      control.className = 'geoportal-layer-control';
      const checkbox = LayerMenuAdapter.createCheckbox(lName, lData.isEnabled, checked => {
        if (checked === lData.isEnabled) return;
        lData.setVisibility(checked);
        this.saveSettings();
      });
      control.appendChild(checkbox.element);
      if (lData.hasOpacity) {
        const sliderContainer = document.createElement('div');
        sliderContainer.className = 'geoportal-slider-container';
        const slider = document.createElement('input');
        slider.type = 'range'; slider.className = 'geoportal-opacity-slider';
        slider.min = "0"; slider.max = "100";
        slider.value = (lData.opacity * 100).toString();
        const opacityVal = document.createElement('span');
        opacityVal.className = 'geoportal-opacity-value';
        opacityVal.innerText = (Math.round(lData.opacity * 100)).toString() + "%";
        slider.addEventListener('input', () => {
          const val = parseInt(slider.value) / 100;
          lData.setOpacity(val);
          opacityVal.innerText = slider.value + "%";
          if (val > 0 && !lData.isEnabled) {
            checkbox.setChecked(true); lData.setVisibility(true); this.saveSettings();
          } else if (val === 0 && lData.isEnabled) {
            checkbox.setChecked(false); lData.setVisibility(false); this.saveSettings();
          }
        });
        slider.addEventListener('change', () => this.saveSettings());
        sliderContainer.appendChild(slider); sliderContainer.appendChild(opacityVal);
        control.appendChild(sliderContainer);
      }
      item.appendChild(control); return item;
    }

    async refreshLayers() {
      const request = ++this.refreshRequest;
      const zoom = await this.sdk.getZoomLevel();
      // Refreshes can overlap; apply only the most recent answer.
      if (request !== this.refreshRequest) return;
      this.zoom = zoom;
      this.wms.setZoomLevel(zoom);
      Object.values(this.layers).forEach(layer => layer.updateVisibility());
      this.fixZIndex();
    }

    fixZIndex() {
      let currentZIndex = Z_INDEX_BASE;
      Object.values(this.layers).forEach(layer => {
        if (layer.instance && layer.isEnabled) layer.instance.setZIndex(currentZIndex++);
      });
    }

    startMutationObserver() {
      // Observe a stable ancestor: the card itself may be absent or replaced.
      // Coalesce mutations and ignore slider/text changes inside our own group.
      this.uiObserver = new MutationObserver(mutations => {
        if (this.uiTimer || !mutations.some(m => !this.uiGroup?.contains(m.target))) return;
        this.uiTimer = setTimeout(() => {
          this.uiTimer = null;
          this.injectUI();
        }, 100);
      });
      this.uiObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  new GeoportalIntegration();
})();
