import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: { input: { app: resolve("index.html"), callback: resolve("auth", "callback.html") } },
  },
});
