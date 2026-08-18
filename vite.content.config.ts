import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, "src/content.ts"),
      formats: ["iife"],
      name: "PornHubDownloaderContent",
      fileName: () => "content.js",
      cssFileName: "content"
    },
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
});
