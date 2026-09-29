# Acceso único y selección de edificio

La entrada común es `/login` (la raíz redirige allí). Se usa un correo normalizado y una contraseña para una cuenta global. Dentro de los paneles hay un selector de edificios autorizados y el enlace **Mi cuenta y edificios**. Cambiar de edificio abre su panel y aplica su rol: una misma persona puede ser administrador en uno y residente en otro. Durante una apertura en curso se impide cambiar desde el selector.

## Activación de cuentas existentes

1. Abrir `/login` y elegir **Activar mi acceso actual**.
2. Indicar el correo y una contraseña para la cuenta única. Si esa cuenta ya existe, se exige su contraseña.
3. Indicar el identificador o enlace del edificio, usuario y contraseña actuales de ese acceso.
4. Para sumar otro edificio: **Mi cuenta y edificios → Vincular otro edificio**, comprobando sus credenciales. No se unen usuarios por coincidencia de nombre o correo.

La superadministración también puede vincularse mediante su usuario y contraseña actuales. Vincular un edificio no concede permisos de plataforma. Los enlaces de visitantes conservan sus códigos y edificios. El login anterior permanece para cuentas todavía no vinculadas; las vinculadas usan el acceso único. Las altas actuales de usuarios conservan la entrega de credenciales y se activan con el mismo recorrido. El correo actúa como identificador; no se envían correos ni se verifica la propiedad del buzón.

## Sesiones y permisos

Las cuentas globales tienen cookie HttpOnly, Secure y SameSite=Strict, con una hora de vigencia y versión de sesión. Cada petición comprueba la membresía vigente y el estado del edificio. Al vincular se invalidan sesiones locales anteriores; estas no vuelven a permitir acceso al usuario vinculado. Eliminar el usuario del edificio elimina su membresía sin borrar su cuenta de otros edificios. Cambiar la contraseña global o cerrar sesión invalida las sesiones globales.

El administrador de un edificio no puede restablecer una contraseña global, porque afectaría otros edificios. El titular puede cambiarla desde Mi cuenta comprobando la actual. La recuperación sin esa contraseña requiere soporte; no se ha añadido recuperación automática por correo.

## Instalación

Respaldar D1 y aplicar una vez `database/migration_010_accounts.sql` antes del Worker; es aditiva e idempotente. La instalación nueva usa `database/schema.sql`. No transforma ni combina cuentas existentes, no modifica códigos o relés. No requiere secretos nuevos, un servicio de correo ni cambios de firmware.

## Hono

El Worker utiliza Hono para el enrutamiento principal, las rutas de cuenta y los middleware de seguridad, Turnstile y errores. Los módulos existentes mantienen la lógica de acceso, MQTT, auditoría y tareas programadas. Se conserva un solo Worker con D1 y Assets. No requiere servicios de pago; siguen aplicando las cuotas existentes.

Pruebas: `npm test` y `npm run test:ui`. Incluyen vinculación con prueba de credenciales, dos edificios con roles distintos, aislamiento, contraseñas, sesiones, permisos de superadministración y selector móvil.

## Visitantes y códigos únicos

El login común ofrece **Tengo un código de visita** (`/visit`). No pide usuario ni edificio: el código de seis dígitos identifica el edificio y conserva la selección de portones permitidos y la confirmación antes de abrir. La consulta está protegida por Turnstile y un límite de diez intentos por IP cada cinco minutos. No activa relés ni inicia la ventana de visita.

Aplicar `migration_011_global_codes.sql` antes de publicar esta versión. El índice único global evita colisiones incluso entre creaciones simultáneas; ambas rutas de creación reintentan con otro código. La migración se detiene si hay duplicados, sin modificarlos. Los códigos se reservan mientras exista su registro (incluidos revocados o vencidos); no se garantiza unicidad histórica tras borrar un registro.

## Restablecer la demostración

`node tools/restablecer-demo.mjs https://host directorio-privado --prepare-reset` prepara SQL y credenciales privadas; no ejecuta cambios remotos. El SQL borra datos de todos los edificios y crea únicamente `residencial-demo`, con cuatro cuentas globales ya vinculadas, tres portones simulados y seis códigos aleatorios con distintos tipos y estados. Conserva las identidades de superadministración, sus cuentas globales y la configuración/inventario MQTT; elimina asignaciones, observaciones e historial de pruebas. Respaldar D1 y verificar el SQL antes de aplicarlo. No subir los archivos generados ni las contraseñas al repositorio.

Las pantallas comunes de login y visitante reutilizan las dos opciones, colores y componentes de las pantallas del edificio. La identificación del edificio mediante un código no envía ninguna orden de apertura.
