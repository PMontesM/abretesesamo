import test from "node:test";
import assert from "node:assert/strict";
import { makeDB } from "./db.mjs";
import { createTenant, tenantById } from "../src/lib/db.js";
import { buildingSlug } from "../src/lib/security.js";
const body = {
  name: "Torre Álamos",
  gateName: "Principal",
  triggerType: "demo",
  masterUsername: "admin",
  masterSecret: "test-password",
};
test("Enlace automático: acentos, espacios, símbolos y límite de longitud", () => {
  assert.equal(buildingSlug("  Torre Álamos / Ñandú  "), "torre-alamos-nandu");
  assert.equal(buildingSlug("🏢"), "edificio");
  assert.equal(buildingSlug("Á".repeat(100)).length, 64);
  assert.ok(!buildingSlug("a".repeat(63) + " x").endsWith("-"));
});
test("Edificios con mismo nombre reciben sufijos; nombres y enlaces anteriores se conservan", async () => {
  const { sqlite, db: DB } = makeDB(),
    env = { DB };
  try {
    const first = await createTenant(env, body),
      second = await createTenant(env, body);
    assert.equal((await tenantById(env, first)).slug, "torre-alamos");
    assert.equal((await tenantById(env, second)).slug, "torre-alamos-2");
    assert.equal((await tenantById(env, second)).name, body.name);
    sqlite
      .prepare("UPDATE tenants SET name=? WHERE id=?")
      .run("Nombre nuevo", first);
    assert.equal((await tenantById(env, first)).slug, "torre-alamos");
    const third = await createTenant(env, { ...body, slug: "mi-edificio" });
    assert.equal((await tenantById(env, third)).slug, "mi-edificio");
    await assert.rejects(
      createTenant(env, { ...body, slug: "mi-edificio" }),
      /enlace ya está en uso/,
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM tenants").get().n,
      3,
    );
  } finally {
    sqlite.close();
  }
});
test("La restricción única resuelve una colisión simultánea sin dejar edificios parciales", async () => {
  const { sqlite, db: raw } = makeDB();
  let count = 0,
    release,
    tail = Promise.resolve();
  const barrier = new Promise((r) => (release = r));
  const DB = {
    prepare(sql) {
      const statement = raw.prepare(sql);
      if (sql !== "SELECT * FROM tenants WHERE slug=?") return statement;
      return {
        bind(...args) {
          const query = statement.bind(...args);
          return {
            ...query,
            async first() {
              const row = await query.first();
              if (args[0] === "torre-alamos" && count < 2) {
                count++;
                if (count === 2) release();
                await barrier;
              }
              return row;
            },
          };
        },
      };
    },
    batch(statements) {
      const result = tail.then(() => raw.batch(statements));
      tail = result.catch(() => {});
      return result;
    },
  };
  try {
    const ids = await Promise.all([
      createTenant({ DB }, body),
      createTenant({ DB }, body),
    ]);
    assert.notEqual(ids[0], ids[1]);
    assert.deepEqual(
      sqlite
        .prepare("SELECT slug FROM tenants ORDER BY slug")
        .all()
        .map((x) => x.slug),
      ["torre-alamos", "torre-alamos-2"],
    );
    for (const table of ["tenants", "gates", "users"])
      assert.equal(
        sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n,
        2,
      );
  } finally {
    sqlite.close();
  }
});
test("Fallo de creación distinto de colisión no se reintenta y revierte los registros", async () => {
  const { sqlite, db: raw } = makeDB();
  let batches = 0;
  const env = {
    DB: {
      prepare: (sql) => raw.prepare(sql),
      batch: (statements) => {
        batches++;
        return raw.batch(statements);
      },
    },
  };
  try {
    sqlite.exec(
      "CREATE TRIGGER fail_gate BEFORE INSERT ON gates BEGIN SELECT RAISE(ABORT,'simulated failure'); END",
    );
    await assert.rejects(createTenant(env, body), /simulated failure/);
    assert.equal(batches, 1);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM tenants").get().n,
      0,
    );
  } finally {
    sqlite.close();
  }
});
