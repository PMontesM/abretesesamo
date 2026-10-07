const enc = new TextEncoder(),
  b64 = (b) =>
    btoa(String.fromCharCode(...b))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
async function sign(env, text) {
  if (!env.ADMIN_SIGNING_SECRET || env.ADMIN_SIGNING_SECRET.length < 32)
    throw Error("Missing signing key");
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(env.ADMIN_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, enc.encode("account:" + text)),
    ),
  );
}
export const accountCookiePresent = (request) =>
  (request.headers.get("Cookie") || "")
    .split(";")
    .some((p) => p.trim().startsWith("account_session="));
export const clearAccountCookie = () =>
  "account_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0";
async function sessionPolicy(env, accountId) {
  const platform = await env.DB.prepare(
    "SELECT 1 FROM account_platform WHERE account_id=?",
  )
    .bind(accountId)
    .first();
  if (platform) return "platform";
  const roles = await env.DB.prepare(
    "SELECT u.role FROM account_memberships m JOIN users u ON u.id=m.user_id AND u.tenant_id=m.tenant_id WHERE m.account_id=?",
  )
    .bind(accountId)
    .all();
  return roles.results.length && roles.results.every((u) => u.role === "user")
    ? "resident"
    : "admin";
}
export async function accountCookie(env, account) {
  const policy = await sessionPolicy(env, account.id);
  const seconds =
    policy === "platform"
      ? 3600
      : policy === "resident"
        ? 400 * 86400
        : 30 * 86400;
  const payload = b64(
    enc.encode(
      JSON.stringify({
        id: account.id,
        v: account.session_version,
        e: policy === "resident" ? null : Date.now() + seconds * 1000,
        persistentResident: policy === "resident",
      }),
    ),
  );
  return (
    "account_session=" +
    payload +
    "." +
    (await sign(env, payload)) +
    "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=" +
    seconds
  );
}
export async function accountSession(request, env) {
  const raw = (request.headers.get("Cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("account_session="))
    ?.slice(16);
  if (!raw || raw.length > 2048) return null;
  const [payload, sig, extra] = raw.split(".");
  if (!payload || !sig || extra) return null;
  const expected = await sign(env, payload);
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++)
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff) return null;
  let data;
  try {
    data = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(
          atob(payload.replaceAll("-", "+").replaceAll("_", "/")),
          (c) => c.charCodeAt(0),
        ),
      ),
    );
  } catch {
    return null;
  }
  const persistent = data.persistentResident === true && data.e === null;
  if (!persistent && (!Number.isFinite(data.e) || data.e <= Date.now()))
    return null;
  const a = await env.DB.prepare("SELECT * FROM accounts WHERE id=?")
    .bind(data.id)
    .first();
  if (!a || a.session_version !== data.v) return null;
  // A resident's non-expiring session must never acquire elevated privileges.
  if (persistent && (await sessionPolicy(env, a.id)) !== "resident")
    return null;
  return a;
}
export async function accountUser(request, env, tenantId, platform = false) {
  const a = await accountSession(request, env);
  if (!a) return null;
  const row = platform
    ? await env.DB.prepare(
        "SELECT p.* FROM platform_admins p JOIN account_platform a ON a.admin_id=p.id WHERE a.account_id=?",
      )
        .bind(a.id)
        .first()
    : await env.DB.prepare(
        "SELECT u.* FROM users u JOIN account_memberships a ON a.user_id=u.id AND a.tenant_id=u.tenant_id JOIN tenants t ON t.id=u.tenant_id WHERE a.account_id=? AND a.tenant_id=? AND t.status='active'",
      )
        .bind(a.id, tenantId)
        .first();
  return row ? { ...row, secret: a.secret, account_id: a.id } : null;
}
