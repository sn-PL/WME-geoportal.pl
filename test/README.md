# Tests

The script is tested the way it runs: a real editor page (jsdom) with the **real
OpenLayers 2.13.1** on a real map, the **WME SDK mocked** the way a session uses
it, and the script under test loaded into that page. Every layer the script
builds is then asked what it actually requests, how it draws, and what it does
when a service refuses an image.

```bash
cd test
npm install        # jsdom, typescript, and the OpenLayers 2.13.1 sources (~2.9 MB, into .cache/)
npm test           # ~35 s, 236 checks
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
| `layers` | one row per layer: service, `LAYERS`, format, `minZ`, request system, single-tile/ratio, slider, halo filter; the categories; the zoom gates; z-index stacking; the rank gate of the OSM layer; nothing is built for a layer that is off |
| `requests` | the parameters of every request (WMS 1.3.0, `STYLES`, `TRANSPARENT`, `EXCEPTIONS=XML`, no `INIMAGE` anywhere), the axis order of a 4326 BBOX, the 2180 BBOX read back to WGS84 and compared with the area it draws, the size of each kind of request, and that the crossing at Imbramowice is inside the tile asked for |
| `tiles` | the ortho and OSM layers: the WMTS tile indices are the editor's own `z/x/y`, the image is drawn in the cell its indices name, above level 19 the level-19 tile is stretched, and one refused tile is one hole |
| `recovery` | a refused image does not wipe the image already on screen, the retry comes ~1 s later under a fresh address and goes out once, a delivered retry releases the kept image, an image kept outside the layer's element is taken off the map when the layer is hidden, a tile layer keeps its other cells |
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
