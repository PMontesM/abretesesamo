import { Hono } from "hono";
import {
  platformJSON,
  parseBody,
  platformTenant,
} from "../middleware/access.js";
import { normalizePhone } from "../lib/account-provision.js";
import { relayStatus, RelayError } from "../lib/relay.js";
import * as db from "../lib/db.js";
import { InputError } from "../lib/security.js";
import { takeAttempt } from "../lib/ratelimit.js";
export const router = new Hono();
router.get("/api/tenants", async (c) => {
  const env = c.env;
  return platformJSON(c, { tenants: await db.listTenants(env) });
});
router.get("/api/gates", platformTenant, async (c) => {
  const env = c.env;
  const tenantId = c.get("tenantId");
  return platformJSON(c, { gates: await db.listGates(env, tenantId) });
});
router.post("/api/tenants", parseBody, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");

  b.masterPhone = normalizePhone(b.masterPhone);
  const id = await db.createTenant(env, b, admin);
  return platformJSON(c, {
    tenantId: id,
    slug: (await db.tenantById(env, id)).slug,
  });
});
router.post("/api/gates/connection", parseBody, platformTenant, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");
  const tenantId = c.get("tenantId");

  if (!(await takeAttempt(env, "relay-status:" + admin.id, 30)))
    throw new InputError("Espera unos minutos antes de consultar otra vez");
  const gate = await db.getGate(env, tenantId, b.gateId);
  if (!gate || gate.trigger_type !== "mqtt")
    throw new InputError("Selecciona un portón con relé MQTT");
  try {
    return platformJSON(c, { connection: await relayStatus(env, gate) });
  } catch (e) {
    if (e instanceof RelayError) throw new InputError(e.message);
    throw e;
  }
});
router.post("/api/support", parseBody, platformTenant, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");
  const tenantId = c.get("tenantId");

  return platformJSON(c, {
    phone: await db.setSupport(env, tenantId, b.phone, admin),
  });
});
router.post("/api/tenants/status", parseBody, platformTenant, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");
  const tenantId = c.get("tenantId");
  const detail = { tenantId };

  if (!["active", "suspended"].includes(b.status))
    throw new InputError("Estado inválido");
  await db.setTenantStatus(env, tenantId, b.status, admin);
  detail.status = b.status;

  return platformJSON(c, detail);
});
router.post("/api/gates", parseBody, platformTenant, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");
  const tenantId = c.get("tenantId");
  const detail = { tenantId };

  detail.gateId = await db.saveGate(env, tenantId, b, admin);
  detail.status = b.status || "active";

  return platformJSON(c, detail);
});
