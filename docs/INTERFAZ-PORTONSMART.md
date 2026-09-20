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
