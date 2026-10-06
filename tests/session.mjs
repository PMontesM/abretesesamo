import { accountCookie } from "../src/lib/account-session.js";
export async function createSessionCookie(env, user, platform = false) {
  const row = await env.DB.prepare(
    platform
      ? "SELECT * FROM platform_admins WHERE id=?"
      : "SELECT * FROM users WHERE id=?",
  )
    .bind(user.id)
    .first();
  if (!row) throw Error("Missing fixture identity");
  const link = await env.DB.prepare(
    platform
      ? "SELECT account_id FROM account_platform WHERE admin_id=?"
      : "SELECT account_id FROM account_memberships WHERE user_id=?",
  )
    .bind(row.id)
    .first();
  let id = link?.account_id;
  if (!id) {
    id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO accounts(id,phone,secret,created_at) VALUES(?,?,?,?)",
    )
      .bind(
        id,
        "+1" + String(1000000000 + Math.floor(Math.random() * 9000000000)),
        row.secret,
        Date.now(),
      )
      .run();
    await env.DB.prepare(
      platform
        ? "INSERT INTO account_platform(account_id,admin_id) VALUES(?,?)"
        : "INSERT INTO account_memberships(account_id,user_id,tenant_id) VALUES(?,?,?)",
    )
      .bind(...(platform ? [id, row.id] : [id, row.id, row.tenant_id]))
      .run();
  }
  const a = await env.DB.prepare("SELECT * FROM accounts WHERE id=?")
    .bind(id)
    .first();
  return accountCookie(env, a);
}
