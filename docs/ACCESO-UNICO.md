# Acceso por correo

`/login` es la entrada común. El administrador registra un nombre, correo, contraseña inicial y portones autorizados. Si el correo ya pertenece a una cuenta, se agrega el acceso al edificio sin reemplazar su contraseña. La cuenta puede tener distintos roles en distintos edificios. El selector dentro del panel cambia el edificio que controla.

No hay activación ni vinculación manual de accesos anteriores. El correo es un identificador; no se envían correos ni se verifica el buzón. La bienvenida se puede compartir por WhatsApp. El usuario cambia su contraseña desde Mi cuenta, indicando la actual; recuperar una contraseña olvidada requiere soporte.

Las cookies son HttpOnly, Secure y SameSite=Strict. Cada petición verifica la cuenta, su versión de sesión, membresía y estado del edificio. Eliminar un residente retira ese edificio, sin borrar su acceso a otros. Cambiar contraseña o cerrar sesión invalida las sesiones de la cuenta.

## Visitantes

`/visit` permite introducir un código de seis dígitos sin usuario ni edificio. El código identifica el edificio y permite elegir entre los portones autorizados. La consulta no activa dispositivos ni inicia la ventana de visita. Turnstile y límites de intentos protegen esta entrada.

Los códigos son únicos entre edificios mientras exista su registro. Una visita puede comenzar durante siete días y permite reintentos durante diez minutos desde la primera apertura confirmada. Los códigos con vigencia permiten 1 a 30 días; los permanentes no vencen.

## Demo

`node tools/restablecer-demo.mjs https://host directorio-privado --prepare-reset` prepara SQL y credenciales, sin ejecutar cambios remotos. Respaldar D1 antes de aplicar ese SQL.

El restablecimiento elimina edificios, usuarios de edificios, códigos, operaciones, historial e inventario de relés. Crea un edificio, tres portones simulados, cuatro cuentas por correo y seis códigos de muestra. Conserva identidades y cuentas de superadministración, además de la configuración cifrada MQTT. No subir las credenciales ni el SQL generado a GitHub.

Para crear una Demo sin eliminar datos: `node tools/crear-demo.mjs https://host directorio-privado`; aplicar su SQL una sola vez. No compartirla si se cambian sus portones simulados por dispositivos físicos.
