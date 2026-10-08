export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function buildingSlug(name) {
  return (
    String(name)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
      .replace(/-+$/g, "") || "edificio"
  );
}
export function required(value, label, max = 100) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new InputError(`${label} inválido`);
  return value.trim();
}

export function triggerConfig(url, method = "GET") {
  let parsed;
  try {
    parsed = new URL(required(url, "URL", 2048));
  } catch {
    throw new InputError("URL de activación inválida");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !["GET", "POST"].includes(method)
  )
    throw new InputError(
      "La activación requiere una URL HTTPS y método GET o POST",
    );
  return JSON.stringify({ url: parsed.href, method });
}
export async function hashSecret(secret) {
  if (typeof secret !== "string" || secret.length < 8 || secret.length > 128)
    throw new InputError("La contraseña debe tener entre 8 y 128 caracteres");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return derive(secret, salt);
}
const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
async function derive(secret, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$100000$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}
export async function verifySecret(secret, stored) {
  if (
    typeof secret !== "string" ||
    secret.length > 128 ||
    !/^pbkdf2\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(stored || "")
  )
    return false;
  const salt = Uint8Array.from(stored.split("$")[2].match(/../g), (s) =>
    parseInt(s, 16),
  );
  const actual = await derive(secret, salt);
  let diff = 0;
  for (let i = 0; i < actual.length; i++)
    diff |= actual.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}
export const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const scriptJSON = (value) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
export async function jsonBody(request) {
  if (Number(request.headers.get("Content-Length")) > 16384)
    throw new InputError("Solicitud demasiado grande");
  const raw = await request.text();
  if (raw.length > 16384) throw new InputError("Solicitud demasiado grande");
  try {
    const b = JSON.parse(raw);
    if (!b || Array.isArray(b) || typeof b !== "object") throw 0;
    return b;
  } catch {
    throw new InputError("Solicitud inválida");
  }
}

export function displayName(value) {
  const name = required(value, "Nombre", 100)
    .normalize("NFC")
    .replace(/\s+/g, " ");
  if (/[\u0000-\u001f\u007f]/.test(name))
    throw new InputError("Nombre inválido");
  return name;
}
