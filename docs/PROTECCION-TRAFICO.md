# Protección del tráfico

La implementación combina Turnstile, límites internos en D1 y una regla externa de Cloudflare. No requiere contratar un plan de pago. Tener el código en GitHub no activa por sí solo el widget ni la regla del dominio.

## Producción verificada el 21 de septiembre de 2026

Widget PortonSmart Managed creado para `porton.inomali.com`, secreto almacenado en el Worker y requisito activado. Publicación del Worker: `00a64421-fd08-44e8-b536-32b2c10df6e5`. Cloudflare confirmó `workers.dev` y previews desactivados. Regla `2f05ddb5c21e4f5cade81c828c80c665` activa: 30 solicitudes por IP cada 10 segundos, bloqueo de 10 segundos para todas las rutas de la zona. Se verificaron los formularios y los rechazos sin token en producción sin accionar hardware; las pruebas de interacción completas se hicieron con simulaciones. Falta la comprobación humana final del widget real al iniciar sesión.

## Activación

1. Crear un widget Turnstile llamado PortonSmart, modo Managed, autorizado para el hostname de producción. No habilitar pre-clearance: esta integración valida tokens mediante Siteverify.
2. Guardar la clave privada exclusivamente como secreto `TURNSTILE_SECRET_KEY` del Worker. Configurar las variables `TURNSTILE_SITE_KEY` (pública), `TURNSTILE_REQUIRED="true"` y `PUBLIC_HOSTNAME` (sin protocolo ni ruta).
3. Compilar interfaz y desplegar con el dominio personalizado configurado, `workers_dev=false` y `preview_urls=false`. No activar el requisito sin las dos claves correctas: la configuración incompleta rechaza el acceso.
4. En las reglas de seguridad del dominio crear una regla de rate limiting: nombre `PortonSmart - limite de solicitudes`, expresión `starts_with(http.request.uri.path, "/")`, característica IP, 30 solicitudes por 10 segundos, acción Block durante 10 segundos, estado Active.
5. Confirmar que la regla aparece activa en el listado. Un error al guardar NO demuestra que quedó publicada. Probar formularios con una persona y rechazos de solicitudes sin token; nunca probar aperturas contra hardware real de forma automática.

La regla propuesta cubre todas las rutas y subdominios de la zona, incluidos archivos estáticos. El plan Free solo admite determinados campos y una regla, con períodos de 10 segundos. Si se agregan otros proyectos al dominio o aumenta el tráfico legítimo compartiendo IP, revisar el umbral. No se excluye `/assets/` para evitar que rutas inexistentes bajo ese prefijo permitan eludir el límite.

## Comportamiento de la aplicación

- Turnstile protege `/platform/login`, `/t/:edificio/api/login`, `/t/:edificio/api/access-state` y `/t/:edificio/api/open`.
- El navegador obtiene un token nuevo para cada solicitud protegida. El backend valida éxito, hostname y acción (`login` o `visitor`) antes de consultar D1. Siteverify aplica caducidad y uso único.
- No hay reintentos automáticos de aperturas. Ante fallo del widget o de Siteverify, se muestra un mensaje y no se envía la orden.
- Los residentes autenticados conservan la apertura desde su panel sin Turnstile adicional. Siguen aplicándose permisos, sesiones, límites internos y protección de órdenes existentes.
- La política CSP permite únicamente el origen oficial `https://challenges.cloudflare.com` además de los recursos propios que ya usaba la aplicación.
- Los límites internos permanecen en D1. `RATE_LIMIT_KV` no se utiliza.

## Límites y verificación

El filtro externo reduce solicitudes que alcanzan el Worker; Turnstile evita operaciones protegidas sin comprobación válida. Ninguno garantiza impedir que un ataque distribuido agote las cuotas gratuitas. Los contadores externos pueden demorar en aplicarse y no constituyen un presupuesto global exacto. Los rechazos que se producen dentro del Worker consumen solicitudes; los límites internos también consumen operaciones D1.

Pruebas: `node --test tests/turnstile.test.mjs` y `node tests/turnstile-ui.mjs`, además de las pruebas generales. La prueba de interfaz usa simulaciones locales del widget, Siteverify y el dispositivo; no sustituye la comprobación final del widget real. Para pruebas locales con protección desactivada, omitir `TURNSTILE_REQUIRED` del entorno de pruebas; nunca hacerlo en producción para resolver un fallo de integración.

Referencias: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ y https://developers.cloudflare.com/waf/rate-limiting-rules/.
