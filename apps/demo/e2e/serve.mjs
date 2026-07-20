#!/usr/bin/env node
// The Playwright `webServer.command` (see ../playwright.config.ts): boots the
// local atproto network + AppView shim (scripts/dev-net.mjs), writes the
// resulting env/metadata to .local-net.json for the specs to read, then
// starts `astro dev` pointed at that network. Playwright polls the
// `webServer.url` until astro responds, then runs the tests; it SIGTERMs this
// whole process (and everything spawned from it) when the run ends.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startDevNet } from "../scripts/dev-net.mjs";

const DEMO_DIR = fileURLToPath(new URL("..", import.meta.url));
const ASTRO_BIN = fileURLToPath(new URL("../node_modules/.bin/astro", import.meta.url));
const LOCAL_NET_JSON = fileURLToPath(new URL("./.local-net.json", import.meta.url));
const PORT = process.env.HEDGEROW_E2E_PORT ?? "4321";

async function main() {
  const dn = await startDevNet({ log: (...args) => console.error("[dev-net]", ...args) });

  // Specs read this to know the shim URL and which document got the seeded
  // thread — see read-path.spec.ts.
  writeFileSync(
    LOCAL_NET_JSON,
    JSON.stringify({ ...dn.env, seeded: dn.seeded, baseURL: `http://127.0.0.1:${PORT}` }, null, 2),
  );

  const astro = spawn(ASTRO_BIN, ["dev", "--port", PORT, "--host", "127.0.0.1"], {
    cwd: DEMO_DIR,
    env: { ...process.env, ...dn.env },
    stdio: "inherit",
  });

  let shuttingDown = false;
  const shutdown = async (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    astro.kill("SIGTERM");
    await dn.close();
    process.exit(code ?? 0);
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  astro.on("exit", (code) => shutdown(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
