import "./ui.css";
import { fetchAuthorizedResource, resolveVodPlaylist } from "./hls";

const MAX_DIAGNOSTICS = 250;
const SEGMENT_CONCURRENCY = 3;

type BackgroundEvent = {
  target: "content";
  jobId: string;
  type: "event";
  event: "ready" | "status" | "progress" | "diagnostic" | "complete" | "error";
  message?: string;
  current?: number;
  total?: number;
};

function safeName(): string {
  const title = document.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 100) || "video";
  return `${title}.mp4`;
}

function findPlaylist(): string | undefined {
  return performance.getEntriesByType("resource").map((entry) => entry.name).find((url) => /\.m3u8(?:$|[?#])/i.test(url));
}

function mount(): void {
  if (document.querySelector(".hls-downloader")) return;
  const panel = document.createElement("section");
  panel.className = "hls-downloader";
  panel.innerHTML = `
    <div class="hls-downloader__title">HLS Downloader</div>
    <div class="hls-downloader__status">Waiting for an authorized HLS playlist…</div>
    <div class="hls-downloader__progress"><div class="hls-downloader__progress-bar"></div></div>
    <label class="hls-downloader__label">Playlist URL (optional)</label>
    <input class="hls-downloader__input" type="url" placeholder="https://…/video.m3u8" />
    <label class="hls-downloader__diagnostic-toggle"><input type="checkbox" class="hls-downloader__diagnostic-checkbox" /> Show diagnostic log</label>
    <pre class="hls-downloader__diagnostic-log" hidden></pre>
    <button class="hls-downloader__button" type="button">Download MP4</button>`;
  document.documentElement.append(panel);

  const status = panel.querySelector<HTMLDivElement>(".hls-downloader__status")!;
  const progress = panel.querySelector<HTMLDivElement>(".hls-downloader__progress-bar")!;
  const input = panel.querySelector<HTMLInputElement>(".hls-downloader__input")!;
  const button = panel.querySelector<HTMLButtonElement>("button")!;
  const checkbox = panel.querySelector<HTMLInputElement>(".hls-downloader__diagnostic-checkbox")!;
  const log = panel.querySelector<HTMLPreElement>(".hls-downloader__diagnostic-log")!;
  const diagnostics: string[] = [];
  const port = chrome.runtime.connect({ name: "hls-content" });
  let jobId: string | undefined;
  // Keep URLs in the page-context network layer. The offscreen remuxer receives
  // only indexed TS bytes, so it never needs CDN URLs or signed query strings.
  let activeSegments: string[] = [];

  const addDiagnostic = (message: string) => {
    diagnostics.push(`[${new Date().toLocaleTimeString()}] ${message}`);
    if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.splice(0, diagnostics.length - MAX_DIAGNOSTICS);
    log.textContent = diagnostics.join("\n");
    log.scrollTop = log.scrollHeight;
  };
  const setStatus = (message: string) => { status.textContent = message; };
  const setProgress = (value: number) => { progress.style.width = `${Math.max(0, Math.min(100, value))}%`; };
  const fail = (message: string) => { setProgress(0); setStatus(`ERROR: ${message}`); addDiagnostic(`ERROR: ${message}`); button.disabled = false; };

  async function sendSegments(segments: string[], activeJobId: string): Promise<void> {
    let next = 0;
    let transferred = 0;
    let failure: unknown;
    const fetchOne = async (): Promise<void> => {
      while (!failure) {
        const index = next++;
        if (index >= segments.length) return;
        try {
          addDiagnostic(`Fetching segment ${index + 1}/${segments.length} in page content context.`);
          const response = await fetchAuthorizedResource(segments[index], "Segment", addDiagnostic);
          const buffer = await response.arrayBuffer();
          if (!buffer.byteLength) throw new Error(`Segment ${index + 1} was empty.`);
          port.postMessage({ type: "segment", jobId: activeJobId, index, buffer });
          transferred += 1;
          setStatus(`Sending segments ${transferred}/${segments.length}`);
          setProgress((transferred / segments.length) * 75);
        } catch (error) {
          failure = error;
          return;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SEGMENT_CONCURRENCY, segments.length) }, fetchOne));
    if (failure) throw failure;
    port.postMessage({ type: "complete-input", jobId: activeJobId });
    addDiagnostic("All playlist-order-indexed segment buffers were sent to the offscreen remuxer.");
  }

  checkbox.addEventListener("change", () => { log.hidden = !checkbox.checked; });
  const observed = findPlaylist();
  if (observed) {
    input.value = observed;
    setStatus("HLS playlist detected. Confirm you are authorized to download it.");
    addDiagnostic(`Detected page-visible playlist: ${observed}`);
  }

  port.onDisconnect.addListener(() => { if (button.disabled) fail("The extension messaging port disconnected. Reload the extension and page, then retry."); });
  port.onMessage.addListener((message: BackgroundEvent) => {
    if (message.target !== "content" || message.jobId !== jobId) return;
    if (message.event === "diagnostic" && message.message) addDiagnostic(message.message);
    if (message.event === "status" && message.message) setStatus(message.message);
    if (message.event === "progress" && message.current !== undefined && message.total) {
      setStatus(`Writing segment ${message.current}/${message.total}`);
      setProgress(75 + (message.current / message.total) * 17);
    }
    if (message.event === "ready") {
      if (!jobId || !activeSegments.length) {
        fail("No resolved HLS segments are available to send to the offscreen remuxer.");
        return;
      }
      void sendSegments(activeSegments, jobId).catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        port.postMessage({ type: "error", jobId, message: text });
        fail(text);
      });
    }
    if (message.event === "complete") { setProgress(100); setStatus("✓ MP4 download started"); addDiagnostic("MP4 was handed to Chrome Downloads."); button.disabled = false; }
    if (message.event === "error") fail(message.message ?? "Unknown remux error.");
  });

  button.addEventListener("click", () => {
    void (async () => {
      const playlistUrl = input.value.trim() || findPlaylist();
      if (!playlistUrl) { fail("Paste an authorized .m3u8 URL first."); return; }
      button.disabled = true; setProgress(0); jobId = crypto.randomUUID(); activeSegments = [];
      try {
        addDiagnostic("Resolving playlist in the page content context.");
        setStatus("Resolving authorized HLS playlist…");
        const playlist = await resolveVodPlaylist(playlistUrl, addDiagnostic);
        activeSegments = playlist.segments;
        addDiagnostic(`Resolved VOD playlist with ${activeSegments.length} TS segments. Waiting for offscreen remuxer.`);
        port.postMessage({ type: "start", jobId, total: activeSegments.length, filename: safeName() });
      } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
    })();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true }); else mount();
