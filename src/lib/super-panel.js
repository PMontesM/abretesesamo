import { listInventory } from "./relay-inventory.js";
export async function superPanel(env, offset = 0) {
  offset = Number(offset);
  if (!Number.isInteger(offset) || Math.abs(offset) > 840) offset = 0;
  const now = Date.now(),
    midnight =
      Math.floor((now - offset * 60000) / 86400000) * 86400000 + offset * 60000;
  const [tenants, devices, counts, admins, audit] = await Promise.all([
    env.DB.prepare(
      `SELECT t.id,t.name,t.slug,t.status,(SELECT COUNT(*) FROM codes c WHERE c.tenant_id=t.id AND c.status IN ('pending','uncertain'))+(SELECT COUNT(*) FROM direct_operations o WHERE o.tenant_id=t.id AND o.status IN ('pending','uncertain'))+(SELECT COUNT(*) FROM relay_commands r WHERE r.tenant_id=t.id AND r.status IN ('pending','uncertain')) AS pending FROM tenants t ORDER BY t.name`,
    ).all(),
    listInventory(env),
    env.DB.prepare(
      "SELECT tenant_id,SUM(CASE WHEN at>=? THEN 1 ELSE 0 END) AS today,SUM(CASE WHEN at<? THEN 1 ELSE 0 END) AS yesterday FROM logs WHERE outcome='sent' AND at>=? GROUP BY tenant_id",
    )
      .bind(midnight, midnight, midnight - 86400000)
      .all(),
    env.DB.prepare(
      "SELECT tenant_id,username FROM users WHERE role='master' ORDER BY username",
    ).all(),
    env.DB.prepare(
      "SELECT id,admin_username,action,details,at FROM platform_audit_log ORDER BY at DESC LIMIT 200",
    ).all(),
  ]);
  return {
    serverNow: now,
    buildings: tenants.results.map((t) => ({
      ...t,
      admin:
        admins.results
          .filter((a) => a.tenant_id === t.id)
          .map((a) => a.username)
          .join(", ") || "Sin administrador",
      today: counts.results.find((c) => c.tenant_id === t.id)?.today || 0,
    })),
    yesterday: counts.results.reduce((n, c) => n + c.yesterday, 0),
    devices,
    audit: audit.results,
  };
}
