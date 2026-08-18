import "./ui.css";

const MAX_DIAGNOSTICS = 250;

type EventMessage = {
  target: "content";
  type: "offscreen-event" | "error";
  jobId: string;
  event?: "status" | "progress" | "diagnostic" | "complete" | "error";
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
  let jobId: string | undefined;

  const addDiagnostic = (message: string) => {
    diagnostics.push(`[${new Date().toLocaleTimeString()}] ${message}`);
    if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.splice(0, diagnostics.length - MAX_DIAGNOSTICS);
    log.textContent = diagnostics.join("\n");
    log.scrollTop = log.scrollHeight;
  };
  const setStatus = (message: string) => { status.textContent = message; };
  const setProgress = (value: number) => { progress.style.width = `${Math.max(0, Math.min(100, value))}%`; };

  checkbox.addEventListener("change", () => { log.hidden = !checkbox.checked; });
  const observed = findPlaylist();
  if (observed) {
    input.value = observed;
    setStatus("HLS playlist detected. Confirm you are authorized to download it.");
    addDiagnostic(`Detected page-visible playlist: ${observed}`);
  }

  chrome.runtime.onMessage.addListener((message: EventMessage) => {
    if (message.target !== "content" || message.jobId !== jobId) return;
    if (message.type === "error" || message.event === "error") {
      setProgress(0); setStatus(`ERROR: ${message.message}`); addDiagnostic(`ERROR: ${message.message}`); button.disabled = false; return;
    }
    if (message.event === "status" && message.message) setStatus(message.message);
    if (message.event === "diagnostic" && message.message) addDiagnostic(message.message);
    if (message.event === "progress" && message.current !== undefined && message.total) {
      setStatus(`Downloading ${message.current}/${message.total}`);
      setProgress((message.current / message.total) * 92);
    }
    if (message.event === "complete") {
      setProgress(100); setStatus("✓ MP4 download started"); addDiagnostic("MP4 was handed to Chrome Downloads."); button.disabled = false;
    }
  });

  button.addEventListener("click", () => {
    const playlistUrl = input.value.trim() || findPlaylist();
    if (!playlistUrl) { setStatus("ERROR: Paste an authorized .m3u8 URL first."); return; }
    jobId = crypto.randomUUID();
    button.disabled = true; setProgress(0);
    setStatus("Preparing extension remuxer…");
    addDiagnostic(`Starting job ${jobId}; requesting offscreen FFmpeg document.`);
    chrome.runtime.sendMessage({ target: "background", type: "start", jobId, playlistUrl, filename: safeName() });
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true }); else mount();
