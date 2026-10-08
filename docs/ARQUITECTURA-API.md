# API y rutas Hono

El Worker registra cada ruta y método HTTP directamente en Hono. Los paneles conservan sus URL y contratos JSON; no hay un despachador paralelo basado en condiciones sobre la dirección.

## Organización

| Módulo | Responsabilidad |
| --- | --- |
| src/index.js | Componer routers, preparar la recuperación por petición y ejecutar el mantenimiento programado. |
| src/accounts.js | Entrada pública, login por teléfono, perfil, renovación, recuperación y cierre de sesión. |
| src/routes/tenants.js | Cargar el edificio y montar rutas públicas y autenticadas. |
| src/routes/visitors.js | Estado y apertura con código, selección de portón y confirmación de visita. |
| src/routes/panel.js | Panel, accesos, historial, contacto y consulta de conexión. |
| src/routes/openings.js | Apertura autenticada y consulta de su resultado, con deduplicación. |
| src/routes/codes.js | Crear, consultar, ampliar y revocar códigos con uno o varios accesos. |
| src/routes/users.js | Gestión de usuarios y permisos del edificio, exclusiva de administración. |
| src/routes/platform.js | Exigir sesión de superadministración y montar sus módulos. |
| src/routes/platform-configuration.js | Configuración MQTT, inventario y revisión de relés. |
| src/routes/platform-buildings.js | Edificios, portones y contacto de ayuda. |
| src/routes/platform-management.js | Usuarios, recuperación, códigos, reportes, auditoría y operaciones. |
| src/middleware/http.js | Cabeceras, dominio, origen, Turnstile y respuesta común de errores. |
| src/middleware/access.js | Sesiones, roles, edificio, validación del código de visitante y privacidad de respuestas de plataforma. |
| src/lib/ | Reglas de negocio, SQL atómico, sesiones, MQTT y otras integraciones. |

## Orden de protección

Primero se comprueban dominio, origen y Turnstile. Después se carga el edificio y, cuando corresponde, su sesión y rol. Los datos autorizados se comparten en el contexto de Hono; cada endpoint ejecuta la operación correspondiente. La sesión de superadministración se comprueba de forma independiente y no concede acceso de residente a un edificio.

La respuesta de las API de plataforma pasa por la política compartida de ocultación de códigos. Los errores de validación mantienen su mensaje y estado HTTP; los errores internos se presentan sin detalles privados. Las cabeceras de seguridad también se aplican a errores y rechazos tempranos.

## Decisiones

- Mantener las reglas SQL atómicas y las reservas de apertura en los servicios evita introducir carreras al dividir las rutas.
- Consultar el resultado de una apertura nunca publica otra orden. Los reintentos requieren una acción explícita y conservan las comprobaciones de identidad y permisos.
- La lógica MQTT y webhook vive en servicios independientes del enrutador; Hono organiza HTTP, no cambia el protocolo del dispositivo.
- Se aceptan las URL con o sin barra final. Las rutas o métodos no registrados devuelven 404; no se usan manejadores generales para ejecutar operaciones.
- No se añadieron servicios, dependencias ni migraciones de datos para esta reorganización.

## Verificación

Ejecutar npm test, npm run build y npm run test:ui. Las pruebas HTTP incluyen separación de roles, códigos enmascarados, revocación, métodos no autorizados, errores y cabeceras; las suites existentes cubren sesiones, apertura, recuperación y dispositivos simulados. No se accionan relés físicos.

## Contrato actual consolidado

- GET y POST /t/:slug/admin/codes: consulta y creación multiacceso.
- POST /t/:slug/admin/codes/extend y /codes/revoke: extensión y revocación.
- src/lib/codes.js concentra creación y listado, también para superadministración y resúmenes del panel.
- Creación: gateIds, label, mode (visit, repeat o unlimited) y days solo para repeat, de 1 a 30. Visita conserva siete días para comenzar y diez minutos desde el primer envío.
- POST /account/logout es el cierre de sesión común a todos los paneles.
- /admin/panel entrega accesos, códigos e historial; /platform/api/panel incluye la auditoría del superadministrador.
- La navegación usa section; el HTML ya no acepta view ni los antiguos anclajes de la interfaz one-page.

Se retiraron /passes, /passes/extend, /create-code, /revoke-code, /admin/dashboard, /admin/logs, /admin/gates, /platform/api/audit y los cierres de sesión por panel. No se mantienen alias HTTP. Las URLs de entrada de usuarios, visitantes y edificios se conservan.

No es necesaria una migración ni borrar registros. Los códigos ya guardados conservan sus restricciones; la lectura de órdenes pendientes del navegador evita reenvíos duplicados. Las pruebas de migración y datos persistidos se mantienen con ese propósito, sin ofrecer contratos anteriores en producción.

Al publicar se deben desplegar frontend y Worker juntos y recargar las pestañas que sigan abiertas con el JavaScript anterior. La propuesta OpenAPI externa describe la revisión 9946f91; no forma parte del contrato versionado actual.
