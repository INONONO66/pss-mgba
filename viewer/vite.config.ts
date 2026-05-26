import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": backend,
      "/vision": backend,
      "/raw-screenshots": backend
    }
  }
});
