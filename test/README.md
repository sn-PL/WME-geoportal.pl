# Tests

The script is tested the way it runs: a real editor page (jsdom) with the **real
OpenLayers 2.13.1** on a real map, the **WME SDK mocked** the way a session uses
it, and the script under test loaded into that page. Every layer the script
builds is then asked what it actually requests, how it draws, and what it does
when a service refuses an image.

```bash
cd test
npm install        # jsdom, typescript, and the OpenLayers 2.13.1 sources (~2.9 MB, into .cache/)
npm test           # ~40 s, 280 checks
TILE_MANAGER=0 npm test       # the same checks on a map without OpenLayers' tile manager
node run.cjs requests tiles   # only some suites
TEST_VERBOSE=1 npm test       # let the page's console through
npm run check-types           # only the SDK type check
```

Nothing here is published: `test/` is not part of the userscript. The OpenLayers
sources are downloaded from the pinned tag `release-2.13.1` (SHA-256 checked) and
merged the way the release's own `mergejs.py` does; `npm run refresh-openlayers`
does it again. Everything built on the way (`.cache/`) is ignored by git: the
tests build their fixtures from the repository's own pinned files.

## What the suites cover

| Suite | What it checks |
| --- | --- |
| `source` | the file compiles, the userscript header is complete, the version in the header, in `SCRIPT_VERSION` and in the README agree, the script only names the Geoportal/greasyfork/WME hosts, no top-level constant is defined twice |
| `types` | the script type-checks against the pinned WME SDK typings (`wme-sdk-typings.tgz`, version checked against the script's own `SDK_BASELINE`); the check itself is checked by breaking a copy of the script on purpose |
| `startup` | the SDK handshake (async mode, id, name), the events it subscribes to, the map events it hooks as a fallback, waiting for `wme-ready`, a missing SDK method stopping with a message, a page without the layer card |
| `layers` | one row per layer: service, `LAYERS`, format, `minZ`, request system, single-tile/ratio, slider, the filter its ink asks for, the magnification of its drawing; which layers are re-drawn (the one filter element on the page, the alpha threshold, the one-pixel casing) and which are only lifted; which layers ask for a magnified drawing, which ask for one image of the view rather than cells (a service places every label inside the image it is asked for) and which must keep cells; the categories; the zoom gates; z-index stacking; the rank gate of the OSM layer; nothing is built for a layer that is off |
| `requests` | the parameters of every request (WMS 1.3.0, `STYLES`, `TRANSPARENT`, `EXCEPTIONS=XML`, no `INIMAGE` anywhere), the axis order of a 4326 BBOX, the 2180 BBOX read back to WGS84 and compared with the area it draws, the size of each kind of request - a layer with text to read asks for the same area at 1/magnify of the pixels, so the drawing is that many times larger on the screen, and it is drawn in cells of 1024 px, of which a window is built from a few instead of dozens - and that the crossing at Imbramowice is inside the tile asked for |
| `tiles` | the ortho and OSM layers: the WMTS tile indices are the editor's own `z/x/y`, the image is drawn in the cell its indices name, above level 19 the level-19 tile is stretched, and one refused tile is one hole |
| `recovery` | the picture of a view belongs to that view and to no other: a pan asks for the new view and lets the old picture go at the request (a refused view does not bring it back), a zoom carries none of it over, a refused image is asked for again ~1 s later under a fresh address and the retry goes out once; a layer of cells asks for nothing inside the margin of its cells and only for the strip a pan past it uncovers, a refused cell is one hole, and the cells of the previous view are not carried over a zoom |
| `menu` | the group and its categories, the switch of every layer, which layers have an opacity slider and which must not, no instruction text, a collapsed category, the controls coming back after WME replaces the card, the native-checkbox fallback |
| `settings` | a first visit, saved layers/opacities/collapsed categories, unknown layer names, unreadable JSON, and that a slider-less layer is never dimmed by a value an older version saved |
| `coordinates` | EPSG:2180 against PROJ 9.5.1 (to the millimetre, at ten points across the country) and the inverse across a grid over Poland, the `requestImageSize` cap, and the zoom level derived from a request |

The type check needs the SDK typings, which the repository pins as
`wme-sdk-typings.tgz` - the file the script's `SDK_BASELINE` names. `npm test`
extracts the one `.d.ts` it needs into `.cache/`, drops the single line that
imports a WME-internal path (which exists only inside the editor), and runs `tsc`
over the userscript with `checkJs`.

Checks that a suite cannot make offline live in `test/live/`:

```bash
node test/live/probe-services.cjs            # asks the real services for the script's own requests
node test/live/probe-services.cjs --only=drogi --strict
```

It prints what came back for one request per layer (image size, or the document a
refused request is answered with). A refusal is normal - these services shed
bursts - which is why the run only fails with `--strict`.

`test/tools/filter-preview.mjs` writes (and can serve) a page that shows each layer
three times - as the service sends it, with the filter the script puts on the layer,
and with that filter plus the magnification (the request at 1/m of the pixels,
stretched over the same cell) - over the ortho tile of the same cell, with the
filter's numbers and the magnification as live controls, so the readability of the
thin-stroke layers and of the labels drawn into them can be judged and tuned in a
browser:

```bash
node tools/filter-preview.mjs            # writes .cache/filter-preview.html
node tools/filter-preview.mjs --serve    # ...and serves it on :8012
```

## The harness

`lib/harness.cjs` builds a page and returns the environment: the jsdom window, the
OpenLayers map, the mock SDK (with `fire()` to send `wme-*` events), the script's
layer registry, and helpers to drive what a browser does with an image:

```js
const { boot } = require('../lib/harness.cjs');
const env = await boot({ view: { w: 800, h: 600 }, zoom: 18, enabled: 'all' });
await env.drawAll();                       // every visible layer has asked for its tiles
const layer = env.layer('Geoportal - drogi');
env.deliver(env.tileAt(layer, 0, 0));      // the browser shows the image
env.giveUp(env.tileAt(layer, 0, 0));       // the browser refuses it twice -> OpenLayers gives up
env.requestOf(layer);                      // the address it is asking for
```

Images never load in jsdom, which is the point: a test decides what the browser
did with each image, so a run says what a WME session would show for that
combination.

**The page sees the script's own objects.** `geoportal.user.js` publishes the
integration it creates on `window.__geoportalPl` (with its constants and
transformations under `.internals`); the harness reads the layer registry from
there, and the editor's console can too. Nothing in the script reads it back -
deleting that one assignment would break nothing in the editor.

The reference values the requests are checked against were computed with PROJ
9.5.1 (`pyproj`) and are kept in `lib/fixtures.cjs`; `lib/epsg2180.cjs` is this
repository's own implementation of the same series, used in the inverse
direction, so a request is checked against a second opinion and not against
itself.

## Limits

- No logged-in WME session: the SDK is a mock of the documented interface, and
  the editor's own map is a plain OpenLayers map of the same OpenLayers version.
- jsdom has no layout and no canvas: the map gets its size from the harness, and
  the tile manager's delays are set to zero (the tiles still go through its
  queue).
- The services are not contacted by `npm test`; that is what `test/live/` is for.
