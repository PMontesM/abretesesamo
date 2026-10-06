import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { root, node, query, wrangler } from "./runtime.mjs";
const files = readdirSync(resolve(root, "database"))
  .filter((n) => /^migration_\d+_[a-z_]+\.sql$/.test(n))
  .sort();
if (process.argv.includes("--baseline-current")) {
  const phone = query("PRAGMA table_info(accounts)").some(
    (c) => c.name === "phone",
  );
  const inventory = query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='relay_devices'",
  ).length;
  const codes = query(
    "SELECT count(*) n FROM (SELECT code FROM codes GROUP BY code HAVING count(*)>1)",
  )[0].n;
  if (!phone || !inventory || codes)
    throw Error(
      "La base no corresponde a la instalación conocida con migración 012. No se marcará el historial.",
    );
  node([resolve(root, "tools/backup.mjs")], { stdio: "inherit" });
  query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)",
  );
  for (const name of files.filter((f) => Number(f.match(/_(\d+)_/)[1]) <= 12))
    query(
      "INSERT OR IGNORE INTO schema_migrations VALUES('" +
        name +
        "',unixepoch()*1000)",
    );
  console.log(
    "Historial inicializado hasta 012; no se alteraron datos de aplicación.",
  );
}
if (
  !query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
  ).length
)
  throw Error(
    "Falta historial de migraciones. Para esta instalación validada usar --baseline-current; para una instalación vacía seguir INSTALACION.md.",
  );
const done = new Set(
    query("SELECT name FROM schema_migrations").map((x) => x.name),
  ),
  pending = files.filter((n) => !done.has(n));
if (!pending.length) {
  console.log("No hay migraciones pendientes.");
  process.exit(0);
}
node([resolve(root, "tools/backup.mjs")], { stdio: "inherit" });
mkdirSync(resolve(root, ".private"), { recursive: true });
for (const name of pending) {
  const path = resolve(root, ".private/migration-pending.sql");
  try {
    writeFileSync(
      path,
      readFileSync(resolve(root, "database", name), "utf8") +
        "\nINSERT INTO schema_migrations VALUES('" +
        name +
        "',unixepoch()*1000);\n",
      { mode: 0o600 },
    );
    wrangler([
      "d1",
      "execute",
      "porton-saas-db-nueva",
      "--remote",
      "--file",
      path,
      "--yes",
    ]);
    console.log("Aplicada: " + name);
  } finally {
    unlinkSync(path);
  }
}
