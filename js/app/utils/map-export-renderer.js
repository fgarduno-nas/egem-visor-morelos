export const EXPORT_SIZE = Object.freeze({ width: 2047, height: 1576 });

export function exportGeometry(width, height, fov = 36.86989764584402, pitch = 0) {
  if (!(width > 0 && height > 0)) throw new Error("El mapa no está visible.");
  const renderHeight = Math.ceil(width * EXPORT_SIZE.height / EXPORT_SIZE.width);
  const adjustedFov = 2 * Math.atan(renderHeight / height * Math.tan(fov * Math.PI / 360)) * 180 / Math.PI;
  if (pitch && adjustedFov > 60) throw new Error("Esta vista inclinada requiere un campo de visión que MapLibre 4.7 no admite. Pon la inclinación en 0° o aumenta la altura de la ventana antes de exportar; no se ha cambiado tu vista.");
  return { width, height: renderHeight, pixelRatio: (EXPORT_SIZE.width + 0.00001) / width, fov: adjustedFov };
}

export function snapshotStyle(map) {
  const style = structuredClone(map.getStyle());
  if (style.terrain) throw new Error("La exportación ampliada no admite terreno 3D. Desactiva el relieve 3D antes de exportar.");
  const zoom = map.getZoom();
  style.layers = style.layers.filter(layer => layer.layout?.visibility !== "none" &&
    zoom >= (layer.minzoom ?? -Infinity) && zoom < (layer.maxzoom ?? Infinity) && layer.paint?.[`${layer.type}-opacity`] !== 0);
  const used = new Set(style.layers.map(layer => layer.source).filter(Boolean));
  for (const [id, source] of Object.entries(style.sources)) {
    if (!used.has(id)) { delete style.sources[id]; continue; }
    if (!["geojson", "raster", "vector", "image", "raster-dem"].includes(source.type)) {
      throw new Error(`No se puede ampliar la fuente ${id} (${source.type}). Desactívala o conviértela en una capa georreferenciada antes de exportar.`);
    }
  }
  if (style.layers.some(layer => layer.type === "custom")) throw new Error("Una capa personalizada no permite un render independiente. Desactívala antes de exportar.");
  style.transition = { duration: 0, delay: 0 };
  return style;
}

export function assertGoesCoverage(map, style, crop) {
  for (const [id, source] of Object.entries(style.sources)) {
    if (!id.startsWith("cloud-top-animation-source") || source.type !== "image") continue;
    const lngs = source.coordinates.map(p => p[0]);
    const lats = source.coordinates.map(p => p[1]);
    const ratio = map.getCanvas().width / map.getCanvas().clientWidth;
    for (const x of [0, EXPORT_SIZE.width]) for (const y of [crop.y, crop.y + EXPORT_SIZE.height]) {
      const p = map.unproject([x / ratio, y / ratio]);
      if (p.lng < Math.min(...lngs) || p.lng > Math.max(...lngs) || p.lat < Math.min(...lats) || p.lat > Math.max(...lats)) {
        throw new Error("La nueva extensión rebasa la cobertura del cuadro GOES congelado. Acerca el mapa o desactiva GOES y vuelve a guardar. No se ha estirado ni sustituido el cuadro.");
      }
    }
  }
}

// Only the temporary map uses the pinned 4.7 transform.fov adapter. The public
// setVerticalFieldOfView API does not exist in this project's MapLibre release.
export async function createExportScene(original, { signal, prepareSources = async () => {} }) {
  original.stop();
  const canvas = original.getCanvas();
  const oldWidth = canvas.clientWidth, oldHeight = canvas.clientHeight;
  const geometry = exportGeometry(oldWidth, oldHeight, original.transform?.fov, original.getPitch());
  const style = snapshotStyle(original);
  const camera = {
    center: original.getCenter().toArray(), zoom: original.getZoom(),
    bearing: original.getBearing(), pitch: original.getPitch(), padding: original.getPadding(),
  };
  const sampleHeight = Math.min(oldHeight, geometry.height) * .6;
  const samples = [.1, .5, .9].flatMap(x => [-.5, 0, .5].map(y => {
    const point = [oldWidth * x, oldHeight / 2 + y * sampleHeight];
    return { coordinate: original.unproject(point), x: point[0], y: point[1] + (geometry.height - oldHeight) / 2 };
  }));
  const images = original.listImages().map(id => {
    const image = original.getImage(id);
    if (!image?.data) throw new Error(`No se pudo copiar el icono ${id}.`);
    return [id, { width: image.data.width, height: image.data.height, data: new Uint8Array(image.data.data) },
      { pixelRatio: image.pixelRatio, sdf: image.sdf, stretchX: image.stretchX, stretchY: image.stretchY, content: image.content }];
  });
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  container.style.cssText = `position:fixed;left:-30000px;top:0;width:${geometry.width}px;height:${geometry.height}px;pointer-events:none;`;
  document.body.append(container);
  let map;
  const destroy = () => { map?.remove(); container.remove(); };
  try {
    signal.throwIfAborted();
    map = new original.constructor({
      container, style: { version: 8, sources: {}, layers: [] }, ...camera,
      pixelRatio: geometry.pixelRatio, interactive: false, attributionControl: false,
      preserveDrawingBuffer: false, fadeDuration: 0, trackResize: false,
      maxZoom: 24, maxPitch: 85, renderWorldCopies: original.getRenderWorldCopies(),
    });
    // Set padding explicitly; MapOptions in 4.7 does not consume it on construction.
    map.jumpTo(camera);
    if (camera.pitch) {
      if (!map.transform || !Number.isFinite(map.transform.fov)) throw new Error("No se puede conservar la perspectiva con esta versión de MapLibre. Usa una vista sin inclinación.");
      map.transform.fov = geometry.fov;
    }
    const assertCamera = () => {
      for (const sample of samples) {
        const actual = map.project(sample.coordinate);
        if (Math.hypot(actual.x - sample.x, actual.y - sample.y) > .05) {
          throw new Error("No se pudo conservar la escala y el encuadre horizontal. Usa una vista sin inclinación o más cercana y vuelve a exportar.");
        }
      }
    };
    assertCamera();
    const crop = { x: 0, y: (map.getCanvas().height - EXPORT_SIZE.height) / 2, ...EXPORT_SIZE };
    if (map.getCanvas().width !== EXPORT_SIZE.width || crop.y < 0) throw new Error("No se pudo crear el formato 2047 × 1576 sin deformar el mapa.");
    assertGoesCoverage(map, style, crop);
    await prepareSources(style, map.getBounds(), signal);
    signal.throwIfAborted();
    map.on("style.load", () => {
      for (const [id, data, options] of images) if (!map.hasImage(id)) map.addImage(id, data, options);
    });
    // Listen before setStyle: failed resources must not produce a partial PNG.
    const failures = [];
    map.on("error", event => failures.push(`${event.sourceId || "recurso"}: ${event.error?.message || "no disponible"}`));
    map.on("styleimagemissing", event => failures.push(`icono ${event.id}: no disponible`));
    map.setStyle(style);
    return {
      map, crop, destroy,
      check() {
        assertCamera();
        if (failures.length) throw new Error(`No se puede exportar la nueva extensión: ${failures[0]}. Verifica disponibilidad/CORS o desactiva la capa afectada.`);
      },
    };
  } catch (error) { destroy(); throw error; }
}
