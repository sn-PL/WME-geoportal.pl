// ==UserScript==
// @name            Geoportal Waze integration (fork by snPL)
// @version         1.6.0
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
 *  1.6.0 - OSM, the standard photo layer, the level crossings and the topographic objects come as tiles of the editor's own map, because those services refuse a whole-window picture; the parcels and the boundaries are tiles of that map again too, so a pan inside the margin of the tiles asks for nothing at all and a longer one only for the strip it uncovers; the crossings and the detailed BDOT switches ask in EPSG:2180, the system those services draw in - asked in 4326 they answer with a picture of their own error instead of the data (drawn into the image, because OpenLayers asks a WMS for INIMAGE exceptions); every service is now asked for its errors as documents instead of pictures, so a failure leaves a hole in the layer instead of a grey plate of text on the map; the drawings whose letters are the information are re-drawn instead of filtered: the layer asks the service for the same area at half the pixels, which makes it draw its letters twice as big, and the filter of the layer then makes them white and snaps every edge onto the pixel grid, with a one-pixel black casing around each letter - and the contour is smoothed first: the letters of a service are rasterised for the size of the image, so at twice that size every edge of theirs is a step of two screen pixels, which is what the eye reads as ragged lettering; a blur of 1.2 px turns those steps into ramps and a short edge of the transfer puts the colour back onto one line of a ramp, so the letters are smooth and the edge of a stroke is anti-aliased instead of two hard raster pixels, while the drawing's own one-pixel lines survive it - so the parcels and their numbers, the addresses, the streets, the places, the crossings and the topographic objects are white ink with a small black outline, hard-edged and twice the size, where a halo around a letter five pixels tall was only a grey smudge of it; the towns, the communes, the counties, the provinces and the state border draw translucent coloured areas along with their names, so nothing of their ink is touched - not whitened, not lifted, not put through the threshold, because that turned their pale lettering and its own light plate into one washed-out slab (letters 230, 217, 231 on a plate of 250, 248, 251 in the report of 1.6.0) - and their whole drawing only gains the same one pixel of black outline, which is what their already-white names need over a pale field; the road network and the BDOT surfaces, whose colour is the map itself, are still lifted under a thin white edge; the drawings whose letters are the information are asked for in cells of the map of their own size - eight times the editor's own for the parcels and the town boundaries, whose every parcel or obręb carries a number, and four times it for the rest - so one picture of the service covers that much ground and a window of the editor's size is one or two pictures instead of dozens: every picture a service renders has its own set of names drawn into it, and a name that lies on the edge between two pictures was drawn in both of them, standing beside itself as the doubled numbers of the reports; a view picture is never asked for past about a megapixel, a refused image is asked for again after a moment, the drawing of the view a layer has delivered stays on the map only for as long as that view is the one being asked for (OpenLayers used to keep it beside the new one, at the offset of the pan, which is what doubled the parcel numbers and the names), it is never carried through a zoom, and a setting that cannot be read no longer stops the script.
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

  const SCRIPT_VERSION = "1.6.0";
  // WME SDK typings this version was checked against (wme-sdk-typings.tgz).
  const SDK_BASELINE = "v2.374-5-g0024d1fa65";
  const WAIT_TIMEOUT = 120000;
  const CHECKBOX_TIMEOUT = 30000;
  // Enabled overlays are stacked upwards from this z-index, in definition order.
  const Z_INDEX_BASE = 2040;
  // The Geoportal serves the standard ortho and the OSM base map in the editor's
  // own tile grid: Web Mercator EPSG:3857, 256 px tiles, levels 0-19, the same
  // z/x/y tiles the map is drawn from. Above level 19 there are no tiles, so
  // OpenLayers keeps asking for level 19 and stretches it - which is the detail
  // the data has anyway.
  const TILE_MAX_ZOOM = 19;
  // Resolution of a 256 px Web Mercator tile at level 0 (the whole world).
  const MERCATOR_WORLD_RESOLUTION = 156543.03392804097;
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
  // The map services answer a whole-view image only up to about a megapixel (past
  // that they send a document or nothing at all), so a view image is asked for at
  // the largest size that still comes back and stretched over the view.
  const MAX_VIEW_PIXELS = 1200000;
  // These services draw their overlays as thin strokes and small letters, in colours
  // the editor's imagery swallows: black for the roads and the topographic objects, a
  // faint blue for the parcels, white names on coloured lines for the borders. And
  // they rasterise their letters 5-8 pixels tall. That is what every report about
  // them comes down to: at that size no filter can make a letter readable, a halo
  // wider than the stroke of a letter *is* the letter (a white halo around a
  // one-pixel stroke leaves a grey smudge, and over a meadow it leaves nothing), and
  // stretching the raster over more pixels only makes the same grey bigger.
  //
  // So the drawing is not filtered any more, it is re-drawn. The browser asks the
  // service for the same area at half the pixels (`magnify`) and stretches that image
  // over the place: the letters, which the service draws at a fixed pixel size, come
  // out twice as big. The filter then takes the soft grey result and turns it back
  // into ink: every pixel's alpha is pushed to either 0 or 1, which snaps every edge
  // and every letter's outline back onto the pixel grid, and the letters are made pure
  // white on the way in (brightness(0) invert(1) - the same alpha, i.e. the same
  // shape, in white). A one-pixel casing is grown around each letter with
  // feMorphology, which is what a white letter needs over a pale meadow; it is the
  // letter's own edge, not a halo - nothing is blurred and nothing is added on top of
  // the ink. This is the closest thing to a vector drawing a raster service can give.
  //
  // Where that cannot be done, the drawing keeps its ink untouched and is only given
  // the casing. That is the five boundary layers: they draw translucent coloured
  // areas along with their names (the obreb fills of "Miasta"), so making every pixel
  // white would paint those areas over the map as white slabs, and putting the whole
  // drawing through the threshold of the filter turns their wide, pale lettering into
  // one bright slab (which is what the report of 1.6.0 caught: letters at 230, 217,
  // 231 on their own plate at 250, 248, 251 read as a single washed-out shape, and
  // the same service draws the towns of the same layer in crisp white, so the layer
  // looks "mixed" - two styles in one drawing). Those layers are asked for at twice
  // the size like the rest, and their whole drawing - names, boundary lines and the
  // coloured areas - gets one pixel of black outline, which is what their
  // already-white letters need over a pale field. Nothing of their ink is recoloured,
  // brightened or thresholded.
  const CONTRAST_FILTER = {
    // the drawings that are strokes and points: white ink, one pixel of black casing
    white: "brightness(0) invert(1) url(#geoportal-labels-ink)",
    // the drawings that carry coloured areas: nothing of their ink is touched, they
    // only get the same one pixel of black casing
    outline: "drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000)",
    // the drawings whose colour is the map itself: lifted, never recoloured
    dark: "brightness(2) drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff)",
    colour: "brightness(2.2) saturate(1.7) " +
      "drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff)"
  };
  // The filter itself, as an element of the page: a CSS filter cannot express "every
  // alpha becomes 0 or 1" nor "grow the shape by one pixel", so the one that re-draws
  // the ink is an SVG filter the layer's element points at - the same one for both
  // kinds above. The threshold is alpha * 4 - 1.1 (the pixel is ink or it is not,
  // from a quarter of the service's own coverage up), and the casing is one pixel of
  // dilate under a black flood, merged under the ink.
  const CONTRAST_SVG =
    '<svg id="geoportal-label-filters" width="0" height="0" ' +
    'style="position:absolute;left:0;top:0;pointer-events:none">' +
    '<defs>' +
    // The letters of a service are rasterised for the size of the image, and that
    // image is drawn twice as large (LABEL_MAGNIFY), so every edge of a letter is
    // the edge of a raster pixel of the service - a step of two screen pixels, on
    // every diagonal. Measured on a report, that is what the eye reads as ragged
    // lettering. A small blur first turns each of those steps into a ramp, and the
    // threshold behind it puts the colour back onto one line of the ramp - a smooth
    // contour, hard edge, nothing left half lit. Blurring the whole drawing this way
    // keeps what it is made of: a one pixel line thins by a fraction and does not
    // vanish (its centre still crosses the threshold), and the transfer is not an
    // instant on/off but a very short edge, so the contour ends on a lightly
    // anti-aliased pixel instead of a hard corner of two raster pixels.
    '<filter id="geoportal-labels-ink" x="-20%" y="-20%" width="140%" height="140%" ' +
    'color-interpolation-filters="sRGB">' +
    '<feGaussianBlur stdDeviation="1.2" result="soft"/>' +
    '<feComponentTransfer in="soft" result="ink">' +
    '<feFuncA type="linear" slope="8" intercept="-3.4"/>' +
    '</feComponentTransfer>' +
    '<feMorphology in="ink" operator="dilate" radius="1" result="grown"/>' +
    '<feFlood flood-color="#000" result="black"/>' +
    '<feComposite in="black" in2="grown" operator="in" result="casing"/>' +
    '<feMerge><feMergeNode in="casing"/><feMergeNode in="ink"/></feMerge>' +
    '</filter>' +
    '</defs></svg>';
  // How much smaller than the drawing the image asked for is, i.e. how many times
  // the service's letters end up bigger than they were rasterised. Two - the letters
  // of all of those drawings are five to eight pixels tall at their own size.
  const LABEL_MAGNIFY = 2;
  // The cell of the map such a drawing is asked for in. A service draws its labels
  // into the image it is asked for and knows nothing outside that image: its label
  // placement is solved per image. So a view built from many small images gets each
  // name as many times as there are images over it, and two numbers whose parcels
  // meet can be placed into different images and land on top of one another - the
  // repeated and overlapping numbers of the reports. Both are answered by asking
  // for fewer, larger images: at 1024 px per cell a window of a usual size is built
  // from one or two images, the service lays out the whole frame in one pass, and a
  // name has no second image left to be drawn into. The image asked for stays at
  // 1/LABEL_MAGNIFY of the cell (512 px), so the letters keep the size they have,
  // and the pixels per square metre of map do not change - what grows is how much
  // of the map one image covers, i.e. what the first paint of an area brings in.
  const LABEL_CELL = 1024;
  // The two drawings whose every parcel, and every obręb, carries its number or name:
  // those are the ones that repeat, and the ones whose numbers meet at the edge of an
  // image, so they are asked for in cells of 2048 px - a window of the editor's size
  // is then one image, or two, and the service lays the whole window out in one pass.
  // The image asked for stays at 1/LABEL_MAGNIFY of the cell (1024 px, twice the cell
  // the editor draws from), so the letters keep their size and the pixels per metre
  // of map do not change.
  const LABEL_CELL_WIDE = 2048;
  // Geodetic constants of EPSG:2180 (PUWG 1992): GRS80, transverse Mercator with
  // the scale factor 0.9993, central meridian 19°E and the usual false origin.
  const PUWG = { a: 6378137, f: 1 / 298.257222101, k0: 0.9993, meridian: 19, falseEasting: 500000, falseNorthing: -5300000 };

  /**
   * A WGS84 point in EPSG:2180 - the series proj uses, to the millimetre.
   *
   * The topographic objects ("obiekty topograficzne") have to be asked for in
   * this system: the service is an integration that forwards every request to the
   * WMS of the county the request covers, and those county services answer in
   * EPSG:2180 alone - a GetMap in 4326 or 3857 comes back as an empty image
   * wherever the country is asked. The system is a transverse Mercator on GRS80,
   * so the transform is a closed series and needs no projection library.
   * @param {number} lon longitude in degrees
   * @param {number} lat latitude in degrees
   * @returns {{ easting: number, northing: number }} metres
   */
  function to2180(lon, lat) {
    const { a, f, k0, meridian, falseEasting, falseNorthing } = PUWG;
    const n = f / (2 - f);
    const bigA = a / (1 + n) * (1 + n * n / 4 + Math.pow(n, 4) / 64);
    const alpha = [
      n / 2 - 2 * n * n / 3 + 5 * Math.pow(n, 3) / 16,
      13 * n * n / 48 - 3 * Math.pow(n, 3) / 5,
      61 * Math.pow(n, 3) / 240
    ];
    const factor = 2 * Math.sqrt(n) / (1 + n);
    const phi = lat * Math.PI / 180;
    const lam = (lon - meridian) * Math.PI / 180;
    const t = Math.sinh(Math.atanh(Math.sin(phi)) - factor * Math.atanh(factor * Math.sin(phi)));
    const xi = Math.atan2(t, Math.cos(lam));
    const eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
    let easting = 0, northing = 0;
    for (let j = 1; j <= 3; j++) {
      easting += alpha[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
      northing += alpha[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    }
    return {
      easting: falseEasting + k0 * bigA * (eta + easting),
      northing: falseNorthing + k0 * bigA * (xi + northing)
    };
  }

  /**
   * WGS84 bounds as the BBOX of a WMS 1.3.0 request in EPSG:2180. The service
   * behind that integration reads the two numbers of a corner as northing,
   * easting, and the cell of a tile is small enough for the bounding rectangle
   * of its four corners to be the tile itself.
   * @param {any} bounds WGS84 bounds (lon/lat)
   * @returns {number[]} BBOX as northing, easting, northing, easting
   */
  function bounds2180(bounds) {
    const corners = [
      [bounds.left, bounds.bottom], [bounds.left, bounds.top],
      [bounds.right, bounds.bottom], [bounds.right, bounds.top]
    ];
    let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity;
    corners.forEach(([lon, lat]) => {
      const point = to2180(lon, lat);
      minE = Math.min(minE, point.easting);
      maxE = Math.max(maxE, point.easting);
      minN = Math.min(minN, point.northing);
      maxN = Math.max(maxN, point.northing);
    });
    // Centimetres are far below what the data and the pixels can tell apart.
    const round = value => Math.round(value * 100) / 100;
    return [round(minN), round(minE), round(maxN), round(maxE)];
  }

  // What the BDOT10k composition offers for roads: the surface classes of one and
  // the same road network. A request carrying six of them at once never comes back
  // as a picture, so each class (or pair of related classes) is a switch of its
  // own, and the switches and the menu are built from this one list.
  const BDOT_LAYERS = {
    "BDOT - Gruntowa": "DrDGr,DrLGr",
    "BDOT - Utwardzona": "JDrLNUt",
    "BDOT - Twarda": "JDLNTw,JDrZTw",
    "BDOT - Główna": "JDrG",
    "BDOT - W budowie (Ekspr./Główna)": "DrEk",
    "BDOT - Jezdnia (Ekspr./Główna)": "JDrEk",
    "BDOT - Autostrada": "JAu",
    "BDOT - Numer drogi": "NrDr"
  };

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

    /**
     * The size to ask a service for: the size OpenLayers wants, shrunk to
     * MAX_VIEW_PIXELS when it is larger (see that constant).
     * @param {{w: number, h: number}} size
     * @returns {{w: number, h: number}}
     */
    requestImageSize(size) {
      const pixels = size.w * size.h;
      if (pixels <= MAX_VIEW_PIXELS) return size;
      const shrink = Math.sqrt(MAX_VIEW_PIXELS / pixels);
      // Rounded down, so that rounding can never put the request past the cap.
      return { w: Math.floor(size.w * shrink), h: Math.floor(size.h * shrink) };
    }

    /**
     * Build a layer of the definition and put it on the map. Both kinds - a WMS
     * image of the view and the editor's own z/x/y tiles (the standard ortho as
     * Web Mercator tiles that line up with the map's grid, so a refused tile is
     * one hole with the base map behind it instead of an empty view) - differ
     * only in how the layer object is made and which URL its cells ask for;
     * everything around that is the same here.
     * @param {{ name: string, url: string, layers?: string, format?: string, kind?: string, options: any }} definition
     * @param {number} opacity
     */
    createLayer(definition, opacity) {
      const { name, url, options } = definition;
      const adapter = this;
      const minZoom = options.minZ ?? 0;
      // State of this layer's image recovery, shared with retryMissingImage.
      // `view` is the last area the layer asked for: the image the layer is
      // showing belongs to that area alone, so an image of any other area has
      // no business on the map (see getURL).
      const recovery = { tried: 0, timer: null, stamp: null, view: null };
      // The service's levels as resolutions of the standard grid, i.e. the same
      // values as the editor's zoom levels, so its tiles line up with the tiles
      // the map is drawn from and a hole is exactly one tile of that map.
      // Level 19 is the last one the service has: above it OpenLayers keeps asking
      // for level 19 and stretches that tile, which carries the detail the data has.
      const maxZoom = Math.min(options.maxZ ?? TILE_MAX_ZOOM, TILE_MAX_ZOOM);
      const resolutions = [];
      for (let zoom = 0; zoom <= maxZoom; zoom++) {
        resolutions.push(MERCATOR_WORLD_RESOLUTION / Math.pow(2, zoom));
      }
      const world = new this.OL.Bounds(-20037508.342789244, -20037508.342789244,
        20037508.342789244, 20037508.342789244);
      /** @type {any} */
      let layer;
      if (definition.kind === "wmts") {
        layer = new this.OL.Layer.XYZ(name, url, {
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
      } else {
        const { layers, format } = definition;
        const singleTile = options.singleTile ?? true;
        // The system of the request. Everything the map itself can speak is asked
        // for in EPSG:4326; the topographic objects need the system of the county
        // services behind their integration (see to2180).
        const crs = options.crs ?? "EPSG:4326";
        // The photo layers are opaque mosaics: transparency is a contradiction there
        // and OpenLayers answered it by switching their JPEG to PNG. Only the PNG
        // overlays ask for it, so the requests stay as they were before 1.5.0.
        // Ask for the service's own errors as documents, not as pictures. Asked the
        // WMS way (INIMAGE, which is what OpenLayers asks for by default) a failing
        // service paints its error into the image and that picture lands on the map:
        // the grey plate with "Invalid CRS given" or "Error HRESULT E_FAIL has been
        // returned from a call to a COM component." A document is not an image, so
        // the cell stays a hole - as if the tile were never delivered - and the
        // recovery below asks again.
        /** @type {Record<string, string>} */
        const params = { layers, format, version: "1.3.0", exceptions: "XML" };
        if (format !== "image/jpeg") params.transparent = "true";
        layer = new this.OL.Layer.WMS(name, url, params,
          {
            isBaseLayer: false, visibility: false,
            singleTile,
            // The cell of the map this layer is drawn in. The editor's own cells are
            // 256 px (the value OpenLayers falls back to); the drawings whose letters
            // are the information ask for half a kilometre of map per cell instead
            // (LABEL_CELL), so a view is made of a quarter of the images - see above.
            tileSize: new adapter.OL.Size(options.tileSize ?? 256, options.tileSize ?? 256),
            // How much of the map a single-tile layer renders. 1.5 is OpenLayers'
            // own default (a view plus a margin, so small pans need no new image);
            // 1 asks for the view itself, which is what the services that refuse a
            // large render need (see MAX_VIEW_PIXELS).
            ratio: options.ratio ?? 1.5,
            transitionEffect: "resize",
            noMagic: true, // never let OpenLayers rewrite the format
            getURL: function (bounds) {
              bounds = this.adjustBounds(bounds.clone());
              const asked = this.getImageSize(bounds);
              if (adapter.zoomAt((bounds.right - bounds.left) / asked.w) < minZoom) return null;
              bounds.transform(adapter.sourceProjection, adapter.targetProjection);
              // WMS 1.3.0 / EPSG:4326 uses latitude, longitude axis order, while the
              // integrating service reads EPSG:2180 as northing, easting. As long as
              // the view image is missing, every request asks under a fresh address,
              // so no cache can answer it with the refused response.
              // Asked for exactly the pixels that will be drawn, never more and never
              // fewer - except for the layers that ask for half of them on purpose
              // (`magnify`). Those are the drawings whose letters are the information,
              // and the one way to get a service letter bigger is to have it drawn in
              // an image of half the pixels and stretched over the place; the filter
              // of the layer then takes that soft result apart again (see
              // CONTRAST_FILTER). The megapixel cap is on what the service is asked to
              // render, so it is applied to the pixels of the request and not to the
              // pixels of the map the cell covers - a cell twice the editor's own asks
              // for a megapixel and is drawn from it, the cap leaving it alone.
              const magnify = options.magnify ?? 1;
              const imageSize = adapter.requestImageSize({
                w: asked.w / magnify,
                h: asked.h / magnify
              });
              const request = {
                BBOX: crs === "EPSG:2180" ? bounds2180(bounds) : bounds.toArray(true),
                WIDTH: Math.max(64, Math.round(imageSize.w)),
                HEIGHT: Math.max(64, Math.round(imageSize.h))
              };
              // The image the layer is showing belongs to the view it was rendered
              // for. The moment another view is asked for - a pan, a zoom, a wider
              // window - that image is no longer the view the reader is looking at,
              // and it is still on the map: drawn at the offset of the place it was
              // rendered for, with its own labels standing beside the labels of the
              // new drawing, which is what the doubled numbers and names of the
              // reports were. It goes now, at the request, and not when the answer
              // to that request happens to arrive: a refused image would otherwise
              // leave the wrong picture on the map for the whole of the retry.
              const view = request.BBOX.join(",") + "@" + request.WIDTH + "x" + request.HEIGHT;
              if (recovery.view && recovery.view !== view) this.removeBackBuffer();
              recovery.view = view;
              if (recovery.stamp) request._ = recovery.stamp;
              return this.getFullRequestString(request);
            },
            getFullRequestString: function () {
              this.params.CRS = crs;
              return adapter.OL.Layer.Grid.prototype.getFullRequestString.apply(this, arguments);
            },
            // A zoom, and only a zoom, reaches here with a drawing of the old scale:
            // OpenLayers would rescale the picture of the previous view and lay it
            // over the new one, where every label of it appears a second time -
            // washed out, at the size of the old zoom, and never in line with the
            // new drawing. That is the doubled and blurred text of the reports, on
            // one of the two paths that produced it (the other one, a pan, is
            // answered in getURL). A zoom is a new drawing: the old picture goes,
            // and the map shows what it has - the editor's base map or the photo
            // layer behind it - until the new cells arrive.
            applyBackBuffer: function (resolution) {
              if (resolution !== this.gridResolution) {
                this.removeBackBuffer();
                return;
              }
              return adapter.OL.Layer.Grid.prototype.applyBackBuffer.apply(this, arguments);
            }
          });
      }
      layer.setOpacity(opacity);
      // Once the OpenLayers map is known - from the first layer the SDK put on
      // it - every layer goes straight onto it; before that, through the SDK's
      // own map, which is what tells us which OpenLayers map it is.
      const target = this.olMap ?? this.map;
      target.addLayer(layer);
      if (!this.olMap && layer.map) {
        this.olMap = layer.map;
        if (this.zoomResolution === null) this.zoomResolution = this.getMapResolution();
        this.attachMapEvents();
      }
      const filter = CONTRAST_FILTER[options.contrast];
      if (filter && layer.div) {
        if (filter.includes("url(#")) this.installLabelFilters();
        layer.div.style.filter = filter;
      }
      this.retryMissingImage(layer, recovery);
      return layer;
    }

    /**
     * Put the filter of CONTRAST_SVG on the page, once, the first time a layer asks
     * for it: the layer refers to it by name, and a name that is a child of another
     * element of the page - the editor has no reason to carry ours - is not found.
     */
    installLabelFilters() {
      if (this.labelFilters) return;
      const holder = document.createElement("div");
      holder.innerHTML = CONTRAST_SVG;
      this.labelFilters = holder.firstChild;
      document.body.appendChild(this.labelFilters);
    }

    /**
     * OpenLayers counts a refused image as loaded and never asks for it again, so
     * a refused tile stays a hole and a refused view image stays an empty layer.
     * Whatever is missing is asked for again at the delays in IMAGE_RETRY_DELAYS -
     * through mergeNewParams, because OpenLayers' tile manager keeps a refused
     * draw in a queue that the layer's params event flushes, while a plain redraw
     * would leave it there. A new map view and a delivered image start the
     * attempts over.
     * @param {any} layer layer built by createLayer
     * @param {{tried: number, timer: any, stamp: number|null, view: string|null}} recovery its state
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
        // as loaded as well, and marks that one; only the others count. A layer of
        // tiles starts over only once no tile of the current grid is missing: a
        // tile that is still refused has to keep its pending retry, or a neighbour
        // arriving a moment later would cancel the only request that can fill it.
        tileloaded: event => {
          if (event?.tile?.imgDiv?.classList?.contains('olImageLoadError')) return;
          const missing = layer.grid?.some(row => row.some(tile =>
            tile.imgDiv?.classList?.contains('olImageLoadError')));
          if (!missing) {
            restart();
            // OpenLayers keeps the previous drawing - its "back buffer" - on the
            // map while the new one is on its way, and lets go of it only 2.5 s
            // after the last tile of the new one arrived. Where a service refuses
            // part of its answers, which is what these do, the new drawing can stay
            // incomplete far longer than that, and meanwhile the previous one is
            // still drawn under it: the labels of the view it was rendered for at
            // that view's offset. The replacement is here, so nothing is waiting
            // for it - and for a layer of one image per view, which is where the
            // doubled names were seen, the replacement is the whole of that layer.
            if (layer.backBuffer && !layer.numLoadingTiles) layer.removeBackBuffer();
          }
        },
        tileerror: () => {
          // A refused image is marked as failed by OpenLayers and hidden by the
          // stylesheet, so the layer is a hole where it was refused; the retry
          // below asks for it again under a fresh address.
          recovery.stamp = Date.now();
          if (recovery.timer || recovery.tried >= IMAGE_RETRY_DELAYS.length) return;
          recovery.timer = setTimeout(recover, IMAGE_RETRY_DELAYS[recovery.tried++]);
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
        adresy: "https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaNumeracjiAdresowej?request=GetMap&",
        rail: "https://mapy.geoportal.gov.pl/wss/service/sdi/Przejazdy/get?REQUEST=GetMap&",
        mileage: "https://mapy.geoportal.gov.pl/wss/ext/OSM/SiecDrogowaOSM?",
        topo: "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaBazDanychObiektowTopograficznych?",
        parcels: "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow?",
        border_city: "https://mapy.geoportal.gov.pl/wss/service/PZGIK/PRG/WMS/AdministrativeBoundaries?REQUEST=GetMap&",
        kompozycja: "https://mapy.geoportal.gov.pl/wss/service/pub/guest/kompozycja_BDOT10k_WMS/MapServer/WMSServer"
      };

      // The standard ortho and the OSM base map as tiles of the editor's own grid.
      // Both services have one Web Mercator matrix set (EPSG:3857, 256 px, levels
      // 0-19) whose indices are the ordinary z/x/y of that grid, so these are
      // literally the tiles the map is built from - a refused one is a hole, not a
      // blank photo layer.
      this.TILE_SERVICES = {
        orto: "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?" +
          "SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg" +
          "&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:${z}&TILEROW=${y}&TILECOL=${x}",
        // One address for two services: this is its tile face, while its WMS face
        // ("osm" in EPSG:4326) rendered a whole view per request and was never
        // cacheable - the tiles carry an ETag and a three-day max-age.
        osm: "https://mapy.geoportal.gov.pl/wss/ext/OSM/BaseMap/service?" +
          "SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=osm_3857&STYLE=default&FORMAT=image/png" +
          "&TILEMATRIXSET=GLOBAL_WEBMERCATOR&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}"
      };

      this.CATEGORIES = {
        "Satellite / Orto": ["Geoportal - ortofoto", "Geoportal - ortofoto high res", "Geoportal - OSM"],
        "Adresy i Ulice": ["Geoportal - adresy", "Geoportal - ulice", "Geoportal - place", "Geoportal - adresy, place i ulice w jednym"],
        "Podział Administracyjny": ["Geoportal - podział adm", "Geoportal - Miasta", "Geoportal - gminy", "Geoportal - powiaty", "Geoportal - województwa", "Geoportal - Granica PL"],
        "Topografia / Inne": ["Geoportal - drogi", "Geoportal - przejazdy kolejowe (wymagany duży zoom)", "Geoportal - obiekty topograficzne"],
        "BDOT (Szczegółowa)": Object.keys(BDOT_LAYERS)
      };

      this.init();
    }

    log(msg) {
      console.log(`%c[Geoportal] ${msg}`, 'color: #00aaff; font-weight: bold;');
    }

    loadSettings() {
      // Whatever is stored may be unreadable - a half-written value, a value left
      // by something else under the same key - and the script has to start anyway.
      /** @type {{enabledLayers: Record<string, boolean>, layerOpacity: Record<string, number>, collapsedCats: Record<string, boolean>}} */
      const defaults = {
        enabledLayers: { "Geoportal - adresy": true },
        layerOpacity: {},
        collapsedCats: {}
      };
      let settings = defaults;
      try {
        const saved = localStorage.getItem(this.settingsKey);
        const parsed = saved ? JSON.parse(saved) : null;
        if (parsed && typeof parsed === 'object') settings = parsed;
      } catch (error) {
        console.warn('[Geoportal] Saved settings could not be read, using the defaults:', error);
      }
      const section = name => {
        const value = settings[name];
        if (!value || typeof value !== 'object') settings[name] = defaults[name];
      };
      ['enabledLayers', 'layerOpacity', 'collapsedCats'].forEach(section);
      return settings;
    }

    saveSettings() {
      /** @type {Record<string, boolean>} */
      const enabledLayers = {};
      /** @type {Record<string, number>} */
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
      // is one hole in the view, with the editor's base map behind it.
      this.createTileLayer("Geoportal - ortofoto", this.TILE_SERVICES.orto, { maxZ: TILE_MAX_ZOOM });
      this.createWMSLayer("Geoportal - ortofoto high res", this.WMS_SERVICES.orto_high, "Raster", "image/jpeg", { singleTile: false, minZ: 14 });

      if (usrRank >= 1) {
        // The OSM base map is a picture of the whole map, like the ortho, and its
        // service publishes it as the tiles of the same Web Mercator grid.
        this.createTileLayer("Geoportal - OSM", this.TILE_SERVICES.osm, { maxZ: TILE_MAX_ZOOM });
      }

      this.createWMSLayer("Geoportal - adresy", this.WMS_SERVICES.adresy, "A07_Punkty_adresowe", "image/png", { singleTile: false, minZ: 14, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "white" });
      this.createWMSLayer("Geoportal - ulice", this.WMS_SERVICES.adresy, "A08_Ulice_Linie", "image/png", { singleTile: false, minZ: 14, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "white" });
      this.createWMSLayer("Geoportal - place", this.WMS_SERVICES.adresy, "A08_Ulice_Powierzchnie", "image/png", { singleTile: false, minZ: 14, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "white" });
      this.createWMSLayer("Geoportal - adresy, place i ulice w jednym", this.WMS_SERVICES.adresy, "A07_Punkty_adresowe,A08_Ulice_Powierzchnie,A08_Ulice_Linie", "image/png", { singleTile: false, minZ: 14, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "white" });

      // This one refuses a whole-view render: it answers a GetMap up to about
      // 1200x900 px and from some size between that and 1400x900 it sends back an
      // error document instead of a picture - which is why the layer used to come
      // out empty on a normal screen. As tiles of the editor's grid every request
      // is one small cell and each of them is a hole at worst. It draws in
      // EPSG:4326, which is what the map itself speaks (see the note above it).
      this.createWMSLayer("Geoportal - przejazdy kolejowe (wymagany duży zoom)", this.WMS_SERVICES.rail, "PMT_Linie_Kolejowe_Sp__z_o_o_,Kopalnia_Piasku_KOTLARNIA_-_Linie_Kolejowe_Sp__z__o_o_,Jastrzębska_Spółka_Kolejowa_Sp__z_o_o_,Infra_SILESIA_S_A_,EUROTERMINAL_Sławków_Sp__z_o_o_,Dolnośląska_Służba_Dróg_i_Kolei_we_Wrocławiu,CARGOTOR_Sp__z_o_o_,PKP_SKM_w_Trójmieście_Sp__z_o_o_,PKP_Linia_Hutnicza_Szerokotorowa_Sp__z_o__o_,PKP_Polskie_Linie_Kolejowe", "image/png", { singleTile: false, minZ: 15, crs: "EPSG:2180", hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "white" });
      this.createWMSLayer("Geoportal - drogi", this.WMS_SERVICES.mileage, "planowane,wbudowie,pikietaz,drugorzedne,glowne,ekspresowe,autostrady", "image/png", { minZ: 12, hasOpacity: false, contrast: "dark" });
      // The parcels and the boundaries draw their names in the middle of the thing
      // they name, and the service draws them into every image it is asked for (a WMS
      // places its labels in the picture it renders, not on the map): as cells of the
      // editor's grid it asks for the cell it is looking at, keeps the ones it
      // already has and asks only for the strip a pan uncovers, instead of asking a
      // service to render the whole window again for every move. The image of a cell
      // is asked for at half of the pixels it is drawn with, which is what makes the
      // service draw its names at twice the size, and the filter turns that stretched
      // raster back into hard-edged ink. What stood on the map twice were never the
      // cells: it was the image of the previous view that OpenLayers keeps beside the
      // new one, which is dropped in getURL now.
      this.createWMSLayer("Geoportal - podział adm", this.WMS_SERVICES.parcels, "dzialki,numery_dzialek", "image/png", { singleTile: false, minZ: 15, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL_WIDE, contrast: "white" });

      this.createWMSLayer("Geoportal - Miasta", this.WMS_SERVICES.border_city, "A06_Granice_obrebow_ewidencyjnych,A05_Granice_jednostek_ewidencyjnych,A04_Granice_miast", "image/png", { singleTile: false, minZ: 12, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL_WIDE, contrast: "outline" });
      this.createWMSLayer("Geoportal - gminy", this.WMS_SERVICES.border_city, "A03_Granice_gmin", "image/png", { singleTile: false, minZ: 10, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "outline" });
      this.createWMSLayer("Geoportal - powiaty", this.WMS_SERVICES.border_city, "A02_Granice_powiatow", "image/png", { singleTile: false, minZ: 10, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "outline" });
      this.createWMSLayer("Geoportal - województwa", this.WMS_SERVICES.border_city, "A01_Granice_wojewodztw", "image/png", { singleTile: false, minZ: 8, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "outline" });
      this.createWMSLayer("Geoportal - Granica PL", this.WMS_SERVICES.border_city, "A00_Granice_panstwa", "image/png", { singleTile: false, minZ: 0, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "outline" });

      // Topographic objects of the counties that published them. The integration
      // behind this address hands every request to the WMS of the county it
      // covers, and those answer in EPSG:2180 only - in 4326 the whole country
      // comes back as an empty image, which is what the layer showed.
      this.createWMSLayer("Geoportal - obiekty topograficzne", this.WMS_SERVICES.topo, "bdot", "image/png", { singleTile: false, minZ: 16, crs: "EPSG:2180", hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "white" });

      // The composition draws these classes from about 1:10 000 up, and it draws
      // them in the national system EPSG:2180: asked in 4326 it answers one and
      // the same picture for every piece of the country, i.e. no data at all.
      // It also stops answering a whole view past about a megapixel, so each
      // switch asks for one image of the view itself (ratio 1) instead of
      // OpenLayers' larger default, and none of them has an opacity slider.
      Object.entries(BDOT_LAYERS).forEach(([name, classNames]) => {
        this.createWMSLayer(name, this.WMS_SERVICES.kompozycja, classNames, "image/png", { minZ: 16, ratio: 1, crs: "EPSG:2180", hasOpacity: false, contrast: "colour" });
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
      const hasOpacity = options.hasOpacity !== false;
      this.layers[name] = {
        definition,
        hasOpacity,
        instance: null,
        // A layer without a slider always draws at full opacity, so a value left
        // over in the settings from a version that had one cannot dim it.
        opacity: hasOpacity ? (this.settings.layerOpacity[name] ?? 1.0) : 1.0,
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

  const geoportal = new GeoportalIntegration();
  // Handle on the script, for the editor's console and for the tests in test/:
  // the layer list as built, and the transformations it uses. Nothing reads it
  // back, so removing this line only takes the tests and the console view away.
  /** @type {any} */ (window).__geoportalPl = Object.assign(geoportal, {
    internals: {
      VERSION: SCRIPT_VERSION, to2180, bounds2180, BDOT_LAYERS, PUWG, MAX_VIEW_PIXELS,
      IMAGE_RETRY_DELAYS, TILE_MAX_ZOOM, CONTRAST_FILTER, CONTRAST_SVG, LABEL_MAGNIFY, Z_INDEX_BASE
    }
  });
})();
