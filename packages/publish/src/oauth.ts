// atproto OAuth login for the CLI, via the loopback (native) client flow.
//
// atproto's OAuth spec defines a special client id for local/development
// clients: `http://localhost`, with the redirect_uri(s) and scope carried as
// query params. The authorization server synthesises the client metadata from
// that id — no hosted client-metadata document, no client secret. The redirect
// lands on a throwaway HTTP server we run on 127.0.0.1 for the duration of the
// login. See `buildAtprotoLoopbackClientMetadata` in @atproto/oauth-types; an
// example resolved client id looks like:
//   http://localhost?scope=atproto+transition%3Ageneric&redirect_uri=http%3A%2F%2F127.0.0.1%3A4139%2Fcallback
//
// There is deliberately NO headless publish path: minting a record requires a
// human to complete the browser login once, after which the session is cached
// and reused (and silently refreshed) until it's revoked or cleared.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { Agent } from "@atproto/api";
import {
  buildAtprotoLoopbackClientMetadata,
  NodeOAuthClient,
  requestLocalLock,
  type NodeSavedSession,
  type NodeSavedState,
  type OAuthSession,
} from "@atproto/oauth-client-node";
import { agentPublisher, type Publisher } from "./auth.js";
import { resolveDid } from "./read.js";
import { FileStore } from "./store.js";

/** The scope every Hedgerow publish needs: identity + generic record writes. */
const ATPROTO_SCOPE = "atproto transition:generic";
/** Loopback redirect port. Fixed so the client id (which encodes it) is stable. */
const DEFAULT_PORT = 4139;
/** Where the cached session + transient auth state live. */
const DEFAULT_STORE_DIR = join(homedir(), ".config", "hedgerow");
const STATE_FILE = "oauth-state.json";
const SESSION_FILE = "oauth-session.json";

export interface OAuthPublisherOptions {
  /**
   * Handle or DID to log in as. Optional: it seeds the login (as a hint) and
   * lets us pick the right cached session when several are stored. With no
   * identifier and no cached session, login defaults to the bsky.social
   * authorization server and you choose the account in the browser.
   */
  identifier?: string;
  /** Directory holding the cached session + auth state. Default: ~/.config/hedgerow. */
  store?: string;
  /** Loopback redirect port. Default: 4139. */
  port?: number;
  /**
   * Open the authorization URL for the user. Called ONLY on a fresh login
   * (never when a cached session is restored), so it doubles as the "we're
   * about to prompt a browser login" signal. Default: spawn the platform
   * opener (`open` / `xdg-open` / `start`).
   */
  openUrl?: (url: string) => void | Promise<void>;
}

export interface ClearSessionOptions {
  /** Store directory (must match what was used to log in). Default: ~/.config/hedgerow. */
  store?: string;
  /** Only clear this account's session. Omit to clear every cached session. */
  identifier?: string;
}

/** Spawn the platform's default URL opener. The library default for `openUrl`. */
export function openInBrowser(url: string): void {
  const os = platform();
  const [cmd, args] =
    os === "darwin"
      ? ["open", [url]]
      : os === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  spawn(cmd, args as string[], { stdio: "ignore", detached: true }).unref();
}

/** The loopback redirect URI for a given port. */
export const loopbackRedirectUri = (port: number): string => `http://127.0.0.1:${port}/callback`;

/**
 * Build the atproto loopback (native) client metadata for a port. Pure. The
 * resulting `client_id` is `http://localhost` with the scope and redirect_uri
 * as query params, e.g.
 *   http://localhost?scope=atproto+transition%3Ageneric&redirect_uri=http%3A%2F%2F127.0.0.1%3A4139%2Fcallback
 */
export function loopbackClientMetadata(port: number) {
  return buildAtprotoLoopbackClientMetadata({
    scope: ATPROTO_SCOPE,
    redirect_uris: [loopbackRedirectUri(port)],
  });
}

