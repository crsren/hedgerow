import type { APIRoute } from "astro";
import { publicationUri } from "../../hedgerow/config";

export const GET: APIRoute = () =>
  publicationUri
    ? new Response(`${publicationUri}\n`, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    : new Response("Publication not bootstrapped.\n", { status: 404 });
