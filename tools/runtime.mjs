import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export const root = fileURLToPath(new URL("../", import.meta.url));
export const config = resolve(root, "wrangler.production.json");
export function node(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(
      "Comando fallido: " + args[0] + "\n" + (result.stderr || "").slice(-2500),
    );
  return result.stdout;
}
export const wrangler = (args) =>
  node([
    resolve(root, "node_modules/wrangler/bin/wrangler.js"),
    ...args,
    "--config",
    config,
  ]);
export function query(sql) {
  return JSON.parse(
    wrangler([
      "d1",
      "execute",
      "porton-saas-db-nueva",
      "--remote",
      "--command",
      sql,
      "--json",
    ]),
  ).flatMap((x) => x.results || []);
}
