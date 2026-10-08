import { Hono } from "hono";

import { protectCodes, resolveCodeBody } from "../lib/code-privacy.js";
import { createPass, listPasses, extendPass } from "../lib/passes.js";
import * as db from "../lib/db.js";
import { jsonBody } from "../lib/security.js";
export const codes = new Hono();
codes.get("/passes", async (c) => {
  const env = c.env;
  const tenant = c.get("tenant");
  const user = c.get("user");
  return c.json({
    ok: true,
    passes: await protectCodes(
      env,
      await listPasses(env, user, c.req.query()),
      user,
      tenant.id,
    ),
  });
});
codes.post("/passes", async (c) => {
  const request = c.req.raw;
  const env = c.env;
  const user = c.get("user");
  return c.json({
    ok: true,
    ...(await createPass(env, user, await jsonBody(request))),
  });
});
codes.post("/passes/extend", async (c) => {
  const request = c.req.raw;
  const env = c.env;
  const tenant = c.get("tenant");
  const user = c.get("user");

  await extendPass(
    env,
    user,
    await resolveCodeBody(env, await jsonBody(request), user, tenant.id),
  );
  return c.json({ ok: true });
});
codes.post("/create-code", async (c) => {
  const request = c.req.raw;
  const env = c.env;
  const user = c.get("user");
  return c.json({
    ok: true,
    code: await db.createCode(env, user, await jsonBody(request)),
  });
});
codes.get("/codes", async (c) => {
  const env = c.env;
  const tenant = c.get("tenant");
  const user = c.get("user");
  return c.json({
    ok: true,
    codes: await protectCodes(
      env,
      await db.listCodes(env, tenant.id, user, c.req.query()),
      user,
      tenant.id,
    ),
  });
});
codes.post("/revoke-code", async (c) => {
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
