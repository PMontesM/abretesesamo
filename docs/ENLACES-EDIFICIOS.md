# Enlaces de edificios

El formulario Nuevo edificio genera una vista previa a partir del nombre. Por ejemplo, “Torre Álamos” produce `/t/torre-alamos`. Se eliminan acentos y símbolos, se separan las palabras con guiones y se limita el identificador a 64 caracteres.

Si el enlace ya existe, el servidor añade `-2`, `-3`, etc. La vista previa es orientativa; al guardar se muestra el enlace definitivo. La restricción única de la base de datos también protege las creaciones simultáneas. Un fallo en la creación revierte edificio, portón, usuario y auditoría en la misma transacción.

Personalizar enlace permite elegir otro identificador. En este modo se valida que sea único y contenga letras minúsculas, números y guiones entre palabras; un duplicado se informa sin modificar silenciosamente la elección. Usar enlace automático vuelve a generar el enlace a partir del nombre.

Los enlaces de edificios existentes permanecen iguales. Cambiar el nombre no regenera el enlace. Esta actualización no necesita migraciones ni modifica los datos guardados.

Validación: 64 pruebas automáticas y verificación en navegador, incluyendo enlaces automáticos, personalizados, duplicados y colisiones simultáneas.
