import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makeDB } from "./db.mjs";
import * as db from "../src/lib/db.js";
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
    ADMIN_SIGNING_SECRET: "account-ui-testing-secret-more-than-32-characters",
  };
for (const slug of ["alpha", "beta"])
  await db.createTenant(env, {
    slug,
    name: slug === "alpha" ? "Edificio Alpha" : "Edificio Beta",
    gateName: slug === "alpha" ? "Portón Alpha" : "Portón Beta",
    triggerType: "demo",
    masterUsername: "admin",
    masterPhone: slug === "alpha" ? "+12025550107" : "+12025550108",
    masterSecret: "global-password",
  });
const t = sqlite.prepare("SELECT id FROM tenants WHERE slug='beta'").get();
const g = sqlite.prepare("SELECT id FROM gates WHERE tenant_id=?").get(t.id);
await db.createUser(env, t.id, {
  username: "resident",
  phone: "+12025550107",
  secret: "unused-password",
  gateIds: [g.id],
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH
    ? { executablePath: process.env.BROWSER_PATH }
    : {}),
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.route("https://app.test/**", async (route) => {
    const r = route.request(),
      url = new URL(r.url());
    if (url.pathname.startsWith("/assets/")) {
      const file = new URL("../frontend/dist" + url.pathname, import.meta.url);
      await route.fulfill({
        status: 200,
        contentType: String(file).endsWith(".css")
          ? "text/css"
          : String(file).endsWith(".js")
            ? "text/javascript"
            : "font/woff2",
        body: readFileSync(file),
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
      { waitUntil: (p) => p },
    );
    await route.fulfill({
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body: await res.text(),
    });
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("https://app.test/login");
  await page.waitForURL("**/login");
  await page
    .getByRole("button", { name: "Tengo un código de visita", exact: true })
    .click();
  await page.waitForURL("**/visit");
  const owner = sqlite
    .prepare(
      "SELECT u.* FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE t.slug='alpha'",
    )
    .get();
  const gate = sqlite
    .prepare("SELECT id FROM gates WHERE tenant_id=?")
    .get(owner.tenant_id);
  const pass = await db.createCode(env, owner, {
    gateId: gate.id,
    label: "Visita UI",
    days: 1,
    singleUse: false,
  });
  await page.getByLabel("Código de seis dígitos").fill(pass.code);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.waitForURL("**/t/alpha");
  assert.equal(
    await page.getByLabel("Código de seis dígitos").inputValue(),
    pass.code,
  );
  await page
    .getByRole("button", { name: "Enviar orden de apertura", exact: true })
    .waitFor();
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM logs").get().n, 0);
  await page.goto("https://app.test/login");
  await page.getByLabel("Teléfono", { exact: true }).fill("+12025550107");
  await page.getByLabel("Contraseña", { exact: true }).fill("global-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("**/t/alpha/admin");
  await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
  await page.getByLabel("Edificio que controlas").selectOption("/t/beta/admin");
  await page.waitForURL("**/t/beta/admin");
  await page.getByRole("button", { name: "Más", exact: true }).click();
  const picker = page.getByLabel("Edificio que controlas");
  await picker.waitFor();
  assert.equal(await picker.locator("option").count(), 2);
  assert.ok((await picker.inputValue()) === "/t/beta/admin");
  await page.waitForFunction(
    () => document.querySelector("aside").getBoundingClientRect().left >= -1,
  );
  mkdirSync("work/accounts-preview", { recursive: true });
  await page.screenshot({
    path: "work/accounts-preview/building-picker-mobile.png",
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await picker.selectOption("/t/alpha/admin");
  await page.waitForURL("**/t/alpha/admin");
  await page
    .getByRole("heading", { name: "Panel de administración" })
    .waitFor();
  await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await page.waitForURL("**/login");
  await page.getByLabel("Teléfono", { exact: true }).fill("+12025550107");
  await page.getByLabel("Contraseña", { exact: true }).fill("global-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("**/t/alpha/admin");
  assert.deepEqual(errors, []);
  console.log(
    "OK: login único, altas por teléfono, dos edificios, roles distintos, selector móvil y cierre de sesión.",
  );
} finally {
  await browser.close();
  sqlite.close();
}
