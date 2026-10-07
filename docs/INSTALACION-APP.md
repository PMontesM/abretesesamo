# Instalación y sesiones

PortonSmart se instala desde navegadores compatibles con el manifiesto web. El inicio de la app abre /login y redirige según la cuenta. No se almacenan accesos ni órdenes sin conexión. En iPhone la instalación se explica mediante Compartir → Agregar a inicio; puede requerir iniciar sesión una vez desde el icono.

Administradores de edificio: cookie HttpOnly, Secure y SameSite=Strict de 30 días, renovada en uso activo como máximo una vez por hora por el cliente. Residentes: sesión sin vencimiento del servidor, con las limitaciones de almacenamiento del navegador indicadas abajo. Superadministradores: una hora fija, sin renovación automática. Cerrar sesión, cambiar contraseña/teléfono o recuperar cuenta invalida las sesiones mediante session_version. No existe aún revocación individual por dispositivo; el cierre de sesión actual invalida todas las sesiones de la cuenta.

Temporalmente, para pruebas, Ahora no oculta el aviso solo hasta la siguiente carga del panel. Se ignoran las pausas de siete días guardadas anteriormente. El aviso no aparece en modo instalado. La opción permanece en Mi perfil.

Las cuentas que solo son residentes tienen sesión sin vencimiento del servidor. La cookie dura hasta 400 días y se renueva con el uso, sujeta a las políticas del navegador. Si la cuenta pasa a tener permisos de administración, esa sesión deja de aceptarse y se requiere iniciar sesión con la duración correspondiente. Administradores de edificio (incluyendo cuentas con roles mixtos): 30 días renovables. Superadministración: una hora.
