# Interfaz PortonSmart

La interfaz adopta las propuestas Panel Admin v2 y Mi Acceso v2: fondo gris claro, navegación blanca, tarjetas con iconos azul oscuro, cabeceras elevadas y controles adaptados a móvil. La marca visible es PortonSmart; el repositorio, las direcciones, el Worker y los identificadores de los dispositivos conservan sus nombres para mantener los enlaces existentes.

## Funciones integradas

- Administrador: resumen del edificio con órdenes enviadas en las últimas 24 horas, órdenes no enviadas o sin confirmar, códigos activos y última orden enviada. Gráfico de las últimas 24 franjas horarias, incluyendo la hora actual en curso, con tabla accesible. Las cifras se calculan en la base de datos, sin limitarse a los 200 registros visibles.
- Residentes: tarjetas de portones y pases, copiar enlace, compartir por WhatsApp, revocar y consultar vigencia. Navegación inferior en móvil. Cada residente solo ve su historial y códigos.
- Apertura: mantener pulsado 600 ms, con progreso visual; soltar antes, salir del botón o cancelar el gesto no envía una orden. Admite teclado y ofrece un botón alternativo con confirmación. Ambas rutas conservan la reserva e idempotencia del servidor. El icono existente se anima al confirmar el envío.
- Crear códigos: vigencias rápidas de 30 minutos, 2, 6 o 24 horas, además de hoy, mañana y fecha personalizada. Se mantienen los tipos visita, reutilizable y sin vencimiento.
- Historial: búsqueda por texto, filtro por portón/resultado y exportación CSV de los registros filtrados. La exportación neutraliza fórmulas de hoja de cálculo. Se indica el límite de 200 registros y la retención de 30 días.
- Superadministrador: mismo diseño, resumen de edificios/portones/revisiones y conservación de configuración MQTT, inventario, permisos, auditoría y resolución de órdenes pendientes.
- Visitantes e inicio de sesión: marca y diseño comunes, códigos legibles, errores junto al formulario, confirmación previa de las visitas y recuperación de su ventana de 10 minutos.

## Adaptaciones respecto a los ejemplos

Los ejemplos contienen datos ficticios. No se publican cifras ni estados simulados. La conexión conserva su fecha de consulta y caduca visualmente tras dos minutos; no implica monitoreo continuo. La franja de disponibilidad de 24 horas, las categorías Visita/Entrega/Servicio y un pase único para varios portones no se incorporan: necesitan historial de telemetría o cambios en el modelo de datos. Las notas siguen permitiendo identificar visitas, entregas y servicios.

Cada código sigue asociado a un portón. No se añade la extensión rápida de 30 minutos, que podría alterar la regla de visita de 10 minutos. Se puede crear un nuevo acceso con la vigencia deseada. Una respuesta satisfactoria confirma una orden, no el movimiento físico del portón.

No hay dependencias de Tailwind, Alpine, fuentes o iconos por CDN; los estilos y SVG forman parte del Worker y respetan su política de contenido. No requiere migración ni cambios en el firmware.

## Validación

Ejecutar `node tools/build-client.mjs`, `node --test tests/*.test.mjs`, `node tests/ui.mjs` y `node tests/design-ui.mjs`. Las pruebas de navegador requieren Playwright y un navegador; pueden configurarse con `PLAYWRIGHT_PATH` y `BROWSER_PATH`. Para validar el paquete final, usar `WORKER_BUNDLE` con la ruta del Worker empaquetado. Se utilizan base de datos en memoria y dispositivos simulados; nunca se abren portones reales.
