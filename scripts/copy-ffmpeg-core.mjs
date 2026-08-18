import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/@ffmpeg/core/dist/umd");
const destination = resolve(root, "public/vendor");
const files = ["ffmpeg-core.js", "ffmpeg-core.wasm"];

await mkdir(destination, { recursive: true });

for (const file of files) {
  const from = resolve(source, file);
  const to = resolve(destination, file);
  try {
    await access(from);
  } catch {
    throw new Error(`Could not find ${from}. Run npm install before building.`);
  }
  await copyFile(from, to);
}

console.info("Copied FFmpeg core assets to public/vendor.");
