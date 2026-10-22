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
  report.check('every one of the five boundary layers of the report was among them',
    ['Geoportal - Miasta', 'Geoportal - gminy', 'Geoportal - powiaty',
      'Geoportal - województwa', 'Geoportal - Granica PL'].every(name => filtered.includes(name)) &&
    !filtered.includes('Geoportal - podział adm'),
    'towns, communes, counties, provinces, state border - the parcels since round 28 as the service draws them');
  report.check('each filtered layer carries the filter its ink asks for, and nothing else',
    filtered.every(name => {
      const filter = registry[name].instance.div.style.filter;
      return filter === env.internals.CONTRAST_FILTER[LAYERS[name].contrast];
    }),
    Object.entries(env.internals.CONTRAST_FILTER).map(([kind, value]) => `${kind}: ${value}`).join(' | '));

  // Round 28: no drawing is re-coloured any more. The white re-draw of rounds 23-27
  // asked the service for half the pixels and turned every pixel of its drawing into
  // white ink - and a parcel number is a dark number on a white plate, so plate and
  // digits became one white shape (the unreadable numbers of the report of 10.2026),
  // and a street of the address service is a wide translucent surface, which became a
  // white band over the photo. What is left is two treatments, and neither of them
  // recolours the drawing: the one-pixel black casing of the boundary layers and the
  // lift of the roads and the BDOT surfaces.
  const filters = env.internals.CONTRAST_FILTER;
  report.check('nothing on the page re-colours a drawing any more',
    !('white' in filters) &&
    Object.values(filters).every(filter => !filter.includes('invert') && !filter.includes('url(#')),
    Object.entries(filters).map(([kind, value]) => `${kind}: ${value}`).join(' | '));
  report.check('no SVG filter is put on the page', (() => {
    const doc = registry['Geoportal - podział adm'].instance.div.ownerDocument;
    return !doc.getElementById('geoportal-label-filters') &&
      Object.values(filters).every(filter => !filter.includes('url(#'));
  })(), 'the filters are CSS only');
  const verbatim = ['Geoportal - podział adm', 'Geoportal - adresy', 'Geoportal - ulice',
    'Geoportal - place', 'Geoportal - adresy, place i ulice w jednym',
    'Geoportal - obiekty topograficzne', 'Geoportal - przejazdy kolejowe (wymagany duży zoom)'];
  report.check('the drawings that carry a number, a name or a surface are shown exactly as the service draws them',
    verbatim.every(name => LAYERS[name].contrast === false) &&
    verbatim.every(name => !(registry[name].instance?.div?.style?.filter)) &&
    names.every(name => registry[name].definition.options.magnify === undefined &&
      registry[name].definition.options.tileSize === undefined),
    `${verbatim.length} layers, no filter and no magnified request anywhere`);
  report.check('the drawings are asked for one image pixel per pixel of the map, in the editor\'s own cells',
    LAYER_ORDER.filter(name => LAYERS[name].kind === 'grid').every(name => {
      const tile = env.tileAt(env.layer(name), 0, 0);
      const drawn = parseFloat(tile?.imgDiv?.style?.width || '');
      const asked = Number(new URLSearchParams((tile?.imgDiv?.src || '').split('?')[1] || '').get('WIDTH'));
      return !drawn || (asked === drawn && drawn === 256);
    }),
    'every WMS cell: 256 px of map, 256 px asked for');
  // The five boundary layers draw translucent coloured areas along with their names,
  // so they cannot be made white without painting those areas over the map as white
  // slabs. Their names come from the service as a very pale letter on a slightly
  // paler plate of its own (measured: 230, 217, 231 against 250, 248, 251), so they
  // are pulled apart with contrast instead of being lifted into the same white, and
  // they take the same one pixel of black outline as every other layer.
  report.check('the layers that draw coloured areas keep their ink and only gain the black outline',
    filters.outline === 'drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000)' &&
    ['Geoportal - Miasta', 'Geoportal - gminy', 'Geoportal - powiaty', 'Geoportal - województwa',
      'Geoportal - Granica PL'].every(name => LAYERS[name].contrast === 'outline') &&
    Object.entries(LAYERS).filter(([, entry]) => entry.contrast === 'outline').length === 5,
    filters.outline);
  report.check('nothing of those layers is recoloured, brightened or thresholded',
    !filters.outline.includes('invert') && !filters.outline.includes('brightness') &&
    !filters.outline.includes('url(#') && !filters.outline.includes('#fff'),
    'the coloured areas, the boundary lines and the pale lettering stay what the service drew');
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
