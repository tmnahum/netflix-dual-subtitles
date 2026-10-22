/* Runs at document_start in the page's JS world. Netflix has no public subtitle API. */
(() => {
  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const manifests = new Map();
  const diagnostics = { version: '0.1.3', parsed: 0, manifests: 0, player: false, playerTracks: 0 };
  const currentId = () => location.pathname.match(/^\/watch\/(\d+)/)?.[1] || '';
  const nativeTexts = new Map();
  let pendingTrack = null, selectionSerial = 0;
  function activePlayer() {
    try {
      const api = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
      for (const session of [...(api?.getAllPlayerSessionIds?.() || [])].reverse()) {
        const player = api.getVideoPlayerBySessionId(session);
        if (String(player?.getMovieId?.()) === currentId()) return player;
      }
    } catch {}
    return null;
  }
  const trackId = track => String(typeof track === 'string' ? track : track?.trackId ?? track?.new_track_id ?? '');
  function captureContext() {
    const player = activePlayer();
    let selected = '';
    try { selected = trackId(player?.getTimedTextTrack?.()); } catch {}
    return { movieId: currentId(), player, trackId: pendingTrack?.player === player ? pendingTrack.trackId : selected, serial: selectionSerial };
  }
  function finishTrack(error, text) {
    const pending = pendingTrack;
    if (!pending) return;
    pendingTrack = null;
    clearTimeout(pending.timer);
    // Do not override a manual selection or restore into a different episode.
    try {
      if (pending.movieId === currentId() && activePlayer() === pending.player && trackId(pending.player.getTimedTextTrack()) === pending.trackId && pending.original) {
        selectionSerial++;
        pending.player.setTimedTextTrack(pending.original);
      }
    } catch { /* Capture can still succeed if restoring fails. */ }
    window.postMessage({ source: 'subbed-track-result', requestId: pending.requestId, movieId: pending.movieId, trackId: pending.trackId, error, text }, location.origin);
  }
  function captureSubtitle(text, input, context) {
    if (!context?.player || !context.trackId || context.movieId !== currentId() || context.serial !== selectionSerial || typeof text !== 'string' || text.length > 2 * 1024 * 1024) return;
    if (!/(^|\.)nflxvideo\.net$/.test(endpoint(input).host)) return;
    if (!/^\s*(?:WEBVTT|(?:<\?xml[^>]*>\s*)?<(?:[\w-]+:)?tt[\s>])/.test(text.replace(/^\uFEFF/, ''))) return;
    try {
      if (activePlayer() !== context.player || trackId(context.player.getTimedTextTrack()) !== context.trackId) return;
      const track = context.player.getTimedTextTrackList().find(t => trackId(t) === context.trackId);
      if (!track || track.isNoneTrack || track.isImageBased) return;
      nativeTexts.set(`${context.movieId}:${context.trackId}`, text);
      if (nativeTexts.size > 12) nativeTexts.delete(nativeTexts.keys().next().value);
      diagnostics.capturedTracks = nativeTexts.size;
      if (pendingTrack?.movieId === context.movieId && pendingTrack.trackId === context.trackId) finishTrack(null, text);
    } catch {}
  }
  function acquireTrack(message) {
    if (message.movieId !== currentId() || typeof message.requestId !== 'string' || typeof message.trackId !== 'string') return;
    const replyError = error => window.postMessage({ source: 'subbed-track-result', requestId: message.requestId, movieId: message.movieId, trackId: message.trackId, error }, location.origin);
    const cached = nativeTexts.get(`${message.movieId}:${message.trackId}`);
    if (cached) {
      window.postMessage({ source: 'subbed-track-result', requestId: message.requestId, movieId: message.movieId, trackId: message.trackId, text: cached }, location.origin);
      return;
    }
    if (pendingTrack) { replyError('Another subtitle track is still loading. Try again.'); return; }
    try {
      const player = activePlayer();
      const target = player?.getTimedTextTrackList?.()?.find(t => trackId(t) === message.trackId && !t.isNoneTrack && !t.isImageBased);
      if (!target || typeof player.setTimedTextTrack !== 'function') { replyError('Netflix cannot load this text track through its player.'); return; }
      const original = player.getTimedTextTrack();
      pendingTrack = { player, original, trackId: message.trackId, movieId: message.movieId, requestId: message.requestId };
      pendingTrack.timer = setTimeout(() => finishTrack('Netflix did not download this track. Select it in Netflix’s own subtitle menu, then click Refresh track list. If it remains cached, reload Netflix.'), 12000);
      selectionSerial++;
      player.setTimedTextTrack(target);
    } catch { finishTrack('Netflix rejected the subtitle selection. Select it in Netflix’s own menu and retry.'); }
  }
  // Bounded in-memory diagnostics. Never retain raw headers, bodies, or URL paths.
  const network = [], observations = [];
  let networkTotal = 0, bodyReads = 0;
  let playerSnapshot = { methods: [], tracks: [] };
  const started = Date.now();
  function endpoint(input) {
    try {
      const url = new URL(typeof input === 'string' ? input : input?.url, location.origin);
      const kind = /manifest/i.test(url.pathname) ? 'manifest' : /subtitle|timedtext|\.vtt|\.ttml|\.dfxp/i.test(url.pathname) ? 'subtitle' : /license|drm/i.test(url.pathname) ? 'license' : /range|video|audio/i.test(url.pathname) ? 'media' : 'other';
      return { host: url.hostname, kind, protocol: url.protocol };
    } catch { return { host: '[unavailable]', kind: 'other' }; }
  }
  function record(transport, input, fields = {}) {
    networkTotal++;
    network.push({ atMs: Date.now() - started, transport, ...endpoint(input), ...fields });
    if (network.length > 300) network.shift();
  }
  // Only field names and primitive types are exported, never arbitrary values.
  function shape(value, depth = 0, budget = { left: 120 }) {
    if (--budget.left < 0 || depth > 4) return '[truncated]';
    if (value === null) return 'null';
    if (Array.isArray(value)) return { type: 'array', length: value.length, sample: value.slice(0, 2).map(v => shape(v, depth + 1, budget)) };
    if (typeof value !== 'object') return typeof value;
    const result = Object.create(null);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value)).slice(0, 35)) {
      const safeKey = /^[a-zA-Z_][a-zA-Z_0-9.-]{0,50}$/.test(key) && !/token|cookie|auth|secret|session|password/i.test(key) ? key : '[redacted-key]';
      result[safeKey] = 'value' in descriptor ? shape(descriptor.value, depth + 1, budget) : '[accessor]';
    }
    return result;
  }
  function observeBody(text, input) {
    if (typeof text !== 'string' || text.length > 2 * 1024 * 1024 || /media|license/.test(endpoint(input).kind)) return;
    const trimmed = text.trimStart();
    const format = trimmed.startsWith('WEBVTT') ? 'webvtt' : /^<\?xml|^<(?:[\w-]+:)?tt[\s>]/.test(trimmed) ? 'xml-subtitle' : /^[{[]/.test(trimmed) ? 'json' : 'other';
    if (format === 'other' && !/manifest|subtitle/.test(endpoint(input).kind)) return;
    const summary = { atMs: Date.now() - started, ...endpoint(input), format, characters: text.length, hasTimedTextTracks: text.includes('timedtexttracks') };
    if (format === 'json') { try { summary.shape = shape(Reflect.apply(parse, JSON, [text])); } catch { summary.jsonParseFailed = true; } }
    observations.push(summary);
    if (observations.length > 30) observations.shift();
  }
  function report() {
    return {
      version: diagnostics.version, elapsedMs: Date.now() - started, diagnostics: { ...diagnostics },
      coverage: 'Page fetch/XHR and resource timing only. Worker-only requests, encrypted payloads and browser-internal traffic may be unavailable. Fetch and resource entries can describe the same request. Status 0 means unavailable.',
      privacy: 'No request bodies, response text, headers, URL paths, query parameters, or arbitrary player values are exported.',
      networkTotal, networkDropped: Math.max(0, networkTotal - network.length), network: [...network], observations: [...observations], player: playerSnapshot
    };
  }
  function inspect(value, fallbackId = '') {
    // Player versions wrap manifests in arrays or named response envelopes.
    // Bound traversal and avoid getters, cycles, and walking the window object.
    let remaining = 5000;
    const seen = new WeakSet();
    function visit(node, inheritedId, depth) {
      if (!node || typeof node !== 'object' || depth > 12 || --remaining < 0 || seen.has(node)) return;
      seen.add(node);
      const id = String(node.movieId ?? node.videoId ?? inheritedId ?? '');
      if (Array.isArray(node.timedtexttracks) && !id) {
        observations.push({ atMs: Date.now() - started, format: 'manifest-without-title-id', shape: shape(node) });
        if (observations.length > 30) observations.shift();
      }
      if (Array.isArray(node.timedtexttracks) && id) {
        diagnostics.manifests++;
        manifests.set(id, { movieId: id, tracks: node.timedtexttracks });
        if (manifests.size > 8) manifests.delete(manifests.keys().next().value);
        publish();
        return;
      }
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(node))) {
        if ('value' in descriptor && descriptor.value && typeof descriptor.value === 'object') visit(descriptor.value, id, depth + 1);
      }
    }
    visit(value, fallbackId, 0);
  }
  function inspectText(text, id = '') {
    if (typeof text !== 'string' || text.length > 8 * 1024 * 1024 || !text.includes('timedtexttracks')) return;
    try { inspect(Reflect.apply(parse, JSON, [text]), id); } catch { /* Encrypted/non-JSON responses are not manifests. */ }
  }
  function probePlayer() {
    diagnostics.player = false;
    diagnostics.playerTracks = 0;
    playerSnapshot = { methods: [], tracks: [] };
    try {
      const api = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
      const sessions = api?.getAllPlayerSessionIds?.() || [];
      for (const session of [...sessions].reverse()) {
        const player = api.getVideoPlayerBySessionId(session);
        if (!player) continue;
        const playerId = player.getMovieId?.();
        if (playerId != null && String(playerId) !== currentId()) continue;
        diagnostics.player = true;
        const tracks = player.getTimedTextTrackList?.() || [];
        diagnostics.playerTracks = tracks.length;
        const methods = new Set();
        for (let object = player, depth = 0; object && depth < 3; object = Object.getPrototypeOf(object), depth++) {
          for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(object))) {
            if (typeof descriptor.value === 'function' && /^[a-zA-Z_][a-zA-Z_0-9]{0,80}$/.test(key)) methods.add(key);
          }
        }
        playerSnapshot = { methods: [...methods].sort().slice(0, 200), tracks: Array.from(tracks).slice(0, 60).map(track => ({
          language: /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(track.language || track.bcp47 || '') ? (track.language || track.bcp47) : '[unknown]',
          shape: shape(track)
        })) };
        // Native player tracks remain usable even when the manifest is encrypted.
        const nativeTracks = Array.from(tracks).filter(t => t && !t.isNoneTrack && !t.isImageBased && trackId(t)).map(t => ({
          trackId: trackId(t), bcp47: t.bcp47, language: t.language, displayName: t.displayName,
          rawTrackType: t.rawTrackType, isForcedNarrative: t.isForcedNarrative, subbedNative: true
        }));
        if (nativeTracks.length && !manifests.has(currentId())) window.postMessage({ source: 'subbed-manifest', movieId: currentId(), tracks: nativeTracks }, location.origin);
        // Some builds put download descriptors directly on the player track list.
        if (tracks.some(t => t && (t.ttDownloadables || t.downloadables || t.downloadUrls || t.urls))) {
          inspect({ movieId: String(playerId ?? currentId()), timedtexttracks: tracks });
        }
        // Read-only recovery for manifests parsed before the content script was ready.
        for (const method of ['getManifest', 'getMovieManifest', 'getPlaybackInfo']) {
          try { if (typeof player[method] === 'function') inspect(player[method](), String(playerId ?? currentId())); } catch { /* API differs by player version. */ }
        }
        break;
      }
    } catch { /* Player is not initialized yet. */ }
  }
  function publish() {
    const id = location.pathname.match(/^\/watch\/(\d+)/)?.[1];
    if (id && manifests.has(id)) {
      window.postMessage({ source: 'subbed-manifest', ...manifests.get(id) }, location.origin);
    }
  }
  JSON.parse = function (...args) {
    const value = Reflect.apply(parse, this, args);
    try { diagnostics.parsed++; inspect(value); } catch { /* Never interfere with playback. */ }
    return value;
  };
  JSON.stringify = function (value, ...rest) {
    try {
      if (value && typeof value.url === 'string' && /manifest/i.test(value.url)) {
        // Only modify the manifest request; retain the caller's replacer and spacing.
        value = { ...value };
        for (const [key, original] of Object.entries(value)) {
          if (!original || typeof original !== 'object' || Array.isArray(original)) continue;
          const params = { ...original };
          if (Array.isArray(params.profiles)) {
            params.profiles = [...new Set([...params.profiles, 'webvtt-lssdh-ios8', 'dfxp-ls-sdh'])];
          }
          if ('showAllSubDubTracks' in params) params.showAllSubDubTracks = true;
          value[key] = params;
        }
      }
    } catch { /* Leave Netflix's serialization usable if its schema changes. */ }
    return Reflect.apply(stringify, this, [value, ...rest]);
  };
  // Some player versions use Response.json rather than JSON.parse in page code.
  const responseJSON = Response.prototype.json;
  Response.prototype.json = async function (...args) {
    const value = await Reflect.apply(responseJSON, this, args);
    try { inspect(value); if (value && typeof value === 'object' && /manifest/.test(endpoint(this.url).kind)) { observations.push({ ...endpoint(this.url), format: 'json', shape: shape(value) }); if (observations.length > 30) observations.shift(); } } catch { /* Ignore unrelated responses. */ }
    return value;
  };
  // Native XHR JSON decoding and Response.text() bypass a page's JSON.parse hook.
  const responseText = Response.prototype.text;
  if (responseText) Response.prototype.text = async function (...args) {
    const id = currentId(), context = captureContext();
    const text = await Reflect.apply(responseText, this, args);
    // Only use a fallback ID for a manifest endpoint, never arbitrary prefetches.
    try { captureSubtitle(text, this.url, context); observeBody(text, this.url); inspectText(text, /manifest/i.test(this.url || '') && id === currentId() ? id : ''); } catch {}
    return text;
  };
  if (typeof XMLHttpRequest !== 'undefined') {
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      const id = currentId();
      const began = Date.now(), context = captureContext();
      this.addEventListener('load', () => {
        try {
          record('xhr', url, { status: this.status || 0, durationMs: Date.now() - began, responseType: this.responseType || 'text' });
          const fallback = /manifest/i.test(String(url)) && id === currentId() ? id : '';
          if (this.responseType === 'json') {
            inspect(this.response, fallback);
            if (!/media|license/.test(endpoint(url).kind)) {
              observations.push({ atMs: Date.now() - started, ...endpoint(url), format: 'xhr-json', shape: shape(this.response) });
              if (observations.length > 30) observations.shift();
            }
          }
          else if (!this.responseType || this.responseType === 'text') { captureSubtitle(this.responseText, url, context); observeBody(this.responseText, url); inspectText(this.responseText, fallback); }
        } catch { /* Leave unrelated requests alone. */ }
      }, { once: true });
      for (const kind of ['error', 'abort', 'timeout']) this.addEventListener(kind, () => record('xhr', url, { outcome: kind }), { once: true });
      return Reflect.apply(open, this, [method, url, ...rest]);
    };
  }
  // Observe fetch even when Netflix consumes the response as bytes/streams.
  // Read only bounded text-like responses, never video/audio/license bodies.
  const nativeFetch = window.fetch;
  async function readCandidate(response, input, id, context) {
    const info = endpoint(input);
    const mime = response.headers?.get('content-type') || '';
    if (bodyReads >= 2 || !/(^|\.)(netflix\.com|nflxvideo\.net)$/.test(info.host) || /media|license/.test(info.kind) || !/json|xml|vtt|ttml|text\/plain/i.test(mime)) return;
    if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024) return;
    bodyReads++;
    let reader, timer;
    try {
      reader = response.clone().body.getReader();
      timer = setTimeout(() => { reader.cancel().catch(() => {}); }, 4000);
      const decoder = new TextDecoder();
      let bytes = 0, text = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2 * 1024 * 1024) { reader.cancel().catch(() => {}); return; }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      captureSubtitle(text, input, context);
      observeBody(text, input);
      inspectText(text, info.kind === 'manifest' && id === currentId() ? id : '');
    } catch { /* Never reject the original fetch or hold up its caller. */ }
    finally { clearTimeout(timer); bodyReads--; }
  }
  if (nativeFetch) window.fetch = function (...args) {
    const began = Date.now(), id = currentId(), context = captureContext();
    const promise = Reflect.apply(nativeFetch, this, args);
    promise.then(response => {
      record('fetch', args[0], { status: response.status, durationMs: Date.now() - began });
      return readCandidate(response, args[0], id, context);
    }, () => record('fetch', args[0], { outcome: 'failed', durationMs: Date.now() - began })).catch(() => {});
    return promise;
  };
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) record('resource', entry.name, {
          initiator: /^[a-z]+$/.test(entry.initiatorType) ? entry.initiatorType : 'other',
          durationMs: Math.round(entry.duration), bytes: entry.transferSize || 0, status: entry.responseStatus || 0
        });
      }).observe({ type: 'resource', buffered: true });
    } catch { /* Resource timing may be unavailable. */ }
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source === 'subbed-track-request') { acquireTrack(event.data); return; }
    if (event.data?.source === 'subbed-track-cancel') {
      if (pendingTrack?.requestId === event.data.requestId) { selectionSerial++; finishTrack('Subtitle loading cancelled.'); }
      return;
    }
    if (event.data?.source === 'subbed-export-request') {
      probePlayer();
      window.postMessage({ source: 'subbed-export', requestId: event.data.requestId, report: report() }, location.origin);
      return;
    }
    if (event.data?.source !== 'subbed-request') return;
    probePlayer();
    publish();
    window.postMessage({ source: 'subbed-diagnostics', movieId: currentId(), ...diagnostics }, location.origin);
  });
})();
