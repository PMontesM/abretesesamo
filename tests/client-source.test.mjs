import test from "node:test";
import assert from "node:assert/strict";
import { page } from "../src/html/shared.js";
test("entrada publica sin scripts ejecutables en linea y configuracion segura", () => {
  const html = page("Ingresar", {
    mode: "account-login",
    label: "</script><script>alert(1)</script>",
  });
  assert.equal([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].length, 0);
  assert.match(
    html,
    /<script defer src="\/assets\/entry-[^"]+\.js"><\/script>/,
  );
  assert.equal(
    JSON.parse(html.match(/id="app-config">([\s\S]*?)<\/script>/)[1]).label,
    "</script><script>alert(1)</script>",
  );
});
