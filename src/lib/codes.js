import { recoverAccess } from "./access-recovery.js";
import { allowedGates } from "./db.js";
import { InputError, required } from "./security.js";
import { takeAttempt } from "./ratelimit.js";
export async function createCode(env, user, body) {
  if (["gateId", "singleUse", "visit"].some((key) => Object.hasOwn(body, key)))
    throw new InputError(
      "Actualiza la página para crear el código con sus accesos y vigencia.",
    );
  const ids = [...new Set(Array.isArray(body.gateIds) ? body.gateIds : [])];
  if (
    !ids.length ||
    ids.length > 10 ||
    ids.some((id) => typeof id !== "string")
  )
    throw new InputError("Selecciona entre uno y diez accesos");
  const allowed = await allowedGates(env, user),
    gates = ids.map((id) => allowed.find((g) => g.id === id));
  if (gates.some((g) => !g)) throw new InputError("Acceso no autorizado");
  const label = required(body.label, "Nombre o referencia", 60);
  const mode = body.mode || "repeat";
  if (!["repeat", "visit", "unlimited"].includes(mode))
    throw new InputError("Tipo de código inválido");
  if (
    Object.keys(body).some(
      (key) => !["gateIds", "label", "mode", "days"].includes(key),
    )
  )
    throw new InputError(
      "Actualiza la página: el código se crea por tipo y días de vigencia.",
    );
  const days = body.days;
  if (mode === "repeat" && (!Number.isInteger(days) || days < 1 || days > 30))
    throw new InputError("Elige de 1 a 30 días");
  if (mode !== "repeat" && days !== undefined)
    throw new InputError("Solo los códigos con vigencia requieren días");
  if (!(await takeAttempt(env, "create-code:" + user.id, 30)))
    throw new InputError("Espera antes de crear más códigos");
  const now = Date.now(),
    expires =
      mode === "unlimited"
        ? null
        : now + (mode === "visit" ? 7 : days) * 86400000,
    token = crypto.randomUUID();
  for (let i = 0; i < 20; i++) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0];
    if (n >= 4294000000) continue;
    const code = String(n % 1000000).padStart(6, "0");
    const insert = env.DB.prepare(
      `INSERT INTO codes(code,tenant_id,gate_id,label,owner,owner_id,single_use,expires_at,created_at,visit_mode,creation_token)
   SELECT ?,?,?,?,?,?,0,?,?,?,? WHERE (SELECT COUNT(*) FROM codes WHERE tenant_id=?)<20000 AND (SELECT COUNT(*) FROM codes WHERE tenant_id=? AND owner_id=? AND status IN ('active','pending','uncertain') AND (expires_at IS NULL OR expires_at>?))<200 ON CONFLICT DO NOTHING`,
    ).bind(
      code,
      user.tenant_id,
      ids[0],
      label,
      user.username,
      user.id,
      expires,
      now,
      mode === "visit" ? 1 : 0,
      token,
      user.tenant_id,
      user.tenant_id,
      user.id,
      now,
    );
    const result = await env.DB.batch([
      insert,
      ...gates.map((g) =>
        env.DB.prepare(
          "INSERT INTO code_gates(tenant_id,code,gate_id,authorized_config) SELECT tenant_id,code,?,? FROM codes WHERE tenant_id=? AND code=? AND creation_token=?",
        ).bind(g.id, g.trigger_config, user.tenant_id, code, token),
      ),
    ]);
    if (result[0].meta.changes) return { code };
  }
  throw new InputError(
    "No se pudo crear el pase. Revisa la cuota de códigos activos.",
  );
}
export async function listCodes(env, tenantId, user = null, options = {}) {
  const codes = await listCodeRows(env, tenantId, user, options);
  if (!codes.length) return [];
  const links = (
    await env.DB.prepare(
      `SELECT c.code,g.id,g.name FROM code_gates c JOIN gates g ON g.id=c.gate_id AND g.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.code IN (${codes.map(() => "?").join(",")})`,
    )
      .bind(tenantId, ...codes.map((c) => c.code))
      .all()
  ).results;
  return codes.map((c) => ({
    ...c,
    creation_token: undefined,
    access: links
      .filter((l) => l.code === c.code)
      .map((l) => ({ id: l.id, name: l.name }))
      .concat(
        links.some((l) => l.code === c.code)
          ? []
          : [{ id: c.gate_id, name: c.gate_name }],
      ),
  }));
}
export async function extendCode(env, user, body) {
  if (!Number.isSafeInteger(body.expiresAt))
    throw new InputError("Actualiza la vigencia antes de extender");
  if (!(await takeAttempt(env, "extend-pass:" + user.id, 20)))
    throw new InputError("Demasiadas solicitudes");
  const now = Date.now(),
    owner = user.role === "master" ? null : user.id;
  const result = await env.DB.prepare(
    `UPDATE codes SET expires_at=expires_at+1800000 WHERE tenant_id=? AND code=? AND (? IS NULL OR owner_id=?) AND status='active' AND single_use=0 AND visit_mode=0 AND expires_at=? AND expires_at>? AND expires_at<=? AND expires_at+1800000<=created_at+604800000
  AND EXISTS(SELECT 1 FROM gates g WHERE g.id=codes.gate_id AND g.status='active')
  AND NOT EXISTS(SELECT 1 FROM code_gates cg JOIN gates g ON g.id=cg.gate_id WHERE cg.tenant_id=codes.tenant_id AND cg.code=codes.code AND (g.status!='active' OR g.trigger_config!=cg.authorized_config))
  AND EXISTS(SELECT 1 FROM users u WHERE u.id=codes.owner_id AND u.tenant_id=codes.tenant_id AND (u.role='master' OR (EXISTS(SELECT 1 FROM user_gates p WHERE p.user_id=u.id AND p.gate_id=codes.gate_id) AND NOT EXISTS(SELECT 1 FROM code_gates cg WHERE cg.tenant_id=codes.tenant_id AND cg.code=codes.code AND NOT EXISTS(SELECT 1 FROM user_gates p WHERE p.user_id=u.id AND p.gate_id=cg.gate_id)))))`,
  )
    .bind(
      user.tenant_id,
      body.code,
      owner,
      owner,
      body.expiresAt,
      now,
      now + 600000,
    )
    .run();
  if (!result.meta.changes)
    throw new InputError(
      "No se extendió: actualiza el pase. Solo los reutilizables activos que vencen en diez minutos se pueden extender, hasta siete días desde su creación.",
    );
}
export async function visitorGates(env, tenantId, code) {
  await recoverAccess(env, tenantId);
  const row = await env.DB.prepare(
    "SELECT * FROM codes WHERE tenant_id=? AND code=? AND status='active' AND (expires_at IS NULL OR expires_at>?)",
  )
    .bind(tenantId, code, Date.now())
    .first();
  if (!row) return [];
  const user = await env.DB.prepare(
    "SELECT * FROM users WHERE tenant_id=? AND id=?",
  )
    .bind(tenantId, row.owner_id)
    .first();
  if (!user) return [];
  const gates = await allowedGates(env, user),
    links = (
      await env.DB.prepare(
        "SELECT * FROM code_gates WHERE tenant_id=? AND code=?",
      )
        .bind(tenantId, code)
        .all()
    ).results;
  return gates
    .filter((g) =>
      links.length
        ? links.some(
            (l) =>
              l.gate_id === g.id && l.authorized_config === g.trigger_config,
          )
        : g.id === row.gate_id,
    )
    .map((g) => ({ id: g.id, name: g.name }));
}

