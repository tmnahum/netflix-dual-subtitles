import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../extension/subtitles.js';
import '../extension/preferences.js';
const { choose, preference, appearance } = globalThis.SubbedPreferences;
const list = globalThis.Subbed.tracks([
 { trackId: 'plain', language: 'en', displayName: 'English', subbedNative: true },
 { trackId: 'cc', language: 'en', displayName: 'English', trackType: 'CLOSED_CAPTIONS', subbedNative: true },
 { trackId: 'ja', language: 'ja', displayName: 'Japanese', subbedNative: true }
]);
test('English and English CC have distinct labels and persistent variant preferences', () => {
 assert.equal(list[0].label, 'English'); assert.equal(list[1].label, 'English · CC');
 const nextEpisode = list.map(t => ({...t, id:'next-'+t.id}));
 assert.equal(choose(nextEpisode, preference(list[1])), 'next-cc');
 assert.equal(choose(nextEpisode, preference(list[0])), 'next-plain');
 assert.equal(choose([nextEpisode[0]], preference(list[1])), '', 'Never silently substitute regular English for CC');
});
test('Existing CC labels are not duplicated and legacy language preferences still migrate', () => {
 const labeled = globalThis.Subbed.tracks([{trackId:'cc', bcp47:'en', displayName:'English [CC]', rawTrackType:'closedcaptions', subbedNative:true}])[0];
 assert.equal(labeled.label, 'English [CC]'); assert.equal(labeled.kind, 'cc');
 assert.equal(choose(list, 'ja'), 'ja');
});
test('Appearance defaults are transparent, sanitize saved values, and preserve independent positions', () => {
 assert.equal(appearance().opacity, 0); assert.equal(appearance().color, '#ffffff');
 assert.equal(appearance({opacity:200,x:-50,y:120,size:999,color:'invalid'}).opacity, 100);
 assert.equal(appearance({x:-50}).x, 0); assert.equal(appearance({size:999}).size, 64);
 assert.equal(appearance({y:5,color:'#00ff00'},1).y, 5);
 assert.equal(appearance({},1).y, 88);
});
