# Subbed

A Chrome extension that displays two Netflix subtitle tracks together, synchronized to the video clock. Pick both tracks in the on-screen **subbed** panel. No build step, API key, translation service, or external account is required beyond your Netflix access.

## Install

1. Open `chrome://extensions` in Chrome 111 or newer.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this project's **extension** folder (the folder containing `manifest.json`).
4. Reload any already-open Netflix tabs, then start a show at `www.netflix.com`.
5. Click **subbed · 2 subtitles** in the upper-right corner and choose your first and second languages.

Load the folder, not the ZIP or the project root. Keep the folder in place while the extension is installed. If using the release ZIP, extract it first and load the extracted `extension` folder.

## Updating to 0.1.4

Replace the files in the folder Chrome originally loaded (downloading a new ZIP alone does not update it). Click **Reload** on the Subbed card at `chrome://extensions`, then reload Netflix. The panel should show **v0.1.4**.

Version 0.1.4 adds independent subtitle appearance controls, draggable screen positions, and an idle-fading menu button. English and English CC are distinctly labeled and remembered across episodes.

Subbed supports player tracks with no download URLs. If manifest discovery is unavailable, Subbed lists Netflix's native text tracks and briefly selects each chosen track to capture its normal subtitle download. The two loads run in sequence, then the original native selection is restored. Captured text stays in memory and is not included in diagnostic exports.

The native subtitle language may change briefly while tracks load. Each load times out after 12 seconds and restores the prior selection if you have not manually changed it or switched episodes. If Netflix serves a track entirely from its internal cache and produces no network response, Subbed cannot capture that file: select the language in Netflix's own menu and retry, or reload the tab. Exact track IDs keep CC and regular variants distinct.

## Export a troubleshooting report

1. Reload Netflix with version 0.1.4 enabled, then play a show for about 20 seconds.
2. Turn on subtitles in Netflix's own menu and switch to a different subtitle language once.
3. Open Subbed and click **Export debug report**.
4. Attach the downloaded `subbed-debug-….json` file to the troubleshooting conversation.

The report includes the most recent 300 network observations (page fetch/XHR and resource timing), counts of dropped entries, up to 30 response-structure summaries, player method names, and the shapes of up to 60 player track objects. A resource-timing entry and a fetch entry can refer to the same request. Network status 0 means unavailable, not necessarily failure.

No cookies, authorization headers, request bodies, response text, subtitle dialogue, full URLs, URL paths, query parameters, or arbitrary player field values are exported. Hostnames, endpoint categories, timing/size/status metadata, field names and types, and subtitle language codes are included. Data stays in a bounded in-memory buffer until you export it manually; there is no upload. Reloading the page clears the buffer.

This is **page-level diagnostic capture**, not a complete HAR or packet capture. Worker-only requests and browser-internal traffic can be missing. Encrypted Netflix manifest payloads are not decrypted. Media and license bodies are not read; candidate text response copies are limited to 2 MiB, two concurrent readers, and four seconds. No additional extension permissions are needed.

## Controls

- Two independent track selectors, including exposed CC and forced-narrative variants.
- Open **Subtitle appearance & position**, choose **First subtitle** or **Second subtitle**, and customize font size (16–64 px), text color, background color/opacity, shadow, and weight independently.
- Backgrounds default to **0% opacity (fully transparent)**, with white text and a dark shadow. Set opacity to 0% to remove both the colored background and its padding shadow.
- Use the **Top** or **Bottom** preset for either track, or click **Drag subtitles**. Drag each caption anywhere in the viewport, including the black bars. Click **Done** or press Escape when finished. In positioning mode, captions remain draggable even during a dialogue gap.
- Positioning also supports arrow keys (hold Shift for larger moves). Positions are saved as percentages so they adapt to window size and fullscreen. **Reset appearance** resets only the currently selected track's style and position.
- The menu starts closed. Its button fades after roughly **2.5 seconds without pointer movement during playback**, or sooner when Netflix hides the video cursor. Moving the pointer brings it back. It stays visible while paused, editing settings, positioning captions, or focused with the keyboard.
- A shared timing offset; positive offsets delay both captions.
- A toggle that restores Netflix's own captions when dual subtitles are disabled.
- Close the settings panel with × or Escape; reopen it with the on-screen button or extension toolbar icon.
- Preferences are saved locally, including appearance, positions, and regular/CC/forced track type. If a saved variant is unavailable on the next episode, select a track explicitly; Subbed does not silently replace English CC with regular English.
- Captions follow seeks, pauses, playback speed, and fullscreen on the player container.

