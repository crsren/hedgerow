import type { APIRoute } from "astro";
import { loadSite } from "../../../hedgerow/site";

export const POST: APIRoute = async ({ request }) => {
  const input = await request.json().catch(() => null) as { uri?: unknown; cid?: unknown } | null;
  if (typeof input?.uri !== "string" || typeof input.cid !== "string") {
    return new Response("Expected a document URI and CID.\n", { status: 400 });
  }

  const site = await loadSite({ fresh: true });
  const current = site.documents.find((document) => document.uri === input.uri);
  if (!current || current.cid !== input.cid) {
    return new Response("Published record has not reached the PDS.\n", { status: 409 });
  }
  return new Response(null, { status: 204 });
};
