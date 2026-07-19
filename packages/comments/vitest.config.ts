import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**"],
    },
    // The default suite is fixtures-only (no network). The live smoke test is
    // gated behind LIVE_SMOKE and given room for the real AppView round trip.
    testTimeout: 20_000,
  },
});
