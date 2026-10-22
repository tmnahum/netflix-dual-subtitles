import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../extension/bridge.js', import.meta.url), 'utf8');
function harness(fetcher = async () => new Response('okay', { headers: { 'content-type': 'text/plain' } }), player = null) {
  const messages = [], listeners = {};
  let performanceCallback;
  const context = vm.createContext({
    URL, TextDecoder, setTimeout, clearTimeout,
    location: { pathname: '/watch/123', origin: 'https://www.netflix.com' },
    Response: class extends Response {},
    PerformanceObserver: class { constructor(callback) { performanceCallback = callback; } observe() {} },
    window: { fetch: fetcher, postMessage: m => messages.push(m), addEventListener: (name, fn) => listeners[name] = fn,
      netflix: player ? { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: { getAllPlayerSessionIds: () => ['session'], getVideoPlayerBySessionId: () => player } }) } } } } : null }
  });
  vm.runInContext(source, context);
  const request = (kind = 'subbed-export-request') => {
    listeners.message({ source: context.window, origin: context.location.origin, data: { source: kind, requestId: 'test' } });
    return messages.at(-1).report;
  };
  return { context, messages, request, performance: performanceCallback };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
test('Export bounds network history and removes paths, query values and player values', () => {
  const secret = 'SECRET_TOKEN_DO_NOT_EXPORT';
  const player = { getMovieId: () => 123, getTimedTextTrackList: () => [{ language: 'ja', label: secret, sessionToken: secret, downloadables: { 'webvtt': { urls: [`https://a.nflxvideo.net/${secret}?token=${secret}`] } } }] };
  const h = harness(undefined, player);
  for (let i = 0; i < 350; i++) h.performance({ getEntries: () => [{ name: `https://a.nflxvideo.net/${secret}?auth=${secret}`, initiatorType: 'fetch', duration: 4, transferSize: 10, responseStatus: 200 }] });
  const report = h.request();
  assert.equal(report.network.length, 300);
  assert.equal(report.networkTotal, 350);
  assert.equal(report.networkDropped, 50);
  assert.equal(report.player.tracks[0].language, 'ja');
  assert.ok(report.player.methods.includes('getTimedTextTrackList'));
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.ok(h.messages.some(m => m.source === 'subbed-manifest'), 'Player download descriptors are recovered');
});
test('Fetch observer finds manifests consumed as bytes while returning the original promise/body', async () => {
  const secret = 'DO_NOT_EXPORT_BODY_VALUES';
  const body = JSON.stringify({ result: { movieId: 123, timedtexttracks: [{ language: 'en' }], authToken: secret } });
  const original = Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }));
  const h = harness(() => original);
  const observed = h.context.window.fetch(`https://www.netflix.com/manifest?token=${secret}`);
  assert.equal(observed, original);
  const bytes = await (await observed).arrayBuffer();
  assert.equal(new TextDecoder().decode(bytes), body);
  await settle();
  assert.ok(h.messages.some(m => m.source === 'subbed-manifest'));
  const report = h.request();
  assert.equal(report.network[0].status, 200);
  assert.equal(report.observations[0].hasTimedTextTracks, true);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(report.observations[0].shape.result['[redacted-key]'], 'string');
});
test('Media, license and oversize bodies are not cloned; failures retain their rejection', async () => {
  let clones = 0;
  const h = harness(async () => ({ status: 200, headers: new Headers({ 'content-type': 'application/json', 'content-length': '4000000' }), clone() { clones++; throw Error('must not clone'); } }));
  await h.context.window.fetch('https://www.netflix.com/manifest');
  await h.context.window.fetch('https://www.netflix.com/license');
  await h.context.window.fetch('https://a.nflxvideo.net/range/bytes');
  await settle();
  assert.equal(clones, 0);
  const failure = new Error('test failure');
  const failed = harness(() => Promise.reject(failure));
  await assert.rejects(failed.context.window.fetch('https://www.netflix.com/manifest'), error => error === failure);
  assert.equal(failed.request().network[0].outcome, 'failed');
});
test('Body summaries are capped and never include subtitle dialogue', async () => {
  const dialogue = 'PRIVATE_SUBTITLE_DIALOGUE';
  const h = harness(async () => new Response(`WEBVTT\n\n00:01.000 --> 00:02.000\n${dialogue}`, { headers: { 'content-type': 'text/vtt' } }));
  for (let i = 0; i < 35; i++) { await h.context.window.fetch('https://a.nflxvideo.net/subtitle.vtt'); await settle(); }
  const report = h.request();
  assert.equal(report.observations.length, 30);
  assert.equal(report.observations[0].format, 'webvtt');
  assert.equal(JSON.stringify(report).includes(dialogue), false);
});
