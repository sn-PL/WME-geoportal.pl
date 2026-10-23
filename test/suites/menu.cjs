'use strict';
/**
 * The script's part of the Layers menu: the group it adds, the categories, the
 * checkbox of each layer, which layers get an opacity slider and which must not,
 * and what happens when WME replaces the card the group lives in.
 *
 * These are the rounds 15-17 decisions, checked where they are visible: in the
 * menu the user sees.
 */
const { boot } = require('../lib/harness.cjs');
const { CATEGORIES, LAYERS, REMOVED_HINTS } = require('../lib/fixtures.cjs');

module.exports = async function menu(report) {
  report.suite('the Layers menu');

  const env = await boot({ enabled: [] });
  const { document } = env;
  const group = document.getElementById('geoportal-layers-group');

  report.check('the script adds its own group to the editor\'s layer list',
    Boolean(group) && group.parentNode === document.querySelector('.list-unstyled'),
    group ? `parent .${group.parentNode.className} of <${group.parentNode.tagName.toLowerCase()}>` : 'no group');

  const separator = group?.querySelector('.geoportal-separator');
  report.check('the group is announced as “-- Geoportal PL --”',
    Boolean(separator) && separator.textContent.includes('Geoportal PL'),
    separator ? separator.textContent.trim() : 'no separator');

  const categories = [...group.querySelectorAll('.geoportal-category')];
  report.check('every category is in the menu, in order, with its layers',
    categories.length === Object.keys(CATEGORIES).length &&
    categories.every((element, index) => {
      const name = element.querySelector('.geoportal-cat-header').textContent.trim();
      const expected = Object.keys(CATEGORIES)[index];
      if (name !== expected) return false;
      const items = [...element.querySelectorAll('.geoportal-layer-item')];
      return items.length === CATEGORIES[expected].length;
    }),
    categories.map(element => element.querySelector('.geoportal-cat-header').textContent.trim()).join(' | '));

  const itemNames = categories.map(element => [...element.querySelectorAll('.geoportal-layer-item')]
    .map(item => item.querySelector('wz-checkbox')?.textContent.trim()));
  const flatInMenu = itemNames.flat();
  report.check('every layer of the registry is a switch in the menu, under its own category',
    flatInMenu.length === env.names().length &&
    Object.entries(CATEGORIES).every(([category, names]) =>
      names.every(name => itemNames[Object.keys(CATEGORIES).indexOf(category)].includes(name))),
    `${flatInMenu.length} switches: ${flatInMenu.slice(0, 3).join(', ')} …`);

  // Rounds 15-17: no instruction sentences under the layer list, and the layers of
  // the topographic category and of BDOT have no opacity slider at all.
  const text = document.body.textContent;
  const foundHints = REMOVED_HINTS.filter(hint => text.includes(hint));
  report.check('the two instruction sentences are gone from the menu',
    foundHints.length === 0 && !/suwak/i.test(group.textContent),
    foundHints.length ? `still there: ${foundHints.join(' / ')}` : 'no hint text anywhere in the page');

  const sliderNames = [...group.querySelectorAll('.geoportal-layer-item')]
    .filter(item => item.querySelector('input[type="range"]'))
    .map(item => item.querySelector('wz-checkbox').textContent.trim());
  const expectedSliders = env.names().filter(name => LAYERS[name].hasOpacity);
  report.check('only the layers that cover the view have an opacity slider',
    sliderNames.length === expectedSliders.length &&
    expectedSliders.every(name => sliderNames.includes(name)),
    sliderNames.length ? sliderNames.map(name => name.replace('Geoportal - ', '')).join(', ') : 'no sliders');
  report.check('no layer of “Topografia / Inne” and no BDOT layer has a slider',
    ['Topografia / Inne', 'BDOT (Szczegółowa)'].every(category =>
      CATEGORIES[category].every(name => !sliderNames.includes(name))),
    `${CATEGORIES['Topografia / Inne'].length + CATEGORIES['BDOT (Szczegółowa)'].length} layers without one`);

  // The switch itself: WME's checkbox component, driving the layer.
  const railName = 'Geoportal - przejazdy kolejowe (wymagany duży zoom)';
  const railItem = [...group.querySelectorAll('.geoportal-layer-item')]
    .find(item => item.querySelector('wz-checkbox')?.textContent.trim() === railName);
  const railCheckbox = railItem.querySelector('wz-checkbox');
  const railRegistry = env.registry[railName];
  report.check('the switch is WME\'s own checkbox component when the page has it',
    railCheckbox.tagName.toLowerCase() === 'wz-checkbox',
    `<${railCheckbox.tagName.toLowerCase()}>`);
  report.check('a switch that is off matches the layer that is off',
    railCheckbox.checked === false && railRegistry.isEnabled === false && railRegistry.instance === null,
    `checked=${railCheckbox.checked}, layer enabled=${railRegistry.isEnabled}`);

  railCheckbox.checked = true;
  railCheckbox.dispatchEvent(new env.window.Event('change', { bubbles: true }));
  await env.sleep(30);
  report.check('switching the checkbox on enables the layer and builds it',
    railRegistry.isEnabled === true && railRegistry.instance !== null &&
    railRegistry.instance.getVisibility() === true,
    `instance: ${railRegistry.instance ? 'built' : 'missing'}`);

  await env.sleep(20);
  const saved = JSON.parse(env.window.localStorage.getItem('wme_geoportal_settings'));
  report.check('the choice is saved for the next visit',
    saved.enabledLayers[railName] === true,
    `saved ${Object.values(saved.enabledLayers).filter(Boolean).length} enabled layers`);

  railCheckbox.checked = false;
  railCheckbox.dispatchEvent(new env.window.Event('change', { bubbles: true }));
  await env.sleep(30);
  report.check('switching it off hides the layer again',
    railRegistry.isEnabled === false && railRegistry.instance.getVisibility() === false,
    `visibility=${railRegistry.instance.getVisibility()}`);

  // An opacity slider: it sets the layer's opacity and remembers it.
  const ortoName = 'Geoportal - ortofoto';
  const ortoRegistry = env.registry[ortoName];
  ortoRegistry.setVisibility(true);
  const ortoItem = [...group.querySelectorAll('.geoportal-layer-item')]
    .find(item => item.querySelector('wz-checkbox')?.textContent.trim() === ortoName);
  const slider = ortoItem.querySelector('input[type="range"]');
  slider.value = '40';
  slider.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  report.check('moving an opacity slider dims the layer and shows the new value',
    Math.abs(ortoRegistry.instance.opacity - 0.4) < 0.001 &&
    ortoItem.querySelector('.geoportal-opacity-value').textContent === '40%',
    `opacity ${ortoRegistry.instance.opacity}, label ${ortoItem.querySelector('.geoportal-opacity-value').textContent}`);

  // Collapsing a category is remembered.
  const topoHeader = categories.find(element =>
    element.querySelector('.geoportal-cat-header').textContent.trim() === 'Topografia / Inne')
    .querySelector('.geoportal-cat-header');
  topoHeader.dispatchEvent(new env.window.Event('click', { bubbles: true }));
  await env.sleep(20);
  const collapsedSaved = JSON.parse(env.window.localStorage.getItem('wme_geoportal_settings'));
  report.check('collapsing a category is kept for the next visit',
    collapsedSaved.collapsedCats['Topografia / Inne'] === true &&
    topoHeader.classList.contains('collapsed'),
    `saved collapsed: ${JSON.stringify(collapsedSaved.collapsedCats['Topografia / Inne'])}`);

  // WME replaces the whole layer card from time to time: the script watches for it
  // and puts the same controls back.
  const list = document.querySelector('.list-unstyled');
  group.remove();
  report.check('the group is gone after the editor replaces its list',
    !document.getElementById('geoportal-layers-group'));
  await env.sleep(400); // the observer coalesces and waits 100 ms
  const restored = document.getElementById('geoportal-layers-group');
  report.check('the script puts its controls back after the editor replaced them',
    Boolean(restored) && restored.parentNode === list,
    restored ? 'same group re-attached' : 'not restored');
  report.check('the restored group is the same group, with the same switches',
    restored === env.integration.uiGroup &&
    restored.querySelectorAll('wz-checkbox').length === env.names().length,
    `${restored ? restored.querySelectorAll('wz-checkbox').length : 0} switches`);

  // The stylesheet is added once, and it hides the elements of refused images.
  report.check('the stylesheet is in the page once and hides refused images',
    document.querySelectorAll('#geoportal-styles').length === 1 &&
    document.getElementById('geoportal-styles').textContent.includes('img.olImageLoadError'),
    `${document.querySelectorAll('#geoportal-styles').length} stylesheet element(s)`);

  env.close();

  // A page where WME's checkbox component never arrives: the script must not wait
  // forever, and the menu must still work.
  const plain = await boot({ enabled: [], wzCheckbox: false, whenDefinedRejects: true });
  await plain.waitFor(() => Boolean(plain.document.getElementById('geoportal-layers-group')), 3000);
  const fallbackGroup = plain.document.getElementById('geoportal-layers-group');
  const fallbackInputs = fallbackGroup ? fallbackGroup.querySelectorAll('input[type="checkbox"]') : [];
  report.check('without WME\'s checkbox component the menu falls back to native checkboxes',
    Boolean(fallbackGroup) && fallbackInputs.length === plain.names().length,
    `${fallbackInputs.length} native checkboxes for ${plain.names().length} layers`);
  if (fallbackInputs.length) {
    const input = fallbackInputs[0];
    const name = input.parentNode.textContent.trim();
    input.checked = true;
    input.dispatchEvent(new plain.window.Event('change', { bubbles: true }));
    await plain.sleep(30);
    report.check('a native checkbox enables its layer as well',
      plain.registry[name].isEnabled === true && plain.registry[name].instance !== null,
      `${name} enabled=${plain.registry[name].isEnabled}`);
  }
  report.check('the fallback page reported the missing component instead of failing silently',
    plain.recorded.warn.some(message => message.includes('checkbox component not found')),
    plain.recorded.warn.filter(message => message.includes('checkbox')).join(' | ') || 'no warning');
  plain.close();

  report.check('the menu run produced no uncaught error',
    env.recorded.uncaught.length === 0, env.recorded.uncaught.join(' | ') || 'none');
};
