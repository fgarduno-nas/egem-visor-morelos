# Guardar imagen del mapa

Disponible sin autenticación y para Director y Administrador. Produce un PNG de 2047 × 1576 con nombre sugerido EGEM_Morelos_AAAA-MM-DD_HHMM.png. Usa selector nativo en contextos seguros compatibles y descarga mediante Blob como alternativa. Cancelar no inicia una descarga alternativa ni escribe el PNG.

## Composición

Un mapa MapLibre temporal fuera de pantalla reproduce cámara, fuentes, capas visibles e iconos. Conserva centro, orientación, zoom y extensión horizontal. Carga teselas y vialidades detalladas para los límites de salida. Copia WebGL sincrónicamente durante render, sin capturar el DOM ni estirar una captura anterior. No incluye controles, paneles, popups ni leyenda flotante.

GOES pausa su reproducción y fija un único buffer, incluso si una precarga termina durante la captura. Después restituye el estado de reproducción previo. Usa assets/encabezadoform.png sin modificar, con proporción 4:1 y opacidad 100 %, fecha/hora America/Mexico_City, escala gráfica calculada mediante unproject/distanceTo sobre la salida y créditos de fuentes visibles en una etiqueta compacta oscura. La escala muestra solo la distancia; con inclinación corresponde localmente al centro.

El visor conserva su encuadre. Se descarta únicamente el sobrante vertical menor de un píxel CSS del redondeo de la altura temporal; no hay recorte lateral. La perspectiva usa transform.fov de MapLibre 4.7.1 para conservar distancia focal y verifica nueve puntos proyectados. Revisar este adaptador al actualizar MapLibre.

## Límites actuales

- No existe una variante vertical para móvil: también exporta 2047 × 1576. En pantalla vertical, conservar el ancho geográfico reduce la cobertura vertical. En vistas apaisadas muestra más territorio arriba y abajo.
- Si la nueva extensión rebasa la cobertura del cuadro GOES congelado, se rechaza la captura y se propone acercar el mapa o desactivar GOES. No se sustituye el cuadro ni se estira su georreferencia.
- Campo de visión inclinado mayor de 60°, terreno 3D, capas custom y fuentes canvas/video no serializables se rechazan con explicación y alternativa.
- CARTO Claro/Oscuro conserva el bloqueo de URLs anónimas que devuelven API KEY REQUIRED. No se incorpora clave ni se sustituye proveedor. OSM se añade exclusivamente en el arnés de comparación visual.
- Fuentes visibles con errores, capas/iconos pendientes o fallidos y recursos sin CORS bloquean la exportación. No se omiten silenciosamente. Un error se conserva para esa instancia de fuente hasta recargar o recrearla.
- Límite total de 45 segundos y render de 25 segundos. Se libera el mapa temporal y la interacción al cancelar o fallar. No hay dependencia nueva ni cambios de backend.

## Validación y distribución

Ejecutar node --test tests/map-export.test.mjs tests/cloud-top*.test.mjs para geometría, perspectiva, escala, fecha, errores, cancelación y congelación. La suite completa usa node --test tests/*.test.mjs y las variables de entorno de prueba del backend, sin desplegar servicios.

El arnés tests/map-export-format-browser.cjs usa Playwright, sharp y Edge; EXPORT_BASE_URL permite cambiar el servidor local (por defecto http://127.0.0.1:4192). Genera evidencias en review-png/formato, excluidas del commit. Comprueba cámara, dimensiones, escala, buffer GOES, iconos fuera de la extensión anterior, inclinación, vialidades, móvil y cancelación. Sus inyecciones de diagnóstico y OSM no forman parte del producto.

El workflow .github/workflows/deploy-pages.yml publica main y copia index.html, css, js, shared, assets y data. Incluye ambos módulos de exportación y el logotipo ya versionado. No empaqueta pruebas, documentación, PNG de revisión ni servidores temporales.
