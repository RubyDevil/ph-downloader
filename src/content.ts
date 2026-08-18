import "./ui.css";
import { resolveVodPlaylist } from "./hls";
import { remuxTsVod } from "./remux";

const LIMIT_BYTES = 750 * 1024 * 1024;

function safeName(): string {
  const title = document.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 100) || "video";
  return `${title}.mp4`;
}

function findPlaylist(): string | undefined {
  return performance.getEntriesByType("resource")
    .map((entry) => entry.name)
    .find((url) => /\.m3u8(?:$|[?#])/i.test(url));
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
    <button class="hls-downloader__button" type="button">Download MP4</button>
  `;
  document.documentElement.append(panel);

  const status = panel.querySelector<HTMLDivElement>(".hls-downloader__status")!;
  const progress = panel.querySelector<HTMLDivElement>(".hls-downloader__progress-bar")!;
  const input = panel.querySelector<HTMLInputElement>(".hls-downloader__input")!;
  const button = panel.querySelector<HTMLButtonElement>("button")!;
  const observed = findPlaylist();
  if (observed) {
    input.value = observed;
    status.textContent = "HLS playlist detected. Confirm you are authorized to download it.";
  }

  const setStatus = (message: string) => { status.textContent = message; };
  const setProgress = (value: number) => { progress.style.width = `${Math.max(0, Math.min(100, value))}%`; };

  button.addEventListener("click", async () => {
    button.disabled = true;
    setProgress(0);
    try {
      const url = input.value.trim() || findPlaylist();
      if (!url) throw new Error("Paste an authorized .m3u8 URL, or play a page-visible HLS video first.");
      setStatus("HLS playlist detected");
      const playlist = await resolveVodPlaylist(url);
      setStatus(`Downloading 0/${playlist.segments.length}`);
      const data = await remuxTsVod(
        playlist.segments,
        (current, total) => {
          setStatus(`Downloading ${current}/${total}`);
          setProgress((current / total) * 92);
        },
        setStatus
      );
      if (data.byteLength > LIMIT_BYTES) throw new Error("Output exceeds this extension's 750 MB safety limit.");
      const blob = new Blob([data], { type: "video/mp4" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = safeName();
      link.click();
      setProgress(100);
      setStatus("✓ MP4 downloaded");
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      setProgress(0);
      setStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      button.disabled = false;
    }
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
else mount();
