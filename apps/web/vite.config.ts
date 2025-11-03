import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }],
  },
  // Load .env files from the monorepo root to support repo-root .env.local
  envDir: "../../",
  server: {
    port: 5173,
    strictPort: true, // don't auto-switch to 5174
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/apis/rawg") || id.includes("/data/rawg") || id.includes("/deals/derive")) {
            return "rawg";
          }
          if (id.includes("dexie") || id.includes("/src/db")) {
            return "dexie";
          }
          if (id.includes("/ally/") || id.includes("/desktop/ally")) {
            return "ally";
          }
          if (id.includes("/components/details")) {
            return "details";
          }
          return undefined;
        },
      },
    },
  },
});
