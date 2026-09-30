# Capa temática exclusiva y leyenda exportada

## Auditoría y criterio
Las capas del catálogo temático se almacenan en `state.userLayers` y se agrupan en los seis fenómenos por `resolveLayerCategory`. Son exclusivas entre sí. El código del fenómeno no se infiere del título (SE 02 está registrada con categoría geológicos en el catálogo consultado).

No entran en la selección: `staticLayers` (estado y municipios), fondos, GOES, etiquetas, vialidades, herramientas internas ni `uploadDraft.previewLayers`. La vista temporal de revisión `previewLayerId` mantiene su tratamiento independiente. Las vistas publicadas abiertas desde acciones del catálogo pasan también por `toggleLayerVisibility`.

- Activación: `toggleLayerVisibility`, `activeLayerStack`, `renderedLayers`, `visibleSnapshot`.
- Fuentes: `source-${id}`, `source-${id}-raster`, `imageSourceIds`; layers `${id}-fill/-line/-point/-point-icon/-raster` e `imageLayerIds`.
- Limpieza: `removeLayerBundle`, `closePopupForLayer`, `closeFloatingLegend`, actualización del catálogo y sus checkbox/contador.
- Descargas: `ensureLayerResourcesLoaded` → `fetchLayerResource`/`loadProcessedGeoJsonForLayer`; iconos `ensurePointIconImagesForLayer`/`loadPointIconImage`; imágenes georreferenciadas `addImageLayerToMap`. MapLibre administra las peticiones de imagen al retirar las fuentes.
- Opacidad: `updateLayerOpacity` mantiene su actualización mediante requestAnimationFrame; no se modifica el comportamiento por rol.
- Sesión: los reinicios explícitos invalidan tickets; las respuestas privadas mantienen además `privateResourceEpoch`. No se modifican autenticación ni permisos.
- Catálogo: la sincronización invalida objetos anteriores y vuelve a activar únicamente la selección superviviente.

## Sustitución y concurrencia
Una selección crea un ticket y aborta inmediatamente el anterior. Se retiran fuentes/layers, popup, leyenda y estado pendiente antes de cargar la siguiente. La carga nueva no espera a la anterior. GeoJSON usa signal y timeout de 30 segundos; los iconos conservan su timeout existente y comprueban el ticket antes de registrar imágenes y resultados. Los finally antiguos solo limpian su propia promesa. Una cancelación por sustitución no muestra error. Un error de la selección actual la desactiva y conserva el mensaje real.

Se conservan las URL de imágenes cacheadas al sustituir una capa para poder reactivarla; los borrados y la limpieza privada continúan revocándolas. No se confunde caché de recursos con una fuente visible.

## Persistencia
`egem-thematic-selection-v1` guarda un solo ID backend (o null). Las preferencias de opacidad y referencias permanecen en su clave anterior; se eliminan los flags de visibilidad temática de esa lista. Al migrar el formato antiguo se toma la última entrada válida marcada visible: el formato antiguo no registraba una fecha de selección, por lo que ese es el único orden recuperable. Los IDs ausentes se eliminan. Los reinicios explícitos de sesión conservan su política de apagar temáticas.

## Snapshot y composición
`captureThematicExportSnapshot` copia datos canónicos, no HTML: título, recursos, geometría, leyendas vector/raster, colores y etiquetas, opacidad, GOES, base, bearing y pitch. La copia es recursivamente inmutable. Los símbolos puntuales editados se copian del registro MapLibre para conservar exactamente forma, relleno y contorno.

El PNG exige una capa lista: si está cargando o tiene un error, no exporta una leyenda incompleta. La escena temporal copia estilo, cámara e imágenes sincrónicamente antes del primer await. Un cambio de selección posterior no cambia ni su leyenda ni sus fuentes. Los errores propios de la escena temporal siguen bloqueando la descarga.

Título completo centrado en un recuadro inferior derecho, anclado al rectángulo calculado de créditos con separación de 12 px. Fondo compartido EXPORT_ANNOTATIONS.creditBackground al 38 %, dibujado una sola vez; título de 21 px y etiquetas de 17 px en el formato habitual, con mínimo de 16 px. Símbolos de 22 px, relleno interno de 14 px, separación símbolo-etiqueta de 8 px y radio de 6 px. Cada columna tiene un origen fijo para símbolos y otro para etiquetas, con sangría constante en las líneas adicionales. Las columnas se miden independientemente con measureText y se centran como conjunto; las filas no se centran individualmente. Una columna para hasta seis clases cuando cabe; dos para más clases cuando reducen al menos 25 % la altura, sin reducir la fuente. Hasta tres columnas como alternativa para contenidos extensos. Orden por columnas y palabras completas. Sin scroll, truncamiento ni clases ocultas. Raster sin metadatos reales o contenido que no cabe genera un error explícito. Sin temática no se dibuja bloque alguno. Se conservan norte, franja inferior, formato 2047 × 1576 y descarga/cancelación.

