// js/map.js
(() => {
  const MORELOS_CENTER = [-99.1, 18.75]; // [lon, lat]

  // =========================
  // Estilos de mapa base
  // =========================
  const baseStyles = {
    claro: {
      version: 8,
      sources: {
        "base-tiles": {
          type: "raster",
          tiles: [
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
          ],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors"
        }
      },
      layers: [
        {
          id: "base-layer",
          type: "raster",
          source: "base-tiles"
        }
      ]
    },

    oscuro: {
      version: 8,
      sources: {
        "base-tiles": {
          type: "raster",
          tiles: [
            "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
            "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
            "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
            "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
          ],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors © CARTO"
        }
      },
      layers: [
        {
          id: "base-layer",
          type: "raster",
          source: "base-tiles"
        }
      ]
    },

    satelite: {
      version: 8,
      sources: {
        "base-tiles": {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          ],
          tileSize: 256,
          attribution: "Tiles © Esri"
        }
      },
      layers: [
        {
          id: "base-layer",
          type: "raster",
          source: "base-tiles"
        }
      ]
    }
  };

  // =========================
  // Datos en memoria
  // =========================
  let estadoData = null;
  let municipiosData = null;
  let fitBoundsDone = false;

  const map = new maplibregl.Map({
    container: "map",
    style: baseStyles.claro,
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

  // =========================
  // Tabs del panel lateral
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    console.log("Tabs encontradas:", tabButtons.length);
    console.log("Contenidos encontrados:", tabContents.length);

    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-tab");

        tabButtons.forEach((b) => b.classList.remove("active"));
        tabContents.forEach((c) => c.classList.remove("active"));

        btn.classList.add("active");

        const panel = document.getElementById(target);
        if (panel) {
          panel.classList.add("active");
        }
      });
    });
  });

  map.on("error", (e) => {
    console.error("❌ Error de MapLibre:", e);
  });

  // =========================
  // Cargar datos una sola vez
  // =========================
  async function loadProjectData() {
    try {
      const [estadoResp, municipiosResp] = await Promise.all([
        fetch("data/base/estado.geojson"),
        fetch("data/base/municipios.geojson")
      ]);

      estadoData = await estadoResp.json();
      municipiosData = await municipiosResp.json();

      console.log("✅ GeoJSON cargados en memoria.");
    } catch (error) {
      console.error("❌ Error cargando GeoJSON:", error);
    }
  }

  // =========================
  // Ajustar vista al estado
  // =========================
  function fitToEstado() {
    if (!estadoData || fitBoundsDone) return;

    const bounds = new maplibregl.LngLatBounds();

    const addCoords = (coords) => {
      if (typeof coords[0] === "number") {
        bounds.extend(coords);
        return;
      }
      coords.forEach(addCoords);
    };

    estadoData.features.forEach((ft) => addCoords(ft.geometry.coordinates));
    map.fitBounds(bounds, { padding: 30, maxZoom: 10 });
    fitBoundsDone = true;

    console.log("✅ Vista ajustada al estado (fitBounds).");
  }

  // =========================
  // Popup de municipios
  // =========================
  function bindMunicipiosPopup() {
    if (!map.getLayer("municipios-fill")) return;

    map.on("click", "municipios-fill", (e) => {
      if (!e.features || e.features.length === 0) return;

      const f = e.features[0];
      const props = f.properties || {};

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

    map.on("mouseenter", "municipios-fill", () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", "municipios-fill", () => {
      map.getCanvas().style.cursor = "";
    });
  }

  // =========================
  // Agregar capas del proyecto
  // =========================
  function addProjectLayers() {
    console.log("📦 Agregando capas del proyecto al estilo actual...");

    if (!estadoData || !municipiosData) {
      console.warn("⚠️ Aún no están cargados los GeoJSON.");
      return;
    }

    // =========================
    // Estado
    // =========================
    if (!map.getSource("estado")) {
      map.addSource("estado", {
        type: "geojson",
        data: estadoData,
      });
    }

    if (!map.getLayer("estado-fill")) {
      map.addLayer({
        id: "estado-fill",
        type: "fill",
        source: "estado",
        paint: {
          "fill-opacity": 0.08,
        },
      });
    }

    if (!map.getLayer("estado-line")) {
      map.addLayer({
        id: "estado-line",
        type: "line",
        source: "estado",
        paint: {
          "line-width": 2,
        },
      });
    }

    // =========================
    // Municipios
    // =========================
    if (!map.getSource("municipios")) {
      map.addSource("municipios", {
        type: "geojson",
        data: municipiosData,
      });
    }

    if (!map.getLayer("municipios-fill")) {
      map.addLayer({
        id: "municipios-fill",
        type: "fill",
        source: "municipios",
        paint: {
          "fill-opacity": 0.02,
        },
      });
    }

    if (!map.getLayer("municipios-line")) {
      map.addLayer({
        id: "municipios-line",
        type: "line",
        source: "municipios",
        paint: {
          "line-width": 1,
        },
      });
    }

    // =========================
    // Raster: Inestabilidad de laderas
    // =========================
    if (!map.getSource("laderas")) {
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
    }

    const chkLaderas = document.getElementById("chkLaderas");
    const visible = chkLaderas && chkLaderas.checked ? "visible" : "none";

    if (!map.getLayer("laderas-layer")) {
      map.addLayer({
        id: "laderas-layer",
        type: "raster",
        source: "laderas",
        layout: {
          visibility: visible
        },
        paint: {
          "raster-opacity": 0.5
        },
      });
    }

    console.log("✅ Capas reinyectadas correctamente.");
  }

  // =========================
  // Al cargar cualquier estilo
  // =========================
  map.on("style.load", () => {
    console.log("🎨 style.load disparado");
    addProjectLayers();
    fitToEstado();
  });

  // =========================
  // Al cargar el mapa
  // =========================
  map.on("load", async () => {
    console.log("✅ Mapa cargó.");

    await loadProjectData();

    addProjectLayers();
    fitToEstado();
    bindMunicipiosPopup();

    // =========================
    // Checkbox para activar/desactivar raster
    // =========================
    const chkLaderas = document.getElementById("chkLaderas");

    if (chkLaderas) {
      chkLaderas.checked = false;

      chkLaderas.addEventListener("change", (e) => {
        if (map.getLayer("laderas-layer")) {
          map.setLayoutProperty(
            "laderas-layer",
            "visibility",
            e.target.checked ? "visible" : "none"
          );
        }

        const infoCapa = document.getElementById("info-capa");
        if (infoCapa) {
          infoCapa.innerHTML = e.target.checked
            ? "<strong>Inestabilidad de laderas</strong>"
            : "<strong>Ninguna capa temática activa</strong>";
        }
      });
    }

    // =========================
    // Selector de mapa base
    // =========================
    const basemapSelect = document.getElementById("basemap-select");

    if (basemapSelect) {
      basemapSelect.addEventListener("change", (e) => {
        const selected = e.target.value;
        console.log("🗺️ Cambiando mapa base a:", selected);

        map.setStyle(baseStyles[selected]);
      });
    }
  });
})();