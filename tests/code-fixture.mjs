import { createCode } from "../src/lib/codes.js";
export async function seedCode(env, user, body) {
  const result = await createCode(env, user, {
    gateIds: [body.gateId],
    label: body.label,
    mode: body.visit ? "visit" : body.days === 0 ? "unlimited" : "repeat",
    ...(body.days === 0 || body.visit ? {} : { days: body.days ?? 1 }),
  });
  if (body.expiresAt !== undefined)
    await env.DB.prepare(
      "UPDATE codes SET expires_at=? WHERE code=? AND tenant_id=?",
    )
      .bind(body.expiresAt, result.code, user.tenant_id)
      .run();
  if (body.singleUse)
    await env.DB.prepare(
      "UPDATE codes SET single_use=1 WHERE code=? AND tenant_id=?",
    )
      .bind(result.code, user.tenant_id)
      .run();
  return env.DB.prepare(
    "SELECT c.*,g.name AS gate_name FROM codes c JOIN gates g ON g.id=c.gate_id WHERE c.code=? AND c.tenant_id=?",
  )
    .bind(result.code, user.tenant_id)
    .first();
}
