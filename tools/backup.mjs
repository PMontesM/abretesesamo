import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { root, wrangler } from "./runtime.mjs";
import { encryptBackup } from "./backup-crypto.mjs";
const privateDir = resolve(root, ".private");
mkdirSync(privateDir, { recursive: true });
const keyFile = resolve(privateDir, "backup.key");
let key = process.env.BACKUP_ENCRYPTION_KEY;
if (!key) {
  if (process.env.CI)
    throw Error("Falta BACKUP_ENCRYPTION_KEY en los secretos de CI");
  if (!existsSync(keyFile))
    writeFileSync(keyFile, randomBytes(32).toString("hex"), {
      flag: "wx",
      mode: 0o600,
    });
  key = readFileSync(keyFile, "utf8").trim();
}
const dir = resolve(privateDir, "backups");
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-"),
  sql = resolve(dir, stamp + ".sql"),
  output = resolve(dir, stamp + ".psbk");
try {
  wrangler([
    "d1",
    "export",
    "porton-saas-db-nueva",
    "--remote",
    "--output",
    sql,
  ]);
  const source = readFileSync(sql);
  if (!source.includes(Buffer.from("CREATE TABLE")))
    throw Error("Exportación vacía o inválida");
  writeFileSync(output, encryptBackup(source, key), {
    flag: "wx",
    mode: 0o600,
  });
  console.log("Respaldo cifrado: " + output);
} finally {
  if (existsSync(sql)) unlinkSync(sql);
}
