// Guardar en la carpeta del proyecto. Solo genera SQL; no conecta a Cloudflare.
import { randomBytes, randomUUID, pbkdf2Sync } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { normalizePhone } from "../src/lib/account-provision.js";
const name = normalizePhone(process.argv[2]);
const password = "Admin-" + randomBytes(16).toString("base64url"),
  salt = randomBytes(16);
const hash = `pbkdf2$100000$${salt.toString("hex")}$${pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex")}`;
const quote = (value) => "'" + String(value).replace(/'/g, "''") + "'";
const adminId = randomUUID(),
  accountId = randomUUID();
const sql = `-- Alta de superadministrador. Requiere database/schema.sql.\n-- No contiene la contraseña en texto plano ni reemplaza cuentas existentes.\nINSERT INTO platform_admins (id,username,secret,created_at,session_version)\nVALUES (${quote(adminId)},${quote(name)},${quote(hash)},unixepoch()*1000,1);\nINSERT INTO accounts(id,phone,secret,created_at) VALUES(${quote(accountId)},${quote(name)},${quote(hash)},unixepoch()*1000);\nINSERT INTO account_platform(account_id,admin_id) VALUES(${quote(accountId)},${quote(adminId)});\n`;
mkdirSync(".private", { recursive: true });
writeFileSync(".private/crear-superadmin.sql", sql, {
  flag: "wx",
  mode: 0o600,
});
console.log("SQL creado: .private/crear-superadmin.sql");
console.log("Teléfono: " + name);
console.log("Contraseña: " + password);
console.log(
  "Guarda la contraseña antes de cerrar esta ventana. La cuenta existirá después de importar el SQL.",
);
