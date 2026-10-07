import test from "node:test";
import assert from "node:assert/strict";
import { makeDB } from "./db.mjs";
import * as db from "../src/lib/db.js";
import worker from "../src/index.js";
import { hashSecret } from "../src/lib/security.js";
async function setup() {
  const { sqlite, db: DB } = makeDB(),
    env = {
      DB,
      ADMIN_SIGNING_SECRET: "account-test-only-secret-more-than-32-characters",
    };
  for (const slug of ["alpha", "beta", "foreign"])
    await db.createTenant(env, {
      slug,
      name: slug,
      gateName: "Gate",
      triggerType: "demo",
      masterUsername: "admin",
      masterPhone:
        slug === "alpha"
          ? "+12025550101"
          : { beta: "+12025550102", foreign: "+12025550103" }[slug],
      masterSecret: "global-password",
    });
  const beta = sqlite
    .prepare("SELECT id FROM tenants WHERE slug='beta'")
    .get().id;
  await db.createUser(env, beta, {
    username: "resident",
    phone: "+1 (202) 555-0101",
    secret: "unused-password",
    gateIds: [],
  });
  let cookie = "";
  const req = async (path, body, custom = cookie) =>
    worker.fetch(
      new Request("https://app.test" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Cookie: custom,
          Origin: "https://app.test",
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
      {},
    );
  return {
    sqlite,
    env,
    req,
    setCookie: (r) => (cookie = r.headers.get("Set-Cookie").split(";")[0]),
    getCookie: () => cookie,
  };
}
test("phone provision keeps existing password, multiple buildings and isolated roles", async () => {
  const s = await setup();
  try {
    assert.equal(
      (
        await s.req("/account/login", {
          phone: "+12025550101",
          secret: "unused-password",
        })
      ).status,
      403,
    );
    let r = await s.req("/account/login", {
      phone: "+12025550101",
      secret: "global-password",
    });
    assert.equal(r.status, 200);
    s.setCookie(r);
    const old = s.getCookie();
    const list = await (await s.req("/account/buildings")).json();
    assert.deepEqual(
      list.buildings.map((b) => [b.slug, b.role]),
      [
        ["alpha", "master"],
        ["beta", "user"],
      ],
    );
    assert.equal((await s.req("/t/beta/admin/users")).status, 403);
    assert.equal((await s.req("/t/foreign/admin/panel")).status, 401);
    assert.equal((await s.req("/account/link", {})).status, 404);
    r = await s.req("/account/password", {
      currentSecret: "global-password",
      secret: "new-password",
      confirmSecret: "new-password",
    });
    assert.equal(r.status, 200);
    assert.equal(
      (await s.req("/t/alpha/admin/panel", undefined, old)).status,
      401,
    );
    r = await s.req("/account/login", {
      phone: "+12025550101",
      secret: "new-password",
    });
    assert.equal(r.status, 200);
    s.setCookie(r);
    s.sqlite
      .prepare("UPDATE tenants SET status='suspended' WHERE slug='beta'")
      .run();
    assert.equal((await s.req("/t/beta/admin/panel")).status, 403);
    assert.equal(
      (await (await s.req("/account/buildings")).json()).buildings.length,
      1,
    );
    await s.req("/account/logout", {});
    assert.equal((await s.req("/t/alpha/admin/panel")).status, 401);
  } finally {
    s.sqlite.close();
  }
});
test("global superadmin does not inherit tenant access; sensitive operations use global password", async () => {
  const s = await setup();
  try {
    const secret = await hashSecret("platform-password"),
      global = await hashSecret("global-password");
    s.sqlite
      .prepare(
        "INSERT INTO platform_admins(id,username,secret,created_at) VALUES(?,?,?,?)",
      )
      .run("p", "platform", secret, Date.now());
    s.sqlite
      .prepare(
        "INSERT INTO accounts(id,phone,secret,created_at) VALUES(?,?,?,?)",
      )
      .run("pa", "+12025550104", global, Date.now());
    s.sqlite.prepare("INSERT INTO account_platform VALUES(?,?)").run("pa", "p");
    const r = await s.req("/account/login", {
      phone: "+12025550104",
      secret: "global-password",
    });
    assert.equal(r.status, 200);
    s.setCookie(r);
    assert.equal((await s.req("/platform/api/panel")).status, 200);
    assert.equal((await s.req("/t/alpha/admin/panel")).status, 401);
    assert.equal(
      (await s.req("/platform/api/panel", undefined, "account_session=bad.bad"))
        .status,
      401,
    );
    const { verifySession } = await import("../src/lib/auth.js");
    const session = await verifySession(
      new Request("https://app.test", { headers: { Cookie: s.getCookie() } }),
      s.env,
      null,
      true,
    );
    assert.equal(session.secret, global);
  } finally {
    s.sqlite.close();
  }
});

test("renewable account sessions expire after inactivity and cannot revive revoked sessions", async (t) => {
  const s = await setup();
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    let response = await s.req("/account/login", {
      phone: "+12025550101",
      secret: "global-password",
    });
    assert.match(response.headers.get("Set-Cookie"), /Max-Age=2592000/);
    s.setCookie(response);
    t.mock.timers.tick(29 * 86400000);
    response = await s.req("/account/renew", {});
    assert.equal(response.status, 200);
    s.setCookie(response);
    t.mock.timers.tick(2 * 86400000);
    assert.equal((await s.req("/account/buildings")).status, 200);
    assert.equal(
      (await (await s.req("/account/buildings")).json()).linked,
      true,
    );
    await s.req("/account/logout", {});
    assert.equal((await s.req("/account/renew", {})).status, 401);
    response = await s.req("/account/login", {
      phone: "+12025550101",
      secret: "global-password",
    });
    s.setCookie(response);
    t.mock.timers.tick(30 * 86400000 + 1);
    assert.equal((await s.req("/account/renew", {})).status, 401);
  } finally {
    t.mock.timers.reset();
    s.sqlite.close();
  }
});
test("superadministration cookies retain a fixed one hour lifetime", async (t) => {
  const { accountCookie, accountSession } = await import(
    "../src/lib/account-session.js"
  );
  const s = await setup();
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    const a = s.sqlite
      .prepare("SELECT * FROM accounts WHERE phone=?")
      .get("+12025550101");
    const secret = await hashSecret("test-password");
    s.sqlite
      .prepare(
        "INSERT INTO platform_admins(id,username,secret,created_at) VALUES(?,?,?,?)",
      )
      .run("pwa-admin", "pwa-admin", secret, Date.now());
    s.sqlite
      .prepare("INSERT INTO account_platform(account_id,admin_id) VALUES(?,?)")
      .run(a.id, "pwa-admin");
    const cookie = await accountCookie(s.env, a);
    assert.match(cookie, /Max-Age=3600/);
    const req = new Request("https://app.test", {
      headers: { Cookie: cookie.split(";")[0] },
    });
    assert.ok(await accountSession(req, s.env));
    const response = await s.req("/account/renew", {}, cookie.split(";")[0]);
    assert.equal(response.headers.get("Set-Cookie"), null);
    t.mock.timers.tick(3600001);
    assert.equal(await accountSession(req, s.env), null);
  } finally {
    t.mock.timers.reset();
    s.sqlite.close();
  }
});

