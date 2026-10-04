import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// One dev server runs both the React app and the Worker + Durable Objects (in workerd).
export default defineConfig({
  plugins: [react(), cloudflare()],
  build: {
    target: "es2022",
    cssTarget: "chrome111",
  },
});
