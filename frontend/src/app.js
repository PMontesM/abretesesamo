import { setupInstall } from "./install-app.js";
import { renewSession, logoutSession } from "./session-renewal.js";
import { profilePanel } from "./profile.js";
import { initNavigation, navigate, destroyNavigation } from "./navigation.js";
import { buildingPicker } from "./building-picker.js";
import { buildingAdmin } from "./admin-panel.js";
import { superApp } from "./super.js";
import Alpine from "@alpinejs/csp";
import focus from "@alpinejs/focus";
import { portonApp } from "./presentation.js";
import {
  api,
  base,
  config,
  openGate,
  csvDownload,
  infoDialog,
  date,
  outcome,
} from "./api.js";
const merge = (target, ...parts) => {
  for (const p of parts)
    Object.defineProperties(target, Object.getOwnPropertyDescriptors(p));
  return target;
};
const pass = (c) => ({
  id: c.codeRef || c.code,
  codeRef: c.codeRef,
  codeMasked: !!c.codeMasked,
  code: c.code,
  name: c.label,
  owner: c.owner,
  ownerId: c.owner_id,
  type:
    c.visit_mode || c.single_use
      ? "Un solo uso"
      : c.expires_at
        ? "Con vigencia"
        : "Permanente",
  icon: "fa-solid fa-key",
  access: c.access,
  createdAt: c.visit_started_at || c.created_at,
  expiresAt: c.expires_at,
  visit: !!c.visit_mode,
  single: !!c.single_use,
  started: c.visit_started_at,
  status: c.status,
});
const common = {
  dashboardUrl: base + "/admin",
  usersUrl: base + "/admin?section=residentes",
  tenant: config.tenant,
  user: config.user,
  error: "",
  loading: true,
  busy: false,
  now: Date.now(),
  get initials() {
    return this.user.username.slice(0, 2).toUpperCase();
  },
  get noticeCount() {
    return (
      this.alerts?.length ||
      this.livePasses?.filter((p) => this.expiring(p)).length ||
      0
    );
  },
  async run(fn) {
    try {
      return await fn();
    } catch (e) {
      this.error = e.message;
      return null;
    }
  },
  async logout() {
    await this.run(async () => {
      await logoutSession();
      location.href = "/login";
    });
  },
  profile() {
    this.goTo("profile");
  },
  goTo(id) {
    navigate(this, id);
  },
  support() {
    if (this.tenant.supportPhone)
      window.open(
        "https://wa.me/" + this.tenant.supportPhone,
        "_blank",
        "noopener",
      );
    else
      infoDialog(
        "Soporte",
        "Contacta a la administración del edificio para recibir ayuda con tus accesos.",
      );
  },
  notifications() {
    if (this.alerts?.length) {
      this.goTo("inicio");
    } else if (this.livePasses?.some((p) => this.expiring(p))) {
      this.selectTab("pases");
    } else
      infoDialog(
        "Notificaciones",
        "No hay avisos nuevos en los datos de tu última consulta.",
      );
  },
  async refresh() {
    if (this.busy) return;
    this.busy = true;
    await this.run(async () =>
      this.load(
        await api("/admin/panel?offset=" + new Date().getTimezoneOffset()),
      ),
    );
    this.busy = false;
    this.loading = false;
  },
  async init() {
    initNavigation(
      this,
      ["accesos", "pases", "actividad", "profile"],
      "accesos",
    );
    await this.refresh();
    this._clock = setInterval(() => {
      this.now = Date.now();
    }, 15000);
  },
  destroy() {
    destroyNavigation(this);
    clearInterval(this._clock);
    for (const d of this.doors || []) {
      cancelAnimationFrame(d._raf);
      clearInterval(d._iv);
    }
    clearTimeout(this._arm);
    clearTimeout(this._tt);
  },
  hourLabel(i) {
    return String(i).padStart(2, "0");
  },
  percent(p) {
    return Math.round(this.pct(p));
  },
  confirmRevoke(p) {
    this.arm("r" + p.id, () => this.revoke(p));
  },
  async revoke(p) {
    if (this.busy) return;
    this.busy = true;
    const done = await this.run(async () => {
      await api("/admin/codes/revoke", { code: p.code || p.id });
      return true;
    });
    this.busy = false;
    if (done) {
      await this.refresh();
      this.notify("Código revocado");
    }
  },
};
function resident() {
  return merge(portonApp(), common, {
    get passName() {
      return this.form.name;
    },
    set passName(v) {
      this.form.name = v;
    },
    get passMode() {
      return this.form.mode;
    },
    set passMode(v) {
      this.form.mode = v;
    },
    get passDoors() {
      return this.form.doors;
    },
    set passDoors(v) {
      this.form.doors = v;
    },
    get confirmName() {
      return this.confirmTarget?.name || "";
    },
    resultCard: null,
    confirmTarget: null,
    durationDays: "1",
    customDays: 1,
    activityQuery: "",
    activityGate: "",
    activityResult: "",
    doors: [],
    codes: [],
    activity: [],
    form: { name: "", mode: "visit", doors: [] },
    load(data) {
      this.now = data.serverNow;
      const old = new Map(this.doors.map((d) => [d.id, d]));
      this.doors = data.gates.map((g) => ({
        ...g,
        kind: g.isDemo
          ? "Demostración"
          : g.hasRelay
            ? "Relé conectado"
            : "Acceso autorizado",
        icon: "fa-solid fa-door-open",
        online: !(
          g.hasRelay &&
          g.connection_state === "offline" &&
          g.connection_checked_at > this.now - 120000
        ),
        state: "reposo",
        progress: 0,
        left: 0,
        hint: false,
        ...(old.has(g.id)
          ? {
              state: old.get(g.id).state,
              progress: old.get(g.id).progress,
              left: old.get(g.id).left,
            }
          : {}),
        last: data.logs.find((l) => l.gate_id === g.id && l.outcome === "sent")
          ?.at,
      }));
      this.codes = data.codes.map(pass);
      this.activity = data.logs.map((l) => ({
        gateId: l.gate_id,
        outcome: l.outcome,
        code: l.code || "",
        owner: l.owner || "",
        icon: l.code ? "fa-solid fa-key" : "fa-solid fa-mobile-screen",
        title:
          (outcome[l.outcome] || l.outcome) + " · " + (l.gate_name || "Acceso"),
        meta: l.label || l.owner || "Panel",
        ok: l.outcome === "sent",
        reason: l.outcome === "sent" ? "" : outcome[l.outcome],
        time: date(l.at),
      }));
    },
    showPassOwner: false,
    get displayedPasses() {
      return this.livePasses;
    },
    canShare(p) {
      return (
        !p.codeMasked &&
        p.status === "active" &&
        (!p.expiresAt || p.expiresAt > this.now)
      );
    },
    canRevoke(p) {
      return ["active", "pending", "uncertain"].includes(p.status);
    },
    get livePasses() {
      return this.codes.filter(
        (p) =>
          ["pending", "uncertain"].includes(p.status) ||
          (p.status === "active" && (!p.expiresAt || p.expiresAt > this.now)),
      );
    },
    accessLabel(p) {
      return p.access.map((a) => a.name).join(" y ");
    },
    expiring(p) {
      return (
        p.status === "active" && p.expiresAt && p.expiresAt - this.now <= 600000
      );
    },
    canExtend(p) {
      return this.expiring(p) && !p.visit && !p.single;
    },
    passStatus(p) {
      return p.status === "pending"
        ? "En curso"
        : p.status === "uncertain"
          ? "Requiere revisión"
          : this.expiring(p)
            ? "Por vencer"
            : "Activo";
    },
    pct(p) {
      return p.expiresAt
        ? Math.max(
            0,
            Math.min(
              100,
              (100 * (p.expiresAt - this.now)) /
                Math.max(1, p.expiresAt - p.createdAt),
            ),
          )
        : 100;
    },
    expiryText(p) {
      return !p.expiresAt
        ? "Sin vencimiento"
        : (p.visit && !p.started ? "Puede comenzar hasta " : "Vence ") +
            date(p.expiresAt);
    },
    leftText(p) {
      if (!p.expiresAt) return "sin límite de tiempo";
      const m = Math.max(0, Math.ceil((p.expiresAt - this.now) / 60000));
      return m >= 1440
        ? Math.ceil(m / 1440) + " días"
        : m < 60
          ? m + " min"
          : Math.floor(m / 60) + " h " + (m % 60) + " min";
    },
    statusLine(d) {
      return d.isDemo
        ? "Demostración · no activa hardware"
        : d.hasRelay
          ? d.connection_checked_at > this.now - 120000
            ? {
                online: "Conectado",
                offline: "Desconectado",
                cooldown: "En pausa",
                opening: "Relé activado",
                initializing: "Iniciando",
              }[d.connection_state] || "Sin verificar"
            : "Sin verificar"
          : "Acceso autorizado";
    },
    label(d) {
      return (
        {
          sosteniendo: "Sigue presionando…",
          abriendo: "Enviando orden…",
          abierto: "Orden confirmada",
          error: "No se confirmó. Consulta el aviso.",
        }[d.state] || "Mantén presionado para abrir"
      );
    },
    startHold(id) {
      const d = this.door(id);
      if (!d || !d.online || !["reposo", "error"].includes(d.state)) return;
      d.state = "sosteniendo";
      d.hint = false;
      const start = performance.now();
      const tick = () => {
        if (d.state !== "sosteniendo") return;
        d.progress = Math.min(100, (performance.now() - start) / 4);
        if (d.progress >= 100) {
          this.send(id);
          return;
        }
        d._raf = requestAnimationFrame(tick);
      };
      d._raf = requestAnimationFrame(tick);
    },
    async send(id) {
      const d = this.door(id);
      if (d.state === "abriendo" || d.state === "abierto") return;
      cancelAnimationFrame(d._raf);
      d.state = "abriendo";
      d.progress = 100;
      try {
        const result = await openGate(id);
        d.state = "abierto";
        this.live = result.message;
        setTimeout(() => {
          d.state = "reposo";
          d.progress = 0;
        }, 6500);
      } catch (e) {
        d.state = "error";
        d.progress = 0;
        this.error = e.message;
        this.live = e.message;
      }
    },
    confirmDoor(d) {
      this.confirmTarget = d;
    },
    confirmSend() {
      const d = this.confirmTarget;
      this.confirmTarget = null;
      if (d) this.send(d.id);
    },
    openSheet() {
      this.durationDays = "1";
      this.customDays = 1;
      this.form = {
        name: "",
        mode: "visit",
        doors: this.doors.length === 1 ? [this.doors[0].id] : [],
      };
      this.formError = "";
      this.sheet = true;
      this.$nextTick(() => this.$refs.name?.focus());
    },
    closePanels() {
      this.drawer = false;
      this.sheet = false;
      this.resultCard = null;
      this.confirmTarget = null;
    },
    selectTab(tab) {
      navigate(this, tab);
    },
    deadlineBody() {
      if (this.form.mode === "unlimited") return {};
      if (this.form.mode === "visit") return {};
      const days =
        this.durationDays === "custom"
          ? Number(this.customDays)
          : Number(this.durationDays);
      if (!Number.isInteger(days) || days < 1 || days > 30)
        throw Error("Elige de 1 a 30 días");
      return { days };
    },
    get visibleActivity() {
      const q = this.activityQuery.trim().toLowerCase();
      return this.activity.filter(
        (a) =>
          (this.filter !== "rechazados" || !a.ok) &&
          (!this.activityGate || a.gateId === this.activityGate) &&
          (!this.activityResult || a.outcome === this.activityResult) &&
          (!q ||
            (a.title + " " + a.meta + " " + a.code + " " + a.owner)
              .toLowerCase()
              .includes(q)),
      );
    },
    exportActivity() {
      csvDownload([
        ["Actividad", "Referencia", "Código", "Usuario", "Resultado", "Fecha"],
        ...this.visibleActivity.map((a) => [
          a.title,
          a.meta,
          a.code,
          a.owner,
          outcome[a.outcome] || a.outcome,
          a.time,
        ]),
      ]);
    },
    async createCode() {
      if (this.busy) return;
      this.formError = "";
      this.busy = true;
      try {
        const created = await api("/admin/codes", {
          label: this.form.name,
          mode: this.form.mode,
          gateIds: this.form.doors,
          ...this.deadlineBody(),
        });
        this.sheet = false;
        this.busy = false;
        await this.refresh();
        this.resultCard =
          this.codes.find((p) => p.code === created.code) || null;
      } catch (e) {
        this.formError = e.message;
        this.busy = false;
      }
    },
    async extend(p) {
      if (this.busy) return;
      this.busy = true;
      const ok = await this.run(async () => {
        await api("/admin/codes/extend", {
          code: p.code,
          expiresAt: p.expiresAt,
        });
        return true;
      });
      this.busy = false;
      if (ok) {
        await this.refresh();
        this.notify("Vigencia extendida 30 minutos");
      }
    },
    text(p) {
      return (
        "Acceso " +
        p.type.toLowerCase() +
        " a " +
        this.tenant.name +
        "\nPara: " +
        p.name +
        "\nAccesos: " +
        this.accessLabel(p) +
        "\nCódigo: " +
        p.code +
        "\n" +
        this.expiryText(p) +
        (p.visit
          ? "\nDesde el primer envío tendrás 10 minutos para volver a abrir, incluso si no llega la confirmación."
          : "") +
        "\n" +
        location.origin +
        base +
        "?code=" +
        encodeURIComponent(p.code)
      );
    },
    async copy(p) {
      await this.run(async () => {
        await navigator.clipboard.writeText(p.code);
        this.notify("Código copiado");
      });
    },
    share(p) {
      window.open(
        "https://wa.me/?text=" + encodeURIComponent(this.text(p)),
        "_blank",
        "noopener",
      );
    },
  });
}
function admin() {
  return buildingAdmin(resident, pass);
}
Alpine.plugin(focus);
Alpine.data("profilePanel", profilePanel);
Alpine.data("buildingPicker", buildingPicker);
Alpine.data("superadmin", superApp);
Alpine.data("resident", resident);
Alpine.data("admin", admin);
window.Alpine = Alpine;
Alpine.start();

setupInstall();
renewSession();
document.addEventListener("visibilitychange", renewSession);
