import { listCodes } from "../lib/codes.js";
import { Hono } from "hono";
import {
  platformJSON,
  parseBody,
  platformTenant,
} from "../middleware/access.js";
import { issueRecovery } from "../lib/account-recovery.js";
import { normalizePhone } from "../lib/account-provision.js";
import { resolveCodeBody } from "../lib/code-privacy.js";
import { superPanel } from "../lib/super-panel.js";
import * as operations from "../lib/operations.js";
import * as db from "../lib/db.js";
import { InputError, verifySecret } from "../lib/security.js";
import { takeAttempt } from "../lib/ratelimit.js";
import { getPlatformAdminHTML } from "../html/platform.js";
export const router = new Hono();
router.get("/admin", async (c) => {
  const admin = c.get("admin");
  return c.html(getPlatformAdminHTML(admin));
});

router.get("/api/panel", async (c) => {
  const env = c.env;

  return platformJSON(c, await superPanel(env, c.req.query("offset")));
});
router.get("/api/reports", async (c) => {
  const env = c.env;
  return platformJSON(c, { report: await db.reports(env) });
});

router.get("/api/operations", platformTenant, async (c) => {
  const env = c.env;
  const tenantId = c.get("tenantId");
  return platformJSON(c, { operations: await operations.list(env, tenantId) });
});
router.get("/api/users", platformTenant, async (c) => {
  const env = c.env;
  const tenantId = c.get("tenantId");
  return platformJSON(c, { users: await db.listUsers(env, tenantId) });
});
router.get("/api/codes", platformTenant, async (c) => {
  const env = c.env;

  const tenantId = c.get("tenantId");
  return platformJSON(c, {
    codes: await listCodes(env, tenantId, null, c.req.query()),
  });
});
router.post("/api/users/recovery", parseBody, platformTenant, async (c) => {
  const env = c.env;

  const admin = c.get("admin");
  const b = c.get("body");
  const tenantId = c.get("tenantId");

  if (!(await takeAttempt(env, "account-recovery:" + admin.id, 5)))
    throw new InputError("Espera cinco minutos antes de generar otro enlace.");
  if (!(await verifySecret(b.currentSecret, admin.secret)))
    throw new InputError("Tu contraseña de plataforma es incorrecta.");
  const target = await env.DB.prepare(
    "SELECT a.id FROM accounts a JOIN account_memberships m ON m.account_id=a.id WHERE m.tenant_id=? AND m.user_id=? AND NOT EXISTS(SELECT 1 FROM account_platform p WHERE p.account_id=a.id)",
  )
    .bind(tenantId, b.userId)
    .first();
  if (!target)
    throw new InputError(
      "Cuenta no disponible para recuperación de residentes.",
    );
  const recovery = await issueRecovery(env, target.id, admin);
  return platformJSON(c, {
    url: new URL("/recover#" + recovery.token, c.req.url).href,
    expiresAt: recovery.expiresAt,
  });
});
router.post("/api/operations/resolve", parseBody, platformTenant, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");
  const tenantId = c.get("tenantId");

  await operations.resolve(env, tenantId, b.operationId, admin);
  return platformJSON(c, {});
});
router.post("/api/users", parseBody, platformTenant, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");
  const tenantId = c.get("tenantId");
  const detail = { tenantId };

  b.phone = normalizePhone(b.phone);
  detail.userId = await db.createUser(env, tenantId, b, admin);

  return platformJSON(c, detail);
});
router.post(
  "/api/users/administrator",
  parseBody,
  platformTenant,
  async (c) => {
    const admin = c.get("admin");
    if (!(await takeAttempt(c.env, "assign-administrator:" + admin.id, 10)))
      throw new InputError(
        "Espera cinco minutos antes de asignar otro administrador.",
      );
    return platformJSON(
      c,
      await db.assignAdministrator(
        c.env,
        c.get("tenantId"),
        c.get("body"),
        admin,
      ),
    );
  },
);
router.post("/api/users/delete", parseBody, platformTenant, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");
  const tenantId = c.get("tenantId");
  const detail = { tenantId };

  await db.deleteUser(env, tenantId, b.userId, admin);
  detail.userId = b.userId;

  return platformJSON(c, detail);
});
router.post("/api/users/permissions", parseBody, platformTenant, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");
  const tenantId = c.get("tenantId");
  const detail = { tenantId };

  await db.setPermissions(env, tenantId, b.userId, b.gateIds, admin);
  detail.userId = b.userId;
  detail.gateIds = b.gateIds;

  return platformJSON(c, detail);
});
router.post("/api/codes/revoke", parseBody, platformTenant, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");
  const tenantId = c.get("tenantId");

  const resolved = await resolveCodeBody(env, b, admin, tenantId);
  await db.revokeCode(env, tenantId, resolved.code, null, admin);
  return platformJSON(c, { tenantId });
});
router.post("/api/codes/resolve", parseBody, platformTenant, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");
  const tenantId = c.get("tenantId");
  const detail = { tenantId };

  const resolved = await resolveCodeBody(env, b, admin, tenantId);
  await db.resolveCode(env, tenantId, resolved.code, b.action, admin);
  detail.resolution = b.action;

  return platformJSON(c, detail);
});
