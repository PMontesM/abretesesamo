import { InputError } from "./security.js";
const enc = new TextEncoder(),
  dec = new TextDecoder();
const to64 = (b) => btoa(String.fromCharCode(...b));
const from64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const context = enc.encode("porton-saas/mqtt-credentials/v1");
export const DEFAULT_BROKER = {
  broker: "95cad9bec61b432488ee5d0d0ef98773.s1.eu.hivemq.cloud",
  port: 8884,
  path: "/mqtt",
};
export function brokerConfig(value = {}) {
  const broker = String(value.broker ?? DEFAULT_BROKER.broker)
      .trim()
      .toLowerCase(),
    port = Number(value.port ?? DEFAULT_BROKER.port),
    path = String(value.path ?? DEFAULT_BROKER.path).trim();
  if (
    broker.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(broker) ||
    /\.(localhost|local|internal|test|invalid|example)$/.test(broker)
  )
    throw new InputError(
      "Escribe el nombre público del servidor MQTT, sin https://, puerto ni ruta",
    );
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new InputError("El puerto debe ser un número entre 1 y 65535");
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(path) || path.length > 128)
    throw new InputError(
      "La ruta WebSocket debe comenzar con / y usar letras, números, guiones o barras",
    );
  return { broker, port, path };
}
export const brokerEndpoint = (value) => {
  const c = brokerConfig(value);
  return `https://${c.broker}:${c.port}${c.path}`;
};
async function key(env) {
  if (!env.MQTT_ENCRYPTION_KEY)
    throw new InputError(
      "La conexión de relés necesita completar su instalación",
    );
  return crypto.subtle.importKey(
    "raw",
    from64(env.MQTT_ENCRYPTION_KEY),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function loadRelayCredentials(env) {
  const row = await env.DB.prepare(
    "SELECT payload,updated_at FROM relay_settings WHERE id='credentials'",
  ).first();
  if (!row) return null;
  try {
    const stored = JSON.parse(row.payload),
      plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: from64(stored.iv), additionalData: context },
        await key(env),
        from64(stored.ciphertext),
      );
    return { ...JSON.parse(dec.decode(plain)), savedAt: row.updated_at };
  } catch {
    throw new InputError(
      "No se pudieron leer las credenciales de relés. Vuelve a guardarlas desde Conexión de relés.",
    );
  }
}
export async function relaySettingsSummary(env) {
  const value = await loadRelayCredentials(env);
  return {
    configured: Boolean(value),
    commandUsername: value?.commandUsername || "backend-api",
    statusUsername: value?.statusUsername || "backend-status",
    ...brokerConfig(value || {}),
  };
}
export async function saveRelayCredentials(env, body, actor) {
  const old = await loadRelayCredentials(env),
    value = brokerConfig({
      ...brokerConfig(old || {}),
      ...Object.fromEntries(
        ["broker", "port", "path"]
          .filter((k) => body[k] !== undefined)
          .map((k) => [k, body[k]]),
      ),
    });
  for (const role of ["command", "status"]) {
    const name = body[role + "Username"];
    if (typeof name !== "string" || !name.trim() || name.length > 128)
      throw new InputError("Escribe ambos usuarios del servidor MQTT");
    value[role + "Username"] = name.trim();
    const password = body[role + "Password"];
    if (password !== undefined && typeof password !== "string")
      throw new InputError("Contraseña inválida");
    value[role + "Password"] =
      password ||
      (old?.[role + "Username"] === value[role + "Username"]
        ? old?.[role + "Password"]
        : null);
    if (!value[role + "Password"] || value[role + "Password"].length > 1024)
      throw new InputError(
        "Escribe la contraseña de cada cuenta; al cambiar de usuario es necesario escribirla de nuevo",
      );
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: context },
    await key(env),
    enc.encode(JSON.stringify(value)),
  );
  const payload = JSON.stringify({
    v: 1,
    iv: to64(iv),
    ciphertext: to64(new Uint8Array(ciphertext)),
  });
  const savedAt = Math.max(Date.now(), (old?.savedAt || 0) + 1);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO relay_settings(id,payload,updated_at) VALUES('credentials',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
    ).bind(payload, savedAt),
    env.DB.prepare(
      "UPDATE relay_devices SET connection_state='unknown',checked_at=NULL,sampled_at=NULL,rssi=NULL,pulse_ms=NULL",
    ),
    env.DB.prepare(
      "INSERT INTO platform_audit_log(id,admin_username,action,details,at) VALUES(?,?,'relay_credentials_updated',?,?)",
    ).bind(
      crypto.randomUUID(),
      actor.username,
      JSON.stringify({
        actorId: actor.id,
        commandUsername: value.commandUsername,
        statusUsername: value.statusUsername,
      }),
      Date.now(),
    ),
  ]);
}
