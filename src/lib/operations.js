import { InputError } from "./security.js";
import { auditStatements } from "./db.js";
export async function reserve(env, user, gate, id) {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))
    throw new InputError(
      "Actualiza la página para iniciar una orden identificada",
    );
  const existing = await env.DB.prepare(
    "SELECT * FROM direct_operations WHERE id=?",
  )
    .bind(id)
    .first();
  if (existing) {
    if (
      existing.tenant_id !== user.tenant_id ||
      existing.owner_id !== user.id ||
      existing.gate_id !== gate.id
    )
      throw new InputError("Identificador de orden no disponible");
    return { ...existing, replay: true };
  }
  // Atomic unique gate lock and durable intent before any external request.
  const r = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO direct_operations(id,tenant_id,gate_id,owner_id,gate_name,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING",
    ).bind(id, user.tenant_id, gate.id, user.id, gate.name, Date.now()),
    env.DB.prepare(
      "INSERT INTO logs(id,tenant_id,gate_id,gate_name,code,label,owner,owner_id,at,outcome) SELECT ?,?,?,?,'DIRECTO','Acceso panel',?,?,?,'pending' WHERE changes()>0",
    ).bind(
      id,
      user.tenant_id,
      gate.id,
      gate.name,
      user.username,
      user.id,
      Date.now(),
    ),
  ]);
  if (!r[0].meta.changes) {
    const row = await env.DB.prepare(
      "SELECT * FROM direct_operations WHERE id=? AND owner_id=? AND tenant_id=? AND gate_id=?",
    )
      .bind(id, user.id, user.tenant_id, gate.id)
      .first();
    if (row) return { ...row, replay: true };
    throw new InputError(
      "Hay una orden pendiente en este portón. Solicita revisión al administrador de plataforma.",
    );
  }
  return { id, status: "pending", gate_name: gate.name, replay: false };
}
export async function finish(env, id, outcome) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE logs SET outcome=? WHERE id=? AND outcome='pending'",
    ).bind(outcome, id),
    env.DB.prepare(
      "UPDATE direct_operations SET status=? WHERE id=? AND status='pending'",
    ).bind(outcome === "not_sent" ? "closed" : outcome, id),
  ]);
}
export async function list(env, tenantId) {
  return (
    await env.DB.prepare(
      "SELECT * FROM direct_operations WHERE tenant_id=? AND status IN ('pending','uncertain') ORDER BY created_at",
    )
      .bind(tenantId)
      .all()
  ).results;
}
export async function resolve(env, tenantId, id, actor) {
  const r = await env.DB.batch([
    env.DB.prepare(
      "UPDATE direct_operations SET status='closed' WHERE tenant_id=? AND id=? AND (status='uncertain' OR (status='pending' AND created_at<?))",
    ).bind(tenantId, id, Date.now() - 120000),
    ...auditStatements(
      env,
      actor,
      "resolve_direct",
      { tenantId, operationId: id },
      true,
    ),
    env.DB.prepare(
      "UPDATE logs SET outcome='uncertain' WHERE id=? AND outcome='pending' AND EXISTS(SELECT 1 FROM direct_operations WHERE id=? AND tenant_id=? AND status='closed')",
    ).bind(id, id, tenantId),
  ]);
  if (!r[0].meta.changes)
    throw new InputError("La orden sigue en curso o ya fue resuelta");
}
