import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone } from "../src/lib/account-provision.js";
import { makeDB } from "./db.mjs";
import * as db from "../src/lib/db.js";
import worker from "../src/index.js";
test("teléfonos normalizados, acceso global y contraseña existente preservada", async () => {
  assert.equal(normalizePhone("55 1234-5678"), "+525512345678");
  assert.equal(normalizePhone("+52 (55) 1234-5678"), "+525512345678");
  for (const x of ["abc", "123", "+0000000000", "5512345678 ext 4"])
    assert.throws(() => normalizePhone(x));
  const { sqlite, db: DB } = makeDB(),
    env = {
      DB,
      ADMIN_SIGNING_SECRET: "test-phone-key-more-than-32-characters",
    };
  try {
    for (const slug of ["uno", "dos"])
      await db.createTenant(env, {
        slug,
        name: slug,
        gateName: "Demo",
        triggerType: "demo",
        masterUsername: "owner",
        masterPhone: slug === "uno" ? "5512345678" : "+52 55 1234 5678",
        masterSecret: slug === "uno" ? "password-one" : "password-two",
      });
    assert.equal(sqlite.prepare("SELECT count(*) n FROM accounts").get().n, 1);
    assert.equal(
      sqlite.prepare("SELECT count(*) n FROM account_memberships").get().n,
      2,
    );
    const req = (path, body) =>
      worker.fetch(
        new Request("https://app.test" + path, {
          method: body ? "POST" : "GET",
          headers: { "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        env,
        {},
      );
    assert.equal((await req("/")).headers.get("location"), "/visit");
    assert.equal(
      (
        await req("/account/login", {
          phone: "5512345678",
          secret: "password-one",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await req("/account/login", {
          phone: "+525512345678",
          secret: "password-two",
        })
      ).status,
      403,
    );
  } finally {
    sqlite.close();
  }
});
