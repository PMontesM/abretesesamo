# Respaldo del proyecto

Este repositorio contiene código, pruebas, esquema y migraciones D1, documentación y firmware ESPHome. Excluye usuarios, códigos, historial, contraseñas y copias de la base de datos.

## Desarrollo

Requiere Node.js 24 o posterior. Ejecuta `npm ci`, `npm run build` y `npm test`. La interfaz se prueba con `npm run test:ui`; consulta tests/ui.mjs para las rutas del navegador y del paquete de pruebas.

wrangler.toml es una plantilla: completa el ID de D1 del entorno correspondiente. Para actualizar producción no crees otra base ni reinstales el esquema. Revisa y aplica únicamente las migraciones pendientes.

## Respaldo separado

Guarda exportaciones de D1 con fecha y acceso restringido. Contienen datos privados y credenciales MQTT cifradas. Guarda ADMIN_SIGNING_SECRET, MQTT_ENCRYPTION_KEY, las credenciales MQTT y secrets.yaml en un gestor seguro. MQTT_ENCRYPTION_KEY es necesaria para recuperar las credenciales cifradas. Conserva también la configuración de cuenta, dominio y programación de Cloudflare.

El respaldo anterior a la limpieza de septiembre de 2026 permanece en work/private-backups del proyecto de trabajo original; no se sube a GitHub.

Para recuperar producción, restaura primero en una base separada, configura los secretos originales y verifica la aplicación antes de cambiar el dominio. Evita activar dispositivos reales durante las pruebas. INSTALACION.md corresponde a una instalación nueva.

GitHub guarda los cambios confirmados y subidos. No se han configurado copias automáticas de D1 ni despliegues automáticos.
