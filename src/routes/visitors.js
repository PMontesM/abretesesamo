import { Hono } from "hono";
import { recoverAccess, RECOVERY_PAUSE_MS } from "../lib/access-recovery.js";

import { turnstileConfig } from "../lib/turnstile.js";
import { visitorGates } from "../lib/codes.js";
import { RelayError } from "../lib/relay.js";
import * as db from "../lib/db.js";
import { getPublicHTML } from "../html/public.js";
import {
  triggerGate,
  TriggerError,
  triggerReason,
} from "../lib/gate-trigger.js";
import { visitorInput } from "../middleware/access.js";
export const visitors = new Hono();
visitors.get("/", async (c) => {
  const env = c.env;
  const tenant = c.get("tenant");
  return c.html(getPublicHTML(tenant, turnstileConfig(env)));
});
visitors.post("/api/access-state", visitorInput, async (c) => {
  const env = c.env;
  const tenant = c.get("tenant");
  const b = c.get("body");

  return c.json({
    ok: true,
    ...(await db.visitorStatus(env, tenant.id, b.code)),
    gates: await visitorGates(env, tenant.id, b.code),
  });
});
visitors.post("/api/open", visitorInput, async (c) => {
  const env = c.env;
  const tenant = c.get("tenant");
  const b = c.get("body");

  await recoverAccess(env, tenant.id);
  const candidate = await env.DB.prepare(
    "SELECT visit_mode,visit_started_at FROM codes WHERE tenant_id=? AND code=? AND status='active' AND (expires_at IS NULL OR expires_at>?)",
  )
    .bind(tenant.id, b.code, Date.now())
    .first();

  const gates = await visitorGates(env, tenant.id, b.code);
  if (gates.length > 1 && !b.gateId)
    return c.json({
      ok: true,
      selectionRequired: true,
      gates,
      message: "Selecciona el acceso que quieres abrir.",
    });
  if (b.gateId && !gates.some((g) => g.id === b.gateId))
    return c.json(
      { ok: false, error: "Este pase no autoriza ese acceso" },
      403,
    );
  if (
    candidate?.visit_mode &&
    !candidate.visit_started_at &&
    b.confirmVisit !== true
  )
    return c.json({
      ok: true,
      confirmationRequired: true,
      message:
        "¿Estás frente al portón? Desde el primer envío tendrás 10 minutos para volver a abrir, incluso si no llega la confirmación. Después, el código dejará de funcionar.",
    });
  const row = await db.claimCode(env, tenant.id, b.code, b.gateId || null);
  if (!row)
    return c.json(
      {
        ok: false,
        error: (await db.visitorStatus(env, tenant.id, b.code)).message,
      },
      403,
    );
  const gate = await db.getGate(env, tenant.id, row.gate_id);
  let outcome = "sent",
    reason = "";
  try {
    if (gate?.trigger_config !== row.authorized_config)
      throw new TriggerError("La configuración del portón cambió");
    await triggerGate(
      gate,
      env,
      row.claim_token,
      row.claimed_at + RECOVERY_PAUSE_MS,
    );
  } catch (error) {
    outcome =
      error instanceof RelayError && !error.uncertain
        ? "not_sent"
        : "uncertain";
    reason = triggerReason(error);
    console.warn(
      JSON.stringify({
        event: "gate_trigger_failed",
        gateId: gate?.id,
        reason,
      }),
    );
  }
  // Persist completion with its audit record. Failure leaves the reservation for review.
  try {
    await db.finishCode(
      env,
      row,
      gate || { id: row.gate_id, name: "Portón no disponible" },
      outcome,
    );
  } catch {
    return c.json(
      {
        ok: false,
        error:
          "La orden pudo ejecutarse, pero no se pudo guardar el resultado. Espera unos dos minutos y consulta el estado; si persiste, contacta al administrador.",
      },
      503,
    );
  }
  if (outcome === "not_sent")
    return c.json(
      {
        ok: false,
        error:
          reason +
          ". No se envió una nueva orden; el código conserva su vigencia.",
      },
      409,
    );
  if (outcome !== "sent")
    return c.json(
      {
        ok: false,
        error:
          "No se pudo confirmar la orden. " +
          reason +
          (gate?.trigger_type === "mqtt"
            ? ". Espera unos dos minutos y consulta el estado. No repetiremos la orden automáticamente."
            : ". El código queda en revisión; contacta al administrador."),
      },
      502,
    );
  return c.json({
    ok: true,
    message: `Orden de apertura enviada a ${gate.name}`,
    gateName: gate.name,
    visitExpiresAt: row.visit_mode
      ? (
          await env.DB.prepare(
            "SELECT expires_at FROM codes WHERE tenant_id=? AND code=?",
          )
            .bind(tenant.id, row.code)
            .first()
        ).expires_at
      : null,
    serverNow: Date.now(),
  });
});
