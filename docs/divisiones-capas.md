# Organización institucional de capas

## Contrato final

Base del trabajo: `3a9f6d1df13907bb96f33d03328691b2a9bcf973`.
Rama local: `codex/implementar-divisiones-capas`.

Las raíces temáticas son Peligro, Vulnerabilidad y Riesgo, en ese orden.
Límites y Cartografía son grupos de referencia separados después de esas secciones.

- Peligro: Geológicos, Hidrometeorológicos, Químico-tecnológicos,
  Sanitario-ecológicos, Socio-organizativos y Astronómicos.
- Vulnerabilidad: capas directas, sin fenómeno ni acordeón intermedio.
- Riesgo: Geológicos, Hidrometeorológicos y Químico-tecnológicos exclusivamente.

`shared/division-utils.js` define la matriz. Las etiquetas y alias se obtienen de
`shared/phenomenon-utils.js`. Formulario, catálogo, DTO, filtros y validaciones
consumen esos módulos. `shared/division-sql-contract.js` serializa ese contrato
para PostgreSQL; una prueba compara el bloque incrustado en la migración y
rechaza divergencias. El SQL no mantiene otra lista manual de combinaciones.

## Carga y API

El tipo de capa permite separar temáticas de Límites y cartografía. Para una
temática primero se exige Sección. Peligro y Riesgo muestran un selector de
fenómeno obligatorio con seis o tres opciones. Vulnerabilidad oculta y deshabilita
ese selector; limpia selección, estado, preview y payload. Cambiar sección elimina
un fenómeno incompatible. Volver desde Vulnerabilidad exige una selección nueva.
No se usa “No aplica” como dato técnico. El botón de carga permanece deshabilitado
hasta cumplir clasificación y selección de archivo.

Las referencias no solicitan sección ni fenómeno temático. Límites y Cartografía permanecen separados. Conservan su categoría
técnica de referencia (`category:limites` o `category:otras`) y sección nula.
El backend valida la matriz en Zod y nuevamente en el servicio. Acepta la
clasificación explícita existente en tags `category:`; también valida los campos
phenomenon/phenomenonKey si se envían. No admite valores ocultos incompatibles.
Vulnerabilidad se guarda sin esos campos y sin tags de categoría.

Los DTO devuelven divisionKey/division y phenomenonKey/phenomenon. Vulnerabilidad
lleva ambos campos de fenómeno nulos. Las referencias tienen clasificación
temática nula y `referenceCategory` permite mantener su ubicación independiente.
Se conservan las proyecciones seguras de metadata y los permisos existentes.

## Migración única no publicada

`202609300001_layer_division` es la única migración de esta funcionalidad.
Las dos migraciones de la iteración anterior solo se habían aplicado a bases
sintéticas locales; fueron sustituidas antes de publicar. No se debe editar una
migración una vez publicada. Las bases y recursos temporales de validación se
eliminaron al finalizar las pruebas.

La migración final parte del esquema publicado. Dentro de BEGIN/COMMIT bloquea
Layer y LayerMetadata, prevalida todas las filas, añade division nullable,
CHECK e índice, y asigna hazard a las seis categorías históricas. No inventa
Vulnerabilidad ni Riesgo. Las referencias conservan null. Solo modifica la nueva
columna: mantiene fechas, archivos, estilos, leyendas, metadata, propietarios,
estados y número de filas. No reprocesa recursos ni toca uploads.

La categoría procede exclusivamente de phenomenon/category/theme/topic y tags
category: explícitos, en la raíz de properties o contenedores históricos
metadata/properties. Los alias se normalizan usando el contrato generado. Todos
los candidatos deben resolver a una categoría única y reconocida; una categoría
ausente, desconocida o contradictoria aborta antes del backfill. Nunca se usan
títulos, descripciones, geometrías, nombres de archivo o tags libres para inferir
la clasificación. SE 02 conserva la categoría Geológicos que tiene registrada.

