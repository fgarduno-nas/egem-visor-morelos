# Composición de la exportación PNG

## Alcance
Solo anotaciones de exportación. Se conserva PNG 2047 × 1576, diálogo, nombre sugerido, congelación GOES, copia de iconos, comprobación de recursos y cámara del mapa temporal. No se añaden formatos ni orientación vertical al diálogo. En móvil sigue conservándose el ancho geográfico y adaptándose la cobertura vertical al formato fijo.

## Distribución
`EXPORT_ANNOTATIONS` centraliza medidas en unidades equivalentes a dos píxeles del PNG final, independientes del DPR del visor.
- Créditos y nombre de base: abajo derecha, 17 px (mínimo 15 px), fondo negro 38 %, máximo dos líneas con palabras completas. Atribuciones de todas las fuentes visibles conservadas y segmentos exactos duplicados eliminados. GOES incluye su propia hora de cuadro; no la hora general de captura.
- Escala: centro exacto del ancho total; texto blanco 22 px sin fondo ni relleno de tarjeta, con contorno negro al 75 % de 4 px. La barra tiene trazo oscuro de 6 px y blanco de 3 px. Distancia calculada con `unproject` sobre el centro del mapa exportado; nunca se estira la barra para llenar el recuadro.
- Marca: abajo izquierda, sin tarjeta ni fecha; ancho máximo 420 px frente a los 680 px anteriores (38 % menos), proporción del asset conservada. Margen exterior 20 px; separación mínima 24 px.
- Si los créditos completos no caben, ocupan una fila superior anclada a la derecha, con texto alineado a la izquierda. No se centra la escala respecto del espacio sobrante ni se ocultan atribuciones. Un formato extremadamente estrecho o un texto imposible de alojar provoca un error explícito en lugar de recortar palabras.

La fecha sigue utilizándose únicamente para el nombre sugerido del archivo. Se conserva la información meteorológica asociada a GOES.

## Validación
Las pruebas de composición cubren horizontal grande/pequeña, vertical y alta resolución, ausencia de solapamiento, centrado exacto, proporción, dos líneas y fondos. Las pruebas de captura previas permanecen. El arnés de navegador guarda evidencia fuera del repositorio mediante `EXPORT_REVIEW_DIR`, comprueba PNG, encuadre, escala geográfica, GOES congelado, iconos, SE02 y descarga/cancelación.

Los lienzos verticales prueban el compositor; el flujo público conserva el único formato aprobado 2047 × 1576. No se debe presentar una prueba aislada de lienzo como una nueva opción del diálogo.

## Asset institucional y fondo exterior
Se utiliza exclusivamente `assets/encabezadoform.png` original (3200 × 800), sin procesar sus píxeles. El fondo guinda, escudos, letras, colores y márgenes alfa forman parte del asset y se conservan. No se requiere ni se incluye una variante transparente.

Se elimina solamente el rectángulo blanco que el canvas dibujaba por fuera de la imagen para agrupar marca, fecha y escala. La imagen se dibuja directamente sobre el mapa al 75 % de opacidad mediante BRAND_WATERMARK_OPACITY y save/restore; globalAlpha vuelve inmediatamente a 1. Solo los créditos conservan su fondo negro al 38 %; la escala no tiene tarjeta. No se añaden bordes, sombras ni rellenos blancos.

La marca ocupa 420 × 105 píxeles en el PNG habitual (antes 680 × 170, además de la tarjeta y el pie). Las pruebas distinguen expresamente el fondo guinda interno del archivo y el fondo blanco exterior eliminado, verificando identidad del asset y composición de píxeles de la región de marca respecto de mapa + imagen original.

## Indicador de norte geográfico
El PNG incorpora un símbolo EGEM propio, dibujado exclusivamente con primitivas de canvas: círculo negro semitransparente, contorno y N blancos, flecha dividida en blanco y guinda #501c32. No se descarga ningún recurso ni se captura el control interactivo de MapLibre. El mapa público no recibe un control nuevo.

El indicador queda arriba a la derecha. Su diámetro habitual es128px, con margen20px; escala uniformemente según resolución, con un mínimo legible de64px. El círculo no se deforma. La N orbita junto a la punta con el mismo ángulo; el carácter se dibuja vertical después de restaurar la rotación de la flecha. El radio de la etiqueta es23 unidades y la punta está a14, con separación constante. La franja inferior no cambia.

`captureExportOrientation()` guarda bearing y pitch en un objeto congelado antes de esperar recursos. La orientación usada en el render debe coincidir con esa copia; si cambió antes de construir la escena, la exportación se rechaza en vez de dibujar un norte incorrecto. Una escena ya capturada utiliza siempre su copia, independiente de movimientos posteriores de la interfaz. La cancelación y liberación del mapa temporal permanecen.

Fórmula: `angle = ((-bearing % 360) + 540) % 360 - 180`. Valores con magnitud≤0,1° se dibujan a0°. El pitch solo se registra para trazabilidad, nunca entra en el cálculo ni en la transformación gráfica del indicador. Representa norte geográfico, no norte magnético, GPS o dirección del dispositivo.

Se dibuja después de las anotaciones inferiores y antes de codificar el PNG, incluso con bearing0°. Las pruebas de ausencia de estiramiento excluyen ahora únicamente la banda superior ocupada por la anotación nueva; siguen comparando los píxeles del mapa y la composición exacta del logotipo.

## Texto institucional superior izquierdo
EGEM aparece solo en el PNG, en negrita de 36 px para el formato habitual, guinda #501C32 (RGB 80, 28, 50, verificado en el fondo sólido del asset). Un contorno blanco al 85 % de 4 px sigue las letras, sin rectángulo. Conserva margen de 20 px y se adapta uniformemente a las dimensiones. El norte y su snapshot no cambian.
