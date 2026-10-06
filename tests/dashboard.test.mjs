import test from "node:test";
import assert from "node:assert/strict";
import { makeDB } from "./db.mjs";
import { dashboard } from "../src/lib/db.js";
import worker from "../src/index.js";
test("resumen: cifras exactas, vigencia y separación de residentes y edificios", async () => {
  const { sqlite, db: DB } = makeDB(),
    env = { DB },
    now = Date.now();
  sqlite.exec(`INSERT INTO tenants(id,slug,name,created_at,status) VALUES('a','alpha','Alpha',1,'active'); INSERT INTO tenants(id,slug,name,created_at,status) VALUES('b','beta','Beta',1,'active');
    INSERT INTO gates(id,tenant_id,name,trigger_type,trigger_config,created_at,status) VALUES('ga','a','Principal','demo','{}',1,'active'); INSERT INTO gates(id,tenant_id,name,trigger_type,trigger_config,created_at,status) VALUES('gb','b','Ajeno','demo','{}',1,'active');`);
  const add = (tenant, owner, outcome, at) =>
    sqlite
      .prepare(
        "INSERT INTO logs(id,tenant_id,owner_id,outcome,at) VALUES(?,?,?,?,?)",
      )
      .run(crypto.randomUUID(), tenant, owner, outcome, at);
  for (let i = 0; i < 205; i++) add("a", "resident", "sent", now - 1000);
  add("a", "other", "sent", now - 1000);
  add("a", "resident", "uncertain", now - 1000);
  add("a", "resident", "not_sent", now - 1000);
  add("a", "resident", "sent", now - 25 * 3600000);
  add("b", "resident", "sent", now - 1000);
  for (const [code, owner, expires, status] of [
    ["100001", "resident", null, "active"],
    ["100002", "other", null, "active"],
    ["100003", "resident", now - 1, "active"],
    ["100004", "resident", null, "revoked"],
  ])
    sqlite
      .prepare(
        "INSERT INTO codes(code,tenant_id,gate_id,owner_id,expires_at,status,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(code, "a", "ga", owner, expires, status, now);
  const resident = await dashboard(env, {
    id: "resident",
    tenant_id: "a",
    role: "user",
  });
  assert.equal(resident.sent, 205);
  assert.equal(resident.attention, 2);
  assert.equal(resident.activeCodes, 1);
  assert.equal(resident.lastSent, now - 1000);
  assert.equal(
    resident.hours.reduce((n, h) => n + h.count, 0),
    205,
  );
  const admin = await dashboard(env, {
    id: "admin",
    tenant_id: "a",
    role: "master",
  });
  assert.equal(admin.sent, 206);
  assert.equal(admin.activeCodes, 2);
  const replaced = await dashboard(env, {
    id: "new-resident",
    tenant_id: "a",
    role: "user",
  });
  assert.equal(replaced.sent, 0);
  assert.equal(replaced.lastSent, null);
  const response = await worker.fetch(
    new Request("https://app.test/t/alpha/admin/dashboard"),
    env,
    { waitUntil() {} },
  );
  assert.equal(response.status, 401);
});
