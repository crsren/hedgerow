import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Isomorphic: no node-only APIs, so a neutral/browser-safe target. The code
  // relies only on the fetch/URL globals present in node20+ and every browser.
  target: "es2022",
});
