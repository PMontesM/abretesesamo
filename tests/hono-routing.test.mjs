import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import * as db from "../src/lib/db.js";
import { makeDB } from "./db.mjs";
import { createSessionCookie } from "./session.mjs";

const request = (
  env,
  path,
  { cookie = "", body, method = body ? "POST" : "GET", headers = {} } = {},
) =>
  worker.fetch(
    new Request("https://app.test" + path, {
      method,
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
    {},
  );

async function fixture() {
  const { sqlite, db: DB } = makeDB();
  const env = {
    DB,
    ADMIN_SIGNING_SECRET: "hono-routing-test-secret-at-least-32-characters",
  };
  const tenantId = await db.createTenant(env, {
    slug: "hono",
    name: "Hono",
    gateName: "Demo",
    triggerType: "demo",
    masterUsername: "Admin",
    masterSecret: "test-password",
  });
  const master = sqlite.prepare("SELECT * FROM users").get();
  const gate = sqlite.prepare("SELECT * FROM gates").get();
  await db.createUser(env, tenantId, {
    username: "Residente",
    secret: "test-password",
    gateIds: [gate.id],
  });
  const resident = sqlite
    .prepare("SELECT * FROM users WHERE role='user'")
    .get();
  sqlite
    .prepare(
      "INSERT INTO platform_admins(id,username,secret,created_at) VALUES(?,?,?,?)",
    )
    .run("super", "Super", "test-hash", Date.now());
  const cookies = {
    resident: await createSessionCookie(env, resident),
    master: await createSessionCookie(env, master),
    platform: await createSessionCookie(env, { id: "super" }, true),
  };
  return { sqlite, env, tenantId, gate, resident, cookies };
}

test("Hono: middleware separates building roles and platform permissions before mutations", async () => {
  const f = await fixture();
  try {
    for (const [path, method] of [
      ["users", "GET"],
      ["create-user", "POST"],
      ["delete-user", "POST"],
      ["users/permissions", "POST"],
      ["connection", "POST"],
      ["support", "POST"],
    ]) {
      for (const suffix of ["", "/"]) {
        const r = await request(f.env, "/t/hono/admin/" + path + suffix, {
          cookie: f.cookies.resident,
          method,
          ...(method === "POST" ? { body: {} } : {}),
        });
        assert.equal(r.status, 403, path + suffix);
      }
    }
    for (const cookie of [f.cookies.resident, f.cookies.master]) {
      assert.equal(
        (await request(f.env, "/platform/api/tenants", { cookie })).status,
        401,
      );
      assert.equal(
        (
          await request(f.env, "/platform/api/users/delete", {
            cookie,
            body: { tenantId: f.tenantId, userId: f.resident.id },
          })
        ).status,
        401,
      );
    }
    assert.equal(
      (
        await request(f.env, "/t/hono/admin/panel", {
          cookie: f.cookies.platform,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request(f.env, "/t/hono/admin/users", {
          cookie: f.cookies.master,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(f.env, "/t/hono/admin/panel/", {
          cookie: f.cookies.resident,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(f.env, "/t/hono/admin/open-gate", {
          cookie: f.cookies.resident,
        })
      ).status,
      404,
    );
    assert.equal(
      f.sqlite.prepare("SELECT count(*) n FROM direct_operations").get().n,
      0,
    );
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM users").get().n, 2);
    assert.equal((await request(f.env, "/t/hono/admin")).status, 302);
    for (const path of ["renew", "password", "phone"])
      assert.equal(
        (await request(f.env, "/account/" + path, { body: {} })).status,
        401,
      );
    f.sqlite
      .prepare("UPDATE tenants SET status='suspended' WHERE id=?")
      .run(f.tenantId);
    assert.equal(
      (
        await request(f.env, "/t/hono/admin/panel", {
          cookie: f.cookies.master,
        })
      ).status,
      403,
    );
    assert.equal(
      (await request(f.env, "/t/hono/api/open", { body: { code: "123456" } }))
        .status,
      403,
    );
  } finally {
    f.sqlite.close();
  }
});

test("Hono: platform code revocation returns success and keeps masked credentials", async () => {
  const f = await fixture();
  try {
    const code = await db.createCode(f.env, f.resident, {
      gateId: f.gate.id,
      label: "Visita",
      days: 1,
      singleUse: false,
    });
    const cookie = f.cookies.platform;
    const response = await request(
      f.env,
      "/platform/api/codes?tenantId=" + f.tenantId,
      { cookie },
    );
    assert.equal(response.status, 200);
    const listing = await response.json();
    assert.notEqual(listing.codes[0].code, code.code);
    const revoked = await request(f.env, "/platform/api/codes/revoke", {
      cookie,
      body: { tenantId: f.tenantId, codeRef: listing.codes[0].codeRef },
    });
    assert.equal(revoked.status, 200);
    assert.deepEqual(await revoked.json(), { ok: true, tenantId: f.tenantId });
    assert.equal(
      f.sqlite.prepare("SELECT status FROM codes WHERE code=?").get(code.code)
        .status,
      "revoked",
    );
  } finally {
    f.sqlite.close();
  }
});

test("Hono: errors and early rejections retain security headers and conceal internal failures", async () => {
  let queries = 0;
  const env = {
    DB: {
      prepare() {
        queries++;
        throw Error("private-database-detail");
      },
    },
  };
  for (const [path, options, status] of [
    ["/health", {}, 200],
    ["/not-found", {}, 404],
    ["/t/hono/admin/panel", {}, 500],
    [
      "/t/hono/api/open",
      { body: {}, headers: { Origin: "https://other.test" } },
      403,
    ],
  ]) {
    const response = await request(env, path, options);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Frame-Options"), "DENY");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(
      response.headers.get("Content-Security-Policy"),
      /frame-ancestors 'none'/,
    );
    assert.ok(!(await response.text()).includes("private-database-detail"));
  }
  assert.equal(queries, 1, "origin rejection must precede database access");
});
