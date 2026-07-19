import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**"],
    },
    // dev-env boots an in-process PDS + PLC; give the integration test room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
