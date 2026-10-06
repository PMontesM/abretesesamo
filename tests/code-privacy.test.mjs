import test from "node:test";
import assert from "node:assert/strict";
import {
  protectCodes,
  resolveCodeBody,
  maskCode,
} from "../src/lib/code-privacy.js";
const env = {
    ADMIN_SIGNING_SECRET: "test-only-signing-secret-12345678901234567890",
  },
  owner = { id: "resident", tenant_id: "building" },
  admin = { id: "admin", tenant_id: "building" },
  platform = { id: "platform" };
test("own codes remain complete; other codes and audit details are masked", async () => {
  const row = {
    tenant_id: "building",
    owner_id: "resident",
    code: "123456",
    creation_token: "hidden",
    claim_token: "hidden",
  };
  assert.equal((await protectCodes(env, row, owner)).code, "123456");
  for (const viewer of [admin, platform]) {
    const result = await protectCodes(
      env,
      {
        passes: [row],
        logs: [row],
        audit: [
          { details: JSON.stringify({ tenantId: "building", code: "123456" }) },
        ],
      },
      viewer,
    );
    assert.ok(!JSON.stringify(result).includes("123456"));
    assert.ok(!JSON.stringify(result).includes("hidden"));
    assert.equal(result.passes[0].code, "12••56");
    assert.equal(result.passes[0].codeMasked, true);
    assert.equal(
      (
        await resolveCodeBody(
          env,
          { codeRef: result.passes[0].codeRef },
          viewer,
          "building",
        )
      ).code,
      "123456",
    );
  }
  assert.equal(maskCode("001234"), "00••34");
});
test("management references cannot be tampered with or used for a different account or building", async () => {
  const a = await protectCodes(
      env,
      { tenant_id: "building", owner_id: "resident", code: "123456" },
      admin,
    ),
    b = await protectCodes(
      env,
      { tenant_id: "building", owner_id: "resident", code: "129956" },
      admin,
    );
  assert.equal(a.code, b.code);
  assert.notEqual(a.codeRef, b.codeRef);
  for (const [ref, user, tenant] of [
    [a.codeRef, platform, "building"],
    [a.codeRef, admin, "other"],
    ["tampered", admin, "building"],
  ])
    await assert.rejects(resolveCodeBody(env, { codeRef: ref }, user, tenant));
  await assert.rejects(
    resolveCodeBody(env, { code: "123456" }, platform, "building"),
  );
});

import { makeDB } from "./db.mjs";
import * as db from "../src/lib/db.js";
import { createSessionCookie } from "./session.mjs";
import worker from "../src/index.js";
test("HTTP panels, history and search hide foreign credentials; opaque revocation still works", async () => {
  const { sqlite, db: DB } = makeDB(),
    e = { ...env, DB };
  const tenant = await db.createTenant(e, {
    slug: "privacy",
    name: "Privacy",
    gateName: "Gate",
    triggerUrl: "https://device.test/one",
    masterUsername: "admin",
    masterSecret: "test-password",
  });
  const master = sqlite.prepare("SELECT * FROM users").get(),
    gate = sqlite.prepare("SELECT * FROM gates").get();
  await db.createUser(e, tenant, {
    username: "resident",
    secret: "test-password",
    gateIds: [gate.id],
  });
  const resident = sqlite
    .prepare("SELECT * FROM users WHERE role='user'")
    .get();
  const own = await db.createCode(e, master, {
      gateId: gate.id,
      label: "Own",
      days: 1,
      singleUse: false,
    }),
    foreign = await db.createCode(e, resident, {
      gateId: gate.id,
      label: "Foreign",
      days: 1,
      singleUse: false,
    });
  sqlite
    .prepare(
      "INSERT INTO logs(id,tenant_id,gate_id,code,owner_id,outcome,at) VALUES(?,?,?,?,?,?,?)",
    )
    .run("log", tenant, gate.id, foreign.code, resident.id, "sent", Date.now());
  const cookie = await createSessionCookie(e, master);
  const request = async (path, body) =>
    worker.fetch(
      new Request("https://app.test/t/privacy/admin/" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Cookie: cookie,
          Origin: "https://app.test",
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      e,
      {},
    );
  for (const path of ["panel", "codes", "passes", "logs"]) {
    const response = await request(path),
      text = await response.text();
    assert.equal(response.status, 200);
    assert.ok(!text.includes('"' + foreign.code + '"'));
    assert.ok(text.includes(maskCode(foreign.code)));
  }
  const codes = (await (await request("codes")).json()).codes;
  assert.equal(codes.find((c) => c.label === "Own").code, own.code);
  const hidden = codes.find((c) => c.label === "Foreign");
  assert.ok(hidden.codeRef);
  for (const key of ["query", "search"]) {
    const found = await db.listCodes(e, tenant, master, {
      [key]: foreign.code,
    });
    assert.equal(found.length, 0);
  }
  assert.equal(
    (await request("revoke-code", { code: foreign.code })).status,
    400,
  );
  assert.equal(
    (await request("revoke-code", { codeRef: hidden.codeRef })).status,
    200,
  );
  assert.equal(
    sqlite.prepare("SELECT status FROM codes WHERE code=?").get(foreign.code)
      .status,
    "revoked",
  );
  sqlite.close();
});
