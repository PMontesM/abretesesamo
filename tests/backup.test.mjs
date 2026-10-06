import test from "node:test";
import assert from "node:assert/strict";
import { encryptBackup, decryptBackup } from "../tools/backup-crypto.mjs";
test("respaldo cifrado verifica integridad y rechaza clave incorrecta", () => {
  const key = "11".repeat(32),
    plain = Buffer.from("CREATE TABLE accounts(id TEXT);"),
    encrypted = encryptBackup(plain, key);
  assert.ok(!encrypted.includes(plain));
  assert.deepEqual(decryptBackup(encrypted, key), plain);
  assert.throws(() => decryptBackup(encrypted, "22".repeat(32)));
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => decryptBackup(encrypted, key));
});
