// MQTT commands expire after ten seconds. Keep two additional minutes for the
// maximum accepted pulse/cooldown, clock skew and a stalled Worker. Recovery
// never publishes: only a subsequent, explicit user action can open a gate.
import { RECOVERY_PAUSE_MS, relayReleaseSQL } from "./access-policy.js";
export { RECOVERY_PAUSE_MS } from "./access-policy.js";
const scopes = new WeakMap();
export function recoveryScope(env) {
  const scoped = Object.create(env);
  scopes.set(scoped, new Map());
  return scoped;
}
export function recoverAccess(env, tenantId = null) {
  const scope = scopes.get(env);
  if (!scope) return runRecovery(env, tenantId);
  if (!scope.has(tenantId)) {
    const pending = runRecovery(env, tenantId).catch((error) => {
      scope.delete(tenantId);
      throw error;
    });
    scope.set(tenantId, pending);
  }
  return scope.get(tenantId);
}
async function runRecovery(env, tenantId = null) {
  const now = Date.now();
  // No writes on the normal path. Only stalled reservations need recovery.
  const due = await env.DB.prepare(
    `SELECT 1 AS due FROM relay_commands WHERE (? IS NULL OR tenant_id=?) AND
    ((status IN ('pending','uncertain') AND ${relayReleaseSQL()}<=?) OR (status='cooldown' AND release_at<=?))
    UNION ALL SELECT 1 FROM direct_operations WHERE (? IS NULL OR tenant_id=?) AND status IN ('pending','uncertain') AND created_at<=? AND EXISTS(SELECT 1 FROM gates g WHERE g.id=direct_operations.gate_id AND g.trigger_type IN ('mqtt','demo'))
    UNION ALL SELECT 1 FROM codes WHERE (? IS NULL OR tenant_id=?) AND status IN ('pending','uncertain') AND claimed_at<=? AND EXISTS(SELECT 1 FROM gates g WHERE g.id=codes.gate_id AND g.trigger_type IN ('mqtt','demo')) LIMIT 1`,
  )
    .bind(
      tenantId,
      tenantId,
      now,
      now,
      tenantId,
      tenantId,
      now - RECOVERY_PAUSE_MS,
      tenantId,
      tenantId,
      now - RECOVERY_PAUSE_MS,
    )
    .first();
  if (!due) return;
  const relayDue = `${relayReleaseSQL()}<=?`;
  const directDue = `status IN ('pending','uncertain') AND created_at<=?
    AND (? IS NULL OR tenant_id=?)
    AND EXISTS(SELECT 1 FROM gates g WHERE g.id=direct_operations.gate_id AND g.trigger_type IN ('mqtt','demo'))
    AND NOT EXISTS(SELECT 1 FROM relay_commands r WHERE r.source_id=direct_operations.id AND r.status IN ('pending','uncertain','cooldown'))`;
  const codeDue = `status IN ('pending','uncertain') AND claimed_at<=?
    AND (? IS NULL OR tenant_id=?)
    AND EXISTS(SELECT 1 FROM gates g WHERE g.id=codes.gate_id AND g.trigger_type IN ('mqtt','demo'))
    AND NOT EXISTS(SELECT 1 FROM code_gates cg JOIN gates g ON g.id=cg.gate_id WHERE cg.tenant_id=codes.tenant_id AND cg.code=codes.code AND g.trigger_type NOT IN ('mqtt','demo'))
    AND NOT EXISTS(SELECT 1 FROM relay_commands r WHERE r.tenant_id=codes.tenant_id
      AND (r.source_id=codes.claim_token OR r.gate_id=codes.gate_id OR EXISTS(SELECT 1 FROM code_gates cg WHERE cg.tenant_id=codes.tenant_id AND cg.code=codes.code AND cg.gate_id=r.gate_id))
      AND r.status IN ('pending','uncertain','cooldown'))`;
  const dueParams = [now - RECOVERY_PAUSE_MS, tenantId, tenantId];
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE relay_commands SET status='completed' WHERE status='cooldown' AND release_at<=? AND (? IS NULL OR tenant_id=?)",
    ).bind(now, tenantId, tenantId),
    env.DB.prepare(
      `UPDATE relay_commands SET status='unconfirmed' WHERE status IN ('pending','uncertain') AND ${relayDue} AND (? IS NULL OR tenant_id=?)`,
    ).bind(now, tenantId, tenantId),
    env.DB.prepare(
      `UPDATE logs SET outcome='uncertain' WHERE outcome='pending' AND id IN (SELECT id FROM direct_operations WHERE ${directDue})`,
    ).bind(...dueParams),
    env.DB.prepare(
      `UPDATE direct_operations SET status='unconfirmed' WHERE ${directDue}`,
    ).bind(...dueParams),
    // Interrupted visitor requests may not have reached finishCode/logOpen.
    env.DB.prepare(
      `INSERT OR IGNORE INTO logs(id,tenant_id,gate_id,gate_name,code,label,owner,owner_id,at,outcome)
      SELECT 'recovery:'||tenant_id||':'||code||':'||claimed_at,tenant_id,gate_id,
      (SELECT name FROM gates WHERE id=codes.gate_id),code,label,owner,owner_id,claimed_at,'uncertain'
      FROM codes WHERE ${codeDue} AND NOT EXISTS(SELECT 1 FROM logs l WHERE l.tenant_id=codes.tenant_id AND l.code=codes.code AND l.at>=codes.claimed_at)`,
    ).bind(...dueParams),
    // Do not revive cancelled/used codes. A possibly used visit starts at the
    // first attempt, never at recovery; a strict single-use code remains used.
    env.DB.prepare(
      `UPDATE codes SET status=CASE WHEN single_use=1 THEN 'used' ELSE 'active' END,
      visit_started_at=CASE WHEN visit_mode=1 THEN COALESCE(visit_started_at,claimed_at) ELSE visit_started_at END,
      expires_at=CASE WHEN visit_mode=1 THEN MIN(COALESCE(expires_at,9223372036854775807),COALESCE(visit_started_at,claimed_at)+600000) ELSE expires_at END,
      claim_token=NULL WHERE ${codeDue}`,
    ).bind(...dueParams),
    env.DB.prepare(
      "UPDATE codes SET status='expired' WHERE status='active' AND expires_at<=? AND (? IS NULL OR tenant_id=?)",
    ).bind(now, tenantId, tenantId),
  ]);
}
