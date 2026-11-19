import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: __dirname, plugins: [react()], define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: { outDir: "../media", emptyOutDir: false, cssCodeSplit: false, sourcemap: true,
    rollupOptions: { input: `${__dirname}/src/main.tsx`, output: { format: "iife", entryFileNames: "panel.js", assetFileNames: "panel[extname]" } } },
});
