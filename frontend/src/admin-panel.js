import { initNavigation, navigate, destroyNavigation } from "./navigation.js";

import { api, base, config, date } from "./api.js";

import { adminApp } from "./presentation.js";

const merge = (target, ...parts) => {
  for (const p of parts)
    Object.defineProperties(target, Object.getOwnPropertyDescriptors(p));
  return target;
};

export function buildingAdmin(resident, pass) {
  const account = resident(),
    baseLoad = account.load,
    baseClose = account.closePanels,
    basePassStatus = account.passStatus,
    charts = adminApp();

  delete charts.expiring;

  return merge(account, charts, {
    tab: "inicio",
    users: [],
    userQuery: "",
    codeQuery: "",
    codeOwner: "",
    codeGate: "",
    codeStatus: "current",
    codePage: 0,
    codeMore: false,
    codeBusy: false,
    listedPasses: [],
    codeRevision: 0,

    userModal: null,
    userForm: { username: "", secret: "", gateIds: [] },
    userError: "",
    welcome: null,
    actionConfirmation: null,
    confirmBusy: false,

    settingsOpen: false,
    supportPhone: config.tenant.supportPhone || "",
    settingsMessage: "",
    checking: null,
    alerts: [],
    dismissed: [],
    summary: {},

    get userPhone() {
      return this.userForm.phone || "";
    },
    set userPhone(v) {
      this.userForm.phone = v;
    },

    get userName() {
      return this.userForm.username;
    },
    set userName(v) {
      this.userForm.username = v;
    },

    get userPassword() {
      return this.userForm.secret;
    },
    set userPassword(v) {
      this.userForm.secret = v;
    },

    get userGates() {
      return this.userForm.gateIds;
    },
    set userGates(v) {
      this.userForm.gateIds = v;
    },

    cancelUser() {
      this.userModal = null;
      this.userForm.secret = "";
    },

    get residentCount() {
      return this.users.filter((u) => u.role !== "master").length;
    },

    get chartTicks() {
      return Array.from({ length: 5 }, (_, i) =>
        Math.round((i * this.chartMax) / 4),
      );
    },

    async init() {
      initNavigation(
        this,
        ["inicio", "residentes", "pases", "actividad", "accesos", "profile"],
        "inicio",
        {
          users: "residentes",
          codes: "pases",
          passes: "pases",
          logs: "actividad",
          gates: "accesos",
        },
      );
      await this.refresh();
      this._clock = setInterval(() => {
        this.now = Date.now();
      }, 15000);
    },

    load(data) {
      baseLoad.call(this, data);
      this.summary = data.summary;
      this.hoy = Array(24).fill(0);
      this.ayer = Array(24).fill(0);
      for (const h of data.hours)
        (h.day === "today" ? this.hoy : this.ayer)[h.hour] = h.count;
      this.chartMax = Math.max(4, ...this.hoy, ...this.ayer);

      this.doors = this.doors.map((g) => {
        const samples = data.observations.filter((o) => o.gate_id === g.id),
          latest = samples.at(-1),
          hour = Math.floor(this.now / 3600000) * 3600000;
        return {
          ...g,
          deviceId: g.deviceId || "",
          rssi: latest?.rssi ?? null,
          uptime:
            latest?.uptime_s != null
              ? Math.floor(latest.uptime_s / 3600) +
                " h " +
                (Math.floor(latest.uptime_s / 60) % 60) +
                " min"
              : "Sin datos",
          cells: Array.from({ length: 24 }, (_, i) => {
            const o = samples.find((s) => s.hour === hour - (23 - i) * 3600000);
            return !o
              ? "unknown"
              : o.state === "offline"
                ? "down"
                : ["online", "opening", "cooldown"].includes(o.state)
                  ? "ok"
                  : "unknown";
          }),
        };
      });

      this.alerts = this.doors
        .filter(
          (d) =>
            d.connection_checked_at > this.now - 120000 &&
            (d.connection_state === "offline" ||
              (d.rssi !== null && d.rssi <= -75)),
        )
        .map((d) => ({
          id: d.id + ":" + d.connection_checked_at,
          device: d.id,
          title: d.name,
          body:
            d.connection_state === "offline"
              ? "Sin conexión en la última consulta"
              : "Señal Wi-Fi débil en la última consulta",
        }))
        .filter((a) => !this.dismissed.includes(a.id));
    },

    async refresh() {
      if (this.busy) return;
      this.busy = true;
      await this.run(async () => {
        const [panel, people] = await Promise.all([
          api("/admin/panel?offset=" + new Date().getTimezoneOffset()),
          api("/admin/users"),
        ]);
        this.load(panel);
        this.users = people.users;
      });
      this.busy = false;
      this.loading = false;
      await this.loadCodePage();
    },

    goTo(id) {
      navigate(this, id);
    },

    openSettings() {
      this.settingsOpen = true;
      this.drawer = false;
    },

    closePanels() {
      baseClose.call(this);
      this.userModal = null;
      this.userForm.secret = "";
      this.welcome = null;
      this.actionConfirmation = null;
      this.settingsOpen = false;
    },

    get filteredUsers() {
      const q = this.userQuery.toLowerCase().trim();
      return this.users.filter((u) => u.username.toLowerCase().includes(q));
    },

    userAccess(u) {
      return (
        this.doors
          .filter((d) => u.role === "master" || u.gateIds.includes(d.id))
          .map((d) => d.name)
          .join(", ") || "Sin accesos asignados"
      );
    },

    editUser(kind, u = null) {
      this.userError = "";
      this.userModal = {
        kind,
        id: u?.id || "",
        title:
          kind === "create"
            ? "Nuevo residente"
            : kind === "permissions"
              ? "Accesos de " + u.username
              : "Contraseña de " + u.username,
      };
      this.userForm = {
        username: u?.username || "",
        secret: "",
        gateIds: u?.gateIds ? [...u.gateIds] : [],
      };
    },

    async saveUser() {
      if (this.busy) return;
      this.busy = true;
      this.userError = "";
      const modal = this.userModal,
        form = { ...this.userForm, gateIds: [...this.userForm.gateIds] };
      try {
        if (modal.kind === "create")
          await api("/admin/create-user", {
            username: form.username,
            phone: form.phone,
            secret: form.secret,
            gateIds: form.gateIds,
          });
        else if (modal.kind === "permissions")
          await api("/admin/users/permissions", {
            userId: modal.id,
            gateIds: form.gateIds,
          });
        else throw Error("Acción no disponible.");

        this.userModal = null;
        this.userForm.secret = "";
        this.busy = false;

        await this.refresh();
        if (modal.kind === "create")
          this.showWelcome(
            {
              username: form.username,
              phone: form.phone,
              role: "user",
              gateIds: form.gateIds,
            },
            form.secret,
          );
        else
          this.notify(
            modal.kind === "permissions"
              ? "Accesos actualizados"
              : "Contraseña actualizada; sesiones anteriores cerradas",
          );
      } catch (e) {
        this.userError = e.message;
        this.busy = false;
      }
    },

    showWelcome(u, password = "") {
      const gates = this.userAccess(u);
      this.welcome = {
        title: password
          ? "Usuario creado"
          : "Compartir acceso de " + u.username,
        text:
          "¡Bienvenido a " +
          this.tenant.name +
          "!\n\nEntra en " +
          location.origin +
          "/login\nTeléfono: " +
          (u.phone || u.username) +
          (password
            ? "\nContraseña inicial (solo para cuentas nuevas): " + password
            : "\nUsa la contraseña de tu cuenta.") +
          "\n\nPuedes abrir tus accesos autorizados (" +
          gates +
          "), crear códigos para visitas y consultar tu historial. Si ya tienes cuenta, conserva tu contraseña y elige este edificio en tu panel. Guarda este mensaje en privado.",
      };
    },

    get welcomeLink() {
      return (
        "https://wa.me/?text=" + encodeURIComponent(this.welcome?.text || "")
      );
    },

    get modalTitle() {
      return this.userModal?.title || "";
    },
    get modalKind() {
      return this.userModal?.kind || "";
    },

    confirmDelete(u) {
      this.actionConfirmation = {
        kind: "user",
        id: u.id,
        title: "Eliminar residente",
        message:
          "¿Eliminar a " +
          u.username +
          "? Se cerrarán sus sesiones y se revocarán sus códigos activos.",
      };
    },

    confirmRevoke(p) {
      this.actionConfirmation = {
        kind: "pass",
        code: p.code,
        codeRef: p.codeRef,
        title: "Revocar código",
        message:
          "¿Revocar el código " +
          p.code +
          " de " +
          p.name +
          "? Dejará de permitir el acceso.",
      };
    },

    get confirmTitle() {
      return this.actionConfirmation?.title || "";
    },
    get confirmMessage() {
      return this.actionConfirmation?.message || "";
    },

    async confirmAction() {
      if (this.confirmBusy) return;
      this.confirmBusy = true;
      const a = this.actionConfirmation;
      const done = await this.run(async () => {
        await api(
          a.kind === "user" ? "/admin/delete-user" : "/admin/revoke-code",
          a.kind === "user"
            ? { userId: a.id }
            : { code: a.code, codeRef: a.codeRef },
        );
        return true;
      });
      this.confirmBusy = false;
      if (done) {
        this.actionConfirmation = null;
        await this.refresh();
        this.notify("Cambio guardado");
      }
    },

    async loadCodePage(more = false) {
      const revision = ++this.codeRevision;
      this.codeBusy = true;
      const page = more ? this.codePage + 1 : 0;
      await this.run(async () => {
        const q = new URLSearchParams({
          status: this.codeStatus,
          query: this.codeQuery,
          ownerId: this.codeOwner,
          gateId: this.codeGate,
          page: String(page),
        });
        const result = await api("/admin/passes?" + q);
        if (revision !== this.codeRevision) return;
        const items = result.passes.map(pass);
        this.listedPasses = more ? [...this.listedPasses, ...items] : items;
        this.codePage = page;
        this.codeMore = items.length === 100;
      });
      if (revision === this.codeRevision) this.codeBusy = false;
    },

    passStatus(p) {
      return (
        {
          revoked: "Revocado",
          used: "Utilizado",
          expired: "Vencido",
          pending: "En curso",
          uncertain: "Requiere revisión",
        }[p.status] ||
        (p.expiresAt && p.expiresAt <= this.now
          ? "Vencido"
          : basePassStatus.call(this, p))
      );
    },

    canShare(p) {
      return (
        !p.codeMasked &&
        p.status === "active" &&
        (!p.expiresAt || p.expiresAt > this.now)
      );
    },

    canExtend(p) {
      return (
        this.canShare(p) &&
        this.expiring(p) &&
        !p.visit &&
        !p.single &&
        p.expiresAt + 1800000 <= p.createdAt + 604800000
      );
    },

    canRevoke(p) {
      return ["active", "pending", "uncertain"].includes(p.status);
    },

    async check(d) {
      if (this.checking) return;
      this.checking = d.id;
      await this.run(() => api("/admin/connection", { gateId: d.id }));
      this.checking = null;
      await this.refresh();
    },

    checkedText(d) {
      return d.connection_checked_at
        ? date(d.connection_checked_at)
        : "Sin consultar";
    },

    cellClass(s) {
      return {
        ok: "bg-emerald-500",
        down: "bg-red-500",
        unknown: "bg-gray-200",
      }[s];
    },

    dismiss(id) {
      this.dismissed.push(id);
      this.alerts = this.alerts.filter((a) => a.id !== id);
    },

    focusDevice(id) {
      this.activityGate = id;
      this.activityQuery = "";
      this.activityResult = "";
      this.filter = "todo";
      this.goTo("actividad");
    },

    showRejected() {
      this.activityResult = "uncertain";
      this.filter = "todo";
      this.goTo("actividad");
    },

    async saveSettings() {
      if (this.busy) return;
      this.busy = true;
      this.settingsMessage = "";
      await this.run(async () => {
        const d = await api("/admin/support", { phone: this.supportPhone });
        this.supportPhone = d.phone;
        this.tenant.supportPhone = d.phone;
        this.settingsMessage = "Contacto de ayuda guardado";
      });
      this.busy = false;
    },
  });
}
