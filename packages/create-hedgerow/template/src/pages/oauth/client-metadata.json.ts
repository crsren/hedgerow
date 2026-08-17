import type { APIRoute } from "astro";
import { permissionScope } from "hedgerow/site";
import { hedgerowConfig } from "../../hedgerow/config";

export const GET: APIRoute = ({ request }) => {
  const origin = new URL(request.url).origin;
  const clientId = `${origin}/oauth/client-metadata.json`;
  return new Response(JSON.stringify({
    client_id: clientId,
    client_name: `${hedgerowConfig.siteName} editor`,
    client_uri: origin,
    redirect_uris: [`${origin}/oauth/callback`],
    scope: permissionScope,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
    dpop_bound_access_tokens: true,
  }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
