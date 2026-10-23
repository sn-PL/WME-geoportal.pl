#!/usr/bin/env node
'use strict';
/**
 * Ask the parcel-number service for the SAME piece of ground at several pixel sizes,
 * and keep every picture. The question this answers is the one the editor cannot:
 *
 *   does the service draw a number bigger when it is asked for a bigger raster,
 *   or does it draw it at a size of its own whatever the raster?
 *
 * If the glyph grows with the raster, a layer can ask for twice the pixels of the
 * view and let the browser shrink them - a supersampled digit, sharp at any size.
 * If the glyph stays nine pixels, that route is closed: the only way to a bigger
 * digit is to stretch the raster, and stretching is what makes it soft.
 *
 *   node test/live/probe-raster.cjs [output-directory]
 *
 * The second question is the one that decides whether the numbers could be text
 * instead of a picture: the aggregated EGiB WFS serves the parcel polygons and
 * `NUMER_DZIALKI` as a string, but a page of the editor can only read an answer the
 * service allows it to read. The probe therefore asks the same WFS with an explicit
 * `Origin` header and with an OPTIONS preflight, and keeps the headers it answered.
 * No `Access-Control-Allow-Origin` means no text labels in a userscript, licence or
 * no licence: there is nothing to fix on our side.
 *
 * Writes one PNG (or the error document) per case plus `index.json` and `cors.txt`
 * with what came back. Needs the internet; it is not part of `npm test`.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.resolve(process.argv[2] || 'probe-out');
const SERVICE = 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow?';
// The vector half of the same data: parcels and their numbers as GML, no key needed.
const WFS_HOST = 'mapy.geoportal.gov.pl';
const WFS_PATH = '/wss/service/PZGIK/EGIB/WFS/UslugaZbiorcza?';
const TIMEOUT = 45000;

// Śródmieście in Warszawa: dense parcel numbers, and the parcel 146510_8.0306.9 that
// GetFeatureInfo names at the middle of the smallest window below.
const LON = 21.0;
const LAT = 52.235;

/** Web Mercator metres of a lon/lat, so the windows below can be built from metres. */
function mercator(lon, lat) {
  const r = 6378137;
  return {
    x: (lon * Math.PI * r) / 180,
    y: r * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
  };
}

const centre = mercator(LON, LAT);

/** A square window `metres` across, asked for at `px` pixels a side. */
function window(metres, px) {
  const half = metres / 2;
  return (
    `${SERVICE}SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap` +
    '&LAYERS=numery_dzialek&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE' +
    '&SRS=EPSG:3857' +
    `&BBOX=${centre.x - half},${centre.y - half},${centre.x + half},${centre.y + half}` +
    `&WIDTH=${px}&HEIGHT=${px}`
  );
}

/**
 * Same ground at four densities - the density is the only thing that changes, so any
 * change in the size of a digit is the service's answer to the question above.
 * Plus the same density over two sizes of ground, which is what a deeper zoom does.
 */
const CASES = [
  { name: 'same-ground-384', url: window(300, 384) },
  { name: 'same-ground-768', url: window(300, 768) },
  { name: 'same-ground-1440', url: window(300, 1440) },
  { name: 'same-ground-768-again', url: window(300, 768) },
  { name: 'twice-the-ground-768', url: window(600, 768) },
  { name: 'half-the-ground-768', url: window(150, 768) },
  // the parcel drawing under the numbers, for a picture that looks like the editor's
  { name: 'both-layers-768', url: window(300, 768).replace('LAYERS=numery_dzialek', 'LAYERS=dzialki,numery_dzialek') },
  { name: 'both-layers-1440', url: window(300, 1440).replace('LAYERS=numery_dzialek', 'LAYERS=dzialki,numery_dzialek') },
];

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    const body = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      bytes: body.length,
      body,
    };
  } catch (error) {
    return { status: 0, contentType: '', bytes: 0, body: Buffer.alloc(0), error: String(error.cause || error.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Headers of an answer to one request, as a small text block. */
function headerProbe(name, options, body) {
  return new Promise(resolve => {
    const request = https.request(options, response => {
      const headers = Object.entries(response.headers)
        .filter(([key]) => /^access-control-|^content-type$|^content-length$|^vary$/.test(key))
        .map(([key, value]) => `  ${key}: ${value}`);
      response.resume();
      response.on('end', () => resolve(
        `${name}: ${response.statusCode}\n${headers.join('\n') || '  (no access-control headers at all)'}`));
    });
    request.on('error', error => resolve(`${name}: ${error.message}`));
    request.setTimeout(TIMEOUT, () => { request.destroy(new Error('timeout')); });
    if (body) request.end(body); else request.end();
  });
}

function imageSize(buffer) {
  if (buffer.length > 24 && buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
    return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
  }
  return null;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const index = [];
  for (const testCase of CASES) {
    const result = await fetchOnce(testCase.url);
    const size = imageSize(result.body);
    const isPng = !!size;
    const file = `${testCase.name}.${isPng ? 'png' : 'txt'}`;
    fs.writeFileSync(path.join(OUT, file), result.body);
    const entry = {
      name: testCase.name,
      url: testCase.url,
      status: result.status,
      contentType: result.contentType,
      bytes: result.bytes,
      image: size,
      file,
      error: result.error || null,
      // a refused request comes back as a document, not a picture
      refused: !isPng || result.contentType.includes('xml') || result.contentType.includes('html'),
    };
    index.push(entry);
    console.log(`${entry.refused ? 'REFUSED' : 'ok     '} ${testCase.name} ` +
      `${result.status} ${result.contentType} ${result.bytes} B ${size ? `${size.w}x${size.h}` : ''}`);
    // the service is bursty; one request at a time with a pause
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

  // Whether a page of the editor may read the vector data at all: the same 300 m of
  // ground, asked of the WFS for one parcel, once with the editor's own Origin and
  // once as the browser's preflight would ask it.
  const half = 150;
  const wfsPath = WFS_PATH + [
    'SERVICE=WFS', 'VERSION=1.1.0', 'REQUEST=GetFeature', 'TYPENAME=dzialki',
    'SRSNAME=EPSG:3857',
    `BBOX=${centre.x - half},${centre.y - half},${centre.x + half},${centre.y + half},EPSG:3857`,
    'MAXFEATURES=1'
  ].join('&');
  const headers = [
    await headerProbe('GET with the editor as Origin', {
      host: WFS_HOST, path: wfsPath, method: 'GET',
      headers: { Origin: 'https://www.waze.com', Referer: 'https://www.waze.com/' }
    }),
    await headerProbe('OPTIONS preflight', {
      host: WFS_HOST, path: wfsPath, method: 'OPTIONS',
      headers: { Origin: 'https://www.waze.com', 'Access-Control-Request-Method': 'GET' }
    })
  ].join('\n\n');
  fs.writeFileSync(path.join(OUT, 'cors.txt'), `${headers}\n`);
  console.log(`\n${headers}`);
  const refused = index.filter(entry => entry.refused).length;
  console.log(`\n${index.length - refused} pictures, ${refused} refused, into ${OUT}`);
  process.exitCode = refused === index.length ? 1 : 0;
})();
