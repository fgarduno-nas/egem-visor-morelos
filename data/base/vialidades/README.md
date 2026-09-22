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
