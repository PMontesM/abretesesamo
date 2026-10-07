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
      .fill(
        { admin: "+12025550100", pablo: "+12025550101", super: "+12025550102" }[
          username
        ],
      );
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

  async function visible(id) {
    await page.locator('[data-panel-page="' + id + '"]:visible').waitFor();
    assert.equal(await page.locator("[data-panel-page]:visible").count(), 1);
    assert.equal(
      await page.locator("#main-scroll").evaluate((e) => e.scrollTop),
      0,
    );
  }

  async function auditSidebar(role) {
    for (const [width, height] of [
      [320, 480],
      [390, 664],
      [844, 390],
      [1440, 900],
    ]) {
      await page.setViewportSize({ width, height });
      if (width < 768)
        await page
          .getByRole("button", {
            name: role === "pablo" ? "Más" : "Abrir menú",
            exact: true,
          })
          .click();
      const sidebar = page.locator("aside.app-sidebar");
      const exit = sidebar.getByRole("button", {
        name: "Cerrar sesión",
        exact: true,
      });
      await exit.click({ trial: true });
      const box = await exit.boundingBox();
      assert.ok(
        box && box.y >= 0 && box.y + box.height <= height,
        role + " logout fits viewport",
      );
      const controls = sidebar.locator(
        "a:visible,button:visible,select:visible",
      );
      for (let i = 0; i < (await controls.count()); i++)
        await controls.nth(i).click({ trial: true });
      if (width === 390)
        await page.screenshot({
          path: resolve(output, "sidebar-" + role + "-mobile.png"),
        });
      if (width < 768) await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 390, height: 664 });
    await page
      .getByRole("button", {
        name: role === "pablo" ? "Más" : "Abrir menú",
        exact: true,
      })
      .click();
    await page
      .locator("aside")
      .getByRole("button", { name: "Cerrar sesión", exact: true })
      .click();
    await page.waitForURL("**/login");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(role);
  }
  await login("pablo");
  await auditSidebar("pablo");
  await visible("accesos");
  await page.getByRole("link", { name: "Mi perfil", exact: true }).click();
  await visible("profile");
  await page
    .getByRole("button", { name: "Instalar en mi celular", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Entendido" })
    .click();

  await page.getByText("+12025550101", { exact: true }).waitFor();
  assert.ok(page.url().includes("/t/aurora/admin"));
  await page.getByLabel("Nuevo teléfono", { exact: true }).fill("+12025550109");
  await page
    .getByLabel("Contraseña para cambiar teléfono", { exact: true })
    .fill("password-test");
  await page
    .getByRole("button", { name: "Guardar teléfono", exact: true })
    .click();
  await page
    .getByRole("link", {
      name: "Iniciar sesión con el nuevo teléfono",
      exact: true,
    })
    .click();
  await page.getByLabel("Teléfono", { exact: true }).fill("+12025550109");
  await page.getByLabel("Contraseña", { exact: true }).fill("password-test");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("**/admin");
  await visible("accesos");

  await page
    .getByRole("link", { name: "Códigos activos", exact: true })
    .click();
  await visible("pases");
  assert.ok(page.url().includes("section=pases"));

  await page
    .getByRole("link", { name: "Historial", exact: true })
    .first()
    .click();
  await visible("actividad");
  await page.goBack();
  await visible("pases");
  await page.goForward();
  await visible("actividad");
  await page.reload();
  await visible("actividad");

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation", { name: "Navegación rápida" })
    .getByRole("link", { name: "Accesos", exact: true })
    .click();
  await visible("accesos");
  await page
    .getByRole("navigation", { name: "Navegación rápida" })
    .getByRole("link", { name: "Pases", exact: true })
    .click();
  await visible("pases");
  await shot("classic-resident-mobile");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await login("admin");
  await auditSidebar("admin");
  await visible("inicio");
  await page.getByRole("link", { name: "Mi perfil", exact: true }).click();
  await visible("profile");
  await page
    .locator("[data-panel-page=profile]")
    .getByText("+12025550100", { exact: true })
    .waitFor();
  await page.goBack();
  await visible("inicio");

  for (const [label, id] of [
    ["Portones", "accesos"],
    ["Residentes", "residentes"],
    ["Códigos", "pases"],
    ["Historial", "actividad"],
    ["Inicio", "inicio"],
  ]) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await visible(id);
  }

  await page.goto("https://app.test/t/aurora/admin?view=users");
  await visible("residentes");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
  await page.getByRole("link", { name: "Códigos", exact: true }).click();
  await visible("pases");
  await shot("classic-admin-mobile");

  await context.clearCookies();
  await page.goto("https://app.test/login");
  await page.getByLabel("Teléfono", { exact: true }).fill("+12025550102");
  await page.getByLabel("Contraseña", { exact: true }).fill("password-test");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("**/platform/admin");
  await visible("resumen");
  await auditSidebar("super");
  await page.setViewportSize({ width: 1440, height: 1000 });

  for (const id of [
    "edificios",
    "flota",
    "auditoria",
    "administradores",
    "resumen",
  ]) {
    await page.locator('aside a[href="?section=' + id + '"]').click();
    await visible(id);
  }

  await page.locator('a[href="?section=pendientes"]').click();
  await visible("pendientes");
  await page.goBack();
  await visible("resumen");
  await page.goto("https://app.test/platform/admin?section=flota");
  await visible("flota");
  await shot("classic-super");

  await page.getByRole("link", { name: "Mi perfil", exact: true }).click();
  await visible("profile");
  await page.getByText("+12025550102", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await shot("profile-mobile");
  await page
    .getByLabel("Contraseña actual", { exact: true })
    .fill("password-test");
  await page
    .getByLabel("Nueva contraseña", { exact: true })
    .fill("password-next");
  await page
    .getByLabel("Repetir nueva contraseña", { exact: true })
    .fill("password-next");
  await page
    .getByRole("button", { name: "Guardar contraseña", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Volver a iniciar sesión", exact: true })
    .waitFor();
  assert.equal(commands.length, 0);
  assert.deepEqual(errors, []);
  console.log(
    "OK: tres paneles, una vista visible, menús, móvil, recarga, enlaces directos y Atrás/Adelante; ninguna apertura.",
  );
} finally {
  await browser.close();
  sqlite.close();
}
