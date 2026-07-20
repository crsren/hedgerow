import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Browser-only (BrowserOAuthClient needs WebCrypto + IndexedDB + window),
  // unlike the isomorphic @hedgerow/comments core.
  target: "es2022",
});
