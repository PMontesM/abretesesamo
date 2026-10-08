import { RECOVERY_PAUSE_MS } from "./access-recovery.js";
import { relayOpen, RelayError } from "./relay.js";
import { triggerConfig } from "./security.js";
export class TriggerError extends Error {}
export async function triggerGate(
  gate,
  env,
  sourceId = crypto.randomUUID(),
  sourceDeadline = Date.now() + RECOVERY_PAUSE_MS,
) {
  if (gate?.status === "active" && gate.trigger_type === "mqtt")
    return relayOpen(env, gate, sourceId, undefined, sourceDeadline);
  if (gate?.status === "active" && gate.trigger_type === "demo") return;
  if (!gate || gate.status !== "active" || gate.trigger_type !== "webhook")
    throw new TriggerError("Portón no disponible");
  let config;
  try {
    config = JSON.parse(gate.trigger_config);
  } catch {
    throw new TriggerError("Configuración inválida");
  }
  let safe;
  try {
    safe = JSON.parse(triggerConfig(config.url, config.method || "GET"));
  } catch {
    throw new TriggerError("Revisa la URL HTTPS y el método del portón");
  }
  // Follow redirect chains as the original integration did, without retrying a URL.
  // One timeout covers the whole chain. Never forward provider URLs/tokens to the UI.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const visited = new Set();
  let target = safe.url,
    method = safe.method;
  try {
    for (let hops = 0; hops <= 5; hops++) {
      if (visited.has(target))
        throw new TriggerError(
          "La integración devolvió una redirección circular",
        );
      visited.add(target);
      let response;
      try {
        response = await fetch(target, {
          method,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch {
        throw new TriggerError(
          controller.signal.aborted
            ? "El proveedor no respondió en 30 segundos"
            : "No se pudo conectar con el proveedor",
        );
      }
      if (response.ok) return;
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location");
        if (!location)
          throw new TriggerError(
            "La integración devolvió una redirección sin destino",
          );
        let next;
        try {
          next = new URL(location, target);
        } catch {
          throw new TriggerError("La integración devolvió un destino inválido");
        }
        if (next.protocol !== "https:" || next.username || next.password)
          throw new TriggerError(
            "La integración redirigió a un destino no permitido",
          );
        if (hops === 5)
          throw new TriggerError(
            "La integración devolvió demasiadas redirecciones",
          );
        if (
          response.status === 303 ||
          ([301, 302].includes(response.status) && method === "POST")
        )
          method = "GET";
        target = next.href;
        continue;
      }
      throw new TriggerError("El proveedor respondió HTTP " + response.status);
    }
  } finally {
    clearTimeout(timer);
  }
}
export function triggerReason(error) {
  return error instanceof TriggerError || error instanceof RelayError
    ? error.message
    : "Fallo inesperado al enviar la orden";
}
