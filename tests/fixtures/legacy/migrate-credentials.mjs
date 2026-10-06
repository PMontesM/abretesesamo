// Offline utility. Inputs contain existing credentials: store privately and remove after migration.
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { username } from "../../../src/lib/security.js";
const [usersFile, adminsFile, outputFile] = process.argv.slice(2);
if (!usersFile || !adminsFile || !outputFile)
  throw Error(
    "Uso: node tools/migrate-credentials.mjs usuarios.json administradores.json credenciales.sql",
  );
const quote = (v) => "'" + String(v).replace(/'/g, "''") + "'";
function read(path) {
  const value = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  if (Array.isArray(value) && value[0]?.results)
    return value.flatMap((r) => r.results);
  if (Array.isArray(value)) return value;
  throw Error("Se requiere JSON de wrangler d1 execute --json");
}
const sql = [
  "-- Aplicar durante mantenimiento, después de migration_003_access.sql.",
];
for (const [table, file] of [
  ["users", usersFile],
  ["platform_admins", adminsFile],
]) {
  const names = new Set();
  for (const row of read(file)) {
    if (
      !row.id ||
      typeof row.secret !== "string" ||
      !row.secret.length ||
      row.secret.length > 128
    )
      throw Error(
        "Credencial inválida en " + table + "; resolver antes de migrar",
      );
    const normalized = username(row.username);
    const key = (row.tenant_id || "platform") + ":" + normalized;
    if (names.has(key))
      throw Error("Usuarios duplicados al normalizar: " + normalized);
    names.add(key);
    const salt = randomBytes(16);
    const hash = /^pbkdf2\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(row.secret)
      ? row.secret
      : `pbkdf2$100000$${salt.toString("hex")}$${pbkdf2Sync(row.secret, salt, 100000, 32, "sha256").toString("hex")}`;
    // Conditional update prevents replacing credentials modified since the export.
    sql.push(
      `UPDATE ${table} SET username=${quote(normalized)},secret=${quote(hash)},session_version=session_version+1 WHERE id=${quote(row.id)} AND secret=${quote(row.secret)};`,
    );
  }
}
writeFileSync(outputFile, sql.join("\n") + "\n", { flag: "wx", mode: 0o600 });
console.log(
  "SQL generado. Contiene las credenciales anteriores en las condiciones; tratarlo como archivo privado.",
);
