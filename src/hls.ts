export type MediaPlaylist = {
  playlistUrl: string;
  segments: string[];
};

const textLines = (source: string) => source.replace(/\r/g, "").split("\n").map((line) => line.trim());

async function getPlaylist(url: string): Promise<string> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Playlist request failed (${response.status}). The URL may require page-specific authorization.`);
  return response.text();
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

export async function resolveVodPlaylist(initialUrl: string): Promise<MediaPlaylist> {
  let url = new URL(initialUrl, location.href).href;
  for (let depth = 0; depth < 3; depth += 1) {
    const source = await getPlaylist(url);
    const lines = textLines(source);
    if (lines[0] !== "#EXTM3U") throw new Error("The supplied URL is not an HLS playlist.");
    unsupported(lines);

    const choices = variants(lines, url);
    if (choices.length) {
      url = choices.sort((a, b) => b.bandwidth - a.bandwidth)[0].url;
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
