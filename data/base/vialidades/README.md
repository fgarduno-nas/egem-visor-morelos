# Vialidades por escala

Datos proporcionados como insumo cartografico para el Atlas de Riesgos de Morelos. Procesamiento registrado el 15 de septiembre de 2026. La institucion de origen, licencia y atribucion definitiva estan pendientes de confirmacion.

## Procedencia

- Procedencia institucional: pendiente de confirmación.
- Licencia y condiciones de publicación: pendientes de confirmación.
- Atribución pública: pendiente de confirmación.
- No se atribuye este insumo a INEGI, IMT o SICT porque los metadatos incluidos no lo demuestran.

Los metadatos `.shp.xml` del insumo indican procesamiento con ArcGIS Desktop 10.8 el 15 de septiembre de 2026, recorte desde una capa denominada `red_vial` usando `Limite_Edo_Morelos`, y disolución de `Vial_1` por `NOMBRE` y `ADMINISTRA`.

## Archivos derivados

- `vialidades_nivel_1.geojson`: vialidades generales, visibles desde el zoom inicial.
- `vialidades_nivel_2.geojson`: vialidades intermedias, cargadas al acercarse.
- `vialidades_nivel_3_manifest.json`: índice espacial de fragmentos para el nivel detallado.
- `vialidades_nivel_3/chunk_*.geojson`: fragmentos espaciales de vialidades detalladas.
- `diagnostico_generacion.json`: resumen técnico de la generación de derivados.

Todos los derivados están en `EPSG:4326`, codificados en UTF-8 y normalizados para consumo directo en MapLibre.

## Conversión

Fuente preferida: Shapefiles completos del ZIP original.

Los JSON incluidos en el ZIP original son Esri JSON (`esriGeometryPolyline`, `spatialReference.wkid = 32614`) y no deben cargarse directamente como GeoJSON.

La conversión se realizó desde Shapefile `EPSG:32614` hacia GeoJSON `EPSG:4326`, corrigiendo lectura de atributos con codificación `CP1252` porque el `.cpg` declaraba `UTF-8` pero los acentos resultaban ilegibles al convertirlos con esa codificación.

## Niveles

- `Vial_1`: 30 features, carreteras principales disueltas, atributos conservados: `id`, `nombre`, `administra`, `longitud_km`, `nivel_vial`.
- `Vial_2`: 5,454 features, carreteras pavimentadas, atributos viales normalizados.
- `Vial_3`: 78,892 features originales; 78,891 features renderizables. Se omitió una línea de longitud cero (`ID_RED = 982559`) porque contiene dos coordenadas idénticas y no es dibujable como vialidad.

## Publicacion

Estos archivos quedan preparados como derivados web para revision publica del Atlas. La procedencia institucional, licencia y atribucion definitiva continuan pendientes de confirmacion.

## Auditoria de nombres viales

Fecha de generacion: 2026-09-23.

Script reproducible: `scripts/audit-vialidades-nombres.mjs`.

Artefactos:

- `diagnostico_nombres_viales.json`: resumen completo de conteos, problemas detectados, casos de muestra y limitaciones.
- `correcciones_nombres_viales.json`: listado de correcciones automaticas seguras aplicadas como campo derivado.
- `nombres_viales_mostrar.json`: diccionario compacto `nivel:id -> nombre_mostrar` usado por el visor para aplicar etiquetas corregidas en memoria.

Fuente oficial de referencia:

- Red Nacional de Caminos (RNC), INEGI/IMT/SICT: https://www.inegi.org.mx/programas/rnc/
- Diccionario de datos RNC 2025: https://inegi.org.mx/contenidos/productos/prod_serv/contenidos/espanol/bvinegi/productos/nueva_estruc/889463927457.pdf
- Campo oficial de nombre de vialidad: `Nombre`.
- Identificador oficial de red vial: `Id_Red`.
- Clasificacion vial oficial: `Tipo_Vial`.

La RNC se usa en esta etapa como referencia semantica de campos. Los derivados actuales no conservan un identificador oficial comun verificable para relacionar cada segmento contra RNC, por lo que no se sustituyen nombres por inferencia espacial ni por diccionario general. Las correcciones aplicadas son exclusivamente de confianza alta por normalizacion segura:

- decodificacion de mojibake inequívoco UTF-8 leido como Latin-1/CP1252;
- entidades HTML basicas;
- espacios duplicados, extremos o caracteres invisibles.

No se corrigen automaticamente nombres propios, toponimos, abreviaturas, claves, acentos potencialmente ausentes, mayusculas mecanicas ni variantes ortograficas que requieran confirmacion oficial. Esos casos quedan documentados como ambiguos o pendientes.

Campos de trazabilidad:

- `nombre`: valor original preservado sin cambios destructivos.
- `nombre_mostrar`: nombre derivado que el visor aplica en memoria desde `nombres_viales_mostrar.json` cuando existe una correccion segura.
- `correcciones_nombres_viales.json`: registra fuente, confianza, problema detectado, primer archivo y ubicación aproximada para cada correccion unica.

Los campos `nombre_mostrar`, `nombre_fuente` y `nombre_confianza` no se repiten dentro de cada GeoJSON de vialidades para evitar sobrecargar las descargas principales del visor; la etiqueta corregida se aplica desde el diccionario compacto y la trazabilidad completa queda en el artefacto de correcciones.

Conteos finales de auditoria:

- Total de instancias revisadas: 86,631.
- Features unicas revisadas: 84,375.
- Instancias con nombre: 69,536.
- Instancias sin nombre: 17,095.
- Correcciones automaticas seguras: 17,644 instancias; 17,206 features unicas.
- `Vial_1`: 30 instancias; 30 con nombre; 8 correcciones seguras.
- `Vial_2`: 5,454 instancias; 5,454 con nombre; 1,583 correcciones seguras.
- `Vial_3`: 81,147 instancias en chunks; 64,052 con nombre; 17,095 sin nombre; 16,053 correcciones seguras.
- `Vial_3` renderizable segun manifest: 78,891 features unicas; 78.93% de instancias con nombre.

La red vial dibujada conserva sus geometrías originales. La deduplicacion de etiquetas se mantiene mediante colisiones y `symbol-spacing` de MapLibre; no se unen geometrías ni se eliminan segmentos para etiquetado.
