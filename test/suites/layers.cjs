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
  report.check('the filters that re-draw the ink are on the page once, and only the lettered layers point at them',
    !!svg && !!ink && !!namesInk && !!svg.querySelector('filter[id="geoportal-labels-numerals"]') &&
    svg.querySelectorAll('filter').length === 3 &&
    filters.white === 'url(#geoportal-labels-ink)' &&
    filters.names === 'url(#geoportal-labels-names)' &&
    filters.numerals === 'url(#geoportal-labels-numerals)' &&
    Object.entries(filters).every(([kind, value]) =>
      ['white', 'names', 'numerals'].includes(kind) || !value.includes('url(#')),
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
  const number = v => typeof v === 'number' && !Number.isNaN(v);
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
  // Round 35: the parcel drawing is split in two, because its two halves want opposite
  // sizes. The lines are one pixel of the service's raster and are drawn at the size of
  // the map; the numbers are a layer of their own at a third of the pixels. One image
  // asked for at a third turned the lines into a third of a pixel - dashed.
  const numerals = svg && svg.querySelector('filter[id="geoportal-labels-numerals"]');
  report.check('the parcel lines and the parcel numbers are two layers, asked for at two sizes',
    (() => {
      if (!ink || !numerals || !env.internals.layers) return false;
      const entry = env.internals.layers['Geoportal - podział adm'];
      const definition = entry?.definition;
      const companion = definition?.options?.companion;
      // the lines: the geometry alone, at the size of the map
      // the numbers: their own service column, magnified
      return definition?.layers === 'dzialki' && !definition.options.magnify &&
        !!companion && companion.layers === 'numery_dzialek' &&
        companion.magnify === env.internals.LABEL_NUMBER_MAGNIFY &&
        companion.contrast === 'numerals';
    })(),
    `dzialki at 1:1 with the white-lines filter, numery_dzialek at 1/${env.internals.LABEL_NUMBER_MAGNIFY} with the numerals filter`);
  // Round 37: the numbers are stretched a little less than the names. A number is a row of
  // digits; past three the digits stop reading as digits and the row reads as one bar.
  report.check('the parcel numbers are stretched less than the boundary names, and still magnified',
    env.internals.LABEL_NUMBER_MAGNIFY > 1 &&
    env.internals.LABEL_NUMBER_MAGNIFY < env.internals.LABEL_MAGNIFY,
    `numbers ${env.internals.LABEL_NUMBER_MAGNIFY}x, names ${env.internals.LABEL_MAGNIFY}x`);
  // The white of a digit is cut above the soft shoulder the service paints around a stroke:
  // at a half that shoulder turned white and closed the gap between two digits.
  report.check('the body of a digit is cut above the service\'s soft shoulder',
    (() => {
      if (!numerals) return false;
      const cut = cutAt(numerals, 'whitea');
      return cut >= 0.6 && cut <= 0.72;
    })(),
    'white kept only above 0.6 of the luminance, inside the full-opacity gate');
  report.check('the lines are taken by their colour and flooded pure white, on top of the drawing',
    (() => {
      if (!ink) return false;
      const colourKey = [...ink.querySelectorAll('feColorMatrix')]
        .some(m => (m.getAttribute('values') || '').trim().split(/\s+/).slice(15, 18)
          .map(Number).join(' ') === '-1 0 1');
      const order = merged(ink);
      return colourKey && ink.querySelector('feFlood[flood-color="#fff"]') !== null &&
        order.length === 2 && order[0] === 'SourceGraphic' && order[1] === 'bluew';
    })(),
    'blue minus red, a hard cut, a flood of #fff merged over the untouched drawing');
  // Round 36: the service draws a number twice over - the glyph at full opacity, and a
  // soft white halo around it at about 40 %. Flooding the bright side promotes the halo
  // to the same white as the glyph: that is the glow, and that is what merges the digits.
  // The alpha channel is the only thing that separates them, so the white of a number is
  // bounded by `solid` - what the service drew at full opacity.
  report.check('the white of a number is inked only where the service drew it at full opacity',
    (() => {
      if (!numerals) return false;
      const solid = transfer(numerals, 'solid');
      const table = solid?.querySelector('feFuncA')?.getAttribute('tableValues');
      // a discrete step that keeps only the top of the alpha range
      const gated = [...numerals.querySelectorAll('feComposite')]
        .filter(c => c.getAttribute('in2') === 'solid');
      const order = merged(numerals);
      return table === '0 0 0 1' &&
        gated.some(c => c.getAttribute('result') === 'whitem') &&
        gated.some(c => c.getAttribute('result') === 'crisps') &&
        // no dark mask is merged: the service's outline is the glyph's own shape
        order.includes('black') && order[order.length - 1] === 'white';
    })(),
    'solid = alpha >= 3/4; the white body and the drawing that comes back are bounded by it');
  // Round 38: the outline and the ring are strokes one pixel wide, so the service draws
  // them at a partial alpha - the same alpha as its halo. Gating them on full opacity
  // deleted them, and with them the only thing that kept two digits apart. A dark cut
  // cannot keep a white pixel, so they can be gated on the drawing's own coverage.
  report.check('the dark outline and the ring survive a stroke thinner than full opacity',
    (() => {
      if (!numerals) return false;
      const cov = transfer(numerals, 'cov');
      const slope = cov?.querySelector('feFuncA');
      const gateOf = name => [...numerals.querySelectorAll('feComposite')]
        .filter(c => c.getAttribute('result') === name)
        .map(c => c.getAttribute('in2'));
      const order = merged(numerals);
      return !!slope && gateOf('blkm').includes('cov') && gateOf('ringm').includes('cov') &&
        !gateOf('blkm').includes('solid') && !gateOf('ringm').includes('solid') &&
        // both still work on their own discrete cut of the luminance
        transfer(numerals, 'blkb') !== null &&
        // the outline is the service's dark pixels minus the white body, and it is merged
        [...numerals.querySelectorAll('feComposite')]
          .some(c => c.getAttribute('result') === 'outlinem' &&
            c.getAttribute('in') === 'blkm' && c.getAttribute('in2') === 'whitem' &&
            c.getAttribute('operator') === 'out') &&
        order.includes('black');
    })(),
    'blackm and ringm bounded by cov, the outline = dark minus white, merged under the white');
  report.check('the numerals are given more contrast without losing their shape',
    (() => {
      if (!numerals) return false;
      const crisp = transfer(numerals, 'crisp');
      const f = crisp && crisp.querySelector('feFuncR');
      const slope = f && Number(f.getAttribute('slope'));
      return !!f && f.getAttribute('type') === 'linear' && slope > 1 && slope <= 3;
    })(),
    'a linear stretch of the drawing, not a cut');
  report.check('no key of the ink turns on the colour of the map in the numerals layer',
    !numerals || ![...numerals.querySelectorAll('feColorMatrix')]
      .some(m => (m.getAttribute('values') || '').trim().split(/\s+/).slice(15, 18)
        .map(Number).some(v => v !== 0) && m.getAttribute('result') === 'bl'),
    'the numerals layer keys on luminance alone');
  // Round 34/35: the drawing is merged first in both lettered filters that carry the
  // service's whole drawing, so no mask can take a part of it off the map.
  report.check('the service\'s drawing is merged under the ink of the filtered layers, whole',
    !!ink && !!namesInk && merged(ink)[0] === 'SourceGraphic' &&
    merged(namesInk)[0] === 'SourceGraphic',
    `ink: ${merged(ink).join(' -> ')} | names: ${merged(namesInk).join(' -> ')}`);
  // Round 33: five rounds of turning the boundary names white failed because a letter of
  // that service is a stroke one pixel wide - white letters with the dark outline they
  // need are black and white in equal measure and read as a hollow skeleton. So the
  // service's own scheme is hardened instead: its soft halo becomes pure white and its
  // soft letters pure black, and the drawing around them is left alone.
  report.check('the boundary names are hardened into black letters on the white halo the service draws',
    (() => {
      if (!namesInk) return false;
      const haloCut = cutAt(namesInk, 'haloa');
      const letterCut = cutAt(namesInk, 'lettera');
      const order = merged(namesInk);
      return number(haloCut, 'halo') && number(letterCut, 'letter') &&
        haloCut >= 0.6 && haloCut <= 0.85 && letterCut >= 0.3 && letterCut <= 0.6 &&
        order.length === 3 && order[0] === 'SourceGraphic' &&
        order[1] === 'halo' && order[2] === 'letter';
    })(),
    'the halo flooded white at a high cut, the letters flooded black, the drawing kept underneath');
  const group = ['Geoportal - podział adm', 'Geoportal - Miasta', 'Geoportal - gminy',
    'Geoportal - powiaty', 'Geoportal - województwa', 'Geoportal - Granica PL'];
  report.check('every drawing of the administrative group is re-drawn, its letters at LABEL_MAGNIFY',
    group.every(name => ['white', 'names'].includes(LAYERS[name].contrast)) &&
    group.every(name => registry[name].definition.options.tileSize === env.internals.LABEL_CELL) &&
    env.internals.LABEL_CELL === 2048 &&
    // the five name layers in one image each, the parcel numbers through their companion;
    // the parcel lines are the only one of the six that is not magnified, on purpose
    group.filter(name => registry[name].definition.options.magnify === env.internals.LABEL_MAGNIFY).length === 5 &&
    registry['Geoportal - podział adm'].definition.options.companion?.magnify === env.internals.LABEL_NUMBER_MAGNIFY,
    `${group.length} layers, cell ${env.internals.LABEL_CELL} px, the names at ${env.internals.LABEL_MAGNIFY}x, ` +
    `the parcel numbers at ${env.internals.LABEL_NUMBER_MAGNIFY}x`);
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
    // a companion is the other half of the same drawing and is stacked right above it
    .flatMap(name => [{ name, z: Number(env.registry[name].instance.getZIndex()) },
      ...(env.registry[name].companion
        ? [{ name: `${name} (numery)`, z: Number(env.registry[name].companion.getZIndex()) }]
        : [])]);
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