Por autorización expresa del usuario, existe una excepción histórica limitada a
`cmqs7uli10003l3dgilbk7jhm`, `cmqs8d6mt0003l3p1nzmrq8cg` y
`cmqsf108j0003l3tkmx3k7ch4`. Son tres registros eliminados lógicamente y sin
categoría técnica. La migración comprueba sus IDs exactos, que sigan eliminados y
que no tengan ningún marcador de fenómeno o categoría; únicamente les asigna
`division = vulnerability`. El fenómeno continúa nulo. No cambia su estado,
metadata, archivos, propietario, fechas ni relaciones, y no reaparecen en el
catálogo público. Los títulos no intervienen: cualquier otro registro ambiguo,
incluso con un título similar, detiene la migración. El auditor informa estos
tres overrides por separado y deja visibles las demás ambigüedades.

No procede NOT NULL global en division ni en fenómeno: Vulnerabilidad carece
de fenómeno y las referencias carecen de ambos. El fenómeno se conserva en el
modelo actual de metadata, sin duplicarlo en otra columna. Triggers diferibles
al cierre de la transacción validan la matriz entre Layer y LayerMetadata,
incluyendo cambios y eliminación de metadata. Las escrituras anidadas de Prisma
se validan al completar su transacción; una eliminación física con cascada sigue
permitida. Vulnerabilidad rechaza clasificación explícita, incluso desconocida.
Prisma registra la migración y una segunda ejecución no repite la transición.

## Catálogo y administración

El catálogo presenta Sección → Fenómeno → Capa para Peligro y Riesgo, y
Vulnerabilidad → Capa. Las nueve agrupaciones de fenómenos permanecen visibles,
incluso vacías. No hay una cuarta raíz temática. La búsqueda conserva abierta
la ruta encontrada, no duplica capas y respeta selección exclusiva temática,
referencias simultáneas, persistencia, opacidad, descarga, borrado autorizado,
popups, leyenda y GOES.

Administración muestra Sección, Fenómeno y Ubicación. El detalle de una referencia
muestra No aplica en los dos primeros campos y Límites o Cartografía en Ubicación.
El filtro Sección controla las opciones del filtro Fenómeno: seis, ninguna o
tres; Vulnerabilidad lo limpia y deshabilita. Sin sección se muestra la unión.
Se mantiene la paginación 10/20/50, permisos, retorno, acciones y diseño previo.
No se añade columna de procesamiento. El PNG mantiene su composición aprobada y
no incluye clasificación institucional adicional.

## Validación y límites

La suite completa no debe bajar de 437 pruebas. Se ejecutan `node --test`,
`node --check` sobre módulos y pruebas afectados, y `git diff --check`.
`tests/division-matrix.test.mjs` cubre cada combinación y cambio de sección.
`tests/division-migration-postgres.cjs` exige PGHOST loopback, PGPORT, PGUSER y
DIVISION_REVIEW_DIR externo, crea PostgreSQL temporal y conserva 8/8 fixtures,
metadata, archivos y propietarios. Comprueba rollback y restricciones.

`tests/divisions-browser.cjs` usa DIVISION_REVIEW_URL, DIVISION_REVIEW_DIR y
credenciales sintéticas DIVISION_TEST_EMAIL/DIVISION_TEST_PASSWORD. Comprueba
1920×1080, 1366×768 y 390×844, catálogo, formulario, selección, filtros, detalle,
recarga, ausencia de errores de consola y overflow de página. La tabla móvil
conserva su scroll propio; el encabezado compacto preexistente no se rediseña.
La regresión de exportación exige SE 02 con diez clases, 220 Manantiales,
643 Pozos, 2047×1576 y GOES congelado, sin cambiar la cámara.

La auditoría pública anterior encontró 30 capas con clasificación explícita
consistente. No se inspeccionó inventario privado de producción y no se migró
producción: una publicación futura exige revisar su clasificación completa;
cualquier fila ambigua debe bloquearla. SE 6.1 no estuvo disponible. CARTO
mantiene su requisito de clave y OSM se usa solo en pruebas de fondo claro.
Evidencias, servidores y credenciales sintéticas están fuera del repositorio.
La compatibilidad y el orden requerido para una futura publicación se documentan en `validacion-transicion-divisiones.md`.
