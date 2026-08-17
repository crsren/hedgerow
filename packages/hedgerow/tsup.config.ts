import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/browser.ts",
    "src/site.ts",
    "src/social.ts",
    "src/node.ts",
  ],
  format: ["esm"],
  dts: true,
  splitting: false,
  clean: true,
  sourcemap: true,
  target: "es2022",
});
