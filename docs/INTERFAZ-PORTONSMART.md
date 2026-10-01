# Interfaz PortonSmart

Panel y Mi Acceso parten de los HTML originales conservados en `frontend/reference/`. Las plantillas de producción están en `frontend/templates/`: mantienen composición, tarjetas, tipografía, iconos y adaptación móvil, conectadas a datos reales mediante Alpine CSP. Los ejemplos no se publican.

## Funciones

- Panel: órdenes de hoy y ayer por hora, pases activos, vencimientos, historial con filtros y CSV, consultas de conexión y avisos basados en esas consultas.
- Mi Acceso: mantener pulsado 400 ms, alternativa con confirmación, animación del icono, pases y actividad. El resultado confirma la orden comunicada por el dispositivo, no el movimiento físico del portón.
- Pases: tipos Con vigencia, Un solo uso (visita de diez minutos) y Permanente; un código para varios accesos autorizados; vigencias de 1 día, 7 días u otra cantidad de 1 a 30 días. Compartir por WhatsApp, copiar y revocar.
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

El formulario inicia en Un solo uso, con siete días para comenzar y diez minutos después de la primera orden confirmada, también para pases multiacceso. Copiar entrega solo el código; WhatsApp comparte el detalle con enlace e instrucciones. El historial del residente incorpora búsqueda, filtros por acceso y resultado y exportación CSV; conserva el límite de 200 registros y retención de 30 días. Configuración del administrador abre su propio formulario de contacto de ayuda. MQTT e inventario siguen restringidos al superadministrador.

## Superadministración

El resumen adopta `frontend/reference/super.html` mediante Alpine CSP y recursos locales. Incluye edificios con búsqueda, cuentas activas/suspendidas, órdenes enviadas hoy, administradores, auditoría y registros pendientes de códigos, órdenes directas y relés. Las cuentas de edificios no pueden consultar la API de plataforma.

Administrar edificio conserva la identidad del superadministrador y abre la gestión integrada de portones, usuarios, permisos y revisiones. Nuevo edificio, configuración MQTT, inventario, reportes y contraseña siguen disponibles con navegación de regreso al resumen. No hay suplantación de cuentas, planes comerciales ni facturación simulada.

Los estados consultados caducan a los dos minutos. El resumen no conecta a MQTT; solo lo hace el botón Comprobar. Las versiones de firmware se muestran a partir de esas consultas durante la sesión, con Sin consultar cuando no hay datos. No se ofrece actualización masiva OTA. El inventario muestra hasta 500 relés y la auditoría los últimos 200 eventos. Las cifras de revisión cuentan registros, que pueden corresponder a una misma operación.

No requiere migración de base de datos ni cambios de firmware.

## Recorrido unificado de visitantes y residentes

Los códigos del residente se consultan en la sección Códigos activos de Mi Acceso. El formulario ofrece Con vigencia, Un solo uso (una visita con diez minutos de reintentos) y Permanente; oculta las fechas para el permanente. Al crear se muestra una tarjeta con código, accesos, vigencia y acciones de copiar solo el código o compartir instrucciones por WhatsApp.

La apertura del residente usa pulsación de 400 ms, sin selección de texto ni menú de pulsación prolongada en el control; cancelar el gesto detiene el envío. La alternativa abre una confirmación con el diseño de PortonSmart. En visitantes la animación está dentro del botón y el verde indica Orden confirmada, sin una segunda leyenda de éxito. Permanecen los errores y la cuenta regresiva de la visita. Una confirmación no demuestra movimiento físico sin sensores.

## Simplificación del panel de residente

Se elimina la sección y enlace duplicados Todos mis códigos. Cerrar sesión aparece con texto en el panel lateral, ajustado a la altura visible del celular. Un solo uso permite comenzar durante siete días y conserva diez minutos desde el primer uso confirmado, sin selector de fecha. Con vigencia ofrece 1 día, 7 días u otra cantidad entera de 1 a 30. Permanente no tiene vencimiento. El historial muestra el código usado o Apertura desde el panel cuando no hubo código. Los códigos existentes conservan sus fechas.


## Panel de administrador del edificio unificado

La navegación usa una sola interfaz Alpine: Inicio, Portones, Residentes, Códigos, Historial y Configuración. Los enlaces antiguos de administración (`?view=users`, `codes`, `passes`, `logs` y `gates`) abren la sección correspondiente del mismo panel. Cerrar sesión está visible en el menú lateral móvil.

- Portones conserva pulsación, confirmación visual y animación; comprobación de conexión e información técnica se presentan en la misma tarjeta, con detalles desplegables. Las estadísticas por hora quedan plegadas al inicio.
- Residentes conserva alta por correo, permisos, eliminación y bienvenida por WhatsApp. Compartir una cuenta existente no revela su contraseña. Quitar accesos revoca los códigos vinculados; el titular cambia su contraseña global en Mi cuenta. Eliminar y revocar requieren un diálogo con el estilo del panel.
- Códigos usa el formulario del residente y la tarjeta de resultado para copiar o compartir. La lista permite filtrar por residente, portón, estado, código o referencia. Los filtros se aplican en el servidor antes de paginar, incluyendo accesos secundarios de un pase. Cada página contiene hasta 100 códigos y se amplía con Cargar más códigos. Se conserva el aislamiento por edificio y dueño.
- Historial muestra el portón, usuario y código, distingue los resultados, ofrece filtros y exportación CSV de los últimos 200 registros disponibles.
- Configuración reúne el contacto de ayuda; asignación de relés y revisión de órdenes siguen en superadministración.

Esta actualización no necesita migraciones ni cambios del firmware. No agrega sondeos de red automáticos. Pruebas locales con dispositivos simulados cubren navegación, alta, permisos, contraseña, eliminación, filtros, paginación y aislamiento de datos.


## Privacidad de códigos ajenos

El administrador ve completos solo sus propios códigos. Los códigos de residentes se muestran como `12••56`, sin copiar ni compartir. El superadministrador ve todos los códigos enmascarados. La regla también cubre historial, exportación y detalles estructurados de auditoría. El backend sustituye el código antes de enviarlo al navegador y retira tokens internos de creación y reserva.

Revocar y resolver usan referencias cifradas, vinculadas a la cuenta y al edificio; no exponen la credencial de acceso ni requieren migración. La búsqueda de códigos ajenos utiliza la representación visible, no los dígitos ocultos. Mostrar cuatro dígitos deja cien combinaciones posibles: este formato no reemplaza los límites de intentos del acceso público.

## Interfaz única

No se publica una segunda interfaz. Configuración MQTT, inventario, reportes y la gestión de cada edificio se muestran en el panel actual, con tarjetas adaptadas al celular. Dentro de cada edificio hay cuatro secciones explícitas: Portones, Usuarios, Códigos y Revisiones. Los accesos desde Administradores y Pendientes abren la sección correspondiente. Login y visitantes comparten los estilos de entrada de PortonSmart.

## Mi perfil integrado

Mi perfil es una sección de los tres paneles (`?section=profile`), con el mismo menú y márgenes móviles. Muestra el correo y permite cambiar la contraseña global. Tras guardarla se informa del cierre de sesión y se ofrece volver a entrar. El selector de edificios permanece en el menú; no hay enlaces duplicados a otra pantalla de cuenta.
