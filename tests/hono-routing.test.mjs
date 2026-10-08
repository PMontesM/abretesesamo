import { seedCode } from "./code-fixture.mjs";
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
    const code = await seedCode(f.env, f.resident, {
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

test("current contract retires aliases and creates the same multi-access codes for every panel", async () => {
  const f = await fixture();
  try {
    for (const [method, path, cookie] of [
      ["GET", "/t/hono/admin/passes", f.cookies.resident],
      ["POST", "/t/hono/admin/passes", f.cookies.resident],
      ["POST", "/t/hono/admin/passes/extend", f.cookies.resident],
      ["POST", "/t/hono/admin/create-code", f.cookies.resident],
      ["POST", "/t/hono/admin/revoke-code", f.cookies.resident],
      ["GET", "/t/hono/admin/dashboard", f.cookies.resident],
      ["GET", "/t/hono/admin/logs", f.cookies.resident],
      ["GET", "/t/hono/admin/gates", f.cookies.resident],
      ["POST", "/t/hono/admin/logout", f.cookies.resident],
      ["POST", "/platform/logout", f.cookies.platform],
      ["GET", "/platform/api/audit", f.cookies.platform],
    ])
      assert.equal(
        (
          await request(f.env, path, {
            cookie,
            method,
            ...(method === "POST" ? { body: {} } : {}),
          })
        ).status,
        404,
        path,
      );
    const second = await db.saveGate(f.env, f.tenantId, {
      name: "Segundo",
      triggerType: "demo",
    });
    await db.setPermissions(f.env, f.tenantId, f.resident.id, [
      f.gate.id,
      second,
    ]);
    for (const mode of ["visit", "repeat", "unlimited"]) {
      const response = await request(f.env, "/t/hono/admin/codes", {
        cookie: f.cookies.resident,
        body: {
          label: mode,
          mode,
          gateIds: [f.gate.id, second],
          ...(mode === "repeat" ? { days: 30 } : {}),
        },
      });
      assert.equal(response.status, 200, await response.clone().text());
      const { code } = await response.json();
      assert.match(code, /^\d{6}$/);
      const stored = f.sqlite
        .prepare("SELECT * FROM codes WHERE code=?")
        .get(code);
      assert.equal(
        stored.expires_at === null
          ? null
          : stored.expires_at - stored.created_at,
        mode === "unlimited" ? null : (mode === "visit" ? 7 : 30) * 86400000,
      );
    }
    const own = await (
      await request(f.env, "/t/hono/admin/codes", {
        cookie: f.cookies.resident,
      })
    ).json();
    const admin = await (
      await request(f.env, "/t/hono/admin/codes", { cookie: f.cookies.master })
    ).json();
    const platform = await (
      await request(f.env, "/platform/api/codes?tenantId=" + f.tenantId, {
        cookie: f.cookies.platform,
      })
    ).json();
    for (const result of [own, admin, platform]) {
      assert.equal(result.codes.length, 3);
      assert.equal(result.codes[0].access.length, 2);
      assert.ok(!("passes" in result));
    }
    assert.match(own.codes[0].code, /^\d{6}$/);
    assert.equal(admin.codes[0].codeMasked, true);
    assert.equal(platform.codes[0].codeMasked, true);
    for (const retired of [
      { minutes: 30 },
      { category: "Visita" },
      { singleUse: true },
      { expiresAt: Date.now() + 86400000 },
    ])
      assert.equal(
        (
          await request(f.env, "/t/hono/admin/codes", {
            cookie: f.cookies.resident,
            body: {
              label: "Retirado",
              mode: "repeat",
              days: 1,
              gateIds: [f.gate.id],
              ...retired,
            },
          })
        ).status,
        400,
      );
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM codes").get().n, 3);
  } finally {
    f.sqlite.close();
  }
});

test("one logout endpoint revokes resident, administrator and platform sessions", async () => {
  const f = await fixture();
  try {
    for (const [role, cookie] of Object.entries(f.cookies)) {
      assert.equal(
        (await request(f.env, "/account/logout", { cookie, body: {} })).status,
        200,
        role,
      );
      const result = await (
        await request(f.env, "/account/buildings", { cookie })
      ).json();
      assert.equal(result.linked, false, role);
    }
  } finally {
    f.sqlite.close();
  }
});
