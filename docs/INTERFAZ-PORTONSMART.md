# Interfaz PortonSmart

Panel y Mi Acceso parten de los HTML originales conservados en `frontend/reference/`. Las plantillas de producción están en `frontend/templates/`: mantienen composición, tarjetas, tipografía, iconos y adaptación móvil, conectadas a datos reales mediante Alpine CSP. Los ejemplos no se publican.

## Funciones

- Panel: órdenes de hoy y ayer por hora, pases activos, vencimientos, historial con filtros y CSV, consultas de conexión y avisos basados en esas consultas.
- Mi Acceso: mantener pulsado 600 ms, alternativa con confirmación, animación del icono, pases y actividad. El resultado confirma la orden comunicada por el dispositivo, no el movimiento físico del portón.
- Pases: categorías Visita, Entrega y Servicio; un código para varios accesos autorizados; vigencias de 30 minutos, 2, 6 o 24 horas; modos reutilizable, visita y sin vencimiento. Compartir por WhatsApp, copiar y revocar.
- Las visitas comparten diez minutos desde la primera orden satisfactoria, incluso entre varios portones. El visitante elige el acceso y confirma antes del primer uso.
- Extensión de 30 minutos para reutilizables vigentes que vencen en diez minutos, hasta siete días desde su creación. No modifica visitas ni recupera pases revocados o vencidos.
- Usuarios, lista completa de códigos, superadministración e ingreso de visitantes conservan sus funciones y la marca PortonSmart.

## Arquitectura y costo

Frontend y servidor tienen carpetas separadas en el mismo repositorio y despliegue. Alpine CSP, Tailwind, Roboto e iconos Font Awesome se compilan y sirven desde Workers Assets. No hay CDN requerido, eval ni scripts ejecutables en línea. El Worker valida las sesiones y permisos.

El panel consulta al entrar o actualizar, sin sondeos continuos. La franja de 24 horas contiene comprobaciones puntuales: gris significa sin datos. Se conserva como máximo una observación por dispositivo y hora y se limpia después de 48 horas. La conexión muestra su fecha y caduca visualmente tras dos minutos. Se conserva la arquitectura del plan gratuito; las cuotas de Workers y D1 siguen aplicando.

## Instalación y actualización

Desde cero: usar `database/schema.sql`. En una instalación existente con migraciones hasta 008: respaldar D1 y aplicar una sola vez `database/migration_009_frontend.sql` antes del nuevo Worker. Es aditiva y conserva códigos y usuarios existentes. No requiere cambiar el firmware.

```sh
npm ci
npm run setup:frontend
npm run build
npm test
npm run test:ui
```

Las pruebas de navegador aceptan PLAYWRIGHT_PATH, BROWSER_PATH y WORKER_BUNDLE. Utilizan bases en memoria y dispositivos simulados. `src/html/templates.js` y `src/html/client.js` son generados: editar las fuentes de frontend y compilar.

## Opciones integradas en el diseño nuevo

El formulario inicia en Una visita e incluye Hoy, Mañana y fecha/hora personalizada, también para pases multiacceso. Copiar entrega el mensaje completo con código, enlace e instrucciones. El historial del residente incorpora búsqueda, filtros por acceso y resultado y exportación CSV; conserva el límite de 200 registros y retención de 30 días. Configuración del administrador abre su propio formulario de contacto de ayuda. MQTT e inventario siguen restringidos al superadministrador.

## Superadministración

El resumen adopta `frontend/reference/super.html` mediante Alpine CSP y recursos locales. Incluye edificios con búsqueda, cuentas activas/suspendidas, órdenes enviadas hoy, administradores, auditoría y registros pendientes de códigos, órdenes directas y relés. Las cuentas de edificios no pueden consultar la API de plataforma.

Administrar edificio conserva la identidad del superadministrador y abre la gestión existente de portones, usuarios, permisos y revisiones. Nuevo edificio, configuración MQTT, inventario, reportes y contraseña siguen disponibles con navegación de regreso al resumen. No hay suplantación de cuentas, planes comerciales ni facturación simulada.

Los estados consultados caducan a los dos minutos. El resumen no conecta a MQTT; solo lo hace el botón Comprobar. Las versiones de firmware se muestran a partir de esas consultas durante la sesión, con Sin consultar cuando no hay datos. No se ofrece actualización masiva OTA. El inventario muestra hasta 500 relés y la auditoría los últimos 200 eventos. Las cifras de revisión cuentan registros, que pueden corresponder a una misma operación.

No requiere migración de base de datos ni cambios de firmware.
