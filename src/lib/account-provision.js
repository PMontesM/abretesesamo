import { InputError } from "./security.js";
export function normalizePhone(value) {
  let n = String(value || "")
    .trim()
    .replace(/[\s().-]/g, "");
  if (/^\d{10}$/.test(n)) n = "+52" + n;
  if (!/^\+[1-9]\d{7,14}$/.test(n))
    throw new InputError(
      "Escribe un teléfono válido con código de país, por ejemplo +52 55 1234 5678",
    );
  return n;
}
export function provisionPhoneStatements(env, phone, secret, userId, tenantId) {
  phone = normalizePhone(phone);
  return [
    env.DB.prepare(
      "INSERT INTO accounts(id,phone,secret,created_at) VALUES(?,?,?,?) ON CONFLICT(phone) DO NOTHING",
    ).bind(crypto.randomUUID(), phone, secret, Date.now()),
    env.DB.prepare(
      "INSERT INTO account_memberships(account_id,user_id,tenant_id) SELECT id,?,? FROM accounts WHERE phone=?",
    ).bind(userId, tenantId, phone),
  ];
}
