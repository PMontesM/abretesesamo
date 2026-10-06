import { clientApp } from "./entry-runtime.js";
clientApp(JSON.parse(document.getElementById("app-config").textContent));
