(() => {
  const MORELOS_CENTER = [-99.07, 18.84];
  const STORAGE_KEYS = {
    session: "egem-session",
    layers: "egem-user-layers-v2",
    users: "egem-users-v1",
  };

  const demoUsers = [
    {
      email: "admin@egem.morelos",
      password: "Admin123!",
      role: "admin",
      name: "Administrador EGEM",
      municipality: "Estado de Morelos",
    },
    {
      email: "director.cuernavaca@egem.morelos",
      password: "Director123!",
      role: "director",
      name: "Direccion de Proteccion Civil de Cuernavaca",
      municipality: "Cuernavaca",
    },
    {
      email: "visitante@egem.morelos",
      password: "Visitante123!",
      role: "visitante",
      name: "Consulta publica",
      municipality: "General",
    },
  ];

  const roleLabels = {
    admin: "Administrador",
    director: "Director",
    visitante: "Visitante",
  };

  const roleCapabilities = {
    admin: "Puede revisar, aprobar, visualizar y descargar capas cargadas.",
    director: "Puede cargar y descargar capas, pero no publicarlas.",
    visitante: "Solo puede consultar capas ya publicadas.",
  };

  const morelosMunicipalities = [
    "Amacuzac",
    "Atlatlahucan",
    "Axochiapan",
    "Ayala",
    "Coatetelco",
    "Coatlán del Río",
    "Cuautla",
    "Cuernavaca",
    "Emiliano Zapata",
    "Hueyapan",
    "Huitzilac",
    "Jantetelco",
    "Jiutepec",
    "Jojutla",
    "Jonacatepec de Leandro Valle",
    "Mazatepec",
    "Miacatlán",
    "Ocuituco",
    "Puente de Ixtla",
    "Temixco",
    "Temoac",
    "Tepalcingo",
    "Tepoztlán",
    "Tetecala",
    "Tetela del Volcán",
    "Tlalnepantla",
    "Tlaltizapán de Zapata",
    "Tlaquiltenango",
    "Tlayacapan",
    "Totolapan",
    "Xochitepec",
    "Xoxocotla",
    "Yautepec",
    "Yecapixtla",
    "Zacatepec",
    "Zacualpan de Amilpas",
  ];

  const baseMapConfigs = {
    satelite: [
      {
        sourceId: "basemap-satelite-imagery",
        layerId: "basemap-satelite-imagery",
        source: {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          attribution: "Esri",
        },
      },
      {
        sourceId: "basemap-satelite-labels",
        layerId: "basemap-satelite-labels",
        source: {
          type: "raster",
          tiles: [
            "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          attribution: "Esri",
        },
      },
    ],
    topografico: [
      {
        sourceId: "basemap-topografico",
        layerId: "basemap-topografico",
        source: {
          type: "raster",
          tiles: [
            "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
            "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
            "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
          ],
          tileSize: 256,
          attribution: "OpenTopoMap",
        },
      },
    ],
    claro: [
      {
        sourceId: "basemap-claro",
        layerId: "basemap-claro",
        source: {
          type: "raster",
          tiles: [
            "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
            "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
            "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
            "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
          ],
          tileSize: 256,
          attribution: "CARTO",
        },
      },
    ],
    oscuro: [
      {
        sourceId: "basemap-oscuro",
        layerId: "basemap-oscuro",
        source: {
          type: "raster",
          tiles: [
            "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
            "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
            "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
            "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
          ],
          tileSize: 256,
          attribution: "CARTO",
        },
      },
    ],
  };

  const staticLayers = [
    {
      id: "estado",
      title: "Limite estatal",
      group: "Limites",
      status: "published",
      sourceKind: "static",
      visible: false,
      description: "Contorno general del estado de Morelos.",
    },
    {
      id: "municipios",
      title: "Municipios",
      group: "Limites",
      status: "published",
      sourceKind: "static",
      visible: false,
      description: "Division municipal para consulta operativa.",
    },
  ];

  const state = {
    activeBaseMap: "satelite",
    activeTool: null,
    session: loadSession(),
    sidebarCollapsed: false,
    isUploading: false,
    measurement: {
      points: [],
    },
    visibleSnapshot: {
      staticIds: [],
      userIds: [],
      previewId: null,
    },
    staticData: {
      estado: null,
      municipios: null,
    },
    users: loadUsers(),
    userLayers: loadUserLayers(),
    renderedLayers: new Map(),
    previewLayerId: null,
  };

  const map = new maplibregl.Map({
    container: "map",
    style: createBaseMapStyle(state.activeBaseMap),
    center: MORELOS_CENTER,
    zoom: 8.2,
    minZoom: 6,
    maxZoom: 18,
  });

  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

  const elements = {
    appShell: document.querySelector(".app-shell"),
    basemapList: document.getElementById("basemap-list"),
    layerList: document.getElementById("layer-list"),
    layerSearch: document.getElementById("layer-search"),
    infoPanel: document.getElementById("info-panel"),
    statusbar: document.getElementById("statusbar"),
    sessionRoleLabel: document.getElementById("session-role-label"),
    sessionSummary: document.getElementById("session-summary"),
    sessionSummaryCopy: document.getElementById("session-summary-copy"),
    publishedCount: document.getElementById("published-count"),
    pendingCount: document.getElementById("pending-count"),
    uploadPermissionNote: document.getElementById("upload-permission-note"),
    toolsOverlay: document.getElementById("tools-overlay"),
    fileInput: document.getElementById("file-input"),
    loginModal: document.getElementById("login-modal"),
    helpModal: document.getElementById("help-modal"),
    userAdminModal: document.getElementById("user-admin-modal"),
    loginForm: document.getElementById("login-form"),
    userAdminForm: document.getElementById("user-admin-form"),
    loginEmail: document.getElementById("login-email"),
    loginPassword: document.getElementById("login-password"),
    loginFeedback: document.getElementById("login-feedback"),
    openUserAdmin: document.getElementById("open-user-admin"),
    closeUserAdmin: document.getElementById("close-user-admin"),
    newUserName: document.getElementById("new-user-name"),
    newUserEmail: document.getElementById("new-user-email"),
    newUserPassword: document.getElementById("new-user-password"),
    newUserRole: document.getElementById("new-user-role"),
    newUserMunicipalityField: document.getElementById("new-user-municipality-field"),
    newUserMunicipality: document.getElementById("new-user-municipality"),
    userAdminFeedback: document.getElementById("user-admin-feedback"),
    userAdminList: document.getElementById("user-admin-list"),
    reopenSidebar: document.getElementById("reopen-sidebar"),
    triggerUpload: document.getElementById("trigger-upload"),
    toolbarTogglePanel: document.getElementById("toolbar-toggle-panel"),
    toolbarZoomIn: document.getElementById("toolbar-zoom-in"),
    toolbarZoomOut: document.getElementById("toolbar-zoom-out"),
    toolbarResetNorth: document.getElementById("toolbar-reset-north"),
    toolbarMeasure: document.getElementById("toolbar-measure"),
    toolbarAddPoint: document.getElementById("toolbar-add-point"),
    toolbarFocusMorelos: document.getElementById("focus-morelos-menu"),
    toolbarClearMeasure: document.getElementById("toolbar-clear-measure"),
  };

  map.on("mousemove", (event) => {
    elements.statusbar.textContent =
      `Lon: ${event.lngLat.lng.toFixed(5)} | Lat: ${event.lngLat.lat.toFixed(5)}`;
  });

  map.on("error", (event) => {
    console.error("Error en MapLibre:", event.error);
  });

  setupUi();
  renderSession();
  renderBaseMapOptions();
  renderLayerCatalog();
  captureVisibleSnapshot();

  map.on("load", async () => {
    await loadStaticData();
    restoreMapState();
    captureVisibleSnapshot();
    focusMorelos();
  });

  map.on("click", (event) => {
    handleMapToolClick(event);
  });

  function setupUi() {
    elements.triggerUpload.addEventListener("click", () => {
      if (!canUpload()) {
        updateInfoPanel({
          title: "Permisos insuficientes",
          description: "Solo administrador y director pueden cargar capas del atlas.",
        });
        return;
      }
      elements.fileInput.click();
    });

    elements.toolbarTogglePanel.addEventListener("click", toggleSidebar);
    elements.toolbarZoomIn.addEventListener("click", () => map.zoomIn());
    elements.toolbarZoomOut.addEventListener("click", () => map.zoomOut());
    elements.toolbarResetNorth.addEventListener("click", resetMapNorth);
    elements.toolbarMeasure.addEventListener("click", toggleMeasureTool);
    elements.toolbarAddPoint.addEventListener("click", togglePointTool);
    elements.toolbarFocusMorelos.addEventListener("click", focusMorelos);
    elements.toolbarClearMeasure.addEventListener("click", clearMeasurement);
    document.getElementById("toggle-sidebar").addEventListener("click", toggleSidebar);
    elements.reopenSidebar.addEventListener("click", toggleSidebar);

    document.getElementById("open-login").addEventListener("click", () => {
      elements.loginModal.showModal();
    });

    document.getElementById("close-login").addEventListener("click", () => {
      elements.loginModal.close();
    });

    document.getElementById("open-help").addEventListener("click", () => {
      elements.helpModal.showModal();
    });

    document.getElementById("close-help").addEventListener("click", () => {
      elements.helpModal.close();
    });

    elements.openUserAdmin.addEventListener("click", () => {
      if (state.session.role !== "admin") return;
      renderUserAdminPanel();
      elements.userAdminModal.showModal();
    });

    elements.closeUserAdmin.addEventListener("click", () => {
      elements.userAdminModal.close();
    });

    document.getElementById("continue-visitor").addEventListener("click", () => {
      clearPreviewStateOnRoleChange();
      state.session = {
        role: "visitante",
        name: "Consulta publica",
        municipality: "General",
      };
      saveSession();
      renderSession();
      renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
      elements.loginModal.close();
    });

    elements.loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      login();
    });

    elements.userAdminForm.addEventListener("submit", (event) => {
      event.preventDefault();
      createManagedUser();
    });

    elements.newUserRole.addEventListener("change", syncUserRoleForm);

    elements.layerSearch.addEventListener("input", () => {
      renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    });

    elements.fileInput.addEventListener("change", async (event) => {
      const files = [...(event.target.files || [])];
      if (!files.length) return;
      if (state.isUploading) {
        updateInfoPanel({
          title: "Carga en proceso",
          description: "Espera a que termine la carga actual antes de iniciar otra.",
        });
        elements.fileInput.value = "";
        return;
      }

      try {
        state.isUploading = true;
        const layers = await createLayersFromFiles(files);
        state.userLayers.push(...layers);
        saveUserLayers();
        renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
        renderSession();

        const firstLayer = layers[0];
        if (firstLayer.status === "published") {
          layers.forEach((layer) => {
            if (layer.status === "published") {
              addUserLayerToMap(layer);
              state.renderedLayers.set(layer.id, true);
            }
          });
          fitLayer(firstLayer);
        } else {
          previewLayer(firstLayer);
        }

        renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());

        updateInfoPanel({
          title: layers.length === 1 ? firstLayer.title : `${layers.length} capas procesadas`,
          description:
            firstLayer.status === "published"
              ? "La carga quedo disponible para consulta y descarga."
              : "La carga quedo en revision y puede visualizarse antes de ser aprobada.",
          extra: [
            `Formato principal: ${firstLayer.fileType.toUpperCase()}`,
            `Municipio: ${firstLayer.municipality}`,
            `Capas generadas: ${layers.length}`,
          ],
        });
      } catch (error) {
        console.error(error);
        updateInfoPanel({
          title: "No se pudo procesar el archivo",
          description:
            "El archivo cargado no contiene geometria compatible, esta dañado o requiere una estructura diferente.",
        });
      } finally {
        state.isUploading = false;
        elements.fileInput.value = "";
      }
    });
  }

  async function loadStaticData() {
    try {
      const [estadoResponse, municipiosResponse] = await Promise.all([
        fetch("data/base/estado.geojson"),
        fetch("data/base/municipios.geojson"),
      ]);

      if (!estadoResponse.ok || !municipiosResponse.ok) {
        throw new Error("No se pudieron cargar los archivos base.");
      }

      state.staticData.estado = await estadoResponse.json();
      state.staticData.municipios = await municipiosResponse.json();
    } catch (error) {
      console.error("Error cargando datos base:", error);
      updateInfoPanel({
        title: "Carga local limitada",
        description:
          "La interfaz ya funciona, pero los archivos base no se pudieron leer desde esta ruta.",
        extra: ["Sugerencia: abre el proyecto con Live Server o un servidor local HTTP."],
      });
    }
  }

  function renderBaseMapOptions() {
    const basemaps = [
      { id: "satelite", title: "Satelite", description: "Base principal para consulta operativa." },
      { id: "topografico", title: "Topografico", description: "Relieve y contexto fisico." },
      { id: "claro", title: "Claro", description: "Fondo limpio para presentacion." },
      { id: "oscuro", title: "Oscuro", description: "Mayor contraste de capas." },
    ];

    elements.basemapList.innerHTML = basemaps
      .map((basemap) => {
        const checked = basemap.id === state.activeBaseMap ? "checked" : "";
        const activeClass = basemap.id === state.activeBaseMap ? " basemap-option--active" : "";
        return `
          <label class="basemap-option${activeClass}">
            <input type="radio" name="basemap" value="${basemap.id}" ${checked} />
            <span>
              <strong>${basemap.title}</strong><br />
              <span>${basemap.description}</span>
            </span>
          </label>
        `;
      })
      .join("");

    elements.basemapList.querySelectorAll('input[name="basemap"]').forEach((input) => {
      input.addEventListener("change", (event) => {
        state.activeBaseMap = event.target.value;
        applyBaseMapVisibility(state.activeBaseMap);
        renderBaseMapOptions();
      });
    });
  }

  function renderLayerCatalog(searchTerm = "") {
    const layers = buildCatalog()
      .filter((layer) => layerMatchesSearch(layer, searchTerm))
      .filter((layer) => canSeeLayer(layer));

    if (!layers.length) {
      elements.layerList.innerHTML = `
        <div class="empty-state">
          No hay capas que coincidan con la busqueda o con tu nivel de acceso actual.
        </div>
      `;
      return;
    }

    elements.layerList.innerHTML = layers
      .map((layer) => {
        const checked = layer.visible ? "checked" : "";
        const disableToggle = layer.status === "pending" && state.session.role !== "admin" ? "disabled" : "";
        const reviewButton = state.session.role === "admin" && layer.status === "pending"
          ? `<button class="ghost-button" type="button" data-preview="${layer.id}">Visualizar</button>`
          : "";
        const downloadButton = canDownloadLayer(layer)
          ? `<button class="ghost-button" type="button" data-download="${layer.id}">Descargar</button>`
          : "";
        const deleteButton = state.session.role === "admin" && layer.sourceKind !== "static"
          ? `<button class="ghost-button" type="button" data-delete="${layer.id}">Eliminar</button>`
          : "";
        const approveButton = state.session.role === "admin" && layer.status === "pending"
          ? `<button class="primary-button" type="button" data-approve="${layer.id}">Aprobar</button>`
          : "";

        return `
          <div class="layer-item" data-layer-id="${layer.id}">
            <div class="layer-item__meta">
              <input type="checkbox" ${checked} ${disableToggle} />
              <div class="layer-item__copy">
                <strong>${escapeHtml(layer.title)}</strong>
                <span>${escapeHtml(layer.description)}</span>
                <span>${escapeHtml(layer.group)} · ${escapeHtml(layer.municipality || "Cobertura estatal")}</span>
                <div class="layer-badges">${renderBadges(layer)}</div>
              </div>
            </div>
            <div class="layer-actions">
              ${reviewButton}
              ${downloadButton}
              ${deleteButton}
              ${approveButton}
            </div>
          </div>
        `;
      })
      .join("");

    elements.layerList.querySelectorAll(".layer-item").forEach((item) => {
      const layerId = item.dataset.layerId;
      const checkbox = item.querySelector('input[type="checkbox"]');
      checkbox.addEventListener("change", (event) => {
        toggleLayerVisibility(layerId, event.target.checked);
      });
    });

    elements.layerList.querySelectorAll("[data-approve]").forEach((button) => {
      button.addEventListener("click", () => approveLayer(button.dataset.approve));
    });

    elements.layerList.querySelectorAll("[data-preview]").forEach((button) => {
      button.addEventListener("click", () => previewLayerById(button.dataset.preview));
    });

    elements.layerList.querySelectorAll("[data-download]").forEach((button) => {
      button.addEventListener("click", () => downloadLayer(button.dataset.download));
    });

    elements.layerList.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => deleteLayer(button.dataset.delete));
    });
  }

  function buildCatalog() {
    const staticCatalog = staticLayers.map((layer) => ({
      ...layer,
      visible: state.renderedLayers.has(layer.id),
      municipality: "Cobertura estatal",
    }));

    const userCatalog = state.userLayers.map((layer) => ({
      ...layer,
      visible: state.renderedLayers.has(layer.id),
    }));

    return [...staticCatalog, ...userCatalog];
  }

  function layerMatchesSearch(layer, searchTerm) {
    if (!searchTerm) return true;
    const candidate = [
      layer.title,
      layer.group,
      layer.description,
      layer.municipality,
      layer.fileType,
      layer.status === "published" ? "publicado" : "pendiente",
    ]
      .join(" ")
      .toLowerCase();
    return candidate.includes(searchTerm);
  }

  function canSeeLayer(layer) {
    if (layer.status !== "pending") return true;
    if (state.session.role === "admin") return true;
    return state.session.role === "director" && layer.createdBy === state.session.name;
  }

  function canDownloadLayer(layer) {
    return (
      (state.session.role === "admin" || state.session.role === "director") &&
      layer.download &&
      Array.isArray(layer.download.files) &&
      layer.download.files.length > 0
    );
  }

  function renderBadges(layer) {
    const badges = [];
    if (layer.status === "published") {
      badges.push('<span class="badge badge--published">Publicado</span>');
    }
    if (layer.status === "pending") {
      badges.push('<span class="badge badge--pending">Pendiente</span>');
    }
    if (layer.fileType) {
      badges.push(`<span class="badge">${escapeHtml(layer.fileType.toUpperCase())}</span>`);
    }
    return badges.join("");
  }

  function injectStaticSources() {
    if (!state.staticData.estado || !state.staticData.municipios) return;

    upsertGeoJsonSource("estado-source", state.staticData.estado);
    upsertGeoJsonSource("municipios-source", state.staticData.municipios);

    addLayerIfMissing({
      id: "estado-fill",
      type: "fill",
      source: "estado-source",
      paint: {
        "fill-color": "#ffffff",
        "fill-opacity": 0.03,
      },
    });

    addLayerIfMissing({
      id: "estado",
      type: "line",
      source: "estado-source",
      paint: {
        "line-color": "#f5f0e5",
        "line-width": 3,
        "line-opacity": 0.95,
      },
    });

    addLayerIfMissing({
      id: "municipios-hit",
      type: "fill",
      source: "municipios-source",
      paint: {
        "fill-color": "#ffffff",
        "fill-opacity": 0.01,
      },
    });

    addLayerIfMissing({
      id: "municipios",
      type: "line",
      source: "municipios-source",
      paint: {
        "line-color": "#efe4c6",
        "line-width": 1,
        "line-opacity": 0.84,
      },
    });

    setStaticVisibility("estado", staticLayers.find((layer) => layer.id === "estado").visible);
    setStaticVisibility("municipios", staticLayers.find((layer) => layer.id === "municipios").visible);
    bindMunicipiosPopup();
  }

  function injectMeasurementSources() {
    upsertGeoJsonSource("measure-line-source", {
      type: "FeatureCollection",
      features: buildMeasurementLineFeatures(),
    });

    upsertGeoJsonSource("measure-point-source", {
      type: "FeatureCollection",
      features: buildMeasurementPointFeatures(),
    });

    addLayerIfMissing({
      id: "measure-line-layer",
      type: "line",
      source: "measure-line-source",
      paint: {
        "line-color": "#4c91a3",
        "line-width": 3,
        "line-dasharray": [1.2, 1.1],
      },
    });

    addLayerIfMissing({
      id: "measure-point-layer",
      type: "circle",
      source: "measure-point-source",
      paint: {
        "circle-color": "#4c91a3",
        "circle-radius": 6,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }

  function captureVisibleSnapshot() {
    state.visibleSnapshot = {
      staticIds: staticLayers.filter((layer) => layer.visible).map((layer) => layer.id),
      userIds: state.userLayers.filter((layer) => layer.visible !== false && canSeeLayer(layer)).map((layer) => layer.id),
      previewId: state.previewLayerId,
    };
  }

  function restoreMapState() {
    applyVisibleSnapshot();
    applyBaseMapVisibility(state.activeBaseMap);
    injectStaticSources();
    injectMeasurementSources();
    renderVisibleLayers();
    renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    updateToolbarState();
  }

  function applyVisibleSnapshot() {
    const staticIds = new Set(state.visibleSnapshot.staticIds || []);
    const userIds = new Set(state.visibleSnapshot.userIds || []);

    staticLayers.forEach((layer) => {
      layer.visible = staticIds.has(layer.id);
    });

    state.userLayers.forEach((layer) => {
      layer.visible = userIds.has(layer.id);
    });

    state.previewLayerId = state.visibleSnapshot.previewId || null;
  }

  function setStaticVisibility(layerId, visible) {
    if (layerId === "estado") {
      map.setLayoutProperty("estado", "visibility", visible ? "visible" : "none");
      map.setLayoutProperty("estado-fill", "visibility", visible ? "visible" : "none");
    }
    if (layerId === "municipios") {
      map.setLayoutProperty("municipios", "visibility", visible ? "visible" : "none");
      map.setLayoutProperty("municipios-hit", "visibility", visible ? "visible" : "none");
    }
  }

  function buildMeasurementPointFeatures() {
    return state.measurement.points.map((coordinate, index) => ({
      type: "Feature",
      properties: {
        label: index === 0 ? "Inicio" : "Fin",
      },
      geometry: {
        type: "Point",
        coordinates: coordinate,
      },
    }));
  }

  function buildMeasurementLineFeatures() {
    if (state.measurement.points.length < 2) return [];
    return [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: state.measurement.points,
        },
      },
    ];
  }

  function toggleMeasureTool() {
    state.activeTool = state.activeTool === "measure" ? null : "measure";
    if (state.activeTool === "measure") {
      state.measurement.points = [];
      refreshMeasurementLayers();
      updateInfoPanel({
        title: "Medicion activa",
        description: "Haz clic en dos puntos del mapa para calcular la distancia en linea recta.",
      });
    }
    updateToolbarState();
  }

  function togglePointTool() {
    if (!canUpload()) {
      updateInfoPanel({
        title: "Permisos insuficientes",
        description: "Solo administrador y director pueden capturar puntos como nuevas capas.",
      });
      return;
    }

    state.activeTool = state.activeTool === "point" ? null : "point";
    if (state.activeTool === "point") {
      updateInfoPanel({
        title: "Captura de punto activa",
        description: "Haz clic en el mapa para crear una nueva capa puntual.",
      });
    }
    updateToolbarState();
  }

  function updateToolbarState() {
    elements.toolbarMeasure.classList.toggle("is-active", state.activeTool === "measure");
    elements.toolbarAddPoint.classList.toggle("is-active", state.activeTool === "point");
    elements.toolbarAddPoint.classList.toggle("is-hidden", !canUpload());
    elements.triggerUpload.classList.toggle("is-hidden", !canUpload());
    elements.toolbarClearMeasure.classList.toggle("is-hidden", state.measurement.points.length === 0);
    elements.uploadPermissionNote.classList.toggle("is-hidden", canUpload());
    map.getCanvas().style.cursor = state.activeTool ? "crosshair" : "";
  }

  function refreshMeasurementLayers() {
    const lineSource = map.getSource("measure-line-source");
    const pointSource = map.getSource("measure-point-source");
    if (lineSource) {
      lineSource.setData({
        type: "FeatureCollection",
        features: buildMeasurementLineFeatures(),
      });
    }
    if (pointSource) {
      pointSource.setData({
        type: "FeatureCollection",
        features: buildMeasurementPointFeatures(),
      });
    }
    updateToolbarState();
  }

  function clearMeasurement() {
    state.measurement.points = [];
    if (state.activeTool === "measure") {
      state.activeTool = null;
    }
    refreshMeasurementLayers();
    updateInfoPanel({
      title: "Medicion limpiada",
      description: "Se eliminaron los puntos y el trazo de medicion del mapa.",
    });
  }

  function handleMapToolClick(event) {
    if (state.activeTool === "measure") {
      handleMeasurementClick(event.lngLat);
      return;
    }
    if (state.activeTool === "point") {
      createManualPointLayer(event.lngLat);
    }
  }

  function handleMeasurementClick(lngLat) {
    if (state.measurement.points.length >= 2) {
      state.measurement.points = [];
    }

    state.measurement.points.push([lngLat.lng, lngLat.lat]);
    refreshMeasurementLayers();

    if (state.measurement.points.length === 2) {
      const [start, end] = state.measurement.points;
      const meters = computeDistanceMeters(start, end);
      const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];

      updateInfoPanel({
        title: "Resultado de medicion",
        description: `Distancia calculada: ${formatDistance(meters)}.`,
        extra: [
          `Inicio: ${start[1].toFixed(5)}, ${start[0].toFixed(5)}`,
          `Fin: ${end[1].toFixed(5)}, ${end[0].toFixed(5)}`,
        ],
      });

      new maplibregl.Popup({ closeButton: true, closeOnClick: true })
        .setLngLat(midpoint)
        .setHTML(`<strong>Distancia</strong><br />${escapeHtml(formatDistance(meters))}`)
        .addTo(map);
    } else {
      updateInfoPanel({
        title: "Primer punto registrado",
        description: "Haz clic en el segundo punto para completar la medicion.",
      });
    }
  }

  function createManualPointLayer(lngLat) {
    const timestamp = new Date();
    const title = `Punto capturado ${timestamp.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`;
    const data = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            name: title,
            municipio: state.session.municipality,
            capturado_por: state.session.name,
            longitud: lngLat.lng.toFixed(6),
            latitud: lngLat.lat.toFixed(6),
          },
          geometry: {
            type: "Point",
            coordinates: [lngLat.lng, lngLat.lat],
          },
        },
      ],
    };

    const layer = createUserLayer({
      title,
      fileType: "manual",
      sourceKind: "geojson",
      data,
      description: "Punto capturado manualmente desde el visor para consulta operativa.",
    });

    state.userLayers.push(layer);
    saveUserLayers();
    renderSession();
    state.activeTool = null;

    if (layer.status === "published") {
      addUserLayerToMap(layer);
      state.renderedLayers.set(layer.id, true);
    } else {
      previewLayer(layer);
    }

    captureVisibleSnapshot();
    renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    updateToolbarState();
    fitLayer(layer);
    updateInfoPanel({
      title: layer.title,
      description:
        layer.status === "published"
          ? "El punto se agrego como nueva capa publicada."
          : "El punto se agrego como nueva capa pendiente de aprobacion.",
      extra: [
        `Longitud: ${lngLat.lng.toFixed(6)}`,
        `Latitud: ${lngLat.lat.toFixed(6)}`,
      ],
    });
  }

  function renderVisibleLayers() {
    state.renderedLayers.clear();

    staticLayers.forEach((layer) => {
      if (layer.visible) {
        setStaticVisibility(layer.id, true);
        state.renderedLayers.set(layer.id, true);
      } else {
        setStaticVisibility(layer.id, false);
      }
    });

    state.userLayers.forEach((layer) => {
      if (layer.visible !== false && canSeeLayer(layer)) {
        addUserLayerToMap(layer);
        state.renderedLayers.set(layer.id, true);
      }
    });

    if (state.previewLayerId) {
      const previewLayer = state.userLayers.find((layer) => layer.id === state.previewLayerId);
      if (previewLayer && canSeeLayer(previewLayer)) {
        addUserLayerToMap(previewLayer);
        state.renderedLayers.set(previewLayer.id, true);
      }
    }
  }

  function addUserLayerToMap(layer) {
    if (layer.sourceKind === "image") {
      addImageLayerToMap(layer);
      return;
    }
    addGeoJsonLayerToMap(layer);
  }

  function addGeoJsonLayerToMap(layer) {
    const sourceId = `source-${layer.id}`;
    const lineId = `${layer.id}-line`;
    const fillId = `${layer.id}-fill`;
    const pointId = `${layer.id}-point`;
    const defaultLineColor = layer.lineColor || layer.color;
    const defaultFillColor = layer.fillColor || layer.color;
    const defaultPointColor = layer.iconColor || layer.color;

    upsertGeoJsonSource(sourceId, layer.data);

    addLayerIfMissing({
      id: fillId,
      type: "fill",
      source: sourceId,
      filter: ["==", "$type", "Polygon"],
      paint: {
        "fill-color": ["coalesce", ["get", "__styleFill"], defaultFillColor],
        "fill-opacity": 0.45,
      },
    });

    addLayerIfMissing({
      id: lineId,
      type: "line",
      source: sourceId,
      filter: ["in", "$type", "LineString", "Polygon"],
      paint: {
        "line-color": ["coalesce", ["get", "__styleLine"], defaultLineColor],
        "line-width": ["coalesce", ["to-number", ["get", "__styleWidth"]], 2.4],
      },
    });

    addLayerIfMissing({
      id: pointId,
      type: "circle",
      source: sourceId,
      filter: ["==", "$type", "Point"],
      paint: {
        "circle-color": ["coalesce", ["get", "__styleIcon"], defaultPointColor],
        "circle-radius": 6,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.8,
      },
    });

    bindVectorPopup(pointId, layer);
    bindVectorPopup(lineId, layer);
    bindVectorPopup(fillId, layer);
  }

  function addImageLayerToMap(layer) {
    const sourceId = `source-${layer.id}`;
    const rasterId = `${layer.id}-raster`;

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: "image",
        url: layer.imageUrl,
        coordinates: layer.coordinates,
      });
    }

    addLayerIfMissing({
      id: rasterId,
      type: "raster",
      source: sourceId,
      paint: {
        "raster-opacity": 0.8,
        "raster-fade-duration": 0,
      },
    });
  }

  function previewLayer(layer) {
    clearPreviewLayer();
    state.previewLayerId = layer.id;
    addUserLayerToMap(layer);
    state.renderedLayers.set(layer.id, true);
    fitLayer(layer);
    captureVisibleSnapshot();
    renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
  }

  function previewLayerById(layerId) {
    const layer = state.userLayers.find((item) => item.id === layerId);
    if (!layer) return;
    previewLayer(layer);
    updateInfoPanel({
      title: layer.title,
      description: "Vista previa activada para revisar la capa antes de su aprobacion.",
      extra: [
        `Formato: ${layer.fileType.toUpperCase()}`,
        `Municipio: ${layer.municipality}`,
      ],
    });
  }

  function clearPreviewLayer() {
    if (!state.previewLayerId) {
      updateInfoPanel({
        title: "Sin vista temporal",
        description: "No hay una capa pendiente en vista previa para limpiar.",
      });
      return;
    }
    const preview = state.userLayers.find((layer) => layer.id === state.previewLayerId);
    removeLayerBundle(state.previewLayerId);
    state.renderedLayers.delete(state.previewLayerId);
    if (preview && preview.status === "pending") {
      preview.visible = false;
    }
    state.previewLayerId = null;
    saveUserLayers();
    captureVisibleSnapshot();
    renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    updateInfoPanel({
      title: "Vista temporal limpiada",
      description: "La capa pendiente dejo de mostrarse en el mapa.",
    });
  }

  function toggleLayerVisibility(layerId, visible) {
    const staticLayer = staticLayers.find((layer) => layer.id === layerId);
    const userLayer = state.userLayers.find((layer) => layer.id === layerId);

    if (staticLayer) {
      staticLayer.visible = visible;
      setStaticVisibility(layerId, visible);
      if (visible) state.renderedLayers.set(layerId, true);
      else state.renderedLayers.delete(layerId);
    }

    if (userLayer) {
      userLayer.visible = visible;
      if (visible) {
        if (userLayer.status === "published" || userLayer.id === state.previewLayerId) {
          addUserLayerToMap(userLayer);
          state.renderedLayers.set(userLayer.id, true);
        }
      } else {
        removeLayerBundle(userLayer.id);
        state.renderedLayers.delete(userLayer.id);
      }
      saveUserLayers();
    }

    captureVisibleSnapshot();

    const current = staticLayer || userLayer;
    updateInfoPanel({
      title: current.title,
      description: visible ? "La capa esta visible en el mapa." : "La capa fue ocultada del mapa.",
    });
  }

  function approveLayer(layerId) {
    const layer = state.userLayers.find((item) => item.id === layerId);
    if (!layer) return;

    layer.status = "published";
    layer.visible = true;
    saveUserLayers();
    addUserLayerToMap(layer);
    state.renderedLayers.set(layer.id, true);
    renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    renderSession();

    updateInfoPanel({
      title: layer.title,
      description: "La capa fue aprobada y ya es visible para todos los visitantes.",
      extra: [`Municipio: ${layer.municipality}`, `Aprobo: ${state.session.name}`],
    });
  }

  function deleteLayer(layerId) {
    const index = state.userLayers.findIndex((item) => item.id === layerId);
    if (index === -1) return;

    const [layer] = state.userLayers.splice(index, 1);
    removeLayerBundle(layer.id);
    state.renderedLayers.delete(layer.id);
    if (state.previewLayerId === layer.id) {
      state.previewLayerId = null;
    }
    saveUserLayers();
    captureVisibleSnapshot();
    renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    renderSession();

    updateInfoPanel({
      title: layer.title,
      description: "La capa fue eliminada del prototipo.",
      extra: [`Formato: ${layer.fileType.toUpperCase()}`, `Estatus previo: ${layer.status}`],
    });
  }

  function downloadLayer(layerId) {
    const layer = state.userLayers.find((item) => item.id === layerId);
    if (!layer || !canDownloadLayer(layer)) return;

    if (layer.download.files.length === 1) {
      const file = layer.download.files[0];
      downloadFileObject(file.name, file.mimeType, file.base64);
      return;
    }

    const bundleName = `${slugify(layer.title)}.zip`;
    const zip = new window.JSZip();
    layer.download.files.forEach((file) => {
      zip.file(file.name, file.base64, { base64: true });
    });
    zip.generateAsync({ type: "base64" }).then((base64) => {
      downloadFileObject(bundleName, "application/zip", base64);
    });
  }

  function bindMunicipiosPopup() {
    if (map.__municipiosPopupBound) return;
    map.__municipiosPopupBound = true;

    map.on("click", "municipios-hit", (event) => {
      if (state.activeTool) return;
      const feature = event.features && event.features[0];
      if (!feature) return;

      const props = feature.properties || {};
      const name =
        props.NOM_MUN ||
        props.NOMBRE ||
        props.nombre ||
        props.municipio ||
        "Municipio";

      updateInfoPanel({
        title: name,
        description: "Municipio seleccionado para referencia territorial dentro del atlas.",
        extra: ["Tipo: Limite municipal", "Uso recomendado: ubicar fenomenos y capas locales"],
        attributes: props,
      });

      new maplibregl.Popup({ closeButton: true, closeOnClick: true })
        .setLngLat(event.lngLat)
        .setHTML(`<strong>${escapeHtml(name)}</strong><br />Municipio de Morelos`)
        .addTo(map);
    });

    map.on("mouseenter", "municipios-hit", () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", "municipios-hit", () => {
      map.getCanvas().style.cursor = "";
    });
  }

  function bindVectorPopup(layerId, layerMeta) {
    if (!map.getLayer(layerId) || map[`__bound_${layerId}`]) return;
    map[`__bound_${layerId}`] = true;

    map.on("click", layerId, (event) => {
      if (state.activeTool) return;
      const feature = event.features && event.features[0];
      const props = (feature && feature.properties) || {};
      const name = props.name || props.Name || props.NOMBRE || layerMeta.title;

      updateInfoPanel({
        title: name,
        description: layerMeta.description,
        extra: [
          `Municipio: ${layerMeta.municipality || "Sin especificar"}`,
          `Estatus: ${layerMeta.status === "published" ? "Publicado" : "Pendiente"}`,
          `Formato: ${layerMeta.fileType ? layerMeta.fileType.toUpperCase() : "GeoJSON"}`,
        ],
        attributes: props,
      });

      new maplibregl.Popup({ closeButton: true, closeOnClick: true })
        .setLngLat(event.lngLat)
        .setHTML(`
          <strong>${escapeHtml(String(name))}</strong><br />
          ${escapeHtml(layerMeta.municipality || "Cobertura estatal")}<br />
          ${layerMeta.status === "published" ? "Publicado" : "Pendiente de aprobacion"}
        `)
        .addTo(map);
    });

    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  function updateInfoPanel(info) {
    if (!info) return;
    const extras = info.extra
      ? info.extra.map((line) => `<p class="info-copy">${escapeHtml(line)}</p>`).join("")
      : "";
    const attributes = info.attributes ? renderAttributeTable(info.attributes) : "";

    elements.infoPanel.innerHTML = `
      <p class="info-title">${escapeHtml(info.title)}</p>
      <p class="info-copy">${escapeHtml(info.description)}</p>
      ${extras}
      ${attributes}
    `;
  }

  function renderAttributeTable(attributes) {
    const rows = Object.entries(attributes)
      .filter(([key, value]) =>
        !key.startsWith("__") &&
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ""
      )
      .slice(0, 24)
      .map(([key, value]) => `
        <tr>
          <td>${escapeHtml(key)}</td>
          <td>${escapeHtml(String(value))}</td>
        </tr>
      `)
      .join("");

    return rows ? `<table class="info-table">${rows}</table>` : "";
  }

  function renderSession() {
    const roleLabel = roleLabels[state.session.role] || "Visitante";
    const pendingLayers = state.userLayers.filter((layer) => layer.status === "pending");
    const publishedLayers = state.userLayers.filter((layer) => layer.status === "published");

    if (!canUpload() && state.activeTool === "point") {
      state.activeTool = null;
    }

    elements.sessionRoleLabel.textContent = roleLabel;
    elements.sessionSummary.textContent = `${roleLabel} activo`;
    elements.sessionSummaryCopy.textContent = roleCapabilities[state.session.role];
    elements.publishedCount.textContent = String(publishedLayers.length);
    elements.pendingCount.textContent = String(pendingLayers.length);
    elements.openUserAdmin.classList.toggle("hidden", state.session.role !== "admin");
    elements.uploadPermissionNote.textContent = canUpload()
      ? "Puedes subir KML, KMZ, GeoTIFF y Shapefile en ZIP desde este menu."
      : "La medicion es publica. Para subir capas o crear puntos inicia sesion como administrador o director.";
    updateToolbarState();
  }

  function toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    elements.appShell.classList.toggle("app-shell--sidebar-collapsed", state.sidebarCollapsed);
    elements.reopenSidebar.classList.toggle("hidden", !state.sidebarCollapsed);
    map.resize();
  }

  function login() {
    const email = elements.loginEmail.value.trim().toLowerCase();
    const password = elements.loginPassword.value.trim();
    const user = getAllUsers().find((item) => item.email === email && item.password === password);

    if (!user) {
      elements.loginFeedback.textContent = "Credenciales invalidas. Usa los accesos de demostracion.";
      return;
    }

    clearPreviewStateOnRoleChange();
    state.session = {
      role: user.role,
      name: user.name,
      municipality: user.municipality,
    };

    saveSession();
    renderSession();
    renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    elements.loginFeedback.textContent = "";
    elements.loginEmail.value = "";
    elements.loginPassword.value = "";
    elements.loginModal.close();

    updateInfoPanel({
      title: `Sesion iniciada como ${roleLabels[user.role]}`,
      description: roleCapabilities[user.role],
      extra: [`Responsable: ${user.name}`, `Ambito: ${user.municipality}`],
    });
  }

  function canUpload() {
    return state.session.role === "admin" || state.session.role === "director";
  }

  function renderUserAdminPanel() {
    const managedUsers = state.users.filter((user) => user.role === "director" || user.role === "visitante");
    elements.userAdminList.innerHTML = managedUsers.length
      ? managedUsers
          .map((user) => `
            <article class="user-card">
              <strong>${escapeHtml(user.name)}</strong>
              <span>${escapeHtml(user.email)}</span>
              <span>Rol: ${escapeHtml(roleLabels[user.role] || user.role)}</span>
              <span>Municipio: ${escapeHtml(user.municipality || "General")}</span>
            </article>
          `)
          .join("")
      : '<div class="empty-state">Aun no hay usuarios creados desde el panel de administracion.</div>';

    elements.userAdminFeedback.textContent = "";
    syncUserRoleForm();
  }

  function syncUserRoleForm() {
    const isDirector = elements.newUserRole.value === "director";
    elements.newUserMunicipalityField.classList.toggle("hidden", !isDirector);
    elements.newUserMunicipality.required = isDirector;
    if (!isDirector) {
      elements.newUserMunicipality.value = "General";
    } else if (
      elements.newUserMunicipality.value === "General" ||
      !morelosMunicipalities.includes(elements.newUserMunicipality.value)
    ) {
      elements.newUserMunicipality.value = "";
    }
  }

  function createManagedUser() {
    if (state.session.role !== "admin") return;

    const role = elements.newUserRole.value;
    const name = normalizeWhitespace(elements.newUserName.value);
    const email = normalizeWhitespace(elements.newUserEmail.value).toLowerCase();
    const password = elements.newUserPassword.value.trim();
    const municipality =
      role === "director"
        ? normalizeWhitespace(elements.newUserMunicipality.value)
        : "General";

    if (!name || !email || !password) {
      elements.userAdminFeedback.textContent = "Completa nombre, correo y contraseña.";
      return;
    }

    if (role === "director" && !municipality) {
      elements.userAdminFeedback.textContent = "Asigna un municipio para el director.";
      return;
    }

    if (role === "director" && !morelosMunicipalities.includes(municipality)) {
      elements.userAdminFeedback.textContent = "Selecciona un municipio valido de la lista.";
      return;
    }

    if (getAllUsers().some((user) => user.email === email)) {
      elements.userAdminFeedback.textContent = "Ese correo ya esta registrado.";
      return;
    }

    state.users.push({
      email,
      password,
      role,
      name,
      municipality,
    });

    saveUsers();
    renderUserAdminPanel();
    elements.userAdminForm.reset();
    elements.newUserRole.value = "director";
    syncUserRoleForm();
    elements.userAdminFeedback.textContent = "Usuario creado correctamente.";

    updateInfoPanel({
      title: "Usuario registrado",
      description: "La cuenta ya puede iniciar sesion desde el boton Acceso.",
      extra: [
        `Correo: ${email}`,
        `Rol: ${roleLabels[role]}`,
        `Municipio: ${municipality}`,
      ],
    });
  }

  function clearPreviewStateOnRoleChange() {
    if (!state.previewLayerId) return;
    const preview = state.userLayers.find((layer) => layer.id === state.previewLayerId);
    if (preview && preview.status === "pending") {
      removeLayerBundle(preview.id);
      state.renderedLayers.delete(preview.id);
      preview.visible = false;
    }
    state.previewLayerId = null;
    saveUserLayers();
    captureVisibleSnapshot();
  }

  function focusMorelos() {
    if (!state.staticData.estado) {
      updateInfoPanel({
        title: "Vista estatal no disponible",
        description: "Aun no se cargan los limites base de Morelos para centrar el mapa.",
      });
      return;
    }
    fitGeoJSON(state.staticData.estado, { padding: 42, maxZoom: 9.4 });
    updateInfoPanel({
      title: "Vista centrada en Morelos",
      description: "El mapa se reajusto a la extension del estado.",
    });
  }

  function resetMapNorth() {
    map.easeTo({
      bearing: 0,
      pitch: 0,
      duration: 600,
    });
    updateInfoPanel({
      title: "Orientacion restablecida",
      description: "El visor regreso a su orientacion norte.",
    });
  }

  function fitLayer(layer) {
    if (layer.sourceKind === "image") {
      const bounds = new maplibregl.LngLatBounds();
      layer.coordinates.forEach((coordinate) => bounds.extend(coordinate));
      map.fitBounds(bounds, { padding: 30, maxZoom: 12 });
      return;
    }
    fitGeoJSON(layer.data, { padding: 30, maxZoom: 12 });
  }

  function fitGeoJSON(geojson, options = { padding: 30, maxZoom: 11 }) {
    const bounds = new maplibregl.LngLatBounds();
    let hasCoordinates = false;

    walkCoordinates(geojson, (coordinate) => {
      bounds.extend(coordinate);
      hasCoordinates = true;
    });

    if (hasCoordinates) {
      map.fitBounds(bounds, options);
    }
  }

  function walkCoordinates(geojson, callback) {
    const visit = (coordinates) => {
      if (!coordinates) return;
      if (typeof coordinates[0] === "number") {
        callback(coordinates);
        return;
      }
      coordinates.forEach(visit);
    };

    if (geojson.type === "FeatureCollection") {
      geojson.features.forEach((feature) => visit(feature.geometry && feature.geometry.coordinates));
      return;
    }

    if (geojson.type === "Feature") {
      visit(geojson.geometry && geojson.geometry.coordinates);
      return;
    }

    visit(geojson.coordinates);
  }

  function upsertGeoJsonSource(id, data) {
    const existing = map.getSource(id);
    if (existing) {
      existing.setData(data);
      return;
    }

    map.addSource(id, {
      type: "geojson",
      data,
    });
  }

  function addLayerIfMissing(layerDefinition) {
    if (!map.getLayer(layerDefinition.id)) {
      map.addLayer(layerDefinition);
    }
  }

  function createBaseMapStyle(activeBaseMap) {
    const sources = {};
    const layers = [];

    Object.entries(baseMapConfigs).forEach(([baseMapId, entries]) => {
      entries.forEach((entry) => {
        sources[entry.sourceId] = entry.source;
        layers.push({
          id: entry.layerId,
          type: "raster",
          source: entry.sourceId,
          layout: {
            visibility: baseMapId === activeBaseMap ? "visible" : "none",
          },
          paint: {
            "raster-fade-duration": 0,
          },
        });
      });
    });

    return {
      version: 8,
      sources,
      layers,
    };
  }

  function applyBaseMapVisibility(activeBaseMap) {
    if (!map.isStyleLoaded()) return;

    Object.entries(baseMapConfigs).forEach(([baseMapId, entries]) => {
      const visibility = baseMapId === activeBaseMap ? "visible" : "none";
      entries.forEach((entry) => {
        if (map.getLayer(entry.layerId)) {
          map.setLayoutProperty(entry.layerId, "visibility", visibility);
        }
      });
    });
  }

  function removeLayerBundle(layerId) {
    [`${layerId}-point`, `${layerId}-line`, `${layerId}-fill`, `${layerId}-raster`].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });

    const sourceId = `source-${layerId}`;
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
  }

  async function createLayersFromFiles(files) {
    const extensions = files.map((file) => getExtension(file.name));
    const singleUploadExtensions = ["kml", "kmz", "tif", "tiff", "zip"];

    if (files.length === 1 && ["kml", "kmz"].includes(extensions[0])) {
      return [await createKmlLayer(files[0])];
    }

    if (files.length === 1 && ["tif", "tiff"].includes(extensions[0])) {
      return [await createGeoTiffLayer(files[0])];
    }

    if (files.length === 1 && extensions[0] === "zip") {
      return createShapefileLayersFromZip(files[0]);
    }

    if (files.length === 1 && extensions[0] === "rar") {
      throw new Error("Por ahora el visor web admite shapefile comprimido en ZIP. RAR queda para la siguiente etapa con backend.");
    }

    if (extensions.includes("shp")) {
      return createShapefileLayersFromParts(files);
    }

    if (extensions.includes("rar")) {
      throw new Error("Por ahora el visor web admite archivos comprimidos ZIP para shapefile. RAR no esta habilitado en este prototipo.");
    }

    if (files.length > 1 && extensions.every((extension) => singleUploadExtensions.includes(extension))) {
      const groups = await Promise.all(files.map((file) => createLayersFromFiles([file])));
      return groups.flat();
    }

    if (files.length === 1) {
      return [await createKmlLayer(files[0])];
    }

    throw new Error("Tipo de carga no soportado.");
  }

  async function createKmlLayer(file) {
    const extension = getExtension(file.name);
    const text = extension === "kmz" ? await readKmz(file) : await file.text();
    const geojson = parseKml(text);

    if (!geojson.features.length) {
      throw new Error("El archivo no contiene geometria utilizable.");
    }

    return createUserLayer({
      title: file.name.replace(/\.(kml|kmz)$/i, ""),
      fileType: extension,
      sourceKind: "geojson",
      data: geojson,
      description: "Capa cargada desde archivo KML/KMZ para consulta del atlas.",
      download: await buildDownloadBundle([file]),
      lineColor: geojson.meta.lineColor,
      fillColor: geojson.meta.fillColor,
      iconColor: geojson.meta.iconColor,
    });
  }

  async function createShapefileLayersFromZip(file) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await window.shp(arrayBuffer);
    const collections = Array.isArray(result) ? result : [result];
    const download = await buildDownloadBundle([file]);

    return collections.map((collection, index) =>
      createUserLayer({
        title: collection.fileName || file.name.replace(/\.zip$/i, "") || `Shapefile ${index + 1}`,
        fileType: "shp",
        sourceKind: "geojson",
        data: ensureFeatureCollection(collection),
        description: "Capa cargada desde shapefile comprimido.",
        download,
      })
    );
  }

  async function createShapefileLayersFromParts(files) {
    const groups = groupShapefileParts(files);
    const layers = [];

    for (const [baseName, groupFiles] of groups.entries()) {
      const payload = {};
      for (const file of groupFiles) {
        const extension = getExtension(file.name);
        payload[extension] = await file.arrayBuffer();
      }

      const result = await window.shp({
        shp: payload.shp,
        dbf: payload.dbf,
        prj: payload.prj,
        cpg: payload.cpg,
      });

      layers.push(
        createUserLayer({
          title: baseName,
          fileType: "shp",
          sourceKind: "geojson",
          data: ensureFeatureCollection(result),
          description: "Capa cargada desde componentes de shapefile.",
          download: await buildDownloadBundle(groupFiles),
        })
      );
    }

    return layers;
  }

  async function createGeoTiffLayer(file) {
    const tiff = await window.GeoTIFF.fromBlob(file);
    const image = await tiff.getImage();
    const bbox = image.getBoundingBox();

    if (!isLikelyLngLatBbox(bbox)) {
      throw new Error("El GeoTIFF necesita estar en coordenadas geograficas compatibles con el visor.");
    }

    const imageUrl = await renderGeoTiffToDataUrl(image);
    const coordinates = [
      [bbox[0], bbox[3]],
      [bbox[2], bbox[3]],
      [bbox[2], bbox[1]],
      [bbox[0], bbox[1]],
    ];

    return createUserLayer({
      title: file.name.replace(/\.(tif|tiff)$/i, ""),
      fileType: "geotiff",
      sourceKind: "image",
      imageUrl,
      coordinates,
      description: "Raster GeoTIFF cargado para visualizacion territorial.",
      download: await buildDownloadBundle([file]),
    });
  }

  async function renderGeoTiffToDataUrl(image) {
    const width = image.getWidth();
    const height = image.getHeight();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const imageData = context.createImageData(width, height);
    const samples = image.getSamplesPerPixel();

    if (samples >= 3) {
      const rgb = await image.readRGB();
      for (let i = 0; i < width * height; i += 1) {
        imageData.data[i * 4] = rgb[i * 3];
        imageData.data[i * 4 + 1] = rgb[i * 3 + 1];
        imageData.data[i * 4 + 2] = rgb[i * 3 + 2];
        imageData.data[i * 4 + 3] = 180;
      }
    } else {
      const raster = await image.readRasters({ interleave: true });
      const stats = computeRasterStats(raster);
      for (let i = 0; i < width * height; i += 1) {
        const rgba = heatColor(normalizeValue(raster[i], stats.min, stats.max));
        imageData.data[i * 4] = rgba[0];
        imageData.data[i * 4 + 1] = rgba[1];
        imageData.data[i * 4 + 2] = rgba[2];
        imageData.data[i * 4 + 3] = 165;
      }
    }

    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  }

  function computeRasterStats(data) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < data.length; i += 1) {
      const value = data[i];
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      return { min: 0, max: 1 };
    }
    return { min, max };
  }

  function normalizeValue(value, min, max) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }

  function heatColor(value) {
    if (value < 0.33) return [60, 149, 84];
    if (value < 0.66) return [245, 205, 73];
    return [215, 68, 52];
  }

  function computeDistanceMeters(start, end) {
    const earthRadius = 6371008.8;
    const lat1 = degreesToRadians(start[1]);
    const lat2 = degreesToRadians(end[1]);
    const deltaLat = degreesToRadians(end[1] - start[1]);
    const deltaLng = degreesToRadians(end[0] - start[0]);
    const a =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
  }

  function degreesToRadians(value) {
    return value * (Math.PI / 180);
  }

  function formatDistance(meters) {
    if (meters < 1000) return `${meters.toFixed(1)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  }

  function createUserLayer(config) {
    const id = `layer-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const municipality =
      state.session.role === "director" ? state.session.municipality : "Cobertura estatal";

    return {
      id,
      title: config.title,
      description: config.description,
      group: "Capas cargadas",
      status: state.session.role === "admin" ? "published" : "pending",
      visible: true,
      municipality,
      createdBy: state.session.name,
      createdAt: new Date().toISOString(),
      fileType: config.fileType,
      sourceKind: config.sourceKind,
      color: pickLayerColor(state.userLayers.length),
      lineColor: config.lineColor || null,
      fillColor: config.fillColor || null,
      iconColor: config.iconColor || null,
      data: config.data || null,
      imageUrl: config.imageUrl || null,
      coordinates: config.coordinates || null,
      download: config.download || null,
    };
  }

  async function buildDownloadBundle(files) {
    const serializedFiles = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        mimeType: file.type || guessMimeType(file.name),
        base64: await fileToBase64(file),
      }))
    );

    return { files: serializedFiles };
  }

  async function readKmz(file) {
    const zip = await window.JSZip.loadAsync(file);
    const kmlFileName = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith(".kml"));
    if (!kmlFileName) {
      throw new Error("No se encontro un archivo KML dentro del KMZ.");
    }
    return zip.files[kmlFileName].async("text");
  }

  function parseKml(text) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    const styleMap = readKmlStyles(xml);
    const placemarks = [...xml.getElementsByTagName("Placemark")];
    const features = placemarks.flatMap((placemark) => placemarkToFeatures(placemark, styleMap));
    const previewStyle = features.reduce((acc, feature) => {
      const props = feature.properties || {};
      return {
        lineColor: acc.lineColor || props.__styleLine || null,
        fillColor: acc.fillColor || props.__styleFill || null,
        iconColor: acc.iconColor || props.__styleIcon || null,
      };
    }, { lineColor: null, fillColor: null, iconColor: null });

    return {
      type: "FeatureCollection",
      features,
      meta: previewStyle,
    };
  }

  function placemarkToFeatures(placemark, styleMap) {
    const name = readXmlText(placemark, "name") || "Sin nombre";
    const parsedDescription = parseDescriptionPayload(readXmlText(placemark, "description") || "");
    const style = resolvePlacemarkStyle(placemark, styleMap);
    const baseProperties = {
      name,
      description: parsedDescription.text,
      ...parsedDescription.attributes,
      ...readExtendedData(placemark),
      __styleLine: style.lineColor || null,
      __styleFill: style.fillColor || null,
      __styleIcon: style.iconColor || null,
      __styleWidth: style.lineWidth || null,
    };
    const features = [];

    readCoordinates(placemark, "Point").forEach((coordinates) => {
      features.push(feature(baseProperties, { type: "Point", coordinates: coordinates[0] }));
    });

    readCoordinates(placemark, "LineString").forEach((coordinates) => {
      features.push(feature(baseProperties, { type: "LineString", coordinates }));
    });

    [...placemark.getElementsByTagName("Polygon")].forEach((polygon) => {
      const ringNode = polygon.getElementsByTagName("outerBoundaryIs")[0];
      if (!ringNode) return;
      const coordinatesNode = ringNode.getElementsByTagName("coordinates")[0];
      if (!coordinatesNode) return;
      const ring = parseCoordinateString(coordinatesNode.textContent);
      if (ring.length) {
        features.push(feature(baseProperties, { type: "Polygon", coordinates: [ring] }));
      }
    });

    return features;
  }

  function parseDescriptionPayload(rawDescription) {
    if (!rawDescription) {
      return { text: "", attributes: {} };
    }

    const htmlDoc = new DOMParser().parseFromString(rawDescription, "text/html");
    const attributes = {};

    [...htmlDoc.querySelectorAll("tr")].forEach((row) => {
      const cells = row.querySelectorAll("td, th");
      if (cells.length >= 2) {
        const key = normalizeWhitespace(cells[0].textContent);
        const value = normalizeWhitespace(cells[1].textContent);
        if (key && value) attributes[key] = value;
      }
    });

    [...htmlDoc.querySelectorAll("li")].forEach((item, index) => {
      const value = normalizeWhitespace(item.textContent);
      if (value) attributes[`Detalle ${index + 1}`] = value;
    });

    const text = normalizeWhitespace(htmlDoc.body.textContent || rawDescription);
    return { text, attributes };
  }

  function readExtendedData(placemark) {
    const values = {};

    [...placemark.getElementsByTagName("SimpleData")].forEach((node) => {
      const name = node.getAttribute("name");
      if (name) values[name] = node.textContent.trim();
    });

    [...placemark.getElementsByTagName("Data")].forEach((node) => {
      const name = node.getAttribute("name");
      const valueNode = node.getElementsByTagName("value")[0];
      if (name && valueNode) {
        values[name] = valueNode.textContent.trim();
      }
    });

    return values;
  }

  function readKmlStyles(xml) {
    const styles = new Map();

    [...xml.getElementsByTagName("Style")].forEach((styleNode) => {
      const id = styleNode.getAttribute("id");
      if (!id) return;
      styles.set(`#${id}`, extractStyle(styleNode));
    });

    [...xml.getElementsByTagName("StyleMap")].forEach((mapNode) => {
      const id = mapNode.getAttribute("id");
      if (!id) return;
      const normalPair = [...mapNode.getElementsByTagName("Pair")].find((pair) => {
        const keyNode = pair.getElementsByTagName("key")[0];
        return keyNode && keyNode.textContent.trim() === "normal";
      });
      const styleUrlNode = normalPair && normalPair.getElementsByTagName("styleUrl")[0];
      if (styleUrlNode) {
        styles.set(`#${id}`, styles.get(styleUrlNode.textContent.trim()) || {});
      }
    });

    return styles;
  }

  function resolvePlacemarkStyle(placemark, styleMap) {
    const styleUrlNode = placemark.getElementsByTagName("styleUrl")[0];
    const inlineStyleNode = [...placemark.childNodes].find(
      (child) => child.nodeType === 1 && child.tagName === "Style"
    );
    const inlineStyle = inlineStyleNode ? extractStyle(inlineStyleNode) : {};
    const linkedStyle = styleUrlNode ? styleMap.get(styleUrlNode.textContent.trim()) || {} : {};
    return { ...linkedStyle, ...inlineStyle };
  }

  function extractStyle(styleNode) {
    const lineNode = styleNode.getElementsByTagName("LineStyle")[0];
    const polyNode = styleNode.getElementsByTagName("PolyStyle")[0];
    const iconNode = styleNode.getElementsByTagName("IconStyle")[0];

    return {
      lineColor: lineNode ? parseKmlColor(readXmlText(lineNode, "color")) : null,
      lineWidth: lineNode ? Number(readXmlText(lineNode, "width")) || null : null,
      fillColor: polyNode ? parseKmlColor(readXmlText(polyNode, "color")) : null,
      iconColor: iconNode ? parseKmlColor(readXmlText(iconNode, "color")) : null,
    };
  }

  function parseKmlColor(value) {
    const cleaned = (value || "").trim().replace("#", "");
    if (cleaned.length < 8) return null;
    const alpha = parseInt(cleaned.slice(0, 2), 16) / 255;
    const blue = parseInt(cleaned.slice(2, 4), 16);
    const green = parseInt(cleaned.slice(4, 6), 16);
    const red = parseInt(cleaned.slice(6, 8), 16);
    if ([red, green, blue].some((channel) => Number.isNaN(channel))) return null;
    return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;
  }

  function readCoordinates(root, tagName) {
    return [...root.getElementsByTagName(tagName)]
      .map((node) => {
        const coordinateNode = node.getElementsByTagName("coordinates")[0];
        return coordinateNode ? parseCoordinateString(coordinateNode.textContent) : [];
      })
      .filter((coordinates) => coordinates.length);
  }

  function parseCoordinateString(value) {
    return value
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(",").map(Number))
      .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
      .map(([lng, lat]) => [lng, lat]);
  }

  function readXmlText(root, tagName) {
    const node = root.getElementsByTagName(tagName)[0];
    return node ? node.textContent.trim() : "";
  }

  function feature(properties, geometry) {
    return {
      type: "Feature",
      properties,
      geometry,
    };
  }

  function ensureFeatureCollection(data) {
    if (data.type === "FeatureCollection") return data;
    if (Array.isArray(data.features)) return { type: "FeatureCollection", features: data.features };
    return { type: "FeatureCollection", features: [] };
  }

  function groupShapefileParts(files) {
    const groups = new Map();
    files.forEach((file) => {
      const extension = getExtension(file.name);
      const baseName = file.name.replace(/\.[^.]+$/, "");
      if (!groups.has(baseName)) groups.set(baseName, []);
      groups.get(baseName).push(file);
      if (!["shp", "dbf", "prj", "cpg"].includes(extension)) {
        throw new Error("Para shapefile usa .zip o los archivos .shp .dbf .prj .cpg.");
      }
    });
    return groups;
  }

  function isLikelyLngLatBbox(bbox) {
    return (
      Array.isArray(bbox) &&
      bbox.length === 4 &&
      Math.abs(bbox[0]) <= 180 &&
      Math.abs(bbox[2]) <= 180 &&
      Math.abs(bbox[1]) <= 90 &&
      Math.abs(bbox[3]) <= 90
    );
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result);
        resolve(result.split(",")[1] || "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function downloadFileObject(name, mimeType, base64) {
    const anchor = document.createElement("a");
    anchor.href = `data:${mimeType};base64,${base64}`;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function getExtension(name) {
    return String(name).split(".").pop().toLowerCase();
  }

  function guessMimeType(name) {
    const extension = getExtension(name);
    const types = {
      kml: "application/vnd.google-earth.kml+xml",
      kmz: "application/vnd.google-earth.kmz",
      tif: "image/tiff",
      tiff: "image/tiff",
      shp: "application/octet-stream",
      dbf: "application/octet-stream",
      prj: "text/plain",
      cpg: "text/plain",
      zip: "application/zip",
    };
    return types[extension] || "application/octet-stream";
  }

  function slugify(value) {
    return String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function pickLayerColor(index) {
    const palette = ["#d06d43", "#2f7d5f", "#916bb5", "#3266c7", "#a93f55", "#45888d"];
    return palette[index % palette.length];
  }

  function loadSession() {
    try {
      const session = JSON.parse(localStorage.getItem(STORAGE_KEYS.session));
      if (session && session.role) return session;
    } catch (error) {
      console.warn("No se pudo leer la sesion almacenada.", error);
    }

    return {
      role: "visitante",
      name: "Consulta publica",
      municipality: "General",
    };
  }

  function saveSession() {
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(state.session));
  }

  function loadUsers() {
    try {
      const users = JSON.parse(localStorage.getItem(STORAGE_KEYS.users));
      return Array.isArray(users) ? users : [];
    } catch (error) {
      console.warn("No se pudieron leer los usuarios guardados.", error);
      return [];
    }
  }

  function saveUsers() {
    localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(state.users));
  }

  function getAllUsers() {
    return [...demoUsers, ...state.users];
  }

  function loadUserLayers() {
    try {
      const layers = JSON.parse(localStorage.getItem(STORAGE_KEYS.layers));
      return Array.isArray(layers) ? layers : [];
    } catch (error) {
      console.warn("No se pudieron leer las capas guardadas.", error);
      return [];
    }
  }

  function saveUserLayers() {
    localStorage.setItem(STORAGE_KEYS.layers, JSON.stringify(state.userLayers));
  }
})();
