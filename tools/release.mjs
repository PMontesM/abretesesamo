import { resolve } from "node:path";
import { readdirSync } from "node:fs";
import { root, node, query, wrangler } from "./runtime.mjs";
node([resolve(root, "frontend/build.mjs")], { stdio: "inherit" });
node(
  [
    "--test",
    ...readdirSync(resolve(root, "tests"))
      .filter((f) => f.endsWith(".test.mjs"))
      .map((f) => resolve(root, "tests", f)),
  ],
  { stdio: "inherit" },
);
for (const f of [
  "unified-ui.mjs",
  "alpine-ui.mjs",
  "accounts-ui.mjs",
  "navigation-ui.mjs",
])
  node([resolve(root, "tests", f)], { stdio: "inherit" });
const done = new Set(
  query("SELECT name FROM schema_migrations").map((x) => x.name),
);
const pending = readdirSync(resolve(root, "database")).filter(
  (n) => /^migration_\d+_[a-z_]+\.sql$/.test(n) && !done.has(n),
);
if (pending.length)
  throw Error(
    "Migraciones pendientes: " +
      pending.join(", ") +
      ". Ejecuta npm run db:migrate primero.",
  );
node([resolve(root, "tools/backup.mjs")], { stdio: "inherit" });
console.log(wrangler(["deploy"]));
