import { createBrowser } from "hedgerow/browser";
import { permissionScope } from "hedgerow/site";
import { hedgerowConfig } from "./config";

const clientId = `${typeof window === "undefined" ? hedgerowConfig.siteUrl : window.location.origin}/oauth/client-metadata.json`;

function isLoopback(): boolean {
  if (typeof window === "undefined") return false;
  return ["127.0.0.1", "::1", "[::1]"].includes(window.location.hostname);
}

export const authorAuth = createBrowser({
  scope: permissionScope,
  ...(isLoopback() ? {} : { clientId }),
});
