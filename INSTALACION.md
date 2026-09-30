# Instalación

Para una instalación nueva con base vacía. Para actualizar la instancia existente, compilar, probar y desplegar sin ejecutar de nuevo el esquema ni los generadores de datos.

1. Clonar el repositorio privado y usar Node.js 24 o posterior.
2. Ejecutar `npm ci`, `npm run setup:frontend` y `npm run build`.
3. Autenticarse con `npx wrangler login`.
4. Crear una base D1 con `npx wrangler d1 create NOMBRE` y completar su identificador en `wrangler.toml`, manteniendo el binding `DB`.
5. Aplicar `database/schema.sql` una sola vez sobre la base vacía: `npx wrangler d1 execute NOMBRE --remote --file database/schema.sql`.
6. Generar el superadministrador: `node tools/crear-superadmin.mjs tu-correo@ejemplo.com`. Guardar la contraseña de forma privada y aplicar el SQL generado en `.private/` a la base.
7. Configurar el secreto `ADMIN_SIGNING_SECRET` y, para MQTT, `MQTT_ENCRYPTION_KEY` (32 bytes aleatorios en Base64). Conservar ambos fuera del repositorio.
8. Configurar Turnstile con los hostnames reales, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` y `TURNSTILE_REQUIRED`; consultar la documentación de seguridad del repositorio. No reutilizar claves de prueba en el sitio publicado.
9. Ejecutar `npm test` y `npm run test:ui`. Las pruebas de navegador admiten `BROWSER_PATH`, `PLAYWRIGHT_PATH` y `WORKER_BUNDLE`.
10. Revisar rutas, dominio, secretos y bindings y desplegar con `npx wrangler deploy`. No exponer una ruta alternativa sin las protecciones del dominio.
11. Entrar por `/login` y crear edificios y usuarios por correo. Visitantes entran por `/visit`.

MQTT se configura desde el panel de superadministración. El aprovisionamiento del broker y el firmware se documenta en [Relés MQTT](docs/RELES-MQTT.md). La Demo y su restablecimiento se describen en [Acceso único](docs/ACCESO-UNICO.md).

No subir `.private/`, contraseñas, archivos de secretos ni respaldos de D1 a GitHub. Conservar un respaldo antes de cualquier limpieza de datos.
