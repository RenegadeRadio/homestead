import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    setupFiles: ["./src/test-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
