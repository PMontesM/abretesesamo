import assert from "node:assert/strict";

import { createRequire } from "node:module";

import { mkdirSync, readFileSync } from "node:fs";

import { resolve } from "node:path";

import { pathToFileURL } from "node:url";

import { makeDB } from "./db.mjs";

import * as db from "../src/lib/db.js";

import { createPass } from "../src/lib/passes.js";

import { hashSecret } from "../src/lib/security.js";

const { default: worker } = await import(
  process.env.WORKER_BUNDLE
    ? pathToFileURL(resolve(process.env.WORKER_BUNDLE)).href
    : new URL("../src/index.js", import.meta.url).href
);

const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PATH || "playwright",
);

const { sqlite, db: DB } = makeDB(),
  env = {
    DB,
    ADMIN_SIGNING_SECRET: "test-only-signing-key-with-at-least-32-chars",
  };

const tenantId = await db.createTenant(env, {
  slug: "aurora",
  name: "Residencial Aurora",
  gateName: "Portón principal",
  triggerUrl: "https://device.test/main",
  masterUsername: "admin",
  masterSecret: "password-test",
});

const gate = sqlite.prepare("SELECT * FROM gates").get();

const parking = await db.saveGate(env, tenantId, {
  name: "Estacionamiento",
  triggerUrl: "https://device.test/parking",
});

await db.createUser(env, tenantId, {
  username: "pablo",
  secret: "password-test",
  gateIds: [gate.id, parking],
});

const user = sqlite.prepare("SELECT * FROM users WHERE username='pablo'").get();

await db.createCode(env, user, {
  gateId: gate.id,
  label: "Visita de María",
  expiresAt: Date.now() + 2 * 3600000,
  singleUse: false,
  visit: true,
});

await db.createCode(env, user, {
  gateId: parking,
  label: "Entrega de supermercado",
  expiresAt: Date.now() + 30 * 60000,
  singleUse: false,
});

const secret = await hashSecret("password-test");
sqlite
  .prepare(
    "INSERT INTO platform_admins(id,username,secret,created_at) VALUES(?,?,?,?)",
  )
  .run("platform", "platform", secret, 1);

for (let i = 0; i < 30; i++)
  sqlite
    .prepare(
      "INSERT INTO logs(id,tenant_id,gate_id,gate_name,owner_id,owner,label,outcome,at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      crypto.randomUUID(),
      tenantId,
      gate.id,
      gate.name,
      user.id,
      user.username,
      i === 0 ? '=HYPERLINK("test")' : "Visita",
      i % 7 === 0 ? "not_sent" : "sent",
      Date.now() - i * 2300000,
    );

let commands = [];
globalThis.fetch = async (url) => {
  commands.push(String(url));
  return new Response("ok");
};

for (const u of sqlite.prepare("SELECT * FROM users").all()) {
  const phone = { admin: "+12025550100", pablo: "+12025550101" }[u.username],
    id = crypto.randomUUID();
  sqlite
    .prepare("INSERT INTO accounts(id,phone,secret,created_at) VALUES(?,?,?,?)")
    .run(id, phone, u.secret, Date.now());
  sqlite
    .prepare("INSERT INTO account_memberships VALUES(?,?,?)")
    .run(id, u.id, u.tenant_id);
}

sqlite
  .prepare("INSERT INTO accounts(id,phone,secret,created_at) VALUES(?,?,?,?)")
  .run("platform-account", "+12025550102", secret, Date.now());
sqlite
  .prepare("INSERT INTO account_platform VALUES(?,?)")
  .run("platform-account", "platform");

env.MQTT_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH
    ? { executablePath: process.env.BROWSER_PATH }
    : {}),
});

