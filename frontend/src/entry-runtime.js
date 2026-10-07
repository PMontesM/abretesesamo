import { requestJSON } from "./request.js";
// Shared browser UI. All database content uses textContent; each action captures its own building ID.
export function clientApp(config) {
  const $ = (id) => document.getElementById(id),
    view = $("view"),
    nav = $("nav"),
    notice = $("notice");
  const platform = config.mode === "platform",
    base = platform ? "/platform" : "/t/" + (config.tenant?.slug || "");
  let revision = 0;
  const codeFilters = new Map();
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  function feedback(target, text, error = false) {
    target.textContent = text;
    target.className = "message " + (error ? "error" : "success");
    target.setAttribute("role", error ? "alert" : "status");
    if (text) {
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }
  const message = (text, error = false) => feedback(notice, text, error);
  const date = (value) =>
    value ? new Date(value).toLocaleString() : "Sin vencimiento";
  const states = {
    active: "Activo",
    inactive: "Inactivo",
    suspended: "Suspendido",
    revoked: "Revocado",
    expired: "Vencido",
    pending: "En curso / revisión",
    uncertain: "Requiere revisión",
    used: "Utilizado",
    sent: "Orden enviada",
    not_sent: "No enviada",
    closed: "Revisión cerrada",
  };
  const status = (c) =>
    c.status === "active" && c.expires_at && c.expires_at <= Date.now()
      ? "Vencido"
      : states[c.status] || c.status;
  let securityScript,
    securityQueue = Promise.resolve();
  function loadSecurity() {
    if (window.turnstile) return Promise.resolve();
    if (securityScript) return securityScript;
    securityScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          script.remove();
          securityScript = null;
          reject(error);
        } else resolve();
      };
      const timer = setTimeout(
        () =>
          finish(
            Error(
              "No se pudo cargar la verificación. Revisa tu conexión e intenta de nuevo.",
            ),
          ),
        15000,
      );
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () =>
        finish(
          window.turnstile
            ? null
            : Error("La verificación no está disponible. Intenta de nuevo."),
        );
      script.onerror = () =>
        finish(
          Error(
            "No se pudo cargar la verificación. Revisa tu conexión e intenta de nuevo.",
          ),
        );
      document.head.append(script);
    });
    return securityScript;
  }
  function securityToken(action) {
    const task = securityQueue
      .catch(() => {})
      .then(async () => {
        if (!config.turnstileSiteKey)
          throw Error(
            "La verificación de seguridad no está disponible. Intenta más tarde.",
          );
        const card = el("div", undefined, "security-check"),
          label = el("p", "Verificando conexión segura…"),
          host = el("div");
        label.setAttribute("role", "status");
        card.append(label, host);
        view.prepend(card);
        let widget;
        try {
          await loadSecurity();
          return await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (error, token) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              error ? reject(error) : resolve(token);
            };
            const timer = setTimeout(
              () =>
                finish(
                  Error("La verificación tardó demasiado. Intenta de nuevo."),
                ),
              120000,
            );
            try {
              widget = window.turnstile.render(host, {
                sitekey: config.turnstileSiteKey,
                action,
                language: "es",
                theme: "light",
                size: "flexible",
                appearance: "interaction-only",
                retry: "never",
                callback: (token) => finish(null, token),
                "error-callback": () => {
                  finish(
                    Error(
                      "No pudimos verificar la conexión. Intenta de nuevo.",
                    ),
                  );
                  return true;
                },
                "expired-callback": () =>
                  finish(Error("La verificación venció. Intenta de nuevo.")),
                "timeout-callback": () =>
                  finish(Error("La verificación venció. Intenta de nuevo.")),
                "before-interactive-callback": () => {
                  label.textContent =
                    "Completa la verificación para continuar.";
                  card.scrollIntoView({ block: "center" });
                },
              });
            } catch {
              finish(
                Error("No se pudo iniciar la verificación. Intenta de nuevo."),
              );
            }
          });
        } finally {
          if (widget !== undefined) window.turnstile?.remove(widget);
          card.remove();
        }
      });
    securityQueue = task;
    return task;
  }
  async function api(path, body) {
    const action = path.endsWith("/login")
      ? "login"
      : path === "/api/visitor-entry" ||
          /\/api\/(access-state|open)$/.test(path)
        ? "visitor"
        : null;
    const token =
      config.turnstileRequired && body !== undefined && action
        ? await securityToken(action)
        : null;
    return requestJSON(path, body, {
      headers: token ? { "X-Turnstile-Token": token } : {},
    });
  }
  const iconPaths = {
    settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
    gate: "M3 21V4h18v17M3 7h18M7 7v14M12 7v14M17 7v14M2 21h20",
    codes: "M4 4h16v16H4zM8 8h8M8 12h5M8 16h7",
    history: "M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2",
    users:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    building: "M4 21V3h12v18M16 10h4v11M8 7h4M8 11h4M8 15h4M2 21h20",
    chart: "M4 20V4M4 20h17M9 16v-5M14 16V7M19 16v-8",
    logout: "M9 21H4V3h5M14 8l5 4-5 4M8 12h11",
    plus: "M12 5v14M5 12h14",
    refresh: "M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18a8 8 0 0 1-13-3",
  };
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", iconPaths[name] || iconPaths.gate);
    svg.append(path);
    return svg;
  }
  function gateBadge() {
    const d = el("div", undefined, "gate-badge"),
      svg = icon("gate");
    svg.replaceChildren();
    for (const [cls, path] of [
      ["gate-frame", "M2 21V3h20v18"],
      ["gate-left", "M4 6h8v14H4zM8 6v14"],
      ["gate-right", "M12 6h8v14h-8zM16 6v14"],
    ]) {
      const p = document.createElementNS(svg.namespaceURI, "path");
      p.setAttribute("class", cls);
      p.setAttribute("d", path);
      svg.append(p);
    }
    d.append(svg);
    return d;
  }
  function button(text, action, cls = "") {
    const b = el("button", text, cls);
    b.type = "button";
    b.dataset.label = text;
    const symbols = {
      Inicio: "chart",
      "Abrir portón": "gate",
      Portones: "gate",
      Códigos: "codes",
      Historial: "history",
      Usuarios: "users",
      Edificios: "building",
      Configuración: "settings",
      Reportes: "chart",
      Auditoría: "history",
      "Cerrar sesión": "logout",
      "Crear código": "plus",
      "Crear edificio": "plus",
      "Agregar usuario": "plus",
      "Agregar portón": "plus",
      Actualizar: "refresh",
    };
    if (symbols[text]) b.prepend(icon(symbols[text]));
    b.addEventListener("click", async () => {
      if (b.disabled) return;
      b.disabled = true;
      try {
        await action();
      } catch (e) {
        message(e.message, true);
      } finally {
        b.disabled = false;
      }
    });
    return b;
  }
  function section(title) {
    const s = el("section");
    s.append(el("h2", title));
    return s;
  }
  function table(parent, headers, rows) {
    const wrap = el("div", undefined, "scroll"),
      t = el(
        "table",
        undefined,
        headers.length >= 6
          ? "wide-table"
          : headers.length >= 4
            ? "medium-table"
            : "",
      ),
      head = el("thead"),
      tr = el("tr");
    headers.forEach((h) => tr.append(el("th", h)));
    head.append(tr);
    t.append(head);
    const body = el("tbody");
    if (!rows.length) {
      const row = el("tr"),
        cell = el("td", "No hay registros");
      cell.colSpan = headers.length;
      row.append(cell);
      body.append(row);
    }
    rows.forEach((values) => {
      const row = el("tr");
      values.forEach((v) => {
        const cell = el("td");
        cell.dataset.label = headers[row.children.length];
        if (
          typeof v === "string" &&
          [
            "Activo",
            "Orden enviada",
            "Inactivo",
            "Suspendido",
            "Revocado",
            "Vencido",
            "Requiere revisión",
            "En curso / revisión",
            "Utilizado",
          ].includes(v)
        ) {
          cell.append(
            el(
              "span",
              v,
              "status-pill " +
                (["Activo", "Orden enviada"].includes(v)
                  ? "good"
                  : ["Requiere revisión", "En curso / revisión"].includes(v)
                    ? "warn"
                    : [
                          "Inactivo",
                          "Suspendido",
                          "Revocado",
                          "Vencido",
                        ].includes(v)
                      ? "bad"
                      : ""),
            ),
          );
        } else
          cell.append(
            v instanceof Node ? v : document.createTextNode(String(v ?? "—")),
          );
        row.append(cell);
      });
      body.append(row);
    });
    t.append(body);
    wrap.append(t);
    parent.append(wrap);
  }
  function actions(...buttons) {
    const d = el("div", undefined, "actions");
    d.append(...buttons);
    return d;
  }
  function configureVisitorCode(code) {
    // Normalize pasted separators before validation; never truncate a digit.
    code.removeAttribute("maxlength");
    const normalize = () => { code.value = code.value.replace(/\s/g, ""); };
    normalize();
    code.addEventListener("input", normalize);
  }
  function input(form, label, type = "text", value = "", required = true) {
    const id = "f-" + crypto.randomUUID(),
      l = el("label", label);
    l.htmlFor = id;
    const n = el("input");
    n.id = id;
    n.type = type;
    n.value = value;
    n.required = required;
    if (type === "password") {
      n.autocomplete = "new-password";
      n.minLength = 8;
      n.maxLength = 128;
    } else n.maxLength = 2048;
    form.append(l, n);
    if (type === "password") {
      const toggle = button(
        "Mostrar contraseña",
        () => {
          const show = n.type === "password";
          n.type = show ? "text" : "password";
          toggle.textContent = show
            ? "Ocultar contraseña"
            : "Mostrar contraseña";
          toggle.setAttribute("aria-pressed", String(show));
        },
        "secondary password-toggle",
      );
      toggle.setAttribute("aria-pressed", "false");
      form.append(toggle);
    }
    return n;
  }
  function dialog(title, build, submit, label = "Guardar") {
    const d = el("dialog"),
      form = el("form"),
      error = el("div", undefined, "message error");
    error.setAttribute("role", "alert");
    form.append(el("h2", title));
    const fields = build(form);
    const save = el("button", label);
    save.type = "submit";
    form.append(
      error,
      actions(
        button("Cancelar", () => d.close(), "secondary"),
        save,
      ),
    );
    d.append(form);
    document.body.append(d);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      error.textContent = "";
      try {
        await submit(fields);
        d.close();
      } catch (e) {
        error.textContent = e.message;
      } finally {
        save.disabled = false;
      }
    });
    d.addEventListener("close", () => d.remove(), { once: true });
    d.showModal();
    return d;
  }
  async function screen(loader) {
    const rev = ++revision;
    view.replaceChildren(el("p", "Cargando…"));
    message("");
    try {
      const result = await loader();
      if (rev === revision) view.replaceChildren(result);
    } catch (e) {
      if (rev === revision) {
        view.replaceChildren();
        message(e.message, true);
      }
    }
  }
  function helpButton() {
    return button(
      "Necesito ayuda",
      () => {
        const d = dialog(
          "Ayuda para entrar",
          (f) => {
            f.append(
              el(
                "p",
                "Si tu acceso venció o fue cancelado, pide uno nuevo a quien te invitó.",
              ),
              el(
                "p",
                "Si no se confirmó el envío, no repitas la apertura. Contacta al administrador para revisar lo ocurrido.",
              ),
            );
            if (config.tenant?.supportPhone) {
              const link = el("a", "Contactar por WhatsApp", "button");
              link.href =
                "https://wa.me/" +
                config.tenant.supportPhone +
                "?text=" +
                encodeURIComponent(
                  "Hola, necesito ayuda para entrar a " +
                    config.tenant.name +
                    ".",
                );
              link.target = "_blank";
              link.rel = "noopener noreferrer";
              f.append(link);
            } else
              f.append(
                el(
                  "p",
                  "Contacta a quien te invitó o a la administración del edificio.",
                ),
              );
          },
          async () => {},
          "Entendido",
        );
      },
      "secondary",
    );
  }
  function accountView() {
    const link = (text, url) => {
      const a = el("a", text, "button secondary");
      a.href = url;
      return a;
    };
    const formSubmit = (form, submit, action) => {
      const local = el("div");
      local.setAttribute("role", "alert");
      form.append(submit, local);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          await action();
        } catch (err) {
          feedback(local, err.message, true);
        } finally {
          submit.disabled = false;
        }
      });
    };
    if (["account-login", "account-visitor"].includes(config.mode)) {
      const choices = el("div", undefined, "entry-choices");
      choices.setAttribute("aria-label", "Elige cómo entrar");
      for (const [label, url, mode] of [
        ["Tengo un código de visita", "/visit", "account-visitor"],
        ["Entrar con mi usuario", "/login", "account-login"],
      ]) {
        const choice = button(label, () => {
          location.href = url;
        });
        choice.setAttribute("aria-pressed", String(config.mode === mode));
        choices.append(choice);
      }
      view.append(choices);
    }
    if (config.mode === "account-visitor") {
      const box = section("Abrir con código de visita"),
        form = el("form"),
        code = input(form, "Código de seis dígitos");
      code.inputMode = "numeric";
      code.pattern = "[0-9]{6}";
      configureVisitorCode(code);
      code.autocomplete = "off";
      const submit = el("button", "Continuar");
      submit.type = "submit";
      formSubmit(form, submit, async () => {
        const value = code.value.trim(),
          d = await api("/api/visitor-entry", { code: value });
        try {
          sessionStorage.setItem("visitor-access:" + d.tenantId, value);
          location.href = d.redirect;
        } catch {
          location.href = d.redirect + "?code=" + encodeURIComponent(value);
        }
      });
      form.className = "visitor-form";
      box.append(
        el(
          "p",
          "Ingresa tu código para ver los accesos disponibles. No necesitas una cuenta.",
          "entry-subtitle",
        ),
        form,
      );
      view.append(box);
      return;
    }
    if (config.mode === "account-recover") {
      const token = location.hash.slice(1);
      history.replaceState(null, "", location.pathname);
      const box = section("Crear nueva contraseña"),
        form = el("form"),
        secret = input(form, "Nueva contraseña", "password"),
        confirm = input(form, "Repetir nueva contraseña", "password"),
        submit = el("button", "Guardar contraseña");
      submit.type = "submit";
      formSubmit(form, submit, async () => {
        await api("/account/recover", {
          token,
          secret: secret.value,
          confirmSecret: confirm.value,
        });
        form.replaceChildren(
          el("p", "Contraseña actualizada."),
          link("Iniciar sesión", "/login"),
        );
      });
      box.append(form);
      view.append(box);
      return;
    }
    if (config.mode === "account-login") {
      const box = section("Acceso de residentes y administradores"),
        form = el("form"),
        phone = input(form, "Teléfono", "tel"),
        password = input(form, "Contraseña", "password");
      phone.autocomplete = "tel";
      phone.placeholder = "+52 55 1234 5678";
      password.autocomplete = "current-password";
      password.minLength = 1;
      const submit = el("button", "Entrar");
      submit.type = "submit";
      formSubmit(form, submit, async () => {
        const d = await api("/account/login", {
          phone: phone.value,
          secret: password.value,
        });
        location.href = d.redirect;
      });
      box.append(
        el("p", "Una cuenta para todos tus edificios.", "muted"),
        form,
        button(
          "Olvidé mi contraseña",
          () =>
            dialog(
              "Recuperar acceso",
              (f) =>
                f.append(
                  el(
                    "p",
                    "Contacta a la administración de tu edificio. La plataforma verificará tu identidad y te entregará un enlace para crear una contraseña nueva. No compartas tu contraseña actual.",
                  ),
                ),
              async () => {},
              "Entendido",
            ),
          "secondary",
        ),
      );
      view.append(box);
      return;
    }
    if (config.mode === "account-settings") {
      const box = section("Mi cuenta");
      box.append(el("p", config.phone || "Teléfono pendiente"));
      view.append(box);
      api("/account/buildings")
        .then((d) => {
          const list = el("div", undefined, "actions");
          for (const b of d.buildings)
            list.append(
              link(
                b.name +
                  " · " +
                  (b.role === "master" ? "Administrador" : "Residente"),
                "/t/" + b.slug + "/admin",
              ),
            );
          if (d.platform)
            list.append(link("Superadministración", "/platform/admin"));
          if (!d.buildings.length && !d.platform)
            box.append(
              el(
                "p",
                "No tienes edificios activos. Contacta a tu administración.",
              ),
            );
          box.append(list);
        })
        .catch((e) => message(e.message, true));
      const pw = section("Cambiar mi contraseña"),
        form = el("form"),
        old = input(form, "Contraseña actual", "password"),
        next = input(form, "Nueva contraseña", "password"),
        confirm = input(form, "Repetir nueva contraseña", "password");
      next.minLength = 8;
      confirm.minLength = 8;
      const submit = el("button", "Guardar contraseña");
      submit.type = "submit";
      formSubmit(form, submit, async () => {
        await api("/account/password", {
          currentSecret: old.value,
          secret: next.value,
          confirmSecret: confirm.value,
        });
        location.href = "/login";
      });
      pw.append(form);
      view.append(pw);
      box.append(
        button(
          "Cerrar sesión",
          async () => {
            await api("/account/logout", {});
            location.href = "/login";
          },
          "secondary",
        ),
      );
    }
  }
  async function start() {
    if (config.mode.startsWith("account-")) {
      accountView();
      return;
    }
    if (config.mode === "public") {
      const params = new URLSearchParams(location.search),
        recoveryKey = "visitor-access:" + config.tenant.id;
      let saved = "";
      try {
        saved = sessionStorage.getItem(recoveryKey) || "";
      } catch {}
      const s = section("Abrir con código de visita"),
        f = el("form");
      s.append(
        el(
          "p",
          "Escribe tu código para enviar la orden al portón.",
          "entry-subtitle",
        ),
      );
      f.className = "visitor-form";
      const code = input(
        f,
        "Código de seis dígitos",
        "text",
        params.get("code") || saved,
      );
      code.inputMode = "numeric";
      code.pattern = "[0-9]{6}";
      configureVisitorCode(code);
      code.autocomplete = "off";
      const residentEntry = params.get("access") === "resident";
      if (residentEntry) {
        location.replace("/login");
        return;
      }
      history.replaceState(null, "", location.pathname);
      const submit = el("button");
      submit.type = "submit";
      submit.className = "visitor-open";
      const symbol = gateBadge(),
        buttonLabel = el("span", "Enviar orden de apertura");
      submit.append(symbol, buttonLabel);
      submit.setAttribute("aria-live", "polite");
      function paintOpen(state) {
        submit.dataset.state = state;
        buttonLabel.textContent =
          state === "sending"
            ? "Enviando orden…"
            : state === "confirmed"
              ? "Orden confirmada"
              : "Enviar orden de apertura";
        symbol.classList.toggle("gate-opening", state === "confirmed");
      }
      const result = el("div");
      result.setAttribute("role", "status");
      const gateChoices = el("fieldset", undefined, "visitor-gates");
      gateChoices.hidden = true;
      f.append(gateChoices, submit, result);
      let selectedGate = null,
        choicesCode = "",
        lookupTimer;
      let ticker,
        recoveryRevision = 0;
      function showGates(gates, entered) {
        const prior = choicesCode === entered ? selectedGate : null;
        choicesCode = entered;
        selectedGate = gates.some((g) => g.id === prior)
          ? prior
          : gates.length === 1
            ? gates[0].id
            : null;
        gateChoices.replaceChildren(el("legend", "Elige el portón"));
        gateChoices.hidden = gates.length < 2;
        if (gateChoices.hidden) return;
        for (const g of gates) {
          const label = el("label", undefined, "visitor-gate-choice"),
            radio = el("input");
          radio.type = "radio";
          radio.name = "visitor-gate";
          radio.value = g.id;
          radio.checked = selectedGate === g.id;
          radio.addEventListener("change", () => {
            selectedGate = g.id;
            paintOpen("idle");
          });
          label.append(radio, el("span", g.name));
          gateChoices.append(label);
        }
      }

      function remember() {
        try {
          sessionStorage.setItem(recoveryKey, code.value.trim());
        } catch {}
      }
      function countdown(data) {
        clearInterval(ticker);
        if (!data.visitExpiresAt) return;
        const remaining = el("p");
        result.append(remaining);
        const deadline =
          performance.now() + Math.max(0, data.visitExpiresAt - data.serverNow);
        const tick = () => {
          const secs = Math.max(
            0,
            Math.ceil((deadline - performance.now()) / 1000),
          );
          remaining.textContent = secs
            ? "Puedes volver a abrir durante " +
              Math.floor(secs / 60) +
              ":" +
              String(secs % 60).padStart(2, "0")
            : "Los 10 minutos terminaron. Solicita un nuevo código.";
          if (!secs || !remaining.isConnected) clearInterval(ticker);
        };
        ticker = setInterval(tick, 1000);
        tick();
      }
      async function recover() {
        if (!/^\d{6}$/.test(code.value.trim())) return;
        const revision = ++recoveryRevision;
        const data = await api(base + "/api/access-state", {
          code: code.value.trim(),
        });
        if (revision !== recoveryRevision) return;
        showGates(data.gates || [], code.value.trim());
        feedback(
          result,
          data.message +
            (data.lastSentAt
              ? " Último envío confirmado: " + date(data.lastSentAt) + "."
              : ""),
          data.state !== "active",
        );
        countdown(data);
      }
      const refresh = button(
        "Actualizar estado del acceso",
        recover,
        "secondary",
      );
      refresh.hidden = true;
      code.addEventListener("input", () => {
        recoveryRevision++;
        clearInterval(ticker);
        clearTimeout(lookupTimer);
        selectedGate = null;
        choicesCode = "";
        gateChoices.hidden = true;
        gateChoices.replaceChildren();
        paintOpen("idle");
        result.replaceChildren();
        refresh.hidden = true;
        if (/^\d{6}$/.test(code.value.trim()))
          lookupTimer = setTimeout(
            () => recover().catch((err) => feedback(result, err.message, true)),
            350,
          );
        try {
          sessionStorage.removeItem(recoveryKey);
        } catch {}
      });
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        submit.disabled = true;
        paintOpen("sending");
        recoveryRevision++;
        clearInterval(ticker);
        result.textContent = "";
        remember();
        try {
          const entered = code.value.trim();
          const gateId = choicesCode === entered ? selectedGate : null;
          let d = await api(base + "/api/open", {
            code: entered,
            ...(gateId ? { gateId } : {}),
          });
          if (d.selectionRequired) {
            showGates(d.gates, entered);
            feedback(
              result,
              "Elige el portón y después pulsa el botón de apertura.",
            );
            gateChoices.querySelector("input")?.focus();
            return;
          }
          if (d.confirmationRequired) {
            const accepted = await new Promise((resolve) => {
              const modal = dialog(
                "Una visita · 10 minutos",
                (f) => {
                  f.append(el("p", d.message));
                  return null;
                },
                async () => resolve(true),
                "Estoy frente al portón, abrir",
              );
              modal.addEventListener("close", () => resolve(false), {
                once: true,
              });
            });
            if (!accepted) return;
            d = await api(base + "/api/open", {
              code: entered,
              confirmVisit: true,
              gateId,
            });
          }
          result.className = "";
          result.replaceChildren();
          paintOpen("confirmed");
          submit.title = d.message;
          countdown(d);
          refresh.hidden = false;
        } catch (err) {
          feedback(result, err.message, true);
          refresh.hidden = false;
        } finally {
          submit.disabled = false;
          if (submit.dataset.state !== "confirmed") paintOpen("idle");
        }
      });
      s.append(f, refresh, helpButton());
      const choices = el("div", undefined, "entry-choices");
      choices.setAttribute("aria-label", "Elige cómo entrar");
      const visitor = button("Tengo un código de visita", () => {
          code.focus();
        }),
        resident = button("Entrar con mi usuario", () => {
          location.href = "/login";
        });
      visitor.setAttribute("aria-pressed", "true");
      resident.setAttribute("aria-pressed", "false");
      choices.append(visitor, resident);
      view.append(choices, s);
      if (code.value) {
        refresh.hidden = false;
        recover().catch((err) => feedback(result, err.message, true));
      }
      return;
    }
  }
  start().catch((e) => message(e.message, true));
}
