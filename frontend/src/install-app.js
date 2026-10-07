let promptEvent;
const standalone = () =>
  matchMedia("(display-mode: standalone)").matches ||
  navigator.standalone === true;
const ios = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// Temporary test behavior: dismiss only until the next page load.
let banner;
let dismissedThisVisit = false;
function later() {
  dismissedThisVisit = true;
  banner?.remove();
  banner = null;
}
function showBanner() {
  if (standalone() || dismissedThisVisit || banner || (!promptEvent && !ios()))
    return;
  banner = document.createElement("aside");
  banner.className = "install-banner";
  banner.setAttribute("aria-label", "Instalar PortonSmart");
  const text = document.createElement("span");
  text.textContent = "Agrega PortonSmart a tu celular";
  const install = document.createElement("button");
  install.textContent = "Instalar";
  install.onclick = installApp;
  const defer = document.createElement("button");
  defer.textContent = "Ahora no";
  defer.onclick = later;
  banner.append(text, install, defer);
  document.body.append(banner);
}
export async function installApp() {
  if (standalone()) return;
  if (promptEvent) {
    const event = promptEvent;
    promptEvent = null;
    await event.prompt();
    const result = await event.userChoice;
    if (result.outcome === "accepted") banner?.remove();
    else later();
    return;
  }
  const dialog = document.createElement("dialog");
  dialog.className = "install-dialog";
  const title = document.createElement("h2");
  title.textContent = "Instalar PortonSmart";
  const p = document.createElement("p");
  p.textContent = ios()
    ? "En Safari, toca Compartir y después Agregar a inicio. Abre PortonSmart desde el nuevo icono. Si te pide iniciar sesión la primera vez, hazlo desde ahí."
    : "Abre el menú de tu navegador y busca Instalar aplicación o Agregar a pantalla de inicio. Si no aparece, abre este sitio en Chrome o Safari.";
  const close = document.createElement("button");
  close.textContent = "Entendido";
  close.onclick = () => dialog.close();
  dialog.addEventListener("close", () => dialog.remove());
  dialog.append(title, p, close);
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}
export function setupInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    promptEvent = e;
    showBanner();
  });
  window.addEventListener("appinstalled", () => {
    promptEvent = null;
    banner?.remove();
    banner = null;
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-install-app]")) installApp();
  });
  showBanner();
}
