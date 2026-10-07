import test from "node:test";
import assert from "node:assert/strict";
import { makeDB } from "./db.mjs";
import { recoverAccess, recoveryScope } from "../src/lib/access-recovery.js";
import { cleanup } from "../src/lib/db.js";
import { reserve } from "../src/lib/operations.js";
import {
  ACTIVITY_RETENTION_MS,
  AUDIT_RETENTION_MS,
} from "../src/lib/access-policy.js";
import { sendOpening } from "../frontend/src/opening-request.js";

test("recovery is deduplicated within a request, not between requests or tenants", async () => {
  const { sqlite, db } = makeDB();
  let reads = 0;
  const env = {
    DB: {
      ...db,
      prepare(sql) {
        if (sql.includes("SELECT 1 AS due")) reads++;
        return db.prepare(sql);
      },
    },
  };
  try {
    const first = recoveryScope(env);
    assert.equal(first.DB, env.DB);
    await Promise.all([
      recoverAccess(first, "a"),
      recoverAccess(first, "a"),
      recoverAccess(first, "a"),
    ]);
    assert.equal(reads, 1);
    await recoverAccess(first, "b");
    assert.equal(reads, 2);
    await recoverAccess(recoveryScope(env), "a");
    assert.equal(reads, 3);
    await recoverAccess(env, "a");
    await recoverAccess(env, "a");
    assert.equal(reads, 5);
  } finally {
    sqlite.close();
  }
});
test("retention removes finished history, preserves blockers and rejects an expired replay after pruning", async (t) => {
  const now = 2000000000000;
  t.mock.timers.enable({ apis: ["Date"], now });
  const { sqlite, db } = makeDB(),
    env = { DB: db },
    old = now - ACTIVITY_RETENTION_MS - 1;
  try {
    sqlite.exec(`INSERT INTO tenants(id,slug,name,created_at) VALUES('t','t','T',1);
 INSERT INTO gates(id,tenant_id,name,trigger_type,trigger_config,created_at) VALUES('g','t','G','demo','{}',1),('w','t','W','webhook','{}',1);
 INSERT INTO users(id,tenant_id,username,secret,role,created_at) VALUES('u','t','U','x','master',1);`);
    const id = "11111111-1111-4111-8111-111111111111";
    const insert = sqlite.prepare(
      "INSERT INTO direct_operations(id,tenant_id,gate_id,owner_id,gate_name,status,created_at) VALUES(?,'t',?,'u','Gate',?,?)",
    );
    insert.run(id, "g", "sent", old);
    insert.run("alert", "g", "unconfirmed", old);
    insert.run("pending", "w", "pending", old);
    insert.run("recent", "g", "sent", now);
    sqlite
      .prepare(
        "INSERT INTO logs(id,tenant_id,gate_id,gate_name,code,at,outcome) VALUES('pending','t','w','W','DIRECTO',?,'pending'),('old','t','g','G','DIRECTO',?,'sent')",
      )
      .run(old, old);
    sqlite
      .prepare(
        "INSERT INTO relay_commands(id,device_id,tenant_id,gate_id,source_id,status,created_at,expires_at) VALUES('old','dev','t','g','s','unconfirmed',?,1),('live','dev','t','g','p','pending',?,?)",
      )
      .run(old, now, Math.floor(now / 1000) + 10);
    sqlite
      .prepare(
        "INSERT INTO platform_audit_log(id,admin_username,action,details,at) VALUES('old','p','test','{}',?),('new','p','test','{}',?)",
      )
      .run(now - AUDIT_RETENTION_MS - 1, now);
    await cleanup(env);
    assert.equal(
      sqlite.prepare("SELECT 1 FROM direct_operations WHERE id=?").get(id),
      undefined,
    );
    assert.equal(
      sqlite
        .prepare("SELECT status FROM direct_operations WHERE id='pending'")
        .get().status,
      "uncertain",
    );
    assert.ok(sqlite.prepare("SELECT 1 FROM logs WHERE id='pending'").get());
    assert.equal(
      sqlite.prepare("SELECT 1 FROM logs WHERE id='old'").get(),
      undefined,
    );
    assert.equal(
      sqlite.prepare("SELECT 1 FROM relay_commands WHERE id='old'").get(),
      undefined,
    );
    assert.ok(
      sqlite.prepare("SELECT 1 FROM relay_commands WHERE id='live'").get(),
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) n FROM platform_audit_log").get().n,
      1,
    );
    await assert.rejects(
      reserve(env, { id: "u", tenant_id: "t" }, { id: "g" }, id, old),
      /venció/,
    );
    assert.equal(
      sqlite.prepare("SELECT 1 FROM direct_operations WHERE id=?").get(id),
      undefined,
    );
  } finally {
    sqlite.close();
  }
});
const memory = () => {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
};
test("one explicit retry checks the old result then submits exactly one new opening", async () => {
  const storage = memory();
  const calls = [];
  let id = 0,
    attempt = 0;
  const options = {
    gateId: "g",
    tenantId: "t",
    storage,
    now: () => 123456,
    uuid: () => String(++id),
    request: async (path, body) => {
      calls.push({ path, body });
      if (path.endsWith("/status")) return { status: "unconfirmed" };
      if (++attempt === 1) throw Error("lost response");
      return { ok: true, message: "Done" };
    },
  };
  await assert.rejects(sendOpening(options), /lost/);
  assert.equal(calls.length, 1);
  await sendOpening(options);
  assert.deepEqual(
    calls.map((c) => c.path),
    ["/admin/open-gate", "/admin/open-gate/status", "/admin/open-gate"],
  );
  assert.notEqual(calls[0].body.requestId, calls[2].body.requestId);
  assert.equal(storage.getItem("gate-order:t:g"), null);
});
test("pending, confirmed and failed status checks never send another command", async () => {
  for (const status of ["pending", "uncertain", "sent", "network"]) {
    const storage = memory();
    storage.setItem(
      "gate-order:t:g",
      JSON.stringify({ requestId: "old", requestedAt: 1 }),
    );
    const paths = [];
    const promise = sendOpening({
      gateId: "g",
      tenantId: "t",
      storage,
      request: async (path) => {
        paths.push(path);
        if (status === "network") throw Error("offline");
        return { status, message: "Wait" };
      },
    });
    if (status === "sent") await promise;
    else await assert.rejects(promise);
    assert.deepEqual(paths, ["/admin/open-gate/status"]);
  }
});
test("a missing recent request reuses its identity; legacy or expired requests get a new identity", async () => {
  for (const valid of [true, false]) {
    const storage = memory();
    storage.setItem(
      "gate-order:t:g",
      JSON.stringify({ requestId: "old", requestedAt: 1 }),
    );
    let submitted;
    await sendOpening({
      gateId: "g",
      tenantId: "t",
      storage,
      uuid: () => "new",
      now: () => 2,
      request: async (path, body) => {
        if (path.endsWith("/status"))
          return { status: "missing", acceptsOriginal: valid };
        submitted = body;
        return { ok: true };
      },
    });
    assert.equal(submitted.requestId, valid ? "old" : "new");
    assert.equal(submitted.requestedAt, valid ? 1 : 2);
  }
});
