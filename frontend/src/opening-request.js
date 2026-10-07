// Called only by an explicit opening action. A lost response is reconciled with
// a read-only status request before deciding whether a new command is allowed.
export async function sendOpening({
  gateId,
  tenantId,
  storage,
  request,
  now = Date.now,
  uuid = () => crypto.randomUUID(),
}) {
  const key = "gate-order:" + tenantId + ":" + gateId;
  const raw = storage.getItem(key);
  let saved;
  if (raw) {
    try {
      saved = JSON.parse(raw);
    } catch {
      saved = { requestId: raw };
    }
    if (!saved || typeof saved.requestId !== "string") saved = null;
  }
  if (saved) {
    const previous = await request("/admin/open-gate/status", {
      gateId,
      ...saved,
    });
    if (previous.status === "sent") {
      storage.removeItem(key);
      return { ok: true, message: previous.message };
    }
    if (["pending", "uncertain"].includes(previous.status))
      throw Error(previous.message);
    if (!["closed", "unconfirmed", "missing"].includes(previous.status))
      throw Error(
        "No pudimos comprobar la orden anterior. Consulta el estado antes de abrir.",
      );
    if (previous.status !== "missing" || !previous.acceptsOriginal) {
      saved = null;
      storage.removeItem(key);
    }
  }
  if (!saved) saved = { requestId: uuid(), requestedAt: now() };
  storage.setItem(key, JSON.stringify(saved));
  try {
    const result = await request("/admin/open-gate", { gateId, ...saved });
    storage.removeItem(key);
    return result;
  } catch (error) {
    if (error.operationClosed) storage.removeItem(key);
    throw error;
  }
}
