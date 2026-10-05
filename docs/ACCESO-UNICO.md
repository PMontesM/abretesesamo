# Acceso por teléfono

`/login` es la entrada común. El administrador registra un nombre, teléfono, contraseña inicial y portones autorizados. Si el teléfono ya pertenece a una cuenta, se agrega el acceso al edificio sin reemplazar su contraseña. La cuenta puede tener distintos roles en distintos edificios. El selector dentro del panel cambia el edificio que controla.

No hay activación ni vinculación manual de accesos anteriores. El teléfono es un identificador; no se envían SMS ni se verifica su titularidad. La bienvenida se puede compartir por WhatsApp. El usuario cambia su contraseña desde Mi cuenta, indicando la actual; recuperar una contraseña olvidada requiere soporte.

Las cookies son HttpOnly, Secure y SameSite=Strict. Cada petición verifica la cuenta, su versión de sesión, membresía y estado del edificio. Eliminar un residente retira ese edificio, sin borrar su acceso a otros. Cambiar contraseña o cerrar sesión invalida las sesiones de la cuenta.

## Visitantes

`/visit` permite introducir un código de seis dígitos sin usuario ni edificio. El código identifica el edificio y permite elegir entre los portones autorizados. La consulta no activa dispositivos ni inicia la ventana de visita. Turnstile y límites de intentos protegen esta entrada.

Los códigos son únicos entre edificios mientras exista su registro. Una visita puede comenzar durante siete días y permite reintentos durante diez minutos desde la primera apertura confirmada. Los códigos con vigencia permiten 1 a 30 días; los permanentes no vencen.

## Demo

`node tools/restablecer-demo.mjs https://host directorio-privado --prepare-reset` prepara SQL y credenciales, sin ejecutar cambios remotos. Respaldar D1 antes de aplicar ese SQL.

El restablecimiento elimina edificios, usuarios de edificios, códigos, operaciones, historial e inventario de relés. Crea un edificio, tres portones simulados, cuatro cuentas por teléfono y seis códigos de muestra. Conserva identidades y cuentas de superadministración, además de la configuración cifrada MQTT. No subir las credenciales ni el SQL generado a GitHub.

Para crear una Demo sin eliminar datos: `node tools/crear-demo.mjs https://host directorio-privado`; aplicar su SQL una sola vez. No compartirla si se cambian sus portones simulados por dispositivos físicos.

## Teléfonos y entrada pública

La raíz abre `/visit`; `/login` queda disponible desde Entrar con mi usuario. El teléfono se guarda en formato internacional. Diez dígitos sin prefijo se interpretan como México (+52). Para otros países es obligatorio incluir + y el código de país. No se comprueba titularidad mediante SMS ni WhatsApp.

Antes de desplegar, respaldar y aplicar una sola vez `migration_012_phone.sql`, asociando los teléfonos de las cuentas existentes. La migración conserva IDs, contraseñas y permisos; los correos previos quedan solo para transición de cuentas todavía sin teléfono. Las altas nuevas requieren teléfono. Un número existente añade el edificio autorizado y conserva la contraseña global. El cambio de número requiere soporte; no se ofrece recuperación automática.

En celular, los edificios se presentan como tarjetas con Administrar edificio visible. La tarjeta de identidad del menú abre Mi perfil; no hay un enlace aparte de perfil. El selector de edificios aparece solo cuando hay más de uno.
