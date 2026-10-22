const MAX_BYTES = 8 * 1024 * 1024;
function allowed(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.nflxvideo.net') && !parsed.username && !parsed.password && (!parsed.port || parsed.port === '443');
  } catch { return false; }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'subbed-fetch') return;
  if (!sender.tab || !sender.url?.startsWith('https://www.netflix.com/') || !allowed(message.url)) {
    reply({ error: 'Subtitle URL is not an allowed Netflix CDN address.' });
    return;
  }
  (async () => {
    const response = await fetch(message.url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Subtitle download failed (${response.status}). Refresh Netflix to renew the track links.`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Subtitle file is too large.'); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  })().then(text => reply({ text }), error => reply({ error: error.message }));
  return true;
});
chrome.action.onClicked.addListener(tab => {
  if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'subbed-toggle-panel' }).catch(() => {});
});