## Catálogo auditado
30 capas públicas accesibles. Máximo observado: 10 clases, SE 02. SE 6.1 no está en este catálogo público; no se inventó evidencia ni se subió una copia. Raster, GroundOverlay, mixta, títulos extensos y 65 clases se prueban con datos sintéticos solo en memoria del navegador, fuera del repositorio.

La auditoría no equivale a revisar capas privadas inaccesibles. Las pruebas verticales son del compositor aislado; no añaden una opción al diálogo público.

## Recuadro ajustado al contenido
El ancho es max(título medido tras envolver, suma de anchos reales de columnas + separaciones) + dos paddings, limitado al espacio disponible. Una columna mide max(símbolo + separación + etiqueta envuelta); cada columna conserva su propio ancho. El alto suma dos paddings, líneas reales del título, separación posterior si hay clases, y la altura de la columna más alta (filas medidas y separaciones solo entre filas). No se añade separación después de la última fila.

En píxeles de salida: ancho mínimo 112, máximo 640 (además limitado por canvas), padding 14, separación entre columnas 20, entre símbolo y etiqueta 8. El título usa un ancho preferido de envoltura de 360 px cuando supera el conjunto de columnas; esto no fija el ancho final del recuadro. Las etiquetas largas se envuelven por palabras sin elipsis. Si no cabe una palabra completa o la leyenda, se conserva el error explícito; no se omite contenido.

SE02 pasa de 500×228 a 385.16×222 px, con diez clases y dos columnas. Una clase corta pasa de 360×91 a 204.79×85 px. El margen inferior interno real es 14 px. Los laterales pueden ser mayores cuando el título supera el conjunto de columnas: es espacio necesario para el título centrado, no ancho fijo. Los créditos determinan la posición y el mismo borde derecho, con separación de 12 px; se mantienen las comprobaciones de colisión con marca, escala, norte y EGEM.

Sin temática no se reserva ni dibuja nada. Con título pero sin clases válidas (etiquetas vacías descartadas), se muestra solo el título en un recuadro medido, sin símbolos inventados ni separación para filas ausentes. Esta variante mide 191.39×53 px en la evidencia sintética. Las pruebas verticales siguen siendo del compositor aislado, no una nueva opción del diálogo público.

## Preparación e iconos recuperables
El clic de exportación congela GOES y bloquea la interfaz, inicia el selector nativo dentro del gesto y espera la activación pendiente antes de copiar la leyenda y la escena. La espera de preparación está acotada a 45 segundos; un cambio de capa o cámara durante ella cancela/rechaza la captura. El snapshot definitivo continúa siendo inmutable y se copia junto con estilo e imágenes antes del primer await de la escena temporal.

Los iconos PNG usan fetch cancelable y decodificación ImageBitmap, con límite de 6500 ms para HTTP, cuerpo y decodificación conjuntamente. No se amplía el timeout anterior: al agotarse aborta la petición y se intenta una recuperación determinista. La etapa queda en el diagnóstico resumido de la capa, sin logs por feature. ImageBitmap no admite abortar su decodificación; si termina tarde, se cierra y se descarta. Los timers y listeners se retiran al resolver, rechazar o cancelar. Las peticiones simultáneas comparten trabajo y los éxitos se guardan en una caché acotada de 64 recursos decodificados; cancelar el último consumidor aborta la petición. No se cachean fallos. La escena de exportación copia las imágenes registradas, sin descargarlas de nuevo.

Solo las clases canónicas identificadas como Manantial o Pozo admiten recuperación local: círculo y triángulo respectivamente, usando displayColor, originalColor, color y finalmente el color predeterminado. Se reutiliza el generador institucional de símbolos puntuales; no se modifican identidad, etiquetas, propiedades persistidas ni geometrías. Un icono desconocido o un fallo del generador/registro conserva el error y bloquea el PNG. La recuperación queda registrada como canonical-local con su error original y etapa. Tras desactivar/reactivar se puede volver a intentar el recurso remoto; durante exportaciones consecutivas se reutiliza el registro del mapa.
