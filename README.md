# PortonSmart

Plataforma de control de accesos para varios edificios, con un Worker de Cloudflare, D1 y recursos estáticos. Frontend Alpine CSP con navegación por secciones y diseño para celular.

- Acceso único por teléfono y contraseña en `/login`; selector de edificios según permisos.
- Visitantes sin cuenta en `/visit` o mediante el enlace compartido del edificio.
- Códigos globalmente únicos, para uno o varios portones: con vigencia, visita de diez minutos y permanentes.
- Residentes: abrir accesos, crear/copiar/compartir/revocar códigos y consultar historial.
- Administradores: residentes, permisos, códigos enmascarados ajenos, historial y contacto de ayuda.
- Superadministración: edificios, portones, usuarios, revisiones, MQTT, inventario, reportes y auditoría, dentro del mismo panel.
- Relés con protocolo 3, confirmación por comando y bloqueo de resultados inciertos.
- Mi perfil: cambio de teléfono y contraseña; recuperación mediante enlace de un solo uso autorizado por superadministración.
- Turnstile, límites de intentos, sesiones revocables y permisos verificados por el servidor.

## Desarrollo

Node.js 24 o posterior. Ejecutar `npm ci`, `npm run setup:frontend`, `npm run build`, `npm test` y `npm run test:ui`.

`frontend/templates/` contiene los paneles; `frontend/src/` contiene sus componentes y las entradas públicas. `frontend/reference/` conserva las propuestas de diseño y no se publica. `src/` contiene la API Hono y la lógica de negocio. `database/schema.sql` instala una base vacía. Los archivos generados en `frontend/dist/` no se versionan; se reconstruyen antes de desplegar.

Las pruebas usan datos y dispositivos simulados. Una confirmación del firmware no acredita movimiento físico del portón.

## Operación

- [Instalación](INSTALACION.md)
- [Acceso único y Demo](docs/ACCESO-UNICO.md)
- [Interfaz](docs/INTERFAZ-PORTONSMART.md)
- [Relés MQTT](docs/RELES-MQTT.md)
- [Firmware](firmware/LEEME.md)
- [Respaldos](docs/RESPALDO.md)

El repositorio contiene código y esquema, nunca contraseñas, secretos ni respaldos de D1. La Demo utiliza portones simulados; su restablecimiento elimina todos los edificios y relés registrados y conserva la superadministración y la configuración cifrada del broker.

Publicación: `npm run db:migrate` y `npm run release`, con configuración versionada, pruebas y respaldo cifrado previo. Consultar los requisitos de GitHub Actions y respaldo diario en [Respaldos](docs/RESPALDO.md).
