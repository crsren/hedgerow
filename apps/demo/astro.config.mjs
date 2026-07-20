import { defineConfig } from "astro/config";
import react from "@astrojs/react";

// noExternal so Vite resolves the workspace packages consistently across dev
// (TS/TSX source via the `development` export condition) and build (dist via `import`),
// instead of trying to SSR-externalize a workspace path.
export default defineConfig({
  // Serve dev on a loopback IP, not `localhost`: atproto OAuth (RFC 8252)
  // rejects `localhost` in loopback redirect URIs, so the reply box's login
  // silently can't start from a http://localhost origin. 127.0.0.1 works.
  server: { host: "127.0.0.1" },
  integrations: [react()],
  vite: {
    ssr: {
      noExternal: ["@hedgerow/publish", "@hedgerow/react", "@hedgerow/comments", "@hedgerow/reader"],
    },
  },
});
