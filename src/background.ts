const jobs = new Map<string, number>();
let offscreenCreating: Promise<void> | undefined;

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL("offscreen.html")]
  });
  if (existing.length) return;
  if (!offscreenCreating) {
    offscreenCreating = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: "Run browser-local FFmpeg WebAssembly and create an MP4 Blob for an authorized download."
    }).finally(() => { offscreenCreating = undefined; });
  }
  await offscreenCreating;
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.target === "background" && message.type === "start") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return;
    jobs.set(message.jobId, tabId);
    void ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ ...message, target: "offscreen" }))
      .catch((error: unknown) => chrome.tabs.sendMessage(tabId, {
        target: "content", type: "error", jobId: message.jobId,
        message: error instanceof Error ? error.message : String(error)
      }));
    return;
  }

  if (message?.target === "background" && message.type === "offscreen-event") {
    const tabId = jobs.get(message.jobId);
    if (typeof tabId === "number") void chrome.tabs.sendMessage(tabId, { ...message, target: "content" });
    if (message.event === "complete" || message.event === "error") jobs.delete(message.jobId);
  }
});
