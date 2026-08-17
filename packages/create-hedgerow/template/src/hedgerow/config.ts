import state from "../../.hedgerow/state.json";
import config from "../../hedgerow.config.mjs";

export const hedgerowConfig = config;

export const publicationUri = state.publication
  ? `at://${config.authorDid}/site.standard.publication/${state.publication}`
  : null;

export const documentUrl = (path: string | undefined): string =>
  new URL(path?.replace(/^\/+/, "") ?? "", `${config.siteUrl}/`).toString();
