import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        content: resolve(import.meta.dirname, "src/content.ts"),
        background: resolve(import.meta.dirname, "src/background.ts")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (asset) => asset.name === "content.css" ? "content.css" : "assets/[name]-[hash][extname]"
      }
    }
  }
});
