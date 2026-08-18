import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = resolve(root, "node_modules/@ffmpeg");
const coreDirectory = resolve(packages, "core/dist/umd");
const wrapperDirectory = resolve(packages, "ffmpeg/dist/esm");
const destination = resolve(root, "public/vendor");
const assets = [
  [coreDirectory, "ffmpeg-core.js"],
  [coreDirectory, "ffmpeg-core.wasm"],
  // These three files form FFmpeg.wasm's ESM class worker. The single-threaded
  // @ffmpeg/core package intentionally does not ship ffmpeg-core.worker.js.
  [wrapperDirectory, "worker.js"],
  [wrapperDirectory, "const.js"],
  [wrapperDirectory, "errors.js"]
];

await mkdir(destination, { recursive: true });
for (const [directory, file] of assets) {
  const from = resolve(directory, file);
  const to = resolve(destination, file);
  try {
    await access(from);
  } catch {
    throw new Error(`Could not find ${from}. Delete node_modules, run npm install, and try again.`);
  }
  await copyFile(from, to);
}

console.info("Copied FFmpeg core and ESM class-worker assets to public/vendor.");