const rows = async (statement) => (await statement.all()).results || [];
async function listCodeRows(env, tenantId, user = null, options = {}) {
  const owner = user && user.role !== "master" ? user.id : null;
  const page = Number(options.page || 0);
  if (!Number.isSafeInteger(page) || page < 0 || page > 100000)
    throw new InputError("Página inválida");
  const search = String(options.search || "").trim();
  if (search.length > 64) throw new InputError("Búsqueda inválida");
  const query = String(options.query || "")
      .trim()
      .toLowerCase(),
    filterOwner = String(options.ownerId || ""),
    filterGate = String(options.gateId || "");
  if (query.length > 100 || filterOwner.length > 100 || filterGate.length > 100)
    throw new InputError("Filtro inválido");
  const requestedState = String(options.status || "");
  const state = requestedState === "current" ? "" : requestedState;
  if (
    state &&
    !["active", "pending", "uncertain", "revoked", "expired", "used"].includes(
      state,
    )
  )
    throw new InputError("Estado inválido");
  return rows(
    env.DB.prepare(
      "SELECT c.*,COALESCE((SELECT GROUP_CONCAT(linked.name, ' / ') FROM code_gates cg JOIN gates linked ON linked.id=cg.gate_id AND linked.tenant_id=cg.tenant_id WHERE cg.tenant_id=c.tenant_id AND cg.code=c.code),g.name) AS gate_name,g.status AS gate_status FROM codes c LEFT JOIN gates g ON g.id=c.gate_id AND g.tenant_id=c.tenant_id WHERE c.tenant_id=? AND (? IS NULL OR c.owner_id=?) AND (?='' OR (CASE WHEN c.owner_id=? THEN c.code ELSE substr(c.code,1,2)||'••'||substr(c.code,5,2) END)=?) AND (?='' OR CASE WHEN c.status='active' AND c.expires_at IS NOT NULL AND c.expires_at<=? THEN 'expired' ELSE c.status END=?) AND (?=0 OR (c.status IN ('pending','uncertain') OR (c.status='active' AND (c.expires_at IS NULL OR c.expires_at>?)))) AND (?='' OR c.owner_id=?) AND (?='' OR c.gate_id=? OR EXISTS(SELECT 1 FROM code_gates cg WHERE cg.tenant_id=c.tenant_id AND cg.code=c.code AND cg.gate_id=?)) AND (?='' OR instr(lower((CASE WHEN c.owner_id=? THEN c.code ELSE substr(c.code,1,2)||'••'||substr(c.code,5,2) END)||' '||COALESCE(c.label,'')||' '||COALESCE(c.owner,'')),?)>0) ORDER BY c.created_at DESC,c.code DESC LIMIT 100 OFFSET ?",
    ).bind(
      tenantId,
      owner,
      owner,
      search,
      user?.id || "",
      search,
      state,
      Date.now(),
      state,
      requestedState === "current" ? 1 : 0,
      Date.now(),
      filterOwner,
      filterOwner,
      filterGate,
      filterGate,
      filterGate,
      query,
      user?.id || "",
      query,
      page * 100,
    ),
  );
}
