import { renewSession } from "./session-renewal.js";
// All clients share response parsing; this helper never retries an opening command.
export async function requestJSON(path, body, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw Error(
      "Sin conexión. Consulta el estado antes de repetir una operación.",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error(
      response.status === 429
        ? "Demasiadas solicitudes. Espera un momento antes de intentar de nuevo."
        : "No se pudo confirmar la respuesta. Consulta el estado antes de repetir una operación.",
    );
  }
  if (!response.ok || !data.ok) {
    if (response.status === 401 && options.redirectOnUnauthorized)
      location.href = "/login";
    const error = Error(data.error || "No se pudo completar la operación.");
    error.operationClosed = data.operationClosed;
    error.status = response.status;
    throw error;
  }
  if (
    !path.includes("logout") &&
    !path.includes("password") &&
    !path.includes("phone") &&
    !path.includes("recover") &&
    document.body.hasAttribute("x-data")
  )
    void renewSession();
  return data;
}
