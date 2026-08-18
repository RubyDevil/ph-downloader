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

`content.js` is deliberately built as a single classic IIFE bundle rather than an ES module. This is required because Chromium injects manifest content scripts as classic scripts; it prevents the `Cannot use 'import.meta' outside a module` error.

## Architecture

- `src/content.ts` injects the fixed downloader panel, locates a page-visible playlist URL, drives progress, and triggers the browser download.
- `src/hls.ts` resolves master playlists to the highest advertised bandwidth rendition and parses VOD TS media playlists.
- `src/remux.ts` loads browser-local FFmpeg core assets, fetches segments with bounded concurrency, writes files strictly in manifest order, and invokes `-c copy` remuxing.
- `src/ui.css` contains the charcoal/orange panel style.

The `npm run build` command copies FFmpeg core assets from `node_modules` into the packaged extension, so no server, native executable, local backend, or conversion service is used at runtime.
