let last = 0,
  pending = false;
// Renew on actual foreground use, at most once per hour; no background polling.
export async function renewSession() {
  if (
    document.visibilityState === "hidden" ||
    pending ||
    Date.now() - last < 3600000
  )
    return;
  pending = true;
  try {
    const response = await fetch("/account/renew", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (response.ok) last = Date.now();
    else last = Date.now() - 3300000;
  } catch {
    last = Date.now() - 3300000;
  } finally {
    pending = false;
  }
}
