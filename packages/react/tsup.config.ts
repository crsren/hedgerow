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
  // Every component/hook here touches client-only APIs (context, state, DOM
  // events), so the whole entry point is a client boundary. Next.js App
  // Router (and other RSC bundlers) needs this directive as the literal first
  // line of the emitted JS to draw that boundary — a source-level directive
  // in src/index.ts covers the monorepo's `development` condition, but the
  // built dist output needs its own copy since tsup doesn't propagate
  // directives from entry files into the bundle automatically.
  banner: { js: '"use client";' },
});
