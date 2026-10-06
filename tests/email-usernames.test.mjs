import test from "node:test";
import assert from "node:assert/strict";
import { displayName } from "../src/lib/security.js";
test("nombre visible admite espacios y acentos sin convertirse en identificador de login", () => {
  assert.equal(displayName("  Ana López  "), "Ana López");
  assert.throws(() => displayName(""));
  assert.throws(() => displayName("x".repeat(101)));
});
