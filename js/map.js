// js/map.js
(() => {
  const MORELOS_CENTER = [-99.1, 18.75]; // [lon, lat]

  const map = new maplibregl.Map({
    container: "map",
    style: "https://demotiles.maplibre.org/style.json",
    center: MORELOS_CENTER,
    zoom: 8.2,
    minZoom: 6,
    maxZoom: 18,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }));

  const statusbar = document.getElementById("statusbar");
  map.on("mousemove", (e) => {
    statusbar.textContent = `Coords: ${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`;
  });

  map.on("error", (e) => {
    console.error("❌ Error de MapLibre:", e);
  });

  map.on("load", () => {
    console.log("✅ Mapa cargó. Cargando estado y municipios...");

    // =========================
    // 1) Estado (polígono)
    // =========================
    map.addSource("estado", {
      type: "geojson",
      data: "data/base/estado.geojson",
    });

    map.addLayer({
      id: "estado-fill",
      type: "fill",
      source: "estado",
      paint: {
        "fill-opacity": 0.08,
      },
    });

    map.addLayer({
      id: "estado-line",
      type: "line",
      source: "estado",
      paint: {
        "line-width": 2,
      },
    });

    // =========================
    // 2) Municipios (polígonos)
    // =========================
    map.addSource("municipios", {
      type: "geojson",
      data: "data/base/municipios.geojson",
    });

    // Relleno leve para que se note que son polígonos (opcional)
    map.addLayer({
      id: "municipios-fill",
      type: "fill",
      source: "municipios",
      paint: {
        "fill-opacity": 0.02,
      },
    });

    map.addLayer({
      id: "municipios-line",
      type: "line",
      source: "municipios",
      paint: {
        "line-width": 1,
      },
    });

    // =========================
    // Popup al dar click en un municipio
    // =========================
    map.on("click", "municipios-fill", (e) => {
      if (!e.features || e.features.length === 0) return;

      const f = e.features[0];
      const props = f.properties || {};

      // Ajusta estos nombres cuando veamos los campos reales:
      const nombre =
        props.NOM_MUN ||
        props.NOMBRE ||
        props.nombre ||
        props.municipio ||
        props.NAME ||
        "Municipio";

      new maplibregl.Popup({ closeButton: true, closeOnClick: true })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-size:13px; line-height:1.35;">
            <strong>${nombre}</strong><br/>
            <span>Tipo: Municipio</span>
          </div>
        `)
        .addTo(map);
    });

    map.on("mouseenter", "municipios-fill", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "municipios-fill", () => (map.getCanvas().style.cursor = ""));

    // =========================
    // Ajustar vista al estado (zoom automático)
    // =========================
    try {
      // Intentamos calcular un "fitBounds" usando el estado
      fetch("data/base/estado.geojson")
        .then((r) => r.json())
        .then((gj) => {
          const bounds = new maplibregl.LngLatBounds();

          const addCoords = (coords) => {
            // coords puede ser: [lng,lat] o arreglos anidados
            if (typeof coords[0] === "number") {
              bounds.extend(coords);
              return;
            }
            coords.forEach(addCoords);
          };

          gj.features.forEach((ft) => addCoords(ft.geometry.coordinates));

          map.fitBounds(bounds, { padding: 30, maxZoom: 10 });
          console.log("✅ Vista ajustada al estado (fitBounds).");
        })
        .catch((err) => console.warn("⚠️ No se pudo hacer fitBounds:", err));
    } catch (e) {
      console.warn("⚠️ fitBounds no disponible:", e);
    }

    // =========================
    // Verificación previa del PNG
    // =========================
    fetch("data/geologicos/inestabilidad_laderas.png")
      .then((r) => {
        console.log("🖼️ PNG status:", r.status, r.url);
        if (!r.ok) {
          throw new Error(`No se pudo cargar el PNG. HTTP ${r.status}`);
        }
        return r.blob();
      })
      .then((blob) => {
        console.log("✅ PNG encontrado. Tamaño (bytes):", blob.size);

        // =========================
        // RASTER: Inestabilidad de laderas
        // =========================
        map.addSource("laderas", {
          type: "image",
          url: "data/geologicos/inestabilidad_laderas.png",
          coordinates: [
            [-99.59064917145143, 19.21817655306682], // top-left
            [-98.54297903389683, 19.21817655306682], // top-right
            [-98.54297903389683, 18.24194005423244], // bottom-right
            [-99.59064917145143, 18.24194005423244], // bottom-left
          ],
        });

        map.addLayer({
          id: "laderas-layer",
          type: "raster",
          source: "laderas",
          paint: {
            "raster-opacity": 1
          },
        });

        console.log("✅ Raster 'laderas-layer' agregado.");
      })
      .catch((err) => {
        console.error("❌ Error al verificar/agregar raster:", err);
      });
  });
})();