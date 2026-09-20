# Relés MQTT desde la plataforma

## Configuración cotidiana

1. Iniciar sesión como administrador de plataforma y abrir **Configuración** en el menú lateral.
2. En **Editar conexión MQTT**, guardar servidor, puerto WebSocket seguro, ruta y las cuentas de envío y consulta. Confirmar con la contraseña actual de plataforma. La configuración anterior de HiveMQ se conserva automáticamente.
3. En **Inventario de relés**, pulsar **Buscar relés** para encontrar dispositivos con reportes MQTT. También se pueden registrar manualmente por su identificador del firmware, incluso desconectados, y asignarles un nombre reconocible.
4. En cada edificio, agregar o editar un portón, seleccionar **Relé conectado (MQTT)** y elegir un dispositivo disponible en **Relé del inventario**. Se impide asignar el mismo dispositivo a dos portones. Las asociaciones existentes se importan al inventario al actualizar.
5. Pulsar **Comprobar conexión**, desde el inventario o el edificio. La consulta autentica ambas cuentas y lee los reportes; no publica comandos ni prueba el permiso de publicación o la apertura física.

**Acceso** indica Habilitado o Deshabilitado. **Conexión del relé** muestra Conectado, Desconectado, Iniciando, Relé activado, Pausa entre órdenes o Sin verificar. Una consulta offline actualiza la conexión sin cambiar permisos ni revocar códigos. Un fallo al consultar se muestra como Sin verificar, no como desconexión confirmada. La información deja de considerarse actual después de dos minutos. La última consulta se conserva; no hay sondeo automático. Actualizar lista solo vuelve a leer el inventario, mientras Buscar relés o Comprobar conexión consultan MQTT.

Buscar relés usa los mensajes retenidos de `gate/+/state`, `gate/+/info` y `gate/+/health` durante una ventana corta y hasta 200 dispositivos por consulta. Es un inventario de dispositivos reportados, no una lista garantizada de todas las conexiones del broker. La búsqueda no cambia nombres ni asignaciones existentes.

La asociación de esta instalación es **mserrano3 / Edificio / mserrano3-principal**. El dispositivo conserva su propia cuenta de HiveMQ. La plataforma utiliza sus dos cuentas centrales; no almacena la contraseña particular de cada dispositivo.

Las contraseñas guardadas no se recuperan en el formulario. Dejar un campo vacío conserva su contraseña si el usuario no cambió; cambiar el usuario exige capturar una contraseña nueva. Solo los administradores de plataforma pueden configurar estas cuentas. Crear cuentas, permisos y flashear firmware en HiveMQ/ESPHome siguen siendo tareas de aprovisionamiento externas.

## Broker y permisos

Broker de esta instalación: `95cad9bec61b432488ee5d0d0ef98773.s1.eu.hivemq.cloud`, TLS WebSocket puerto 8884, path `/mqtt`.

Servidor, puerto y ruta se pueden cambiar desde Configuración. Solo se admite WebSocket seguro con TLS y un nombre público de servidor. El puerto WebSocket puede ser distinto del TCP que usa el firmware. Cambiar proveedor en la plataforma no reconfigura los ESP32: también hay que actualizar su conexión. Al guardar ajustes se invalidan los estados anteriores; las respuestas tardías de la configuración anterior no los sobrescriben.

- Cuenta de envío: publicar en `gate/+/cmd`.
- Cuenta de consulta: suscribirse a `gate/+/#` (incluye `availability`, `state`, `info`, `health` y `ack`).
- Cuenta de cada ESP32: publicar/suscribirse solamente en `gate/<device-id>/#`.

El Worker usa MQTT 3.1.1 sobre el WebSocket del runtime, conexiones cortas, client IDs únicos y clean session. No requiere paquetes Node ni una conexión persistente.

## Confirmación y protección contra repeticiones

Antes de publicar, el Worker reserva el dispositivo en D1 y obtiene información reciente del firmware v2. Usa el `boot_id` actual, un UUID por comando y una vigencia de 10 segundos. Publica JSON a `cmd` con QoS 1 y **retain desactivado**. No reenvía ni reconecta automáticamente.

