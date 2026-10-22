import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import '../extension/subtitles.js';
globalThis.DOMParser = DOMParser;
const { parse, time, index, active, tracks } = globalThis.Subbed;
test('WebVTT supports cue IDs, positioning, Unicode, entities, multiline and overlaps', () => {
  const cues = index(parse('WEBVTT\n\nNOTE ignore me\n\nfirst\n00:01.000 --> 00:03.000 position:50%\n<c.green>Hello &amp; 你好</c>\nWorld\n\n00:02.000 --> 00:04.000\nمرحبا\n'));
  assert.equal(active(cues, 0), '');
  assert.equal(active(cues, 1), 'Hello & 你好\nWorld');
  assert.equal(active(cues, 2.5), 'Hello & 你好\nWorld\nمرحبا');
  assert.equal(active(cues, 3), 'مرحبا');
  assert.equal(active(cues, 4), '');
  assert.equal(active(cues, 1), 'Hello & 你好\nWorld');
});
test('TTML supports namespace prefixes, ticks, ancestor offsets, duration and line breaks', () => {
  const cues = parse('<tt:tt xmlns:tt="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000"><tt:body begin="1s"><tt:div><tt:p begin="20000000t" dur="2s">Hello <tt:span>world</tt:span><tt:br/>你好 &amp; salut</tt:p></tt:div></tt:body></tt:tt>');
  assert.deepEqual(cues, [{ start: 3, end: 5, text: 'Hello world\n你好 & salut' }]);
});
test('TTML frames, inherited end and fractional rates', () => {
  assert.equal(time('00:00:01:15', { frame: 30 }), 1.5);
  assert.equal(time('1500ms'), 1.5);
  const cues = parse('<tt xmlns:ttp="urn:ttp" ttp:frameRate="30" ttp:frameRateMultiplier="1 2"><body end="5s"><p begin="30f">Test</p></body></tt>');
  assert.deepEqual(cues, [{ start: 2, end: 5, text: 'Test' }]);
});
test('Rejects unsupported and empty files, ignores invalid cue times', () => {
  assert.throws(() => parse('<html>Sign in</html>'), /No readable/);
  assert.throws(() => parse('WEBVTT\n\n00:03.000 --> 00:01.000\nInvalid'), /No readable/);
  assert.ok(Number.isNaN(time('invalid')));
});
test('Long overlapping cue remains visible through later short cues', () => {
  const cues = index([{ start: 0, end: 10, text: 'long' }, { start: 1, end: 2, text: 'short' }]);
  assert.equal(active(cues, 3), 'long');
});
test('Track normalization prefers WebVTT and keeps CC and forced variants', () => {
  const result = tracks([{ isNoneTrack: true }, { new_track_id: 'a', language: 'en', languageDescription: 'English', rawTrackType: 'closedcaptions', ttDownloadables: { 'dfxp-ls-sdh': { downloadUrls: { a: 'https://a.nflxvideo.net/ttml' } }, 'webvtt-lssdh-ios8': { downloadUrls: { a: 'https://a.nflxvideo.net/vtt' } } } }, { language: 'ja', ttDownloadables: { image: { downloadUrls: { a: 'image' } } } }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, 'English · CC');
  assert.match(result[0].sources[0].format, /vtt/);
});

test('Player track download descriptors support alternate URL shapes without losing track variants', () => {
  const result = tracks([null, { trackId: 'one', bcp47: 'en', displayName: 'English', downloadables: { webvtt: { urls: [{ url: 'https://a.nflxvideo.net/first' }] } } }, { trackId: 'two', bcp47: 'en', rawTrackType: 'closedcaptions', downloadUrls: ['https://a.nflxvideo.net/second'] }]);
  assert.equal(result.length, 2);
  assert.equal(result[0].label, 'English');
  assert.equal(result[0].sources[0].format, 'webvtt');
  assert.equal(result[1].sources[0].url, 'https://a.nflxvideo.net/second');
});
