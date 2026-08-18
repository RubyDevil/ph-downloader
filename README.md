# Authorized HLS VOD Downloader

A Chromium Manifest V3 extension for **authorized, unencrypted HLS VOD media**. It resolves an HLS master/media playlist, preserves `.ts` segment order, and remuxes the result to MP4 locally with FFmpeg.wasm.

## Important limits

- Use only for media you own or are explicitly authorized to download.
- This project does **not** intercept Web Workers, bypass DRM, replay protected player requests, alter signed URLs, or work around CDN authorization failures.
- It supports completed VOD playlists with ordinary MPEG-TS (`.ts`) segments. It rejects `#EXT-X-KEY`, session keys, `#EXT-X-MAP`/fMP4, and live playlists.
- The source needs to be accessible to an ordinary in-browser `fetch` in the extension's content-script context. A 401/403/412 response means the source is not available through that supported path.
- FFmpeg.wasm needs substantial memory. Segment transfer is bounded to a four-request window and written in playlist order, but FFmpeg's virtual filesystem still stores the input and output. The UI applies a 750 MB output safety limit.

## Build and load

```bash
npm install
npm run build
```

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. If you previously loaded this extension, click its reload button after rebuilding. Otherwise select **Load unpacked** and choose `dist/`.
4. Refresh a normal `http` or `https` webpage. The fixed panel appears in the top-right corner.
5. On an authorized page, paste an HLS `.m3u8` URL into the panel, or use a page-visible playlist URL detected through the Performance API.
6. Select **Download MP4**.
7. Enable **Show diagnostic log** to see the latest FFmpeg startup, segment, and remux events. The panel retains the latest 250 events and its scrollable viewport shows roughly five lines.

## FFmpeg packaging

This project uses the single-threaded `@ffmpeg/core` package. Its core JavaScript and WASM files are copied from `@ffmpeg/core/dist/umd`. Its **class worker** is `@ffmpeg/ffmpeg/dist/esm/worker.js`, which imports `const.js` and `errors.js`; all three are copied to `dist/vendor/` and exposed as extension resources.

`workerURL` is deliberately not configured: that setting is for the pthread worker used by the separate multithreaded `@ffmpeg/core-mt` package. The extension instead configures `classWorkerURL`, `coreURL`, and `wasmURL`, and shows a timeout error after 30 seconds rather than leaving the UI indefinitely at **Loading FFmpeg…**.

## Architecture

- `src/content.ts` injects the fixed downloader panel, locates a page-visible playlist URL, drives progress, displays diagnostics, and triggers the browser download.
- `src/hls.ts` resolves master playlists to the highest advertised bandwidth rendition and parses VOD TS media playlists.
- `src/remux.ts` loads browser-local FFmpeg worker/core assets, fetches segments with bounded concurrency, writes files strictly in manifest order, and invokes `-c copy` remuxing.
- `src/ui.css` contains the charcoal/orange panel style and scrollable diagnostic log.
