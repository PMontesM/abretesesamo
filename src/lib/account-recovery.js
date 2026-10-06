import { InputError, hashSecret } from "./security.js";
const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export const recoveryHash = async (token) =>
  hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  );
export async function issueRecovery(env, accountId, actor) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32))),
    digest = await recoveryHash(token),
    expiresAt = Date.now() + 15 * 60000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM account_recovery WHERE account_id=?").bind(
      accountId,
    ),
    env.DB.prepare("INSERT INTO account_recovery VALUES(?,?,?)").bind(
      digest,
      accountId,
      expiresAt,
    ),
    env.DB.prepare(
      "INSERT INTO platform_audit_log(id,admin_username,action,details,at) VALUES(?,?,?,?,?)",
    ).bind(
      crypto.randomUUID(),
      actor.username,
      "issue_account_recovery",
      JSON.stringify({ accountId }),
      Date.now(),
    ),
  ]);
  return { token, expiresAt };
}
export async function redeemRecovery(env, body) {
  if (!/^[a-f0-9]{64}$/.test(body.token || ""))
    throw new InputError("Enlace inválido o vencido. Solicita uno nuevo.");
  if (body.secret !== body.confirmSecret)
    throw new InputError("Las contraseñas no coinciden.");
  const secret = await hashSecret(body.secret),
    digest = await recoveryHash(body.token),
    now = Date.now();
  const result = await env.DB.batch([
    env.DB.prepare(
      "UPDATE accounts SET secret=?,session_version=session_version+1 WHERE id=(SELECT account_id FROM account_recovery WHERE token_hash=? AND expires_at>?)",
    ).bind(secret, digest, now),
    env.DB.prepare("DELETE FROM account_recovery WHERE token_hash=?").bind(
      digest,
    ),
  ]);
  if (!result[0].meta.changes)
    throw new InputError(
      "Enlace inválido, utilizado o vencido. Solicita uno nuevo.",
    );
}
