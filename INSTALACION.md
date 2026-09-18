# Instalación detallada desde cero

## 0. Qué vas a instalar

Usaremos estos nombres para separar la instalación nueva de la anterior:

- Carpeta: `C:\Projects\porton-saas-nuevo`
- Worker: `porton-saas-nuevo`
- Base D1: `porton-saas-db-nueva`
- Dominio final, si decides conectarlo: `porton.inomali.com`

**No borres la base anterior.** La instalación nueva puede funcionar en su propia dirección de Cloudflare antes de trasladar el dominio. No copies las credenciales, respaldos, archivos SQL privados o `wrangler.toml` de la carpeta anterior sobre este paquete.

El esquema ya incorpora todos los cambios anteriores. **No ejecutes las migraciones 002/003 sobre esta instalación.** Los archivos históricos dentro de `tests/fixtures/` son exclusivamente datos de prueba.

## 1. Extraer y preparar la carpeta

Extrae el contenido del ZIP en `C:\Projects\porton-saas-nuevo`. En esa carpeta deben aparecer directamente `package.json`, `wrangler.toml`, `src`, `database` y `tools`.

Abre una terminal y entra en ella:

```cmd
cd /d C:\Projects\porton-saas-nuevo
node --version
npm --version
```

Usa Node.js 24 o posterior. Tu versión 24.13.0 es compatible. Instala las dependencias del proyecto:

```cmd
npm install
```

El paquete fija Wrangler 4.130.0 y Playwright 1.62.1. A partir de aquí usa **`npx wrangler`** para que los comandos utilicen la versión instalada en esta carpeta, en lugar de depender de una instalación global distinta. Conserva el `package-lock.json` que genere npm.

## 2. Conectar tu cuenta de Cloudflare

```cmd
npx wrangler login
```

Se abrirá el navegador para autorizar el acceso. Selecciona la cuenta donde quieres alojar la aplicación.

## 3. Crear una base de datos nueva

```cmd
npx wrangler d1 create porton-saas-db-nueva
```

Guarda el `database_id` que devuelva Cloudflare. Si Wrangler ofrece agregar automáticamente el binding a la configuración, elige **No**, porque el archivo del paquete ya contiene el binding y lo completarás en el siguiente paso.

Si el nombre ya está ocupado, usa otro nombre nuevo y cambia también `database_name` en la configuración y en los comandos siguientes. No reutilices una base de contenido desconocido.

Abre la configuración:

```cmd
notepad wrangler.toml
```

Reemplaza únicamente:

```toml
 database_id = "REEMPLAZA_CON_EL_ID_DE_LA_BASE_NUEVA"
```

por el identificador que acabas de obtener, manteniendo las comillas. La sección debe quedar así, con tu UUID real:

```toml
[[d1_databases]]
binding = "DB"
database_name = "porton-saas-db-nueva"
database_id = "TU-IDENTIFICADOR-REAL"
```

