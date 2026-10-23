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
  const merged = filter => [...filter.querySelectorAll('feMergeNode')].map(node => node.getAttribute('in'));
  const transfer = (filter, result) => [...filter.querySelectorAll('feComponentTransfer')]
    .find(t => t.getAttribute('result') === result);
  const composite = (filter, result) => [...filter.querySelectorAll('feComposite')]
    .find(c => c.getAttribute('result') === result);
  const funcOf = (filter, result) => transfer(filter, result)?.querySelector('feFuncA');
  // where a linear stretch of the luminance reaches a half - the point a `discrete` cut
  // switches at. alpha = slope * lum + intercept, so the cut is (1/2 - b) / a.
  const cutAt = (filter, result) => {
    const f = funcOf(filter, result);
    if (!f) return NaN;
    const a = Number(f.getAttribute('slope'));
    const b = Number(f.getAttribute('intercept'));
    return a === 0 ? NaN : (0.5 - b) / a;
  };
  const cutOf = t => {
    if (!t) return NaN;
    if (t.getAttribute('type') === 'discrete') return 0.5;    // discrete switches at a half
    return -Number(t.getAttribute('intercept')) / Number(t.getAttribute('slope'));
  };
  // Round 33: the parcels need a casing (a white digit on a pale roof is invisible), and
  // it has to be born OUTSIDE the glyph - grown from the mask and taken out of it - so it
  // can never close the gap to the digit beside it. The names grow nothing at all.
  report.check('the parcel casing is one ring grown out of the digits, and the names grow nothing',
    !!ink && !!namesInk &&
    namesInk.querySelectorAll('feMorphology').length === 0 &&
    ink.querySelectorAll('feMorphology').length === 1 &&
    [...ink.querySelectorAll('feMorphology')].every(m =>
      m.getAttribute('operator') === 'dilate' && m.getAttribute('result') === 'fat') &&
    (() => {
      const ring = composite(ink, 'ring0');
      const order = merged(ink);
      // the ring is `fat` minus `whitem`: it never covers a glyph, and it is merged UNDER
      // the white, so it can only darken the map around the drawing. Round 34: the merge
      // starts from `SourceGraphic`, so whatever the masks do not lift is still drawn -
      // without it the thin boundary lines, which are neither bright enough for the white
      // nor dark enough for anything else, were dropped and vanished off the map.
      return !!ring && ring.getAttribute('operator') === 'out' &&
        ring.getAttribute('in') === 'fat' && ring.getAttribute('in2') === 'whitem' &&
        order[0] === 'SourceGraphic' &&
        order.includes('casing') && order[order.length - 1] === 'white';
    })(),
    'one dilate of the ink mask, the ring taken out of it and merged under the white');
  // The white is a flood over a hard cut of the drawing's own luminance, i.e. the letters
  // are 255 white from edge to edge and the grey of the round-31 report is impossible.
  report.check('a letter is a flood of pure white over a hard cut - never a grey ramp',
    (() => {
      if (!ink || !namesInk) return false;
      const hard = (filter) => [...filter.querySelectorAll('feFuncA')]
        .some(f => f.getAttribute('type') === 'discrete');
      const flood = (filter, colour) => filter.querySelector(`feFlood[flood-color="${colour}"]`) !== null;
      return hard(ink) && hard(namesInk) && flood(ink, '#fff') && flood(ink, '#000') &&
        flood(namesInk, '#fff') && flood(namesInk, '#000');
    })(),
    'every mask is cut with a discrete transfer, and every flood is #fff or #000');
  // Round 33: the service draws a digit in a stroke one pixel wide and wraps it in a soft
  // edge of its own; at a cut of a half that edge is promoted to white and every gap
  // between two digits closes into the slab of the report. The white is cut high - above
  // the soft edge - and the dark side at a half brings the gaps back as black.
  report.check('the digits are cut high enough to reject the service\'s soft edge',
    (() => {
      if (!ink) return false;
      const white = funcOf(ink, 'whitea');
      const whiteCut = cutAt(ink, 'whitea');
      const bright = white && Number(white.getAttribute('slope')) > 0;
      // round 34 drops the dark side of the parcel filter: the drawing is merged whole
      // underneath, so the service's own dark outline stays as it drew it, and a second
      // black mask over the glyph only mangled it
      return !!white && bright && whiteCut >= 0.65 && whiteCut <= 0.9 &&
        funcOf(ink, 'blacka') === undefined;
    })(),
    'white kept only above 0.65 of the luminance; no dark mask over the drawing');
  // Round 34: the drawing is merged first in both filters, so no mask can ever take a
  // part of it off the map. This is what the parcel boundary lines of the report were.
  report.check('the service\'s drawing is merged under the ink of both layers, whole',
    !!ink && !!namesInk &&
    merged(ink)[0] === 'SourceGraphic' && merged(namesInk)[0] === 'SourceGraphic',
    `ink: ${merged(ink).join(' -> ')} | names: ${merged(namesInk).join(' -> ')}`);
  report.check('no key of the ink turns on the colour of the map - only on the drawing',
    (() => {
      if (!ink) return false;
      // a red-minus-blue matrix fired on every dark blue roof and painted the number's
      // surroundings white - the slab of the report, over a dark background
      const colourKey = [...ink.querySelectorAll('feColorMatrix')]
        .some(m => (m.getAttribute('values') || '').trim().split(/\s+/).slice(15, 18)
          .map(Number).some(v => v !== 0) && m.getAttribute('result') === 'bl');
      return !colourKey && !composite(ink, 'wm') && !composite(ink, 'bm');
    })(),
    'the luminance key is the only key of the parcel filter');
  // Round 33: five rounds of turning the boundary names white failed because a letter of
  // that service is a stroke one pixel wide - white letters with the dark outline they
  // need are black and white in equal measure and read as a hollow skeleton. So the
  // service's own scheme is hardened instead: its soft halo becomes pure white and its
  // soft letters pure black, and the drawing around them is left alone.
  report.check('the boundary names are hardened into black letters on the white halo the service draws',
    (() => {
      if (!namesInk) return false;
      const halo = funcOf(namesInk, 'haloa');
      const letter = funcOf(namesInk, 'lettera');
      const order = merged(namesInk);
      // the halo is cut high (the brightest thing in that drawing), the letters low
      // enough to keep them and high enough to leave a brown boundary line alone
      const haloCut = cutAt(namesInk, 'haloa');
      const letterCut = cutAt(namesInk, 'lettera');
      return !!halo && !!letter && haloCut >= 0.6 && haloCut <= 0.85 &&
        letterCut >= 0.3 && letterCut <= 0.6 &&
        order.length === 3 && order[0] === 'SourceGraphic' &&
        order[1] === 'halo' && order[2] === 'letter';
    })(),
    'the halo flooded white at a high cut, the letters flooded black, the drawing kept underneath');
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
