import { Hono } from "hono";
import {
  platformJSON,
  parseBody,
  platformTenant,
} from "../middleware/access.js";
import {
  relayStatus,
  pendingRelays,
  resolveRelay,
  RelayError,
} from "../lib/relay.js";
import {
  listInventory,
  registerRelay,
  requireInventory,
  discoverRelays,
} from "../lib/relay-inventory.js";
import {
  relaySettingsSummary,
  saveRelayCredentials,
} from "../lib/relay-settings.js";
import { InputError, verifySecret } from "../lib/security.js";
import { takeAttempt } from "../lib/ratelimit.js";
export const router = new Hono();
router.get("/api/relay-inventory", async (c) => {
  const env = c.env;
  return platformJSON(c, { devices: await listInventory(env) });
});
router.get("/api/relay-settings", async (c) => {
  const env = c.env;
  return platformJSON(c, { settings: await relaySettingsSummary(env) });
});
router.get("/api/relays", platformTenant, async (c) => {
  const env = c.env;
  const tenantId = c.get("tenantId");
  return platformJSON(c, { commands: await pendingRelays(env, tenantId) });
});
router.post("/api/relay-settings", parseBody, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");

  if (!(await takeAttempt(env, "relay-settings:" + admin.id, 10)))
    throw new InputError("Demasiados intentos. Espera cinco minutos.");
  if (!(await verifySecret(b.currentSecret, admin.secret)))
    throw new InputError("Tu contraseña de plataforma es incorrecta");
  await saveRelayCredentials(env, b, admin);
  return platformJSON(c, {});
});
router.post("/api/relay-inventory", parseBody, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");

  if (!(await takeAttempt(env, "relay-register:" + admin.id, 30)))
    throw new InputError("Espera unos minutos antes de registrar más relés");
  return platformJSON(c, { deviceId: await registerRelay(env, b, admin) });
});
router.post("/api/relay-inventory/discover", parseBody, async (c) => {
  const env = c.env;
  const admin = c.get("admin");

  if (!(await takeAttempt(env, "relay-discover:" + admin.id, 5)))
    throw new InputError("Espera unos minutos antes de buscar otra vez");
  return platformJSON(c, await discoverRelays(env));
});
router.post("/api/relay-inventory/connection", parseBody, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");

  if (!(await takeAttempt(env, "relay-status:" + admin.id, 30)))
    throw new InputError("Espera unos minutos antes de consultar otra vez");
  await requireInventory(env, b.deviceId);
  try {
    return platformJSON(c, {
      connection: await relayStatus(env, {
        trigger_config: JSON.stringify({ deviceId: b.deviceId }),
      }),
    });
  } catch (e) {
    if (e instanceof RelayError) throw new InputError(e.message);
    throw e;
  }
});
router.post("/api/relays/resolve", parseBody, platformTenant, async (c) => {
  const env = c.env;
  const admin = c.get("admin");
  const b = c.get("body");
  const tenantId = c.get("tenantId");

  await resolveRelay(env, tenantId, b.commandId, admin);
  return platformJSON(c, {});
});
