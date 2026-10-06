// Regresiones: verifican los comportamientos corregidos de la auditoría.
import test from "node:test";
import assert from "node:assert/strict";
import { makeDB } from "./db.mjs";
import * as data from "../src/lib/db.js";
import worker from "../src/index.js";
import { hashSecret, verifySecret } from "../src/lib/security.js";
import { createSessionCookie } from "./session.mjs";
import * as operations from "../src/lib/operations.js";
import { readFileSync } from "node:fs";
async function setup() {
  const { sqlite, db } = makeDB(),
    env = {
      DB: db,
      ADMIN_SIGNING_SECRET: "audit-only-signing-key-32-characters-long",
    };
  const id = await data.createTenant(env, {
    slug: "audit",
    name: "Audit",
    gateName: "A",
    triggerUrl: "https://fake.invalid/old",
    masterUsername: "master",
    masterSecret: "audit-password",
  });
  const gate = (await data.listGates(env, id))[0],
    master = sqlite.prepare("SELECT * FROM users").get();
  const uid = await data.createUser(env, id, {
      username: "resident",
      secret: "audit-password",
      gateIds: [gate.id],
    }),
    user = sqlite.prepare("SELECT * FROM users WHERE id=?").get(uid);
  const cookie = (await createSessionCookie(env, master)).split(";")[0];
  const req = (path, body, auth = cookie) =>
    worker.fetch(
      new Request("https://audit.invalid" + path, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: auth,
          Origin: "https://audit.invalid",
        },
        ...(body
          ? {
              body: JSON.stringify(
                path.endsWith("/open-gate")
                  ? {
                      requestId: "11111111-1111-4111-8111-111111111111",
                      ...body,
                    }
                  : body,
              ),
            }
          : {}),
      }),
      env,
      {},
    );
  const code = () =>
    data.createCode(env, user, {
      gateId: gate.id,
      label: "Audit",
      days: 0,
      singleUse: false,
    });
  return { sqlite, env, id, gate, master, user, req, code };
}
test("A01: editar integración revoca los códigos anteriores", async () => {
  const s = await setup();
  try {
    const c = await s.code();
    await data.saveGate(s.env, s.id, {
      gateId: s.gate.id,
      name: "B",
      triggerUrl: "https://fake.invalid/new",
    });
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      return new Response("ok");
    };
    assert.equal(
      (await s.req("/t/audit/api/open", { code: c.code }, "")).status,
      403,
    );
    assert.deepEqual(calls, []);
  } finally {
    s.sqlite.close();
  }
});
test("A02: revocación durante pending permanece tras devolver permisos", async () => {
  const s = await setup();
  try {
    const c = await s.code(),
      row = await data.claimCode(s.env, s.id, c.code);
    await data.setPermissions(s.env, s.id, s.user.id, []);
    await data.finishCode(s.env, row, s.gate, "sent");
    assert.equal(
      s.sqlite.prepare("SELECT status FROM codes WHERE code=?").get(c.code)
        .status,
      "revoked",
    );
    await data.setPermissions(s.env, s.id, s.user.id, [s.gate.id]);
    assert.equal(await data.claimCode(s.env, s.id, c.code), null);
  } finally {
    s.sqlite.close();
  }
});
test("A02b: desactivar durante pending no restaura el código al reactivar", async () => {
  const s = await setup();
  try {
    const c = await s.code(),
      row = await data.claimCode(s.env, s.id, c.code);
    await data.saveGate(s.env, s.id, {
      gateId: s.gate.id,
      name: "A",
      triggerUrl: "https://fake.invalid/old",
      status: "inactive",
    });
    await data.finishCode(s.env, row, s.gate, "sent");
    await data.saveGate(s.env, s.id, {
      gateId: s.gate.id,
      name: "A",
      triggerUrl: "https://fake.invalid/old",
      status: "active",
    });
    assert.equal(await data.claimCode(s.env, s.id, c.code), null);
  } finally {
    s.sqlite.close();
  }
});
test("A03: fallo de persistencia posterior conserva reserva y no permite duplicar la orden", async () => {
  const s = await setup();
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("ok");
    };
    s.sqlite.exec(
      "CREATE TRIGGER fail_log BEFORE UPDATE ON logs BEGIN SELECT RAISE(FAIL,'audit injected failure'); END;",
    );
    const res = await s.req("/t/audit/admin/open-gate", { gateId: s.gate.id });
    assert.equal(res.status, 503);
    assert.equal(calls, 1);
    assert.equal(
      s.sqlite.prepare("SELECT outcome FROM logs").get().outcome,
      "pending",
    );
    assert.equal(
      (await s.req("/t/audit/admin/open-gate", { gateId: s.gate.id })).status,
      409,
    );
    assert.equal(calls, 1);
  } finally {
    s.sqlite.close();
  }
});
test("A04: búsqueda recupera código antiguo más allá de 1000 registros", async () => {
  const s = await setup();
  try {
    const c = await s.code();
    s.sqlite.prepare("UPDATE codes SET created_at=1 WHERE code=?").run(c.code);
    const insert = s.sqlite.prepare(
      "INSERT INTO codes(code,tenant_id,gate_id,owner_id,created_at,status) VALUES(?,?,?,?,?,'revoked')",
    );
    for (let i = 0; i < 1000; i++)
      insert.run("audit-" + i, s.id, s.gate.id, s.user.id, 100 + i);
    const list = await data.listCodes(s.env, s.id, s.user);
    assert.equal(list.length, 100);
    assert.ok(!list.some((x) => x.code === c.code));
    assert.equal(
      (await data.listCodes(s.env, s.id, s.user, { search: c.code }))[0].code,
      c.code,
    );
    assert.ok(await data.claimCode(s.env, s.id, c.code));
  } finally {
    s.sqlite.close();
  }
});
test("A05: fallo de auditoría revierte contraseña y versión de sesión", async () => {
  const s = await setup();
  try {
    const hash = await hashSecret("audit-password");
    s.sqlite
      .prepare(
        "INSERT INTO platform_admins(id,username,secret,created_at) VALUES(?,?,?,?)",
      )
      .run("pa", "pa", hash, 1);
    const auth = (
      await createSessionCookie(s.env, { id: "pa", session_version: 1 }, true)
    ).split(";")[0];
    s.sqlite.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON platform_audit_log BEGIN SELECT RAISE(FAIL,'audit injected failure'); END;",
    );
    const r = await s.req(
      "/account/password",
      {
        currentSecret: "audit-password",
        secret: "changed-password",
        confirmSecret: "changed-password",
      },
      auth,
    );
    assert.equal(r.status, 500);
    assert.ok(
      await verifySecret(
        "audit-password",
        s.sqlite.prepare("SELECT secret FROM platform_admins").get().secret,
      ),
    );
    assert.equal(
      (await s.req("/platform/api/tenants", undefined, auth)).status,
      200,
    );
  } finally {
    s.sqlite.close();
  }
});
test("A06: apertura conserva el ID original aunque se recree el usuario", async () => {
  const s = await setup();
  try {
    const auth = (await createSessionCookie(s.env, s.user)).split(";")[0];
    let replacement;
    globalThis.fetch = async () => {
      await data.deleteUser(s.env, s.id, s.user.id);
      replacement = await data.createUser(s.env, s.id, {
        username: s.user.username,
        secret: "audit-password",
        gateIds: [s.gate.id],
      });
      return new Response("ok");
    };
    assert.equal(
      (await s.req("/t/audit/admin/open-gate", { gateId: s.gate.id }, auth))
        .status,
      200,
    );
    assert.equal(
      s.sqlite.prepare("SELECT owner_id FROM logs").get().owner_id,
      s.user.id,
    );
  } finally {
    s.sqlite.close();
  }
});
test("A07: creación aplica límite de frecuencia por usuario", async () => {
  const s = await setup();
  try {
    for (let i = 0; i < 40; i++)
      assert.equal(
        (
          await s.req("/t/audit/admin/create-code", {
            gateId: s.gate.id,
            label: "Audit",
            days: 0,
            singleUse: false,
          })
        ).status,
        i < 30 ? 200 : 400,
      );
    assert.equal(
      s.sqlite.prepare("SELECT COUNT(*) AS n FROM login_attempts").get().n,
      1,
    );
  } finally {
    s.sqlite.close();
  }
});
test("A08: revocar desde edificio deja auditoría con actor", async () => {
  const s = await setup();
  try {
    const c = await s.code();
    assert.equal(
      (
        await s.req("/t/audit/admin/revoke-code", {
          codeRef: (await (await s.req("/t/audit/admin/codes")).json()).codes[0]
            .codeRef,
        })
      ).status,
      200,
    );
    assert.equal(
      s.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit_log").get().n,
      1,
    );
  } finally {
    s.sqlite.close();
  }
});
test("apertura directa no envía nada si falla la reserva y deduplica resultados confirmados", async () => {
  const s = await setup();
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("ok");
    };
    s.sqlite.exec(
      "CREATE TRIGGER fail_initial BEFORE INSERT ON logs BEGIN SELECT RAISE(FAIL,'injected'); END;",
    );
    assert.equal(
      (await s.req("/t/audit/admin/open-gate", { gateId: s.gate.id })).status,
      500,
    );
    assert.equal(calls, 0);
    assert.equal(
      s.sqlite.prepare("SELECT COUNT(*) AS n FROM direct_operations").get().n,
      0,
    );
    s.sqlite.exec("DROP TRIGGER fail_initial");
    assert.equal(
      (await s.req("/t/audit/admin/open-gate", { gateId: s.gate.id })).status,
      200,
    );
    assert.equal(
      (await s.req("/t/audit/admin/open-gate", { gateId: s.gate.id })).status,
      200,
    );
    assert.equal(calls, 1);
  } finally {
    s.sqlite.close();
  }
});
test("revisión directa bloquea IDs nuevos y cerrar revisión no envía órdenes", async () => {
  const s = await setup();
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw Error("injected");
    };
    assert.equal(
      (await s.req("/t/audit/admin/open-gate", { gateId: s.gate.id })).status,
      502,
    );
    assert.equal(
      (
        await s.req("/t/audit/admin/open-gate", {
          gateId: s.gate.id,
          requestId: crypto.randomUUID(),
        })
      ).status,
      400,
    );
    assert.equal(calls, 1);
    const pending = await operations.list(s.env, s.id);
    assert.equal(pending.length, 1);
    await operations.resolve(s.env, s.id, pending[0].id, {
      id: "pa",
      username: "pa",
    });
    assert.equal(calls, 1);
    const old = await s.req("/t/audit/admin/open-gate", { gateId: s.gate.id });
    assert.equal(old.status, 409);
    assert.equal((await old.json()).operationClosed, true);
  } finally {
    s.sqlite.close();
  }
});
test("cuota atómica evita superar 200 códigos vigentes ante solicitudes concurrentes", async () => {
  const s = await setup();
  try {
    const insert = s.sqlite.prepare(
      "INSERT INTO codes(code,tenant_id,gate_id,owner_id,created_at) VALUES(?,?,?,?,?)",
    );
    for (let i = 0; i < 199; i++)
      insert.run("quota-" + i, s.id, s.gate.id, s.user.id, i);
    const outcomes = await Promise.allSettled([s.code(), s.code()]);
    assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(
      s.sqlite.prepare("SELECT COUNT(*) AS n FROM codes").get().n,
      200,
    );
  } finally {
    s.sqlite.close();
  }
});
test("fallo de auditoría revierte también revocación desde el panel de edificio", async () => {
  const s = await setup();
  try {
    const c = await s.code();
    s.sqlite.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON platform_audit_log BEGIN SELECT RAISE(FAIL,'injected'); END;",
    );
    assert.equal(
      (
        await s.req("/t/audit/admin/revoke-code", {
          codeRef: (await (await s.req("/t/audit/admin/codes")).json()).codes[0]
            .codeRef,
        })
      ).status,
      500,
    );
    assert.equal(
      s.sqlite.prepare("SELECT status FROM codes WHERE code=?").get(c.code)
        .status,
      "active",
    );
  } finally {
    s.sqlite.close();
  }
});
test("cambiar solo nombre conserva acceso y migración aditiva puede repetirse", async () => {
  const s = await setup();
  try {
    const migration = readFileSync(
      new URL("../database/migration_004_audit.sql", import.meta.url),
      "utf8",
    );
    s.sqlite.exec(migration);
    s.sqlite.exec(migration);
    const c = await s.code();
    await data.saveGate(s.env, s.id, {
      gateId: s.gate.id,
      name: "Renombrado",
      triggerUrl: "https://fake.invalid/old",
    });
    assert.ok(await data.claimCode(s.env, s.id, c.code));
  } finally {
    s.sqlite.close();
  }
});