function buildClient(dir: string, port: number): NodeOAuthClient {
  return new NodeOAuthClient({
    clientMetadata: loopbackClientMetadata(port),
    stateStore: new FileStore<NodeSavedState>(join(dir, STATE_FILE)),
    sessionStore: new FileStore<NodeSavedSession>(join(dir, SESSION_FILE)),
    // Suppress the "no lock" warning — one CLI process, no cross-process races.
    requestLock: requestLocalLock,
  });
}

/** Try to restore a cached session, resolving `identifier` to the stored DID. */
async function restoreSession(
  client: NodeOAuthClient,
  sessionStore: FileStore<NodeSavedSession>,
  identifier: string | undefined,
): Promise<OAuthSession | null> {
  const stored = sessionStore.keys();
  if (stored.length === 0) return null;

  let sub: string | undefined;
  if (identifier?.startsWith("did:")) {
    sub = identifier;
  } else if (identifier) {
    sub = await resolveDid(identifier).catch(() => undefined);
  } else if (stored.length === 1) {
    // No hint, but exactly one cached account — unambiguous.
    sub = stored[0];
  }

  if (!sub || !stored.includes(sub)) return null;
  // restore() refreshes the token if it's (about to be) expired; a hard failure
  // (revoked, unrefreshable) falls through to a fresh browser login.
  return client.restore(sub).catch(() => null);
}

/** Run the loopback browser login and return the resulting OAuth session. */
function loginSession(
  client: NodeOAuthClient,
  identifier: string | undefined,
  port: number,
  openUrl: (url: string) => void | Promise<void>,
): Promise<OAuthSession> {
  // With no identifier we point authorize() at bsky.social so the user can pick
  // any account there; a handle/DID resolves to that account's own PDS/entryway.
  const authInput = identifier ?? "https://bsky.social";

  return new Promise<OAuthSession>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      try {
        const { session } = await client.callback(url.searchParams);
        res.writeHead(200, { "content-type": "text/html" }).end(page("Logged in", "You can close this tab and return to the terminal."));
        server.close();
        resolve(session);
      } catch (err) {
        res.writeHead(500, { "content-type": "text/html" }).end(page("Login failed", "Check the terminal for details."));
        server.close();
        reject(err);
      }
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      // authorize() does the PAR round-trip and returns the URL to send the user
      // to. Kick it off only once the callback server is actually listening.
      client
        .authorize(authInput, { scope: ATPROTO_SCOPE })
        .then((authUrl) => openUrl(authUrl.toString()))
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${body}</p></body></html>`;

/**
 * Authenticate for publishing via atproto OAuth and return a {@link Publisher}.
 * Restores a cached session if one exists; otherwise runs the loopback browser
 * login, persists the session, and reuses it on later runs.
 */
export async function oauthPublisher(opts: OAuthPublisherOptions = {}): Promise<Publisher> {
  const dir = opts.store ?? DEFAULT_STORE_DIR;
  const port = opts.port ?? DEFAULT_PORT;
  const openUrl = opts.openUrl ?? openInBrowser;

  const sessionStore = new FileStore<NodeSavedSession>(join(dir, SESSION_FILE));
  const client = buildClient(dir, port);

  const session =
    (await restoreSession(client, sessionStore, opts.identifier)) ??
    (await loginSession(client, opts.identifier, port, openUrl));

  return agentPublisher(new Agent(session));
}

/**
 * Delete the cached OAuth session (a local sign-out). Removes the whole cache,
 * or just one account's session when `identifier` is given. Also clears the
 * transient auth state. Does not revoke tokens server-side.
 */
export async function clearSession(opts: ClearSessionOptions = {}): Promise<void> {
  const dir = opts.store ?? DEFAULT_STORE_DIR;
  const sessionStore = new FileStore<NodeSavedSession>(join(dir, SESSION_FILE));

  if (opts.identifier) {
    const sub = opts.identifier.startsWith("did:")
      ? opts.identifier
      : await resolveDid(opts.identifier).catch(() => undefined);
    if (sub) sessionStore.del(sub);
  } else {
    sessionStore.clear();
  }

  // State is throwaway (only meaningful mid-login) — always safe to wipe.
  new FileStore<NodeSavedState>(join(dir, STATE_FILE)).clear();
}

/** Alias for {@link clearSession}. */
export { clearSession as logout };
