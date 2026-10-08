import { Hono } from "hono";
import { recoverAccess, RECOVERY_PAUSE_MS } from "../lib/access-recovery.js";

import { RelayError } from "../lib/relay.js";
import * as operations from "../lib/operations.js";
import * as db from "../lib/db.js";
import { jsonBody } from "../lib/security.js";
import { takeAttempt } from "../lib/ratelimit.js";
import { triggerGate, triggerReason } from "../lib/gate-trigger.js";
export const openings = new Hono();
openings.post("/open-gate/status", async (c) => {
  const request = c.req.raw;
  const env = c.env;
  const user = c.get("user");

  const b = await jsonBody(request),
    gate = await db.requireGate(env, user, b.gateId);
  if (!(await takeAttempt(env, `direct-status:${user.id}`, 30)))
    return c.json(
      { ok: false, error: "Demasiadas consultas. Espera cinco minutos." },
      429,
    );
  await recoverAccess(env, user.tenant_id);
  const previous = await operations.findOperation(env, user, gate, b.requestId);
  return c.json({
    ok: true,
    status: previous?.status || "missing",
    acceptsOriginal: !previous && operations.validRequestTime(b.requestedAt),
    message:
      previous?.status === "sent"
        ? "La orden anterior ya fue confirmada. No se ha vuelto a enviar."
        : "La orden anterior sigue pendiente. Espera a que termine la pausa antes de solicitar otra apertura.",
  });
});
openings.post("/open-gate", async (c) => {
  const request = c.req.raw;
  const env = c.env;
  const user = c.get("user");

  const b = await jsonBody(request),
    gate = await db.requireGate(env, user, b.gateId);
  if (!(await takeAttempt(env, `direct:${user.id}`, 30)))
    return c.json(
      { ok: false, error: "Demasiadas solicitudes. Espera cinco minutos." },
      429,
    );
  const operation = await operations.reserve(
    env,
    user,
    gate,
    b.requestId,
    b.requestedAt,
  );
  if (operation.replay)
    return operation.status === "sent"
      ? c.json({
          ok: true,
          message: "La orden ya fue enviada a " + operation.gate_name,
          operationId: operation.id,
        })
      : c.json(
          {
            ok: false,
            error:
              "La orden anterior no se ha vuelto a enviar. Si terminó la pausa, puedes solicitar una nueva apertura.",
            operationId: operation.id,
            operationClosed: ["closed", "unconfirmed"].includes(
              operation.status,
            ),
          },
          409,
        );
  let outcome = "sent",
    reason = "";
  try {
    await triggerGate(
      gate,
      env,
      operation.id,
      operation.created_at + RECOVERY_PAUSE_MS,
    );
  } catch (error) {
    outcome =
      error instanceof RelayError && !error.uncertain
        ? "not_sent"
        : "uncertain";
    reason = triggerReason(error);
  }
  try {
    await operations.finish(env, operation.id, outcome);
  } catch {
    return c.json(
      {
        ok: false,
        error:
          "La orden pudo ejecutarse. No se pudo guardar el resultado; espera unos dos minutos y consulta el estado antes de solicitar otra apertura.",
        operationId: operation.id,
      },
      503,
    );
  }
  if (outcome === "not_sent")
    return c.json(
      {
        ok: false,
        error: reason + ". No se envió una nueva orden.",
        operationId: operation.id,
        operationClosed: true,
      },
      409,
    );
  return outcome === "sent"
    ? c.json({
        ok: true,
        message: "Orden de apertura enviada a " + gate.name,
        operationId: operation.id,
      })
    : c.json(
        {
          ok: false,
          error:
            gate.trigger_type === "mqtt"
              ? "No se confirmó la apertura. Espera unos dos minutos antes de solicitar otra. La incidencia queda registrada; no repetiremos la orden automáticamente."
              : "No se confirmó la orden. Solicita revisión al administrador antes de repetir la apertura.",
          operationClosed: gate.trigger_type === "mqtt",
          operationId: operation.id,
        },
        502,
      );
});
