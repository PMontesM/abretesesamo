# Mantenimiento y conservación

- La recuperación MQTT se comprueba una vez por edificio y petición HTTP. La caché solo existe durante esa petición; no se comparte entre usuarios o peticiones. Los cambios y las reservas siguen siendo atómicos en D1.
- La pausa y la caducidad MQTT se definen en src/lib/access-policy.js. La frescura de una observación del dispositivo es una regla distinta.
- Si se perdió una respuesta, el siguiente gesto de apertura consulta la orden anterior sin activar el relé. Si sigue pendiente, espera. Si ya se confirmó, muestra ese resultado. Si terminó sin confirmación, ese mismo gesto puede crear una nueva orden. Nunca se reenvía nada en segundo plano ni por un temporizador.
- Las solicitudes nuevas del panel incluyen su fecha de creación y vencen a las 24 horas. Una solicitud antigua cuyo registro ya se eliminó no puede convertirse en una apertura nueva. Las órdenes antiguas todavía guardadas se consultan por su identificador; el cliente reconoce también identificadores guardados por la versión anterior.
- El mantenimiento existente conserva 30 días de historial operativo, órdenes concluidas y alertas que ya no bloquean. Conserva 90 días de auditoría administrativa. No elimina reservas pendientes ni incidencias que aún bloquean una integración externa, ni sus registros asociados.
- La limpieza se ejecuta en el mantenimiento programado existente. No se necesita vaciar la base ni añadir otro servicio. Los respaldos cifrados tienen su propia retención; la copia diaria de GitHub no sustituye guardar los cambios del código en el repositorio.
- Publicar el Worker y guardar el código en GitHub son pasos separados. Antes de subir código se revisan los archivos incluidos y se excluyen .private, contraseñas, respaldos y archivos de entorno.
