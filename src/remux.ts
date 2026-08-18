import { FFmpeg } from "@ffmpeg/ffmpeg";

export type Diagnostic = (message: string) => void;
export type Progress = (current: number, total: number) => void;

const ffmpeg = new FFmpeg();
const LOAD_TIMEOUT_MS = 30_000;
let loaded = false;
let loggingAttached = false;

function detail(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function segmentPath(index: number): string {
  return `/segment-${String(index).padStart(6, "0")}.ts`;
}

async function load(diagnostic: Diagnostic): Promise<void> {
  if (loaded) return;
  if (!loggingAttached) { ffmpeg.on("log", ({ type, message }) => diagnostic(`ffmpeg ${type}: ${message}`)); loggingAttached = true; }
  const vendor = chrome.runtime.getURL("vendor/");
  diagnostic("Starting FFmpeg in extension-owned offscreen document…");
  try {
    await Promise.race([
      ffmpeg.load({ classWorkerURL: `${vendor}worker.js`, coreURL: `${vendor}ffmpeg-core.js`, wasmURL: `${vendor}ffmpeg-core.wasm` }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("FFmpeg did not initialize within 30 seconds. Check the diagnostic log and extension Errors view.")), LOAD_TIMEOUT_MS))
    ]);
  } catch (error) { diagnostic(`FFmpeg initialization failed: ${detail(error)}`); throw error; }
  loaded = true;
  diagnostic("FFmpeg initialized successfully.");
}

export class SegmentRemuxJob {
  private readonly pending = new Map<number, ArrayBuffer>();
  private writeChain = Promise.resolve();
  private nextIndex = 0;
  private cancelled = false;

  constructor(private readonly total: number, private readonly progress: Progress, private readonly diagnostic: Diagnostic) {}

  async initialize(): Promise<void> { await load(this.diagnostic); }

  accept(index: number, buffer: ArrayBuffer): void {
    if (this.cancelled) return;
    if (index < 0 || index >= this.total) throw new Error(`Received invalid segment index ${index}.`);
    this.pending.set(index, buffer);
    this.scheduleDrain();
  }

  cancel(): void { this.cancelled = true; this.pending.clear(); }

  private scheduleDrain(): void {
    this.writeChain = this.writeChain.then(async () => {
      while (!this.cancelled && this.pending.has(this.nextIndex)) {
        const buffer = this.pending.get(this.nextIndex)!;
        this.pending.delete(this.nextIndex);
        await ffmpeg.writeFile(segmentPath(this.nextIndex), new Uint8Array(buffer));
        this.nextIndex += 1;
        this.progress(this.nextIndex, this.total);
      }
    });
  }

  async complete(): Promise<Uint8Array> {
    await this.writeChain;
    if (this.cancelled) throw new Error("The download was cancelled.");
    if (this.nextIndex !== this.total) throw new Error(`Expected ${this.total} segments but received ${this.nextIndex} in playlist order.`);

    const inputPath = "/input.txt";
    const outputPath = "/output.mp4";
    this.diagnostic("Writing FFmpeg concat input list with absolute virtual filesystem paths.");
    await ffmpeg.writeFile(inputPath, Array.from({ length: this.total }, (_, index) => `file '${segmentPath(index)}'`).join("\n"));

    this.diagnostic("Starting stream-copy MP4 remux.");
    await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", inputPath, "-c", "copy", "-movflags", "+faststart", outputPath]);
    const output = await ffmpeg.readFile(outputPath);

    await Promise.all(Array.from({ length: this.total }, (_, index) => ffmpeg.deleteFile(segmentPath(index))));
    await ffmpeg.deleteFile(inputPath);
    await ffmpeg.deleteFile(outputPath);
    return output as Uint8Array;
  }
}
