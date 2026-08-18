import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

export type Progress = (current: number, total: number) => void;
export type Diagnostic = (message: string) => void;

const ffmpeg = new FFmpeg();
const LOAD_TIMEOUT_MS = 30_000;
let loaded = false;
let loggingAttached = false;

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function load(diagnostic: Diagnostic): Promise<void> {
  if (loaded) return;
  if (!loggingAttached) {
    ffmpeg.on("log", ({ type, message }) => diagnostic(`ffmpeg ${type}: ${message}`));
    loggingAttached = true;
  }

  const vendor = chrome.runtime.getURL("vendor/");
  diagnostic("Starting FFmpeg class worker…");
  try {
    await Promise.race([
      ffmpeg.load({
        // worker.js is the @ffmpeg/ffmpeg wrapper worker. It imports const.js
        // and errors.js beside it, so all three are packaged in vendor/.
        classWorkerURL: `${vendor}worker.js`,
        // This project uses the single-threaded @ffmpeg/core package. Do not
        // provide workerURL: that option is only for core-mt's pthread worker.
        coreURL: `${vendor}ffmpeg-core.js`,
        wasmURL: `${vendor}ffmpeg-core.wasm`
      }),
      new Promise<never>((_, reject) => window.setTimeout(
        () => reject(new Error("FFmpeg did not initialize within 30 seconds. Check the diagnostic log and the extension Errors view.")),
        LOAD_TIMEOUT_MS
      ))
    ]);
  } catch (error) {
    diagnostic(`FFmpeg initialization failed: ${detail(error)}`);
    throw error;
  }
  loaded = true;
  diagnostic("FFmpeg initialized successfully.");
}

/**
 * Downloads only a small out-of-order window, then writes buffers to FFmpeg in
 * playlist order. This avoids retaining an additional JS copy of the whole VOD.
 */
export async function remuxTsVod(
  segmentUrls: string[],
  onDownloading: Progress,
  onStatus: (status: string) => void,
  diagnostic: Diagnostic
): Promise<Uint8Array> {
  onStatus("Loading FFmpeg...");
  await load(diagnostic);

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
        diagnostic(`Fetching segment ${index + 1}/${total}`);
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
        diagnostic(`Segment failure: ${detail(error)}`);
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(parallelism, total) }, worker));
  if (fatal) throw fatal;
  if (written !== total) throw new Error("Could not preserve the complete segment order.");

  onStatus("Joining HLS segments...");
  diagnostic("Writing FFmpeg concat input list.");
  const list = Array.from({ length: total }, (_, index) => `file 'segment-${String(index).padStart(6, "0")}.ts'`).join("\n");
  await ffmpeg.writeFile("input.txt", list);

  onStatus("Remuxing TS → MP4...");
  diagnostic("Starting stream-copy MP4 remux.");
  await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "input.txt", "-c", "copy", "-movflags", "+faststart", "output.mp4"]);
  onStatus("Preparing MP4...");
  const output = await ffmpeg.readFile("output.mp4");
  diagnostic("MP4 output read successfully.");

  await Promise.all(Array.from({ length: total }, (_, index) => ffmpeg.deleteFile(`segment-${String(index).padStart(6, "0")}.ts`)));
  await ffmpeg.deleteFile("input.txt");
  await ffmpeg.deleteFile("output.mp4");
  return output as Uint8Array;
}
