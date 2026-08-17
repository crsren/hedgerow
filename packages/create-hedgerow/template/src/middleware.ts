import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
});
