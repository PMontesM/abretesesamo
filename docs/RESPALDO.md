# Publicación y respaldo

El repositorio guarda código, firmware, esquema, migraciones y pruebas. La base de datos y los secretos no se suben al código de GitHub.

## Publicar esta instancia

La configuración real, sin contraseñas, está en `wrangler.production.json`. No depende de la carpeta de trabajo anterior. Requiere Node.js 24, `npm ci`, `npm run setup:frontend` y autenticación con `npx wrangler login`.

- `npm run db:migrate`: respalda y aplica solo migraciones pendientes, registradas en `schema_migrations`. Nunca repetir manualmente migraciones ya registradas.
- `npm run release` (también `npm run deploy`): compila, ejecuta pruebas del backend y navegador, comprueba las migraciones, respalda y publica. Cualquier fallo detiene la publicación.
- El navegador se instala con `npx playwright install chromium`; en Windows puede usarse `BROWSER_PATH` para Edge. `PLAYWRIGHT_PATH` permite un paquete de pruebas externo.

Para incorporar exclusivamente una instalación existente y verificada hasta la migración 012, usar una vez `npm run db:migrate -- --baseline-current`. Esta opción comprueba la estructura y códigos únicos, respalda, registra el historial hasta 012 y aplica las posteriores. No usar para adivinar el estado de una base desconocida. Una instalación nueva se describe en INSTALACION.md.

## Copias cifradas

`npm run backup` exporta D1 y guarda un archivo `.private/backups/*.psbk` cifrado con AES-256-GCM. El SQL temporal se elimina. La clave local se genera en `.private/backup.key` o se toma de `BACKUP_ENCRYPTION_KEY` (64 caracteres hexadecimales). Conservar esta clave fuera del equipo, en un gestor seguro: sin ella no se recupera el respaldo.

`node tools/restore-check.mjs RUTA.psbk` descifra en memoria, reconstruye una base SQLite local y comprueba relaciones. No toca Cloudflare. Con un segundo argumento genera un SQL privado para restaurar primero en una D1 separada. Antes de cambiar el dominio, verificar cuentas, permisos y códigos sin activar hardware real.

Los secretos `ADMIN_SIGNING_SECRET`, `MQTT_ENCRYPTION_KEY`, `TURNSTILE_SECRET_KEY` y `secrets.yaml` del firmware deben guardarse aparte. La clave MQTT original permite descifrar las credenciales almacenadas en D1. Las reglas del dominio y el widget Turnstile se configuran por separado.

## GitHub Actions

`checks.yml` ejecuta compilación, pruebas de backend y navegador en cada push y pull request. No publica automáticamente.

`backup.yml` prepara un respaldo cifrado diario a las 10:00 UTC, verifica que se pueda restaurar y lo conserva como artefacto privado durante siete días. Requiere dos secretos de Actions: `CLOUDFLARE_BACKUP_TOKEN` (token Cloudflare con permiso D1: Edit, limitado a la cuenta del proyecto) y `BACKUP_ENCRYPTION_KEY`. La programación no se considera operativa hasta configurar ambos y completar una ejecución manual satisfactoria. GitHub puede retrasar tareas programadas; revisar ejecuciones y avisos de fallo. Consumen cuotas del plan de GitHub y Cloudflare.

No subir SQL, claves ni archivos `.private` al repositorio. El respaldo diario complementa el respaldo previo a cada migración/publicación; no sustituye una prueba de restauración.

## Activación comprobada

El 6 de octubre de 2026 se configuraron ambos secretos y terminó correctamente la [ejecución de prueba](https://github.com/PMontesM/abretesesamo/actions/runs/37425525123): exportación, cifrado, restauración local de comprobación y almacenamiento del artefacto. La exportación fue rechazada con D1: Read y funcionó con D1: Edit, ampliación autorizada por el propietario. Este permiso también permite modificar bases D1 de la cuenta; el workflow solamente exporta.

Horario: diario a las 10:00 UTC (04:00 de Ciudad de México), con retención de siete días. GitHub puede retrasar la ejecución. Consultar Actions → Respaldo cifrado D1 para comprobar el último resultado y descargar la copia cifrada. La clave de recuperación debe conservarse aparte en un gestor seguro.
