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
 *  1.6.0 - OSM, the standard photo layer, the level crossings and the topographic objects come as tiles of the editor's own map, because those services refuse a whole-window picture; the parcels, the addresses and the boundaries are tiles of that map too, so a pan inside the margin of the tiles asks for nothing at all and a longer one only for the strip it uncovers; the crossings and the detailed BDOT switches ask in EPSG:2180, the system those services draw in - asked in 4326 they answer with a picture of their own error instead of the data (drawn into the image, because OpenLayers asks a WMS for INIMAGE exceptions); every service is now asked for its errors as documents instead of pictures, so a failure leaves a hole in the layer instead of a grey plate of text on the map; the six drawings of the administrative group are asked for in cells of 2048 px of map at half their pixels, so the service draws their letters twice as large and a window of the editor's size is one image of the service, laid out in one pass; the parcel drawing is asked for as two layers, because its two halves want opposite sizes: its boundary lines are one pixel of the service's raster and are drawn at the size of the map, with their own blue flooded pure white on top of the untouched drawing, so they stay continuous and white; its numbers are a layer of their own, asked for in a cell of the same size at a third of the pixels so that the service draws them three times as large, and that image is the service's own white digit with its own dark outline, flooded white inside, given a little more contrast and a dark casing grown outwards and laid under - the outline is the shape of the digit and its separation from the digit beside it, so nothing may paint over it; the names of the boundary layers are a dark name on a fat white halo, and a letter of that service is a stroke one pixel wide, so making it white with the dark outline a white letter needs turned every name into a hollow skeleton - instead the service's own scheme is hardened: its soft halo becomes pure white and its soft letters pure black, and the boundary lines, the coloured areas and the rest of the drawing stay exactly as the service drew them; the rest of those drawings is kept and blurred by half a pixel, which takes the two pixel steps out of the raster without a threshold cutting the thin lines away; the addresses, the streets, the places, the crossings and the topographic objects are shown exactly as the service draws them, without a filter and at one image pixel per pixel of the map, because those drawings cannot be recoloured without losing them - a street is a wide translucent surface, which any whitening paints over the photo as a white band; the road network and the BDOT surfaces, whose colour is the map itself, are lifted under a thin white edge; a view picture is never asked for past about a megapixel, a refused image is asked for again after a moment, the drawing of the view a layer has delivered stays on the map only for as long as that view is the one being asked for (OpenLayers used to keep it beside the new one, at the offset of the pan, which is what doubled the parcel numbers and the names), it is never carried through a zoom, and a setting that cannot be read no longer stops the script.
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
  // the editor's imagery swallows: a faint blue for the parcels, black for the
  // topographic objects, pale names on coloured lines for the borders - and they
  // rasterise their letters 5-8 pixels tall, which is why filter after filter failed
  // on them: at that size a halo is wider than the stroke of a letter.
  //
  // The one way to a readable letter is to have the service draw it bigger: the layer
  // asks for the same area at half the pixels (`magnify`) and stretches that image over
  // the place, so the letters come out twice the size. What is left is to turn that
  // doubled result into pure white ink - and the report of 10.2026 is the reason the key
  // is DARKNESS and not coverage: a parcel number is dark digits on a white plate, and
  // both are opaque, so whitening by coverage (rounds 23-27) turned the plate and its
  // digits into one white shape. The filter therefore starts with
  //   alpha = 1 - luminance,
  // masked by the drawing's own coverage so the transparent background and the
  // translucent areas stay transparent: the dark digits of a number pass, the white
  // plate under them does not, and neither does a coloured area fill.
  //
  // The key is smoothed before it is snapped: the service's raster is drawn twice as
  // large, so every edge of it is a step of two screen pixels on every diagonal, which
  // is what reads as jagged lettering. A blur of 0.8 px turns each step into a ramp and
  // a short edge of the transfer puts the colour back onto one line of a ramp - a smooth
  // contour with a hard edge. The transfer turns ink on at a fifth of the key, so a one
  // pixel line of the drawing - the parcel boundaries - still crosses it after the blur
  // (its peak is 0.79 against a cut of 0.20): a thicker blur plus a very low cut, which
  // rounds the corners further, also turns every edge of the service's anti-aliasing
  // into white and leaves the letters with a grey glow around them.
  //
  // The letters are plain white, nothing else: no casing is grown under them (a white
  // letter does not need one over the imagery of the editor, and a black ring around a
  // five pixel letter eats a fifth of it). The five boundary layers draw their own names
  // in a pale colour rather than a dark one, so they take the same key with a very low
  // cut and no blur of their own - their names and their boundary lines become white,
  // their coloured areas do not.
  const CONTRAST_FILTER = {
    // the drawings whose letters are dark: white ink, smoothed contour (the parcels)
    white: "url(#geoportal-labels-ink)",
    // the drawings that name places in a pale colour and carry coloured areas: the same
    // key with a cut down at the pale letter's own key - white names and boundary lines,
    // coloured areas untouched (their fill keys out below the cut)
    names: "url(#geoportal-labels-names)",
    // the numbers of the parcels, a layer of their own (see the parcel definition)
    numerals: "url(#geoportal-labels-numerals)",
    // the drawings whose colour is the map itself: lifted, never recoloured
    dark: "brightness(2) drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff)",
    colour: "brightness(2.2) saturate(1.7) " +
      "drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff)"
  };
  // The filters themselves, as elements of the page: no CSS filter can key on luminance,
  // then recolour the key dead white and grow a casing under it, so they are SVG filters
  // and the layer's element points at one of them by name.
  //
  // Both filters end the same way: the mask is turned into a flood of pure white (a solid
  // 255 white with no grey - a soft edge would read as a grey fringe over the photo) and
  // one pixel of black casing is grown from the mask and laid under it, because a white
  // letter over a pale meadow, a concrete roof or a white plate is otherwise invisible.
  // Everything before that is a key - which pixels of the drawing are ink - and the
  // smoothing of that key, which is what makes the letters and the parcel lines smooth:
  // the service's image is drawn twice its size, so every edge of it is a staircase of two
  // screen pixels, and a blur turns each step into a ramp whose middle the transfer cuts
  // through, i.e. a smooth contour.
  //
  // How much smaller than the drawing the image asked for is, i.e. how many times the
  // service's letters end up bigger than they were rasterised. The service draws a name
  // or a number in a stroke one pixel wide and wraps it in a halo of its own that is one
  // or two pixels wide; at two the halo and the stroke are the same width on screen and
  // the two of them close every gap between two letters. Three gives the gap a pixel of
  // its own, and the hard cut keeps the edge of it sharp.
  const LABEL_MAGNIFY = 3;
  // Both filters have one idea and they add no shape of their own: they only change the
  // colour of the pixels the service already drew. The rounds before grew the ink (a
  // dilate of the whole silhouette for the casing) and that is what fused the digits and
  // the names into one white bar - the report of 10.2026, "the type merges and is
  // completely unreadable". A drawing magnified twice is already smooth; what it needs is
  // the right colour.
  //
  // The key is the drawing's own luminance. A contrast stretch of it is used as the alpha
  // of a flood, so the bright pixels become pure white and the dark ones black, while the
  // ramp between them - the anti-aliasing of the service's own raster - is left alone.
  // That ramp is what keeps an edge smooth, and nothing here can make a stroke wider.
  const LABEL_LUMA =
    '<feColorMatrix in="SourceGraphic" type="matrix" result="lum" ' +
    'values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.299 0.587 0.114 0 0"/>';
  // which pixels of the drawing are opaque at all: the coloured areas of the boundary
  // layers sit at about 43 %, every line and every letter at 100 %
  const LABEL_COVERAGE =
    '<feComponentTransfer in="SourceAlpha" result="cov">' +
    '<feFuncA type="linear" slope="4" intercept="-2"/>' +
    '</feComponentTransfer>';
  // A flood of one colour over the pixels a hard cut kept. The cut is `discrete`, i.e.
  // every pixel ends up either 0 or 1 - a letter is 255 white to its last pixel, and the
  // one pixel of antialiasing around it is what the browser stretches when the drawing is
  // shown twice its size, so the edge stays smooth without a single grey letter inside.
  const LABEL_FLOOD = (name, colour, kind, cut = 0.5) =>
    // `kind` says which side of the cut is ink and `cut` where the cut sits, as a fraction
    // of the luminance. The stretch puts `cut` at a half of the alpha, where `discrete`
    // switches, so the mask is binary but the cut itself is free to move: a grey name on a
    // white halo needs a cut near the halo, not in the middle of the grey.
    (kind === 'dark'
      ? '<feComponentTransfer in="lum" result="' + name + 'a">' +
        `<feFuncA type="linear" slope="${(-0.5 / cut).toFixed(4)}" intercept="1"/>` +
        '</feComponentTransfer>'
      : '<feComponentTransfer in="lum" result="' + name + 'a">' +
        `<feFuncA type="linear" slope="${(0.5 / (1 - cut)).toFixed(4)}" ` +
        `intercept="${(0.5 - 0.5 * cut / (1 - cut)).toFixed(4)}"/></feComponentTransfer>`) +
    `<feComponentTransfer in="${name}a" result="${name}b">` +
    '<feFuncA type="discrete" tableValues="0 1"/>' +
    '</feComponentTransfer>' +
    `<feComposite in="${name}b" in2="cov" operator="in" result="${name}m"/>` +
    `<feFlood flood-color="${colour}" result="f${name}"/>` +
    `<feComposite in="f${name}" in2="${name}m" operator="in" result="${name}"/>`;
  // A black ring `r` elements wide, grown out of `white`'s own mask and drawn under it.
  // Being grown out and not into the mask, the ring can never widen a glyph or close the
  // gap to the glyph beside it - it only adds dark around the drawing, where the map is.
  const LABEL_RING = (r) =>
    `<feMorphology in="whitem" operator="dilate" radius="${r}" result="fat"/>` +
    '<feComposite in="fat" in2="whitem" operator="out" result="ring0"/>' +
    '<feComposite in="ring0" in2="cov" operator="in" result="ringm"/>' +
    '<feFlood flood-color="#000" result="fr"/>' +
    '<feComposite in="fr" in2="ringm" operator="in" result="casing"/>';
  // A stretch of the drawing's own colours around their middle, so that the service's
  // one pixel outline comes out a little darker and its white a little brighter without
  // touching the shape of a glyph. Everything stays a ramp - this is not a threshold.
  const LABEL_CONTRAST = (k = 2) =>
    `<feComponentTransfer in="SourceGraphic" result="crisp">` +
    `<feFuncR type="linear" slope="${k}" intercept="${(-0.5 * (k - 1)).toFixed(3)}"/>` +
    `<feFuncG type="linear" slope="${k}" intercept="${(-0.5 * (k - 1)).toFixed(3)}"/>` +
    `<feFuncB type="linear" slope="${k}" intercept="${(-0.5 * (k - 1)).toFixed(3)}"/>` +
    '</feComponentTransfer>';
  const CONTRAST_SVG =
    '<svg id="geoportal-label-filters" width="0" height="0" ' +
    'style="position:absolute;left:0;top:0;pointer-events:none">' +
    '<defs>' +
    // The parcel lines. The geometry and the numbers are two layers of the same
    // service, and they are asked for separately, because they want opposite things:
    // a boundary line is one pixel of the service's raster and has to be drawn at
    // exactly the size of the map, while a number is a letter and only reads when the
    // service draws it bigger. One image cannot be both - asking the pair at a third of
    // the pixels turned the lines into a third of a pixel and they came out dashed, which
    // is the report of 10.2026. So this filter only lifts the geometry: the drawing is
    // kept whole and the blue boundary lines are flooded pure white on top of it.
    '<filter id="geoportal-labels-ink" x="-10%" y="-10%" width="120%" height="120%" ' +
    'color-interpolation-filters="sRGB">' +
    LABEL_LUMA +
    LABEL_COVERAGE +
    // the lines of that drawing are blue (blue minus red is about three quarters of the
    // range) and nothing else on the map is; asked at the size of the map they are solid,
    // so a hard key takes them with the antialiasing the service gave them
    '<feColorMatrix in="SourceGraphic" type="matrix" result="bl" ' +
    'values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1 0 1 0 0"/>' +
    '<feComponentTransfer in="bl" result="bluea">' +
    '<feFuncA type="linear" slope="6" intercept="-2.4"/>' +
    '</feComponentTransfer>' +
    '<feComponentTransfer in="bluea" result="blueb">' +
    '<feFuncA type="discrete" tableValues="0 1"/>' +
    '</feComponentTransfer>' +
    '<feComposite in="blueb" in2="cov" operator="in" result="bluem"/>' +
    '<feFlood flood-color="#fff" result="fb"/>' +
    '<feComposite in="fb" in2="bluem" operator="in" result="bluew"/>' +
    '<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="bluew"/></feMerge>' +
    '</filter>' +
    // The parcel numbers, as a layer of their own: this drawing carries nothing but
    // the numbers, so nothing else can be caught by mistake. A number is white digits
    // with the service's own thin dark outline; that outline is kept exactly as drawn -
    // it is the shape of the digit and its separation from the digit beside it - the
    // white inside it is flooded pure white, a dark casing one pixel wide is grown
    // outwards and laid under, and the whole drawing is given a little more contrast so
    // the outline stays crisp at the size it is shown.
    '<filter id="geoportal-labels-numerals" x="-10%" y="-10%" width="120%" height="120%" ' +
    'color-interpolation-filters="sRGB">' +
    LABEL_LUMA +
    LABEL_COVERAGE +
    LABEL_FLOOD('white', '#fff', 'bright', 0.62) +
    LABEL_RING(1) +
    LABEL_CONTRAST(2) +
    '<feMerge><feMergeNode in="casing"/><feMergeNode in="crisp"/>' +
    '<feMergeNode in="white"/></feMerge>' +
    '</filter>' +
    // The boundary names. The service draws a dark name on a fat white halo - and five
    // rounds of making those letters white failed for a reason that is in the drawing: a
    // letter of the boundary service is a stroke one pixel wide, so a white letter with the
    // dark outline a white letter needs is black and white in equal measure, and it reads
    // as a hollow skeleton, not as a letter. What the service got wrong is not the colour
    // of the name, it is that the halo is a grey and the letters are a blur: both are soft.
    // So both are hardened and nothing else is touched - the halo is flooded to pure white
    // and the letters to pure black, and the drawing under them keeps its lines and its
    // coloured areas exactly as the service drew them. Every edge stays as crisp as the
    // luminance allows, and the name reads at a glance because black on white is the
    // highest contrast there is.
    '<filter id="geoportal-labels-names" x="-10%" y="-10%" width="120%" height="120%" ' +
    'color-interpolation-filters="sRGB">' +
    LABEL_LUMA +
    LABEL_COVERAGE +
    // the halo is the brightest thing in that drawing; the translucent areas (43 % of a
    // pixel) are gated out by the coverage above, so a cut at 0.72 takes the halo alone
    LABEL_FLOOD('halo', '#fff', 'bright', 0.72) +
    // a name is all but black (0.10); a brown boundary line is 0.48, so a cut at 0.45 keeps
    // the letters and leaves the line to the drawing
    LABEL_FLOOD('letter', '#000', 'dark', 0.45) +
    '<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="halo"/>' +
    '<feMergeNode in="letter"/></feMerge>' +
    '</filter>' +
    '</defs></svg>';
  const LABEL_CELL = 2048;

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

    createLayer(definition, opacity) {
      if (definition.kind === "wmts") return this.createTileLayer(definition, opacity);
      const { name, url, layers, format, options } = definition;
      const adapter = this;
      const minZoom = options.minZ ?? 0;
      const singleTile = options.singleTile ?? true;
      // The system of the request. Everything the map itself can speak is asked
      // for in EPSG:4326; the topographic objects need the system of the county
      // services behind their integration (see to2180).
      const crs = options.crs ?? "EPSG:4326";
      // State of this layer's image recovery, shared with retryMissingImage.
      // `view` is the last area the layer asked for: the image the layer is
      // showing belongs to that area alone, so an image of any other area has
      // no business on the map (see getURL).
      const recovery = { tried: 0, timer: null, stamp: null, view: null };
      // The photo layers are opaque mosaics: transparency is a contradiction there
      // and OpenLayers answered it by switching their JPEG to PNG. Only the PNG
      // overlays ask for it, so the requests stay as they were before 1.5.0.
      /** @type {Record<string, string>} */
      // Ask for the service's own errors as documents, not as pictures. Asked the
      // WMS way (INIMAGE, which is what OpenLayers asks for by default) a failing
      // service paints its error into the image and that picture lands on the map:
      // the grey plate with "Invalid CRS given" or "Error HRESULT E_FAIL has been
      // returned from a call to a COM component." A document is not an image, so
      // the cell stays a hole - as if the tile were never delivered - and the
      // recovery below asks again.
      const params = { layers, format, version: "1.3.0", exceptions: "XML" };
      if (format !== "image/jpeg") params.transparent = "true";
      const layer = new this.OL.Layer.WMS(name, url, params,
        {
          isBaseLayer: false, visibility: false,
          singleTile,
          // The cell of the map this layer is drawn in. The editor's own cells are
          // 256 px (the value OpenLayers falls back to); a drawing whose letters are
          // the information asks for four times as much of the map per cell
          // (LABEL_CELL), so a window of the editor's size is one image of the
          // service and its names are laid out in one pass.
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
            // fewer - except for the one drawing whose letters are the information
            // (`magnify`): that one asks for half of them, because the only way to get
            // a bigger letter out of a raster service is to have it drawn in a smaller
            // image and stretched over the place, and the filter of the layer then
            // turns the soft result back into ink. The megapixel cap is on what the
            // service renders, i.e. on the pixels of the request.
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
      return this.installLayer(layer, recovery, opacity, options);
    }

    /**
     * Put a built layer on the map and start watching it, and let the first one
     * tell the adapter which map it is on.
     * @param {any} layer layer built by createLayer or createTileLayer
     * @param {{tried: number, timer: any, stamp: number|null, view: string|null}} recovery its state
     * @param {number} opacity
     * @param {any} options the layer's definition options (only `contrast` is read)
     * @returns {any} the layer
     */
    installLayer(layer, recovery, opacity, options = {}) {
      layer.setOpacity(opacity);
      this.map.addLayer(layer);
      const filter = CONTRAST_FILTER[options.contrast];
      if (filter && layer.div) {
        if (filter.includes("url(#")) this.installLabelFilters();
        layer.div.style.filter = filter;
      }
      this.retryMissingImage(layer, recovery);
      if (!this.olMap && layer.map) {
        this.olMap = layer.map;
        if (this.zoomResolution === null) this.zoomResolution = this.getMapResolution();
        this.attachMapEvents();
      }
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
      const maxZoom = Math.min(options.maxZ ?? TILE_MAX_ZOOM, TILE_MAX_ZOOM);
      // State of this layer's image recovery, shared with retryMissingImage.
      // `view` is the last area the layer asked for: the image the layer is
      // showing belongs to that area alone, so an image of any other area has
      // no business on the map (see getURL).
      const recovery = { tried: 0, timer: null, stamp: null, view: null };
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
      return this.installLayer(layer, recovery, opacity, options);
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

      this.createWMSLayer("Geoportal - adresy", this.WMS_SERVICES.adresy, "A07_Punkty_adresowe", "image/png", { singleTile: false, minZ: 14, hasOpacity: false });
      this.createWMSLayer("Geoportal - ulice", this.WMS_SERVICES.adresy, "A08_Ulice_Linie", "image/png", { singleTile: false, minZ: 14, hasOpacity: false });
      this.createWMSLayer("Geoportal - place", this.WMS_SERVICES.adresy, "A08_Ulice_Powierzchnie", "image/png", { singleTile: false, minZ: 14, hasOpacity: false });
      this.createWMSLayer("Geoportal - adresy, place i ulice w jednym", this.WMS_SERVICES.adresy, "A07_Punkty_adresowe,A08_Ulice_Powierzchnie,A08_Ulice_Linie", "image/png", { singleTile: false, minZ: 14, hasOpacity: false });

      // This one refuses a whole-view render: it answers a GetMap up to about
      // 1200x900 px and from some size between that and 1400x900 it sends back an
      // error document instead of a picture - which is why the layer used to come
      // out empty on a normal screen. As tiles of the editor's grid every request
      // is one small cell and each of them is a hole at worst. It draws in
      // EPSG:4326, which is what the map itself speaks (see the note above it).
      this.createWMSLayer("Geoportal - przejazdy kolejowe (wymagany duży zoom)", this.WMS_SERVICES.rail, "PMT_Linie_Kolejowe_Sp__z_o_o_,Kopalnia_Piasku_KOTLARNIA_-_Linie_Kolejowe_Sp__z__o_o_,Jastrzębska_Spółka_Kolejowa_Sp__z_o_o_,Infra_SILESIA_S_A_,EUROTERMINAL_Sławków_Sp__z_o_o_,Dolnośląska_Służba_Dróg_i_Kolei_we_Wrocławiu,CARGOTOR_Sp__z_o_o_,PKP_SKM_w_Trójmieście_Sp__z_o_o_,PKP_Linia_Hutnicza_Szerokotorowa_Sp__z_o__o_,PKP_Polskie_Linie_Kolejowe", "image/png", { singleTile: false, minZ: 15, crs: "EPSG:2180", hasOpacity: false });
      this.createWMSLayer("Geoportal - drogi", this.WMS_SERVICES.mileage, "planowane,wbudowie,pikietaz,drugorzedne,glowne,ekspresowe,autostrady", "image/png", { minZ: 12, hasOpacity: false, contrast: "dark" });
      // The parcels and the boundaries draw their names in the middle of the thing
      // they name, and the service draws them into every image it is asked for (a WMS
      // places its labels in the picture it renders, not on the map): as cells of the
      // editor's grid the layer asks for the cell it is looking at, keeps the ones it
      // already has and asks only for the strip a pan uncovers, instead of asking a
      // service to render the whole window again for every move. What stood on the
      // map twice were never the cells: it was the image of the previous view that
      // OpenLayers keeps beside the new one, which is dropped in getURL now.
      //
      // A parcel number is a dark number on a white plate in the service's drawing.
      // It is shown as white ink with a black casing, drawn twice the size: the filter
      // keys the ink on darkness, so the digits come through and the plate does not -
      // the alpha-only whitening of the earlier rounds took both, which is the
      // unreadable white blob of the report of 10.2026 (see CONTRAST_FILTER).
      // Two layers of the same service, asked for at two different sizes, because the
      // two things it draws want opposite ones: the boundary lines are one pixel of the
      // service's raster and must not be stretched (a third of a pixel comes out as a
      // dashed line), while a number only reads when the service draws it bigger. The
      // lines are asked for at the size of the map; the numbers as columns of their own
      // at a third of the pixels, i.e. three times the size.
      this.createWMSLayer("Geoportal - podział adm", this.WMS_SERVICES.parcels, "dzialki", "image/png", { singleTile: false, minZ: 15, hasOpacity: false, tileSize: LABEL_CELL, contrast: "white", companion: { layers: "numery_dzialek", magnify: LABEL_MAGNIFY, contrast: "numerals" } });

      this.createWMSLayer("Geoportal - Miasta", this.WMS_SERVICES.border_city, "A06_Granice_obrebow_ewidencyjnych,A05_Granice_jednostek_ewidencyjnych,A04_Granice_miast", "image/png", { singleTile: false, minZ: 12, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "names" });
      this.createWMSLayer("Geoportal - gminy", this.WMS_SERVICES.border_city, "A03_Granice_gmin", "image/png", { singleTile: false, minZ: 10, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "names" });
      this.createWMSLayer("Geoportal - powiaty", this.WMS_SERVICES.border_city, "A02_Granice_powiatow", "image/png", { singleTile: false, minZ: 10, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "names" });
      this.createWMSLayer("Geoportal - województwa", this.WMS_SERVICES.border_city, "A01_Granice_wojewodztw", "image/png", { singleTile: false, minZ: 8, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "names" });
      this.createWMSLayer("Geoportal - Granica PL", this.WMS_SERVICES.border_city, "A00_Granice_panstwa", "image/png", { singleTile: false, minZ: 0, hasOpacity: false, magnify: LABEL_MAGNIFY, tileSize: LABEL_CELL, contrast: "names" });

      // Topographic objects of the counties that published them. The integration
      // behind this address hands every request to the WMS of the county it
      // covers, and those answer in EPSG:2180 only - in 4326 the whole country
      // comes back as an empty image, which is what the layer showed.
      this.createWMSLayer("Geoportal - obiekty topograficzne", this.WMS_SERVICES.topo, "bdot", "image/png", { singleTile: false, minZ: 16, crs: "EPSG:2180", hasOpacity: false });

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
        // A layer whose drawing is really two things at two sizes (the parcel lines and
        // the parcel numbers) carries a companion: a second layer of the same service,
        // asked for at its own size and drawn directly above. It has no switch of its
        // own - it appears and disappears with the layer it belongs to.
        companion: null,
        updateVisibility: function () {
          const visible = this.isEnabled && integration.zoom !== null &&
            integration.zoom >= (options.minZ ?? 0);
          if (visible && !this.instance) {
            this.instance = integration.wms.createLayer(this.definition, this.opacity);
          }
          if (this.instance) this.instance.setVisibility(visible);
          const companionOptions = options.companion;
          if (companionOptions) {
            if (visible && !this.companion) {
              this.companion = integration.wms.createLayer({
                name: `${name} (numery)`,
                url: this.definition.url,
                layers: companionOptions.layers,
                format: this.definition.format,
                options: { ...options, ...companionOptions, companion: null }
              }, this.opacity);
            }
            if (this.companion) this.companion.setVisibility(visible);
          }
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
        // the companion of a layer is the other half of the same drawing: it sits
        // directly above it, never somewhere else in the stack
        if (layer.companion && layer.isEnabled) layer.companion.setZIndex(currentZIndex++);
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
      IMAGE_RETRY_DELAYS, TILE_MAX_ZOOM, CONTRAST_FILTER, CONTRAST_SVG, LABEL_MAGNIFY,
      LABEL_CELL, Z_INDEX_BASE,
      // the registry itself, so that a suite can look at the half of a layer that has no
      // switch of its own (the numbers beside the parcel lines)
      layers: geoportal.layers
    }
  });
})();
