# Relé v2 — mserrano3 / portón Edificio

Archivo: mserrano3-principal.yaml. Conserva tus valores actuales de secrets.yaml. No contiene contraseñas ni modifica el archivo original de Descargas.

## Pulso y compatibilidad

El módulo simula un pulsador mediante el contacto seco del relé conectado a la entrada adecuada del equipo existente. No alimenta directamente motores, cerraduras o electroimanes. No todos los equipos interpretan un pulso como «abrir»: algunos alternan abrir/detener/cerrar. Esa característica debe registrarse durante la instalación.

La configuración de pruebas usa `relay_pulse_ms: "500"` (medio segundo) y 6 segundos adicionales de espera. Es un punto de partida para el banco de pruebas, no un tiempo universal. La duración final debe seguir el manual de la entrada de control del equipo. Dos segundos pueden ser demasiado largos para algunas entradas, aunque otros equipos los acepten. El rango admitido por esta versión es 100–2000 ms; no ofrece activación sostenida.

GPIO1 e inversión false conservan la polaridad de tu archivo original. Si el módulo es activo en bajo, debe configurarse relay_inverted correctamente. Prueba encendido, apagado, reinicio y actualización con el motor desconectado: el software no garantiza por sí solo ausencia de transitorios en el arranque ni un corte ante un bloqueo del microcontrolador. Para un tiempo máximo garantizado hace falta un temporizador físico/monoestable adecuado.

## Cambios

- Órdenes JSON identificadas; el texto simple OPEN se ignora.
- Caducidad máxima de 15 segundos, validada con reloj SNTP en UTC. Sin hora válida, no acepta órdenes.
- Token boot_id aleatorio por arranque: una orden de un arranque anterior se rechaza.
- Registro en RAM de las últimas 32 órdenes aceptadas. Repetir un ID no repite el pulso. IDs UUID minúsculos. No se escribe flash por cada apertura.
- Confirmaciones accepted y completed; completed indica que el firmware desactivó la salida, NO posición física ni verificación eléctrica del contacto.
- Rechazo busy durante el pulso y seis segundos posteriores. Las órdenes rechazadas no se encolan.
- Sesión MQTT limpia, comandos sin retención, confirmaciones sin retención.
- Estado, información y salud retenidos; salud incluye fecha de muestreo y puede estar desactualizada si el dispositivo se desconecta.
- Publicaciones asíncronas y ninguna publicación entre activar la salida y la acción programada para desactivarla. La duración sigue dependiendo del funcionamiento del ESP32.

## Topics

Todos bajo gate/mserrano3-principal/:

| Topic | Dirección | Retenido | Contenido |
|---|---|---|---|
| log | ESP32 → Backend | No (predeterminado) | Logs de diagnóstico, nivel INFO |
| cmd | Backend → ESP32 | NO | Orden JSON |
| ack | ESP32 → Backend | NO | ID, boot_id, status, reason opcional |
| state | ESP32 → Backend | Sí | initializing, online, opening, cooldown, offline |
| info | ESP32 → Backend | Sí | protocol=2, boot_id, pulse_ms, cooldown_ms, clock_ready |
| health | ESP32 → Backend | Sí | rssi si está disponible, uptime_s, sampled_at, boot_id |

El estado online es disponibilidad reportada; no posición del portón. El LWT no detecta cortes de inmediato. Un estado retenido no confirma una apertura nueva. uptime_s está basado en millis() y se reinicia al desbordarse este contador, aproximadamente cada 49,7 días.

## Contrato del backend

1. Validar permisos del usuario y reservar la operación por dispositivo.
2. Abrir una conexión de lectura con client_id único, sesión limpia y suscribirse a info, state y ack del dispositivo exacto. Esperar SUBACK y los mensajes necesarios; instalar el receptor antes de publicar.
3. Si el estado no es online o clock_ready no es true, no publicar. No confundir un timeout con offline confirmado.
4. Generar UUID nuevo e inmutable y timestamps Unix UTC en SEGUNDOS. Copiar el boot_id de info. expires_at = issued_at + 10 (máximo 15).
5. Publicar UNA VEZ en cmd, con retain=false. No reconectar para reenviar automáticamente una apertura incierta. Si el cliente MQTT hace retransmisión de QoS, debe conservar exactamente el mismo ID y payload.
6. Esperar ack con el mismo id y boot_id. accepted no es confirmación de pulso terminado. completed lo es. duplicate con reason=completed permite reconocer un resultado anterior; duplicate con reason=accepted sigue pendiente.
7. Si vence el timeout sin completed, registrar resultado incierto; no crear otro ID para reintentar automáticamente.
8. Cerrar conexiones y mantener el bloqueo por dispositivo durante el tiempo de pulso y cooldown. No renovar automáticamente el boot_id de una orden rechazada para ejecutarla de nuevo.

Ejemplo de estructura (NO copiar estos timestamps/token para operar):

```json
{
  "id": "35a4c1fa-265e-4c62-9d97-7150c097e640",
  "action": "OPEN",
  "boot_id": "TOKEN_ACTUAL_DE_INFO",
  "issued_at": 1800000000,
  "expires_at": 1800000010
}
```

Motivos de rechazo: invalid_action, boot_changed, clock_not_ready, invalid_time, expired_or_invalid_time, busy. JSON ilegible o ID inválido se ignora sin accionar.

