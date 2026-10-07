# Relés MQTT desde la plataforma

## Configuración cotidiana

1. Iniciar sesión como administrador de plataforma y abrir **Configuración** en el menú lateral.
2. En **Editar conexión MQTT**, guardar servidor, puerto WebSocket seguro, ruta y las cuentas de envío y consulta. Confirmar con la contraseña actual de plataforma. La configuración anterior de HiveMQ se conserva automáticamente.
3. En **Inventario de relés**, pulsar **Buscar relés** para encontrar dispositivos con reportes MQTT. También se pueden registrar manualmente por su identificador del firmware, incluso desconectados, y asignarles un nombre reconocible.
4. En cada edificio, agregar o editar un portón, seleccionar **Relé conectado (MQTT)** y elegir un dispositivo disponible en **Relé del inventario**. Se impide asignar el mismo dispositivo a dos portones. Las asociaciones existentes se importan al inventario al actualizar.
5. Pulsar **Comprobar conexión**, desde el inventario o el edificio. La consulta autentica ambas cuentas y lee los reportes; no publica comandos ni prueba el permiso de publicación o la apertura física.

**Acceso** indica Habilitado o Deshabilitado. **Conexión del relé** muestra Conectado, Desconectado, Iniciando, Relé activado, Pausa entre órdenes o Sin verificar. Una consulta offline actualiza la conexión sin cambiar permisos ni revocar códigos. Un fallo al consultar se muestra como Sin verificar, no como desconexión confirmada. La información deja de considerarse actual después de dos minutos. La última consulta se conserva; no hay sondeo automático. Actualizar lista solo vuelve a leer el inventario, mientras Buscar relés o Comprobar conexión consultan MQTT.

Buscar relés usa los mensajes retenidos de `gate/+/state`, `gate/+/info` y `gate/+/health` durante una ventana corta y hasta 200 dispositivos por consulta. Es un inventario de dispositivos reportados, no una lista garantizada de todas las conexiones del broker. La búsqueda no cambia nombres ni asignaciones existentes.


Las contraseñas guardadas no se recuperan en el formulario. Dejar un campo vacío conserva su contraseña si el usuario no cambió; cambiar el usuario exige capturar una contraseña nueva. Solo los administradores de plataforma pueden configurar estas cuentas. Crear cuentas, permisos y flashear firmware en HiveMQ/ESPHome siguen siendo tareas de aprovisionamiento externas.

## Broker y permisos

Broker de esta instalación: `95cad9bec61b432488ee5d0d0ef98773.s1.eu.hivemq.cloud`, TLS WebSocket puerto 8884, path `/mqtt`.

Servidor, puerto y ruta se pueden cambiar desde Configuración. Solo se admite WebSocket seguro con TLS y un nombre público de servidor. El puerto WebSocket puede ser distinto del TCP que usa el firmware. Cambiar proveedor en la plataforma no reconfigura los ESP32: también hay que actualizar su conexión. Al guardar ajustes se invalidan los estados anteriores; las respuestas tardías de la configuración anterior no los sobrescriben.

- Cuenta de envío: publicar en `gate/+/cmd`.
- Cuenta de consulta: suscribirse a `gate/+/#` (incluye `availability`, `state`, `info`, `health` y `ack`).
- Cuenta de cada ESP32: publicar/suscribirse solamente en `gate/<device-id>/#`.

El Worker usa MQTT 3.1.1 sobre el WebSocket del runtime, conexiones cortas, client IDs únicos y clean session. No requiere paquetes Node ni una conexión persistente.

## Confirmación y protección contra repeticiones

Antes de publicar, el Worker reserva el dispositivo en D1 y obtiene información reciente del firmware de protocolo 3. Usa el `boot_id` actual, un UUID por comando y una vigencia de 10 segundos. Publica JSON a `cmd` con QoS 1 y **retain desactivado**. No reenvía ni reconecta automáticamente.

