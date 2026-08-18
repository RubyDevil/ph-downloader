import { resolveVodPlaylist } from "./hls";
import { remuxTsVod } from "./remux";

const LIMIT_BYTES = 750 * 1024 * 1024;

type StartMessage = { target: "offscreen"; type: "start"; jobId: string; playlistUrl: string; filename: string };

function emit(jobId: string, event: string, payload: Record<string, unknown> = {}): void {
  chrome.runtime.sendMessage({ target: "background", type: "offscreen-event", jobId, event, ...payload });
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

chrome.runtime.onMessage.addListener((incoming: StartMessage) => {
  if (incoming?.target !== "offscreen" || incoming.type !== "start") return;
  void (async () => {
    const diagnostic = (entry: string) => emit(incoming.jobId, "diagnostic", { message: entry });
    try {
      diagnostic("Offscreen extension document received job.");
      emit(incoming.jobId, "status", { message: "Resolving authorized HLS playlist…" });
      const playlist = await resolveVodPlaylist(incoming.playlistUrl, diagnostic);
      diagnostic(`Resolved VOD playlist with ${playlist.segments.length} TS segments.`);
      const data = await remuxTsVod(
        playlist.segments,
        (current, total) => emit(incoming.jobId, "progress", { current, total }),
        (status) => emit(incoming.jobId, "status", { message: status }),
        diagnostic
      );
      if (data.byteLength > LIMIT_BYTES) throw new Error("Output exceeds this extension's 750 MB safety limit.");
      const url = URL.createObjectURL(new Blob([data], { type: "video/mp4" }));
      await chrome.downloads.download({ url, filename: incoming.filename, saveAs: true });
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      emit(incoming.jobId, "complete");
    } catch (error) {
      emit(incoming.jobId, "error", { message: message(error) });
    }
  })();
});
