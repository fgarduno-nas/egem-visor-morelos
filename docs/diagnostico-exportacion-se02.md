# Corrección de exportación PNG con SE 02

## Problema y solución

El cargador llamaba `map.loadImage(url, callback)`, pero MapLibre 4.7.1 devuelve una promesa con `response.data`. Por ello una descarga correcta podía terminar en un falso timeout de 6.5 segundos y bloquear la exportación. Se consume la promesa, se conservan los errores reales y se manejan las respuestas tardías.

Antes de crear el mapa temporal se esperan las cargas pendientes de capas e iconos. Se reutilizan las imágenes registradas y se reintentan una vez las que faltan; el mapa temporal copia sus bytes. Una respuesta fallida sigue bloqueando la descarga, sin ocultar puntos faltantes. GOES permanece congelado durante la preparación y captura.

La extensión vertical con inclinación podía mostrar filas transparentes porque el horizonte artificial de MapLibre recortaba terreno todavía proyectable. Se extiende el plano lejano solo del mapa temporal y se usa el nivel de detalle distante existente para raster. La proyección, cámara y detalle de vectores y símbolos se conservan. Si la imagen alcanza el horizonte geométrico real, se rechaza explícitamente y se propone reducir la inclinación. El adaptador depende de MapLibre 4.7.1 y requiere revisar estas pruebas al actualizarlo.

## Límites y diagnóstico

- Icono: 6.5 s. Captura incluida preparación: 45 s. Render: 25 s. Codificación PNG posterior: 20 s.
- Cancelación y errores no descargan una imagen incompleta.
- `performance.measure` registra recursos, escena, render, codificación y total bajo `egem:export:*`.
- Los diagnósticos de iconos incluyen duración y ruta de carga sin registrar credenciales.
- Se conservan 2047 × 1576, centro, orientación, escala, extensión horizontal, logotipo al 100 %, fecha y hora de Morelos, barra de escala sin «al centro» y créditos compactos. La variante vertical móvil queda fuera de alcance.
- CARTO sigue sujeto a su clave API; no se sustituye el mapa base ni se incorpora una clave.

## Validación previa a publicación

Suite completa: 263 pruebas aprobadas. Pruebas nuevas cubren la API Promise, rechazo HTTP/CORS, timeout, rechazo tardío, cancelación, codificación PNG y recorte/LOD sin alterar vectores ni centro. También se ejecutan `node --check` y `git diff --check`.

Se realizaron tres exportaciones locales con datos de SE 02 consultados en el catálogo real de producción y GOES activo. Cada PNG conservó 220 Manantiales y 643 Pozos: 863 instancias, 859 posiciones distintas por coordenadas coincidentes. Se comparó el multiconjunto de puntos, identificadores y bytes RGBA, además de inspección visual. El error máximo de proyección fue 2.33e-11 píxeles CSS, descontando el desplazamiento vertical propio del formato. Totales internos: 14.32, 11.29 y 14.74 s; predominó la codificación.

Los dos iconos originales respondieron HTTP 200, image/png, con CORS para el origen público. Eso demuestra disponibilidad actual, no cuál fue la respuesta durante el incidente original. No se reprodujo el éxito espontáneo del segundo intento con el cargador anterior.

La prueba local inclinada de 60° pasó de 58 filas superiores transparentes a cero. Una repetición adicional con el catálogo remoto fue bloqueada por `satellite-source / Failed to fetch`; no se entregó un PNG incompleto. La validación publicada debe distinguir este fallo externo de la carga de iconos y repetir la captura inclinada si el proveedor está disponible.

Una prueba controlada con HTTP 403 bloqueó la exportación; al recuperar los recursos se descargó el PNG con los 863 puntos. No hubo cambios de backend ni de registros de producción. Las capturas, galerías y herramientas temporales de diagnóstico no forman parte del código publicado.
