import { cpSync } from "node:fs";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, relative } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url),
  postcss = require("postcss"),
  tailwind = require("tailwindcss");
const root = fileURLToPath(new URL(".", import.meta.url));
process.chdir(root);
mkdirSync("dist/assets", { recursive: true });
const css = await postcss([tailwind(require("./tailwind.config.cjs"))]).process(
  readFileSync("src/styles.css", "utf8"),
  { from: resolve("src/styles.css") },
);
writeFileSync("src/compiled.css", css.css);
const output = await build({
  absWorkingDir: root,
  entryPoints: {
    app: "src/app.js",
    style: "src/compiled.css",
    entry: "src/entry.js",
    entryStyle: "src/entry.css",
  },
  bundle: true,
  minify: true,
  metafile: true,
  outdir: "dist/assets",
  entryNames: "[name]-[hash]",
  assetNames: "[name]-[hash]",
  loader: {
    ".html": "text",
    ".woff2": "file",
    ".woff": "file",
    ".ttf": "file",
  },
  target: "es2022",
});
const fresh = new Set(
  Object.keys(output.metafile.outputs).map((p) => p.split("/").pop()),
);
for (const name of readdirSync("dist/assets"))
  if (!fresh.has(name)) unlinkSync(resolve("dist/assets", name));
const assets = {};
for (const [path, data] of Object.entries(output.metafile.outputs))
  if (data.entryPoint)
    assets[
      data.entryPoint.endsWith("app.js")
        ? "app"
        : data.entryPoint.endsWith("entry.js")
          ? "entry"
          : data.entryPoint.endsWith("entry.css")
            ? "entryStyle"
            : "style"
    ] = "/assets/" + path.split("/").pop();
const templates = Object.fromEntries(
  ["admin", "resident", "super"].map((name) => [
    name,
    readFileSync("templates/" + name + ".html", "utf8")
      .replace(
        "<!-- SIDEBAR_LOGOUT -->",
        readFileSync("templates/components/sidebar-logout.html", "utf8"),
      )
      .replace(
        "<!-- USER_ROW -->",
        readFileSync("templates/components/user-row.html", "utf8"),
      )
      .replace(
        "<!-- PROFILE -->",
        readFileSync("templates/profile.html", "utf8"),
      )
      .replace(
        "<!-- CODE_LIST -->",
        readFileSync("templates/components/code-list.html", "utf8"),
      ),
  ]),
);
writeFileSync(
  "../src/html/templates.js",
  "// Generated from frontend/templates.\nexport const templates=" +
    JSON.stringify(templates) +
    ";\nexport const assets=" +
    JSON.stringify(assets) +
    ";\n",
);
writeFileSync(
  "dist/_headers",
  "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n  X-Content-Type-Options: nosniff\n",
);
console.log(
  "Frontend compilado: " +
    Object.keys(output.metafile.outputs).length +
    " archivos estáticos.",
);

cpSync("public", "dist", { recursive: true });
