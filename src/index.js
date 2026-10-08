import { Hono } from "hono";
import { accounts } from "./accounts.js";
import { tenants } from "./routes/tenants.js";
import { platform } from "./routes/platform.js";
import { configureHTTP } from "./middleware/http.js";
import { recoveryScope } from "./lib/access-recovery.js";
import { cleanup } from "./lib/db.js";
const app = new Hono({ strict: false });
configureHTTP(app);
app.route("/", accounts);
app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "Servidor web; no confirma estado físico del portón",
  }),
);
app.route("/platform", platform);
app.route("/t/:slug", tenants);
app.notFound((c) => c.json({ ok: false, error: "No encontrado" }, 404));
export default {
  fetch(request, env, ctx) {
    return app.fetch(request, recoveryScope(env), ctx);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanup(env));
  },
};
