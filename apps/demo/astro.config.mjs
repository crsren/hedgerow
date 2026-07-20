import { defineConfig } from "astro/config";
import react from "@astrojs/react";

// noExternal so Vite resolves the workspace packages consistently across dev
// (TS/TSX source via the `development` export condition) and build (dist via `import`),
// instead of trying to SSR-externalize a workspace path.
export default defineConfig({
  integrations: [react()],
  vite: {
    ssr: {
      noExternal: ["@hedgerow/publish", "@hedgerow/react", "@hedgerow/comments", "@hedgerow/reader"],
    },
  },
});
