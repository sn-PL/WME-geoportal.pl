#!/usr/bin/env node
'use strict';
/**
 * Ask the real Geoportal services for the exact requests the script builds, and
 * report what came back. This is the check that cannot run in CI - it needs the
 * internet and the services are bursty - but it is how the "grey plate" of round
 * 18 was found: a refused request comes back as a *document* (text/xml) and a
 * successful one as an *image*, and a service that draws its own error into the
 * image is what made the plate show up on the map.
 *
 *   node test/live/probe-services.cjs              # every layer, one request each
 *   node test/live/probe-services.cjs --only=drogi # layers whose name contains this
 *   node test/live/probe-services.cjs --strict     # a refused request fails the run
 *
 * Without --strict a request the service refuses is reported and the run still
 * exits 0: the comment above explains why a refusal is not a bug by itself.
 */
const { boot, params } = require('../lib/harness.cjs');

const REQUEST_TIMEOUT = 20000;
const RETRY_DELAY = 2500;
const args = process.argv.slice(2);
const only = args.find(argument => argument.startsWith('--only='))?.split('=')[1] || '';
const strict = args.includes('--strict');

/** The pixel size of a PNG or JPEG buffer, or null if it is neither. */
function imageSize(buffer) {
  if (buffer.length > 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'png', w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpeg', h: buffer.readUInt16BE(offset + 5), w: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
    return { type: 'jpeg', w: null, h: null };
  }
  return null;
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    const body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, contentType: response.headers.get('content-type') || '', bytes: body.length, body };
  } catch (error) {
    return { status: 0, contentType: '', bytes: 0, body: Buffer.alloc(0), error: String(error.cause || error.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function probe(url) {
  let answer = await fetchOnce(url);
  let retried = false;
  const size = imageSize(answer.body);
  if (!size && answer.status < 400) {
    // A refusal is often a burst: the same request a moment later usually works.
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    answer = await fetchOnce(url);
    retried = true;
  }
  const finalSize = imageSize(answer.body);
  return { ...answer, size: finalSize, retried };
}

(async () => {
  const env = await boot({ enabled: 'all' });
  await env.drawAll();

  const rows = [];
  for (const name of env.names()) {
    if (only && !name.toLowerCase().includes(only.toLowerCase())) continue;
    const layer = env.layer(name);
    const url = env.requestOf(layer);
    if (!url) {
      rows.push({ name, url: '', note: 'no request at this zoom' });
      continue;
    }
    const answer = await probe(url);
    rows.push({ name, url, ...answer });
  }

  const shorten = url => {
    const query = params(url);
    const layers = (query.LAYERS || '').split(',').length;
    return `${query.REQUEST || '?'} ${query.CRS || ''} ${query.WIDTH || ''}x${query.HEIGHT || ''} ` +
      `${layers} layer(s)${query.TILEMATRIX ? ` TILEMATRIX ${query.TILEMATRIX}` : ''}`;
  };

  console.log('\nWhat the services answered (one request per layer)\n');
  let refused = 0, unreachable = 0, failed = 0;
  for (const row of rows) {
    if (!row.url) {
      console.log(`  ${row.name}\n    ${row.note}`);
      failed++;
      continue;
    }
    const what = row.size ? `${row.size.type} ${row.size.w}x${row.size.h}` :
      (row.status === 0 ? `could not be reached: ${row.error}` : `NOT AN IMAGE (${row.contentType})`);
    const flag = row.size ? ' ' : '!';
    console.log(` ${flag}${row.name}`);
    console.log(`    ${shorten(row.url)}`);
    console.log(`    → HTTP ${row.status} ${row.contentType} ${row.bytes} B  ${what}${row.retried ? ' (after one retry)' : ''}`);
    if (!row.size) {
      if (row.status === 0) unreachable++; else refused++;
      const body = row.body.subarray(0, 300).toString('utf8').replace(/\s+/g, ' ').trim();
      if (body) console.log(`      ${body}`);
    }
  }

  console.log(`\n${rows.length} layers probed: ${rows.length - refused - unreachable - failed} answered with an image, ` +
    `${refused} refused (a document instead of a picture), ${unreachable} could not be reached, ${failed} not asked for.`);
  console.log('A refused request is the service shedding a burst, not a parameter problem - it is what the\n' +
    'layer\'s retries are for. What must never happen is a refusal being *drawn*: the script asks for\n' +
    'EXCEPTIONS=XML, so a refusal cannot become a picture on the map (see the requests suite).');

  env.close();
  process.exit(strict && refused + unreachable + failed > 0 ? 1 : 0);
})().catch(error => {
  console.error('the probe could not run:', error);
  process.exit(2);
});
