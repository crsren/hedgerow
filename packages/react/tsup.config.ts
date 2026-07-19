import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Browser-first React library. react / react-dom / the JSX runtime are peers,
  // provided by the consuming app — never bundled.
  external: ["react", "react-dom", "react/jsx-runtime"],
  target: "es2022",
});