## Scope and limits

“Any two” means two **text subtitle tracks supplied by Netflix for the current title and account/region**. The extension requests all available subtitle languages, but cannot supply missing languages, translate dialogue, or bypass title restrictions. WebVTT and common TTML/DFXP text tracks are supported; image subtitles, complex TTML layouts, and word-level animated styling are not.

Netflix has no supported public subtitle API. The extension observes manifest JSON and, when needed, uses the native player track list and captures normal subtitle downloads by briefly selecting the requested tracks. Netflix player changes can break discovery. If the list stays empty, refresh the Netflix tab after enabling the extension, start playback, and try selecting a native Netflix subtitle. Track URLs expire; refresh the page if downloads fail. Netflix's existing captions remain available until both selected tracks load successfully.

The overlay is designed for the normal Netflix web player and its fullscreen container. It does not appear in Chrome's separate picture-in-picture window, casting, or a native video-only fullscreen surface. DRM video is not read, recorded, or modified.

## Privacy and permissions

The extension runs only on `https://www.netflix.com/*`. The service worker downloads chosen subtitle files from HTTPS subdomains of `nflxvideo.net`, without cookies or redirects, with a size limit and timeout. `storage` saves display and language preferences locally. There is no analytics, upload, remote script, or backend. Diagnostic metadata is kept in a bounded memory buffer and can be exported manually. Subtitle text stays in memory while viewing. Native acquisition caches at most 12 subtitle files of up to 2 MiB each; it does not save subtitle files to disk.

## Development and validation

```sh
pnpm install
pnpm test
pnpm check
node tests/serve.mjs
```

The fixture is at `http://127.0.0.1:5173/watch/123`. Its `?native=1` mode uses a mock native player and XHRs to `https://fixture.nflxvideo.net/en` and `/ja`; browser tests intercept those addresses with local XML samples (they are not live subtitle endpoints). It mocks manifest delivery and subtitle downloads to exercise the actual content script; it is not a Netflix integration test. Runtime extension files have no dependencies.

Validated locally:

- Variant preference regression tests for English versus English CC, including changed track IDs on subsequent episodes.
- Chrome fixture checks for independent appearance, transparent backgrounds, top placement, dragging into letterbox space, persistence on reload, idle fade/wake, fullscreen reparenting, keyboard positioning, and resizing.

- Automated parser tests for Unicode, WebVTT cue settings, overlapping cues, TTML namespaces, ticks, frames, inherited timing, and malformed/unsupported content.
- Manifest interception tests for title filtering, early-manifest replay, request profiles, and JSON reviver/replacer preservation.
- Diagnostic tests for bounded buffers, sensitive-value redaction, caller response preservation, fetch rejection behavior, and media/license body exclusions.
- Download boundary tests for origin/CDN checks, cookie omission, redirect rejection, and HTTP errors.
- Browser fixture checks for native-player acquisition of two XML tracks without a manifest, restoration to the original Off selection, seeking, and disabling dual subtitles.
- Native acquisition tests cover exact track IDs, cached captures, stale network responses, cancellation, timeout, manual selection preservation, and episode changes.
- Browser fixture check that the diagnostic export downloads valid JSON without interrupting captions or producing page errors.
- Browser fixture checks for dual captions, forward/backward seeks, disable/restore, navigation to a new episode, and download failure fallback.

**The user confirmed live Netflix playback works with v0.1.3.** The v0.1.4 appearance and placement changes were verified in local Chrome fixtures; they have not yet been confirmed in the user's Netflix session. The fixture cannot validate future Netflix player changes.

Resource capture uses the [Resource Timing API](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming).

Implementation references: [Chrome content-script execution worlds](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts) and [observed Netflix manifest fields](https://github.com/plateaukao/NetflixSubtitleDownloader/blob/master/inject.js). This extension is an independent implementation and is not affiliated with Netflix.
