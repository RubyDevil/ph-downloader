import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, "src/offscreen.ts"),
      formats: ["iife"],
      name: "PornHubDownloaderOffscreen",
      fileName: () => "offscreen.js"
    },
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
});
