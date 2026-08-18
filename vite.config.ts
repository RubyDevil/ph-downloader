import { defineConfig } from "vite";
import { resolve } from "node:path";

// Content scripts are classic scripts unless explicitly registered as module
// scripts. Build this entry as a self-contained IIFE so Chromium never sees
// Vite's native-ESM `import.meta` or `import` syntax at injection time.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, "src/content.ts"),
      formats: ["iife"],
      name: "PornHubDownloader",
      fileName: () => "content.js",
      cssFileName: "content"
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
});
