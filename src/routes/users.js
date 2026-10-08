import { Hono } from "hono";
import { normalizePhone } from "../lib/account-provision.js";

import * as db from "../lib/db.js";
import { jsonBody } from "../lib/security.js";
import { requireMaster } from "../middleware/access.js";
export const users = new Hono();
users.get(
  "/users",
  requireMaster("Solo el administrador principal gestiona usuarios"),
  async (c) => {
    const env = c.env;
    const tenant = c.get("tenant");
    return c.json({ ok: true, users: await db.listUsers(env, tenant.id) });
  },
);
users.post(
  "/create-user",
  requireMaster("Solo el administrador principal gestiona usuarios"),
  async (c) => {
    const request = c.req.raw;
    const env = c.env;
    const tenant = c.get("tenant");
    const user = c.get("user");
    const b = await jsonBody(request);
    b.phone = normalizePhone(b.phone);
    await db.createUser(env, tenant.id, b, user);
    return c.json({ ok: true });
  },
);
users.post(
  "/delete-user",
  requireMaster("Solo el administrador principal gestiona usuarios"),
  async (c) => {
    const request = c.req.raw;
    const env = c.env;
    const tenant = c.get("tenant");
    const user = c.get("user");
    const b = await jsonBody(request);
    await db.deleteUser(env, tenant.id, b.userId, user);
    return c.json({ ok: true });
  },
);
users.post(
  "/users/permissions",
  requireMaster("Solo el administrador principal gestiona usuarios"),
  async (c) => {
    const request = c.req.raw;
    const env = c.env;
    const tenant = c.get("tenant");
    const user = c.get("user");
    const b = await jsonBody(request);
    await db.setPermissions(env, tenant.id, b.userId, b.gateIds, user);
    return c.json({ ok: true });
  },
);
