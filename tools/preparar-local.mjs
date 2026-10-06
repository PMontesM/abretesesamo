import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
writeFileSync(
  ".dev.vars",
  "ADMIN_SIGNING_SECRET=" + randomBytes(48).toString("base64url") + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Creado .dev.vars para desarrollo local. No modifica secretos de Cloudflare.",
);
