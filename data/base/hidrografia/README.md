# Cuerpos de agua de Morelos

`cuerpos-agua.geojson` es la conversión web del shapefile `Cuerpos_Agua.shp` entregado al proyecto. El responsable del proyecto identifica al **Instituto Nacional de Estadística y Geografía (INEGI)** como origen del insumo original. Los **711 registros** del shapefile declaran literalmente `FUENTE = Universidad Autónoma del Estado de Morelos`; ese campo se conserva sin modificación en el GeoJSON. La metadata `.shp.xml` acredita a la **Universidad Autónoma del Estado de Morelos, Facultad de Arquitectura**. Por ello, la atribución es doble: insumo original INEGI según el responsable; procesamiento, integración o acreditación del archivo entregado UAEM, Facultad de Arquitectura, según los datos incluidos.

No se dispone todavía de un documento adicional que identifique con certeza el producto original de INEGI, su año o edición, escala original, licencia específica ni el proceso exacto realizado por la UAEM. Esos datos permanecen pendientes de confirmación documental. La ruta de trabajo `INEGI/50mil2024` y las descripciones genéricas de la metadata no bastan para asignar producto, edición o escala a estos polígonos. La metadata registra operaciones `Clip`, `Project` y `CalculateField` en 2026, pero no explica toda la cadena de procedencia.

- Archivo entregado: `Cuerpos de Agua.rar`; SHA256 `ad3e0fd98931ecae0041df064eae6d405bd37314666e31241e6842b01fcc8a85`.
- CRS original de `.prj`: WGS 84 / UTM zona 14N, `EPSG:32614`. Salida: WGS84, `EPSG:4326`, GeoJSON RFC 7946, UTF-8.
- Conteo original: 711 registros, tipo reportado por OGR: Polygon. Bounds originales en metros: `(448817.231377, 2031660.351213)–(535337.803825, 2107877.310280)`.
- Campos conservados: `condicion`, `nom_geo`, `term_gen`, `CVE_ENT`, `NOM_ENT`, `TIPO_FA`, `FUENTE`.
- Validación posterior: 711 features; 710 `Polygon` y 1 `MultiPolygon`; 714 anillos y 32 935 vértices; bounds `[-99.4854348, 18.3748604, -98.6644568, 19.0634431]`. Las 711 geometrías son válidas con GEOS; no hay geometrías nulas, anillos sin cerrar ni duplicados geométricos exactos. Todos los registros conservan `CVE_ENT = 17`, `NOM_ENT = MORELOS` y el valor UAEM en `FUENTE`. El rectángulo de cobertura está dentro del de `estado.geojson`.

Conversión reproducible, tras extraer el RAR **fuera del repositorio**:

```powershell
ogr2ogr -f GeoJSON data/base/hidrografia/cuerpos-agua.geojson Cuerpos_Agua.shp -t_srs EPSG:4326 -lco RFC7946=YES -lco COORDINATE_PRECISION=7
```

La capa se representa con relleno y contorno azules, sin clasificación ni etiquetas automáticas. Aunque existe `nom_geo`, su densidad y legibilidad por escala no se han validado para rotulado. El RAR y sus archivos extraídos no se incorporan al repositorio.
