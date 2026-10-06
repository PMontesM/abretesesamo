import { randomBytes, randomUUID, createHash } from "node:crypto";

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";

import { resolve } from "node:path";

import { root, query, config } from "./runtime.mjs";

import { normalizePhone } from "../src/lib/account-provision.js";

const phone = normalizePhone(process.argv[2]),
  quote = (s) => "'" + String(s).replaceAll("'", "''") + "'";

const account = query(
  "SELECT a.id FROM accounts a JOIN account_platform p ON p.account_id=a.id WHERE a.phone=" +
    quote(phone),
)[0];

if (!account)
  throw Error("No existe una cuenta de superadministración con ese teléfono.");

const token = randomBytes(32).toString("hex"),
  hash = createHash("sha256").update(token).digest("hex"),
  now = Date.now();

query(
  "DELETE FROM account_recovery WHERE account_id=" +
    quote(account.id) +
    "; INSERT INTO account_recovery VALUES(" +
    quote(hash) +
    "," +
    quote(account.id) +
    "," +
    (now + 900000) +
    "); INSERT INTO platform_audit_log(id,admin_username,action,details,at) VALUES(" +
    [
      quote(randomUUID()),
      quote("cloudflare-operator"),
      quote("issue_account_recovery"),
      quote(JSON.stringify({ accountId: account.id })),
      now,
    ].join(",") +
    ");",
);

const host = JSON.parse(readFileSync(config, "utf8")).vars.PUBLIC_HOSTNAME;

mkdirSync(resolve(root, ".private"), { recursive: true });

const output = resolve(root, ".private/recovery-" + now + ".txt");

writeFileSync(
  output,
  "Enlace privado, válido por 15 minutos y un solo uso:\nhttps://" +
    host +
    "/recover#" +
    token +
    "\n",
  { flag: "wx", mode: 0o600 },
);

console.log("Enlace guardado en " + output + ". No compartir públicamente.");
