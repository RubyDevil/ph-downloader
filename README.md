# Authorized HLS VOD Downloader

A Chromium Manifest V3 extension for **authorized, unencrypted HLS VOD media**. It resolves an HLS master/media playlist, preserves `.ts` order, and remuxes to MP4 locally with FFmpeg.wasm.

## Important limits

- Use only for media you own or are explicitly authorized to download.
- The extension does not bypass DRM, replay protected player requests, alter signed URLs, or work around CDN authorization failures.
- It supports completed VOD playlists with ordinary MPEG-TS (`.ts`) segments; it rejects encryption keys, session keys, fMP4 maps, and live playlists.
- The content script uses the browser context that has access to the authorized HLS source. If that context cannot fetch a playlist or segment, the UI reports the observable HTTP failure or browser-level network/CORS failure.
- FFmpeg.wasm retains input/output in its virtual filesystem. The current implementation uses three concurrent page-context segment fetches and a 750 MB output safety limit.

## Architecture

1. The content script fetches and parses the master playlist and selected media playlist, preserving every signed relative URL parameter.
2. The content script fetches TS segment bytes with controlled concurrency and sends binary `ArrayBuffer` messages over a persistent runtime port.
3. The MV3 service worker relays those messages to the offscreen document.
4. The offscreen document writes received buffers to FFmpeg's virtual filesystem strictly by playlist index, then remuxes with `-c copy` and starts the Chrome download.

## Chrome requirement

The extension requires Chrome 148 or newer. It opts into Chrome extension structured-clone message serialization so segment buffers are sent as binary data rather than base64 or JSON strings. Chrome's current extension messaging implementation still copies these buffers rather than detaching/transferring ownership, so the UI intentionally limits concurrent fetches to keep memory bounded.

## Build and load

```bash
npm install
npm run build
```

Load `dist/` as an unpacked extension from `chrome://extensions`, then refresh an ordinary `http` or `https` page.
