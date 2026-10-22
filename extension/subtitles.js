/* Shared pure cue handling; DOMParser is available in the isolated content world. */
(() => {
  function time(value, rates = {}) {
    if (!value) return NaN;
    const source = value.trim();
    const offset = source.match(/^([\d.]+)(h|m|s|ms|f|t)$/);
    if (offset) return Number(offset[1]) * ({ h: 3600, m: 60, s: 1, ms: .001, f: 1 / (rates.frame || 30), t: 1 / (rates.tick || 1) })[offset[2]];
    const frames = source.match(/^(\d+):(\d{2}):(\d{2}):(\d+(?:\.\d+)?)$/);
    if (frames) return +frames[1] * 3600 + +frames[2] * 60 + +frames[3] + +frames[4] / (rates.frame || 30);
    const parts = source.replace(',', '.').split(':');
    if (parts.length < 2 || parts.length > 3 || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return NaN;
    return parts.reduce((total, part) => total * 60 + Number(part), 0);
  }
  function plain(source) {
    // Parse as inert XML, never insert downloaded HTML into the page.
    const escaped = source.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '');
    return escaped.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, entity) => {
      const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? all;
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).trim();
  }
  function parse(source) {
    source = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const cues = [];
    if (source.trimStart().startsWith('<')) {
      const doc = new DOMParser().parseFromString(source, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('Netflix returned invalid subtitle XML.');
      const root = doc.documentElement;
      const attr = (node, name) => Array.from(node.attributes || []).find(a => a.localName.split(':').pop() === name)?.value;
      const multiplier = (attr(root, 'frameRateMultiplier') || '1 1').split(/\s+/).map(Number);
      const frame = Number(attr(root, 'frameRate') || 30) * multiplier[0] / multiplier[1];
      const rates = { frame, tick: Number(attr(root, 'tickRate') || (attr(root, 'frameRate') ? frame * Number(attr(root, 'subFrameRate') || 1) : 1)) };
      const textOf = node => node.nodeType === 3 ? node.nodeValue : node.localName?.split(':').pop() === 'br' ? '\n' : Array.from(node.childNodes || []).map(textOf).join('');
      function walk(node, parentStart = 0, parentEnd = Infinity) {
        if (node.nodeType !== 1) return;
        const begin = attr(node, 'begin');
        const end = attr(node, 'end');
        const dur = attr(node, 'dur');
        const start = parentStart + (begin ? time(begin, rates) : 0);
        const stop = Math.min(parentEnd, end ? parentStart + time(end, rates) : dur ? start + time(dur, rates) : Infinity);
        if (node.localName.split(':').pop() === 'p') {
          const text = textOf(node).replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
          cues.push({ start, end: stop, text });
        } else for (const child of node.children) walk(child, start, stop);
      }
      walk(root);
    } else {
      for (const block of source.split(/\n[ \t]*\n/)) {
        const lines = block.split('\n');
        if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
        const at = lines.findIndex(line => line.includes('-->'));
        if (at < 0) continue;
        const match = lines[at].match(/^(\S+)\s+-->\s+(\S+)/);
        if (match) cues.push({ start: time(match[1]), end: time(match[2]), text: plain(lines.slice(at + 1).join('\n')) });
      }
    }
    const result = cues.filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && cue.text).sort((a, b) => a.start - b.start);
    if (!result.length) throw new Error('No readable text cues found. This track may use an unsupported image format.');
    return result;
  }
  function index(cues) {
    let max = -Infinity;
    return cues.map(cue => ({ ...cue, maxEnd: max = Math.max(max, cue.end) }));
  }
  function active(cues, seconds) {
    let low = 0, high = cues.length;
    while (low < high) { const mid = (low + high) >>> 1; if (cues[mid].start <= seconds) low = mid + 1; else high = mid; }
    const texts = [];
    for (let i = low - 1; i >= 0 && cues[i].maxEnd > seconds; i--) if (cues[i].end > seconds) texts.unshift(cues[i].text);
    return [...new Set(texts)].join('\n');
  }
  function tracks(raw) {
    return raw.filter(track => track && typeof track === 'object' && !track.isNoneTrack).map((track, i) => {
      const sources = [];
      function collect(value, format = 'unknown', depth = 0) {
        if (!value || depth > 5 || sources.length >= 30) return;
        if (typeof value === 'string') {
          if (/^https:\/\//i.test(value) && !sources.some(source => source.url === value)) sources.push({ format, url: value });
          return;
        }
        if (typeof value !== 'object') return;
        if (Array.isArray(value)) { for (const item of value) collect(item, format, depth + 1); return; }
        for (const [key, item] of Object.entries(value)) {
          if (/image|png|jpeg|bif/i.test(key)) continue;
          const nextFormat = /vtt|dfxp|simplesdh|imsc|ttml/i.test(key) ? key : format;
          collect(item, nextFormat, depth + 1);
        }
      }
      for (const field of ['ttDownloadables', 'downloadables', 'downloadUrls', 'urls']) collect(track[field]);
      sources.sort((a, b) => Number(!/vtt/i.test(a.format)) - Number(!/vtt/i.test(b.format)));
      const language = track.language || track.bcp47 || 'und';
      const base = track.languageDescription || track.displayName || language;
      const cc = /closed.?captions|sdh|^cc$/i.test(track.rawTrackType || '') || /closed.?captions|^cc$/i.test(track.trackType || '') || /\b(?:CC|SDH)\b/i.test(base);
      const forced = Boolean(track.isForcedNarrative);
      const kind = `${cc ? 'cc' : 'subtitles'}${forced ? '-forced' : ''}`;
      const label = `${base}${cc && !/\b(?:CC|SDH)\b/i.test(base) ? ' · CC' : ''}${forced && !/\bforced\b/i.test(base) ? ' · Forced' : ''}`;
      return { id: String(track.new_track_id || track.trackId || `${language}-${i}`), language, kind, label, native: track.subbedNative === true, sources };
    }).filter(track => track.sources.length || track.native);
  }
  globalThis.Subbed = { time, parse, index, active, tracks };
})();
