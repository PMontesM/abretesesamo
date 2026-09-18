# Actualización de auditoría — septiembre de 2026

Esta versión corrige revocaciones durante aperturas pendientes, invalida códigos al cambiar la integración de un portón, registra las aperturas directas antes de enviar órdenes y bloquea reintentos de resultados inciertos. Incluye búsqueda y paginación, cuotas, atribución estable del historial y auditoría transaccional.

## Instalación existente

1. Respalda la base D1 y conserva la versión anterior del Worker.
2. Confirma que seleccionaste la base y el Worker de la instalación activa.
3. Aplica database/migration_004_audit.sql a esa base. Es aditiva y puede repetirse; no borra registros.
4. Ejecuta database/verificar.sql y comprueba la tabla direct_operations.
5. Genera el cliente con npm run build y publica el Worker conservando el binding DB y ADMIN_SIGNING_SECRET actuales.
6. Verifica inicio de sesión, búsqueda con el filtro Todos, paginación y revisión de órdenes. Usa simulaciones para evitar activar hardware durante las pruebas.

No ejecutes schema.sql sobre una instalación existente. Para una instalación vacía, sigue INSTALACION.md.

## Validación local

38 pruebas automáticas de servidor y prueba de navegador sobre el Worker minificado. Las pruebas usan dispositivos simulados.

## Una visita — 10 minutos

Los nuevos códigos Una visita requieren confirmación antes de la primera apertura. El primer envío confirmado inicia 10 minutos de acceso; repetir no extiende el plazo. Los días de vigencia limitan cuándo puede comenzar la visita. Los códigos de un solo uso existentes conservan su comportamiento.

Para actualizar una instalación existente, respalda primero la base y aplica database/migration_005_visit.sql UNA SOLA VEZ antes de publicar. Añade visit_mode y visit_started_at; no elimina registros. El esquema completo ya incluye estas columnas para instalaciones nuevas.

## Usabilidad y ayuda

El inicio prioriza Abrir portón e Invitar a alguien. La lista muestra primero accesos vigentes y por revisar; el filtro Todos recupera los anteriores. En móvil se presentan tarjetas.

La invitación permite Hoy, Mañana o Elegir fecha y hora. La fecha se interpreta en la zona horaria del dispositivo que crea el acceso. Para Una visita es el límite para comenzar; el primer envío confirmado inicia los 10 minutos.

El visitante puede recuperar el estado y el contador al recargar la misma pestaña, sin enviar órdenes. Actualizar estado solo consulta información. Los resultados inciertos siguen bloqueados para revisión.

El administrador configura el teléfono de ayuda en Usuarios → Configurar ayuda; plataforma también puede hacerlo dentro del edificio. El teléfono es visible para visitantes: usar un contacto del edificio. Sin número se indica contactar al anfitrión o administración.

Para actualizar, respaldar y aplicar database/migration_006_support.sql una sola vez antes de publicar. Las instalaciones nuevas ya incluyen la columna en schema.sql.

Validación: 42 pruebas automáticas y prueba de navegador con aperturas simuladas.
