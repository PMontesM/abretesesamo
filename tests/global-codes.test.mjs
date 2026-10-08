import { seedCode } from "./code-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { makeDB } from "./db.mjs";
import * as db from "../src/lib/db.js";
import { createCode } from "../src/lib/codes.js";
import worker from "../src/index.js";
test("global uniqueness retries cross-building collisions; visitor lookup never opens", async (t) => {
  const { sqlite, db: DB } = makeDB(),
    env = { DB };
  try {
    for (const slug of ["alpha", "beta"])
      await db.createTenant(env, {
        slug,
        name: slug,
        gateName: "Gate",
        triggerType: "demo",
        masterUsername: "admin",
        masterSecret: "local-password",
      });
    const users = sqlite
        .prepare("SELECT * FROM users ORDER BY tenant_id")
        .all(),
      gate = (u) =>
        sqlite
          .prepare("SELECT id FROM gates WHERE tenant_id=?")
          .get(u.tenant_id).id;
    let values = [123456, 123456, 234567, 123456, 345678];
    t.mock.method(crypto, "getRandomValues", (a) => {
      a[0] = values.shift();
      return a;
    });
    const a = await seedCode(env, users[0], {
      gateId: gate(users[0]),
      label: "A",
      days: 1,
      singleUse: false,
    });
    const b = await seedCode(env, users[1], {
      gateId: gate(users[1]),
      label: "B",
      days: 1,
      singleUse: false,
    });
    const c = await createCode(env, users[1], {
      gateIds: [gate(users[1])],
      label: "C",
      mode: "visit",
    });
    assert.deepEqual([a.code, b.code, c.code], ["123456", "234567", "345678"]);
    assert.throws(
      () =>
        sqlite
          .prepare("UPDATE codes SET code=? WHERE code=?")
          .run(a.code, b.code),
      /UNIQUE/,
    );
    const req = (code) =>
      worker.fetch(
        new Request("https://app.test/api/visitor-entry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        }),
        env,
        {},
      );
    for (const pass of [a, b, c]) {
      const r = await req(pass.code);
      assert.equal(r.status, 200);
      const data = await r.json();
      const slug = sqlite
        .prepare(
          "SELECT t.slug FROM codes c JOIN tenants t ON t.id=c.tenant_id WHERE c.code=?",
        )
        .get(pass.code).slug;
      assert.equal(data.redirect, "/t/" + slug);
    }
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM logs").get().n, 0);
    assert.equal(
      sqlite
        .prepare("SELECT visit_started_at FROM codes WHERE code=?")
        .get(c.code).visit_started_at,
      null,
    );
    sqlite
      .prepare("UPDATE codes SET status='revoked' WHERE code=?")
      .run(a.code);
    assert.equal((await req(a.code)).status, 403);
    sqlite.prepare("UPDATE codes SET expires_at=1 WHERE code=?").run(b.code);
    assert.equal((await req(b.code)).status, 403);
    sqlite.prepare("UPDATE tenants SET status='suspended'").run();
    assert.equal((await req(c.code)).status, 403);
    assert.equal((await req("000000")).status, 403);
    for (let i = 0; i < 3; i++) await req("000000");
    assert.equal((await req("000000")).status, 429);
  } finally {
    sqlite.close();
  }
});
