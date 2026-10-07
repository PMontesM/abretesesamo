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
  masterPhone: "+12025550100",
  masterSecret: "password-test",
});
const gate = sqlite.prepare("SELECT * FROM gates").get();
const parking = await db.saveGate(env, tenantId, {
  name: "Estacionamiento",
  triggerUrl: "https://device.test/parking",
});
await db.createUser(env, tenantId, {
  username: "pablo",
  phone: "+12025550101",
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
sqlite
  .prepare("INSERT INTO accounts(id,phone,secret,created_at) VALUES(?,?,?,?)")
  .run("super-account", "+12025550102", secret, 1);
sqlite
  .prepare("INSERT INTO account_platform(account_id,admin_id) VALUES(?,?)")
  .run("super-account", "platform");
let commands = [];
globalThis.fetch = async (url) => {
  commands.push(String(url));
  return new Response("ok");
};
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
    viewport: { width: 1440, height: 1000 },
  });
  await context.route("https://app.test/**", async (route) => {
    const r = route.request(),
      url = new URL(r.url());
    if (url.pathname.startsWith("/assets/")) {
      const file = new URL("../frontend/dist" + url.pathname, import.meta.url);
      const type = String(file).endsWith(".css")
        ? "text/css"
        : String(file).endsWith(".js")
          ? "text/javascript"
          : String(file).endsWith(".woff2")
            ? "font/woff2"
            : "application/octet-stream";
      await route.fulfill({
        status: 200,
        contentType: type,
        body: readFileSync(file),
      });
      return;
    }
    const response = await worker.fetch(
      new Request(r.url(), {
        method: r.method(),
        headers: r.headers(),
        ...(r.postData() ? { body: r.postData() } : {}),
      }),
      env,
      { waitUntil: (p) => p },
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("PAGE ERROR", e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.log("CONSOLE", m.text());
  });
  page.on("dialog", (d) => d.accept());
  async function login(username) {
    await context.clearCookies();
    await page.goto("https://app.test/login");
    await page
      .getByLabel("Teléfono", { exact: true })
      .fill({ admin: "+12025550100", pablo: "+12025550101" }[username]);
    await page.getByLabel("Contraseña", { exact: true }).fill("password-test");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL("**/admin");
    await page.waitForFunction(
      () => window.Alpine && !window.Alpine.$data(document.body).loading,
    );
  }
  const shot = async (name) =>
    page.screenshot({
      path: resolve(output, name + ".png"),
      animations: "disabled",
    });
  const entryCode = sqlite.prepare("SELECT code FROM codes LIMIT 1").get().code;
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const suffix of ["", "?code=" + entryCode]) {
      await page.goto("https://app.test/t/aurora" + suffix);
      await page
        .getByRole("button", { name: "Entrar con mi usuario", exact: true })
        .click();
      await page.getByLabel("Teléfono", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Tengo un código de visita", exact: true })
        .click();
      await page.getByLabel("Código de seis dígitos").waitFor();
      assert.equal(commands.length, 0);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login("admin");
  assert.equal(commands.length, 0);
  await shot("alpine-admin");
  assert.equal(await page.locator("#accesos article").count(), 2);
  await page.getByRole("link", { name: "Códigos", exact: true }).click();
  const privateCode = sqlite
    .prepare("SELECT code FROM codes WHERE label='Visita de María'")
    .get().code;
  const hiddenPass = page
    .locator("#pases article")
    .filter({ hasText: "Visita de María" });
  await hiddenPass.waitFor();
  assert.ok(
    (await hiddenPass.textContent()).includes(
      privateCode.slice(0, 2) + "••" + privateCode.slice(-2),
    ),
  );
  assert.equal(
    await hiddenPass
      .getByRole("button", { name: "Copiar código", exact: true })
      .isVisible(),
    false,
  );
  assert.equal(
    await hiddenPass
      .getByRole("button", { name: "Compartir pase", exact: true })
      .isVisible(),
    false,
  );

  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page.getByLabel("Teléfono de WhatsApp").fill("525512345678");
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await page.getByText("Contacto de ayuda guardado", { exact: true }).waitFor();
  assert.equal(
    sqlite.prepare("SELECT support_phone FROM tenants").get().support_phone,
    "525512345678",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  await page.getByRole("link", { name: "Residentes", exact: true }).click();
  await page
    .getByRole("heading", { name: "Residentes del edificio" })
    .waitFor();
  await page
    .getByRole("button", { name: "Agregar residente", exact: true })
    .click();
  let modal = page.getByRole("dialog", {
    name: "Nuevo residente",
    exact: true,
  });
  await modal.getByLabel("Usuario", { exact: true }).fill("temporal");
  await modal
    .getByLabel("Teléfono (con código de país)", { exact: true })
    .fill("+12025550106");
  await modal
    .getByLabel("Contraseña (mínimo 8 caracteres)")
    .fill("test-password");
  await modal.getByLabel("Portón principal", { exact: true }).check();
  await modal.getByLabel("Estacionamiento", { exact: true }).check();
  await modal.getByRole("button", { name: "Guardar", exact: true }).click();
  await page
    .getByRole("heading", { name: "Usuario creado", exact: true })
    .waitFor();
  await page
    .getByRole("dialog", { name: "Compartir acceso", exact: true })
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  const neighbor = sqlite
    .prepare("SELECT * FROM users WHERE username='temporal'")
    .get();
  assert.ok(neighbor);
  const neighborCode = await createPass(env, neighbor, {
    label: "Prueba de permisos",
    mode: "unlimited",
    gateIds: [gate.id, parking],
  });
  const card = page.locator("#residentes article").filter({
    has: page.getByRole("heading", { name: "temporal", exact: true }),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("compact-users-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await card.locator("summary").click();
  await card
    .getByRole("button", { name: "Accesos permitidos", exact: true })
    .click();
  modal = page.getByRole("dialog", {
    name: "Accesos de temporal",
    exact: true,
  });
  await modal.getByLabel("Estacionamiento", { exact: true }).uncheck();
  await modal.getByRole("button", { name: "Guardar", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  await page.waitForFunction(() => !window.Alpine.$data(document.body).busy);
  assert.equal(
    sqlite
      .prepare("SELECT status FROM codes WHERE code=?")
      .get(neighborCode.code).status,
    "revoked",
  );
  assert.equal(
    await card
      .getByRole("button", { name: "Cambiar contraseña", exact: true })
      .count(),
    0,
  );
  await card.getByRole("button", { name: "Eliminar", exact: true }).click();
  modal = page.getByRole("dialog", { name: "Confirmar cambio", exact: true });
  await modal.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert.ok(sqlite.prepare("SELECT id FROM users WHERE id=?").get(neighbor.id));
  await card.getByRole("button", { name: "Eliminar", exact: true }).click();
  await modal.getByRole("button", { name: "Confirmar", exact: true }).click();
  await card.waitFor({ state: "detached" });
  assert.equal(
    sqlite.prepare("SELECT id FROM users WHERE id=?").get(neighbor.id),
    undefined,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("main").evaluate((e) => (e.scrollTop = 0));
  await shot("admin-unified-mobile");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
  const logout = page.getByRole("button", {
    name: "Cerrar sesión",
    exact: true,
  });
  await logout.waitFor();
  assert.ok(
    await logout.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    }),
  );
  await shot("admin-unified-menu-mobile");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login("pablo");
  await page
    .getByRole("button", { name: "Crear código de visita", exact: true })
    .click();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await shot("alpine-resident");
  assert.equal(await page.locator("#pases article").count(), 2);
  const first = page.locator("#accesos article").first(),
    hold = first.locator("button.hold");
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(650);
  assert.equal(commands.length, 0);
  await hold.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(750);
  await page.keyboard.up("Space");
  await page.waitForFunction(() =>
    window.Alpine.$data(document.body).doors.some((d) => d.state === "abierto"),
  );
  assert.equal(commands.length, 1);
  await page
    .getByRole("link", { name: "Códigos activos", exact: true })
    .click();
  await page.getByRole("button", { name: "Nuevo código", exact: true }).click();
  assert.ok(
    await page
      .getByRole("radio", { name: "Un solo uso", exact: true })
      .isChecked(),
  );
  assert.equal(
    await page.getByText("Vigencia", { exact: true }).isVisible(),
    false,
  );
  await page
    .getByRole("dialog", { name: "Nuevo código", exact: true })
    .getByText("Permanente", { exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Nuevo código", exact: true })
    .getByText("Con vigencia", { exact: true })
    .click();
  await page.getByText("Otra cantidad", { exact: true }).click();
  await page.getByLabel("Cantidad de días (1 a 30)").fill("3");
  await page.getByLabel("Nombre o referencia").fill("Entrega multipuerta");
  await page
    .getByRole("dialog")
    .getByLabel("Portón principal", { exact: true })
    .check();
  await page
    .getByRole("dialog")
    .getByLabel("Estacionamiento", { exact: true })
    .check();
  await page.getByRole("button", { name: "Crear código", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Código creado", exact: true })
    .waitFor();
  await shot("code-created");
  await page.evaluate(() => {
    window.open = (url) => {
      window.sharedPass = url;
    };
  });
  await page
    .getByRole("dialog", { name: "Código creado", exact: true })
    .getByRole("button", { name: "Compartir por WhatsApp", exact: true })
    .click();
  const shared = new URL(
    await page.evaluate(() => window.sharedPass),
  ).searchParams.get("text");
  assert.ok(
    shared.includes("https://app.test/t/aurora?code=") &&
      shared.includes("Con vigencia".toLowerCase()),
  );
  await page
    .getByRole("dialog", { name: "Código creado", exact: true })
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Entrega multipuerta", exact: true })
    .waitFor();
  const created = sqlite
    .prepare("SELECT * FROM codes WHERE label='Entrega multipuerta'")
    .get();
  assert.equal(created.visit_mode, 0);
  assert.equal(created.expires_at - created.created_at, 3 * 86400000);
  assert.equal(
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM code_gates WHERE code=?")
      .get(created.code).n,
    2,
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async (text) => {
        window.copiedAccess = text;
      },
    });
  });
  await page
    .locator("#pases article")
    .filter({ hasText: "Entrega multipuerta" })
    .locator("summary")
    .click();
  await page
    .locator("#pases article")
    .filter({
      has: page.getByRole("heading", {
        name: "Entrega multipuerta",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Copiar código" })
    .click();
  assert.equal(await page.evaluate(() => window.copiedAccess), created.code);
  await page
    .locator("#pases article")
    .filter({ hasText: "Entrega multipuerta" })
    .locator("summary")
    .click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Compact lists should fit the mobile viewport",
    );
    await shot("compact-codes-" + width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  assert.equal(
    await page
      .getByRole("link", { name: "Todos mis códigos", exact: true })
      .count(),
    0,
  );
  await page.getByRole("link", { name: "Mis accesos", exact: true }).click();
  await first
    .getByRole("button", { name: "Abrir con confirmación", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Confirmar apertura", exact: true })
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  assert.equal(commands.length, 1);
  assert.equal(
    await hold.evaluate((e) => getComputedStyle(e).userSelect),
    "none",
  );
  await page
    .getByRole("link", { name: "Historial", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Buscar en historial", { exact: true })
    .fill("imposible-no-existe");
  await page
    .locator("#actividad li")
    .filter({ hasText: "No hay registros con estos filtros." })
    .waitFor({ state: "visible" });
  await page.getByLabel("Buscar en historial", { exact: true }).fill("");
  await page
    .getByLabel("Filtrar resultado", { exact: true })
    .selectOption("not_sent");
  assert.ok(
    await page.evaluate(() =>
      window.Alpine.$data(document.body).visibleActivity.every(
        (a) => a.outcome === "not_sent",
      ),
    ),
  );
  await page.getByLabel("Filtrar resultado", { exact: true }).selectOption("");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("main").evaluate((e) => (e.scrollTop = 0));
  await shot("alpine-mobile");
  await page.getByRole("button", { name: "Más", exact: true }).click();
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .waitFor();
  assert.ok(
    await page
      .getByRole("button", { name: "Cerrar sesión", exact: true })
      .isVisible(),
  );
  await page.keyboard.press("Escape");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.goto("https://app.test/t/aurora?code=" + created.code);
  await page
    .getByRole("button", { name: "Enviar orden de apertura", exact: true })
    .click();
  await page
    .getByRole("radio", { name: "Estacionamiento", exact: true })
    .check();
  assert.equal(commands.length, 1);
  await page
    .getByRole("button", { name: "Enviar orden de apertura", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Orden confirmada", exact: true })
    .waitFor();
  assert.equal(commands.at(-1), "https://device.test/parking");
  assert.equal(commands.length, 2);
  const visit = await createPass(env, user, {
    label: "Visita multiacceso",
    mode: "visit",
    minutes: 30,
    gateIds: [gate.id, parking],
  });
  await page.goto("https://app.test/t/aurora?code=" + visit.code);
  await page
    .getByRole("button", { name: "Enviar orden de apertura", exact: true })
    .click();
  await page
    .getByRole("radio", { name: "Portón principal", exact: true })
    .check();
  assert.equal(commands.length, 2);
  await page
    .getByRole("button", { name: "Enviar orden de apertura", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Estoy frente al portón, abrir", exact: true })
    .waitFor();
  assert.equal(commands.length, 2);
  await page
    .getByRole("button", { name: "Estoy frente al portón, abrir", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Orden confirmada", exact: true })
    .waitFor();
  assert.equal(await page.locator(".opening-result").count(), 0);
  assert.equal(commands.length, 3);
  assert.equal(commands.at(-1), "https://device.test/main");
  await shot("alpine-visitor");
  sqlite
    .prepare(
      "INSERT INTO relay_devices(device_id,name,created_at,connection_state,checked_at) VALUES('test-inventory','Relé de prueba',?,'online',?)",
    )
    .run(Date.now(), Date.now() - 300000);
  await context.clearCookies();
  await page.goto("https://app.test/login");
  await page.getByLabel("Teléfono", { exact: true }).fill("+12025550102");
  await page.getByLabel("Contraseña", { exact: true }).fill("password-test");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("**/platform/admin");
  await page.waitForFunction(
    () => window.Alpine && !window.Alpine.$data(document.body).loading,
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "Super administración", exact: false })
      .count(),
    1,
  );
  assert.equal(
    await page.evaluate(() => window.Alpine.$data(document.body).devOnline),
    0,
  );
  assert.equal(
    await page.evaluate(() => window.Alpine.$data(document.body).devUnknown),
    1,
  );
  assert.equal(commands.length, 3);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await shot("alpine-super");
  await page.locator('aside a[href="?section=edificios"]').click();
  await page.getByLabel("Buscar edificio").fill("inexistente");
  await page
    .getByText("No hay edificios con estos filtros", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Quitar filtros" }).click();
  await page
    .getByRole("button", { name: "Administrar edificio", exact: true })
    .click();
  await page.getByRole("heading", { name: "Portones registrados" }).waitFor();
  await page.getByRole("link", { name: "Resumen", exact: true }).click();
  await page.waitForFunction(
    () => window.Alpine && !window.Alpine.$data(document.body).loading,
  );
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page.getByRole("button", { name: "Editar conexión MQTT" }).waitFor();
  await page.getByRole("link", { name: "Resumen", exact: true }).click();
  await page.waitForFunction(
    () => window.Alpine && !window.Alpine.$data(document.body).loading,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("alpine-super-mobile");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.equal(commands.length, 3);
  assert.deepEqual(errors, []);
  console.log(
    "OK Alpine: plantillas originales, residente, panel, permisos, pases multiacceso, confirmación de visita y apertura seleccionada.",
  );
} finally {
  await browser.close();
}
