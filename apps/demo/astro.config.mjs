import { defineConfig } from "astro/config";

// noExternal so Vite resolves the workspace package consistently across dev
// (TS source via the `development` export condition) and build (dist via `import`),
// instead of trying to SSR-externalize a workspace path.
export default defineConfig({
  vite: {
    ssr: {
      noExternal: ["@hedgerow/publish"],
    },
  },
});