Las dos credenciales centrales requieren: backend-api publica gate/+/cmd; backend-status se suscribe a gate/+/# para incluir ack e info además de state/health (si el plan permite ese filtro). La credencial del ESP32 sigue limitada a gate/mserrano3-principal/#. Las claves no van al navegador. Comprobar permisos efectivos en HiveMQ.

## Instalación

1. Conserva copia del firmware anterior y secrets.yaml.
2. Copia este YAML a tu carpeta de ESPHome junto a tus secretos existentes.
3. Valida y compila con tu ESPHome; esta entrega se validó con 2026.9.0.
4. Carga por USB u OTA desde tu entorno habitual, con el relé aún en banco de pruebas.
5. El backend incluido implementa el protocolo v2. Consulta ../docs/RELES-MQTT.md para configurar la conexión.

No se ha flasheado el dispositivo ni enviado una orden MQTT real desde esta tarea.

## Pruebas de banco antes de instalar

- Arranque sin internet/hora: salida desactivada y sin aceptar órdenes.
- OPEN como texto, JSON inválido, ID inválido, caducidad pasada, TTL mayor de 15 s o boot_id ajeno: ningún pulso.
- Orden válida: un pulso de la duración configurada y ack completed con el ID correcto.
- Mismo ID durante y después del pulso: no repite la salida.
- ID distinto durante el cooldown: busy; no se ejecuta después por su cuenta.
- Desconectar Wi-Fi tras enviar: la salida se libera; el backend considera incierto si no recibe confirmación.
- Reiniciar y reenviar orden del arranque anterior: boot_changed, ningún pulso.
- Desconectar/reconectar y cortar/restaurar alimentación: ningún pulso espontáneo.
- Medir el contacto del relé y verificar polaridad y tiempo; no confiar solo en LEDs o en mensajes MQTT.

## Referencias

- https://esphome.io/components/mqtt/
- https://esphome.io/components/script/
- https://esphome.io/components/time/sntp/

## Logs MQTT (18 de septiembre de 2026)

Los logs se publican en `gate/${device_name}/log` con nivel `DEBUG` durante el diagnóstico actual. Al terminar, volver a `INFO`. `topic_prefix: null` se conserva como una opción independiente de MQTT. Los logs complementan las confirmaciones del protocolo; no confirman la posición física del portón.

## LED de conexión — XIAO ESP32-C6

El LED de usuario integrado (GPIO15, activo en bajo) indica únicamente conectividad y reloj:

- Lento: 500 ms encendido / 500 ms apagado durante el arranque, hasta 60 segundos mientras consigue conexión y hora.
- Conectado: encendido fijo cuando Wi-Fi, MQTT y hora están listos. No indica que el portón esté físicamente abierto ni que el backend haya liberado una revisión.
- Rápido: 200 ms encendido / 200 ms apagado si pierde conexión u hora válida tras estar listo, o si no está listo al terminar el primer minuto.

No hay patrones de apertura o cooldown. El LED del módulo de relé sigue reflejando su propia activación. La lógica del LED no publica mensajes ni usa esperas bloqueantes. Apagado sin destellos no es confirmación de disponibilidad.

Archivos completos: mserrano3-principal.yaml para Edificio y mserrano3-estacionamiento.yaml para Estacionamiento. Cada dispositivo debe conservar sus propias credenciales en secrets.yaml; no cargar el archivo de Principal en ambos.

Validar e instalar el archivo correspondiente desde ESPHome, conservando los secretos. Comprobar los tres patrones y la recuperación de conexión en banco antes de conectar al portón.

Referencia del pin: https://wiki.seeedstudio.com/xiao_esp32c6_getting_started/#pin-map

## Diagnóstico de reinicios

Los logs MQTT usan DEBUG temporalmente, con retain false, en gate/<device_name>/log. En HiveMQ suscribirse a ese topic antes de reproducir el problema. Los logs son en vivo: si el dispositivo pierde Wi-Fi o energía no puede transmitir el final del fallo.

Para investigar reinicios, conectar USB y abrir Logs / Web Serial en ESPHome; guardar las líneas anteriores al reinicio y el arranque siguiente. Abrir una sesión serial también puede provocar un reinicio, que debe distinguirse de uno espontáneo.

El mensaje retenido gate/<device_name>/health incluye reset_reason (motivo del último arranque reportado por ESPHome), boot_id, uptime_s, sampled_at y firmware_revision. Se publica al conectar, sincronizar la hora, cada cinco minutos y durante los cambios de estado existentes. Puede ser antiguo: comparar fecha y boot_id con /info. No constituye un historial de reinicios.

Power-on indica un encendido; brownout señala una caída de tensión detectada; watchdog/panic orientan a bloqueo o fallo del software. Un reinicio de software no identifica por sí solo quién lo solicitó. MQTT conserva su política previa de reiniciar tras 15 minutos sin conexión, ahora explícita. No se añadió reinicio remoto ni otra política de recuperación.

El LED fijo solo confirma Wi-Fi, sesión MQTT y reloj local; no verifica la conexión del Worker, sus credenciales, permisos, datos retenidos recientes o bloqueos por revisión. Si Comprobar conexión falla, guardar su mensaje exacto y los topics /info, /state y /health del mismo dispositivo. El Worker espera datos hasta 6 segundos y exige salud de hasta 6 minutos de antigüedad.

Referencia: https://esphome.io/components/debug/
