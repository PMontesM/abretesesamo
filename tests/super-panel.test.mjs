import test from "node:test";
import assert from "node:assert/strict";
import { makeDB } from "./db.mjs";
import { createTenant } from "../src/lib/db.js";
import { superPanel } from "../src/lib/super-panel.js";
import { createSessionCookie } from "./session.mjs";
import worker from "../src/index.js";
test("resumen de plataforma exige sesión propia y cuenta bloqueos de relé sin exponer credenciales", async () => {
  const { sqlite, db: DB } = makeDB(),
    env = {
      DB,
      ADMIN_SIGNING_SECRET: "test-signing-key-with-at-least-32-characters",
    };
  try {
    const tenant = await createTenant(env, {
      slug: "alpha",
      name: "Alpha",
      gateName: "Principal",
      triggerUrl: "https://device.test/private-token",
      masterUsername: "admin",
      masterSecret: "password-test",
    });
    const gate = sqlite.prepare("SELECT id FROM gates").get().id;
    sqlite
      .prepare(
        "INSERT INTO relay_commands(id,device_id,tenant_id,gate_id,source_id,status,created_at) VALUES('cmd','test',?,?,'source','uncertain',?)",
      )
      .run(tenant, gate, Date.now());
    sqlite
      .prepare(
        "INSERT INTO relay_devices(device_id,name,connection_state,checked_at,created_at) VALUES('test','Prueba','online',?,?)",
      )
      .run(Date.now() - 300000, Date.now());
    const result = await superPanel(env, 360);
    assert.equal(result.buildings[0].pending, 1);
    assert.equal(result.devices[0].connection_state, "unknown");
    assert.ok(!JSON.stringify(result).includes("private-token"));
    const req = (cookie) =>
      worker.fetch(
        new Request("https://test.local/platform/api/panel", {
          headers: { Cookie: cookie },
        }),
        env,
        {},
      );
    assert.equal((await req("")).status, 401);
    const user = sqlite.prepare("SELECT * FROM users").get();
    const cookie = (await createSessionCookie(env, user, false)).split(";")[0];
    assert.equal((await req(cookie)).status, 401);
    sqlite
      .prepare(
        "INSERT INTO platform_admins(id,username,secret,created_at) VALUES(?,?,?,?)",
      )
      .run("super", "super", "test-hash", 1);
    const superCookie = (
      await createSessionCookie(env, { id: "super", session_version: 1 }, true)
    ).split(";")[0];
    assert.equal((await req(superCookie)).status, 200);
  } finally {
    sqlite.close();
  }
});