No cambies `binding = "DB"`: el servidor lo utiliza con ese nombre. No necesitas crear KV ni configurar Turnstile para esta versión. [Referencia de D1](https://developers.cloudflare.com/d1/get-started/).

## 4. Crear las nueve tablas

Ejecuta una sola vez sobre la base nueva:

```cmd
npx wrangler d1 execute porton-saas-db-nueva --remote --file database/schema.sql
```

Acepta la confirmación de Wrangler. Este archivo solo contiene definiciones de tablas e índices; no hay cuentas ni credenciales incluidas.

Comprueba el resultado:

```cmd
npm run db:check -- --remote
```

Debes ver una fila con las nueve cantidades en **0**. Esta herramienta usa una consulta directa sin `UNION ALL`, evitando el error anterior de la comprobación. No uses el archivo de verificación como una importación de datos.

Si aparece `table ... already exists`, no continúes suponiendo que la base está correcta: comprueba que seleccionaste la base nueva. Si el alta del esquema falla, revisa el resultado antes de repetirlo.

## 5. Crear el primer superadministrador

Desde la misma carpeta:

```cmd
node tools/crear-superadmin.mjs admin
```

Puedes sustituir `admin` por tu correo, por ejemplo:

```cmd
node tools/crear-superadmin.mjs tu-correo@ejemplo.com
```

**Ejecuta solo la variante que quieras utilizar.** La herramienta mostrará el usuario y una contraseña aleatoria: guárdalos en tu gestor de contraseñas antes de cerrar la ventana. Generará `.private/crear-superadmin.sql`, que contiene el hash y no la contraseña en texto plano.

La herramienta todavía no crea la cuenta remota. Importa el archivo:

```cmd
npx wrangler d1 execute porton-saas-db-nueva --remote --file .private/crear-superadmin.sql
```

Comprueba de nuevo:

```cmd
npm run db:check -- --remote
```

Ahora `platform_admins` debe valer **1**; las otras tablas deben seguir vacías. No repitas el alta después de que termine correctamente. Si el archivo local ya existe, la herramienta no lo sobrescribe: conserva el archivo y la contraseña de esa generación.

## 6. Configurar la firma de sesiones

Genera una clave aleatoria:

```cmd
node tools/generar-clave.mjs
```

Copia la cadena completa que aparece. Después ejecuta:

```cmd
npx wrangler secret put ADMIN_SIGNING_SECRET
```

Cuando te pida el valor, pega la cadena. Este secreto **no es la contraseña del superadministrador**. No lo pegues en `wrangler.toml`, el código o un repositorio. Guarda una copia segura para operación y recuperación.

Si Wrangler pregunta si debe crear el Worker `porton-saas-nuevo`, acepta: el código completo se publicará en el paso siguiente. Cambiar esta clave más adelante invalida las sesiones existentes. [Referencia de secretos](https://developers.cloudflare.com/workers/configuration/secrets/).

## 7. Verificar y desplegar

```cmd
npm run build
npm test
npx wrangler deploy --dry-run
npm run deploy
```

`build` regenera `src/html/client.js` a partir de `client-runtime.js`. La fuente de navegador se conserva como texto literal para evitar el fallo anterior que dejaba vacíos los formularios al empaquetar.

`npm test` debe aprobar las 23 pruebas incluidas. `deploy --dry-run` comprueba el empaquetado sin publicar. `npm run deploy` genera la interfaz y publica el Worker.

Cloudflare mostrará una dirección similar a:

```text
https://porton-saas-nuevo.TU-SUBDOMINIO.workers.dev
```

**Usa la dirección exacta que devuelva tu despliegue**, no el ejemplo anterior.

## 8. Comprobar el acceso

Abre la dirección del Worker seguida de `/platform`:

```text
https://DIRECCION-REAL-DEL-WORKER/platform
```

Entra con el usuario y la contraseña del paso 5. Debes ver la plataforma con la barra lateral y una lista de edificios vacía.

La dirección `/health` debe responder con `ok: true`. Solo comprueba que responde el servidor; no comprueba motores ni portones. La raíz `/` no es la pantalla de acceso: utiliza `/platform` o la página de un edificio.

## 9. Conectar porton.inomali.com

Hazlo después de comprobar la dirección `workers.dev`.

En `wrangler.toml`, activa las tres líneas del final quitando `#`:

```toml
[[routes]]
pattern = "porton.inomali.com"
custom_domain = true
```

La zona `inomali.com` debe estar activa en la cuenta de Cloudflare correspondiente. Si `porton.inomali.com` sigue asignado al Worker anterior, desvincula **solo ese dominio o ruta** del Worker anterior desde su configuración antes de asociarlo al nuevo. Esto cambia el destino del tráfico de ese dominio; no elimina la base anterior.

Después:

```cmd
npm run deploy
```

Comprueba `https://porton.inomali.com/platform`. Cloudflare administra el DNS y certificado del dominio personalizado; si aparece un conflicto con un registro o asignación existente, resuelve el conflicto específico mostrado antes de continuar. [Referencia de dominios personalizados](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## 10. Crear un edificio real

Dentro de plataforma:

1. Entra en **Edificios → Crear edificio**.
2. Introduce el nombre y un identificador simple, por ejemplo `casa-pablo`.
3. Pon nombre al primer portón.
4. Introduce su URL HTTPS de activación y selecciona GET o POST según tu integración.
5. Define usuario y contraseña para el administrador de ese edificio.
6. Guarda. Su página pública será `/t/casa-pablo` y su panel `/t/casa-pablo/admin`.

En **Administrar** puedes agregar más portones, editar configuraciones, desactivar accesos, crear usuarios y asignar permisos.

El administrador del edificio puede usar todos sus portones activos. Los demás usuarios solo pueden usar los portones que tengan asignados. Cada código nuevo guarda su portón específico.

## 11. Crear la demo para clientes — opcional

Cuando ya tengas definida la dirección definitiva de la aplicación:

```cmd
node tools/crear-demo.mjs https://porton.inomali.com .private/demo
```

Si todavía usas `workers.dev`, sustituye la URL por la dirección real del Worker. La URL se usa para simular aperturas y para construir los enlaces compartidos.

Importa el SQL generado una sola vez:

```cmd
npx wrangler d1 execute porton-saas-db-nueva --remote --file .private/demo/crear-tenant-demo.sql
```

Abre `.private/demo/ACCESOS.md` para consultar el enlace y la contraseña generada. El tenant es `residencial-demo` e incluye tres portones, cuatro usuarios, diez códigos y 28 registros de muestra. El código `120101` es reutilizable.

Las aperturas de la demo se simulan internamente y no activan hardware. No sustituyas sus URLs por las de portones reales mientras compartas sus credenciales. Los cambios que haga un cliente en esa demo persisten y son visibles a los demás clientes que utilicen la misma cuenta. La demo no se reinicia sola.

## 12. Prueba de funcionamiento

Antes de entregar acceso real:

- Confirma que los formularios aparecen y que puedes iniciar sesión con usuario o correo.
- Crea un código para cada portón y comprueba que activa el correcto.
- Prueba un usuario con permiso para un solo portón.
- Verifica un código de un uso, uno vencido y uno revocado.
- Revisa el historial: fecha, portón y resultado deben ser correctos.
- Prueba el menú y los formularios desde un celular.

Una respuesta satisfactoria de la integración muestra **“Orden de apertura enviada”**. Sin un sensor no se puede confirmar el movimiento físico. Si falla la respuesta, el código queda en revisión; desde plataforma se puede cerrar o permitir otro intento después de comprobar qué ocurrió. No se reintenta automáticamente.

## 13. Desarrollo local — opcional

Estos comandos usan una base local independiente, sin modificar la remota:

```cmd
node tools/preparar-local.mjs
npx wrangler d1 execute porton-saas-db-nueva --local --file database/schema.sql
npx wrangler d1 execute porton-saas-db-nueva --local --file .private/crear-superadmin.sql
npm run dev
```

El script crea una clave local en `.dev.vars` y no sobrescribe el archivo si ya existe. Abre la dirección local que muestre Wrangler y añade `/platform`.

Para modificar el aspecto, edita `src/html/shared.js` y `src/html/client-runtime.js`. Después ejecuta `npm run build`. No edites manualmente `src/html/client.js`: es un archivo generado.

Para repetir la prueba de navegador:

```cmd
npx playwright install chromium
npm run test:ui
```

La prueba utiliza datos en memoria e intercepta las solicitudes; no abre portones reales.

## 14. Respaldo y operación

Antes de cambios importantes:

```cmd
npx wrangler d1 export porton-saas-db-nueva --remote --output respaldo-antes-cambio.sql
```

El respaldo contiene datos privados. Consérvalo fuera del repositorio. No publiques `.private`, `.dev.vars`, exportaciones ni credenciales.

El cron limpia intentos vencidos, marca códigos caducados y conserva 30 días de historial de órdenes. Los códigos se muestran en páginas de 100, con búsqueda exacta y filtro de estado. Hay una cuota de 200 códigos vigentes por usuario y 20,000 registros por edificio. El historial y la auditoría muestran los últimos 200 registros; las métricas de 24 horas se calculan sobre todos los registros correspondientes.

Revisa el uso de CPU y D1 de tu plan, especialmente el inicio de sesión con hashing. No se garantiza el costo o capacidad del plan gratuito. [Límites de D1](https://developers.cloudflare.com/d1/platform/limits/).

## 15. Si aparece un error

| Mensaje o síntoma | Qué comprobar |
|---|---|
| `no such table` | Que aplicaste `database/schema.sql` a la base correcta y que el binding DB apunta a esa misma base. |
| `table already exists` | La base no está vacía o ya aplicaste el esquema; no repitas sin revisar. |
| `UNIQUE constraint failed` | La cuenta o el tenant puede existir ya; no repitas el alta a ciegas. |
| `EEXIST` al generar una cuenta/demo | El archivo de salida ya existe. Conserva los archivos y accesos generados anteriormente. |
| `D1_RESET_DO` | Es un fallo de D1/importación. Consulta el estado antes de repetir escrituras; no lo confundas con una instalación completada. |
| Usuario o contraseña incorrectos | Comprueba el correo/usuario exacto, la contraseña generada, la importación del SQL y la base seleccionada. |
| Formulario en blanco | Ejecuta `npm run build`, despliega el paquete completo y recarga. No mezcles versiones antiguas de los archivos de interfaz. |
| Código en revisión | Comprueba si se ejecutó la orden física. Usa Resolver desde plataforma antes de permitir otro intento. |
| Fallo HTTP del proveedor | Revisa la URL y método del portón. No publiques las URLs completas: pueden contener tokens. |

No se incluyó un borrado automático de la base. Para empezar de cero, esta guía utiliza una base nueva y mantiene la anterior disponible para recuperación.