test("resident sessions have no server expiry, remain revocable and cannot elevate roles", async (t) => {
  const s = await setup();
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    const a = s.sqlite
      .prepare("SELECT id FROM accounts WHERE phone=?")
      .get("+12025550101");
    s.sqlite
      .prepare(
        "UPDATE users SET role='user' WHERE id IN (SELECT user_id FROM account_memberships WHERE account_id=?)",
      )
      .run(a.id);
    let response = await s.req("/account/login", {
      phone: "+12025550101",
      secret: "global-password",
    });
    assert.match(response.headers.get("Set-Cookie"), /Max-Age=34560000/);
    s.setCookie(response);
    t.mock.timers.tick(500 * 86400000);
    assert.equal(
      (await (await s.req("/account/buildings")).json()).linked,
      true,
    );
    s.sqlite
      .prepare(
        "UPDATE users SET role='master' WHERE id IN (SELECT user_id FROM account_memberships WHERE account_id=?)",
      )
      .run(a.id);
    assert.equal((await s.req("/account/renew", {})).status, 401);
    s.sqlite
      .prepare(
        "UPDATE users SET role='user' WHERE id IN (SELECT user_id FROM account_memberships WHERE account_id=?)",
      )
      .run(a.id);
    await s.req("/account/logout", {});
    assert.equal((await s.req("/account/renew", {})).status, 401);
  } finally {
    t.mock.timers.reset();
    s.sqlite.close();
  }
});
