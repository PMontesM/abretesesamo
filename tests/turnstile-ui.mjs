import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { makeDB } from "./db.mjs";
import * as db from "../src/lib/db.js";
import { hashSecret } from "../src/lib/security.js";
import worker from "../src/index.js";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PATH || "playwright",
);
const { sqlite, db: DB } = makeDB();
const env = {
  DB,
  ADMIN_SIGNING_SECRET: "test-only-signing-key-at-least-32-characters",
  TURNSTILE_REQUIRED: "true",
  TURNSTILE_SITE_KEY: "test-site",
  TURNSTILE_SECRET_KEY: "test-secret",
  PUBLIC_HOSTNAME: "app.test",
};
const tenant = await db.createTenant(env, {
  slug: "aurora",
  name: "Aurora",
  gateName: "Principal",
  triggerUrl: "https://device.test/main",
  masterUsername: "admin",
  masterSecret: "password-test",
});
const user = sqlite.prepare("SELECT * FROM users").get(),
  gate = sqlite.prepare("SELECT * FROM gates").get();
const pass = await db.createCode(env, user, {
  gateId: gate.id,
  label: "Prueba",
  days: 1,
  singleUse: false,
});
sqlite
  .prepare(
    "INSERT INTO platform_admins(id,username,secret,created_at) VALUES(?,?,?,?)",
  )
  .run("platform", "platform", await hashSecret("password-test"), 1);
let mode = "success",
  checks = 0,
  commands = 0,
  posts = 0;
const tokens = new Set();
globalThis.fetch = async (url, options) => {
  if (String(url).includes("/siteverify")) {
    checks++;
    const { response } = JSON.parse(options.body);
    const success = !tokens.has(response);
    tokens.add(response);
    return Response.json({
      success,
      hostname: "app.test",
      action: response.split(":")[0],
    });
  }
  commands++;
  return new Response("ok");
};
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH
    ? { executablePath: process.env.BROWSER_PATH }
    : {}),
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 850 },
  });
  await context.route("https://challenges.cloudflare.com/**", async (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.turnstile={render(host,options){setTimeout(()=>${mode === "failure" ? "options['error-callback']('test')" : "options.callback(options.action+':'+crypto.randomUUID())"},20);return 'widget';},remove(){}};`,
    }),
  );
  await context.route("https://app.test/**", async (route) => {
    const r = route.request(),
      url = new URL(r.url());
    if (url.pathname.startsWith("/assets/"))
      return route.fulfill({
        contentType: url.pathname.endsWith(".css")
          ? "text/css"
          : url.pathname.endsWith(".js")
            ? "text/javascript"
            : "font/woff2",
        body: readFileSync(
          new URL("../frontend/dist" + url.pathname, import.meta.url),
        ),
      });
    if (r.method() === "POST") posts++;
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
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("https://app.test/t/aurora?access=resident");
  await page.getByLabel("Usuario", { exact: true }).fill("admin");
  await page.getByLabel("Contraseña", { exact: true }).fill("password-test");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("**/admin");
  assert.equal(checks, 1);
  assert.equal(commands, 0);
  await page.goto("https://app.test/platform");
  await page.getByLabel("Usuario", { exact: true }).fill("platform");
  await page.getByLabel("Contraseña", { exact: true }).fill("password-test");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("**/platform/admin");
  assert.equal(checks, 2);
  await page.goto("https://app.test/t/aurora?code=" + pass.code);
  await page.locator(".visitor-gates input").waitFor();
  assert.equal(commands, 0);
  await page.locator("button.visitor-open").click();
  await page.locator('button.visitor-open[data-state="confirmed"]').waitFor();
  assert.equal(commands, 1);
  assert.equal(checks, 4);
  assert.equal(tokens.size, 4);
  assert.equal(await page.locator(".security-check").count(), 0);
  const before = posts;
  mode = "failure";
  await page.goto("https://app.test/t/aurora?access=resident");
  await page.getByLabel("Usuario", { exact: true }).fill("admin");
  await page.getByLabel("Contraseña", { exact: true }).fill("password-test");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page
    .getByText("No pudimos verificar la conexión. Intenta de nuevo.", {
      exact: true,
    })
    .waitFor();
  assert.equal(posts, before);
  assert.equal(commands, 1);
  assert.equal(
    await page.getByRole("button", { name: "Entrar", exact: true }).isEnabled(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Turnstile UI: login residente/plataforma, enlace visitante, tokens distintos y fallo sin envío verificados con simulación.",
  );
} finally {
  await browser.close();
  sqlite.close();
}
