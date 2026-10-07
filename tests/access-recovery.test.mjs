import test from "node:test";
import assert from "node:assert/strict";
import { makeDB } from "./db.mjs";
import { recoverAccess } from "../src/lib/access-recovery.js";
import * as operations from "../src/lib/operations.js";
import * as db from "../src/lib/db.js";

function setup() {
  const { sqlite, db: DB } = makeDB();
  sqlite.exec(`INSERT INTO tenants(id,slug,name,created_at) VALUES('t','t','T',1);
 INSERT INTO users(id,tenant_id,username,secret,role,created_at) VALUES('u','t','U','x','master',1);
 INSERT INTO relay_devices(device_id,name,created_at) VALUES('test','Test',1);
 INSERT INTO gates(id,tenant_id,name,trigger_type,trigger_config,created_at) VALUES('g','t','G','mqtt','{"deviceId":"test"}',1),('w','t','W','webhook','{}',1);
 INSERT INTO codes(code,tenant_id,gate_id,owner,owner_id,status,created_at,claimed_at,claim_token,visit_mode,expires_at) VALUES('123456','t','g','U','u','uncertain',1,1000000,'source',1,605800000);
 INSERT INTO direct_operations(id,tenant_id,gate_id,owner_id,gate_name,status,created_at) VALUES('11111111-1111-4111-8111-111111111111','t','g','u','G','uncertain',1000000);
 INSERT INTO logs(id,tenant_id,gate_id,gate_name,code,owner,at,outcome) VALUES('11111111-1111-4111-8111-111111111111','t','g','G','DIRECTO','U',1000000,'pending');
 INSERT INTO relay_commands(id,device_id,tenant_id,gate_id,source_id,status,created_at,expires_at,release_at) VALUES('r','test','t','g','source','uncertain',1000000,1010,1130000);`);
  return { sqlite, env: { DB } };
}
test("recovery releases device after deadline, retains alert and never extends a visit", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1129999 });
  const s = setup();
  try {
    await recoverAccess(s.env, "t");
    assert.equal(
      s.sqlite.prepare("SELECT status FROM relay_commands").get().status,
      "uncertain",
    );
    assert.equal(
      s.sqlite.prepare("SELECT status FROM codes").get().status,
      "uncertain",
    );
    t.mock.timers.setTime(1130000);
    await recoverAccess(s.env, "t");
    assert.equal(
      s.sqlite.prepare("SELECT status FROM relay_commands").get().status,
      "unconfirmed",
    );
    const c = s.sqlite.prepare("SELECT * FROM codes").get();
    assert.equal(c.status, "active");
    assert.equal(c.visit_started_at, 1000000);
    assert.equal(c.expires_at, 1600000);
    assert.equal(
      s.sqlite
        .prepare("SELECT COUNT(*) n FROM logs WHERE outcome='uncertain'")
        .get().n,
      2,
    );
    await recoverAccess(s.env, "t");
    assert.equal(s.sqlite.prepare("SELECT COUNT(*) n FROM logs").get().n, 2);
    assert.equal((await operations.list(s.env, "t"))[0].status, "unconfirmed");
    const old = await operations.reserve(
      s.env,
      { id: "u", tenant_id: "t" },
      { id: "g" },
      "11111111-1111-4111-8111-111111111111",
    );
    assert.equal(old.replay, true);
    const fresh = await operations.reserve(
      s.env,
      { id: "u", tenant_id: "t", username: "U" },
      { id: "g", name: "G" },
      crypto.randomUUID(),
      Date.now(),
    );
    assert.equal(fresh.replay, false);
    assert.equal(fresh.created_at, Date.now());
  } finally {
    s.sqlite.close();
  }
});
test("recovery preserves cancelled, expired, strict single-use and already-started visits", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1800000 });
  for (const kind of ["revoked", "expired", "single", "started", "repeat"]) {
    const s = setup();
    try {
      if (["revoked", "expired"].includes(kind))
        s.sqlite.prepare("UPDATE codes SET status=?").run(kind);
      if (kind === "single")
        s.sqlite.exec("UPDATE codes SET single_use=1,visit_mode=0");
      if (kind === "started")
        s.sqlite.exec(
          "UPDATE codes SET visit_started_at=1100000,expires_at=1700000",
        );
      if (kind === "repeat")
        s.sqlite.exec("UPDATE codes SET visit_mode=0,expires_at=NULL");
      await recoverAccess(s.env, "t");
      const c = s.sqlite.prepare("SELECT * FROM codes").get();
      assert.equal(
        c.status,
        {
          revoked: "revoked",
          expired: "expired",
          single: "used",
          started: "expired",
          repeat: "active",
        }[kind],
      );
      if (kind === "started") assert.equal(c.expires_at, 1700000);
      if (kind === "repeat") assert.equal(c.expires_at, null);
    } finally {
      s.sqlite.close();
    }
  }
});
test("interrupted pending requests recover without a relay record, with durable audit; webhook does not", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1130000 });
  const s = setup();
  try {
    s.sqlite.exec(
      "DELETE FROM relay_commands; UPDATE codes SET status='pending'; UPDATE direct_operations SET status='pending'; INSERT INTO direct_operations(id,tenant_id,gate_id,owner_id,gate_name,status,created_at) VALUES('web','t','w','u','W','uncertain',1)",
    );
    await recoverAccess(s.env, "t");
    assert.equal(
      s.sqlite
        .prepare("SELECT status FROM direct_operations WHERE id='web'")
        .get().status,
      "uncertain",
    );
    assert.equal(
      s.sqlite.prepare("SELECT status FROM codes").get().status,
      "active",
    );
    assert.equal(
      s.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM logs WHERE code='123456' AND outcome='uncertain'",
        )
        .get().n,
      1,
    );
  } finally {
    s.sqlite.close();
  }
});
test("recovery is tenant-scoped and rolls back when audit cannot be written", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1130000 });
  const s = setup();
  try {
    await recoverAccess(s.env, "other");
    assert.equal(
      s.sqlite.prepare("SELECT status FROM codes").get().status,
      "uncertain",
    );
    s.sqlite.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON logs BEGIN SELECT RAISE(ABORT,'disk'); END",
    );
    await assert.rejects(recoverAccess(s.env, "t"));
    assert.equal(
      s.sqlite.prepare("SELECT status FROM codes").get().status,
      "uncertain",
    );
    assert.equal(
      s.sqlite.prepare("SELECT status FROM relay_commands").get().status,
      "uncertain",
    );
  } finally {
    s.sqlite.close();
  }
});

test("uncertain MQTT visits start their window immediately and manual retry cannot bypass the pause", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1001000 });
  const s = setup();
  try {
    s.sqlite.exec("UPDATE codes SET status='pending'");
    const row = s.sqlite.prepare("SELECT * FROM codes").get();
    const gate = s.sqlite.prepare("SELECT * FROM gates WHERE id='g'").get();
    await db.finishCode(s.env, row, gate, "uncertain");
    const code = s.sqlite.prepare("SELECT * FROM codes").get();
    assert.equal(code.visit_started_at, 1000000);
    assert.equal(code.expires_at, 1600000);
    await assert.rejects(
      db.resolveCode(s.env, "t", "123456", "retry"),
      /automáticamente/,
    );
    t.mock.timers.setTime(1130000);
    await recoverAccess(s.env, "t");
    assert.equal(
      s.sqlite.prepare("SELECT expires_at FROM codes").get().expires_at,
      1600000,
    );
  } finally {
    s.sqlite.close();
  }
});
