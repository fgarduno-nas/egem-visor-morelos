# Detalle administrativo de capas

## Auditoría del formulario y contrato

Base de esta implementación local: `d0e81f0491a3e9d5170f2ac78bc7272d5211312a`, por petición expresa. Es anterior a la publicación `4c2a2999c6da6cf3e454106deb1815d0860ee2a7`; estos cambios aún no se han integrado con ella.

Se revisaron `index.html`, `collectUploadMetadata`, `uploadFilesToBackend`, los editores de leyenda en `js/map.js`, `buildLayerUploadFormData`, schemas/controller/service de capas, modelos Prisma Layer/LayerFile/LayerMetadata, importadores y normalización de simbología.

El formulario contiene ocho campos de texto, un selector de fenómeno, selección de archivo y el editor de leyenda. No contiene entradas independientes para etiquetas ni observaciones. `tags` se construye automáticamente con `category:<fenómeno>`. El tipo de símbolo y el orden se detectan/normalizan; no existen selectores independientes para editarlos en este formulario.

| Campo real | Persistencia | DTO administrativo | Etiqueta del detalle |
|---|---|---|---|
| Nombre | Layer.title (nombre de archivo si vacío) | title | Nombre de la capa |
| Fenómeno | LayerMetadata.properties.tags | phenomenon / phenomenonKey | Fenómeno normalizado |
| Descripción | Layer.description | description | Descripción |
| Municipio o cobertura | Layer.municipality | municipality | Municipio o cobertura |
| Fuente | properties.source | source | Fuente |
| Dependencia responsable | properties.responsibleAgency | responsibleAgency | Dependencia responsable |
| Fecha de actualización (texto libre) | properties.updatedAt | sourceUpdatedAt | Fecha de actualización de los datos |
| Escala o resolución | properties.scaleOrResolution | scaleOrResolution | Escala o resolución |
| Sistema de referencia | properties.crs | capturedCrs | Sistema de referencia capturado |
| Archivo seleccionado | LayerFile.originalName / extension | files[].originalName / extension | Archivo original / Formato o extensión |
| Título de leyenda | properties.vectorLegend.field o rasterLegend.field | symbology.vector/raster.title | Título junto a la leyenda |
| Nombre visible de clase | *.classes[].displayLabel | *.classes[].label | Nombre junto a muestra |
| Color visible de clase | *.classes[].displayColor | *.classes[].color | Muestra de color y código |
| Tipo y orden revisados | *.classes[].symbolType, geometryRole, order/displayOrder | *.classes[].symbol / order | Forma y orden de clase |

`properties` abrevia `LayerMetadata.properties`. El DTO no entrega ese objeto completo. Grupo, intervalo y valor de clase se muestran cuando ya existen. Los originales se presentan únicamente cuando difieren de los personalizados. No se ofrecen enlaces a archivos privados.

## Causas y solución

El detalle anterior omitía descripción completa y varios metadatos ya persistidos. El DTO contaba únicamente arreglos o `items`, aunque los parsers guardan leyendas como objetos con `classes`. Ahora proyecta explícitamente clases y datos seguros. No se reconstruyen leyendas leyendo archivos internos para aparentar datos capturados que faltan.

La tabla pasa de ocho a siete columnas. Se conserva `processingStatus` y su filtro, incluidos registros pendientes/fallidos/no visualizables. Los estados de carga, error y vacío usan colspan 7. El procesamiento y su explicación segura están en Información técnica.

El editor raster envía `displayLabel` y `displayColor`, pero `parseRasterLegend` los descartaba. Ahora se conservan como propiedades JSON adicionales, manteniendo `label`, `color`, valores y orden originales. No requiere migración. No se pueden recuperar personalizaciones históricas ya descartadas. El máximo de `updatedAt` del schema pasa de 30 a 40 para coincidir con el formulario existente.

El CRS capturado (que puede incluir el valor predeterminado/autodetectado del flujo existente) se distingue del CRS procesado. La fecha libre del dato se distingue de la fecha de modificación del registro. Las fechas de registro se presentan en es-MX y America/Mexico_City.

## Seguridad y compatibilidad

La ruta real `/api/v1/layers/admin` conserva autenticación y autorización exclusiva ADMIN; DATA_PROVIDER sigue correspondiendo al rol visible Director. El DTO admite únicamente campos explícitos; las clases no contienen URLs, iconHref, rutas, diagnósticos ni secretos. Los nombres de archivo se reducen al nombre base. Los fallos de procesamiento se explican mediante mensajes de estado predefinidos, nunca interpolando el diagnóstico interno.

Las formas conocidas se representan mediante SVG local con colores hexadecimales validados. Un icono arbitrario embebido sin forma conocida se identifica como «Icono original (sin vista previa)»: no se reemplaza por una forma inventada ni se publica su archivo privado. Capas antiguas sin datos muestran «No especificado»; no se asume vectorial cuando no hay evidencia de tipo. Raster, vectorial y mixto muestran únicamente las leyendas aplicables.

La navegación conserva foco, realce temporal y retorno a la fila. El tamaño de página conserva la selección si sigue presente. El detalle usa tres/dos/una columnas en escritorio ancho/mediano/móvil. No se modifica la tabla de usuarios, los permisos, el mapa, popups, eliminación ni normalización compartida de fenómenos.

## Validación

Las pruebas `admin-layer-details.test.mjs` cubren representación, vacíos, escape de contenido, formas, leyendas y estructura de tabla. `admin-layer-details-http.test.mjs` ejecuta el router, middleware y servicio reales contra Prisma sustituido en memoria: 401 sin token o inválido, 403 Visitante/Director y 200 Administrador; paginación 10/20/50, filtro y DTO sin secretos.

La fixture de revisión y las capturas se mantienen fuera del repositorio. La API de prueba no conecta a PostgreSQL ni modifica producción. Las dependencias existentes se resuelven mediante un loader externo, sin instalar ni enlazar dependencias en este worktree.

Esta modificación incluye backend: una futura publicación necesitará desplegar el DTO y la preservación de personalizaciones además del frontend, después de integrar con el remoto actual y volver a validar. En esta tarea no se realiza despliegue, migración ni modificación de datos reales.
