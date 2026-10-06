import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { root } from "./runtime.mjs";
import { decryptBackup } from "./backup-crypto.mjs";
const [file, out] = process.argv.slice(2);
if (!file)
  throw Error("Uso: node tools/restore-check.mjs respaldo.psbk [salida.sql]");
const key =
  process.env.BACKUP_ENCRYPTION_KEY ||
  readFileSync(resolve(root, ".private/backup.key"), "utf8").trim();
const sql = decryptBackup(readFileSync(resolve(file)), key).toString("utf8");
const db = new DatabaseSync(":memory:");
try {
  db.exec(sql);
  const faults = db.prepare("PRAGMA foreign_key_check").all();
  if (faults.length) throw Error("Relaciones inválidas en el respaldo");
  console.log(
    "Restauración local verificada: " +
      db.prepare("SELECT count(*) n FROM accounts").get().n +
      " cuentas. No se modificó Cloudflare.",
  );
  if (out) {
    if (existsSync(out)) throw Error("La salida ya existe");
    writeFileSync(out, sql, { flag: "wx", mode: 0o600 });
    console.log("SQL privado guardado para restaurar en una base separada.");
  }
} finally {
  db.close();
}
