import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

export type Progress = (current: number, total: number) => void;

const ffmpeg = new FFmpeg();
let loaded = false;

async function load(): Promise<void> {
  if (loaded) return;
  const base = chrome.runtime.getURL("vendor/");
  await ffmpeg.load({
    coreURL: `${base}ffmpeg-core.js`,
    wasmURL: `${base}ffmpeg-core.wasm`
  });
  loaded = true;
}

/**
 * Downloads only a small out-of-order window, then writes buffers to FFmpeg in
 * playlist order. This avoids retaining an additional JS copy of the whole VOD.
 */
export async function remuxTsVod(
  segmentUrls: string[],
  onDownloading: Progress,
  onStatus: (status: string) => void
): Promise<Uint8Array> {
  onStatus("Loading FFmpeg...");
  await load();

  const total = segmentUrls.length;
  const pending = new Map<number, Uint8Array>();
  let started = 0;
  let written = 0;
  let completed = 0;
  let fatal: unknown;
  const parallelism = 4;

  const worker = async (): Promise<void> => {
    while (!fatal) {
      const index = started++;
      if (index >= total) return;
      try {
        const response = await fetch(segmentUrls[index], { credentials: "include" });
        if (!response.ok) throw new Error(`Segment ${index + 1} request failed (${response.status}).`);
        pending.set(index, await fetchFile(response));
        completed += 1;
        onDownloading(completed, total);
        while (pending.has(written)) {
          const data = pending.get(written)!;
          pending.delete(written);
          await ffmpeg.writeFile(`segment-${String(written).padStart(6, "0")}.ts`, data);
          written += 1;
        }
      } catch (error) {
        fatal = error;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(parallelism, total) }, worker));
  if (fatal) throw fatal;
  if (written !== total) throw new Error("Could not preserve the complete segment order.");

  onStatus("Joining HLS segments...");
  const list = Array.from({ length: total }, (_, index) => `file 'segment-${String(index).padStart(6, "0")}.ts'`).join("\n");
  await ffmpeg.writeFile("input.txt", list);

  onStatus("Remuxing TS → MP4...");
  await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "input.txt", "-c", "copy", "-movflags", "+faststart", "output.mp4"]);
  onStatus("Preparing MP4...");
  const output = await ffmpeg.readFile("output.mp4");

  // Delete large virtual-FS inputs immediately after a successful remux.
  await Promise.all(Array.from({ length: total }, (_, index) => ffmpeg.deleteFile(`segment-${String(index).padStart(6, "0")}.ts`)));
  await ffmpeg.deleteFile("input.txt");
  await ffmpeg.deleteFile("output.mp4");
  return output as Uint8Array;
}
