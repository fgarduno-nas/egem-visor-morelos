# Validación de transición institucional

La ruta de un archivo procesado es `uploads/processed/<id>/layer.geojson`.
`layer-processing.service.js` persiste `processedGeojsonPath` y construye
`processedGeojsonUrl` con `buildPublicFileUrl`. El DTO público expone la URL,
que `hydrateBackendLayer` utiliza para descargar la geometría al activar la capa.
El middleware real `/uploads/*` resuelve la ruta bajo `UPLOAD_BASE_DIR` y verifica
la capa, su estado, procesamiento, eliminación y permisos. La base de API en
`runtime-config.js` proviene de la configuración del HTML; no es una raíz de assets.

El 404 del montaje anterior se debía a un `storagePath` inventado,
`release/fixture.geojson`, y a la ausencia de `processedGeojsonUrl`. El constructor
de URL preservaba esa ruta incorrecta. La corrección pertenece exclusivamente a
pruebas: cada proceso usa un directorio de trabajo temporal con `uploads`, y cada
capa tiene su propio archivo determinista, ID y URL producida por el constructor
real. No se añadió una ruta `/release` ni se intercepta la descarga GeoJSON.

## Cobertura reproducible

- `tests/support/division-fixture-asset.mjs`: escribe GeoJSON fuera del repositorio.
- `tests/support/division-transition-fixtures.mjs`: diez registros creados con el
  cliente Prisma anterior; seis fenómenos, dos referencias, privada y eliminada.
- `tests/division-fixture-assets.test.mjs`: DTO, archivo, HTTP real, MIME, CORS,
  geometría en Morelos y limpieza comprobada mediante 404 posterior.
- `tests/support/utf8-psql.cjs`: decodificación estricta, archivo único UTF-8,
  `psql -f`, sin shell, hash y eliminación en `finally`.
- `tests/division-utf8.test.mjs`: bytes inválidos, acentos y limpieza ante fallo.
- `tests/division-migration-postgres.cjs`: base temporal desde la migración inicial,
  tres abortos con rollback y 27 combinaciones, con limpieza final de la base.
- `tests/division-deployment.test.mjs`: endpoint sin caché, 503 del puente,
  409 para clientes anteriores y prevalidación de cargas del frontend nuevo.

Los ensayos de integración y sus evidencias se ejecutan fuera del repositorio:
backend anterior, puente y final en puertos distintos; cuatro combinaciones de
frontend/backend; caché real de navegador y recargas; formulario abierto durante
el cambio; reintento nuevo exitoso. La instrumentación de observación del mapa
solo existe en el servidor temporal. Las respuestas GeoJSON pasan por el
middleware real, sin sustitución de contenido desde Playwright.

El ensayo independiente de Prisma comienza con `migrate deploy` del esquema
anterior, crea diez fixtures y ejecuta `migrate deploy` final. Compara todos los
campos ajenos a `division`, verifica checksums y entradas de `_prisma_migrations`,
restricciones y una segunda ejecución sin migraciones pendientes. Las credenciales
sintéticas y archivos de ejecución no se incorporan a Git.

La excepción histórica autorizada para tres IDs eliminados se ensaya también con
títulos cambiados. El auditor separa esos overrides de categorías ordinarias y
ambigüedades reales. Un cuarto ID sin categoría, un ID autorizado que vuelva a
estar activo o uno que adquiera una categoría explícita deben abortar la
migración con rollback completo. Ningún título se usa para clasificar.

## Compatibilidad y orden requerido para una publicación futura

El backend final puede arrancar antes de la migración, pero no puede consultar el
catálogo porque su Prisma Client requiere `division`. Ese arranque no constituye
compatibilidad. La migración y el backend final se coordinan como una unidad.

1. Auditar inventario privado y obtener respaldo verificado; no adivinar categorías.
2. Activar el puente con cliente Prisma anterior: lecturas disponibles y cargas
   bloqueadas explícitamente con 503, versión de contrato 0. Cerrar o drenar
   solicitudes anteriores antes de migrar y comprobar que no quedan escrituras.
3. Ensayar con rollback; aplicar la única migración nueva mediante Prisma.
4. Activar backend final y cliente generado: contrato 1, validación estricta;
   un frontend anterior recibe 409 con instrucción de recarga al subir archivos.
5. Verificar inventario y backend antes de avanzar frontend/Pages. El frontend nuevo
   tolera históricos sin `division` al leer y no envía archivos a contratos anteriores.

El puente no debe permanecer como versión final. El frontend anterior conserva la
lectura, pero necesita recarga para mostrar la nueva jerarquía y efectuar cargas.
Esta validación local no reemplaza auditoría privada, respaldo ni comprobaciones
posteriores de producción. Ninguno de esos pasos se ejecuta como parte de las pruebas.
