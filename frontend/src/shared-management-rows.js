import userMarkup from "../templates/components/user-row.html";
import codeMarkup from "../templates/components/code-list.html";

// Both rendering paths use the same trusted template; data is always textContent.
function cloneRow(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  const source =
    template.content.querySelector("article") ||
    template.content.querySelector("template").content.querySelector("article");
  const row = source.cloneNode(true);
  row.querySelectorAll("template").forEach((n) => n.remove());
  for (const node of [row, ...row.querySelectorAll("*")]) {
    for (const attr of [...node.attributes]) {
      if (/^(x-|@|:)/.test(attr.name)) node.removeAttribute(attr.name);
    }
  }
  row.setAttribute("x-ignore", "");
  return row;
}
function fill(row, selector, text) {
  row.querySelector(selector).textContent = text || "";
}
function attachActions(row, buttons, shareOutside) {
  const target = row.querySelector(".compact-actions");
  target.replaceChildren();
  const share = row.querySelector(".compact-share");
  share?.replaceChildren();
  for (const button of buttons) {
    button.classList.add("mini-action");
    (shareOutside && button.dataset.label === "Compartir"
      ? share
      : target
    ).append(button);
  }
  if (share && !share.children.length) share.remove();
}
export function managementUserRow(user, gates, buttons) {
  const row = cloneRow(userMarkup);
  fill(row, ".user-avatar", user.username.slice(0, 2).toUpperCase());
  fill(row, ".user-name", user.username);
  fill(row, ".user-phone", user.phone || "Sin teléfono asociado");
  row.querySelector(".user-role").hidden = user.role !== "master";
  row.querySelector(".user-no-gates").hidden = gates.length > 0;
  for (const gate of gates) {
    const label = document.createElement("span");
    label.className = "gate-label";
    label.textContent = gate.name;
    row.querySelector(".user-gates").append(label);
  }
  row.dataset.search = [user.username, user.phone || ""]
    .join(" ")
    .toLowerCase();
  row.dataset.gates = JSON.stringify(gates.map((g) => g.id));
  attachActions(row, buttons, false);
  return row;
}
export function managementCodeRow(code, values, buttons) {
  const row = cloneRow(codeMarkup);
  fill(row, ".compact-code", code.code);
  fill(row, ".compact-name", code.label);
  fill(row, ".gate-label", values[2]);
  fill(row, ".compact-meta > span:last-child", values[4]);
  fill(
    row,
    ".compact-expiry",
    code.expires_at ? "Vence " + values[5] : "Sin vencimiento",
  );
  const badge = row.querySelector(".state-label");
  const expiring =
    code.status === "active" &&
    code.expires_at > Date.now() &&
    code.expires_at - Date.now() <= 600000;
  badge.textContent = expiring ? "Por vencer" : values[6];
  badge.classList.add(
    ["pending", "uncertain"].includes(code.status) || expiring
      ? "state-warning"
      : values[6] === "Activo"
        ? "state-active"
        : "state-muted",
  );
  const paragraphs = row.querySelectorAll(".compact-detail > p");
  paragraphs[0].textContent = values[5];
  paragraphs[1].textContent = "Creado por " + (code.owner || "—");
  attachActions(row, buttons, true);
  return row;
}
