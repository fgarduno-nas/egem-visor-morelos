# Localidades oficiales de Morelos

Este directorio incluye una capa estatica de puntos con localidades oficiales del estado de Morelos, preparada para una etapa posterior de visualizacion progresiva en MapLibre.

## Fuente

- Institucion: INEGI
- Conjunto: Censo de Poblacion y Vivienda 2020, ITER Morelos
- URL oficial: https://www.inegi.org.mx/contenidos/programas/ccpv/2020/datosabiertos/iter/iter_17_cpv2020_csv.zip
- ZIP: iter_17_cpv2020_csv.zip
- CSV utilizado: conjunto_de_datos_iter_17CSV20.csv
- SHA-256 del ZIP: `158567bec3feef647ddc4cf803bc8ae57f230e3c61b49626efd850c2ae6a5e7f`
- Fecha UTC de generacion: 2026-09-22T18:36:32.521Z
- Codificacion detectada: utf8

## Archivos generados

- `localidades_morelos.geojson`: FeatureCollection EPSG:4326 con puntos de localidades reales.
- `localidades_morelos_diagnostico.json`: resumen reproducible del insumo, filtros, conteos y advertencias.

## Filtros aplicados

Se conservaron registros con `ENTIDAD=17`, municipio real, localidad real, nombre valido y coordenadas oficiales validas dentro de un margen razonable alrededor de Morelos. Se excluyeron totales estatales, totales municipales `LOC=0000`, agregados `LOC=9998` y `LOC=9999`, nombres vacios, coordenadas invalidas y coordenadas fuera del margen territorial.

No se eliminaron localidades por poblacion.

## Coordenadas

Los campos `LONGITUD` y `LATITUD` del ITER vienen en grados, minutos y segundos. La conversion usa:

```text
decimal = grados + minutos / 60 + segundos / 3600
```

La longitud oeste se conserva como negativa. El orden final GeoJSON es `[longitud, latitud]` en WGS 84 / EPSG:4326.

## Clasificacion preparatoria

- `labelTier=1`: 50,000 habitantes o mas.
- `labelTier=2`: 25,000 a 49,999 habitantes.
- `labelTier=3`: 5,000 a 24,999 habitantes.
- `labelTier=4`: 1,000 a 4,999 habitantes.
- `labelTier=5`: menos de 1,000 habitantes.

Las cabeceras se marcaron con `esCabecera=true` cuando `LOC=0001`. La prioridad de etiqueta se asigno de forma determinista por mayor poblacion, cabecera antes que no cabecera en empates y `CVEGEO` ascendente.

## Regeneracion

Desde la raiz del repositorio:

```bash
node scripts/generate-localidades-morelos.mjs
```

El script descarga el ZIP oficial a una carpeta temporal fuera del repositorio, calcula el SHA-256, genera los archivos finales y elimina el temporal al terminar.

## Resumen actual

- Registros originales: 1678
- Registros finales: 1578
- Cabeceras confirmadas: 36
- Conteo por tier: {"1":5,"2":1,"3":54,"4":151,"5":1367}
