# EGEM - Arquitectura recomendada

## Objetivo

Llevar el visor actual a una plataforma operativa para consulta del atlas de riesgos de Morelos, con un flujo simple para Protección Civil:

- `Visitante`: consulta capas aprobadas.
- `Director`: sube capas de su municipio, pero no las publica.
- `Administrador`: revisa, aprueba y publica.

## Qué resuelve el prototipo actual

- Mapa base con varias opciones.
- Interfaz enfocada en consulta rápida.
- Carga local de `KML/KMZ`.
- Simulación del flujo de roles en navegador.

## Qué falta para producción

El prototipo actual guarda sesión y capas en `localStorage`, lo cual sirve para demostración, pero no para operación real.

Para producción se recomienda:

1. `Frontend`
- Mantener `MapLibre` para el visor.
- Consumir un API para autenticación, catálogo de capas y revisión.

2. `Backend`
- Puede ser `Node.js + Express/NestJS`, `Laravel` o `Django`.
- Debe encargarse de:
  - autenticación,
  - autorización por roles,
  - alta y baja de usuarios,
  - revisión y aprobación de capas,
  - registro de auditoría.

3. `Base de datos`
- Recomendada: `PostgreSQL + PostGIS`.
- Guardar:
  - usuarios,
  - roles,
  - municipios asignados,
  - metadatos de capas,
  - historial de revisión,
  - estatus de publicación.

## Dónde guardar usuarios

Sí, los usuarios deben vivir en una base de datos.

Tabla mínima sugerida:

- `users`
  - `id`
  - `nombre`
  - `email`
  - `password_hash`
  - `rol`
  - `municipio_id`
  - `activo`
  - `created_at`

La contraseña nunca debe guardarse en texto plano.
Debe guardarse con hash seguro, por ejemplo `bcrypt` o `argon2`.

## Dónde guardar las capas

Las capas no conviene guardarlas únicamente dentro del proyecto frontend.

Lo recomendable es separar:

1. `Archivo físico`
- Guardarlo en almacenamiento de objetos o archivos:
  - `S3`,
  - `Cloudflare R2`,
  - `Azure Blob`,
  - o un servidor institucional con carpetas controladas.

2. `Metadatos`
- Guardarlos en base de datos:
  - nombre,
  - municipio,
  - usuario que subió,
  - fecha,
  - formato,
  - ruta del archivo,
  - estatus: `pendiente`, `aprobado`, `rechazado`, `publicado`.

## Flujo recomendado para capas

1. El `director` inicia sesión.
2. Sube un archivo `KML/KMZ`.
3. El backend valida formato, tamaño, geometría y municipio.
4. La capa queda con estatus `pendiente`.
5. El `administrador` revisa.
6. Si aprueba, el sistema la marca como `publicada`.
7. Los `visitantes` ya la pueden consultar.

## Sobre KML/KMZ y visualización

Aunque el usuario suba `KML/KMZ`, en el visor web normalmente el archivo se transforma internamente a geometrías de mapa para poder dibujarlo.

Eso no significa perder calidad.
Si la capa original es vectorial, al hacer zoom se seguirá viendo bien.

El problema visual del proyecto anterior parece venir más de capas rasterizadas que del uso de `GeoJSON` como formato interno.

## Recomendación técnica de publicación

Para una versión sólida, lo ideal es este flujo:

- subir `KML/KMZ`,
- convertirlo en backend a una capa vectorial estándar,
- almacenar geometría en `PostGIS`,
- servirla como `GeoJSON` o `vector tiles`,
- mantener el archivo original como respaldo.

Así se obtiene:

- mejor rendimiento,
- mejor control,
- filtros por municipio,
- búsquedas,
- simbología más limpia,
- publicación controlada.

## Administración de usuarios

La administración puede resolverse desde un módulo interno del administrador:

- crear usuario,
- asignar rol,
- asignar municipio,
- activar o desactivar acceso,
- restablecer contraseña.

Flujo sugerido:

1. El administrador crea al director municipal.
2. El sistema envía o genera contraseña temporal.
3. El director cambia su contraseña al entrar por primera vez.

## Siguiente etapa recomendada

1. Mantener este rediseño como base visual.
2. Crear backend con autenticación real.
3. Crear base de datos con `PostgreSQL/PostGIS`.
4. Implementar módulo de aprobación de capas.
5. Migrar las capas actuales a un flujo de publicación formal.