La respuesta positiva requiere `completed` (o `duplicate` con resultado `completed`) del mismo comando y arranque, en un mensaje no retenido. `PUBACK`, el estado `opening` y `accepted` por sí solos no son confirmación final. El pulso confirmado no demuestra que el portón se haya abierto: no hay sensor de posición.

Los códigos de visita y el panel comparten un bloqueo por dispositivo. Tras confirmar, se respeta el cooldown informado por el firmware más un segundo. Si la respuesta se pierde después del envío, la orden queda sin confirmar. El bloqueo termina automáticamente al consultar o solicitar una nueva apertura, cuando han pasado dos minutos desde el vencimiento de la orden (TTL de diez segundos). Las reservas que no llegaron al envío vencen dos minutos después de crearse. La pausa cubre el máximo de pulso/cooldown admitido y un margen de reloj. La alerta permanece visible como «Sin confirmación · acceso liberado» hasta marcarla como revisada; nunca se interpreta como éxito ni reenvía una orden automáticamente. Una petición suspendida no puede publicar después de vencer su reserva.

Los fallos seguros anteriores al envío y rechazos explícitos no consumen el código ni inician sus 10 minutos de visita. Los fallos inciertos conservan solo la pausa temporal. Los códigos reutilizables recuperan su vigencia anterior; una visita cuenta sus diez minutos desde el primer intento incierto, sin reiniciar ni alargar el plazo. Los códigos cancelados o vencidos no se reactivan; los códigos estrictamente de un uso se consideran consumidos. Las integraciones webhook mantienen revisión manual porque sus órdenes no tienen un vencimiento verificable. No requiere migración de datos ni nuevos cron jobs; el mantenimiento existente también ejecuta la recuperación. Los datos retenidos se aceptan como recientes si `health` corresponde al mismo arranque y tiene como máximo seis minutos; el LWT puede tardar en detectar una caída. La consulta distingue disponibilidad informada de posición física.

## Instalación y mantenimiento técnico

- Nueva base: usar `database/schema.sql`.
- Base existente al día hasta migración 006: aplicar `database/migration_007_mqtt.sql` y después `database/migration_008_relay_inventory.sql`, ambas aditivas e idempotentes, antes de desplegar el Worker. Si ya se aplicó 007, solo hace falta 008.
- `MQTT_ENCRYPTION_KEY` es un secreto de Cloudflare con 32 bytes aleatorios codificados en Base64. La instalación de producción lo crea automáticamente; las actualizaciones deben conservarlo junto con `ADMIN_SIGNING_SECRET` y el binding `DB`.
- Las credenciales se cifran con AES-256-GCM, nonce aleatorio por escritura y contexto autenticado. D1 almacena únicamente el sobre cifrado. La auditoría registra quién cambió la configuración y los nombres de usuario, nunca contraseñas.
- Conservar la clave de cifrado al restaurar o trasladar una instalación: restaurar solamente D1 no permite descifrar las credenciales sin su clave correspondiente. No rotar la clave sin un procedimiento de recifrado.
- `relay_commands` conserva intención, arranque, vencimiento, resultado y relación con la solicitud de origen. La limpieza mantiene pendientes/inciertas; elimina registros finalizados de más de 30 días.
- Un dispositivo solo se asigna a un portón, incluso si está inactivo. Un bloqueo pendiente impide cambiar su asociación. Cambiar la integración revoca códigos previos según la política existente.

## Disponibilidad y verificación

La plataforma requiere protocolo 3. La disponibilidad offline prevalece sobre un estado operativo retenido. Información incompleta, arranque discordante o diagnóstico demasiado antiguo impiden enviar una orden. Comprobar conexión no activa el relé.

Las pruebas automáticas usan un broker simulado y cubren comandos, confirmaciones, concurrencia, permisos y fallos de comunicación. La integración eléctrica se verifica en sitio.
