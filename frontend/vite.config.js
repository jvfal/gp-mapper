import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Django's staticfiles manifest adds content hashes to these stable entry names.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../static/mapper",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: "src/main.jsx",
      output: {
        entryFileNames: "mapper.js",
        assetFileNames: "mapper.[ext]",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
