import { access, copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/@ffmpeg");
const destination = resolve(root, "public/vendor");
const coreDirectory = resolve(source, "core/dist/umd");
const workerDirectory = resolve(source, "ffmpeg/dist/umd");
const coreFiles = ["ffmpeg-core.js", "ffmpeg-core.wasm"];

await mkdir(destination, { recursive: true });

for (const file of coreFiles) {
  const from = resolve(coreDirectory, file);
  const to = resolve(destination, file);
  try {
    await access(from);
  } catch {
    throw new Error(`Could not find ${from}. Run npm install before building.`);
  }
  await copyFile(from, to);
}

// @ffmpeg/ffmpeg names its wrapper worker ffmpeg-worker.js in supported 0.12
// builds. Discover it to fail with a useful message if that package changes.
const worker = (await readdir(workerDirectory)).find((file) => /^ffmpeg-worker(?:\.min)?\.js$/.test(file));
if (!worker) {
  throw new Error(`Could not find the FFmpeg wrapper worker in ${workerDirectory}.`);
}
await copyFile(resolve(workerDirectory, worker), resolve(destination, "ffmpeg-worker.js"));

console.info("Copied FFmpeg core and wrapper-worker assets to public/vendor.");
