type Job = { tabId: number; contentPort: chrome.runtime.Port };

const jobs = new Map<string, Job>();
let offscreenPort: chrome.runtime.Port | undefined;
let offscreenCreating: Promise<void> | undefined;
let offscreenPortReady: (() => void) | undefined;
let offscreenPortAvailable = new Promise<void>((resolve) => { offscreenPortReady = resolve; });

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL("offscreen.html")]
  });
  if (!contexts.length && !offscreenCreating) {
    offscreenCreating = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: "Run browser-local FFmpeg WebAssembly and create an MP4 Blob for an authorized download."
    }).finally(() => { offscreenCreating = undefined; });
  }
  await offscreenCreating;
  if (!offscreenPort) await offscreenPortAvailable;
}

function emitToContent(jobId: string, message: Record<string, unknown>): void {
  const job = jobs.get(jobId);
  if (job) job.contentPort.postMessage({ target: "content", jobId, ...message });
}

function finishJob(jobId: string): void { jobs.delete(jobId); }

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "hls-offscreen") {
    offscreenPort = port;
    offscreenPortReady?.();
    port.onDisconnect.addListener(() => {
      if (offscreenPort === port) {
        offscreenPort = undefined;
        offscreenPortAvailable = new Promise<void>((resolve) => { offscreenPortReady = resolve; });
      }
    });
    port.onMessage.addListener((message) => {
      if (message?.type !== "event" || typeof message.jobId !== "string") return;
      emitToContent(message.jobId, message);
      if (message.event === "complete" || message.event === "error") finishJob(message.jobId);
    });
    return;
  }

  if (port.name !== "hls-content") return;
  const tabId = port.sender?.tab?.id;
  if (typeof tabId !== "number") { port.disconnect(); return; }

  const ownedJobs = new Set<string>();
  port.onDisconnect.addListener(() => {
    for (const jobId of ownedJobs) {
      jobs.delete(jobId);
      offscreenPort?.postMessage({ type: "cancel", jobId });
    }
  });

  port.onMessage.addListener((message) => {
    const jobId = message?.jobId;
    if (typeof jobId !== "string") return;

    if (message.type === "start") {
      if (jobs.has(jobId)) return;
      jobs.set(jobId, { tabId, contentPort: port });
      ownedJobs.add(jobId);
      void ensureOffscreen()
        .then(() => offscreenPort!.postMessage({
          type: "start",
          jobId,
          total: message.total,
          filename: message.filename
        }))
        .catch((error: unknown) => {
          emitToContent(jobId, { type: "event", event: "error", message: error instanceof Error ? error.message : String(error) });
          finishJob(jobId);
        });
      return;
    }

    if (!jobs.has(jobId)) return;
    if (message.type === "segment" || message.type === "complete-input" || message.type === "error" || message.type === "cancel") {
      offscreenPort?.postMessage(message);
    }
  });
});
