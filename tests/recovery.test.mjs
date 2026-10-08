import test from "node:test";
import assert from "node:assert/strict";
import { makeDB } from "./db.mjs";
import * as db from "../src/lib/db.js";
import { hashSecret, verifySecret } from "../src/lib/security.js";
import { createSessionCookie } from "./session.mjs";
import worker from "../src/index.js";
async function setup() {
  const { sqlite, db: DB } = makeDB(),
    env = {
      DB,
      ADMIN_SIGNING_SECRET: "recovery-test-key-with-at-least-32-characters",
    };
  const tenantId = await db.createTenant(env, {
    name: "Prueba",
    slug: "prueba",
    gateName: "Demo",
    triggerType: "demo",
    masterUsername: "Ana López",
    masterPhone: "+12025550100",
    masterSecret: "initial-password",
  });
  const user = sqlite.prepare("SELECT * FROM users").get();
  sqlite
    .prepare(
      "INSERT INTO platform_admins(id,username,secret,created_at) VALUES(?,?,?,?)",
    )
    .run("super", "Super", await hashSecret("super-password"), 1);
  const cookie = await createSessionCookie(env, { id: "super" }, true);
  const req = (path, body, auth = cookie) =>
    worker.fetch(
      new Request("https://app.test" + path, {
        method: body ? "POST" : "GET",
        headers: { Cookie: auth, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
      {},
    );
  return { sqlite, env, tenantId, user, cookie, req };
}
test("recuperación requiere superadmin, prueba de contraseña y enlace de un solo uso", async () => {
  const s = await setup();
  try {
    const userCookie = await createSessionCookie(s.env, s.user);
    const body = {
      tenantId: s.tenantId,
      userId: s.user.id,
      currentSecret: "super-password",
    };
    assert.equal(
      (await s.req("/platform/api/users/recovery", body, userCookie)).status,
      401,
    );
    assert.equal(
      (
        await s.req("/platform/api/users/recovery", {
          ...body,
          currentSecret: "wrong",
        })
      ).status,
      400,
    );
    const result = await s.req("/platform/api/users/recovery", body);
    assert.equal(result.status, 200);
    const issued = await result.json(),
      token = new URL(issued.url).hash.slice(1);
    assert.ok(
      !JSON.stringify(
        s.sqlite.prepare("SELECT * FROM platform_audit_log").all(),
      ).includes(token),
    );
    assert.ok(
      !JSON.stringify(
        s.sqlite.prepare("SELECT * FROM account_recovery").all(),
      ).includes(token),
    );
    const payload = {
      token,
      secret: "replacement-password",
      confirmSecret: "replacement-password",
    };
    assert.equal(
      (
        await s.req(
          "/account/recover",
          { ...payload, confirmSecret: "other" },
          "",
        )
      ).status,
      400,
    );
    const replies = await Promise.all([
      s.req("/account/recover", payload, ""),
      s.req("/account/recover", payload, ""),
    ]);
    assert.deepEqual(replies.map((r) => r.status).sort(), [200, 400]);
    assert.equal(
      (await s.req("/t/prueba/admin/panel", undefined, userCookie)).status,
      401,
    );
    assert.ok(
      await verifySecret(
        "replacement-password",
        s.sqlite
          .prepare("SELECT secret FROM accounts WHERE phone=?")
          .get("+12025550100").secret,
      ),
    );
  } finally {
    s.sqlite.close();
  }
});
test("teléfono repetido es error legible y cambiarlo invalida sesiones y enlaces", async () => {
  const s = await setup();
  try {
    await assert.rejects(
      db.createUser(s.env, s.tenantId, {
        username: "Otra persona",
        phone: " +1 (202) 555-0100 ",
        secret: "new-password",
        gateIds: [],
      }),
      /ya tiene acceso/,
    );
    const userCookie = await createSessionCookie(s.env, s.user);
    await s.req("/platform/api/users/recovery", {
      tenantId: s.tenantId,
      userId: s.user.id,
      currentSecret: "super-password",
    });
    const change = { phone: "+12025550120", currentSecret: "initial-password" };
    assert.equal(
      (
        await s.req(
          "/account/phone",
          { ...change, currentSecret: "wrong" },
          userCookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (await s.req("/account/phone", change, userCookie)).status,
      200,
    );
    assert.equal(
      (await s.req("/t/prueba/admin/panel", undefined, userCookie)).status,
      401,
    );
    assert.equal(
      s.sqlite.prepare("SELECT count(*) n FROM account_recovery").get().n,
      0,
    );
    assert.equal(
      (
        await s.req(
          "/account/login",
          { phone: "+12025550120", secret: "initial-password" },
          "",
        )
      ).status,
      200,
    );
  } finally {
    s.sqlite.close();
  }
});
test("enlaces vencidos no cambian contraseña; ya no hay login por correo o usuario", async () => {
  const s = await setup();
  try {
    const issued = await (
      await s.req("/platform/api/users/recovery", {
        tenantId: s.tenantId,
        userId: s.user.id,
        currentSecret: "super-password",
      })
    ).json();
    s.sqlite.prepare("UPDATE account_recovery SET expires_at=1").run();
    assert.equal(
      (
        await s.req(
          "/account/recover",
          {
            token: new URL(issued.url).hash.slice(1),
            secret: "replacement-password",
            confirmSecret: "replacement-password",
          },
          "",
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await s.req(
          "/account/login",
          { email: "old@example.com", secret: "initial-password" },
          "",
        )
      ).status,
      400,
    );
    assert.notEqual(
      (
        await s.req(
          "/platform/login",
          { username: "Super", secret: "super-password" },
          "",
        )
      ).status,
      200,
    );
    assert.notEqual(
      (
        await s.req(
          "/t/prueba/api/login",
          { username: "Ana López", secret: "initial-password" },
          "",
        )
      ).status,
      200,
    );
  } finally {
    s.sqlite.close();
  }
});
