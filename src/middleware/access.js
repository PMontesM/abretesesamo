import { accountSession } from "../lib/account-session.js";
import * as db from "../lib/db.js";
import { accountUser } from "../lib/account-session.js";
import { InputError, jsonBody } from "../lib/security.js";
import { takeAttempt } from "../lib/ratelimit.js";
import { protectCodes } from "../lib/code-privacy.js";

export async function loadTenant(c, next) {
  const tenant = await db.tenantBySlug(c.env, c.req.param("slug"));
  if (!tenant) return c.text("No encontrado", 404);
  if (tenant.status !== "active")
    throw new InputError("Edificio suspendido temporalmente", 403);
  c.set("tenant", tenant);
  await next();
}

export async function buildingSession(c, next) {
  const tenant = c.get("tenant");
  const user = await accountUser(c.req.raw, c.env, tenant.id);
  if (!user) {
    if (c.req.method === "GET" && /^\/t\/[^/]+\/admin\/?$/.test(c.req.path))
      return c.redirect(new URL("/t/" + tenant.slug, c.req.url).href, 302);
    throw new InputError("Tu sesión terminó. Vuelve a iniciar sesión.", 401);
  }
  c.set("user", user);
  await next();
}

export function requireMaster(message) {
  return async (c, next) => {
    if (c.get("user").role !== "master") throw new InputError(message, 403);
    await next();
  };
}

export async function platformSession(c, next) {
  const admin = await accountUser(c.req.raw, c.env, null, true);
  if (!admin)
    throw new InputError("Tu sesión terminó. Vuelve a iniciar sesión.", 401);
  c.set("admin", admin);
  await next();
}

export async function parseBody(c, next) {
  c.set("body", await jsonBody(c.req.raw));
  await next();
}

export async function platformTenant(c, next) {
  const tenantId =
    c.req.method === "GET" ? c.req.query("tenantId") : c.get("body").tenantId;
  if (!tenantId || !(await db.tenantById(c.env, tenantId)))
    throw new InputError("Edificio inexistente");
  c.set("tenantId", tenantId);
  await next();
}

// All platform API payloads use the same code-privacy policy, including audit details.
export async function platformJSON(c, body) {
  return c.json({
    ok: true,
    ...(await protectCodes(
      c.env,
      body,
      c.get("admin"),
      c.get("tenantId") || c.req.query("tenantId"),
    )),
  });
}

export async function visitorInput(c, next) {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  if (!(await takeAttempt(c.env, `visitor:${c.get("tenant").id}:${ip}`, 30)))
    throw new InputError("Demasiadas solicitudes. Espera cinco minutos.", 429);
  const body = await jsonBody(c.req.raw);
  if (!/^\d{6}$/.test(body.code || ""))
    throw new InputError("El código debe tener seis dígitos");
  c.set("body", body);
  await next();
}

export async function requireAccount(c, next) {
  const account = await accountSession(c.req.raw, c.env);
  if (!account) throw new InputError("Inicia sesión de nuevo.", 401);
  c.set("account", account);
  await next();
}
