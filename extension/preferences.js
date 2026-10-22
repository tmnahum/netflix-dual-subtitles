(() => {
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  function appearance(value = {}, index = 0, legacySize = 30) {
    if (!value || typeof value !== 'object') value = {};
    return {
      size: clamp(value.size, 16, 64, index ? legacySize * .85 : legacySize),
      color: /^#[\da-f]{6}$/i.test(value.color) ? value.color : '#ffffff',
      background: /^#[\da-f]{6}$/i.test(value.background) ? value.background : '#000000',
      opacity: clamp(value.opacity, 0, 100, 0),
      shadow: value.shadow !== false,
      weight: value.weight === 'normal' ? 'normal' : 'bold',
      x: clamp(value.x, 0, 100, 50), y: clamp(value.y, 0, 100, index ? 88 : 80)
    };
  }
  function preference(track) {
    return track ? { language: track.language, kind: track.kind, label: track.label } : '';
  }
  function choose(tracks, saved, previous = '', index = 0) {
    if (tracks.some(t => t.id === previous)) return previous;
    if (typeof saved === 'string' && saved) return tracks.find(t => t.language === saved)?.id || '';
    if (saved && typeof saved === 'object') {
      const matches = tracks.filter(t => t.language === saved.language && t.kind === saved.kind);
      return (matches.find(t => t.label === saved.label) || matches[0])?.id || '';
    }
    return tracks[index]?.id || '';
  }
  globalThis.SubbedPreferences = { appearance, preference, choose };
})();
