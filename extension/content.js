(() => {
  let host, shadow, video, titleId = '', trackList = [], fingerprint = '';
  let cues = [[], []], generation = 0, ready = false;
  let settings = { enabled: true, primary: '', secondary: '', size: 30, offset: 0 };
  const cache = new Map();
  let positioning = false, dragging = null, lastActivity = Date.now();
  const activity = () => { lastActivity = Date.now(); if (shadow) $('launcher').classList.remove('idle'); }; 
  let bridgeDiagnostics = null, waitingSince = Date.now();
  let exportRequest = null, exportTimer;
  let nativeRequest = null;
  function cancelNative() {
    if (!nativeRequest) return;
    const previous = nativeRequest; nativeRequest = null;
    clearTimeout(previous.timer);
    window.postMessage({ source: 'subbed-track-cancel', requestId: previous.id }, location.origin);
    previous.reject(new Error('Subtitle loading cancelled.'));
  }
  function nativeText(track) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      nativeRequest = { id, movieId: watchId(), trackId: track.id, resolve, reject };
      nativeRequest.timer = setTimeout(() => cancelNative(), 15000);
      window.postMessage({ source: 'subbed-track-request', requestId: id, movieId: watchId(), trackId: track.id }, location.origin);
    });
  }
  const $ = id => shadow.getElementById(id);
  const watchId = () => location.pathname.match(/^\/watch\/(\d+)/)?.[1] || '';
  const request = () => window.postMessage({ source: 'subbed-request' }, location.origin);
  function save() { chrome.storage.local.set({ subbed: settings }).catch(() => {}); }
  function status(text) { if (shadow) $('status').textContent = text; }
  function mount() {
    if (host || !document.body) return;
    host = document.createElement('div');
    host.id = 'subbed-extension';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host{font-family:system-ui,sans-serif;color:#f4f4f5;font-size:14px;color-scheme:dark}
        *{box-sizing:border-box} [hidden]{display:none!important}
        button,select,input{font:inherit} button,select{cursor:pointer}
        button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #b6ed8a;outline-offset:3px}
        #launcher{position:absolute;top:22px;right:24px;pointer-events:auto;border:1px solid #ffffff30;background:#181a1ee8;color:#e4f5d6;border-radius:24px;padding:10px 16px;font-weight:650;box-shadow:0 4px 18px #0005;transition:opacity .2s}
        #launcher.idle{opacity:0;pointer-events:none}
        #launcher:focus-visible{opacity:1;pointer-events:auto}
        #panel{position:absolute;right:24px;top:75px;width:min(350px,calc(100vw - 32px));max-height:calc(100vh - 100px);overflow:auto;pointer-events:auto;background:#17191df5;border:1px solid #ffffff26;border-radius:18px;padding:22px;box-shadow:0 12px 48px #0008}
        header{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px} h1{font-size:22px;margin:0;letter-spacing:-.7px}
        #close{background:none;border:0;color:#aaa;font-size:25px;padding:0 5px}
        .intro{color:#a5a9b3;font-size:13px;margin:0 0 20px;line-height:1.5}
        label{display:block;font-size:12px;color:#c5c8cf;margin:16px 0 7px} select{width:100%;background:#25282e;color:white;border:1px solid #ffffff20;border-radius:9px;padding:11px}
        .row{display:flex;align-items:center;justify-content:space-between;gap:10px}.row label{margin:0}
        #enabled{accent-color:#b6ed8a;width:18px;height:18px} input[type=range]{width:100%;accent-color:#b6ed8a}
        #offset{width:85px;padding:6px;border:1px solid #ffffff30;border-radius:6px;background:#25282e;color:white}
        #status{border-top:1px solid #ffffff18;padding-top:15px;margin:18px 0 0;color:#b3b8c3;line-height:1.5;font-size:12px}
        #retry,#export{color:#c9efab;background:none;border:0;padding:12px 0 0;text-decoration:underline;font-size:12px}
        #captions{position:absolute;inset:0;pointer-events:none}
        .caption{position:absolute;width:max-content;max-width:92%;text-align:center;line-height:1.3;transform:translate(-50%,-50%);white-space:pre-line;unicode-bidi:plaintext;overflow-wrap:anywhere;padding:5px 8px}
        .caption span{box-decoration-break:clone;-webkit-box-decoration-break:clone;border-radius:3px}
        #captions.positioning .caption{pointer-events:auto;cursor:grab;touch-action:none;user-select:none;outline:1px dashed #b6ed8a;border-radius:8px;min-width:150px;min-height:45px}
        #captions.positioning .caption::before{content:attr(data-label);display:block;font:11px system-ui;color:#b6ed8a;background:#17191de8;position:absolute;bottom:100%;left:0;padding:3px 7px;border-radius:5px}
        #captions.positioning .caption.dragging{cursor:grabbing;outline-style:solid}
        #position-toolbar{position:absolute;top:20px;left:50%;transform:translateX(-50%);max-width:90%;pointer-events:auto;background:#17191df5;border:1px solid #ffffff30;padding:10px 14px;border-radius:10px;font-size:13px;text-align:center}
        #position-toolbar button,#move,#reset-appearance{background:#30352c;color:#d5f7b7;border:1px solid #ffffff25;border-radius:7px;padding:7px 10px}
        #position-toolbar button{margin-left:12px}
        details{margin-top:18px;border-top:1px solid #ffffff18;padding-top:14px}summary{cursor:pointer;font-weight:600}
        input[type=color]{width:48px;height:32px;padding:2px;border:1px solid #ffffff30;border-radius:5px;background:#25282e}
        .appearance-row{display:flex;align-items:center;justify-content:space-between;margin-top:14px;gap:10px}.appearance-row label{margin:0}
        #shadow{accent-color:#b6ed8a}#weight{width:130px;padding:7px}
      </style>
      <button id="launcher" aria-expanded="false" aria-controls="panel">subbed · 2 subtitles</button>
      <section id="panel" hidden aria-label="Dual subtitle settings">
        <header><h1>subbed<span style="color:#b6ed8a">.</span></h1><button id="close" aria-label="Close settings">×</button></header>
        <p class="intro">Two languages. One story. <small>v0.1.4</small></p>
        <div class="row"><label for="enabled">Show dual subtitles</label><input id="enabled" type="checkbox"></div>
        <label for="primary">FIRST SUBTITLE</label><select id="primary"><option value="">Waiting for Netflix…</option></select>
        <label for="secondary">SECOND SUBTITLE</label><select id="secondary"><option value="">Waiting for Netflix…</option></select>
        <details id="appearance">
          <summary>Subtitle appearance &amp; position</summary>
          <label for="appearance-track">CUSTOMIZE</label><select id="appearance-track"><option value="0">First subtitle</option><option value="1">Second subtitle</option></select>
          <label for="size">FONT SIZE <span id="size-value"></span></label><input id="size" type="range" min="16" max="64" step="1">
          <div class="appearance-row"><label for="text-color">Text color</label><input id="text-color" type="color"></div>
          <div class="appearance-row"><label for="background-color">Background color</label><input id="background-color" type="color"></div>
          <label for="background-opacity">BACKGROUND OPACITY <span id="opacity-value"></span></label><input id="background-opacity" type="range" min="0" max="100" step="5">
          <div class="appearance-row"><label for="shadow">Text shadow</label><input id="shadow" type="checkbox"></div>
          <div class="appearance-row"><label for="weight">Weight</label><select id="weight"><option value="bold">Bold</option><option value="normal">Normal</option></select></div>
          <label for="placement">POSITION</label><select id="placement"><option value="bottom">Bottom</option><option value="top">Top</option><option value="custom">Custom / dragged</option></select>
          <div class="appearance-row"><button id="move">Drag subtitles</button><button id="reset-appearance">Reset appearance</button></div>
          <p class="intro" style="margin:12px 0 0;font-size:12px">0% opacity removes the background. Drag either caption anywhere on the screen, including the black bars.</p>
        </details>
        <div class="row" style="margin-top:16px"><label for="offset">Timing offset (seconds)</label><input id="offset" type="number" min="-30" max="30" step="0.1"></div>
        <p id="status" role="status">Start a show to discover available subtitle tracks.</p>
        <button id="retry">Refresh track list</button>
        <div style="border-top:1px solid #ffffff18;margin-top:14px">
          <button id="export">Export debug report</button>
          <p id="export-status" class="intro" role="status" style="margin:8px 0 0;font-size:12px">For troubleshooting: play for 20 seconds, switch Netflix’s native subtitle language, then export. Saves network metadata and player track structure locally; no cookies or subtitle text.</p>
        </div>
      </section>
      <div id="captions" hidden>
        <div class="caption" id="caption-0" data-label="First subtitle"><span id="first" dir="auto"></span></div>
        <div class="caption" id="caption-1" data-label="Second subtitle"><span id="second" dir="auto"></span></div>
      </div>
      <div id="position-toolbar" hidden>Drag captions · Arrow keys to fine-tune · Esc to finish <button id="done">Done</button></div>`;
    document.body.append(host);
    $('enabled').checked = settings.enabled;
    syncAppearance();
    $('offset').value = settings.offset;
    const toggle = () => { setPositioning(false); $('panel').hidden = !$('panel').hidden; $('launcher').setAttribute('aria-expanded', String(!$('panel').hidden)); activity(); };
    $('launcher').onclick = toggle;
    $('close').onclick = toggle;
    shadow.addEventListener('keydown', event => { if (event.key === 'Escape') { setPositioning(false); $('panel').hidden = true; $('launcher').setAttribute('aria-expanded', 'false'); activity(); } event.stopPropagation(); });
    for (const name of ['primary', 'secondary']) $(name).onchange = () => { settings[name] = SubbedPreferences.preference(trackList.find(t => t.id === $(name).value)); save(); load(); };
    $('enabled').onchange = () => {
      settings.enabled = $('enabled').checked;
      if (!settings.enabled && !ready) { generation++; cancelNative(); status('Dual subtitles disabled.'); }
      if (settings.enabled && !ready && trackList.length) load();
      save(); render();
    };
    $('appearance-track').onchange = syncAppearance;
    const edit = (field, value) => { settings.appearance[Number($('appearance-track').value)][field] = value; syncAppearance(); save(); render(); };
    $('size').oninput = () => edit('size', Number($('size').value));
    $('text-color').oninput = () => edit('color', $('text-color').value);
    $('background-color').oninput = () => edit('background', $('background-color').value);
    $('background-opacity').oninput = () => edit('opacity', Number($('background-opacity').value));
    $('shadow').onchange = () => edit('shadow', $('shadow').checked);
    $('weight').onchange = () => edit('weight', $('weight').value);
    $('placement').onchange = () => {
      const i = Number($('appearance-track').value), value = $('placement').value;
      if (value !== 'custom') { settings.appearance[i].x = 50; settings.appearance[i].y = value === 'top' ? 8 + i * 8 : 80 + i * 8; }
      save(); render();
    };
    $('reset-appearance').onclick = () => { const i = Number($('appearance-track').value); settings.appearance[i] = SubbedPreferences.appearance({}, i); syncAppearance(); save(); render(); };
    $('move').onclick = () => setPositioning(true);
    $('done').onclick = () => { setPositioning(false); $('launcher').focus(); };
    for (const i of [0, 1]) setupDragging(i);
    document.addEventListener('pointermove', activity, { passive: true });
    document.addEventListener('pointerdown', activity, { passive: true });
    document.addEventListener('keydown', activity, { passive: true });
    $('offset').onchange = () => { settings.offset = Math.min(30, Math.max(-30, Number($('offset').value) || 0)); $('offset').value = settings.offset; save(); render(); };
    $('retry').onclick = () => { fingerprint = ''; cache.clear(); request(); status('Requesting tracks. If none appear, reload this Netflix tab with the extension enabled.'); };
    $('export').onclick = () => {
      exportRequest = crypto.randomUUID();
      $('export').disabled = true;
      $('export-status').textContent = 'Collecting diagnostic report…';
      window.postMessage({ source: 'subbed-export-request', requestId: exportRequest }, location.origin);
      exportTimer = setTimeout(() => {
        exportRequest = null; $('export').disabled = false;
        $('export-status').textContent = 'The page bridge did not respond. Reload Subbed and this Netflix tab, then try again.';
      }, 5000);
    };
    chrome.runtime.onMessage.addListener(message => { if (message.type === 'subbed-toggle-panel') toggle(); });
    request();
  }
  function reset(id) {
    cancelNative();
    setPositioning(false);
    bridgeDiagnostics = null; waitingSince = Date.now();
    titleId = id; generation++; fingerprint = ''; trackList = []; cues = [[], []]; ready = false; cache.clear();
    document.documentElement.removeAttribute('data-subbed-captions');
    if (shadow) {
      for (const key of ['primary', 'secondary']) $(key).replaceChildren(new Option('Waiting for Netflix…', ''));
      status('Waiting for subtitle tracks. If this persists, reload the Netflix tab.');
      $('first').textContent = ''; $('second').textContent = '';
    }
    request();
  }
  async function getCues(track) {
    if (cache.has(track.id)) return cache.get(track.id);
    let lastError;
    for (const source of track.sources) {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'subbed-fetch', url: source.url });
        if (response?.error) throw new Error(response.error);
        if (typeof response?.text !== 'string') throw new Error('No subtitle response. Reload the extension and Netflix.');
        return Subbed.index(Subbed.parse(response.text));
      } catch (error) { lastError = error; }
    }
    if (track.native) return Subbed.index(Subbed.parse(await nativeText(track)));
    throw lastError || new Error('No downloadable text track.');
  }
  async function load() {
    cancelNative();
    const version = ++generation;
    ready = false; cues = [[], []]; render();
    const selected = ['primary', 'secondary'].map(key => trackList.find(t => t.id === $(key).value));
    if (selected.some(track => !track)) { status('Choose two subtitle tracks.'); return; }
    status(selected.some(t => t.native) ? 'Loading through Netflix’s player… Its subtitle language may change briefly while each track loads.' : 'Loading both subtitle tracks…');
    try {
      // Native track acquisition must be serial: Netflix has one selected track.
      const result = [];
      for (const track of selected) {
        if (version !== generation) return;
        const loaded = await getCues(track);
        if (version !== generation) return;
        cache.set(track.id, loaded);
        result.push(loaded);
      }
      if (version !== generation) return;
      result.forEach((value, i) => cache.set(selected[i].id, value));
      cues = result; ready = true;
      status('Both tracks ready. Captions follow playback, pauses, and seeking. Positive timing offsets delay captions.');
    } catch (error) {
      if (version === generation) status(error.message);
    }
    render();
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source === 'subbed-track-result') {
      const pending = nativeRequest;
      if (!pending || event.data.requestId !== pending.id || event.data.movieId !== pending.movieId || event.data.trackId !== pending.trackId) return;
      clearTimeout(pending.timer); nativeRequest = null;
      if (event.data.error) pending.reject(new Error(event.data.error));
      else if (typeof event.data.text === 'string' && event.data.text.length <= 2 * 1024 * 1024) pending.resolve(event.data.text);
      else pending.reject(new Error('Netflix returned an invalid subtitle response.'));
      return;
    }
    if (event.data?.source === 'subbed-export' && exportRequest && event.data.requestId === exportRequest) {
      clearTimeout(exportTimer); exportRequest = null; $('export').disabled = false;
      try {
        const report = { ...event.data.report, extension: { version: '0.1.4', availableTracks: trackList.length, captionsReady: ready } };
        const text = JSON.stringify(report, null, 2);
        if (text.length > 1024 * 1024) throw new Error('Diagnostic report exceeded its size limit. Reload and try again.');
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = `subbed-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        shadow.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        $('export-status').textContent = 'Report downloaded as subbed-debug-….json. Attach that file to the conversation.';
      } catch (error) { $('export-status').textContent = error.message; }
      return;
    }
    if (event.data?.source === 'subbed-diagnostics' && event.data.movieId === watchId()) {
      bridgeDiagnostics = event.data;
      return;
    }
    if (event.data?.source !== 'subbed-manifest' || !Array.isArray(event.data.tracks)) return;
    if (!shadow || String(event.data.movieId) !== watchId()) return;
    if (titleId !== watchId()) reset(watchId());
    const next = Subbed.tracks(event.data.tracks);
    const signature = JSON.stringify(next);
    if (signature === fingerprint) return;
    fingerprint = signature; trackList = next;
    for (const [i, key] of ['primary', 'secondary'].entries()) {
      const previous = $(key).value;
      $(key).replaceChildren(new Option('Choose a language…', ''), ...next.map(track => new Option(track.label, track.id)));
      $(key).value = SubbedPreferences.choose(next, settings[key], previous, i);
    }
    if (!next.length) { ready = false; cues = [[], []]; generation++; render(); status('Netflix exposed no supported text tracks for this title. Try another title or reload.'); }
    else load();
  });
  function render() {
    if (!host) return;
    const id = watchId();
    if (id !== titleId) reset(id);
    host.hidden = !id;
    video = [...document.querySelectorAll('video')].find(v => v.getBoundingClientRect().width > 0);
    const parent = document.fullscreenElement || document.body;
    if (parent && host.parentNode !== parent && parent.tagName !== 'VIDEO') parent.append(host);
    const idleFor = Date.now() - lastActivity;
    const keyboardFocus = shadow.activeElement?.matches(':focus-visible');
    const netflixHidden = video && getComputedStyle(video).cursor === 'none';
    $('launcher').classList.toggle('idle', Boolean(video && !video.paused && !positioning && $('panel').hidden && !keyboardFocus && (idleFor > 2500 || (netflixHidden && idleFor > 400))));
    const visible = Boolean(id && video && ready && settings.enabled && !video.ended);
    document.documentElement.toggleAttribute('data-subbed-captions', visible);
    $('captions').hidden = !visible && !positioning;
    if (!visible && !positioning) return;
    const bounds = host.getBoundingClientRect();
    for (const [index, key] of ['first', 'second'].entries()) {
      const text = visible ? Subbed.active(cues[index], video.currentTime - settings.offset) : '';
      const display = text || (positioning ? (index ? 'Second subtitle' : 'First subtitle') : '');
      if ($(key).textContent !== display) $(key).textContent = display;
      const block = $(`caption-${index}`), appearance = settings.appearance[index];
      block.hidden = !display;
      block.style.fontSize = `${appearance.size}px`;
      block.style.color = appearance.color;
      block.style.fontWeight = appearance.weight === 'bold' ? '600' : '400';
      block.style.textShadow = appearance.shadow ? '0 2px 4px #000,0 0 5px #000' : 'none';
      const hex = appearance.background;
      const background = `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${appearance.opacity / 100})`;
      $(key).style.backgroundColor = background;
      $(key).style.boxShadow = appearance.opacity ? `6px 0 ${background},-6px 0 ${background}` : 'none';
      // Full viewport bounds deliberately include the letterbox bars, not just the video image.
      const halfW = block.offsetWidth / 2, halfH = block.offsetHeight / 2;
      block.style.left = `${Math.max(halfW, Math.min(bounds.width - halfW, bounds.width * appearance.x / 100))}px`;
      block.style.top = `${Math.max(halfH, Math.min(bounds.height - halfH, bounds.height * appearance.y / 100))}px`;
    }
  }
  function syncAppearance() {
    const i = Number($('appearance-track').value), a = settings.appearance[i];
    $('size').value = a.size; $('size-value').textContent = `${Math.round(a.size)}px`;
    $('text-color').value = a.color; $('background-color').value = a.background;
    $('background-opacity').value = a.opacity; $('opacity-value').textContent = a.opacity ? `${a.opacity}%` : '0% · transparent';
    $('shadow').checked = a.shadow; $('weight').value = a.weight;
    $('placement').value = a.x === 50 && a.y === 8 + i * 8 ? 'top' : a.x === 50 && a.y === 80 + i * 8 ? 'bottom' : 'custom';
  }
  function setPositioning(value) {
    positioning = value;
    if (!shadow) return;
    if (!value && dragging) {
      const element = $(`caption-${dragging.index}`), pointer = dragging.pointer;
      dragging = null; element.classList.remove('dragging');
      if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
      save(); syncAppearance();
    }
    $('captions').classList.toggle('positioning', value);
    $('position-toolbar').hidden = !value;
    for (const i of [0, 1]) {
      const element = $(`caption-${i}`);
      element.tabIndex = value ? 0 : -1;
      if (value) { element.setAttribute('role', 'button'); element.setAttribute('aria-label', `Move ${i ? 'second' : 'first'} subtitle with arrow keys`); }
      else { element.removeAttribute('role'); element.removeAttribute('aria-label'); }
    }
    if (value) { $('panel').hidden = true; $('launcher').setAttribute('aria-expanded', 'false'); }
    activity();
  }
  function setupDragging(index) {
    const element = $(`caption-${index}`);
    element.addEventListener('pointerdown', event => {
      if (!positioning || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const rect = element.getBoundingClientRect();
      dragging = { index, pointer: event.pointerId, dx: event.clientX - (rect.left + rect.width / 2), dy: event.clientY - (rect.top + rect.height / 2) };
      element.setPointerCapture(event.pointerId); element.classList.add('dragging'); element.focus();
    });
    element.addEventListener('pointermove', event => {
      if (!dragging || dragging.index !== index || dragging.pointer !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation(); activity();
      const rect = host.getBoundingClientRect(), a = settings.appearance[index];
      a.x = Math.max(0, Math.min(100, (event.clientX - rect.left - dragging.dx) / rect.width * 100));
      a.y = Math.max(0, Math.min(100, (event.clientY - rect.top - dragging.dy) / rect.height * 100));
      render();
    });
    const stop = () => { if (dragging?.index !== index) return; dragging = null; element.classList.remove('dragging'); syncAppearance(); save(); };
    element.addEventListener('pointerup', stop); element.addEventListener('pointercancel', stop); element.addEventListener('lostpointercapture', stop);
    element.addEventListener('click', event => { if (positioning) { event.preventDefault(); event.stopPropagation(); } });
    element.addEventListener('keydown', event => {
      if (!positioning || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const a = settings.appearance[index], step = event.shiftKey ? 5 : .5;
      a.x = Math.max(0, Math.min(100, a.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)));
      a.y = Math.max(0, Math.min(100, a.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)));
      syncAppearance(); save(); render(); activity();
    });
  }

  async function start() {
    try { const data = await chrome.storage.local.get('subbed'); if (data.subbed) settings = { ...settings, ...data.subbed }; } catch { /* Defaults work without stored preferences. */ }
    settings.appearance = [0, 1].map(i => SubbedPreferences.appearance(settings.appearance?.[i], i, Number(settings.size) || 30));
    mount();
    const style = document.createElement('style');
    style.textContent = 'html[data-subbed-captions] .player-timedtext{visibility:hidden!important}';
    document.documentElement.append(style);
    // The video clock is authoritative, including at non-default playback speeds.
    setInterval(render, 80);
    setInterval(() => {
      if (!watchId() || trackList.length) return;
      request();
      if (Date.now() - waitingSince < 10000 || fingerprint) return;
      const diag = bridgeDiagnostics;
      status(!diag
        ? 'The Netflix page bridge is not responding. Reload Subbed in chrome://extensions, then reload this Netflix tab.'
        : `No subtitle manifest detected. Switch Netflix’s native subtitle language, then use Export debug report below. Diagnostics: bridge ${diag.version}; parsed ${diag.parsed}; manifests ${diag.manifests}; player ${diag.player ? 'found' : 'not found'}; player tracks ${diag.playerTracks}.`);
    }, 2500);
    document.addEventListener('fullscreenchange', render);
    document.addEventListener('visibilitychange', render);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
