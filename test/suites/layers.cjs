'use strict';
/**
 * The layer list itself: which layers the script builds, from which service, with
 * which parameters, when they are shown, at which opacity and with which filter.
 * These are the checks a rewrite has to keep passing - one row per layer.
 */
const { boot } = require('../lib/harness.cjs');
const { LAYERS, LAYER_ORDER, CATEGORIES, SERVICES } = require('../lib/fixtures.cjs');

module.exports = async function layers(report) {
  report.suite('the layer list and its definitions');

  const env = await boot({ enabled: 'all' });
  const registry = env.registry;
  const names = Object.keys(registry);

  report.check('every layer of the list exists, in the order the script defines them',
    names.join('|') === LAYER_ORDER.join('|'),
    `${names.length} layers; ${names.filter(name => !LAYER_ORDER.includes(name)).join(', ') || 'no extras'}` +
    (names.length === LAYER_ORDER.length ? '' : ` (expected ${LAYER_ORDER.length})`));

  for (const [name, expected] of Object.entries(LAYERS)) {
    const entry = registry[name];
    if (!entry) {
      report.check(`layer ${name} is built`, false, 'missing from the registry');
      continue;
    }
    const definition = entry.definition;
    const layer = entry.instance;
    const options = definition.options;
    const problems = [];
    if (!definition.url.includes(expected.service)) problems.push(`service ${definition.url}`);
    if (expected.kind === 'tiles') {
      if (layer && layer.CLASS_NAME !== 'OpenLayers.Layer.XYZ') problems.push(`class ${layer.CLASS_NAME}`);
      if (layer && layer.singleTile !== false) problems.push(`instance singleTile=${layer.singleTile}`);
    } else {
      if (definition.layers !== expected.layers) problems.push(`LAYERS=${definition.layers}`);
      if (definition.format !== expected.format) problems.push(`format ${definition.format}`);
      if (layer && layer.CLASS_NAME !== 'OpenLayers.Layer.WMS') problems.push(`class ${layer.CLASS_NAME}`);
      if (layer && layer.singleTile !== expected.singleTile) problems.push(`instance singleTile=${layer.singleTile}`);
      if (layer && layer.ratio !== expected.ratio) problems.push(`instance ratio=${layer.ratio}`);
      if ((options.crs ?? 'EPSG:4326') !== expected.crs) problems.push(`crs=${options.crs}`);
      if ((options.singleTile ?? true) !== expected.singleTile) problems.push(`singleTile=${options.singleTile}`);
      if ((options.ratio ?? 1.5) !== expected.ratio) problems.push(`ratio=${options.ratio}`);
    }
    if ((options.minZ ?? 0) !== expected.minZ) problems.push(`minZ=${options.minZ}`);
    if ((options.hasOpacity !== false) !== expected.hasOpacity) problems.push(`hasOpacity=${options.hasOpacity}`);
    if ((options.contrast ?? false) !== expected.contrast) problems.push(`contrast=${options.contrast}`);
    if (!layer) problems.push('no layer instance');
    report.check(`“${name}” is what the list says it is`, problems.length === 0, problems.join(', '));
  }

  // A layer belongs to exactly one category, and no layer is missing from the menu.
  const inCategories = Object.values(CATEGORIES).flat();
  report.check('every layer sits in exactly one category',
    inCategories.length === LAYER_ORDER.length &&
    new Set(inCategories).size === inCategories.length &&
    LAYER_ORDER.every(name => inCategories.includes(name)),
    `${inCategories.length} entries for ${LAYER_ORDER.length} layers`);

  // These services draw thin strokes and small labels, and the editor's imagery
  // swallows them: every such layer carries the same lifted filter, and no other
  // layer is filtered at all (a filter is expensive).
  const filtered = names.filter(name => {
    const filter = registry[name].instance?.div?.style?.filter || '';
    return filter.length > 0;
  });
  const expectedFiltered = Object.entries(LAYERS).filter(([, e]) => e.contrast).map(([name]) => name);
  report.check('exactly the thin-drawn overlays carry the contrast filter',
    filtered.length === expectedFiltered.length && expectedFiltered.every(name => filtered.includes(name)),
    `${filtered.length} layers of ${names.length}`);
  report.check('every one of the six boundary layers of the report was among them',
    ['Geoportal - podział adm', 'Geoportal - Miasta', 'Geoportal - gminy', 'Geoportal - powiaty',
      'Geoportal - województwa', 'Geoportal - Granica PL'].every(name => filtered.includes(name)),
    'parcels, towns, communes, counties, provinces, state border');
  report.check('each filtered layer carries the filter its ink asks for, and nothing else',
    filtered.every(name => {
      const filter = registry[name].instance.div.style.filter;
      return filter === env.internals.CONTRAST_FILTER[LAYERS[name].contrast];
    }),
    Object.entries(env.internals.CONTRAST_FILTER).map(([kind, value]) => `${kind}: ${value}`).join(' | '));

  // Round 30: every drawing of the `Podział Administracyjny` group - the parcel numbers
  // and the five boundary layers with their own names - is plain white ink, drawn twice
  // the size. The re-colour is keyed on DARKNESS: a parcel number is dark digits on a
  // white plate and both are opaque, so whitening by coverage (rounds 23-27) turned the
  // pair into one white shape. The key is a feColorMatrix whose alpha is 1 - luminance,
  // masked by the drawing's own coverage, and there is no casing under the letters.
  const filters = env.internals.CONTRAST_FILTER;
  const svg = registry['Geoportal - podział adm'].instance.div.ownerDocument
    .getElementById('geoportal-label-filters');
  const ink = svg && svg.querySelector('filter[id="geoportal-labels-ink"]');
  const namesInk = svg && svg.querySelector('filter[id="geoportal-labels-names"]');
  report.check('the two filters that re-draw the ink are on the page once, and only the lettered layers point at them',
    !!svg && !!ink && !!namesInk && svg.querySelectorAll('filter').length === 2 &&
    filters.white === 'url(#geoportal-labels-ink)' &&
    filters.names === 'url(#geoportal-labels-names)' &&
    Object.entries(filters).every(([kind, value]) =>
      kind === 'white' || kind === 'names' || !value.includes('url(#')),
    Object.entries(filters).map(([kind, value]) => `${kind}: ${value}`).join(' | '));
  const luminanceKey = element => {
    const matrix = element && element.querySelector('feColorMatrix');
    if (!matrix || matrix.getAttribute('type') !== 'matrix') return null;
    const values = (matrix.getAttribute('values') || '').trim().split(/\s+/).map(Number);
    if (values.length !== 20) return null;
    const row = values.slice(15, 18);                      // the alpha row: R, G, B
    return { luminance: row, intercept: values[19] };
  };
  const zoom = env.internals.LABEL_MAGNIFY;
  const merged = filter => [...filter.querySelectorAll('feMergeNode')].map(node => node.getAttribute('in'));
  const plateOpening = ink ? [...ink.querySelectorAll('feMorphology')]
    .filter(m => m.getAttribute('operator') === 'erode' || (m.getAttribute('operator') === 'dilate' &&
      m.getAttribute('result') === 'field')) : [];
  report.check('every length of the filters is a length of the drawing, counted in the element\'s pixels',
    !!ink && !!namesInk && zoom > 1 && plateOpening.length === 2 &&
    [...plateOpening].every(m => Number(m.getAttribute('radius')) === 8 * zoom) &&
    // the black casing is one pixel of the drawing, i.e. zoom pixels of the element - the
    // browser filters the image at the size it lays it out, not at the bitmap's own size
    [ink, namesInk].every(filter => [...filter.querySelectorAll('feMorphology')]
      .some(m => m.getAttribute('operator') === 'dilate' && m.getAttribute('result') === 'grown' &&
        Number(m.getAttribute('radius')) === zoom)),
    `the casing and the plate opening are multiplied by LABEL_MAGNIFY (${zoom})`);
  // Round 31: the ink of a parcel number is the drawing's coverage - the whole silhouette
  // the service drew - minus a white plate, which is the one opaque thing that is not a
  // letter. A key on darkness alone gives the one pixel dark outline of the digits, i.e.
  // the hollow grey skeleton of the report.
  report.check('a parcel number is inked from its whole silhouette, and a white plate is not ink',
    (() => {
      if (!ink) return false;
      const notInk = filter => [...filter.querySelectorAll('feComposite')]
        .some(c => c.getAttribute('operator') === 'out' && c.getAttribute('in2') === 'plate');
      const plate = [...ink.querySelectorAll('feComposite')]
        .find(c => c.getAttribute('result') === 'plate');
      const inverse = [...ink.querySelectorAll('feComponentTransfer')]
        .find(t => t.getAttribute('result') === 'notdark');
      const table = inverse && inverse.querySelector('feFuncA')?.getAttribute('tableValues');
      const cover = [...ink.querySelectorAll('feComponentTransfer')]
        .find(t => t.getAttribute('result') === 'cov');
      const cut = cover ? -Number(cover.querySelector('feFuncA').getAttribute('intercept')) /
        Number(cover.querySelector('feFuncA').getAttribute('slope')) : NaN;
      // the plate is the large opaque field of the drawing that is not dark: the digits on
      // it stay ink, the field around them does not
      return notInk(ink) && !!plate && plate.getAttribute('operator') === 'in' &&
        (table || '').trim() === '1 0' && Math.abs(cut - 0.5) < 0.1 &&
        !ink.querySelector('feColorMatrix[result="letters"]');
    })(),
    'coverage (opaque at half) minus the opening of the coverage where the drawing is bright');
  report.check('the drawing under the ink is kept - blurred - and the casing sits between it and the white',
    (() => {
      if (!ink) return false;
      const order = merged(ink);
      const blur = ink.querySelector('feGaussianBlur');
      // the service's raster is two screen pixels per pixel: half a pixel of blur is what
      // takes the steps out of the boundary lines without a threshold cutting them away
      return !!blur && Number(blur.getAttribute('stdDeviation')) > 0 &&
        Number(blur.getAttribute('stdDeviation')) <= 2 * zoom &&
        order.length === 3 && order[0] === 'draw' && order[1] === 'casing' && order[2] === 'whiteink';
    })(),
    'blurred SourceGraphic, then the casing, then the white ink');
  // Round 31: the boundary layers draw dark names on a fat white halo. The halo is what
  // merged the letters into one white bar; painting it black makes it the casing of the
  // letters instead, and the letters themselves are the dark ink grown by a pixel.
  report.check('the names are the dark ink, and their white halo becomes their black casing',
    (() => {
      if (!namesInk) return false;
      const dark = [...namesInk.querySelectorAll('feComponentTransfer')]
        .find(t => t.getAttribute('result') === 'darkbin');
      const notLabels = [...namesInk.querySelectorAll('feComponentTransfer')]
        .find(t => t.getAttribute('result') === 'notlabels');
      const label = [...namesInk.querySelectorAll('feComposite')]
        .find(c => c.getAttribute('result') === 'labels');
      const halo = [...namesInk.querySelectorAll('feComposite')]
        .find(c => c.getAttribute('result') === 'halo');
      const areas = [...namesInk.querySelectorAll('feComposite')]
        .find(c => c.getAttribute('result') === 'areas');
      const order = merged(namesInk);
      return !!dark && !!notLabels && !!label && !!halo && !!areas &&
        label.getAttribute('operator') === 'in' && label.getAttribute('in2') === 'fat' &&
        halo.getAttribute('operator') === 'in' && halo.getAttribute('in') === 'cov' &&
        areas.getAttribute('operator') === 'out' && areas.getAttribute('in2') === 'cov' &&
        order.includes('halo') && order[order.length - 1] === 'whiteink' &&
        order.indexOf('halo') > order.indexOf('casing');
    })(),
    'letters from the dark key grown by one pixel, halo = coverage minus letters, drawn black');
  report.check('both masks end in solid white with one drawing pixel of black casing under them',
    !!ink && !!namesInk &&
    [ink, namesInk].every(filter =>
      filter.querySelector('feFlood[flood-color="#fff"]') !== null &&
      filter.querySelector('feFlood[flood-color="#000"]') !== null &&
      // the white is a flood masked by the mask itself: a letter is 255 white from edge to
      // edge, not the grey ramp of a blurred threshold
      [...filter.querySelectorAll('feComposite')]
        .some(c => c.getAttribute('in') === 'white' && c.getAttribute('operator') === 'in')) &&
    [ink, namesInk].every(filter => merged(filter).includes('casing')),
    'a white flood masked by the mask, and the casing grown from the same mask');
  const group = ['Geoportal - podział adm', 'Geoportal - Miasta', 'Geoportal - gminy',
    'Geoportal - powiaty', 'Geoportal - województwa', 'Geoportal - Granica PL'];
  report.check('every drawing of the administrative group is white ink, drawn twice the size in one image per window',
    group.every(name => LAYERS[name].contrast === 'white' || LAYERS[name].contrast === 'names') &&
    group.every(name => registry[name].definition.options.magnify === env.internals.LABEL_MAGNIFY &&
      registry[name].definition.options.tileSize === env.internals.LABEL_CELL) &&
    env.internals.LABEL_CELL === 2048 &&
    names.filter(name => registry[name].definition.options.magnify !== undefined).length === 6,
    `${group.length} layers at magnify ${env.internals.LABEL_MAGNIFY}, cell ${env.internals.LABEL_CELL} px`);
  const verbatim = ['Geoportal - adresy', 'Geoportal - ulice', 'Geoportal - place',
    'Geoportal - adresy, place i ulice w jednym', 'Geoportal - obiekty topograficzne',
    'Geoportal - przejazdy kolejowe (wymagany duży zoom)'];
  report.check('every other drawing that carries a number, a name or a surface is shown exactly as the service draws it',
    verbatim.every(name => LAYERS[name].contrast === false) &&
    verbatim.every(name => !(registry[name].instance?.div?.style?.filter)) &&
    names.filter(name => registry[name].definition.options.magnify !== undefined)
      .every(name => group.includes(name)),
    `${verbatim.length} layers with no filter and no magnified request`);
  report.check('only the drawings whose colour is the map itself keep a white casing',
    LAYERS['Geoportal - drogi'].contrast === 'dark' &&
    Object.entries(LAYERS).filter(([, entry]) => entry.contrast === 'colour').length === 8 &&
    filters.dark.includes('#fff') && filters.colour.includes('#fff'),
    'the road classes and the BDOT surfaces');

  // Of the two treatments left, one raises the service's own colours (the roads and
  // the BDOT surfaces) and one adds a casing without touching them (the boundaries).
  // Neither may end up dimmer than the ink of 1.6.0, which used 1.7 with a halo.
  const lifts = ['dark', 'colour'].map(kind => Number(filters[kind].match(/brightness\(([\d.]+)\)/)[1]));
  report.check('the drawings that keep their colour are lifted as much as in 1.6.0',
    Math.min(...lifts) >= 1.7,
    `lifts ${lifts.join(' and ')}`);

  // Opacity: a layer without a slider always draws at full opacity, whatever an
  // older version left in the settings.
  const opacityStale = await boot({
    enabled: 'all',
    settings: { layerOpacity: Object.fromEntries(LAYER_ORDER.map(name => [name, 0.25])) }
  });
  const dimmed = LAYER_ORDER.filter(name => {
    const entry = opacityStale.registry[name];
    return !entry.hasOpacity && entry.instance && entry.instance.opacity !== 1;
  });
  report.check('a slider-less layer cannot be dimmed by a stale saved opacity',
    dimmed.length === 0, dimmed.join(', ') || 'all pinned to 1.0');
  const allowed = ['Geoportal - ortofoto', 'Geoportal - ortofoto high res', 'Geoportal - OSM'];
  const withSliders = LAYER_ORDER.filter(name => opacityStale.registry[name].hasOpacity);
  report.check('opacity sliders exist only for the three layers that cover the view',
    withSliders.length === allowed.length && allowed.every(name => withSliders.includes(name)),
    withSliders.map(name => name.replace('Geoportal - ', '')).join(', '));
  opacityStale.close();

  // Zoom gates: a layer is shown from its own first zoom and hidden below it.
  const gates = [...new Set(LAYER_ORDER.map(name => LAYERS[name].minZ))].filter(minZ => minZ > 0).sort((a, b) => a - b);
  for (const gate of gates) {
    await env.setZoom(gate - 1);
    const early = LAYER_ORDER.filter(name => LAYERS[name].minZ === gate)
      .filter(name => env.registry[name].instance?.getVisibility() !== false);
    await env.setZoom(gate);
    const late = LAYER_ORDER.filter(name => LAYERS[name].minZ === gate)
      .filter(name => env.registry[name].instance?.getVisibility() !== true);
    report.check(`the layers from zoom ${gate} are hidden at ${gate - 1} and shown at ${gate}`,
      early.length === 0 && late.length === 0,
      (early.concat(late).map(name => name.replace('Geoportal - ', '')).join(', ')) ||
      `${LAYER_ORDER.filter(name => LAYERS[name].minZ === gate).length} layers`);
  }
  await env.setZoom(18);

  // z-index: the enabled layers are stacked upwards from 2040, in list order.
  env.integration.fixZIndex();
  const stacked = LAYER_ORDER
    .filter(name => env.registry[name].instance && env.registry[name].isEnabled)
    .map(name => ({ name, z: Number(env.registry[name].instance.getZIndex()) }));
  report.check('the layers are stacked upwards from z-index 2040, in list order',
    stacked.length > 0 &&
    stacked.every((entry, index, all) => index === 0
      ? entry.z === env.internals.Z_INDEX_BASE
      : entry.z === all[index - 1].z + 1),
    stacked.slice(0, 3).map(entry => `${entry.name.replace('Geoportal - ', '')}=${entry.z}`).join(', ') +
    ` … ${stacked.length} layers`);

  // Nothing is built for a layer the user has not switched on.
  const idle = await boot({ enabled: [] });
  const builtWhileOff = LAYER_ORDER.filter(name => idle.registry[name].instance);
  report.check('a layer that is switched off is not created',
    builtWhileOff.length === 0, builtWhileOff.join(', ') || 'none of ' + LAYER_ORDER.length);
  idle.registry['Geoportal - przejazdy kolejowe (wymagany duży zoom)'].setVisibility(true);
  report.check('switching a layer on creates it (and switching it off hides it)',
    Boolean(idle.registry['Geoportal - przejazdy kolejowe (wymagany duży zoom)'].instance) &&
    idle.registry['Geoportal - przejazdy kolejowe (wymagany duży zoom)'].instance.getVisibility() === true,
    String(idle.registry['Geoportal - przejazdy kolejowe (wymagany duży zoom)'].instance?.getVisibility()));
  idle.close();

  // The OSM base map is rank-gated: a level-1 editor gets it, a fresh account does not.
  const basic = await boot({ enabled: 'all', rank: 0 });
  report.check('the OSM base map is only offered to editors who may use it',
    !basic.registry['Geoportal - OSM'] && Object.keys(basic.registry).length === LAYER_ORDER.length - 1,
    `${Object.keys(basic.registry).length} layers at rank 0`);
  report.check('the rest of the list does not depend on the rank',
    LAYER_ORDER.filter(name => name !== 'Geoportal - OSM')
      .every(name => Boolean(basic.registry[name])),
    'all others present at rank 0');
  basic.close();

  report.check('a full boot produced no uncaught error',
    env.recorded.uncaught.length === 0, env.recorded.uncaught.join(' | ') || 'none');
  report.check('no layer points at a service that is not one of the Geoportal addresses',
    LAYER_ORDER.every(name => Object.values(SERVICES).some(service => env.registry[name].definition.url.includes(service))),
    [...new Set(LAYER_ORDER.map(name => new URL(env.registry[name].definition.url).host))].join(', '));

  env.close();
};
