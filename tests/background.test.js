import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
function setup(fetcher) {
  let listener;
  vm.runInNewContext(code, { URL, AbortSignal, TextDecoder, fetch: fetcher, chrome: { runtime: { onMessage: { addListener: fn => listener = fn } }, action: { onClicked: { addListener() {} } } } });
  return (url, sender = { tab: { id: 1 }, url: 'https://www.netflix.com/watch/123' }) => new Promise(resolve => listener({ type: 'subbed-fetch', url }, sender, resolve));
}
test('Background rejects non-CDN URLs and requests outside Netflix', async () => {
  const send = setup(() => { throw Error('Should not fetch'); });
  for (const url of ['https://evil.test/a', 'https://a.nflxvideo.net.evil.test/a', 'http://a.nflxvideo.net/a', 'https://a.nflxvideo.net:444/a', 'https://user:pass@a.nflxvideo.net/a']) assert.match((await send(url)).error, /not an allowed/);
  assert.match((await send('https://a.nflxvideo.net/a', { tab: {}, url: 'https://evil.test/' })).error, /not an allowed/);
});
test('Background downloads without credentials or redirects and reports HTTP failures', async () => {
  const send = setup(async (url, options) => {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return new Response('WEBVTT\n');
  });
  assert.equal((await send('https://a.nflxvideo.net/a')).text, 'WEBVTT\n');
  assert.match((await setup(async () => new Response('', { status: 403 }))('https://a.nflxvideo.net/a')).error, /403/);
});
