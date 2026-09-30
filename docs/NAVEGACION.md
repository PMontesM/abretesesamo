# Navegación de los paneles

Los paneles de residente, administrador de edificio y superadministrador muestran una sola sección principal a la vez. Los menús laterales y la barra móvil usan la misma navegación; ya no desplazan hasta otra sección de una página larga.

La sección se guarda en `?section=...`, por lo que se puede recargar, compartir la dirección y usar Atrás/Adelante. Se conservan los enlaces antiguos por `view` y fragmentos reconocidos. El menú resalta la selección, cierra el panel móvil y lleva el foco al encabezado sin animar un desplazamiento por otras secciones. Los diálogos de acciones y configuración conservan su funcionamiento.

`frontend/src/navigation.js` concentra este comportamiento. La selección de edificio sigue abriendo el panel correspondiente y aplicando sus permisos. No cambia la base de datos ni el control de relés.

Validación: `tests/navigation-ui.mjs` verifica los tres roles, enlaces directos, recarga, historial del navegador, una sola vista visible y navegación móvil. Los otros recorridos de interfaz comprueban códigos, permisos y aperturas simuladas.
