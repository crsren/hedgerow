import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
  },
  // Transform TSX with the automatic JSX runtime so tests don't need a React
  // import in scope. Keeps the test files as clean as the source.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
});
