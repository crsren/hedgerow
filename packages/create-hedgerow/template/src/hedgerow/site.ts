import { readSite, type Site } from "hedgerow/site";
import { hedgerowConfig, publicationUri } from "./config";

const CACHE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5_000;

let cached: { value: Site; expiresAt: number } | undefined;
let pending: Promise<Site> | undefined;

const timedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

export async function loadSite(options: { fresh?: boolean } = {}): Promise<Site> {
  if (!publicationUri) {
    return {
      publication: null,
      publicationUri: null,
      publicationCid: null,
      documents: [],
    };
  }
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.value;
  if (!pending) {
    pending = readSite(hedgerowConfig.authorDid, timedFetch, { publicationUri })
      .then((value) => {
        cached = { value, expiresAt: Date.now() + CACHE_MS };
        return value;
      })
      .finally(() => {
        pending = undefined;
      });
  }
  return pending;
}

export function invalidateSiteCache(): void {
  cached = undefined;
}
