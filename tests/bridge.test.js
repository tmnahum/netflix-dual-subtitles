import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../extension/bridge.js', import.meta.url), 'utf8');
test('Bridge captures only current title, replays early manifests, preserves JSON API arguments', async () => {
  const messages = [];
  const listeners = {};
  const context = vm.createContext({ location: { pathname: '/watch/123', origin: 'https://www.netflix.com' }, Response: class { async json() { return { result: { movieId: 123, timedtexttracks: [] } }; } } });
  context.window = { postMessage: message => messages.push(message), addEventListener: (name, cb) => listeners[name] = cb };
  vm.runInContext(source, context);
  vm.runInContext(`JSON.parse('{"result":{"movieId":123,"timedtexttracks":[]}}')`, context);
  assert.equal(messages[0].movieId, '123');
  vm.runInContext(`JSON.parse('{"result":{"movieId":999,"timedtexttracks":[]}}')`, context);
  assert.ok(messages.every(m => m.movieId === '123'));
  listeners.message({ source: context.window, origin: 'https://www.netflix.com', data: { source: 'subbed-request' } });
  assert.equal(messages.at(-1).movieId, '123');
  assert.equal(vm.runInContext(`JSON.parse('{"a":1}', (k,v)=>k==='a'?2:v).a`, context), 2);
  assert.equal(vm.runInContext(`JSON.stringify({a:1,b:2}, ['a'], 2)`, context), '{\n  "a": 1\n}');
  const changed = JSON.parse(vm.runInContext(`JSON.stringify({url:'/manifest',params:{profiles:['original'],showAllSubDubTracks:false}})`, context));
  assert.equal(changed.params.showAllSubDubTracks, true);
  assert.ok(changed.params.profiles.includes('webvtt-lssdh-ios8'));
  await vm.runInContext('new Response().json()', context);
  assert.equal(messages.at(-1).movieId, '123');
});

test('Bridge finds nested array manifests with inherited title IDs', () => {
  const messages = [];
  const context = vm.createContext({ location: { pathname: '/watch/123', origin: 'https://www.netflix.com' }, Response: class { async json() { return {}; } }, window: { postMessage: m => messages.push(m), addEventListener() {} } });
  vm.runInContext(source, context);
  vm.runInContext(`JSON.parse('{"payload":[{"videoId":123,"playback":{"timedtexttracks":[{"language":"ja"}]}}]}')`, context);
  assert.equal(messages[0].movieId, '123');
  assert.equal(messages[0].tracks[0].language, 'ja');
  vm.runInContext(`JSON.parse('{"payload":[{"videoId":999,"playback":{"timedtexttracks":[{"language":"en"}]}}]}')`, context);
  assert.ok(messages.every(m => m.movieId === '123'));
});

test('Native XHR JSON and Response.text paths are observed without changing response values', async () => {
  const messages = [];
  class FakeXHR {
    addEventListener(name, listener) { if (name === 'load') this.listener = listener; }
    open(method, url) { this.url = url; return 'original-open'; }
  }
  const context = vm.createContext({
    location: { pathname: '/watch/123', origin: 'https://www.netflix.com' }, XMLHttpRequest: FakeXHR,
    Response: class { constructor() { this.url = 'https://www.netflix.com/manifest'; } async json() { return {}; } async text() { return '{"payload":{"timedtexttracks":[{"language":"fr"}]}}'; } },
    window: { postMessage: m => messages.push(m), addEventListener() {} }
  });
  vm.runInContext(source, context);
  const xhr = new FakeXHR();
  assert.equal(xhr.open('GET', '/manifest'), 'original-open');
  xhr.responseType = 'json';
  xhr.response = { payload: { timedtexttracks: [{ language: 'de' }] } };
  xhr.listener();
  assert.equal(messages.at(-1).tracks[0].language, 'de');
  const result = await vm.runInContext('new Response().text()', context);
  assert.equal(JSON.parse(result).payload.timedtexttracks[0].language, 'fr');
  assert.equal(messages.at(-1).tracks[0].language, 'fr');
  const stale = new FakeXHR();
  stale.open('GET', '/manifest');
  stale.responseType = 'json'; stale.response = xhr.response;
  context.location.pathname = '/watch/456';
  const before = messages.length;
  stale.listener();
  assert.equal(messages.length, before, 'A response started on the previous episode must not be assigned to the next episode');
});

test('Player fallback recovers already-loaded manifests and emits useful diagnostics', () => {
  const messages = [], listeners = {};
  const player = { getMovieId: () => 123, getTimedTextTrackList: () => [{ language: 'en' }], getManifest: () => ({ timedtexttracks: [{ language: 'en' }] }) };
  const context = vm.createContext({
    location: { pathname: '/watch/123', origin: 'https://www.netflix.com' }, Response: class { async json() { return {}; } },
    window: { postMessage: m => messages.push(m), addEventListener: (name, fn) => listeners[name] = fn,
      netflix: { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: { getAllPlayerSessionIds: () => ['session'], getVideoPlayerBySessionId: () => player } }) } } } } }
  });
  vm.runInContext(source, context);
  listeners.message({ source: context.window, origin: context.location.origin, data: { source: 'subbed-request' } });
  assert.ok(messages.some(m => m.source === 'subbed-manifest' && m.tracks[0].language === 'en'));
  const diagnostic = messages.at(-1);
  assert.equal(diagnostic.source, 'subbed-diagnostics');
  assert.equal(diagnostic.player, true);
  assert.equal(diagnostic.playerTracks, 1);
});
