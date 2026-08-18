export type MediaPlaylist = {
  playlistUrl: string;
  segments: string[];
};

export type Diagnostic = (message: string) => void;

const textLines = (source: string) => source.replace(/\r/g, "").split("\n").map((line) => line.trim());

function describeUrl(value: string): string {
  const url = new URL(value);
  // Do not copy signed query-string values into the in-panel log.
  return `${url.origin}${url.pathname}${url.search ? "?[query omitted]" : ""}`;
}

function failureMessage(kind: "Playlist" | "Segment", url: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(detail)) {
    return `${kind} fetch was blocked before an HTTP response was available for ${describeUrl(url)}. This usually indicates browser network/CORS policy, DNS/TLS failure, or a source unavailable to the extension's fetch context.`;
  }
  return `${kind} fetch failed for ${describeUrl(url)}: ${detail}`;
}

export async function fetchAuthorizedResource(url: string, kind: "Playlist" | "Segment", diagnostic?: Diagnostic): Promise<Response> {
  diagnostic?.(`${kind} fetch: ${describeUrl(url)} (credentials: include).`);
  let response: Response;
  try {
    response = await fetch(url, { credentials: "include" });
  } catch (error) {
    const message = failureMessage(kind, url, error);
    diagnostic?.(message);
    throw new Error(message, { cause: error });
  }

  diagnostic?.(`${kind} response: HTTP ${response.status} ${response.statusText || "(no status text)"}; type=${response.type}; redirected=${response.redirected}.`);
  if (!response.ok) {
    const message = `${kind} request returned observable HTTP ${response.status} ${response.statusText || ""} for ${describeUrl(url)}. The source may require authorization that is not available to this extension.`.trim();
    diagnostic?.(message);
    throw new Error(message);
  }
  return response;
}

async function getPlaylist(url: string, diagnostic?: Diagnostic): Promise<string> {
  const response = await fetchAuthorizedResource(url, "Playlist", diagnostic);
  try {
    const source = await response.text();
    diagnostic?.(`Playlist body received (${source.length.toLocaleString()} characters).`);
    return source;
  } catch (error) {
    const message = `Playlist response body could not be read for ${describeUrl(url)}: ${error instanceof Error ? error.message : String(error)}`;
    diagnostic?.(message);
    throw new Error(message, { cause: error });
  }
}

function unsupported(lines: string[]): void {
  if (lines.some((line) => line.startsWith("#EXT-X-KEY"))) throw new Error("Encrypted HLS (#EXT-X-KEY) is not supported.");
  if (lines.some((line) => line.startsWith("#EXT-X-MAP"))) throw new Error("Fragmented-MP4 HLS (#EXT-X-MAP) is not supported by this TS remuxer.");
  if (lines.some((line) => line.startsWith("#EXT-X-SESSION-KEY"))) throw new Error("DRM/session-key HLS is not supported.");
}

function uriAfter(lines: string[], index: number): string | undefined {
  for (let i = index + 1; i < lines.length; i += 1) if (lines[i] && !lines[i].startsWith("#")) return lines[i];
  return undefined;
}

function variants(lines: string[], base: string): { url: string; bandwidth: number }[] {
  return lines.flatMap((line, index) => {
    if (!line.startsWith("#EXT-X-STREAM-INF:")) return [];
    const uri = uriAfter(lines, index);
    if (!uri) return [];
    const bandwidth = Number(/(?:^|,)BANDWIDTH=(\d+)/.exec(line)?.[1] ?? 0);
    return [{ url: new URL(uri, base).href, bandwidth }];
  });
}

export async function resolveVodPlaylist(initialUrl: string, diagnostic?: Diagnostic): Promise<MediaPlaylist> {
  let url = new URL(initialUrl, location.href).href;
  for (let depth = 0; depth < 3; depth += 1) {
    diagnostic?.(`Resolving playlist level ${depth + 1}: ${describeUrl(url)}.`);
    const source = await getPlaylist(url, diagnostic);
    const lines = textLines(source);
    if (lines[0] !== "#EXTM3U") throw new Error("The supplied URL is not an HLS playlist.");
    unsupported(lines);

    const choices = variants(lines, url);
    if (choices.length) {
      url = choices.sort((a, b) => b.bandwidth - a.bandwidth)[0].url;
      diagnostic?.(`Master playlist selected the highest advertised bandwidth rendition: ${describeUrl(url)}.`);
      continue;
    }

    if (!lines.includes("#EXT-X-ENDLIST")) throw new Error("Only completed VOD playlists (#EXT-X-ENDLIST) are supported.");
    const segments = lines.flatMap((line, index) => line.startsWith("#EXTINF:") ? [uriAfter(lines, index)] : [])
      .filter((value): value is string => Boolean(value))
      .map((value) => new URL(value, url).href);
    if (!segments.length) throw new Error("No media segments were found in the playlist.");
    if (segments.some((value) => !new URL(value).pathname.toLowerCase().endsWith(".ts"))) {
      throw new Error("Only ordinary MPEG-TS (.ts) media segments are supported.");
    }
    return { playlistUrl: url, segments };
  }
  throw new Error("Too many nested master playlists.");
}