const output = resolve("work/portonsmart-preview");
mkdirSync(output, { recursive: true });

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });

  await context.route("https://app.test/**", async (route) => {
    const r = route.request(),
      url = new URL(r.url());
    if (url.pathname.startsWith("/assets/")) {
      await route.fulfill({
        status: 200,
        contentType: url.pathname.endsWith(".css")
          ? "text/css"
          : url.pathname.endsWith(".js")
            ? "text/javascript"
            : "font/woff2",
        body: readFileSync(
          new URL("../frontend/dist" + url.pathname, import.meta.url),
        ),
      });
      return;
    }
    const res = await worker.fetch(
      new Request(r.url(), {
        method: r.method(),
        headers: r.headers(),
        ...(r.postData() ? { body: r.postData() } : {}),
      }),
      env,
      {},
    );
    await route.fulfill({
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body: await res.text(),
    });
  });

  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("ERROR", e.message);
  });

  const wait = () =>
    page.waitForFunction(
      () => window.Alpine && !window.Alpine.$data(document.body).loading,
    );

  async function login(phone) {
    await context.clearCookies();
    await page.goto("https://app.test/login");
    await page.getByLabel("Teléfono", { exact: true }).fill(phone);
    await page.getByLabel("Contraseña", { exact: true }).fill("password-test");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL("**/admin");
    await wait();
  }

  async function menu(name) {
    await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
    await page.getByRole("link", { name, exact: true }).click();
  }

  await login("+12025550102");
  await menu("Configuración");
  await page
    .getByRole("heading", { name: "Inventario de relés", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Registrar relé", exact: true })
    .click();
  await page.getByLabel("Nombre del relé", { exact: true }).fill("Relé prueba");
  await page
    .getByLabel("Identificador del relé", { exact: true })
    .fill("test-device");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Guardar", exact: true })
    .click();
  await page.getByText("Relé prueba", { exact: true }).waitFor();

  await page
    .getByRole("button", { name: "Editar conexión MQTT", exact: true })
    .click();
  await page.getByLabel("Usuario de envío", { exact: true }).fill("command");
  await page
    .getByLabel("Contraseña de envío", { exact: true })
    .fill("command-secret");
  await page.getByLabel("Usuario de consulta", { exact: true }).fill("status");
  await page
    .getByLabel("Contraseña de consulta", { exact: true })
    .fill("status-secret");
  await page
    .getByLabel("Tu contraseña de plataforma para confirmar", { exact: true })
    .fill("password-test");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Guardar", exact: true })
    .click();
  await page
    .getByText("Cuentas centrales guardadas.", { exact: true })
    .waitFor();

  await menu("Reportes");
  await page
    .getByRole("heading", { name: "Uso por edificio", exact: true })
    .waitFor();
  await menu("Edificios");
  await page
    .getByRole("button", { name: "Nuevo edificio", exact: false })
    .click();
  await page.getByLabel("Nombre", { exact: true }).fill("Edificio Nuevo");
  await page.getByLabel("Nombre del primer portón").fill("Puerta Nueva");
  await page.getByLabel("Cómo se controla").selectOption("demo");
  await page.getByLabel("Nombre del administrador").fill("nuevo");
  await page.getByLabel("Teléfono del administrador").fill("+12025550103");
  await page.getByLabel("Contraseña del administrador").fill("password-test");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Guardar", exact: true })
    .click();
  await page.getByLabel("Buscar edificio").fill("Edificio Nuevo");
  assert.ok(
    await page
      .getByRole("button", { name: "Administrar edificio", exact: true })
      .evaluate((e) => {
        const r = e.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.height >= 44;
      }),
  );
  await page.screenshot({
    path: resolve(output, "buildings-phone-mobile.png"),
  });
  await page
    .getByRole("button", { name: "Administrar edificio", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Portones registrados", exact: true })
    .waitFor();

  await page
    .getByRole("button", { name: "Agregar portón", exact: true })
    .click();
  await page.getByLabel("Nombre", { exact: true }).fill("Puerta Dos");
  await page.getByLabel("Cómo se controla").selectOption("demo");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Guardar", exact: true })
    .click();
  await page.getByText("Puerta Dos", { exact: true }).waitFor();
  await page
    .getByRole("navigation", { name: "Secciones del edificio" })
    .getByRole("button", { name: "Usuarios", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Agregar usuario", exact: true })
    .click();
  await page.getByLabel("Nombre del usuario").fill("vecino");
  await page
    .getByLabel("Teléfono (con código de país)", { exact: true })
    .fill("+12025550104");
  await page
    .getByLabel("Contraseña (mínimo 8 caracteres)")
    .fill("password-test");
  await page
    .getByRole("dialog")
    .getByLabel("Puerta Nueva", { exact: true })
    .check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Guardar", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Compartir acceso", exact: true })
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  assert.ok(
    sqlite.prepare("SELECT id FROM accounts WHERE phone='+12025550104'").get(),
  );

  await page
    .getByRole("navigation", { name: "Secciones del edificio" })
    .getByRole("button", { name: "Revisiones", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Órdenes del panel pendientes de revisión",
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("navigation", { name: "Secciones del edificio" })
    .getByRole("button", { name: "Códigos", exact: true })
    .click();
  await page.getByRole("button", { name: "Buscar", exact: true }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: resolve(output, "unified-super-mobile.png") });

  await page
    .getByRole("navigation", { name: "Secciones del edificio" })
    .getByRole("button", { name: "Usuarios", exact: true })
    .click();
  const recoveryCard = page
    .locator(".user-row")
    .filter({ has: page.getByText("vecino", { exact: true }) });
  await recoveryCard.waitFor();
  await page.getByLabel("Buscar usuario", { exact: true }).fill("vecino");
  assert.equal(await page.locator(".user-row:visible").count(), 1);
  await page.getByLabel("Buscar usuario", { exact: true }).fill("");
  await page.screenshot({
    path: resolve(output, "shared-super-users-mobile.png"),
  });
  await recoveryCard.locator("summary").click();
  await recoveryCard
    .getByRole("button", { name: "Recuperar acceso", exact: true })
    .click();
  await page
    .getByLabel("Tu contraseña de plataforma", { exact: true })
    .fill("password-test");
  await page
    .getByRole("dialog", { name: "Recuperar acceso de vecino", exact: true })
    .getByRole("button", { name: "Guardar", exact: true })
    .click();
  const recoveryDialog = page.getByRole("dialog", {
    name: "Enlace de recuperación",
    exact: true,
  });
  await recoveryDialog.waitFor();
  const recoveryURL = await recoveryDialog.locator("p").textContent();
  await recoveryDialog
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();

  const recoveryPage = await context.newPage();
  await recoveryPage.goto(recoveryURL);
  await recoveryPage
    .getByLabel("Nueva contraseña", { exact: true })
    .fill("password-test");
  await recoveryPage
    .getByLabel("Repetir nueva contraseña", { exact: true })
    .fill("password-test");
  await recoveryPage
    .getByRole("button", { name: "Guardar contraseña", exact: true })
    .click();
  await recoveryPage
    .getByText("Contraseña actualizada.", { exact: true })
    .waitFor();
  assert.equal(new URL(recoveryPage.url()).hash, "");
  await recoveryPage.close();

  await login("+12025550103");
  await menu("Residentes");
  await page
    .getByRole("button", { name: "Agregar residente", exact: true })
    .click();
  await page.getByLabel("Usuario", { exact: true }).fill("vecino2");
  await page
    .getByLabel("Teléfono (con código de país)", { exact: true })
    .fill("+12025550105");
  await page
    .getByLabel("Contraseña (mínimo 8 caracteres)")
    .fill("password-test");
  await page
    .getByRole("dialog")
    .getByLabel("Puerta Dos", { exact: true })
    .check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Guardar", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Compartir acceso", exact: true })
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();

  await login("+12025550104");
  await page
    .getByRole("navigation", { name: "Navegación rápida" })
    .getByRole("link", { name: "Pases", exact: true })
    .click();
  await page.getByRole("button", { name: "Nuevo código", exact: true }).click();
  await page.getByLabel("Nombre o referencia").fill("Invitado");
  await page
    .getByRole("dialog", { name: "Nuevo código", exact: true })
    .getByRole("button", { name: "Crear código", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Código creado", exact: true })
    .waitFor();
  const code = sqlite
    .prepare("SELECT code FROM codes WHERE label='Invitado'")
    .get().code;
  await context.clearCookies();
  await page.goto("https://app.test/visit");
  await page.getByLabel("Código de seis dígitos").fill(code.slice(0, 3) + " " + code.slice(3));
  assert.equal(await page.getByLabel("Código de seis dígitos").inputValue(), code);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.waitForURL("**/t/edificio-nuevo");
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole("group", { name: "Elige el portón" }).count(), 0);
  await page.getByLabel("Código de seis dígitos").fill(code.slice(0, 3) + "\u00a0" + code.slice(3));
  assert.equal(await page.getByLabel("Código de seis dígitos").inputValue(), code);
  await page
    .getByRole("button", { name: "Enviar orden de apertura", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Estoy frente al portón, abrir", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Orden confirmada", exact: true })
    .waitFor();
  assert.equal(commands.length, 0);
  assert.deepEqual(errors, []);
  console.log(
    "OK interfaz unificada: teléfono, MQTT, inventario, edificios, portones, usuarios, revisiones, códigos y visitante móvil.",
  );
} finally {
  await browser.close();
  sqlite.close();
}
