# Authorized HLS VOD Downloader

A Chromium Manifest V3 extension for **authorized, unencrypted HLS VOD media**. It resolves an HLS master/media playlist, preserves `.ts` order, and remuxes to MP4 locally with FFmpeg.wasm.

## Important limits

- Use only for media you own or are explicitly authorized to download.
- The extension does not intercept player Web Workers, bypass DRM, replay protected player requests, alter signed URLs, or work around CDN authorization failures.
- It supports completed VOD playlists with ordinary MPEG-TS (`.ts`) segments; it rejects encryption keys, session keys, fMP4 maps, and live playlists.
- Playlist and segment requests must be reachable through the extension's normal authorized fetch path. A `401`, `403`, or `412` is surfaced as an observable HTTP error.
- FFmpeg.wasm retains input/output in its virtual filesystem. The current implementation uses a four-request segment window and a 750 MB output safety limit.

## Diagnostics

Enable **Show diagnostic log** in the panel before starting a job. Fetch diagnostics distinguish:

- an observable HTTP response, including status code and status text; from
- a request blocked before the browser exposes any HTTP response (for example, browser CORS/network policy, DNS/TLS failure, or an unavailable extension fetch context).

For safety, the diagnostic display records the URL origin and path but omits query strings, which can contain temporary authorization parameters.

## Build and load

```bash
npm install
npm run build
```

Load `dist/` as an unpacked extension from `chrome://extensions`, then refresh an ordinary `http` or `https` page.

## MV3 offscreen architecture

The page content script only renders the panel. When a download starts, it sends a job through the MV3 service worker. The worker creates `offscreen.html`, and the offscreen document runs FFmpeg, its class worker, and WebAssembly from the extension's own `chrome-extension://` origin. Progress and diagnostics are relayed back to the panel; the offscreen document hands the completed MP4 to Chrome Downloads.

This separation prevents the page-origin error caused by constructing an extension Worker from a content script. It does not grant access to streams the extension is not authorized to fetch.
