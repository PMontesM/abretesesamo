import { requestJSON } from "./request.js";
export const config = JSON.parse(
  document.getElementById("app-config").textContent,
);
export const base =
  config.mode === "platform" ? "" : "/t/" + config.tenant.slug;
export const api = (path, body) =>
  requestJSON(base + path, body, { redirectOnUnauthorized: true });
export async function openGate(id) {
  const key = "gate-order:" + config.tenant.id + ":" + id;
  let requestId = sessionStorage.getItem(key);
  if (!requestId) {
    requestId = crypto.randomUUID();
    sessionStorage.setItem(key, requestId);
  }
  try {
    const d = await api("/admin/open-gate", { gateId: id, requestId });
    sessionStorage.removeItem(key);
    return d;
  } catch (error) {
    if (error.operationClosed) sessionStorage.removeItem(key);
    throw error;
  }
}
export function csvDownload(rows) {
  const cell = (v) =>
    '"' +
    String(/^\s*[=+@\-]/.test(String(v)) ? "'" + v : v).replaceAll('"', '""') +
    '"';
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "portonsmart-historial.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function infoDialog(title, text) {
  const d = document.createElement("dialog");
  d.className = "info-dialog";
  const h = document.createElement("h2"),
    p = document.createElement("p"),
    b = document.createElement("button");
  h.textContent = title;
  p.textContent = text;
  b.textContent = "Cerrar";
  b.onclick = () => d.close();
  d.append(h, p, b);
  d.addEventListener("close", () => d.remove(), { once: true });
  document.body.append(d);
  d.showModal();
}
export const date = (ms) =>
  ms ? new Date(ms).toLocaleString("es-MX") : "Sin vencimiento";
export const outcome = {
  sent: "Orden enviada",
  not_sent: "No enviada",
  uncertain: "Requiere revisión",
  pending: "En curso",
  closed: "Revisión cerrada",
};