test("Una visita confirma antes de enviar, permite repetir sin extender y caduca a los 10 minutos", async () => {
  const s = await setup();
  try {
    const c = await data.createCode(s.env, s.user, {
      gateId: s.gate.id,
      label: "Visita",
      days: 1,
      singleUse: false,
      visit: true,
    });
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("ok");
    };
    const warning = await (
      await s.req("/t/audit/api/open", { code: c.code }, "")
    ).json();
    assert.equal(warning.confirmationRequired, true);
    assert.equal(calls, 0);
    const first = await (
      await s.req("/t/audit/api/open", { code: c.code, confirmVisit: true }, "")
    ).json();
    assert.equal(first.ok, true);
    assert.ok(first.visitExpiresAt > Date.now() + 590000);
    const second = await (
      await s.req("/t/audit/api/open", { code: c.code }, "")
    ).json();
    assert.equal(second.visitExpiresAt, first.visitExpiresAt);
    assert.equal(calls, 2);
    s.sqlite
      .prepare("UPDATE codes SET expires_at=? WHERE code=?")
      .run(Date.now() - 1, c.code);
    assert.equal(
      (await s.req("/t/audit/api/open", { code: c.code }, "")).status,
      403,
    );
    assert.equal(calls, 2);
  } finally {
    s.sqlite.close();
  }
});
test("Una visita incierta no inicia el plazo ni permite reintentar", async () => {
  const s = await setup();
  try {
    const c = await data.createCode(s.env, s.user, {
      gateId: s.gate.id,
      label: "Visita",
      days: 1,
      singleUse: false,
      visit: true,
    });
    globalThis.fetch = async () => {
      throw Error("offline");
    };
    assert.equal(
      (
        await s.req(
          "/t/audit/api/open",
          { code: c.code, confirmVisit: true },
          "",
        )
      ).status,
      502,
    );
    const row = s.sqlite
      .prepare("SELECT * FROM codes WHERE code=?")
      .get(c.code);
    assert.equal(row.visit_started_at, null);
    assert.equal(row.status, "uncertain");
    assert.equal(await data.claimCode(s.env, s.id, c.code), null);
  } finally {
    s.sqlite.close();
  }
});

