import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, "src/background.ts"),
      formats: ["iife"],
      name: "PornHubDownloaderBackground",
      fileName: () => "background.js"
    },
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
});
