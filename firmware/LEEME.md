# Firmware del relé

La plantilla vigente es `porton-a001.yaml`, revisión `2026-09-26-v4.1`, protocolo 3, para Seeed XIAO ESP32-C6 con ESP-IDF. Cambiar `device_name` y `friendly_name` para cada dispositivo y configurar los secretos de Wi-Fi y MQTT fuera del repositorio.

El ESP32 publica disponibilidad, estado, información y diagnóstico bajo `gate/<device_name>/`. Recibe órdenes JSON en `cmd`, valida el arranque y vencimiento y confirma el resultado en `ack`. La plataforma acepta únicamente protocolo 3. El comando de texto OPEN no es la interfaz de control de la plataforma.

La salida se apaga al arrancar y al apagarse. El pulso configurado es 500 ms y la pausa 6000 ms; ajustar el pulso a la entrada del equipo instalado. No se confirma la posición física de la puerta sin sensores.

La plantilla incluye LED de estado, diagnóstico, sincronización de hora, recuperación de conectividad, OTA y controles locales de prueba QA. El modo QA debe usarse solo en banco de pruebas. No se modificó este firmware durante la unificación de la interfaz.

Provisionar una credencial MQTT por dispositivo, limitada a `gate/<device_name>/#`. Registrar el dispositivo desde Configuración de plataforma y asignarlo a un solo portón. La contraseña individual del ESP32 no se almacena en la plataforma.

Compilar con ESPHome en el entorno del instalador y probar alimentación, arranque, pulso, pausa, reconexión y ausencia de pulsos al reiniciar antes de conectarlo al sistema del edificio. Esta actualización de interfaz no compila ni flashea el firmware.
