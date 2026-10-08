import test from "node:test";
import assert from "node:assert/strict";
import { makeDB } from "./db.mjs";
import * as db from "../src/lib/db.js";
import {
  createCode,
  listCodes,
  extendCode,
  visitorGates,
} from "../src/lib/codes.js";
async function setup() {
  const { sqlite, db: DB } = makeDB(),
    env = { DB };
  const tenant = await db.createTenant(env, {
      slug: "alpha",
      name: "Alpha",
      gateName: "Uno",
      triggerUrl: "https://device.test/one",
      masterUsername: "admin",
      masterSecret: "test-password",
    }),
    g1 = sqlite.prepare("SELECT id FROM gates").get().id,
    g2 = await db.saveGate(env, tenant, {
      name: "Dos",
      triggerUrl: "https://device.test/two",
    });
  await db.createUser(env, tenant, {
    username: "resident",
    secret: "test-password",
    gateIds: [g1, g2],
  });
  const user = sqlite
    .prepare("SELECT * FROM users WHERE username='resident'")
    .get();
  return { sqlite, env, user, tenant, g1, g2 };
}
test("pase multiacceso: selección autorizada, reserva compartida y revocación al quitar permiso secundario", async () => {
  const { sqlite, env, user, tenant, g1, g2 } = await setup();
  const { code } = await createCode(env, user, {
    label: "Entrega",
    days: 1,
    gateIds: [g1, g2],
  });
  assert.equal(
    (await listCodes(env, user.tenant_id, user))[0].access.length,
    2,
  );
  assert.equal((await visitorGates(env, tenant, code)).length, 2);
  assert.equal(await db.claimCode(env, tenant, code, "ajeno"), null);
  const row = await db.claimCode(env, tenant, code, g2);
  assert.equal(row.gate_id, g2);
  assert.equal(await db.claimCode(env, tenant, code, g1), null);
  await db.finishCode(env, row, await db.getGate(env, tenant, g2), "sent");
  await db.setPermissions(env, tenant, user.id, [g1]);
  assert.equal(
    sqlite.prepare("SELECT status FROM codes WHERE code=?").get(code).status,
    "revoked",
  );
  assert.equal(await db.claimCode(env, tenant, code, g1), null);
});
test("cambiar la integración secundaria revoca todo el pase; creación parcial revierte", async () => {
  const { sqlite, env, user, tenant, g1, g2 } = await setup();
  const { code } = await createCode(env, user, {
    label: "Visita",
    days: 1,
    gateIds: [g1, g2],
  });
  await db.saveGate(env, tenant, {
    gateId: g2,
    name: "Dos",
    triggerUrl: "https://device.test/replaced",
  });
  assert.equal(await db.claimCode(env, tenant, code, g2), null);
  assert.equal(await db.claimCode(env, tenant, code, g1), null);
  sqlite.exec(
    "CREATE TRIGGER reject_pass BEFORE INSERT ON code_gates WHEN NEW.gate_id='" +
      g2 +
      "' BEGIN SELECT RAISE(ABORT,'test failure'); END",
  );
  const before = sqlite.prepare("SELECT COUNT(*) n FROM codes").get().n;
  await assert.rejects(
    createCode(env, user, { label: "Fail", days: 1, gateIds: [g1, g2] }),
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM codes").get().n, before);
});
test("extensión: vence pronto, dueño, no visita, no duplicación y no resucita revocados", async () => {
  const { sqlite, env, user, g1 } = await setup();
  const { code } = await createCode(env, user, {
    label: "Servicio",
    days: 1,
    gateIds: [g1],
  });
  const expires = Date.now() + 300000;
  sqlite
    .prepare("UPDATE codes SET expires_at=? WHERE code=?")
    .run(expires, code);
  await assert.rejects(
    extendCode(env, { ...user, id: "another" }, { code, expiresAt: expires }),
  );
  await extendCode(env, user, { code, expiresAt: expires });
  await assert.rejects(extendCode(env, user, { code, expiresAt: expires }));
  assert.equal(
    sqlite.prepare("SELECT expires_at FROM codes WHERE code=?").get(code)
      .expires_at,
    expires + 1800000,
  );
  sqlite
    .prepare("UPDATE codes SET status='revoked',expires_at=? WHERE code=?")
    .run(expires, code);
  await assert.rejects(extendCode(env, user, { code, expiresAt: expires }));
  sqlite
    .prepare("UPDATE codes SET status='active',visit_mode=1 WHERE code=?")
    .run(code);
  await assert.rejects(extendCode(env, user, { code, expiresAt: expires }));
});
test("visita multiacceso comparte los mismos diez minutos entre portones", async () => {
  const { sqlite, env, user, tenant, g1, g2 } = await setup();
  const { code } = await createCode(env, user, {
    label: "Visita",
    mode: "visit",
    gateIds: [g1, g2],
  });
  const a = await db.claimCode(env, tenant, code, g1);
  await db.finishCode(env, a, await db.getGate(env, tenant, g1), "sent");
  const deadline = sqlite
    .prepare("SELECT expires_at FROM codes WHERE code=?")
    .get(code).expires_at;
  const b = await db.claimCode(env, tenant, code, g2);
  await db.finishCode(env, b, await db.getGate(env, tenant, g2), "sent");
  assert.equal(
    sqlite.prepare("SELECT expires_at FROM codes WHERE code=?").get(code)
      .expires_at,
    deadline,
  );
});

test("creación usa únicamente tipo y días y rechaza contratos retirados", async () => {
  const { env, user, g1 } = await setup();
  for (const extra of [
    { expiresAt: Date.now() + 86400000 },
    { minutes: 30 },
    { category: "Entrega" },
    { singleUse: true },
    { gateId: g1 },
    { visit: true },
  ])
    await assert.rejects(
      createCode(env, user, {
        label: "Inválido",
        mode: "repeat",
        days: 1,
        gateIds: [g1],
        ...extra,
      }),
    );
  for (const mode of ["visit", "unlimited"])
    await assert.rejects(
      createCode(env, user, {
        label: "Inválido",
        mode,
        days: 2,
        gateIds: [g1],
      }),
    );
});

test("vigencias en días: visita inicia en siete días y reutilizable admite de uno a treinta", async () => {
  const { sqlite, env, user, g1 } = await setup();
  const visit = await createCode(env, user, {
    label: "Visita",
    mode: "visit",
    gateIds: [g1],
  });
  let row = sqlite.prepare("SELECT * FROM codes WHERE code=?").get(visit.code);
  assert.equal(row.expires_at - row.created_at, 7 * 86400000);
  for (const days of [1, 7, 30]) {
    const p = await createCode(env, user, {
      label: "Temporal",
      mode: "repeat",
      days,
      gateIds: [g1],
    });
    row = sqlite.prepare("SELECT * FROM codes WHERE code=?").get(p.code);
    assert.equal(row.expires_at - row.created_at, days * 86400000);
  }
  for (const days of [0, 31, 1.5])
    await assert.rejects(
      createCode(env, user, {
        label: "Inválido",
        mode: "repeat",
        days,
        gateIds: [g1],
      }),
    );
});

test("filtros de administración antes de paginar: dueño, acceso secundario, búsqueda y aislamiento", async () => {
  const { sqlite, env, user, tenant, g1, g2 } = await setup(),
    master = sqlite.prepare("SELECT * FROM users WHERE role='master'").get();
  const target = await createCode(env, user, {
    label: "Entrega especial",
    mode: "unlimited",
    gateIds: [g1, g2],
  });
  for (let i = 0; i < 105; i++)
    sqlite
      .prepare(
        "INSERT INTO codes(code,tenant_id,gate_id,owner_id,owner,label,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        "fill-" + i,
        tenant,
        g1,
        master.id,
        master.username,
        "Otro",
        Date.now() + i + 1000,
      );
  assert.equal(
    (await listCodes(env, master.tenant_id, master, { status: "" })).length,
    100,
  );
  assert.equal(
    (await listCodes(env, master.tenant_id, master, { status: "", page: 1 }))
      .length,
    6,
  );
  for (const options of [
    { ownerId: user.id },
    { gateId: g2 },
    { query: "ENTREGA especial" },
    { query: target.code.slice(0, 2) + "••" + target.code.slice(-2) },
    { query: user.username },
  ])
    assert.deepEqual(
      (await listCodes(env, master.tenant_id, master, options)).map(
        (p) => p.code,
      ),
      [target.code],
    );
  assert.equal(
    (
      await listCodes(env, user.tenant_id, user, {
        ownerId: master.id,
        status: "",
      })
    ).length,
    0,
  );
  assert.equal(
    (
      await listCodes(env, master.tenant_id, master, {
        ownerId: user.id,
        gateId: "foreign",
      })
    ).length,
    0,
  );
  const other = await db.createTenant(env, {
      slug: "beta",
      name: "Beta",
      gateName: "Otro",
      triggerUrl: "https://device.test/beta",
      masterUsername: "admin",
      masterSecret: "test-password",
    }),
    otherMaster = sqlite
      .prepare("SELECT * FROM users WHERE tenant_id=?")
      .get(other);
  assert.equal(
    (
      await listCodes(env, otherMaster.tenant_id, otherMaster, {
        query: target.code,
        ownerId: user.id,
        gateId: g2,
      })
    ).length,
    0,
  );
  await assert.rejects(
    listCodes(env, master.tenant_id, master, { query: "x".repeat(101) }),
  );
});
