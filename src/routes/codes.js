import { Hono } from "hono";

import { protectCodes, resolveCodeBody } from "../lib/code-privacy.js";
import { createCode, listCodes, extendCode } from "../lib/codes.js";
import * as db from "../lib/db.js";
import { jsonBody } from "../lib/security.js";
export const codes = new Hono();
codes.get("/codes", async (c) => {
  const env = c.env;
  const tenant = c.get("tenant");
  const user = c.get("user");
  return c.json({
    ok: true,
    codes: await protectCodes(
      env,
      await listCodes(env, tenant.id, user, c.req.query()),
      user,
      tenant.id,
    ),
  });
});
codes.post("/codes", async (c) => {
  const request = c.req.raw;
  const env = c.env;
  const user = c.get("user");
  return c.json({
    ok: true,
    ...(await createCode(env, user, await jsonBody(request))),
  });
});
codes.post("/codes/extend", async (c) => {
  const request = c.req.raw;
  const env = c.env;
  const tenant = c.get("tenant");
  const user = c.get("user");

  await extendCode(
    env,
    user,
    await resolveCodeBody(env, await jsonBody(request), user, tenant.id),
  );
  return c.json({ ok: true });
});

codes.post("/codes/revoke", async (c) => {
  const request = c.req.raw;
  const env = c.env;
  const tenant = c.get("tenant");
  const user = c.get("user");

  const b = await resolveCodeBody(
    env,
    await jsonBody(request),
    user,
    tenant.id,
  );
  await db.revokeCode(env, tenant.id, b.code, user, user);
  return c.json({ ok: true });
});
