import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, Vite proxies /api to the Express server so the browser sees a single origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:4000", changeOrigin: true } },
  },
});
