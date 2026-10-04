import { defineConfig } from "vitest/config";

// Unit tests cover the pure logic (sync math, drift policy, media matching, room state machine).
// Kept separate from vite.config.ts so tests never boot workerd.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "shared/**/*.test.ts", "worker/**/*.test.ts"],
    environment: "node",
  },
});
