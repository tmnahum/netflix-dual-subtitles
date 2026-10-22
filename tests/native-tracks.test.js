import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code = fs.readFileSync(new URL('../extension/bridge.js', import.meta.url), 'utf8');
function setup() {
  const tracks = [
    { trackId: 'off', isNoneTrack: true, displayName: 'Off' },
    { trackId: 'en', bcp47: 'en', displayName: 'English' },
    { trackId: 'en-cc', bcp47: 'en', displayName: 'English [CC]', rawTrackType: 'closedcaptions' },
    { trackId: 'ja', bcp47: 'ja', displayName: 'Japanese' },
    { trackId: 'img', bcp47: 'fr', isImageBased: true }
  ];
  let selected = tracks[0], movieId = 123;
  const messages = [], requests = [], timers = new Map(), changes = [];
  let onMessage, timerId = 0;
  class XHR {
    responseType = 'text'; status = 200; events = {};
    addEventListener(event, fn) { (this.events[event] ||= []).push(fn); }
    open() {}
    complete(text = '<tt><body><p begin="0s" end="20s">Captured text</p></body></tt>') { this.responseText = text; for (const fn of this.events.load || []) fn(); }
  }
  const player = {
    getMovieId: () => movieId,
    getTimedTextTrackList: () => tracks,
    getTimedTextTrack: () => selected,
    setTimedTextTrack(track) {
      selected = track; changes.push(track.trackId);
      if (!track.isNoneTrack) { const xhr = new XHR(); xhr.open('GET', 'https://a.nflxvideo.net/subtitle?private=signed'); requests.push(xhr); }
    }
  };
  const context = vm.createContext({ URL, Response: class extends Response {}, XMLHttpRequest: XHR,
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    location: { pathname: '/watch/123', origin: 'https://www.netflix.com' },
    window: { postMessage: msg => messages.push(msg), addEventListener: (_, fn) => onMessage = fn,
      netflix: { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: { getAllPlayerSessionIds: () => ['session'], getVideoPlayerBySessionId: () => player } }) } } } } }
  });
  vm.runInContext(code, context);
  const send = data => onMessage({ source: context.window, origin: context.location.origin, data });
  const acquire = (trackId, requestId = trackId) => send({ source: 'subbed-track-request', movieId: '123', trackId, requestId });
  return { tracks, requests, messages, player, context, changes, acquire, send, timers, navigate: () => { movieId = 456; context.location.pathname = '/watch/456'; } };
}
test('Actual reported player shape populates native tracks without manifest links', () => {
  const h = setup(); h.send({ source: 'subbed-request' });
  const list = h.messages.find(m => m.source === 'subbed-manifest').tracks;
  assert.deepEqual(Array.from(list, t => t.trackId), ['en', 'en-cc', 'ja']);
  assert.ok(list.every(t => t.subbedNative));
});
test('Selects and captures each exact track ID, restores Off, reuses cached text without switching', () => {
  const h = setup();
  for (const id of ['en', 'en-cc', 'ja']) {
    h.acquire(id); h.requests.at(-1).complete(`<tt><body><p begin="0s" end="20s">${id}</p></body></tt>`);
    const result = h.messages.at(-1);
    assert.equal(result.source, 'subbed-track-result'); assert.equal(result.trackId, id);
    assert.ok(result.text.includes(`>${id}<`)); assert.equal(h.player.getTimedTextTrack().trackId, 'off');
    assert.equal(h.timers.size, 0);
  }
  const before = h.changes.length;
  h.acquire('en-cc', 'cached');
  assert.equal(h.changes.length, before); assert.equal(h.messages.at(-1).requestId, 'cached');
  h.send({ source: 'subbed-export-request', requestId: 'debug' });
  assert.equal(JSON.stringify(h.messages.at(-1).report).includes('<tt>'), false);
});
test('Does not mislabel a response started before a track switch', () => {
  const h = setup(); h.player.setTimedTextTrack(h.tracks[1]); const old = h.requests.at(-1);
  h.acquire('ja'); old.complete();
  assert.ok(!h.messages.some(m => m.source === 'subbed-track-result'));
  h.requests.at(-1).complete();
  assert.equal(h.messages.at(-1).trackId, 'ja');
});
test('Cancellation and timeout restore original selection; manual changes are preserved', () => {
  const h = setup(); h.acquire('ja');
  h.send({ source: 'subbed-track-cancel', requestId: 'ja' });
  assert.equal(h.player.getTimedTextTrack().trackId, 'off'); assert.equal(h.timers.size, 0);
  h.acquire('en'); [...h.timers.values()][0]();
  assert.match(h.messages.at(-1).error, /did not download/);
  assert.equal(h.player.getTimedTextTrack().trackId, 'off');
  h.acquire('ja'); h.player.setTimedTextTrack(h.tracks[1]);
  h.send({ source: 'subbed-track-cancel', requestId: 'ja' });
  assert.equal(h.player.getTimedTextTrack().trackId, 'en');
});
test('Episode navigation rejects old responses and does not restore into the new episode', () => {
  const h = setup(); h.acquire('ja'); const old = h.requests.at(-1); h.navigate(); old.complete();
  assert.ok(!h.messages.some(m => m.source === 'subbed-track-result'));
  const before = h.changes.length;
  [...h.timers.values()][0](); assert.equal(h.changes.length, before);
});
test('Rejects image/unknown tracks and does not start simultaneous track selections', () => {
  const h = setup(); h.acquire('img'); assert.match(h.messages.at(-1).error, /cannot load/);
  h.acquire('missing'); assert.match(h.messages.at(-1).error, /cannot load/);
  h.acquire('ja'); h.acquire('en'); assert.match(h.messages.at(-1).error, /still loading/);
  h.send({ source: 'subbed-track-cancel', requestId: 'ja' });
});
