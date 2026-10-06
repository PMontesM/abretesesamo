import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
const magic = Buffer.from("PSBK1");
function key(value) {
  if (!/^[a-f0-9]{64}$/i.test(value || ""))
    throw Error("La clave de respaldo debe tener 64 caracteres hexadecimales.");
  return Buffer.from(value, "hex");
}
export function encryptBackup(data, value) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(value), iv);
  cipher.setAAD(magic);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), body]);
}
export function decryptBackup(data, value) {
  if (data.length < 33 || !data.subarray(0, 5).equals(magic))
    throw Error("Formato de respaldo incorrecto");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(value),
    data.subarray(5, 17),
  );
  cipher.setAAD(magic);
  cipher.setAuthTag(data.subarray(17, 33));
  return Buffer.concat([cipher.update(data.subarray(33)), cipher.final()]);
}