test("Recuperar estado no abre el portón y respeta cancelación y permisos", async () => {
  const s = await setup();
  try {
    const c = await s.code();
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("ok");
    };
    let r = await (
      await s.req("/t/audit/api/access-state", { code: c.code }, "")
    ).json();
    assert.equal(r.state, "active");
    assert.equal(calls, 0);
    assert.equal(r.owner, undefined);
    await data.revokeCode(s.env, s.id, c.code, s.user);
    r = await (
      await s.req("/t/audit/api/access-state", { code: c.code }, "")
    ).json();
    assert.equal(r.state, "revoked");
    assert.equal(calls, 0);
  } finally {
    s.sqlite.close();
  }
});
test("Fecha exacta, filtro de vigentes y contacto de ayuda validado", async () => {
  const s = await setup();
  try {
    const expires = Date.now() + 3600000;
    const c = await data.createCode(s.env, s.user, {
      gateId: s.gate.id,
      label: "Fecha exacta",
      expiresAt: expires,
      visit: true,
      singleUse: false,
    });
    assert.equal(c.expires_at, expires);
    await assert.rejects(
      data.createCode(s.env, s.user, {
        gateId: s.gate.id,
        label: "Pasada",
        expiresAt: Date.now() - 1,
        visit: true,
        singleUse: false,
      }),
    );
    assert.equal(
      (await data.listCodes(s.env, s.id, s.user, { status: "current" })).length,
      1,
    );
    await data.revokeCode(s.env, s.id, c.code, s.user);
    assert.equal(
      (await data.listCodes(s.env, s.id, s.user, { status: "current" })).length,
      0,
    );
    assert.equal(
      (await data.listCodes(s.env, s.id, s.user, { status: "" })).length,
      1,
    );
    await assert.rejects(
      data.setSupport(s.env, s.id, "javascript:bad", s.master),
    );
    assert.equal(
      await data.setSupport(s.env, s.id, "+52 55 1234 5678", s.master),
      "525512345678",
    );
    const unauthorized = await s.req(
      "/t/audit/admin/support",
      { phone: "525512345678" },
      (await createSessionCookie(s.env, s.user)).split(";")[0],
    );
    assert.equal(unauthorized.status, 403);
  } finally {
    s.sqlite.close();
  }
});
