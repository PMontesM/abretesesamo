import { Hono } from "hono";
import { clearAccountCookie } from "../lib/account-session.js";

import { protectCodes } from "../lib/code-privacy.js";
import { panelData } from "../lib/panel.js";
import { relayStatus } from "../lib/relay.js";
import * as db from "../lib/db.js";
import { jsonBody } from "../lib/security.js";
import { takeAttempt } from "../lib/ratelimit.js";
import { getAdminHTML } from "../html/admin.js";
import { requireMaster } from "../middleware/access.js";
export const panel = new Hono();
panel.get("/", async (c) => {
  const tenant = c.get("tenant");
  const user = c.get("user");
  return c.html(getAdminHTML(tenant, user, c.req.query("view")));
});
panel.get("/panel", async (c) => {
  const env = c.env;
  const tenant = c.get("tenant");
  const user = c.get("user");
  return c.json({
    ok: true,
    ...(await protectCodes(
      env,
      await panelData(env, user, c.req.query("offset")),
      user,
      tenant.id,
    )),
  });
});
panel.post(
  "/connection",
  requireMaster("Solo administración puede consultar dispositivos"),
  async (c) => {
    const request = c.req.raw;
    const env = c.env;
    const user = c.get("user");

    if (!(await takeAttempt(env, "connection:" + user.tenant_id, 6)))
      return c.json(
        {
          ok: false,
          error: "Espera cinco minutos antes de consultar de nuevo",
        },
        429,
      );
    const gate = await db.requireGate(
      env,
      user,
      (await jsonBody(request)).gateId,
    );
    if (gate.trigger_type !== "mqtt")
      return c.json({ ok: true, connection: null });
    return c.json({ ok: true, connection: await relayStatus(env, gate) });
  },
);
panel.get("/dashboard", async (c) => {
  const env = c.env;
  const user = c.get("user");
  return c.json({ ok: true, ...(await db.dashboard(env, user)) });
});
panel.post("/logout", async (c) => {
  const env = c.env;
  const user = c.get("user");

  await env.DB.prepare(
    "UPDATE accounts SET session_version=session_version+1 WHERE id=?",
  )
    .bind(user.account_id)
    .run();
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": clearAccountCookie() } },
  );
});
panel.get("/gates", async (c) => {
  const env = c.env;
  const user = c.get("user");
  return c.json({
    ok: true,
    gates: (await db.allowedGates(env, user)).map((g) => ({
      id: g.id,
      name: g.name,
      status: g.status,
      hasRelay: g.trigger_type === "mqtt",
      connection_state: g.connection_state,
      connection_checked_at: g.connection_checked_at,
    })),
  });
});
panel.post(
  "/support",
  requireMaster("Solo el administrador puede cambiar el contacto."),
  async (c) => {
    const request = c.req.raw;
    const env = c.env;
    const tenant = c.get("tenant");
    const user = c.get("user");

    const b = await jsonBody(request);
    return c.json({
      ok: true,
      phone: await db.setSupport(env, tenant.id, b.phone, user),
    });
  },
);
panel.get("/logs", async (c) => {
  const env = c.env;
  const tenant = c.get("tenant");
  const user = c.get("user");
  return c.json({
    ok: true,
    ...(await protectCodes(
      env,
      await db.listLogs(env, tenant.id, user),
      user,
      tenant.id,
    )),
  });
});
