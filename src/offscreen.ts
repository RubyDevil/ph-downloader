import { SegmentRemuxJob } from "./remux";

type Start = { type: "start"; jobId: string; total: number; filename: string };
type Segment = { type: "segment"; jobId: string; index: number; buffer: ArrayBuffer };
type Complete = { type: "complete-input"; jobId: string };
type Cancel = { type: "cancel"; jobId: string };
type Failure = { type: "error"; jobId: string; message: string };

type RunningJob = { remux: SegmentRemuxJob; filename: string };
const jobs = new Map<string, RunningJob>();
const port = chrome.runtime.connect({ name: "hls-offscreen" });

function emit(jobId: string, event: string, payload: Record<string, unknown> = {}): void {
  port.postMessage({ type: "event", jobId, event, ...payload });
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

port.onMessage.addListener((message: Start | Segment | Complete | Cancel | Failure) => {
  void (async () => {
    if (message.type === "start") {
      try {
        if (jobs.size) throw new Error("Another remux job is already running.");
        emit(message.jobId, "status", { message: "Loading FFmpeg…" });
        const remux = new SegmentRemuxJob(
          message.total,
          (current, total) => emit(message.jobId, "progress", { current, total }),
          (entry) => emit(message.jobId, "diagnostic", { message: entry })
        );
        await remux.initialize();
        jobs.set(message.jobId, { remux, filename: message.filename });
        emit(message.jobId, "ready");
      } catch (error) { emit(message.jobId, "error", { message: errorText(error) }); }
      return;
    }

    const job = jobs.get(message.jobId);
    if (!job) return;
    if (message.type === "segment") { job.remux.accept(message.index, message.buffer); return; }
    if (message.type === "cancel") { job.remux.cancel(); jobs.delete(message.jobId); return; }
    if (message.type === "error") { job.remux.cancel(); jobs.delete(message.jobId); emit(message.jobId, "error", { message: message.message }); return; }
    if (message.type === "complete-input") {
      try {
        emit(message.jobId, "status", { message: "Joining HLS segments…" });
        const data = await job.remux.complete();
        emit(message.jobId, "status", { message: "Preparing MP4…" });
        const url = URL.createObjectURL(new Blob([data], { type: "video/mp4" }));
        await chrome.downloads.download({ url, filename: job.filename, saveAs: true });
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        emit(message.jobId, "complete");
      } catch (error) { emit(message.jobId, "error", { message: errorText(error) }); }
      finally { jobs.delete(message.jobId); }
    }
  })();
});
