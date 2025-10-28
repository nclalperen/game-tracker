import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Load .env files from the monorepo root to support repo-root .env.local
  envDir: "../../",
  server: {
    port: 5173,
    strictPort: true, // don't auto-switch to 5174
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor_db: ["dexie"],
          vendor_html: ["dompurify"],
        },
      },
    },
  },
});
