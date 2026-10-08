import { checkTurnstile } from "../lib/turnstile.js";
import { InputError } from "../lib/security.js";
export function configureHTTP(app) {
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
  });
  app.use("*", async (c, next) => {
    const request = c.req.raw,
      env = c.env,
      url = new URL(request.url);
    if (env.PUBLIC_HOSTNAME && url.hostname !== env.PUBLIC_HOSTNAME)
      return new Response("No encontrado", { status: 404 });
    if (request.method === "POST") {
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin)
        return c.json({ ok: false, error: "Origen no autorizado" }, 403);
    }
    const challengeFailure = await checkTurnstile(request, env);
    if (challengeFailure) return challengeFailure;
    await next();
  });

  app.onError((err, c) =>
    c.json(
      {
        ok: false,
        ...(err instanceof InputError && err.operationClosed === true
          ? { operationClosed: true }
          : {}),
        error:
          err instanceof InputError
            ? err.message
            : "No se pudo completar la operación. Actualiza la lista antes de reintentar.",
      },
      err instanceof InputError ? err.status : 500,
    ),
  );
}