La respuesta positiva requiere `completed` (o `duplicate` con resultado `completed`) del mismo comando y arranque, en un mensaje no retenido. `PUBACK`, el estado `opening` y `accepted` por sí solos no son confirmación final. El pulso confirmado no demuestra que el portón se haya abierto: no hay sensor de posición.

Los códigos de visita y el panel comparten un bloqueo por dispositivo. Tras confirmar, se respeta el cooldown informado por el firmware más un segundo. Si la respuesta se pierde después del envío, la orden queda en revisión. Un administrador comprueba lo ocurrido y libera el relé desde el edificio; después resuelve el código o la orden de panel correspondiente. No se permite cerrar una revisión antes de dos minutos desde su creación.

Los fallos seguros anteriores al envío y rechazos explícitos no consumen el código ni inician sus 10 minutos de visita. Los fallos inciertos conservan el bloqueo. Los datos retenidos se aceptan como recientes si `health` corresponde al mismo arranque y tiene como máximo seis minutos; el LWT puede tardar en detectar una caída. La consulta distingue disponibilidad informada de posición física.

## Instalación y mantenimiento técnico

- Nueva base: usar `database/schema.sql`.
- Base existente al día hasta migración 006: aplicar `database/migration_007_mqtt.sql` y después `database/migration_008_relay_inventory.sql`, ambas aditivas e idempotentes, antes de desplegar el Worker. Si ya se aplicó 007, solo hace falta 008.
- `MQTT_ENCRYPTION_KEY` es un secreto de Cloudflare con 32 bytes aleatorios codificados en Base64. La instalación de producción lo crea automáticamente; las actualizaciones deben conservarlo junto con `ADMIN_SIGNING_SECRET` y el binding `DB`.
- Las credenciales se cifran con AES-256-GCM, nonce aleatorio por escritura y contexto autenticado. D1 almacena únicamente el sobre cifrado. La auditoría registra quién cambió la configuración y los nombres de usuario, nunca contraseñas.
- Conservar la clave de cifrado al restaurar o trasladar una instalación: restaurar solamente D1 no permite descifrar las credenciales sin su clave correspondiente. No rotar la clave sin un procedimiento de recifrado.
- `relay_commands` conserva intención, arranque, vencimiento, resultado y relación con la solicitud de origen. La limpieza mantiene pendientes/inciertas; elimina registros finalizados de más de 30 días.
- Un dispositivo solo se asigna a un portón, incluso si está inactivo. Un bloqueo pendiente impide cambiar su asociación. Cambiar la integración revoca códigos previos según la política existente.

## Verificación de esta entrega

60 pruebas automatizadas cubren los flujos existentes, credenciales cifradas y acceso restringido, simultaneidad, expiración, fallo de persistencia, confirmaciones incorrectas, consulta sin publicación, formato MQTT, servidor editable, descubrimiento e inventario. El navegador verifica Configuración lateral, formularios, inventario móvil, asignación exclusiva y estado Desconectado conservado al actualizar la página sin deshabilitar el acceso, además de los flujos anteriores.

Las pruebas automatizadas utilizan un broker simulado y no accionan hardware. En la verificación final de producción ya había credenciales guardadas desde la plataforma y una orden real registrada en `cooldown`: este resultado requiere confirmación de pulso completado del dispositivo. Esto verifica el intercambio de la orden y su confirmación; no prueba el movimiento físico del portón. No se enviaron comandos de apertura desde las herramientas de verificación de esta entrega.

## Actualización availability (2026-09-19)

Consulta, apertura e inventario leen availability además del estado operativo. offline de disponibilidad prevalece sobre un state online retenido. Los firmwares que anuncian info.availability_topic=true o health.firmware_revision=2026-09-19-info-1 / 2026-09-19-availability-2 requieren availability online antes de abrir. Sin el mensaje no se envía una orden. Se conserva compatibilidad con el firmware anterior que publicaba su LWT en state.

Comprobar conexión muestra el diagnóstico del último reporte, sin accionar el relé. Los datos de una consulta offline pueden ser parciales. No se añadieron tablas ni se modificaron credenciales, asignaciones o revisiones pendientes.
