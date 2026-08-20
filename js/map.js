import { runtimeConfig } from "./app/config/runtime-config.js";
import { loginRequest } from "./app/services/auth-api.js";
import {
  createUserRequest,
  listUsersRequest,
  resetPasswordRequest,
  setUserRoleRequest,
  setUserStatusRequest,
} from "./app/services/users-api.js";
import {
  approveLayerRequest,
  deleteLayerRequest,
  listAdminLayersRequest,
  listMyLayersRequest,
  listPendingLayersRequest,
  listPublicLayersRequest,
  rejectLayerRequest,
  setPublishStateRequest,
  uploadLayerRequest,
} from "./app/services/layers-api.js";
import {
  analyzeStyleField,
  buildInstitutionalHazardLegend,
  buildContinuousClassification,
  containsHtmlMarkup as containsRemoteStyleHtml,
  getInstitutionalHazardLabel,
  isInstitutionalHazardField,
} from "./app/utils/remote-style-utils.js";
import {
  buildSemanticLegendFromFeatures,
  buildTechnicalStyleFallbackLegend,
  isTechnicalStyleField,
  normalizePublishedVectorLegend,
} from "./app/utils/remote-legend-utils.js";
import {
  analyzeGeospatialFile,
  createGroundOverlayObjectUrls,
} from "./app/utils/geospatial-importer.js";
import {
  GROUND_OVERLAY_FALLBACK_LEGEND_LABEL,
  GROUND_OVERLAY_NOTICE,
  buildGroundOverlayInfoLines,
  pickTopGroundOverlayHit,
} from "./app/utils/ground-overlay-popup-utils.js";

  const MORELOS_CENTER = [-99.07, 18.84];
  const STORAGE_KEYS = {
    session: "egem-session",
    layerPrefs: "egem-layer-prefs-v1",
    managedUsers: "egem-managed-users-v1",
    topbarMode: "egem-topbar-mode-v1",
  };
  const MAP_ROTATION_STEP = 20;
  const MAP_PITCH_STEP = 12;
  const MAX_MAP_PITCH = 70;
  const DEFAULT_MAP_MAX_ZOOM = 22;
  const SATELLITE_MAP_MAX_ZOOM = 20;

  const roleLabels = {
    admin: "Administrador",
    director: "Alimentador",
    visitante: "Visitante",
  };

  const roleCapabilities = {
    admin: "Puede revisar, aprobar, visualizar y descargar capas cargadas.",
    director: "Puede cargar capas para revisión y consultar sus propias cargas.",
    visitante: "Solo puede consultar capas ya publicadas.",
  };

  const demoUsers = [
    {
      id: "demo-admin",
      name: "Administrador del Atlas",
      email: "admin@egem.morelos",
      password: "Admin123!",
      role: "admin",
      backendRole: "ADMIN",
      municipality: "Estado de Morelos",
      isActive: true,
      source: "demo",
    },
    {
      id: "demo-director-cuernavaca",
      name: "Director Cuernavaca",
      email: "director.cuernavaca@egem.morelos",
      password: "Director123!",
      role: "director",
      backendRole: "DATA_PROVIDER",
      municipality: "Cuernavaca",
      isActive: true,
      source: "demo",
    },
    {
      id: "demo-visitante",
      name: "Visitante del Atlas",
      email: "visitante@egem.morelos",
      password: "Visitante123!",
      role: "visitante",
      backendRole: "PUBLIC_USER",
      municipality: "General",
      isActive: true,
      source: "demo",
    },
  ];

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
        sourceId: "satellite-source",
        layerId: "satellite-layer",
        minzoom: 0,
        maxzoom: 24,
        source: {
          type: "raster",
          tiles: [
            "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          minzoom: 0,
          // Esri World Imagery puede tener tiles faltantes en z18+.
          // Usamos maxzoom nativo 17 para forzar overzoom y evitar "Map data not yet available".
          maxzoom: 17,
          attribution: "Tiles © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
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
      title: "Límite estatal",
      group: "Límites",
      category: "limites",
      status: "published",
      sourceKind: "static",
      visible: true,
      opacity: 1,
      description: "Contorno general del estado de Morelos.",
    },
    {
      id: "municipios",
      title: "Municipios",
      group: "Límites",
      category: "limites",
      status: "published",
      sourceKind: "static",
      visible: true,
      opacity: 1,
      description: "División municipal para consulta operativa.",
    },
  ];

  const thematicLayerGroups = [
    { id: "limites", title: "Límites" },
    { id: "geologicos", title: "Geológicos" },
    { id: "hidrometeorologicos", title: "Hidrometeorológicos" },
    { id: "quimicos-tecnologicos", title: "Químicos - Tecnológicos" },
    { id: "sanitario-ecologico", title: "Sanitario - Ecológico" },
    { id: "socio-organizativo", title: "Socio - Organizativo" },
    { id: "astronomicos", title: "Astronómicos" },
    { id: "otras", title: "Otras capas" },
  ];

  const state = {
    activeBaseMap: "satelite",
    activeTool: null,
    session: loadSession(),
    sidebarCollapsed: false,
    topbarCollapsed: loadTopbarModePreference(),
    compactMenuOpen: false,
    viewportMode: null,
    isUploading: false,
    remoteSyncInProgress: false,
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
    users: [],
    userLayers: loadUserLayers(),
    renderedLayers: new Map(),
    pendingOpacityFrames: new Map(),
    pendingLayerLoads: new Map(),
    selectedLayerId: null,
    activeLayerStack: [],
    activeInfoPopup: null,
    activeLegendLayerId: null,
    symbologyCache: new Map(),
    previewLayerId: null,
    lastCapturedLayerId: null,
    backendStatus: {
      reachable: false,
      lastError: null,
      state: "unknown",
    },
    uploadDraft: {
      files: [],
      category: "geologicos",
      previewLayers: [],
      previewVisible: false,
      minimized: false,
      rasterLegendItems: [],
    },
  };

  const map = new maplibregl.Map({
    container: "map",
    style: createBaseMapStyle(state.activeBaseMap),
    center: MORELOS_CENTER,
    zoom: 8.2,
    minZoom: 6,
    maxZoom: state.activeBaseMap === "satelite" ? SATELLITE_MAP_MAX_ZOOM : DEFAULT_MAP_MAX_ZOOM,
    dragRotate: true,
    pitchWithRotate: true,
    touchPitch: true,
  });

  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
  map.addControl(new maplibregl.NavigationControl({ showZoom: false, visualizePitch: true }), "bottom-right");
  if (typeof maplibregl.FullscreenControl === "function") {
    map.addControl(new maplibregl.FullscreenControl(), "bottom-right");
  }
  enableAdvancedMapInteraction();

  const elements = {
    appShell: document.querySelector(".app-shell"),
    topbar: document.querySelector(".topbar"),
    topbarBrandToggle: document.getElementById("toggle-topbar-brand"),
    topbarCompactMenu: document.getElementById("topbar-compact-menu"),
    topbarSessionChip: document.getElementById("topbar-session-chip"),
    controlPanel: document.querySelector(".control-panel"),
    basemapFlyout: document.getElementById("basemap-flyout"),
    basemapFlyoutList: document.getElementById("basemap-flyout-list"),
    toolbarBasemap: document.getElementById("toolbar-basemap"),
    closeBasemapFlyout: document.getElementById("close-basemap-flyout"),
    layerList: document.getElementById("layer-list"),
    layerCatalogNotice: document.getElementById("layer-catalog-notice"),
    mapLegendFloat: document.getElementById("map-legend-float"),
    layerSearch: document.getElementById("layer-search"),
    infoPanel: document.getElementById("info-panel"),
    statusbar: document.getElementById("statusbar"),
    statusbarLon: document.getElementById("statusbar-lon"),
    statusbarLat: document.getElementById("statusbar-lat"),
    sessionRoleLabel: document.getElementById("session-role-label"),
    publishedCount: document.getElementById("published-count"),
    pendingCount: document.getElementById("pending-count"),
    uploadPermissionNote: document.getElementById("upload-permission-note"),
    toolsOverlay: document.getElementById("tools-overlay"),
    fileInput: document.getElementById("file-input"),
    uploadDraftInput: document.getElementById("upload-draft-input"),
    uploadLayerModal: document.getElementById("upload-layer-modal"),
    uploadLayerForm: document.getElementById("upload-layer-form"),
    minimizeUploadLayer: document.getElementById("minimize-upload-layer"),
    closeUploadLayer: document.getElementById("close-upload-layer"),
    cancelUploadLayer: document.getElementById("cancel-upload-layer"),
    uploadSelectFiles: document.getElementById("upload-select-files"),
    uploadSelectedFiles: document.getElementById("upload-selected-files"),
    uploadLayerCategory: document.getElementById("upload-layer-category"),
    uploadPreviewToggle: document.getElementById("upload-preview-toggle"),
    uploadPreviewState: document.getElementById("upload-preview-state"),
    uploadLayerFeedback: document.getElementById("upload-layer-feedback"),
    uploadLayerTitle: document.getElementById("upload-layer-title"),
    uploadLayerDescription: document.getElementById("upload-layer-description"),
    uploadLayerMunicipality: document.getElementById("upload-layer-municipality"),
    uploadLayerSource: document.getElementById("upload-layer-source"),
    uploadLayerAgency: document.getElementById("upload-layer-agency"),
    uploadLayerUpdatedAt: document.getElementById("upload-layer-updated-at"),
    uploadLayerScale: document.getElementById("upload-layer-scale"),
    uploadLayerCrs: document.getElementById("upload-layer-crs"),
    rasterLegendEditor: document.getElementById("raster-legend-editor"),
    rasterLegendList: document.getElementById("raster-legend-list"),
    addRasterLegendItem: document.getElementById("add-raster-legend-item"),
    trialNoticeModal: document.getElementById("trial-notice-modal"),
    acceptTrialNotice: document.getElementById("accept-trial-notice"),
    closeTrialNotice: document.getElementById("close-trial-notice"),
    loginModal: document.getElementById("login-modal"),
    helpModal: document.getElementById("help-modal"),
    userAdminModal: document.getElementById("user-admin-modal"),
    loginForm: document.getElementById("login-form"),
    userAdminForm: document.getElementById("user-admin-form"),
    loginEmail: document.getElementById("login-email"),
    loginPassword: document.getElementById("login-password"),
    toggleLoginPassword: document.getElementById("toggle-login-password"),
    loginFeedback: document.getElementById("login-feedback"),
    openUserAdmin: document.getElementById("open-user-admin"),
    logoutSession: document.getElementById("logout-session"),
    closeUserAdmin: document.getElementById("close-user-admin"),
    newUserName: document.getElementById("new-user-name"),
    newUserEmail: document.getElementById("new-user-email"),
    newUserPassword: document.getElementById("new-user-password"),
    toggleNewUserPassword: document.getElementById("toggle-new-user-password"),
    newUserRole: document.getElementById("new-user-role"),
    newUserMunicipalityField: document.getElementById("new-user-municipality-field"),
    newUserMunicipality: document.getElementById("new-user-municipality"),
    userAdminFeedback: document.getElementById("user-admin-feedback"),
    userAdminList: document.getElementById("user-admin-list"),
    reopenSidebar: document.getElementById("reopen-sidebar"),
    collapseMobilePanel: document.getElementById("collapse-mobile-panel"),
    panelQuicknav: document.getElementById("panel-quicknav"),
    toggleTopbar: document.getElementById("toggle-topbar"),
    toggleCompactMenu: document.getElementById("toggle-compact-menu"),
    triggerUpload: document.getElementById("trigger-upload"),
    toolbarTogglePanel: document.getElementById("toolbar-toggle-panel"),
    toolbarZoomIn: document.getElementById("toolbar-zoom-in"),
    toolbarZoomOut: document.getElementById("toolbar-zoom-out"),
    toolbarResetNorth: document.getElementById("toolbar-reset-north"),
    toolbarFullscreen: document.getElementById("toolbar-fullscreen"),
    toolbarRotateLeft: document.getElementById("toolbar-rotate-left"),
    toolbarRotateRight: document.getElementById("toolbar-rotate-right"),
    toolbarPitchUp: document.getElementById("toolbar-pitch-up"),
    toolbarPitchDown: document.getElementById("toolbar-pitch-down"),
    toolbarMeasure: document.getElementById("toolbar-measure"),
    toolbarAddPoint: document.getElementById("toolbar-add-point"),
    toolbarFocusMorelos: document.getElementById("focus-morelos-menu"),
    toolbarClearMeasure: document.getElementById("toolbar-clear-measure"),
    compactOpenTerritorialQuery: document.getElementById("compact-open-territorial-query"),
    territorialQueryModal: document.getElementById("territorial-query-modal"),
    closeTerritorialQuery: document.getElementById("close-territorial-query"),
  };

  map.on("mousemove", (event) => {
    elements.statusbarLon.textContent = event.lngLat.lng.toFixed(5);
    elements.statusbarLat.textContent = event.lngLat.lat.toFixed(5);
  });

  map.on("error", (event) => {
    if (event?.error?.message?.includes("World_Imagery")) {
      console.warn("Error cargando tiles de Esri World Imagery", event.error);
    }
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
    await initializeRemoteState();
    showTrialNoticeModal();
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
      openUploadModal();
    });

    elements.toolbarTogglePanel.addEventListener("click", toggleSidebar);
    elements.toolbarZoomIn.addEventListener("click", () => map.zoomIn());
    elements.toolbarZoomOut.addEventListener("click", () => map.zoomOut());
    elements.toolbarResetNorth.addEventListener("click", resetMapNorth);
    elements.toolbarFullscreen?.addEventListener("click", toggleFullscreen);
    elements.toolbarRotateLeft.addEventListener("click", () => rotateMapBy(-MAP_ROTATION_STEP));
    elements.toolbarRotateRight.addEventListener("click", () => rotateMapBy(MAP_ROTATION_STEP));
    elements.toolbarPitchUp.addEventListener("click", () => adjustMapPitch(MAP_PITCH_STEP));
    elements.toolbarPitchDown.addEventListener("click", () => adjustMapPitch(-MAP_PITCH_STEP));
    elements.toolbarMeasure.addEventListener("click", toggleMeasureTool);
    elements.toolbarAddPoint.addEventListener("click", togglePointTool);
    elements.toolbarFocusMorelos.addEventListener("click", focusMorelos);
    elements.toolbarClearMeasure.addEventListener("click", clearMeasurement);
    elements.toolbarBasemap?.addEventListener("click", toggleBasemapFlyout);
    elements.closeBasemapFlyout?.addEventListener("click", closeBasemapFlyout);
    document.getElementById("toggle-sidebar").addEventListener("click", () => {
      toggleSidebar();
      closeCompactMenu();
    });
    elements.reopenSidebar.addEventListener("click", toggleSidebar);
    elements.collapseMobilePanel?.addEventListener("click", toggleSidebar);
    elements.topbarBrandToggle?.addEventListener("click", toggleTopbar);
    elements.toggleTopbar.addEventListener("click", toggleTopbar);
    elements.toggleCompactMenu?.addEventListener("click", toggleCompactMenu);
    elements.toggleLoginPassword.addEventListener("click", () => togglePasswordFieldVisibility(elements.loginPassword, elements.toggleLoginPassword));
    elements.toggleNewUserPassword.addEventListener("click", () => togglePasswordFieldVisibility(elements.newUserPassword, elements.toggleNewUserPassword));
    syncPasswordToggleButton(elements.loginPassword, elements.toggleLoginPassword);
    syncPasswordToggleButton(elements.newUserPassword, elements.toggleNewUserPassword);
    syncResponsiveLayout();
    syncSidebarState();
    syncTopbarState();

    document.getElementById("open-login").addEventListener("click", () => {
      closeCompactMenu();
      elements.loginModal.showModal();
    });

    elements.uploadSelectFiles.addEventListener("click", () => {
      elements.uploadDraftInput.click();
    });

    elements.minimizeUploadLayer?.addEventListener("click", () => {
      minimizeUploadModal();
    });

    elements.closeUploadLayer.addEventListener("click", () => {
      closeUploadModal();
    });

    elements.cancelUploadLayer.addEventListener("click", () => {
      closeUploadModal();
    });

    elements.uploadLayerModal.addEventListener("cancel", (event) => {
      event.preventDefault();
      minimizeUploadModal();
    });

    window.addEventListener("resize", () => {
      syncResponsiveLayout();
      if (elements.uploadLayerModal?.open) {
        positionUploadModal();
      }
    });

    document.addEventListener("click", (event) => {
      const closeFloatingLegendButton = event.target.closest("[data-close-floating-legend]");
      if (closeFloatingLegendButton) {
        closeFloatingLegend({ restoreFocus: true });
        return;
      }

      if (
        elements.basemapFlyout &&
        !elements.basemapFlyout.hidden &&
        !elements.basemapFlyout.contains(event.target) &&
        !elements.toolbarBasemap?.contains(event.target)
      ) {
        closeBasemapFlyout();
      }

      if (!state.compactMenuOpen) return;
      if (
        elements.topbarCompactMenu?.contains(event.target) ||
        elements.toggleCompactMenu?.contains(event.target)
      ) {
        return;
      }
      closeCompactMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && elements.basemapFlyout && !elements.basemapFlyout.hidden) {
        closeBasemapFlyout();
      }
      if (event.key === "Escape" && state.activeLegendLayerId) {
        closeFloatingLegend({ restoreFocus: true });
      }
      if (event.key === "Escape" && state.compactMenuOpen) {
        closeCompactMenu({ restoreFocus: true });
      }
    });

    elements.topbarCompactMenu?.addEventListener("keydown", handleCompactMenuKeydown);

    elements.panelQuicknav?.querySelectorAll("[data-panel-target]").forEach((button) => {
      button.addEventListener("click", () => scrollPanelToSection(button.dataset.panelTarget));
    });

    elements.uploadLayerCategory.addEventListener("change", async (event) => {
      state.uploadDraft.category = event.target.value;
      applyCategoryToDraftLayers();
      if (state.uploadDraft.previewVisible) {
        await refreshUploadDraftPreview();
      } else {
        syncUploadDraftUi();
      }
    });

    elements.uploadPreviewToggle.addEventListener("click", async () => {
      await toggleUploadDraftPreview();
    });

    elements.acceptTrialNotice?.addEventListener("click", closeTrialNoticeModal);
    elements.closeTrialNotice?.addEventListener("click", closeTrialNoticeModal);
    elements.trialNoticeModal?.addEventListener("click", (event) => {
      if (event.target === elements.trialNoticeModal) {
        closeTrialNoticeModal();
      }
    });
    elements.trialNoticeModal?.addEventListener("close", restoreViewerFocus);

    elements.addRasterLegendItem?.addEventListener("click", () => {
      state.uploadDraft.rasterLegendItems.push({
        label: "",
        color: "#7a203a",
      });
      renderRasterLegendEditor();
    });

    elements.logoutSession.addEventListener("click", async () => {
      closeCompactMenu();
      logout();
      await syncLayersFromBackend({ preserveSessionVisibility: false });
    });

    document.getElementById("close-login").addEventListener("click", () => {
      elements.loginPassword.type = "password";
      syncPasswordToggleButton(elements.loginPassword, elements.toggleLoginPassword);
      elements.loginModal.close();
    });

    document.getElementById("open-help").addEventListener("click", () => {
      closeCompactMenu();
      elements.helpModal.showModal();
    });

    document.getElementById("close-help").addEventListener("click", () => {
      elements.helpModal.close();
    });

    elements.openUserAdmin.addEventListener("click", async () => {
      if (state.session.role !== "admin") return;
      closeCompactMenu();
      await renderUserAdminPanel();
      elements.userAdminModal.showModal();
    });

    elements.compactOpenTerritorialQuery?.addEventListener("click", openTerritorialQuery);
    elements.closeTerritorialQuery?.addEventListener("click", closeTerritorialQuery);
    elements.territorialQueryModal?.addEventListener("click", (event) => {
      if (event.target === elements.territorialQueryModal) {
        closeTerritorialQuery();
      }
    });
    elements.territorialQueryModal?.addEventListener("close", restoreViewerFocus);
    elements.closeUserAdmin.addEventListener("click", () => {
      elements.newUserPassword.type = "password";
      syncPasswordToggleButton(elements.newUserPassword, elements.toggleNewUserPassword);
      elements.userAdminModal.close();
    });

    document.getElementById("continue-visitor").addEventListener("click", () => {
      clearPreviewStateOnRoleChange();
      resetThematicRuntimeState();
      state.session = createVisitorSession();
      saveSession();
      renderSession();
      syncLayersFromBackend({ preserveSessionVisibility: false });
      elements.loginPassword.type = "password";
      syncPasswordToggleButton(elements.loginPassword, elements.toggleLoginPassword);
      elements.loginModal.close();
    });

    elements.loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await login();
    });

    elements.userAdminForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await createManagedUser();
    });

    elements.uploadLayerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitUploadDraft();
    });

    elements.newUserRole.addEventListener("change", syncUserRoleForm);

    elements.layerSearch.addEventListener("input", () => {
      renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    });

    elements.uploadDraftInput.addEventListener("change", async (event) => {
      const files = [...(event.target.files || [])];
      elements.uploadDraftInput.value = "";
      if (!files.length) return;
      await setUploadDraftFiles(files);
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
        await uploadFilesToBackend(files);
      } catch (error) {
        console.error(error);
        updateInfoPanel({
          title: "No se pudo procesar el archivo",
          description:
            "El archivo cargado no contiene geometría compatible, está dañado o requiere una estructura diferente.",
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
      { id: "satelite", title: "Satelite", description: "Imagen satelital", thumbnail: "satellite" },
      { id: "topografico", title: "Topografico", description: "Relieve", thumbnail: "topographic" },
      { id: "claro", title: "Claro", description: "Calles claras", thumbnail: "light" },
      { id: "oscuro", title: "Oscuro", description: "Alto contraste", thumbnail: "dark" },
    ];

    [elements.basemapFlyoutList].filter(Boolean).forEach((container) => {
      container.innerHTML = basemaps
      .map((basemap) => {
        const checked = basemap.id === state.activeBaseMap ? "checked" : "";
        const activeClass = basemap.id === state.activeBaseMap ? " basemap-option--active" : "";
        return `
          <label class="basemap-option basemap-option--compact${activeClass}" title="${escapeHtml(basemap.description)}">
            <span class="basemap-option__thumb basemap-option__thumb--${basemap.thumbnail}" aria-hidden="true"></span>
            <input type="radio" name="basemap" value="${basemap.id}" ${checked} />
            <span class="basemap-option__copy">
              <strong>${basemap.title}</strong>
              <span>${basemap.description}</span>
            </span>
          </label>
        `;
      })
      .join("");

      container.querySelectorAll('input[name="basemap"]').forEach((input) => {
        input.addEventListener("change", (event) => {
          state.activeBaseMap = event.target.value;
          applyBaseMapVisibility(state.activeBaseMap);
          restoreStateBoundaryHighlight();
          renderBaseMapOptions();
        });
      });
    });
  }

  function toggleBasemapFlyout() {
    const shouldOpen = elements.basemapFlyout?.hidden;
    if (shouldOpen) {
      openBasemapFlyout();
    } else {
      closeBasemapFlyout();
    }
  }

  function openBasemapFlyout() {
    if (!elements.basemapFlyout) return;
    renderBaseMapOptions();
    resetBasemapFlyoutPositionProperties();
    elements.basemapFlyout.hidden = false;
    elements.toolbarBasemap?.setAttribute("aria-expanded", "true");
  }

  function closeBasemapFlyout() {
    if (!elements.basemapFlyout) return;
    elements.basemapFlyout.hidden = true;
    elements.toolbarBasemap?.setAttribute("aria-expanded", "false");
  }

  function resetBasemapFlyoutPositionProperties() {
    if (!elements.basemapFlyout) return;
    [
      "left",
      "right",
      "top",
      "bottom",
      "inset",
      "transform",
      "translate",
      "--basemap-flyout-left",
      "--basemap-flyout-top",
      "--basemap-flyout-width",
    ].forEach((property) => {
      elements.basemapFlyout.style.removeProperty(property);
    });
  }

  function renderLayerCatalogLegacy(searchTerm = "") {
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
        const disableToggle = isPendingStatus(layer.status) && state.session.role !== "admin" ? "disabled" : "";
        const reviewButton = state.session.role === "admin" && canPreviewLayer(layer)
          ? `<button class="ghost-button" type="button" data-preview="${layer.id}">Visualizar</button>`
          : "";
        const downloadButton = canDownloadLayer(layer)
          ? `<button class="ghost-button" type="button" data-download="${layer.id}">Descargar</button>`
          : "";
        const deleteButton = state.session.role === "admin" && layer.sourceKind !== "static"
          ? `<button class="ghost-button" type="button" data-delete="${layer.id}">Eliminar</button>`
          : "";
        const approveButton = state.session.role === "admin" && layer.status === "pending_review"
          ? `<button class="primary-button" type="button" data-approve="${layer.id}">Aprobar</button>`
          : "";
        const rejectButton = state.session.role === "admin" && layer.status === "pending_review"
          ? `<button class="ghost-button" type="button" data-reject="${layer.id}">Rechazar</button>`
          : "";
        const publishButton = state.session.role === "admin" && canTogglePublish(layer)
          ? `<button class="ghost-button" type="button" data-publish="${layer.id}">${layer.status === "published" ? "Despublicar" : "Publicar"}</button>`
          : "";

        return `
          <div class="layer-item" data-layer-id="${layer.id}">
            <div class="layer-item__meta">
              <input type="checkbox" ${checked} ${disableToggle} />
              <div class="layer-item__copy">
                <strong>${escapeHtml(layer.title)}</strong>
              </div>
            </div>
            <div class="layer-actions">
              ${reviewButton}
              ${downloadButton}
              ${publishButton}
              ${deleteButton}
              ${rejectButton}
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
        toggleLayerVisibility(layerId, event.target.checked).catch((error) => {
          console.error("No se pudo cambiar la visibilidad de la capa.", error);
        });
      });
    });

    elements.layerList.querySelectorAll("[data-approve]").forEach((button) => {
      button.addEventListener("click", () => approveLayer(button.dataset.approve));
    });

    elements.layerList.querySelectorAll("[data-preview]").forEach((button) => {
      button.addEventListener("click", () => {
        previewLayerById(button.dataset.preview).catch((error) => {
          console.error("No se pudo visualizar la capa.", error);
        });
      });
    });

    elements.layerList.querySelectorAll("[data-download]").forEach((button) => {
      button.addEventListener("click", () => downloadLayer(button.dataset.download));
    });

    elements.layerList.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => deleteLayer(button.dataset.delete));
    });

    elements.layerList.querySelectorAll("[data-reject]").forEach((button) => {
      button.addEventListener("click", () => rejectLayer(button.dataset.reject));
    });

    elements.layerList.querySelectorAll("[data-publish]").forEach((button) => {
      button.addEventListener("click", () => togglePublishLayer(button.dataset.publish));
    });

    elements.layerList.querySelectorAll("[data-opacity]").forEach((input) => {
      input.addEventListener("input", (event) => {
        updateLayerOpacity(event.target.dataset.opacity, Number(event.target.value), { persist: false });
        const label = event.target.closest(".layer-opacity-control")?.querySelector("strong");
        if (label) {
          label.textContent = `${Math.round(Number(event.target.value))}%`;
        }
      });
      input.addEventListener("change", (event) => {
        updateLayerOpacity(event.target.dataset.opacity, Number(event.target.value), { persist: true });
      });
    });
  }

  function buildCatalog() {
    const staticCatalog = staticLayers.map((layer) => ({
      ...layer,
      visible: Boolean(layer.visible),
      municipality: "Cobertura estatal",
    }));

    const userCatalog = state.userLayers.map((layer) => ({
      ...layer,
      visible: Boolean(layer.visible),
    }));

    return [...staticCatalog, ...userCatalog];
  }

  function renderLayerCatalog(searchTerm = "") {
    const layers = buildCatalog()
      .filter((layer) => layerMatchesSearch(layer, searchTerm))
      .filter((layer) => canSeeLayer(layer));
    syncLayerCatalogNotice();

    if (!layers.length && searchTerm) {
      elements.layerList.innerHTML = `
        <div class="empty-state">
          No hay capas que coincidan con la busqueda o con tu nivel de acceso actual.
        </div>
      `;
      return;
    }

    const groupedLayers = groupCatalogLayers(layers);
    if (state.selectedLayerId && !layers.some((layer) => layer.id === state.selectedLayerId)) {
      clearSelectedLayer();
    }

    elements.layerList.innerHTML = getVisibleLayerGroups(groupedLayers, searchTerm)
      .map((group) => renderLayerGroup(group, groupedLayers.get(group.id) || [], searchTerm))
      .join("");

    elements.layerList.querySelectorAll(".layer-item").forEach((item) => {
      const layerId = item.dataset.layerId;
      const checkbox = item.querySelector('input[type="checkbox"]');
      item.addEventListener("click", (event) => {
        if (event.target.closest("button, input, label, a")) return;
        selectLayer(layerId);
      });
      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target.closest("button, input, label, a")) return;
        event.preventDefault();
        selectLayer(layerId);
      });
      checkbox.addEventListener("change", (event) => {
        toggleLayerVisibility(layerId, event.target.checked).catch((error) => {
          console.error("No se pudo cambiar la visibilidad de la capa.", error);
        });
      });
    });

    elements.layerList.querySelectorAll("[data-select-layer]").forEach((button) => {
      button.addEventListener("click", () => selectLayer(button.dataset.selectLayer));
    });

    elements.layerList.querySelectorAll("[data-approve]").forEach((button) => {
      button.addEventListener("click", () => approveLayer(button.dataset.approve));
    });

    elements.layerList.querySelectorAll("[data-preview]").forEach((button) => {
      button.addEventListener("click", () => {
        previewLayerById(button.dataset.preview).catch((error) => {
          console.error("No se pudo visualizar la capa.", error);
        });
      });
    });

    elements.layerList.querySelectorAll("[data-download]").forEach((button) => {
      button.addEventListener("click", () => downloadLayer(button.dataset.download));
    });

    elements.layerList.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => deleteLayer(button.dataset.delete));
    });

    elements.layerList.querySelectorAll("[data-reject]").forEach((button) => {
      button.addEventListener("click", () => rejectLayer(button.dataset.reject));
    });

    elements.layerList.querySelectorAll("[data-publish]").forEach((button) => {
      button.addEventListener("click", () => togglePublishLayer(button.dataset.publish));
    });

    elements.layerList.querySelectorAll("[data-opacity]").forEach((input) => {
      input.addEventListener("input", (event) => {
        updateLayerOpacity(event.target.dataset.opacity, Number(event.target.value), { persist: false });
        const label = event.target.closest(".layer-opacity-control")?.querySelector("strong");
        if (label) {
          label.textContent = `${Math.round(Number(event.target.value))}%`;
        }
      });
      input.addEventListener("change", (event) => {
        updateLayerOpacity(event.target.dataset.opacity, Number(event.target.value), { persist: true });
      });
    });
  }

  function groupCatalogLayers(layers) {
    const grouped = new Map(thematicLayerGroups.map((group) => [group.id, []]));
    layers.forEach((layer) => {
      const category = resolveLayerCategory(layer);
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(layer);
    });
    return grouped;
  }

  function renderLayerGroup(group, layers, searchTerm = "") {
    const hasLayers = layers.length > 0;
    const shouldOpen = hasLayers || !searchTerm;
    const openAttribute = shouldOpen ? "open" : "";
    const countLabel = hasLayers ? `${layers.length} capa${layers.length === 1 ? "" : "s"}` : "Sin capas";
    const content = hasLayers
      ? layers.map((layer) => renderLayerItem(layer)).join("")
      : `<p class="layer-group__empty">No hay capas disponibles en esta subcapa por ahora.</p>`;

    return `
      <details class="layer-group" ${openAttribute}>
        <summary class="layer-group__summary">
          <div class="layer-group__heading">
            <strong>${escapeHtml(group.title)}</strong>
            <span>${escapeHtml(countLabel)}</span>
          </div>
          <span class="layer-group__chevron" aria-hidden="true"></span>
        </summary>
        <div class="layer-group__content">
          ${content}
        </div>
      </details>
    `;
  }

  function renderLayerItem(layer) {
    const checked = layer.visible ? "checked" : "";
    const disableToggle = !canSeeLayer(layer) || layer.isLoading ? "disabled" : "";
    const loadingStatus = layer.isLoading ? '<span class="layer-loading-state" aria-live="polite">Cargando capa...</span>' : "";
    const reviewButton = state.session.role === "admin" && canPreviewLayer(layer)
      ? `<button class="ghost-button" type="button" data-preview="${layer.id}">Visualizar</button>`
      : "";
    const downloadButton = canDownloadLayer(layer)
      ? `<button class="ghost-button" type="button" data-download="${layer.id}">Descargar</button>`
      : "";
    const deleteButton = canDeleteLayer(layer)
      ? `<button class="ghost-button" type="button" data-delete="${layer.id}">Eliminar</button>`
      : "";
    const approveButton = state.session.role === "admin" && layer.status === "pending_review"
      ? `<button class="primary-button" type="button" data-approve="${layer.id}">Aprobar</button>`
      : "";
    const rejectButton = state.session.role === "admin" && layer.status === "pending_review"
      ? `<button class="ghost-button" type="button" data-reject="${layer.id}">Rechazar</button>`
      : "";
    const publishButton = state.session.role === "admin" && canTogglePublish(layer)
      ? `<button class="ghost-button" type="button" data-publish="${layer.id}">${layer.status === "published" ? "Despublicar" : "Publicar"}</button>`
      : "";
    const actionButtons = [reviewButton, downloadButton, publishButton, deleteButton, rejectButton, approveButton]
      .filter(Boolean)
      .join("");
    const opacityValue = getLayerOpacityPercent(layer);
    const itemClassName = `layer-item ${layer.visible ? "is-visible" : "is-hidden-layer"}${state.selectedLayerId === layer.id ? " is-selected" : ""}`;

    return `
      <div class="${itemClassName}" data-layer-id="${layer.id}" role="button" tabindex="0" aria-pressed="${state.selectedLayerId === layer.id ? "true" : "false"}">
        <div class="layer-item__meta">
          <input type="checkbox" ${checked} ${disableToggle} aria-label="Mostrar u ocultar ${escapeHtml(layer.title)}" />
          <div class="layer-item__copy">
            <button class="layer-select-button" type="button" data-select-layer="${escapeHtml(layer.id)}">${escapeHtml(layer.title)}</button>
            <label class="layer-opacity-control">
              <span>Visibilidad <strong>${opacityValue}%</strong></span>
              <input type="range" min="10" max="100" step="5" value="${opacityValue}" data-opacity="${layer.id}" />
            </label>
            ${loadingStatus}
          </div>
        </div>
        ${actionButtons ? `<div class="layer-actions">${actionButtons}</div>` : ""}
      </div>
    `;
  }

  function resolveLayerCategory(layer) {
    const directCategory = normalizeLayerCategoryKey(layer.category || layer.theme || layer.topic);
    if (directCategory) return directCategory;

    const haystack = normalizeLayerCategoryText(
      [
        layer.group,
        layer.title,
        layer.description,
        layer.fileType,
        layer.municipality,
      ].join(" ")
    );

    if (matchesCategory(haystack, ["limite", "limites", "municipio", "municipios", "estado", "cobertura estatal"])) {
      return "limites";
    }
    if (matchesCategory(haystack, ["geologic", "ladera", "falla", "volcan", "erosion", "desliz", "sismo"])) {
      return "geologicos";
    }
    if (matchesCategory(haystack, ["hidrometeorologic", "inund", "lluv", "huracan", "torment", "sequia", "rio", "agua"])) {
      return "hidrometeorologicos";
    }
    if (matchesCategory(haystack, ["quimic", "tecnolog", "gas", "explos", "incend", "combust", "ducto"])) {
      return "quimicos-tecnologicos";
    }
    if (matchesCategory(haystack, ["sanitari", "ecologic", "salud", "contamin", "residuo", "basur", "cementerio", "covid", "contagio", "epidem", "pandem", "biologic"])) {
      return "sanitario-ecologico";
    }
    if (matchesCategory(haystack, ["socio", "organiz", "poblacion", "refugio", "vulnerabilidad", "evacuacion"])) {
      return "socio-organizativo";
    }
    if (matchesCategory(haystack, ["astronomic", "meteorito", "solar", "lunar", "espacial"])) {
      return "astronomicos";
    }
    return "otras";
  }

  function normalizeLayerCategoryKey(value) {
    if (!value) return null;
    const normalized = normalizeLayerCategoryText(value)
      .replace(/[\s_/]+/g, "-")
      .replace(/-+/g, "-");

    const aliases = {
      limites: "limites",
      limite: "limites",
      geologicos: "geologicos",
      geologico: "geologicos",
      hidrometeorologicos: "hidrometeorologicos",
      hidrometeorologico: "hidrometeorologicos",
      "quimicos-tecnologicos": "quimicos-tecnologicos",
      "quimico-tecnologico": "quimicos-tecnologicos",
      "sanitario-ecologico": "sanitario-ecologico",
      "sanitario-ecologicos": "sanitario-ecologico",
      "socio-organizativo": "socio-organizativo",
      "socio-organizativos": "socio-organizativo",
      astronomicos: "astronomicos",
      astronomico: "astronomicos",
      otras: "otras",
    };

    return aliases[normalized] || null;
  }

  function normalizeLayerCategoryText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function matchesCategory(value, keywords) {
    return keywords.some((keyword) => value.includes(keyword));
  }

  function clampLayerOpacity(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 1;
    return Math.min(1, Math.max(0.1, numeric));
  }

  function getLayerOpacity(layer) {
    return clampLayerOpacity(layer?.opacity ?? 1);
  }

  function getLayerOpacityPercent(layer) {
    return Math.round(getLayerOpacity(layer) * 100);
  }

  function getLayerStyleOpacityPaintValue(layer) {
    const opacity = getLayerOpacity(layer);
    const styleOpacity = getLayerStyleOpacityMode(layer);
    if (styleOpacity.type === "scalar") {
      return styleOpacity.value * opacity;
    }
    if (styleOpacity.type === "expression") {
      return ["*", ["coalesce", ["to-number", ["get", "__styleOpacity"]], 1], opacity];
    }
    return opacity;
  }

  function getLayerStyleOpacityMode(layer) {
    if (layer.__styleOpacityMode) return layer.__styleOpacityMode;
    const values = [];
    const features = Array.isArray(layer?.data?.features) ? layer.data.features : [];

    features.forEach((feature) => {
      const raw = feature?.properties?.__styleOpacity;
      if (raw === null || raw === undefined || raw === "") return;
      const value = Number(raw);
      if (Number.isFinite(value)) values.push(Math.min(1, Math.max(0, value)));
    });

    const uniqueValues = [...new Set(values.map((value) => String(value)))].map(Number);
    if (!uniqueValues.length) {
      layer.__styleOpacityMode = { type: "none" };
    } else if (uniqueValues.length === 1) {
      layer.__styleOpacityMode = { type: "scalar", value: uniqueValues[0] };
    } else {
      layer.__styleOpacityMode = { type: "expression" };
    }
    return layer.__styleOpacityMode;
  }

  function layerMatchesSearch(layer, searchTerm) {
    if (!searchTerm) return true;
    const candidate = [
      layer.title,
      layer.group,
      layer.description,
      layer.municipality,
      layer.fileType,
      getStatusLabel(layer.status),
    ]
      .join(" ")
      .toLowerCase();
    return candidate.includes(searchTerm);
  }

  function canSeeLayer(layer) {
    if (isPublishedStatus(layer.status)) return true;
    if (state.session.role === "admin") return true;
    return (
      state.session.role === "director" &&
      (layer.createdById === state.session.userId || layer.createdBy === state.session.name)
    );
  }

  function canDownloadLayer(layer) {
    return (
      (state.session.role === "admin" || state.session.role === "director") &&
      layer.download &&
      Array.isArray(layer.download.files) &&
      layer.download.files.length > 0
    );
  }

  function canDeleteLayer(layer) {
    if (layer.sourceKind === "static") return false;
    if (state.session.role === "admin") return true;
    return (
      state.session.role === "director" &&
      (layer.createdById === state.session.userId || layer.createdBy === state.session.name)
    );
  }

  function renderBadges(layer) {
    if (!canUpload()) return "";
    const badges = [];
    badges.push(`<span class="badge ${getStatusBadgeClass(layer.status)}">${escapeHtml(getStatusLabel(layer.status))}</span>`);
    if (layer.fileType) {
      badges.push(`<span class="badge">${escapeHtml(layer.fileType.toUpperCase())}</span>`);
    }
    if (layer.backendLayerId) {
      const visualStatus = layer.isVisualizable ? "Procesada" : getProcessingStatusLabel(layer.processingStatus);
      badges.push(`<span class="badge ${layer.isVisualizable ? "badge--published" : "badge--pending"}">${escapeHtml(visualStatus)}</span>`);
    }
    return badges.join("");
  }

  function getVisibleLayerGroups(groupedLayers, searchTerm = "") {
    if (searchTerm) return thematicLayerGroups;
    if (state.backendStatus.state === "unavailable" || state.backendStatus.state === "http-error" || state.backendStatus.state === "invalid") {
      return thematicLayerGroups.filter((group) => (groupedLayers.get(group.id) || []).length > 0);
    }
    return thematicLayerGroups;
  }

  function syncLayerCatalogNotice() {
    if (!elements.layerCatalogNotice) return;
    const message = getLayerCatalogNoticeMessage();
    elements.layerCatalogNotice.textContent = message;
    elements.layerCatalogNotice.classList.toggle("hidden", !message);
  }

  function showTrialNoticeModal() {
    if (!elements.trialNoticeModal || elements.trialNoticeModal.open) return;
    if (typeof elements.trialNoticeModal.showModal === "function") {
      elements.trialNoticeModal.showModal();
    } else {
      elements.trialNoticeModal.setAttribute("open", "");
    }
    window.requestAnimationFrame(() => {
      elements.acceptTrialNotice?.focus();
    });
  }

  function closeTrialNoticeModal() {
    if (!elements.trialNoticeModal?.open) return;
    elements.trialNoticeModal.close();
  }

  function restoreViewerFocus() {
    const viewerShell = document.querySelector(".app-shell");
    if (viewerShell && typeof viewerShell.focus === "function") {
      viewerShell.focus({ preventScroll: true });
    }
  }

  function getLayerCatalogNoticeMessage() {
    if (state.backendStatus.state === "unavailable") {
      return "Las capas temáticas no están disponibles temporalmente. El mapa base y los límites territoriales continúan operativos.";
    }
    if (state.backendStatus.state === "empty") {
      return "Por el momento no hay capas temáticas publicadas.";
    }
    if (state.backendStatus.state === "http-error" || state.backendStatus.state === "invalid") {
      return "Las capas temáticas no pudieron consultarse temporalmente. El mapa base y los límites territoriales continúan operativos.";
    }
    return "";
  }

  function selectLayer(layerId, options = {}) {
    const layer = findCatalogLayer(layerId);
    if (!layer || !canSeeLayer(layer)) {
      clearSelectedLayer();
      return;
    }

    state.selectedLayerId = layerId;
    updateInfoPanel({
      title: layer.title,
      description: layer.description || "Capa disponible para consulta territorial.",
      legend: getLayerSymbology(layer),
    });
    if (options.renderCatalog !== false) {
      renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    }
  }

  function clearSelectedLayer() {
    state.selectedLayerId = null;
  }

  function findCatalogLayer(layerId) {
    return buildCatalog().find((layer) => layer.id === layerId) || null;
  }

  function openFloatingLegendForLayer(layerId, options = {}) {
    const layer = findCatalogLayer(layerId);
    if (!layer || !canSeeLayer(layer)) {
      closeFloatingLegend({ renderCatalog: options.renderCatalog });
      return;
    }

    state.activeLegendLayerId = layerId;
    renderFloatingLegend(layer);
    if (options.renderCatalog !== false) {
      renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    }
  }

  function syncFloatingLegendAfterLayerDeactivation(layerId) {
    if (state.activeLegendLayerId !== layerId) return;
    const fallbackId = [...state.activeLayerStack]
      .reverse()
      .find((candidateId) => {
        const layer = findCatalogLayer(candidateId);
        return isThematicQueryableLayer(layer);
      });
    if (fallbackId) {
      openFloatingLegendForLayer(fallbackId);
    } else {
      closeFloatingLegend();
    }
  }

  function renderFloatingLegend(layer) {
    if (!elements.mapLegendFloat) return;
    const categoryTitle = getLayerCategoryTitle(layer) || "Capa temática";
    const content = renderFloatingLegendContent(layer);
    elements.mapLegendFloat.hidden = false;
    elements.mapLegendFloat.innerHTML = `
      <div class="map-legend-float__header">
        <div>
          <p class="section-kicker">${escapeHtml(categoryTitle)}</p>
          <strong>${escapeHtml(layer.title)}</strong>
        </div>
        <button class="icon-button icon-button--small" type="button" data-close-floating-legend aria-label="Cerrar simbología">x</button>
      </div>
      <div class="map-legend-float__body">
        ${content || `<p class="empty-state">Esta capa no tiene simbología disponible.</p>`}
      </div>
    `;
  }

  function renderFloatingLegendContent(layer) {
    const sections = [];
    const vectorLegend = getVectorLayerSymbology(layer);
    if (vectorLegend) {
      sections.push(`
        <section class="floating-legend-section">
          ${isImageBackedLayer(layer) ? `<p class="info-copy"><strong>Simbologia vectorial</strong></p>` : ""}
          ${renderLayerLegend(vectorLegend)}
        </section>
      `);
    }

    if (isImageBackedLayer(layer)) {
      const rasterLegend = getRasterLayerSymbology(layer);
      sections.push(`
        <section class="floating-legend-section">
          ${layer.data?.features?.length ? `<p class="info-copy"><strong>Simbologia raster</strong></p>` : ""}
          ${renderLayerLegend(rasterLegend)}
        </section>
      `);
    }

    if (!sections.length) {
      const legend = getLayerSymbology(layer);
      if (legend) sections.push(renderLayerLegend(legend));
    }

    return sections.filter(Boolean).join("");
  }

  function getVectorLayerSymbology(layer) {
    if (!layer.data?.features?.length) {
      return layer.legend?.type && layer.legend.type !== "raster" ? layer.legend : null;
    }
    const vectorLayer = {
      ...layer,
      legend: layer.legend?.type === "raster" ? null : layer.legend,
    };
    return buildLayerSymbology(vectorLayer);
  }

  function getRasterLayerSymbology(layer) {
    if (layer.legend?.type === "raster" && Array.isArray(layer.legend.classes) && layer.legend.classes.length) {
      return layer.legend;
    }
    return {
      type: "raster",
      field: "Simbologia raster",
      classes: [{
        label: GROUND_OVERLAY_FALLBACK_LEGEND_LABEL,
        color: "transparent",
        outlineColor: "rgba(70, 36, 49, 0.35)",
      }],
    };
  }

  function closeFloatingLegend(options = {}) {
    state.activeLegendLayerId = null;
    if (elements.mapLegendFloat) {
      elements.mapLegendFloat.hidden = true;
      elements.mapLegendFloat.innerHTML = "";
    }
    if (options.renderCatalog !== false) {
      renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    }
  }

  function closeLegendIfLayerUnavailable() {
    if (!state.activeLegendLayerId) return;
    const layer = findCatalogLayer(state.activeLegendLayerId);
    if (!layer || !canSeeLayer(layer)) {
      closeFloatingLegend();
    }
  }

  function getLayerSymbology(layer) {
    const cacheKey = `${layer.id}:${layer.legend ? JSON.stringify(layer.legend) : ""}:${layer.symbology?.field || ""}:${layer.data?.features?.length || 0}`;
    if (state.symbologyCache.has(cacheKey)) return state.symbologyCache.get(cacheKey);
    const legend = buildLayerSymbology(layer);
    state.symbologyCache.set(cacheKey, legend);
    return legend;
  }

  function buildLayerSymbology(layer) {
    if (layer.legend?.type === "raster" && Array.isArray(layer.legend.classes)) {
      return layer.legend;
    }

    if (isImageBackedLayer(layer) && !layer.data?.features?.length) {
      return {
        type: "raster",
        field: "Simbologia raster",
        classes: [{
          label: GROUND_OVERLAY_FALLBACK_LEGEND_LABEL,
          color: "transparent",
          outlineColor: "rgba(70, 36, 49, 0.35)",
        }],
      };
    }

    if (layer.legend?.type && layer.legend.type !== "raster" && Array.isArray(layer.legend.classes)) {
      if (layer.legend.type !== "continuous") return layer.legend;
      return normalizeLayerLegend(layer.legend, layer);
    }

    if (layer.sourceKind === "static") {
      const color = layer.id === "estado" ? "#00E5FF" : "#8F7B5A";
      return {
        type: "categorical",
        field: "Limite",
        classes: [{ label: layer.title, color, outlineColor: color }],
      };
    }

    const features = layer.data?.features || [];
    if (!features.length) {
      return buildSingleStyleLegend(layer);
    }

    const persistedStyleField = layer.symbology?.field && !isTechnicalStyleField(layer.symbology.field)
      ? layer.symbology.field
      : null;
    const styleField = persistedStyleField || chooseLegendField(features);
    const values = styleField ? getFeatureFieldValues(features, styleField) : [];
    if (styleField && isInstitutionalHazardField(styleField)) {
      const hazardLegend = buildInstitutionalHazardLegend(values);
      if (hazardLegend) return hazardLegend;
    }

    const styleClasses = buildPreservedStyleClasses(features, styleField);
    if (styleClasses.length) {
      return {
        type: "categorical",
        field: styleField || "Estilo",
        classes: styleClasses,
      };
    }

    const technicalFallbackLegend = buildTechnicalStyleFallbackLegend(features);
    if (technicalFallbackLegend) return technicalFallbackLegend;

    return buildSingleStyleLegend(layer);
  }

  function normalizeLayerLegend(legend, layer) {
    if (isInstitutionalHazardField(legend.field)) {
      const values = layer.data?.features?.length ? getFeatureFieldValues(layer.data.features, legend.field) : [];
      const hazardLegend = buildInstitutionalHazardLegend(values);
      if (hazardLegend) return hazardLegend;
    }
    return legend;
  }

  function chooseLegendField(features) {
    const priorityFields = [
      "Intensidad",
      "Riesgo",
      "Peligro",
      "Vulnerabilidad",
      "Nivel",
      "Categoria",
      "Categoría",
      "Clasificación",
      "Clasificacion",
      "Fen_Clasif",
      "IVS_FINAL",
      "Magni_num",
      "Intens_num",
    ];
    return priorityFields.find((field) => getFeatureFieldValues(features, field).length) || findMostVariableSafeStyleField(features);
  }

  function buildPreservedStyleClasses(features, styleField) {
    const classes = new Map();
    features.forEach((feature) => {
      const properties = feature.properties || {};
      const label =
        (styleField && !isTechnicalStyleField(styleField) && getPropertyValueByAlias(properties, [styleField])) ||
        getPropertyValueByAlias(properties, ["name", "Name", "NOMBRE"]) ||
        "Estilo de la capa";
      const color =
        properties.__styleFill ||
        properties.__styleLine ||
        properties.__styleIcon ||
        getStyleColorForValue(label, { uniqueCount: 2 });
      if (!isUsablePopupValue(label) || !color) return;
      const normalizedLabel = String(label).trim();
      if (!classes.has(normalizedLabel)) {
        classes.set(normalizedLabel, {
          label: normalizedLabel,
          color,
          outlineColor: properties.__styleLine || properties.__styleStroke || properties.stroke || color,
        });
      }
    });
    return [...classes.values()].slice(0, 12);
  }

  function buildSingleStyleLegend(layer) {
    const color = layer.fillColor || layer.lineColor || layer.iconColor || layer.color;
    if (!color) return null;
    return {
      type: "categorical",
      field: "Estilo",
      classes: [{
        label: "Simbolo de la capa",
        color,
        outlineColor: layer.lineColor || layer.fillColor || layer.iconColor || layer.color,
      }],
    };
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
        "fill-opacity": 0,
      },
    });

    addLayerIfMissing({
      id: "estado",
      type: "line",
      source: "estado-source",
      paint: {
        "line-color": "#10212B",
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 4, 10, 5, 14, 6],
        "line-opacity": 0.44 * getLayerOpacity(staticLayers.find((layer) => layer.id === "estado")),
      },
    });

    addLayerIfMissing({
      id: "estado-highlight-halo",
      type: "line",
      source: "estado-source",
      paint: {
        "line-color": "#10212B",
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 5, 10, 7, 14, 9],
        "line-opacity": 0.86 * getLayerOpacity(staticLayers.find((layer) => layer.id === "estado")),
      },
    });

    addLayerIfMissing({
      id: "estado-highlight",
      type: "line",
      source: "estado-source",
      paint: {
        "line-color": "#00E5FF",
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2.2, 10, 3.6, 14, 5],
        "line-opacity": 1 * getLayerOpacity(staticLayers.find((layer) => layer.id === "estado")),
      },
    });

    addLayerIfMissing({
      id: "municipios-hit",
      type: "fill",
      source: "municipios-source",
      paint: {
        "fill-color": "#ffffff",
        "fill-opacity": 0.01 * getLayerOpacity(staticLayers.find((layer) => layer.id === "municipios")),
      },
    });

    addLayerIfMissing({
      id: "municipios",
      type: "line",
      source: "municipios-source",
      paint: {
        "line-color": "#efe4c6",
        "line-width": 1,
        "line-opacity": getLayerOpacity(staticLayers.find((layer) => layer.id === "municipios")),
      },
    });

    setStaticVisibility("estado", staticLayers.find((layer) => layer.id === "estado").visible);
    setStaticVisibility("municipios", staticLayers.find((layer) => layer.id === "municipios").visible);
    restoreStateBoundaryHighlight();
    bindMunicipiosPopup();
  }

  function restoreStateBoundaryHighlight() {
    const visible = staticLayers.find((layer) => layer.id === "estado")?.visible !== false;
    ["estado-highlight-halo", "estado-highlight"].forEach((layerId) => {
      if (!map.getLayer(layerId)) return;
      safeSetLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
      try {
        map.moveLayer(layerId);
      } catch (error) {
        console.warn("No se pudo reposicionar el límite estatal resaltado:", error);
      }
    });
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
      safeSetLayoutProperty("estado", "visibility", visible ? "visible" : "none");
      safeSetLayoutProperty("estado-fill", "visibility", visible ? "visible" : "none");
      safeSetLayoutProperty("estado-highlight-halo", "visibility", visible ? "visible" : "none");
      safeSetLayoutProperty("estado-highlight", "visibility", visible ? "visible" : "none");
    }
    if (layerId === "municipios") {
      safeSetLayoutProperty("municipios", "visibility", visible ? "visible" : "none");
      safeSetLayoutProperty("municipios-hit", "visibility", visible ? "visible" : "none");
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
      return;
    }

    const thematicHit = getTopThematicPopupHit(event);
    if (thematicHit) {
      showThematicPopup(thematicHit, event.lngLat);
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
    state.lastCapturedLayerId = layer.id;
    saveUserLayers();
    renderSession();
    state.activeTool = null;

    if (layer.status === "published") {
      addUserLayerToMap(layer);
      state.renderedLayers.set(layer.id, true);
    } else {
      previewLayer(layer).catch((error) => {
        console.error("No se pudo activar la vista previa del punto capturado.", error);
      });
    }

    captureVisibleSnapshot();
    renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    updateToolbarState();
    fitLayer(layer);
    updateInfoPanel({
      title: layer.title,
      description:
        layer.status === "published"
          ? "El punto se agregó como nueva capa publicada."
          : "El punto se agregó como nueva capa pendiente de aprobación. Si te equivocaste, puedes eliminarlo desde el listado de capas.",
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
      applyStaticLayerOpacity(layer.id);
    });

    state.userLayers.forEach((layer) => {
      if (layer.visible !== false && canSeeLayer(layer)) {
        if (canRenderLayerFromCachedResources(layer)) {
          addUserLayerToMap(layer);
          state.renderedLayers.set(layer.id, true);
        }
      } else {
        removeLayerBundle(layer.id);
        state.renderedLayers.delete(layer.id);
      }
    });
    rebuildActiveLayerStack();

    if (state.previewLayerId) {
      const previewLayer = state.userLayers.find((layer) => layer.id === state.previewLayerId);
      if (previewLayer && canSeeLayer(previewLayer)) {
        if (canRenderLayerFromCachedResources(previewLayer)) {
          addUserLayerToMap(previewLayer);
          state.renderedLayers.set(previewLayer.id, true);
        }
      }
    }
    restoreStateBoundaryHighlight();
  }

  function canRenderLayerFromCachedResources(layer) {
    if (!layer) return false;
    if (isImageBackedLayer(layer) && getLayerGroundOverlays(layer).length) return true;
    if (layer.data) return true;
    return !layer.processedGeojsonUrl;
  }

  function resetThematicRuntimeState(options = {}) {
    state.userLayers.forEach((layer) => {
      layer.visible = false;
      layer.isLoading = false;
      setUserLayerLayoutVisibility(layer, false);
      if (options.removeRenderedLayers !== false) {
        removeLayerBundle(layer.id);
        state.renderedLayers.delete(layer.id);
      }
    });
    state.pendingLayerLoads.clear();
    state.activeLayerStack = [];
    state.previewLayerId = null;
    closeActiveInfoPopup();
    closeFloatingLegend({ renderCatalog: false });
  }

  function rebuildActiveLayerStack() {
    const visibleLayerIds = state.userLayers
      .filter((layer) => isThematicQueryableLayer(layer))
      .map((layer) => layer.id);
    state.activeLayerStack = state.activeLayerStack
      .filter((layerId) => visibleLayerIds.includes(layerId));
    visibleLayerIds.forEach((layerId) => {
      if (!state.activeLayerStack.includes(layerId)) {
        state.activeLayerStack.push(layerId);
      }
    });
    closePopupIfOwnerUnavailable();
    closeLegendIfLayerUnavailable();
  }

  function isThematicQueryableLayer(layer) {
    return Boolean(
      layer &&
      layer.visible !== false &&
      canSeeLayer(layer) &&
      layer.id !== state.previewLayerId
    );
  }

  function activateLayerInStack(layerId) {
    state.activeLayerStack = state.activeLayerStack.filter((id) => id !== layerId);
    const layer = state.userLayers.find((item) => item.id === layerId);
    if (isThematicQueryableLayer(layer)) {
      state.activeLayerStack.push(layerId);
    }
  }

  function deactivateLayerInStack(layerId) {
    state.activeLayerStack = state.activeLayerStack.filter((id) => id !== layerId);
  }

  async function ensureLayerResourcesLoaded(layer) {
    if (!layer || layer.data || !layer.processedGeojsonUrl) return layer;
    if (state.pendingLayerLoads.has(layer.id)) {
      return state.pendingLayerLoads.get(layer.id);
    }

    const loadPromise = loadProcessedGeoJsonForLayer(layer)
      .finally(() => {
        state.pendingLayerLoads.delete(layer.id);
        layer.isLoading = false;
        renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
      });

    state.pendingLayerLoads.set(layer.id, loadPromise);
    layer.isLoading = true;
    renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    return loadPromise;
  }

  async function loadProcessedGeoJsonForLayer(layer) {
    const response = await fetch(layer.processedGeojsonUrl);
    if (!response.ok) {
      throw new Error("No se pudo descargar el GeoJSON procesado del backend.");
    }

    const normalizedRemote = normalizeBackendProcessedGeoJson(
      ensureFeatureCollection(await response.json()),
      getBackendRecordLikeFromLayer(layer)
    );
    layer.data = normalizedRemote.geojson;
    layer.symbology = normalizedRemote.symbology;
    if (!isImageBackedLayer(layer) || !layer.legend || layer.legend.type !== "raster") {
      layer.legend = normalizedRemote.legend || layer.legend;
    }
    console.info("GeoJSON diferido visualizado correctamente", layer.title);
    return layer;
  }

  function getBackendRecordLikeFromLayer(layer) {
    return {
      id: layer.backendLayerId || layer.id,
      title: layer.title,
      sourceType: layer.fileType,
      resourceType: layer.resourceType,
      status: layer.status,
      municipality: layer.municipality,
      processedGeojsonUrl: layer.processedGeojsonUrl,
      metadata: layer.metadata || null,
      rasterLegend: layer.legend?.type === "raster" ? layer.legend : layer.metadata?.rasterLegend || null,
      vectorLegend: layer.legend?.type && layer.legend.type !== "raster" ? layer.legend : layer.metadata?.properties?.vectorLegend || null,
    };
  }

  function addUserLayerToMap(layer) {
    if (isImageBackedLayer(layer)) {
      addImageLayerToMap(layer);
    }
    if (layer.data) {
      addGeoJsonLayerToMap(layer);
    }
  }

  function addGeoJsonLayerToMap(layer) {
    const sourceId = `source-${layer.id}`;
    const lineId = `${layer.id}-line`;
    const fillId = `${layer.id}-fill`;
    const pointId = `${layer.id}-point`;
    const defaultLineColor = layer.lineColor || layer.color;
    const defaultFillColor = layer.fillColor || layer.color;
    const defaultPointColor = layer.iconColor || layer.color;
    const fillColorExpression = layer.symbology?.fillColorExpression || ["coalesce", ["get", "__styleFill"], defaultFillColor];
    const lineColorExpression = layer.symbology?.lineColorExpression || ["coalesce", ["get", "__styleLine"], defaultLineColor];
    const pointColorExpression = layer.symbology?.pointColorExpression || ["coalesce", ["get", "__styleIcon"], defaultPointColor];
    const styleOpacityPaintValue = getLayerStyleOpacityPaintValue(layer);
    const geometryTypes = getLayerGeometryTypes(layer);
    const hasPolygons = hasAnyGeometryType(geometryTypes, ["Polygon", "MultiPolygon"]);
    const hasLines = hasAnyGeometryType(geometryTypes, ["LineString", "MultiLineString"]);
    const hasPoints = hasAnyGeometryType(geometryTypes, ["Point", "MultiPoint"]);
    const interactiveLayerIds = [];

    upsertGeoJsonSource(sourceId, layer.data);

    if (hasPolygons) {
      addLayerIfMissing({
        id: fillId,
        type: "fill",
        source: sourceId,
        filter: [
          "any",
          ["==", ["geometry-type"], "Polygon"],
          ["==", ["geometry-type"], "MultiPolygon"],
        ],
        paint: {
          "fill-color": fillColorExpression,
          "fill-opacity": styleOpacityPaintValue,
        },
      });
      interactiveLayerIds.push(fillId);
    }

    if (hasLines || hasPolygons) {
      addLayerIfMissing({
        id: lineId,
        type: "line",
        source: sourceId,
        filter: [
          "any",
          ["==", ["geometry-type"], "LineString"],
          ["==", ["geometry-type"], "MultiLineString"],
          ["==", ["geometry-type"], "Polygon"],
          ["==", ["geometry-type"], "MultiPolygon"],
        ],
        paint: {
          "line-color": lineColorExpression,
          "line-width": ["coalesce", ["to-number", ["get", "__styleWidth"]], 2.4],
          "line-opacity": styleOpacityPaintValue,
        },
      });
      interactiveLayerIds.push(lineId);
    }

    if (hasPoints) {
      addLayerIfMissing({
        id: pointId,
        type: "circle",
        source: sourceId,
        filter: [
          "any",
          ["==", ["geometry-type"], "Point"],
          ["==", ["geometry-type"], "MultiPoint"],
        ],
        paint: {
          "circle-color": pointColorExpression,
          "circle-radius": 6,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.8,
          "circle-opacity": getLayerOpacity(layer),
          "circle-stroke-opacity": getLayerOpacity(layer),
        },
      });
      interactiveLayerIds.push(pointId);
    }

    layer.interactiveLayerIds = interactiveLayerIds;
    interactiveLayerIds.forEach((layerId) => bindVectorPopup(layerId, layer));
    applyUserLayerOpacityToMap(layer);
    if (layer.backendLayerId && layer.processedGeojsonUrl) {
      console.info("GeoJSON visualizado correctamente", layer.title);
    }
  }

  function addImageLayerToMap(layer) {
    const overlays = getLayerGroundOverlays(layer);
    layer.imageLayerIds = [];
    layer.imageSourceIds = [];

    overlays.forEach((overlay, index) => {
      const suffix = overlays.length === 1 ? "raster" : `raster-${index + 1}`;
      const sourceId = `source-${layer.id}-${suffix}`;
      const rasterId = `${layer.id}-${suffix}`;

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: "image",
          url: overlay.imageUrl,
          coordinates: overlay.coordinates,
        });
      }

      addLayerIfMissing({
        id: rasterId,
        type: "raster",
        source: sourceId,
        paint: {
          "raster-opacity": getLayerOpacity(layer),
          "raster-fade-duration": 0,
        },
      });

      layer.imageSourceIds.push(sourceId);
      layer.imageLayerIds.push(rasterId);
    });

    applyUserLayerOpacityToMap(layer);
  }

  function isImageBackedLayer(layer) {
    return layer.sourceKind === "image" || layer.sourceKind === "ground-overlay" || layer.sourceKind === "mixed";
  }

  function getLayerGroundOverlays(layer) {
    if (Array.isArray(layer.groundOverlays) && layer.groundOverlays.length) {
      return layer.groundOverlays.filter((overlay) => overlay.imageUrl && Array.isArray(overlay.coordinates));
    }
    if (layer.imageUrl && Array.isArray(layer.coordinates)) {
      return [{
        id: "raster",
        imageUrl: layer.imageUrl,
        coordinates: layer.coordinates,
      }];
    }
    return [];
  }

  function revokeLayerObjectUrls(layer) {
    getLayerGroundOverlays(layer).forEach((overlay) => {
      if (overlay.revokeUrl && overlay.imageUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(overlay.imageUrl);
      }
    });
    if (layer.imageUrl?.startsWith("blob:") && !layer.groundOverlays?.length) {
      URL.revokeObjectURL(layer.imageUrl);
    }
  }

  function getLayerGeometryTypes(layer) {
    if (layer.__geometryTypes) return layer.__geometryTypes;
    layer.__geometryTypes = new Set(
      (layer?.data?.features || [])
        .map((feature) => feature?.geometry?.type)
        .filter(Boolean)
    );
    return layer.__geometryTypes;
  }

  function hasAnyGeometryType(geometryTypes, candidates) {
    return candidates.some((type) => geometryTypes.has(type));
  }

  function applyUserLayerOpacityToMap(layer) {
    const opacity = getLayerOpacity(layer);
    const fillId = `${layer.id}-fill`;
    const lineId = `${layer.id}-line`;
    const pointId = `${layer.id}-point`;
    const rasterIds = layer.imageLayerIds?.length ? layer.imageLayerIds : [`${layer.id}-raster`];

    const styleOpacityPaintValue = getLayerStyleOpacityPaintValue(layer);

    safeSetPaintProperty(fillId, "fill-opacity", styleOpacityPaintValue);
    safeSetPaintProperty(lineId, "line-opacity", styleOpacityPaintValue);
    safeSetPaintProperty(pointId, "circle-opacity", opacity);
    safeSetPaintProperty(pointId, "circle-stroke-opacity", opacity);
    rasterIds.forEach((rasterId) => safeSetPaintProperty(rasterId, "raster-opacity", opacity));
  }

  function applyStaticLayerOpacity(layerId) {
    const layer = staticLayers.find((item) => item.id === layerId);
    if (!layer) return;
    const opacity = getLayerOpacity(layer);

    if (layerId === "estado") {
      safeSetPaintProperty("estado-fill", "fill-opacity", 0);
      safeSetPaintProperty("estado", "line-opacity", 0.44 * opacity);
      safeSetPaintProperty("estado-highlight-halo", "line-opacity", 0.86 * opacity);
      safeSetPaintProperty("estado-highlight", "line-opacity", opacity);
      return;
    }

    if (layerId === "municipios") {
      safeSetPaintProperty("municipios-hit", "fill-opacity", 0.01 * opacity);
      safeSetPaintProperty("municipios", "line-opacity", opacity);
    }
  }

  async function previewLayer(layer) {
    clearPreviewLayer();
    state.previewLayerId = layer.id;
    layer.visible = true;
    await ensureLayerResourcesLoaded(layer);
    addUserLayerToMap(layer);
    state.renderedLayers.set(layer.id, true);
    fitLayer(layer);
    captureVisibleSnapshot();
    openFloatingLegendForLayer(layer.id, { renderCatalog: false });
    renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
  }

  async function previewLayerById(layerId) {
    const layer = state.userLayers.find((item) => item.id === layerId);
    if (!layer) return;
    await previewLayer(layer);
    const isReviewPreview = !isPublishedStatus(layer.status);
    updateInfoPanel({
      title: layer.title,
      description: isReviewPreview
        ? "Vista previa activada para revisar la capa antes de su aprobación."
        : "Capa visualizada correctamente desde el catálogo institucional.",
      extra: [
        `Formato: ${layer.fileType.toUpperCase()}`,
        `Municipio: ${layer.municipality}`,
      ],
      legend: layer.legend,
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
    if (preview && isPendingStatus(preview.status)) {
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

  async function toggleLayerVisibility(layerId, visible) {
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
        try {
          await ensureLayerResourcesLoaded(userLayer);
        } catch (error) {
          userLayer.visible = false;
          syncLayerCatalogItemState(layerId, false);
          captureVisibleSnapshot();
          saveUserLayers();
          updateInfoPanel({
            title: "No se pudo cargar la capa",
            description: error.message || "La capa no pudo descargarse. Intenta activarla nuevamente.",
          });
          throw error;
        }
        if (!state.renderedLayers.has(userLayer.id) && (canSeeLayer(userLayer) || userLayer.id === state.previewLayerId)) {
          addUserLayerToMap(userLayer);
          state.renderedLayers.set(userLayer.id, true);
        }
        setUserLayerLayoutVisibility(userLayer, true);
        activateLayerInStack(userLayer.id);
        openFloatingLegendForLayer(userLayer.id, { renderCatalog: false });
      } else {
        setUserLayerLayoutVisibility(userLayer, false);
        deactivateLayerInStack(userLayer.id);
        closePopupForLayer(userLayer.id);
        syncFloatingLegendAfterLayerDeactivation(userLayer.id);
      }
      saveUserLayers();
    }

    captureVisibleSnapshot();
    syncLayerCatalogItemState(layerId, visible);

    if (state.activeLegendLayerId) {
      renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    }
  }

  function syncLayerCatalogItemState(layerId, visible) {
    const item = elements.layerList?.querySelector(`.layer-item[data-layer-id="${CSS.escape(layerId)}"]`);
    if (!item) return;
    const checkbox = item.querySelector('input[type="checkbox"]');
    if (checkbox) checkbox.checked = visible;
    item.classList.toggle("is-visible", visible);
    item.classList.toggle("is-hidden-layer", !visible);
  }

  function updateLayerOpacity(layerId, percentage, options = {}) {
    const opacity = clampLayerOpacity(Number(percentage) / 100);
    const staticLayer = staticLayers.find((layer) => layer.id === layerId);
    const userLayer = state.userLayers.find((layer) => layer.id === layerId);

    if (staticLayer) {
      if (staticLayer.opacity === opacity && options.persist === false) return;
      staticLayer.opacity = opacity;
      scheduleLayerOpacityUpdate(layerId, () => applyStaticLayerOpacity(layerId));
    }

    if (userLayer) {
      if (userLayer.opacity === opacity && options.persist === false) return;
      userLayer.opacity = opacity;
      scheduleLayerOpacityUpdate(layerId, () => applyUserLayerOpacityToMap(userLayer));
    }

    if (options.persist !== false) {
      saveUserLayers();
    }
  }

  function scheduleLayerOpacityUpdate(layerId, callback) {
    if (state.pendingOpacityFrames.has(layerId)) {
      cancelAnimationFrame(state.pendingOpacityFrames.get(layerId));
    }

    const frameId = requestAnimationFrame(() => {
      state.pendingOpacityFrames.delete(layerId);
      callback();
    });
    state.pendingOpacityFrames.set(layerId, frameId);
  }

  function setUserLayerLayoutVisibility(layer, visible) {
    const visibility = visible ? "visible" : "none";
    const layerIds = [
      `${layer.id}-point`,
      `${layer.id}-line`,
      `${layer.id}-fill`,
      `${layer.id}-raster`,
      ...(layer.imageLayerIds || []),
    ];

    layerIds.forEach((mapLayerId) => {
      safeSetLayoutProperty(mapLayerId, "visibility", visibility);
    });
  }

  async function approveLayer(layerId) {
    const layer = state.userLayers.find((item) => item.id === layerId);
    if (!layer) return;
    if (!layer.backendLayerId || !state.session.token) {
      setSystemStatus("Backend no disponible", "La aprobación requiere una sesión administradora conectada al backend.");
      updateInfoPanel({
        title: "No se puede aprobar en modo local",
        description: "Inicia sesión contra el backend institucional como Administrador para aprobar capas.",
      });
      return;
    }

    try {
      setSystemStatus("Aprobando capa", `Se está validando ${layer.title} en backend.`);
      await approveLayerRequest(state.session.token, layer.backendLayerId);
      await syncLayersFromBackend({ preserveSessionVisibility: false });
      setSystemStatus("Capa aprobada", `${layer.title} quedó lista para publicación.`);
      updateInfoPanel({
        title: layer.title,
        description: "La capa fue aprobada y quedó lista para publicación.",
        extra: [`Municipio: ${layer.municipality}`, `Aprobo: ${state.session.name}`],
      });
    } catch (error) {
      console.error(error);
      setSystemStatus("Error de aprobación", error?.payload?.message || error.message || "La aprobación falló.");
      updateInfoPanel({
        title: "No se pudo aprobar la capa",
        description: error?.payload?.message || error.message || "La aprobación falló.",
      });
    }
  }

  async function deleteLayer(layerId) {
    const index = state.userLayers.findIndex((item) => item.id === layerId);
    if (index === -1) return;

    const [layer] = state.userLayers.splice(index, 1);

    try {
      if (layer.backendLayerId && state.session.token) {
        await deleteLayerRequest(state.session.token, layer.backendLayerId);
      }

      removeLayerBundle(layer.id);
      state.renderedLayers.delete(layer.id);
      deactivateLayerInStack(layer.id);
      closePopupForLayer(layer.id);
      if (state.activeLegendLayerId === layer.id) {
        closeFloatingLegend();
      }
      if (state.previewLayerId === layer.id) {
        state.previewLayerId = null;
      }
      if (state.lastCapturedLayerId === layer.id) {
        state.lastCapturedLayerId = null;
      }
      saveUserLayers();
      captureVisibleSnapshot();
      renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
      renderSession();

      updateInfoPanel({
        title: layer.title,
        description: "La capa fue eliminada del listado actual.",
        extra: [`Formato: ${layer.fileType.toUpperCase()}`, `Estatus previo: ${layer.status}`],
      });
    } catch (error) {
      console.error(error);
      updateInfoPanel({
        title: "No se pudo eliminar la capa",
        description: error?.payload?.message || error.message || "La operación falló.",
      });
    }
  }

  function downloadLayer(layerId) {
    const layer = state.userLayers.find((item) => item.id === layerId);
    if (!layer || !canDownloadLayer(layer)) return;

    if (layer.download.files.length === 1 && layer.download.files[0].url) {
      const file = layer.download.files[0];
      const link = document.createElement("a");
      link.href = file.url;
      link.download = file.name;
      link.rel = "noopener";
      link.target = "_blank";
      link.click();
      return;
    }

    if (layer.download.files.length === 1) {
      const file = layer.download.files[0];
      downloadFileObject(file.name, file.mimeType, file.base64);
      return;
    }

    if (layer.download.files.every((file) => file.url)) {
      layer.download.files.forEach((file) => {
        const link = document.createElement("a");
        link.href = file.url;
        link.download = file.name;
        link.rel = "noopener";
        link.target = "_blank";
        link.click();
      });
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
      if (state.activeInfoPopup) return;
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
        extra: ["Tipo: Límite municipal", "Uso recomendado: ubicar fenómenos y capas locales"],
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
    console.info("IDs de las capas registradas para el clic:", layerMeta.interactiveLayerIds || [layerId]);

    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  function getTopThematicPopupHit(event) {
    const stack = [...state.activeLayerStack].reverse();
    for (const layerId of stack) {
      const layer = state.userLayers.find((item) => item.id === layerId);
      if (!isThematicQueryableLayer(layer)) continue;

      const vectorHit = getVectorPopupHitForLayer(layer, event);
      if (vectorHit) return vectorHit;

      const rasterHit = getRasterPopupHitForLayer(layer, event.lngLat);
      if (rasterHit) return rasterHit;
    }
    return null;
  }

  function getVectorPopupHitForLayer(layer, event) {
    const layerIds = (layer.interactiveLayerIds || []).filter((layerId) => {
      return map.getLayer(layerId) && map.getLayoutProperty(layerId, "visibility") !== "none";
    });
    if (!layerIds.length) return null;
    const features = map.queryRenderedFeatures(event.point, { layers: layerIds });
    const feature = features.find((item) => hasPopupProperties(item.properties));
    if (!feature) return null;
    return {
      kind: "vector",
      layer,
      feature,
      mapLayerId: feature.layer?.id || layerIds[0],
    };
  }

  function getRasterPopupHitForLayer(layer, lngLat) {
    if (!isImageBackedLayer(layer)) return null;
    const candidates = getLayerGroundOverlays(layer)
      .map((overlay, index) => ({
        layer,
        overlay,
        rasterLayerId: layer.imageLayerIds?.[index] || `${layer.id}-${getLayerGroundOverlays(layer).length === 1 ? "raster" : `raster-${index + 1}`}`,
      }))
      .filter((candidate) => {
        return map.getLayer(candidate.rasterLayerId) &&
          map.getLayoutProperty(candidate.rasterLayerId, "visibility") !== "none";
      });
    if (!candidates.length) return null;
    const hit = pickTopGroundOverlayHit(candidates, lngLat, getMapLayerOrder());
    return hit ? {
      kind: "ground-overlay",
      layer: hit.layer,
      overlay: hit.overlay,
      mapLayerId: hit.rasterLayerId,
    } : null;
  }

  function showThematicPopup(hit, lngLat) {
    if (hit.kind === "vector") {
      showVectorFeaturePopup(hit, lngLat);
      return;
    }
    showGroundOverlayPopup(hit, lngLat);
  }

  function showVectorFeaturePopup(hit, lngLat) {
    const { layer, feature, mapLayerId } = hit;
    const props = feature.properties || {};
    if (!hasPopupProperties(props)) return;
    console.info("Propiedades de una Feature seleccionada:", props);
    const cleanedAttributes = cleanFeatureAttributes(props);
    const mainAttribute = findMainFeatureAttribute(cleanedAttributes);
    const info = {
      title: layer.title,
      description: layer.description,
      extra: [
        mainAttribute ? `${mainAttribute.label}: ${mainAttribute.value}` : null,
        ...buildLayerCatalogLines(layer),
      ],
      attributes: cleanedAttributes,
      legend: layer.legend,
    };

    openInfoPopup({
      ownerLayerId: layer.id,
      resourceType: isImageBackedLayer(layer) ? "mixed" : "vector",
      mapLayerId,
      coordinate: lngLat,
      html: buildFeaturePopup(layer.title, props),
      info,
    });
  }

  function openInfoPopup({ ownerLayerId, resourceType, mapLayerId, overlayId = null, coordinate, html, info }) {
    closeActiveInfoPopup();
    updateInfoPanel(info);
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true })
      .setLngLat(coordinate)
      .setHTML(html)
      .addTo(map);
    const owner = {
      ownerLayerId,
      resourceType,
      mapLayerId,
      overlayId,
      coordinate: [coordinate.lng, coordinate.lat],
    };
    state.activeInfoPopup = { popup, owner };
    popup.on("close", () => {
      if (state.activeInfoPopup?.popup === popup) {
        state.activeInfoPopup = null;
      }
    });
  }

  function closeActiveInfoPopup() {
    const active = state.activeInfoPopup;
    state.activeInfoPopup = null;
    if (active?.popup && typeof active.popup.remove === "function") {
      active.popup.remove();
    }
  }

  function closePopupForLayer(layerId) {
    if (state.activeInfoPopup?.owner?.ownerLayerId === layerId) {
      closeActiveInfoPopup();
    }
  }

  function closePopupIfOwnerUnavailable() {
    const ownerLayerId = state.activeInfoPopup?.owner?.ownerLayerId;
    if (!ownerLayerId) return;
    const layer = state.userLayers.find((item) => item.id === ownerLayerId);
    if (!isThematicQueryableLayer(layer)) {
      closeActiveInfoPopup();
    }
  }

  function updateInfoPanel(info) {
    if (!info) return;
    const extras = info.extra
      ? info.extra
          .filter((line) => line !== null && line !== undefined && String(line).trim() !== "")
          .map((line) => `<p class="info-copy">${escapeHtml(line)}</p>`)
          .join("")
      : "";
    const attributes = info.attributes ? renderAttributeTable(info.attributes) : "";
    const legend = info.legend ? renderLayerLegend(info.legend) : "";

    elements.infoPanel.innerHTML = `
      <p class="info-title">${escapeHtml(info.title)}</p>
      <p class="info-copy">${escapeHtml(info.description)}</p>
      ${extras}
      ${legend}
      ${attributes}
    `;
  }

  function renderLayerLegend(legend) {
    if (!legend || !Array.isArray(legend.classes)) return "";
    const items = legend.classes
      .map((item) => `
        <div class="legend-item">
          <span class="legend-swatch" style="${escapeHtml(getLegendSwatchStyle(item))}"></span>
          <div>
            <strong>${escapeHtml(item.label)}</strong>
            ${legend.type === "continuous" ? `<p>${escapeHtml(formatLegendNumber(item.min))} - ${escapeHtml(formatLegendNumber(item.max))}</p>` : ""}
          </div>
        </div>
      `)
      .join("");
    return `
      <div class="legend-list">
        <p class="info-copy"><strong>${escapeHtml(legend.field)}</strong></p>
        ${items}
      </div>
    `;
  }

  function showGroundOverlayPopup(hit, lngLat) {
    const { layer, overlay, mapLayerId } = hit;
    openInfoPopup({
      ownerLayerId: layer.id,
      resourceType: layer.data?.features?.length ? "mixed" : "ground-overlay",
      mapLayerId,
      overlayId: overlay?.id || overlay?.name || null,
      coordinate: lngLat,
      html: buildGroundOverlayPopup(layer),
      info: buildGroundOverlayInfo(layer),
    });
  }

  function buildGroundOverlayInfo(layer) {
    return {
      title: layer.title,
      description: layer.description || "Imagen raster georreferenciada disponible para consulta territorial.",
      extra: getGroundOverlayInfoLines(layer).map(({ label, value }) => `${label}: ${value}`),
      legend: getLayerSymbology(layer),
    };
  }

  function buildGroundOverlayPopup(layer) {
    const rows = getGroundOverlayInfoLines(layer)
      .map(({ label, value }) => `
        <tr>
          <td>${escapeHtml(label)}</td>
          <td>${escapeHtml(String(value))}</td>
        </tr>
      `)
      .join("");
    const legend = renderLayerLegend(getLayerSymbology(layer));

    return `
      <section class="feature-popup">
        <header class="feature-popup__header">
          <strong>${escapeHtml(layer.title || "Capa raster")}</strong>
          <span class="feature-popup__highlight">Imagen raster georreferenciada</span>
        </header>
        <div class="feature-popup__body">
          ${rows ? `<table class="feature-popup__table">${rows}</table>` : ""}
          ${legend}
          <p class="feature-popup__empty">${escapeHtml(GROUND_OVERLAY_NOTICE)}</p>
        </div>
      </section>
    `;
  }

  function getGroundOverlayInfoLines(layer) {
    return buildGroundOverlayInfoLines(layer, {
      categoryTitle: getLayerCategoryTitle(layer),
      formatDate: formatCatalogDate,
      isUsableValue: isUsablePopupValue,
    });
  }

  function getLayerCategoryTitle(layer) {
    const category = resolveLayerCategory(layer);
    return thematicLayerGroups.find((group) => group.id === category)?.title || "";
  }

  function getTopVectorPopupFeature(event) {
    const layerIds = state.userLayers
      .filter((layer) => layer.visible !== false && canSeeLayer(layer))
      .flatMap((layer) => layer.interactiveLayerIds || [])
      .filter((layerId) => map.getLayer(layerId));

    if (!layerIds.length) return null;
    const features = map.queryRenderedFeatures(event.point, { layers: layerIds });
    return features.find((feature) => hasPopupProperties(feature.properties)) || null;
  }

  function getTopGroundOverlayHit(lngLat) {
    const layerOrder = getMapLayerOrder();
    return pickTopGroundOverlayHit(getVisibleGroundOverlayCandidates(), lngLat, layerOrder);
  }

  function getVisibleGroundOverlayCandidates() {
    return [...state.userLayers, ...state.uploadDraft.previewLayers]
      .filter((layer) => isGroundOverlayQueryableLayer(layer))
      .flatMap((layer) => getLayerGroundOverlays(layer).map((overlay, index) => ({
        layer,
        overlay,
        rasterLayerId: layer.imageLayerIds?.[index] || `${layer.id}-${getLayerGroundOverlays(layer).length === 1 ? "raster" : `raster-${index + 1}`}`,
      })))
      .filter((candidate) => map.getLayer(candidate.rasterLayerId));
  }

  function isGroundOverlayQueryableLayer(layer) {
    if (!layer || layer.visible === false || !isImageBackedLayer(layer)) return false;
    if (state.userLayers.includes(layer) && !canSeeLayer(layer)) return false;
    return getLayerOpacity(layer) > 0 && getLayerGroundOverlays(layer).length > 0;
  }

  function getMapLayerOrder() {
    return new Map((map.getStyle()?.layers || []).map((layer, index) => [layer.id, index]));
  }

  function getLegendSwatchStyle(item) {
    const fill = item.color || "transparent";
    const outline = item.outlineColor || item.strokeColor || item.color || "rgba(70, 36, 49, 0.35)";
    return `background:${fill};border:2px solid ${outline};`;
  }

  function formatLegendNumber(value) {
    if (!Number.isFinite(Number(value))) return "Sin dato";
    const numeric = Number(value);
    if (Math.abs(numeric) >= 100) return numeric.toLocaleString("es-MX", { maximumFractionDigits: 2 });
    return numeric.toLocaleString("es-MX", { maximumFractionDigits: 4 });
  }

  function buildLayerCatalogLines(layer) {
    const properties = layer.metadata?.properties || {};
    const metadata = layer.metadata || {};

    return [
      `Nombre: ${layer.title || "Sin nombre"}`,
      `Descripción: ${layer.description || "Sin descripción"}`,
      `Municipio/cobertura: ${properties.coverage || metadata.coverage || layer.municipality || "Sin especificar"}`,
      `Fuente: ${properties.source || metadata.source || "Sin especificar"}`,
      `Dependencia responsable: ${properties.responsibleAgency || metadata.responsibleAgency || "Sin especificar"}`,
      `Fecha de actualizacion: ${formatCatalogDate(properties.updatedAt || metadata.updatedAt)}`,
      `Escala/resolucion: ${properties.scaleOrResolution || metadata.scaleOrResolution || "Sin especificar"}`,
      `Sistema de referencia: ${properties.crs || metadata.crs || "Sin especificar"}`,
    ];
  }

  function formatCatalogDate(value) {
    if (!value) return "Sin especificar";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("es-MX", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function buildFeaturePopup(layerName, properties = {}) {
    const attributes = cleanFeatureAttributes(properties);
    const mainAttribute = findMainFeatureAttribute(attributes);
    const rows = Object.entries(attributes)
      .map(([key, value]) => `
        <tr>
          <td>${escapeHtml(formatAttributeLabel(key))}</td>
          <td>${escapeHtml(String(value))}</td>
        </tr>
      `)
      .join("");

    return `
      <section class="feature-popup">
        <header class="feature-popup__header">
          <strong>${escapeHtml(layerName || "Capa seleccionada")}</strong>
          ${
            mainAttribute
              ? `<span class="feature-popup__highlight">${escapeHtml(mainAttribute.label)}: ${escapeHtml(String(mainAttribute.value))}</span>`
              : ""
          }
        </header>
        <div class="feature-popup__body">
          ${
            rows
              ? `<table class="feature-popup__table">${rows}</table>`
              : `<p class="feature-popup__empty">Sin atributos disponibles para este elemento</p>`
          }
        </div>
      </section>
    `;
  }

  function cleanFeatureAttributes(properties = {}) {
    const sourceEntries = Object.entries(properties)
      .filter(([key, value]) => isVisiblePopupAttribute(key, value));
    const normalizedLookup = new Map(
      sourceEntries.map(([key, value]) => [normalizeAttributeKey(key), { key, value: String(value).trim() }])
    );
    const usedKeys = new Set();
    const attributes = {};

    getPopupAttributeSchema().forEach(({ label, keys }) => {
      const matchKey = keys.map(normalizeAttributeKey).find((key) => normalizedLookup.has(key));
      if (!matchKey) return;
      const entry = normalizedLookup.get(matchKey);
      attributes[label] = entry.value;
      usedKeys.add(normalizeAttributeKey(entry.key));
    });

    sourceEntries.forEach(([key, value]) => {
      const normalizedKey = normalizeAttributeKey(key);
      if (usedKeys.has(normalizedKey)) return;
      attributes[key] = String(value).trim();
      usedKeys.add(normalizedKey);
    });

    return attributes;
  }

  function getPopupAttributeSchema() {
    return [
      { label: "Municipio", keys: ["Municipio", "MUN", "NOM_MUN", "NOMBRE", "Name"] },
      { label: "Intensidad", keys: ["Intensidad", "INTENSIDAD", "Riesgo", "RIESGO", "Nivel", "NIVEL"] },
      { label: "Detalles", keys: ["Detalles", "DETALLES", "Descripcion", "Descripción", "DESCRIP"] },
      { label: "Clasificación", keys: ["Clasificacion", "Clasificación", "Fen_Clasif", "FEN_CLASIF"] },
      { label: "Amenaza", keys: ["Amenaza", "Ame_Ampl", "AME_AMPL"] },
      { label: "Magnitud", keys: ["Magnitud", "Magni_num", "MAGNI_NUM", "Valor", "VALOR"] },
      { label: "Indicador", keys: ["Indicador", "R_P_V_E_A", "INDICADOR"] },
      { label: "Fuente", keys: ["Fuente", "FUENTE"] },
      { label: "IVS_FINAL", keys: ["IVS_FINAL"] },
    ];
  }

  function findMainFeatureAttribute(attributes) {
    if (!attributes.Intensidad) return null;
    return {
      key: "Intensidad",
      label: "Intensidad",
      value: attributes.Intensidad,
    };
  }

  function formatAttributeLabel(key) {
    return key;
  }

  function isUsablePopupValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === "object") return false;
    return String(value).trim() !== "";
  }

  function isVisiblePopupAttribute(key, value) {
    if (!isUsablePopupValue(value)) return false;
    if (key.startsWith("__")) return false;
    if (isTechnicalPublicAttribute(key, value)) return false;
    if (normalizeAttributeKey(key) === "description" && containsRemoteStyleHtml(value)) return false;
    return true;
  }

  function isTechnicalPublicAttribute(key, value = "") {
    const normalizedKey = normalizeAttributeKey(key).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    const normalizedValue = normalizeAttributeKey(value).trim();
    const blockedKeys = new Set([
      "geometry",
      "geom",
      "the geom",
      "published",
      "publicado",
      "is published",
      "visualizable",
      "is visualizable",
      "processing status",
      "estado de operación",
      "operación",
      "estado del sistema",
      "referencia",
      "reference",
    ]);
    if (blockedKeys.has(normalizedKey)) return true;
    if ((normalizedKey === "format" || normalizedKey === "formato" || normalizedKey === "file type") && normalizedValue === "kmz") {
      return true;
    }
    return false;
  }

  function normalizeAttributeKey(key) {
    return String(key || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function renderAttributeTable(attributes) {
    const rows = Object.entries(attributes)
      .filter(([key, value]) =>
        !key.startsWith("__") &&
        value !== null &&
        value !== undefined &&
        String(value).trim() !== "" &&
        !isTechnicalPublicAttribute(key, value)
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
    const pendingLayers = state.userLayers.filter((layer) => isPendingStatus(layer.status));
    const publishedLayers = state.userLayers.filter((layer) => isPublishedStatus(layer.status));

    if (!canUpload() && state.activeTool === "point") {
      state.activeTool = null;
    }

    elements.sessionRoleLabel.textContent = roleLabel;
    elements.publishedCount.textContent = String(publishedLayers.length);
    elements.pendingCount.textContent = String(pendingLayers.length);
    elements.openUserAdmin.classList.toggle("hidden", state.session.role !== "admin");
    elements.logoutSession.classList.toggle("hidden", !state.session.isAuthenticated);
    elements.topbarSessionChip.classList.toggle("hidden", !state.topbarCollapsed);
    elements.topbarSessionChip.textContent = roleLabel;
    document.getElementById("open-login")?.classList.toggle("hidden", state.session.isAuthenticated);
    elements.uploadPermissionNote.textContent = canUpload()
      ? "Puedes subir capas vectoriales, raster y Shapefile en ZIP desde este menú."
      : "La medición es pública. Para subir capas o crear puntos inicia sesión como administrador o director.";
    updateToolbarState();
    syncSidebarState();
  }

  function toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    elements.appShell.classList.toggle("app-shell--sidebar-collapsed", state.sidebarCollapsed);
    syncSidebarState();
    queueMapResize();
  }

  function toggleTopbar() {
    applyTopbarMode(!state.topbarCollapsed, { persist: true });
  }

  function syncTopbarState() {
    const collapsed = state.topbarCollapsed;
    elements.appShell.classList.toggle("app-shell--topbar-collapsed", collapsed);
    elements.toggleTopbar.setAttribute("aria-expanded", String(!collapsed));
    elements.toggleTopbar.setAttribute("title", collapsed ? "Expandir encabezado" : "Comprimir encabezado");
    elements.toggleTopbar.querySelector(".topbar-collapse-toggle__label").textContent = collapsed ? "Expandir" : "Comprimir";
    elements.topbarBrandToggle?.setAttribute("aria-expanded", String(!collapsed));
    elements.topbarBrandToggle?.setAttribute("title", collapsed ? "Mostrar encabezado" : "Ocultar encabezado");
    elements.topbarBrandToggle?.setAttribute("aria-label", collapsed ? "Mostrar encabezado" : "Ocultar encabezado");
    elements.toggleCompactMenu?.setAttribute("aria-expanded", String(state.compactMenuOpen));
    const icon = elements.toggleTopbar.querySelector("svg path");
    if (icon) {
      icon.setAttribute("d", collapsed ? "M7 14l5-5 5 5z" : "M7 10l5 5 5-5z");
    }
  }

  function syncSidebarState() {
    const isMobile = window.innerWidth <= 760;
    const isCollapsed = elements.appShell.classList.contains("app-shell--sidebar-collapsed");
    elements.reopenSidebar.classList.toggle("hidden", isMobile || !isCollapsed);
    if (elements.collapseMobilePanel) {
      elements.collapseMobilePanel.textContent = isCollapsed ? "Expandir panel" : "Minimizar panel";
      elements.collapseMobilePanel.setAttribute("aria-expanded", String(!isCollapsed));
    }
  }

  function syncResponsiveLayout() {
    const nextMode = window.innerWidth <= 760 ? "mobile" : window.innerWidth <= 1180 ? "tablet" : "desktop";
    if (state.viewportMode === nextMode) return;

    state.viewportMode = nextMode;
    if (state.topbarCollapsed === null) {
      state.topbarCollapsed = nextMode !== "desktop";
    }
    state.sidebarCollapsed = false;
    elements.appShell.classList.remove("app-shell--sidebar-collapsed");

    syncTopbarState();
    syncSidebarState();
    queueMapResize();
  }

  function toggleCompactMenu() {
    if (state.compactMenuOpen) {
      closeCompactMenu({ restoreFocus: true });
      return;
    }
    state.compactMenuOpen = !state.compactMenuOpen;
    if (elements.topbarCompactMenu) {
      elements.topbarCompactMenu.hidden = !state.compactMenuOpen;
      elements.topbarCompactMenu.classList.toggle("is-open", state.compactMenuOpen);
    }
    elements.toggleCompactMenu?.setAttribute("aria-expanded", String(state.compactMenuOpen));
    window.requestAnimationFrame(() => {
      getVisibleCompactMenuItems()[0]?.focus();
    });
  }

  function closeCompactMenu(options = {}) {
    state.compactMenuOpen = false;
    if (elements.topbarCompactMenu) {
      elements.topbarCompactMenu.hidden = true;
      elements.topbarCompactMenu.classList.remove("is-open");
    }
    elements.toggleCompactMenu?.setAttribute("aria-expanded", "false");
    if (options.restoreFocus) {
      elements.toggleCompactMenu?.focus();
    }
  }

  function getVisibleCompactMenuItems() {
    if (!elements.topbarCompactMenu) return [];
    return [...elements.topbarCompactMenu.querySelectorAll(".menu-action")]
      .filter((item) => !item.hidden && !item.classList.contains("hidden") && !item.disabled);
  }

  function handleCompactMenuKeydown(event) {
    const items = getVisibleCompactMenuItems();
    if (!items.length) return;
    const currentIndex = Math.max(0, items.indexOf(document.activeElement));
    let nextIndex = currentIndex;

    if (event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    items[nextIndex].focus();
  }

  function openTerritorialQuery() {
    closeCompactMenu();
    elements.territorialQueryModal?.showModal();
    window.requestAnimationFrame(() => {
      elements.closeTerritorialQuery?.focus();
    });
  }

  function closeTerritorialQuery() {
    if (elements.territorialQueryModal?.open) {
      elements.territorialQueryModal.close();
    }
  }

  function applyTopbarMode(collapsed, options = {}) {
    state.topbarCollapsed = collapsed;
    if (options.persist !== false) {
      saveTopbarModePreference(collapsed);
    }
    syncTopbarState();
    renderSession();
    queueMapResize();
    elements.topbarBrandToggle?.classList.add("is-pressed");
    window.setTimeout(() => {
      elements.topbarBrandToggle?.classList.remove("is-pressed");
    }, 180);
  }

  function scrollPanelToSection(sectionId) {
    if (!sectionId) return;
    const target = document.getElementById(sectionId);
    if (!target) return;
    if (target.tagName === "DETAILS") {
      target.open = true;
    }
    elements.controlPanel?.scrollTo({
      top: Math.max(0, target.offsetTop - 84),
      behavior: "smooth",
    });
  }

  function togglePasswordFieldVisibility(input, button) {
    const showPassword = input.type === "password";
    input.type = showPassword ? "text" : "password";
    syncPasswordToggleButton(input, button);
  }

  function setSystemStatus(title, description) {
    console.info(`${title}: ${description}`);
  }

  function syncPasswordToggleButton(input, button) {
    const isVisible = input.type === "text";
    button.setAttribute("aria-pressed", String(isVisible));
    button.setAttribute("aria-label", isVisible ? "Ocultar contrasena" : "Mostrar contrasena");
    button.setAttribute("title", isVisible ? "Ocultar contrasena" : "Mostrar contrasena");
  }

  function queueMapResize() {
    window.requestAnimationFrame(() => {
      map.resize();
    });
  }

  function toggleFullscreen() {
    const container = document.querySelector(".map-stage");
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen?.().catch(() => {});
      setSystemStatus("Pantalla completa", "El visor intento abrirse a pantalla completa.");
      return;
    }
    document.exitFullscreen?.().catch(() => {});
    setSystemStatus("Vista normal", "El visor regresó a la vista integrada del tablero.");
  }

  function rotateMapBy(delta) {
    map.easeTo({
      bearing: map.getBearing() + delta,
      duration: 320,
    });
  }

  function adjustMapPitch(delta) {
    const targetPitch = Math.max(0, Math.min(MAX_MAP_PITCH, map.getPitch() + delta));
    map.easeTo({
      pitch: targetPitch,
      duration: 320,
    });
  }

  async function login() {
    const email = elements.loginEmail.value.trim().toLowerCase();
    const password = elements.loginPassword.value.trim();
    elements.loginFeedback.textContent = "Validando credenciales...";

    try {
      let mode = "backend";

      try {
        const response = await loginRequest(email, password);
        if (!response?.accessToken || !response?.user) {
          throw new Error("La API no devolvió una sesión válida.");
        }
        clearPreviewStateOnRoleChange();
        resetThematicRuntimeState();
        state.session = mapBackendSession(response);
      } catch (backendError) {
        const demoUser = findDemoUser(email, password);
        if (!demoUser) {
          throw backendError;
        }
        clearPreviewStateOnRoleChange();
        resetThematicRuntimeState();
        state.session = createDemoSession(demoUser);
        mode = "demo";
      }

      saveSession();
      renderSession();
      await syncLayersFromBackend({ preserveSessionVisibility: false });
      elements.loginFeedback.textContent = "";
      elements.loginEmail.value = "";
      elements.loginPassword.value = "";
      elements.loginPassword.type = "password";
      syncPasswordToggleButton(elements.loginPassword, elements.toggleLoginPassword);
      elements.loginModal.close();

      updateInfoPanel({
        title: `Sesión iniciada como ${roleLabels[state.session.role]}`,
        description: roleCapabilities[state.session.role],
        extra: [
          `Responsable: ${state.session.name}`,
          `Ambito: ${state.session.municipality}`,
          mode === "backend" ? "Backend institucional conectado." : "Sesión iniciada en modo demo local.",
        ],
      });
    } catch (error) {
      console.error(error);
      elements.loginFeedback.textContent =
        error?.payload?.message || error.message || "No se pudo iniciar sesión contra el backend o las credenciales demo.";
    }
  }

  function canUpload() {
    return state.session.role === "admin" || state.session.role === "director";
  }

  function openUploadModal() {
    if (!state.uploadDraft.files.length && !state.uploadDraft.previewLayers.length) {
      resetUploadDraft();
      state.uploadDraft.category = elements.uploadLayerCategory.value || "geologicos";
    } else {
      elements.uploadLayerCategory.value = state.uploadDraft.category || "geologicos";
      syncUploadDraftUi();
    }
    state.uploadDraft.minimized = false;
    syncUploadDraftUi();
    elements.triggerUpload?.classList.add("is-active");
    positionUploadModal();
    elements.uploadLayerModal.showModal();
  }

  function closeUploadModal() {
    clearUploadDraftPreview();
    resetUploadDraft();
    state.uploadDraft.minimized = false;
    elements.triggerUpload?.classList.remove("is-active");
    elements.uploadLayerModal.close();
  }

  function minimizeUploadModal() {
    state.uploadDraft.minimized = true;
    elements.triggerUpload?.classList.remove("is-active");
    elements.uploadLayerModal.close();
  }

  function positionUploadModal() {
    if (!elements.uploadLayerModal || !elements.triggerUpload) return;

    if (window.innerWidth <= 1180) {
      elements.uploadLayerModal.style.top = "130px";
      elements.uploadLayerModal.style.left = "10px";
      elements.uploadLayerModal.style.setProperty("--upload-arrow-left", "82%");
      elements.uploadLayerModal.style.maxHeight = "";
      elements.uploadLayerForm.style.maxHeight = "calc(100vh - 150px)";
      return;
    }

    const rect = elements.triggerUpload.getBoundingClientRect();
    const panelWidth = Math.min(340, window.innerWidth - 20);
    const left = Math.max(10, Math.min(rect.left + rect.width / 2 - panelWidth / 2, window.innerWidth - panelWidth - 10));
    const preferredTop = rect.bottom + 14;
    const top = Math.max(90, Math.min(preferredTop, window.innerHeight - 220));
    const arrowLeft = Math.max(48, Math.min(rect.left + rect.width / 2 - left, panelWidth - 48));
    const availableHeight = Math.max(280, window.innerHeight - top - 18);

    elements.uploadLayerModal.style.left = `${left}px`;
    elements.uploadLayerModal.style.top = `${top}px`;
    elements.uploadLayerModal.style.maxHeight = "";
    elements.uploadLayerForm.style.maxHeight = `${availableHeight}px`;
    elements.uploadLayerModal.style.setProperty("--upload-arrow-left", `${arrowLeft}px`);
  }

  function resetUploadDraft() {
    state.uploadDraft.files = [];
    state.uploadDraft.previewLayers = [];
    state.uploadDraft.previewVisible = false;
    state.uploadDraft.category = elements.uploadLayerCategory?.value || "geologicos";
    state.uploadDraft.minimized = false;
    state.uploadDraft.rasterLegendItems = [];
    if (elements.uploadLayerFeedback) elements.uploadLayerFeedback.textContent = "";
    clearUploadMetadataForm();
    syncUploadDraftUi();
  }

  async function setUploadDraftFiles(files) {
    clearUploadDraftPreview();
    const [firstFile] = files;
    state.uploadDraft.files = firstFile ? [firstFile] : [];
    state.uploadDraft.previewLayers = [];
    state.uploadDraft.previewVisible = false;
    elements.uploadLayerFeedback.textContent = "";
    if (files.length > 1) {
      elements.uploadLayerFeedback.textContent =
        "Solo se permite una capa por carga. Se tomará únicamente el primer archivo seleccionado.";
    }
    syncUploadDraftUi();
    if (state.uploadDraft.files.length) {
      await refreshUploadDraftPreview();
    }
  }

  function syncUploadDraftUi() {
    if (!elements.uploadSelectedFiles) return;

    if (!state.uploadDraft.files.length) {
      elements.uploadSelectedFiles.innerHTML = '<p class="empty-state">Aún no has seleccionado archivos.</p>';
    } else if (state.uploadDraft.previewLayers.length) {
      elements.uploadSelectedFiles.innerHTML = state.uploadDraft.previewLayers
        .map(
          (layer) => `
            <article class="upload-layer-entry">
              <div class="upload-layer-entry__meta">
                <strong class="upload-layer-entry__title">${escapeHtml(layer.title)}</strong>
                <div class="upload-layer-entry__details">
                  <span>${escapeHtml(getUploadDraftLayerSummary(layer))}</span>
                  <span>${escapeHtml(getThematicGroupTitle(state.uploadDraft.category))}</span>
                </div>
              </div>
              <div class="upload-layer-entry__actions">
                <button
                  class="ghost-button ${state.uploadDraft.previewVisible ? "is-active" : ""}"
                  type="button"
                  data-upload-preview-eye
                >
                  ${state.uploadDraft.previewVisible ? "Ocultar" : "Visualizar"}
                </button>
                <button
                  class="icon-button upload-remove-button"
                  type="button"
                  data-upload-remove
                  aria-label="Quitar capa seleccionada"
                  title="Quitar capa seleccionada"
                >
                  ×
                </button>
              </div>
            </article>
          `,
        )
        .join("");
    } else {
      elements.uploadSelectedFiles.innerHTML = state.uploadDraft.files
        .map(
          (file) => `
            <article class="upload-selected-file">
              <strong>${escapeHtml(file.name)}</strong>
              <span>${escapeHtml(getExtension(file.name).toUpperCase())} · ${(file.size / 1024).toFixed(1)} KB</span>
            </article>
          `,
        )
        .join("");
    }

    elements.uploadSelectedFiles.querySelectorAll("[data-upload-preview-eye]").forEach((button) => {
      button.addEventListener("click", async () => {
        await toggleUploadDraftPreview();
      });
    });

    elements.uploadSelectedFiles.querySelectorAll("[data-upload-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        removeUploadDraftSelection();
      });
    });

    if (elements.uploadPreviewToggle) {
      elements.uploadPreviewToggle.classList.toggle("is-active", state.uploadDraft.previewVisible);
      elements.uploadPreviewToggle.textContent = state.uploadDraft.previewVisible
        ? "Ocultar vista previa"
        : "Mostrar vista previa";
    }

    if (elements.uploadPreviewState) {
      elements.uploadPreviewState.textContent = state.uploadDraft.previewVisible
        ? "La capa se está visualizando en el mapa."
        : "La capa se visualizará automáticamente al seleccionarla.";
    }

    elements.triggerUpload?.classList.toggle("has-draft", state.uploadDraft.files.length > 0);

    return;

    elements.uploadSelectedFiles.innerHTML = state.uploadDraft.files.length
      ? state.uploadDraft.files
          .map((file) => `
            <article class="upload-selected-file">
              <strong>${escapeHtml(file.name)}</strong>
              <span>${escapeHtml(getExtension(file.name).toUpperCase())} · ${(file.size / 1024).toFixed(1)} KB</span>
            </article>
          `)
          .join("")
      : '<p class="empty-state">Aún no has seleccionado archivos.</p>';

    elements.uploadPreviewToggle.classList.toggle("is-active", state.uploadDraft.previewVisible);
    elements.uploadPreviewToggle.textContent = state.uploadDraft.previewVisible
      ? "Ocultar visualización"
      : "Ojo de visualización";
    elements.uploadPreviewState.textContent = state.uploadDraft.previewVisible
      ? "Vista previa activa en el mapa"
      : "Vista previa inactiva";
  }

  async function toggleUploadDraftPreview() {
    if (!state.uploadDraft.files.length) {
      elements.uploadLayerFeedback.textContent = "Primero selecciona al menos un archivo.";
      return;
    }

    if (state.uploadDraft.previewVisible) {
      clearUploadDraftPreview();
      syncUploadDraftUi();
      return;
    }

    await refreshUploadDraftPreview();
  }

  async function refreshUploadDraftPreview() {
    clearUploadDraftPreview();
    try {
      const draftLayers = await createLayersFromFiles(state.uploadDraft.files);
      state.uploadDraft.previewLayers = draftLayers.map((layer) => {
        const uploadMetadata = collectUploadMetadata();
        applyCategoryToLayer(layer, state.uploadDraft.category);
        layer.title = uploadMetadata.title || layer.title;
        layer.description = uploadMetadata.description || layer.description;
        layer.municipality = uploadMetadata.municipality || layer.municipality;
        layer.metadata = buildLayerMetadata(uploadMetadata, layer);
        layer.legend = buildRasterLegendFromDraft() || layer.legend;
        layer.status = state.session.role === "admin" ? "approved" : "pending_review";
        return layer;
      });

      state.uploadDraft.previewLayers.forEach((layer) => addUserLayerToMap(layer));
      state.uploadDraft.previewVisible = true;
      elements.uploadLayerFeedback.textContent = "";
      syncUploadDraftUi();
    } catch (error) {
      console.error(error);
      state.uploadDraft.previewLayers = [];
      state.uploadDraft.previewVisible = false;
      elements.uploadLayerFeedback.textContent =
        error.message || "No se pudo generar la vista previa del archivo.";
      syncUploadDraftUi();
    }
  }

  function clearUploadDraftPreview() {
    state.uploadDraft.previewLayers.forEach((layer) => {
      removeLayerBundle(layer.id);
      revokeLayerObjectUrls(layer);
    });
    state.uploadDraft.previewLayers = [];
    state.uploadDraft.previewVisible = false;
  }

  function removeUploadDraftSelection() {
    clearUploadDraftPreview();
    state.uploadDraft.files = [];
    if (elements.uploadLayerFeedback) {
      elements.uploadLayerFeedback.textContent = "La capa seleccionada se retiro del borrador de carga.";
    }
    syncUploadDraftUi();
  }

  async function submitUploadDraft() {
    if (!state.uploadDraft.files.length) {
      elements.uploadLayerFeedback.textContent = "Selecciona al menos un archivo antes de subir la capa.";
      return;
    }

    if (!state.uploadDraft.category) {
      elements.uploadLayerFeedback.textContent = "Selecciona el fenomeno donde se clasificara la capa.";
      return;
    }

    if (state.isUploading) {
      elements.uploadLayerFeedback.textContent = "Ya hay una carga en proceso. Espera un momento.";
      return;
    }

    try {
      state.isUploading = true;
      elements.uploadLayerFeedback.textContent = "Procesando capa; esta operación puede tardar varios minutos.";

      const uploadResult = await uploadFilesToBackend(state.uploadDraft.files, {
        category: state.uploadDraft.category,
        metadata: collectUploadMetadata(),
      });

      clearUploadDraftPreview();
      closeUploadModal();

      if (uploadResult) {
        updateInfoPanel(uploadResult);
      }
    } catch (error) {
      console.error(error);
      elements.uploadLayerFeedback.textContent = await buildUploadErrorMessage(error);
    } finally {
      state.isUploading = false;
      syncUploadDraftUi();
    }
  }

  async function buildUploadErrorMessage(error) {
    const savedLayer = await findRecentlySavedUploadDraftLayer();
    if (savedLayer) {
      await syncLayersFromBackend({ preserveSessionVisibility: false });
      return `La conexión se interrumpió, pero el backend registró la capa "${savedLayer.title}". Revisa el catálogo administrativo antes de reintentar.`;
    }

    if (error?.name === "TimeoutError" || error?.code === "TimeoutError") {
      return "La carga excedio el tiempo de espera del visor. No se encontro una capa registrada con esos datos; puedes intentar nuevamente.";
    }

    if (error?.name === "AbortError" || error?.code === "AbortError") {
      return "La carga fue cancelada antes de completarse. No se encontro una capa registrada con esos datos; puedes intentar nuevamente.";
    }

    if (error?.status) {
      return error.message || "El backend rechazó la carga de la capa.";
    }

    return error?.message || "No se pudo subir la capa para revisión.";
  }

  async function findRecentlySavedUploadDraftLayer() {
    if (!state.session.token) return null;
    const metadata = collectUploadMetadata();
    const files = state.uploadDraft.files || [];
    const expectedTitle = metadata.title || files[0]?.name?.replace(/\.[^.]+$/u, "");
    const fileNames = new Set(files.map((file) => file.name));
    if (!expectedTitle && !fileNames.size) return null;

    try {
      const records = state.session.role === "admin"
        ? await listAdminLayersRequest(state.session.token)
        : await listMyLayersRequest(state.session.token);
      return records.find((record) => {
        const titleMatches = expectedTitle && normalizeAttributeKey(record.title) === normalizeAttributeKey(expectedTitle);
        const fileMatches = (record.files || []).some((file) => fileNames.has(file.originalName));
        return titleMatches || fileMatches;
      }) || null;
    } catch (lookupError) {
      console.warn("No se pudo verificar si la capa quedó registrada después del fallo de carga.", lookupError);
      return null;
    }
  }

  function applyCategoryToLayer(layer, category) {
    layer.category = category;
    layer.group = getThematicGroupTitle(category);
  }

  function applyCategoryToDraftLayers() {
    state.uploadDraft.previewLayers.forEach((layer) => {
      applyCategoryToLayer(layer, state.uploadDraft.category);
      layer.metadata = buildLayerMetadata(collectUploadMetadata(), layer);
    });
  }

  function collectUploadMetadata() {
    return {
      title: elements.uploadLayerTitle?.value.trim() || "",
      description: elements.uploadLayerDescription?.value.trim() || "",
      municipality: elements.uploadLayerMunicipality?.value.trim() || "",
      source: elements.uploadLayerSource?.value.trim() || "",
      responsibleAgency: elements.uploadLayerAgency?.value.trim() || "",
      updatedAt: elements.uploadLayerUpdatedAt?.value || "",
      scaleOrResolution: elements.uploadLayerScale?.value.trim() || "",
      crs: elements.uploadLayerCrs?.value.trim() || "",
      rasterLegend: buildRasterLegendFromDraft(),
    };
  }

  function clearUploadMetadataForm() {
    [
      elements.uploadLayerTitle,
      elements.uploadLayerDescription,
      elements.uploadLayerMunicipality,
      elements.uploadLayerSource,
      elements.uploadLayerAgency,
      elements.uploadLayerUpdatedAt,
      elements.uploadLayerScale,
      elements.uploadLayerCrs,
    ].forEach((field) => {
      if (field) field.value = "";
    });
    renderRasterLegendEditor();
  }

  function renderRasterLegendEditor() {
    if (!elements.rasterLegendList) return;
    elements.rasterLegendList.innerHTML = state.uploadDraft.rasterLegendItems.length
      ? state.uploadDraft.rasterLegendItems
          .map((item, index) => `
            <div class="raster-legend-item" data-raster-legend-index="${index}">
              <input type="color" value="${escapeHtml(item.color || "#7a203a")}" data-raster-legend-color="${index}" aria-label="Color de leyenda raster" />
              <input type="text" maxlength="80" value="${escapeHtml(item.label || "")}" data-raster-legend-label="${index}" placeholder="Etiqueta oficial" />
              <button class="icon-button icon-button--small" type="button" data-raster-legend-remove="${index}" aria-label="Eliminar elemento">x</button>
            </div>
          `)
          .join("")
        : `<p class="empty-state">Sin leyenda manual. Se mostrará simbología incorporada en la imagen.</p>`;

    elements.rasterLegendList.querySelectorAll("[data-raster-legend-label]").forEach((input) => {
      input.addEventListener("input", () => {
        const item = state.uploadDraft.rasterLegendItems[Number(input.dataset.rasterLegendLabel)];
        if (item) item.label = input.value;
      });
    });
    elements.rasterLegendList.querySelectorAll("[data-raster-legend-color]").forEach((input) => {
      input.addEventListener("input", () => {
        const item = state.uploadDraft.rasterLegendItems[Number(input.dataset.rasterLegendColor)];
        if (item) item.color = input.value;
      });
    });
    elements.rasterLegendList.querySelectorAll("[data-raster-legend-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        state.uploadDraft.rasterLegendItems.splice(Number(button.dataset.rasterLegendRemove), 1);
        renderRasterLegendEditor();
      });
    });
  }

  function buildRasterLegendFromDraft() {
    const classes = state.uploadDraft.rasterLegendItems
      .map((item, index) => ({
        label: String(item.label || "").trim(),
        color: /^#[0-9a-f]{6}$/i.test(item.color || "") ? item.color.toLowerCase() : "#7a203a",
        order: index,
      }))
      .filter((item) => item.label);

    return classes.length
      ? {
          type: "raster",
          field: "Simbologia raster",
          classes,
        }
      : null;
  }

  function buildLayerMetadata(metadata = {}, layer = {}) {
    const geometrySummary = summarizeLayerGeometry(layer);
    const coverage =
      metadata.municipality ||
      layer.municipality ||
      (state.session.role === "director" ? state.session.municipality : "Cobertura estatal");

    return {
      source: metadata.source || "",
      responsibleAgency: metadata.responsibleAgency || "",
      updatedAt: metadata.updatedAt || "",
      scaleOrResolution: metadata.scaleOrResolution || "",
      crs: metadata.crs || "EPSG:4326",
      geometryType: geometrySummary.geometryType || layer.fileType || "",
      featureCount: geometrySummary.featureCount,
      coverage,
      rasterLegend: metadata.rasterLegend || layer.legend || null,
    };
  }

  function summarizeLayerGeometry(layer) {
    if (layer.sourceKind === "image" || layer.sourceKind === "ground-overlay") {
      return {
        geometryType: "GroundOverlay raster",
        featureCount: 0,
      };
    }

    if (layer.sourceKind === "mixed") {
      const vectorSummary = summarizeLayerGeometry({ ...layer, sourceKind: "geojson" });
      return {
        geometryType: `${vectorSummary.geometryType || "Vector"} + GroundOverlay raster`,
        featureCount: vectorSummary.featureCount,
      };
    }

    const features = layer.data?.features;
    if (!Array.isArray(features)) {
      return {
        geometryType: layer.fileType || "",
        featureCount: null,
      };
    }

    const geometryTypes = new Set(
      features
        .map((feature) => feature.geometry?.type)
        .filter(Boolean)
    );

    return {
      geometryType: geometryTypes.size ? [...geometryTypes].join(", ") : "Sin geometría",
      featureCount: features.length,
    };
  }

  function getUploadDraftLayerSummary(layer) {
    if (layer.sourceKind === "ground-overlay") {
      return "Capa raster georreferenciada (GroundOverlay)";
    }
    if (layer.sourceKind === "mixed") {
      return "Capa mixta vectorial y GroundOverlay";
    }
    if (layer.type === "raster" || layer.fileType === "tif" || layer.fileType === "tiff") {
      return "Raster GeoTIFF";
    }

    if (layer.data?.features && Array.isArray(layer.data.features)) {
      return `${layer.data.features.length} objeto(s)`;
    }

    if (layer.fileType) {
      return layer.fileType.toUpperCase();
    }

    return "Capa cargada";
  }

  function getThematicGroupTitle(category) {
    return thematicLayerGroups.find((group) => group.id === category)?.title || "Otras capas";
  }

  async function renderUserAdminPanel() {
    elements.userAdminFeedback.textContent = "";

    if (state.session.token) {
      try {
        state.users = await listUsersRequest(state.session.token);
        state.backendStatus.reachable = true;
        state.backendStatus.lastError = null;
      } catch (error) {
        console.error(error);
        state.backendStatus.lastError = error.message;
        elements.userAdminFeedback.textContent = "No se pudo consultar la lista de usuarios.";
      }
    } else {
      state.users = loadManagedUsers();
      state.backendStatus.reachable = false;
      state.backendStatus.lastError = null;
    }

    const managedUsers = state.users.filter((user) => {
      const mappedRole = mapBackendRole(user.role || user.backendRole);
      return mappedRole === "director" || mappedRole === "visitante";
    });
    elements.userAdminList.innerHTML = managedUsers.length
      ? managedUsers
          .map((user) => `
            <article class="user-card">
              <strong>${escapeHtml(user.name)}</strong>
              <span>${escapeHtml(user.email)}</span>
              <span>Rol: ${escapeHtml(roleLabels[mapBackendRole(user.role || user.backendRole)] || user.role || user.backendRole)}</span>
              <span>Municipio: ${escapeHtml(user.municipality || "General")}</span>
              <span>Estado: ${user.isActive === false ? "Inactivo" : "Activo"}</span>
              <div class="user-card__actions">
                <button class="ghost-button" type="button" data-toggle-user-status="${user.id}">
                  ${user.isActive === false ? "Activar" : "Desactivar"}
                </button>
                <button class="ghost-button" type="button" data-toggle-user-role="${user.id}">
                  Cambiar a ${mapBackendRole(user.role || user.backendRole) === "director" ? "Visitante" : "Alimentador"}
                </button>
                <button class="ghost-button" type="button" data-reset-user-password="${user.id}">Restablecer contrasena</button>
              </div>
            </article>
          `)
          .join("")
      : '<div class="empty-state">Aún no hay usuarios creados desde el panel de administración.</div>';

    elements.userAdminList.querySelectorAll("[data-reset-user-password]").forEach((button) => {
      button.addEventListener("click", () => resetManagedUserPassword(button.dataset.resetUserPassword));
    });
    elements.userAdminList.querySelectorAll("[data-toggle-user-status]").forEach((button) => {
      button.addEventListener("click", () => toggleManagedUserStatus(button.dataset.toggleUserStatus));
    });
    elements.userAdminList.querySelectorAll("[data-toggle-user-role]").forEach((button) => {
      button.addEventListener("click", () => toggleManagedUserRole(button.dataset.toggleUserRole));
    });

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

  async function createManagedUser() {
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
      elements.userAdminFeedback.textContent = "Selecciona un municipio válido de la lista.";
      return;
    }

    try {
      if (state.session.token) {
        await createUserRequest(state.session.token, {
          name,
          email,
          password,
          municipality: role === "director" ? municipality : "General",
          roleCode: role === "director" ? "DATA_PROVIDER" : "PUBLIC_USER",
        });
      } else {
        const managedUsers = loadManagedUsers();
        if (managedUsers.some((user) => user.email.toLowerCase() === email)) {
          throw new Error("Ya existe una cuenta con ese correo.");
        }
        managedUsers.push({
          id: `demo-user-${Date.now()}`,
          name,
          email,
          password,
          municipality: role === "director" ? municipality : "General",
          role: role === "director" ? "DATA_PROVIDER" : "PUBLIC_USER",
          backendRole: role === "director" ? "DATA_PROVIDER" : "PUBLIC_USER",
          isActive: true,
          source: "local-demo",
        });
        saveManagedUsers(managedUsers);
      }

      await renderUserAdminPanel();
      elements.userAdminForm.reset();
      elements.newUserRole.value = "director";
      elements.newUserPassword.type = "password";
      syncPasswordToggleButton(elements.newUserPassword, elements.toggleNewUserPassword);
      syncUserRoleForm();
      elements.userAdminFeedback.textContent = "Usuario creado correctamente.";

      updateInfoPanel({
        title: "Usuario registrado",
        description: state.session.token
          ? "La cuenta ya puede iniciar sesión desde el botón Acceso."
          : "La cuenta demo ya puede iniciar sesión localmente desde el botón Acceso.",
        extra: [
          `Correo: ${email}`,
          `Rol: ${roleLabels[role]}`,
          `Municipio: ${municipality}`,
        ],
      });
    } catch (error) {
      console.error(error);
      elements.userAdminFeedback.textContent =
        error?.payload?.message || error.message || "No se pudo crear el usuario.";
    }
  }

  async function resetManagedUserPassword(userId) {
    if (state.session.role !== "admin") return;

    const user =
      state.users.find((item) => item.id === userId) ||
      loadManagedUsers().find((item) => item.id === userId);
    if (!user) return;

    const nextPassword = window.prompt(
      `Define una nueva contrasena temporal para ${user.email}:`,
      "Temporal123!"
    );
    if (!nextPassword) return;

    if (nextPassword.trim().length < 8) {
      elements.userAdminFeedback.textContent =
        "La nueva contrasena temporal debe tener al menos 8 caracteres.";
      return;
    }

    try {
      if (state.session.token) {
        await resetPasswordRequest(state.session.token, userId, nextPassword.trim());
      } else {
        const managedUsers = loadManagedUsers();
        const targetUser = managedUsers.find((item) => item.id === userId);
        if (!targetUser) {
          throw new Error("Usuario no encontrado.");
        }
        targetUser.password = nextPassword.trim();
        saveManagedUsers(managedUsers);
      }

      await renderUserAdminPanel();
      elements.userAdminFeedback.textContent =
        `Contrasena restablecida para ${user.email}. Comparte la nueva contrasena temporal de forma segura.`;
    } catch (error) {
      console.error(error);
      elements.userAdminFeedback.textContent =
        error?.payload?.message || error.message || "No se pudo restablecer la contrasena del usuario.";
    }
  }

  async function toggleManagedUserStatus(userId) {
    if (state.session.role !== "admin") return;

    const user =
      state.users.find((item) => item.id === userId) ||
      loadManagedUsers().find((item) => item.id === userId);
    if (!user) return;

    const nextStatus = user.isActive === false;

    try {
      if (state.session.token) {
        await setUserStatusRequest(state.session.token, userId, nextStatus);
      } else {
        const managedUsers = loadManagedUsers();
        const targetUser = managedUsers.find((item) => item.id === userId);
        if (!targetUser) throw new Error("Usuario no encontrado.");
        targetUser.isActive = nextStatus;
        saveManagedUsers(managedUsers);
      }

      await renderUserAdminPanel();
      elements.userAdminFeedback.textContent =
        `${user.email} quedó ${nextStatus ? "activo" : "inactivo"}.`;
    } catch (error) {
      console.error(error);
      elements.userAdminFeedback.textContent =
        error?.payload?.message || error.message || "No se pudo actualizar el estado del usuario.";
    }
  }

  async function toggleManagedUserRole(userId) {
    if (state.session.role !== "admin") return;

    const user =
      state.users.find((item) => item.id === userId) ||
      loadManagedUsers().find((item) => item.id === userId);
    if (!user) return;

    const currentRole = mapBackendRole(user.role || user.backendRole);
    const nextRoleCode = currentRole === "director" ? "PUBLIC_USER" : "DATA_PROVIDER";

    try {
      if (state.session.token) {
        await setUserRoleRequest(state.session.token, userId, nextRoleCode);
      } else {
        const managedUsers = loadManagedUsers();
        const targetUser = managedUsers.find((item) => item.id === userId);
        if (!targetUser) throw new Error("Usuario no encontrado.");
        targetUser.role = nextRoleCode;
        targetUser.backendRole = nextRoleCode;
        if (nextRoleCode === "PUBLIC_USER") {
          targetUser.municipality = "General";
        }
        saveManagedUsers(managedUsers);
      }

      await renderUserAdminPanel();
      elements.userAdminFeedback.textContent =
        `${user.email} ahora tiene rol ${roleLabels[mapBackendRole(nextRoleCode)]}.`;
    } catch (error) {
      console.error(error);
      elements.userAdminFeedback.textContent =
        error?.payload?.message || error.message || "No se pudo cambiar el rol del usuario.";
    }
  }

  function clearPreviewStateOnRoleChange() {
    if (!state.previewLayerId) return;
    const preview = state.userLayers.find((layer) => layer.id === state.previewLayerId);
    if (preview && isPendingStatus(preview.status)) {
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
        description: "Aún no se cargan los límites base de Morelos para centrar el mapa.",
      });
      return;
    }
    fitGeoJSON(state.staticData.estado, { padding: 42, maxZoom: 9.4 });
    updateInfoPanel({
      title: "Vista centrada en Morelos",
      description: "El mapa se reajustó a la extensión del estado.",
    });
  }

  function resetMapNorth() {
    map.easeTo({
      bearing: 0,
      pitch: 0,
      duration: 600,
    });
    updateInfoPanel({
      title: "Orientación restablecida",
      description: "El visor regresó a su orientación norte.",
    });
  }

  function fitLayer(layer) {
    if (isImageBackedLayer(layer) && getLayerGroundOverlays(layer).length) {
      const bounds = new maplibregl.LngLatBounds();
      getLayerGroundOverlays(layer).forEach((overlay) => {
        overlay.coordinates.forEach((coordinate) => bounds.extend(coordinate));
      });
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

  function safeSetLayoutProperty(layerId, property, value) {
    if (!map.getLayer(layerId)) return false;
    const currentValue = map.getLayoutProperty(layerId, property);
    if (currentValue === value || (property === "visibility" && value === "visible" && currentValue === undefined)) {
      return false;
    }
    map.setLayoutProperty(layerId, property, value);
    return true;
  }

  function safeSetPaintProperty(layerId, property, value) {
    if (!map.getLayer(layerId)) return false;
    if (paintValuesMatch(map.getPaintProperty(layerId, property), value)) return false;
    map.setPaintProperty(layerId, property, value);
    return true;
  }

  function paintValuesMatch(currentValue, nextValue) {
    if (currentValue === nextValue) return true;
    return JSON.stringify(currentValue) === JSON.stringify(nextValue);
  }

  function safeMoveLayer(layerId, beforeId) {
    if (!map.getLayer(layerId)) return false;
    if (beforeId && !map.getLayer(beforeId)) return false;
    map.moveLayer(layerId, beforeId);
    return true;
  }

  function waitForMapStyle() {
    if (map.isStyleLoaded()) return Promise.resolve();

    return new Promise((resolve) => {
      const resolveWhenReady = () => {
        if (!map.isStyleLoaded()) return;
        map.off("load", resolveWhenReady);
        map.off("styledata", resolveWhenReady);
        map.off("idle", resolveWhenReady);
        resolve();
      };

      map.on("load", resolveWhenReady);
      map.on("styledata", resolveWhenReady);
      map.on("idle", resolveWhenReady);
    });
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
          ...(entry.minzoom !== undefined ? { minzoom: entry.minzoom } : {}),
          ...(entry.maxzoom !== undefined ? { maxzoom: entry.maxzoom } : {}),
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

  function enableAdvancedMapInteraction() {
    map.dragRotate?.enable?.();
    map.touchZoomRotate?.enableRotation?.();
    map.touchPitch?.enable?.();
    map.keyboard?.enable?.();
  }

  function applyBaseMapVisibility(activeBaseMap) {
    if (!map.isStyleLoaded()) return;

    const maxZoom = activeBaseMap === "satelite" ? SATELLITE_MAP_MAX_ZOOM : DEFAULT_MAP_MAX_ZOOM;
    map.setMaxZoom(maxZoom);
    if (map.getZoom() > maxZoom) {
      map.easeTo({ zoom: maxZoom });
    }
    if (activeBaseMap === "satelite") {
      console.info("Satélite activo: Esri World Imagery");
      console.info("Zoom máximo satelital:", map.getMaxZoom());
      console.info("Source satelital:", map.getSource("satellite-source"));
    }

    Object.entries(baseMapConfigs).forEach(([baseMapId, entries]) => {
      const visibility = baseMapId === activeBaseMap ? "visible" : "none";
      entries.forEach((entry) => {
        safeSetLayoutProperty(entry.layerId, "visibility", visibility);
      });
    });
  }

  function removeLayerBundle(layerId) {
    const layer = state.userLayers.find((item) => item.id === layerId) || state.uploadDraft.previewLayers.find((item) => item.id === layerId);
    [
      `${layerId}-point`,
      `${layerId}-line`,
      `${layerId}-fill`,
      `${layerId}-raster`,
      ...(layer?.imageLayerIds || []),
    ].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });

    [`source-${layerId}`, `source-${layerId}-raster`, ...(layer?.imageSourceIds || [])].forEach((sourceId) => {
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    });
  }

  async function createLayersFromFiles(files) {
    const extensions = files.map((file) => getExtension(file.name));
    const singleUploadExtensions = ["kml", "kmz", "tif", "tiff", "zip"];

    if (files.length === 1 && ["kml", "kmz"].includes(extensions[0])) {
      return [await createKmlLayer(files[0])];
    }

    if (files.length === 1 && ["geojson", "json"].includes(extensions[0])) {
      return [await createGeoJsonLayer(files[0])];
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
      throw new Error("Por ahora el visor web admite archivos comprimidos ZIP para shapefile. RAR no está habilitado en este prototipo.");
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
    const analysis = await analyzeGeospatialFile(file);
    const text = analysis.kmlText || (extension === "kmz" ? await readKmz(file) : await file.text());
    const geojson = analysis.vector.geometryCount ? parseKml(text) : { type: "FeatureCollection", features: [] };
    const groundOverlays = createGroundOverlayObjectUrls(analysis.groundOverlays);

    if (!geojson.features.length && !groundOverlays.length) {
      const detail = analysis.errors?.length ? ` ${analysis.errors.join(" ")}` : "";
      throw new Error(`El archivo no contiene geometría vectorial ni una imagen georreferenciada válida.${detail}`);
    }

    const sourceKind = geojson.features.length && groundOverlays.length
      ? "mixed"
      : groundOverlays.length
        ? "ground-overlay"
        : "geojson";

    return createUserLayer({
      title: file.name.replace(/\.(kml|kmz)$/i, ""),
      fileType: extension,
      sourceKind,
      resourceType: analysis.kind,
      data: geojson.features.length ? geojson : null,
      groundOverlays,
      imageUrl: groundOverlays[0]?.imageUrl || null,
      coordinates: groundOverlays[0]?.coordinates || null,
      description: groundOverlays.length
        ? "Capa raster georreferenciada (GroundOverlay) cargada para consulta del atlas."
        : "Capa cargada desde archivo vectorial para consulta del atlas.",
      download: await buildDownloadBundle([file]),
      lineColor: geojson.meta?.lineColor || null,
      fillColor: geojson.meta?.fillColor || null,
      iconColor: geojson.meta?.iconColor || null,
      metadata: {
        geospatialDiagnostics: {
          type: analysis.kind,
          selectedKml: analysis.selectedKml || analysis.sourceName || "",
          geometryCount: analysis.vector.geometryCount,
          geometryTypes: analysis.vector.geometryTypes,
          groundOverlayCount: analysis.groundOverlays.length,
          internalImages: analysis.internalImages || [],
          bbox: analysis.bbox,
          warnings: analysis.warnings || [],
          errors: analysis.errors || [],
        },
      },
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
      throw new Error(
        "El GeoTIFF debe estar reproyectado a EPSG:4326/WGS84 o Web Mercator compatible antes de cargarlo. El visor web aún no reproyecta raster en el frontend; prepara el archivo en QGIS/GDAL o procesa la reproyección desde backend."
      );
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
      description: "Raster GeoTIFF cargado para visualización territorial.",
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
    const category = config.category || null;

    return {
      id,
      title: config.title,
      description: config.description,
      group: category ? getThematicGroupTitle(category) : "Capas cargadas",
      category,
      status: config.status || (state.session.role === "admin" ? "published" : "pending_review"),
      visible: true,
      municipality: config.municipality || municipality,
      createdBy: config.createdBy || state.session.name,
      createdById: config.createdById || state.session.userId || null,
      backendLayerId: config.backendLayerId || null,
      createdAt: new Date().toISOString(),
      fileType: config.fileType,
      sourceKind: config.sourceKind,
      resourceType: config.resourceType || config.sourceKind,
      opacity: clampLayerOpacity(config.opacity ?? 1),
      color: pickLayerColor(state.userLayers.length),
      lineColor: config.lineColor || null,
      fillColor: config.fillColor || null,
      iconColor: config.iconColor || null,
      data: config.data || null,
      imageUrl: config.imageUrl || null,
      coordinates: config.coordinates || null,
      groundOverlays: config.groundOverlays || [],
      download: config.download || null,
      metadata: config.metadata || null,
      symbology: config.symbology || null,
      legend: config.legend || null,
    };
  }

  async function createGeoJsonLayer(file) {
    let parsed = null;
    try {
      parsed = JSON.parse(await file.text());
    } catch (_error) {
      throw new Error("El archivo GeoJSON no contiene JSON válido.");
    }

    const geojson = ensureFeatureCollection(parsed);
    if (!geojson.features.length) {
      throw new Error("El GeoJSON no contiene entidades con geometría utilizable.");
    }

    return createUserLayer({
      title: file.name.replace(/\.(geojson|json)$/i, ""),
      fileType: "geojson",
      sourceKind: "geojson",
      data: geojson,
      description: "Capa GeoJSON cargada para consulta del atlas.",
      download: await buildDownloadBundle([file]),
    });
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
    if (!data || typeof data !== "object") {
      throw new Error("El GeoJSON está vacío o no tiene estructura válida.");
    }

    const supportedGeometryTypes = new Set([
      "Point",
      "MultiPoint",
      "LineString",
      "MultiLineString",
      "Polygon",
      "MultiPolygon",
    ]);

    const normalizeFeature = (feature) => {
      if (!feature || feature.type !== "Feature") return null;
      const geometry = feature.geometry;
      if (!geometry) return null;
      if (!supportedGeometryTypes.has(geometry.type)) return null;
      if (!hasUsableCoordinates(geometry.coordinates)) return null;
      return {
        type: "Feature",
        properties: feature.properties && typeof feature.properties === "object" ? feature.properties : {},
        geometry,
      };
    };

    if (data.type === "FeatureCollection") {
      if (!Array.isArray(data.features)) {
        throw new Error("El GeoJSON FeatureCollection no contiene un arreglo features válido.");
      }
      return {
        type: "FeatureCollection",
        features: data.features.map(normalizeFeature).filter(Boolean),
      };
    }

    if (data.type === "Feature") {
      const normalized = normalizeFeature(data);
      return {
        type: "FeatureCollection",
        features: normalized ? [normalized] : [],
      };
    }

    if (supportedGeometryTypes.has(data.type)) {
      if (!hasUsableCoordinates(data.coordinates)) {
        throw new Error(`La geometría ${data.type} no contiene coordenadas válidas.`);
      }
      return {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: data,
          },
        ],
      };
    }

    if (Array.isArray(data.features)) {
      return {
        type: "FeatureCollection",
        features: data.features.map(normalizeFeature).filter(Boolean),
      };
    }

    throw new Error("El GeoJSON debe ser FeatureCollection, Feature o una geometría válida.");
  }

  function hasUsableCoordinates(coordinates) {
    if (!Array.isArray(coordinates) || !coordinates.length) return false;
    if (typeof coordinates[0] === "number") {
      return coordinates.length >= 2 && Number.isFinite(coordinates[0]) && Number.isFinite(coordinates[1]);
    }
    return coordinates.some(hasUsableCoordinates);
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
      console.warn("No se pudo leer la sesión almacenada.", error);
    }

    return createVisitorSession();
  }

  function saveSession() {
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(state.session));
  }

  function loadManagedUsers() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.managedUsers));
      if (Array.isArray(stored) && stored.length) {
        return [...demoUsers, ...stored];
      }
    } catch (error) {
      console.warn("No se pudieron leer los usuarios demo almacenados.", error);
    }
    return [...demoUsers];
  }

  function saveManagedUsers(users) {
    const customUsers = users.filter((user) => user.source !== "demo");
    localStorage.setItem(STORAGE_KEYS.managedUsers, JSON.stringify(customUsers));
  }

  function loadTopbarModePreference() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.topbarMode);
      if (stored === null) return null;
      return stored === "compact";
    } catch (error) {
      console.warn("No se pudo leer el modo del encabezado.", error);
      return null;
    }
  }

  function saveTopbarModePreference(collapsed) {
    try {
      localStorage.setItem(STORAGE_KEYS.topbarMode, collapsed ? "compact" : "expanded");
    } catch (error) {
      console.warn("No se pudo guardar el modo del encabezado.", error);
    }
  }

  function loadUserLayers() {
    return [];
  }

  function saveUserLayers() {
    const layerPrefs = [...staticLayers, ...state.userLayers]
      .map((layer) => ({
        layerKey: layer.backendLayerId || layer.id,
        backendLayerId: layer.backendLayerId || null,
        visible: Boolean(layer.visible),
        opacity: clampLayerOpacity(layer.opacity ?? 1),
      }));

    localStorage.setItem(STORAGE_KEYS.layerPrefs, JSON.stringify(layerPrefs));
  }

  function createVisitorSession() {
    return {
      role: "visitante",
      name: "Consulta pública",
      municipality: "General",
      email: null,
      userId: null,
      backendRole: null,
      token: null,
      isAuthenticated: false,
    };
  }

  function createDemoSession(user) {
    return {
      role: user.role,
      name: user.name,
      municipality: user.municipality || "General",
      email: user.email,
      userId: user.id,
      backendRole: user.backendRole || user.role,
      token: null,
      isAuthenticated: true,
      source: user.source || "demo",
    };
  }

  function findDemoUser(email, password) {
    return loadManagedUsers().find(
      (user) =>
        user.isActive !== false &&
        user.email.toLowerCase() === email &&
        user.password === password
    ) || null;
  }

  function logout() {
    clearPreviewStateOnRoleChange();
    resetThematicRuntimeState();
    state.session = createVisitorSession();
    saveSession();
    renderSession();
    updateInfoPanel({
      title: "Sesión cerrada",
      description: "Regresaste al modo de consulta pública del visor.",
    });
  }

  function mapBackendRole(roleCode) {
    if (roleCode === "ADMIN") return "admin";
    if (roleCode === "DATA_PROVIDER") return "director";
    return "visitante";
  }

  function mapBackendSession(response) {
    return {
      role: mapBackendRole(response.user.role),
      name: response.user.name,
      municipality: response.user.municipality || "General",
      email: response.user.email,
      userId: response.user.id,
      backendRole: response.user.role,
      token: response.accessToken,
      isAuthenticated: true,
    };
  }

  function getStatusLabel(status) {
    const labels = {
      published: "Disponible",
      pending_review: "Pendiente",
      approved: "Aprobado",
      rejected: "Rechazado",
      unpublished: "Retirada",
      pending: "Pendiente",
    };
    return labels[status] || status;
  }

  function getStatusBadgeClass(status) {
    if (status === "published") return "badge--published";
    if (status === "pending_review" || status === "pending") return "badge--pending";
    if (status === "approved") return "badge--published";
    if (status === "rejected") return "badge--danger";
    return "";
  }

  function isPublishedStatus(status) {
    return status === "published";
  }

  function isPendingStatus(status) {
    return status === "pending" || status === "pending_review";
  }

  function canPreviewLayer(layer) {
    return !isPublishedStatus(layer.status) && layer.sourceKind !== "static";
  }

  function canVisualizeLayer(layer) {
    return layer.sourceKind !== "static" && Boolean(layer.isVisualizable && layer.processedGeojsonUrl);
  }

  function getProcessingStatusLabel(status) {
    const labels = {
      processed: "Procesada",
      pending: "En proceso",
      failed: "Con error",
    };
    return labels[status] || "Con error";
  }

  function canTogglePublish(layer) {
    return ["approved", "unpublished", "published"].includes(layer.status);
  }

  async function togglePublishLayer(layerId) {
    const layer = state.userLayers.find((item) => item.id === layerId);
    if (!layer) return;
    if (!layer.backendLayerId || !state.session.token) {
      setSystemStatus("Backend no disponible", "La publicación requiere una sesión administradora conectada al backend.");
      updateInfoPanel({
        title: "No se puede publicar en modo local",
        description: "Inicia sesión contra el backend institucional como Administrador para publicar o despublicar capas.",
      });
      return;
    }

    const nextStatus = layer.status === "published" ? "unpublished" : "published";

    try {
      setSystemStatus(
        nextStatus === "published" ? "Publicando capa" : "Retirando publicación",
        `${layer.title} está cambiando su estado de visibilidad.`
      );
      await setPublishStateRequest(state.session.token, layer.backendLayerId, nextStatus);
      await syncLayersFromBackend({ preserveSessionVisibility: false });
      setSystemStatus(
        nextStatus === "published" ? "Capa publicada" : "Capa despublicada",
        `${layer.title} actualizó su estado correctamente.`
      );
      updateInfoPanel({
        title: nextStatus === "published" ? "Capa publicada" : "Capa despublicada",
        description: `${layer.title} actualizó su estado de publicación.`,
      });
    } catch (error) {
      console.error(error);
      setSystemStatus("Error de publicación", error?.payload?.message || error.message || "La operación falló.");
      updateInfoPanel({
        title: "No se pudo actualizar la publicación",
        description: error?.payload?.message || error.message || "La operación falló.",
      });
    }
  }

  async function rejectLayer(layerId) {
    const layer = state.userLayers.find((item) => item.id === layerId);
    if (!layer) return;
    if (!layer.backendLayerId || !state.session.token) {
      setSystemStatus("Backend no disponible", "El rechazo requiere una sesión administradora conectada al backend.");
      updateInfoPanel({
        title: "No se puede rechazar en modo local",
        description: "Inicia sesión contra el backend institucional como Administrador para rechazar capas.",
      });
      return;
    }

    const reason = window.prompt("Indica brevemente el motivo del rechazo:", "No cumple criterios de publicación.");
    if (!reason) return;

    try {
      setSystemStatus("Rechazando capa", `${layer.title} será devuelta con observaciones.`);
      await rejectLayerRequest(state.session.token, layer.backendLayerId, reason);
      await syncLayersFromBackend({ preserveSessionVisibility: false });
      setSystemStatus("Capa rechazada", `${layer.title} se actualizó con el motivo de rechazo.`);
      updateInfoPanel({
        title: "Capa rechazada",
        description: `${layer.title} fue rechazada y se registró el motivo en backend.`,
        extra: [`Motivo: ${reason}`],
      });
    } catch (error) {
      console.error(error);
      setSystemStatus("Error de rechazo", error?.payload?.message || error.message || "La operación falló.");
      updateInfoPanel({
        title: "No se pudo rechazar la capa",
        description: error?.payload?.message || error.message || "La operación falló.",
      });
    }
  }

  async function initializeRemoteState() {
    setSystemStatus("Sincronizando visor", "Se está conectando el visualizador con el backend institucional.");
    updateInfoPanel({
      title: "Inicializando visor",
      description: "Se está preparando la consulta de capas temáticas.",
    });

    if (!map.isStyleLoaded()) {
      await waitForMapStyle();
    }

    await syncLayersFromBackend({ preserveSessionVisibility: false });
  }

  async function syncLayersFromBackend(options = {}) {
    const preserveSessionVisibility = options.preserveSessionVisibility !== false;
    if (state.remoteSyncInProgress) return;
    if (!map.isStyleLoaded()) {
      await waitForMapStyle();
      if (state.remoteSyncInProgress) return;
    }

    state.remoteSyncInProgress = true;
    try {
      setSystemStatus("Actualizando capas", "Se está consultando el catálogo remoto.");
      const publicLayers = await listPublicLayersRequest();
      if (!Array.isArray(publicLayers)) {
        const invalidError = new Error("La API devolvió una respuesta de capas incompleta.");
        invalidError.code = "INVALID_LAYER_RESPONSE";
        throw invalidError;
      }
      console.info("Capas públicas obtenidas:", publicLayers);
      const records = [...publicLayers];

      if (state.session.role === "admin" && state.session.token) {
        const manageableLayers = await listAdminLayersRequest(state.session.token);
        mergeRecords(records, manageableLayers);
      } else if (state.session.role === "director" && state.session.token) {
        const ownLayers = await listMyLayersRequest(state.session.token);
        mergeRecords(records, ownLayers);
      }

      const hydratedLayers = [];
      for (const record of records) {
        try {
          hydratedLayers.push(await hydrateBackendLayer(record));
        } catch (error) {
          console.error("No se pudo hidratar la capa remota", record.title, error);
        }
      }

      const persistedPreferences = loadPersistedLayerPreferences();
      const previousVisibility = new Map(
        state.userLayers.map((layer) => [layer.backendLayerId || layer.id, Boolean(layer.visible)])
      );
      const localLayers = state.userLayers.filter((layer) => !layer.backendLayerId);

      state.userLayers.forEach((layer) => {
        if (layer.backendLayerId) {
          removeLayerBundle(layer.id);
          state.renderedLayers.delete(layer.id);
        }
      });

      const remoteLayers = hydratedLayers.map((layer) => {
        const preference = persistedPreferences.get(layer.backendLayerId || layer.id);
        const visible = preserveSessionVisibility
          ? previousVisibility.get(layer.backendLayerId || layer.id) === true
          : false;
        return {
          ...layer,
          visible,
          opacity: clampLayerOpacity(preference?.opacity ?? layer.opacity ?? 1),
        };
      });
      state.userLayers = [...localLayers, ...remoteLayers];

      staticLayers.forEach((layer) => {
        const preference = persistedPreferences.get(layer.id);
        if (preference) {
          layer.opacity = clampLayerOpacity(preference.opacity ?? layer.opacity ?? 1);
        }
      });

      state.backendStatus.reachable = true;
      state.backendStatus.lastError = null;
      state.backendStatus.state = hydratedLayers.length ? "ready" : "empty";
      renderVisibleLayers();
      renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
      renderSession();
      captureVisibleSnapshot();
      setSystemStatus("Visor actualizado", `${hydratedLayers.length} capas sincronizadas desde el backend.`);

      if (!hydratedLayers.length) {
        updateInfoPanel({
          title: "Sin capas temáticas publicadas",
          description: "Por el momento no hay capas temáticas publicadas.",
        });
      }
    } catch (error) {
      const diagnosis = classifyBackendSyncError(error);
      console.warn("Diagnóstico técnico de sincronización de capas:", diagnosis, error);
      state.backendStatus.reachable = false;
      state.backendStatus.lastError = error.message;
      state.backendStatus.state = diagnosis.state;
      renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
      renderSession();
      setSystemStatus(diagnosis.title, diagnosis.technicalSummary);
      updateInfoPanel({
        title: diagnosis.publicTitle,
        description: diagnosis.publicMessage,
      });
    } finally {
      state.remoteSyncInProgress = false;
    }
  }

  function classifyBackendSyncError(error) {
    if (error?.code === "INVALID_LAYER_RESPONSE") {
      return {
        state: "invalid",
        title: "Respuesta inválida",
        publicTitle: "Capas temáticas no disponibles",
        publicMessage: "Las capas temáticas no pudieron consultarse temporalmente. El mapa base y los límites territoriales continúan operativos.",
        technicalSummary: "La respuesta del backend no contiene una colección válida de capas.",
      };
    }

    if (error?.status) {
      return {
        state: "http-error",
        title: "Error del backend",
        publicTitle: "Capas temáticas no disponibles",
        publicMessage: "Las capas temáticas no pudieron consultarse temporalmente. El mapa base y los límites territoriales continúan operativos.",
        technicalSummary: `El backend respondió con HTTP ${error.status}.`,
      };
    }

    if (isBackendUnavailableError(error)) {
      return {
        state: "unavailable",
        title: "Backend no disponible",
        publicTitle: "Capas temáticas no disponibles",
        publicMessage: "Las capas temáticas no están disponibles temporalmente. El mapa base y los límites territoriales continúan operativos.",
        technicalSummary: "No fue posible conectar con el backend configurado.",
      };
    }

    return {
      state: "http-error",
      title: "Error de sincronización",
      publicTitle: "Capas temáticas no disponibles",
      publicMessage: "Las capas temáticas no pudieron consultarse temporalmente. El mapa base y los límites territoriales continúan operativos.",
      technicalSummary: error?.message || "Error no clasificado al consultar capas.",
    };
  }

  function isBackendUnavailableError(error) {
    const message = String(error?.message || error?.name || "").toLowerCase();
    return (
      error?.name === "TypeError" ||
      error?.name === "AbortError" ||
      message.includes("failed to fetch") ||
      message.includes("networkerror") ||
      message.includes("load failed") ||
      message.includes("connection") ||
      message.includes("abort")
    );
  }

  function mergeRecords(target, incoming) {
    incoming.forEach((record) => {
      if (!target.some((item) => item.id === record.id)) {
        target.push(record);
      }
    });
  }

  function loadPersistedLayerPreferences() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.layerPrefs));
      if (!Array.isArray(raw)) return new Map();
      return new Map(
        raw.map((item) => [
          item.layerKey || item.backendLayerId,
          {
            visible: Boolean(item.visible),
            opacity: clampLayerOpacity(item.opacity ?? 1),
          },
        ])
      );
    } catch (_error) {
      return new Map();
    }
  }

  async function uploadFilesToBackend(files, options = {}) {
    const firstFile = files[0];
    const institutionalMetadata = options.metadata || {};
    const title = institutionalMetadata.title || firstFile.name.replace(/\.[^.]+$/u, "");
    const municipality =
      institutionalMetadata.municipality ||
      (state.session.role === "director" ? state.session.municipality : "Estado de Morelos");
    const category = options.category || "geologicos";

    if (state.session.token) {
      const createdLayer = await uploadLayerRequest(
        state.session.token,
        {
          title,
          description:
            institutionalMetadata.description || "Capa cargada desde el visor institucional.",
          municipality,
          tags: [`category:${category}`],
          source: institutionalMetadata.source,
          responsibleAgency: institutionalMetadata.responsibleAgency,
          updatedAt: institutionalMetadata.updatedAt,
          scaleOrResolution: institutionalMetadata.scaleOrResolution,
          crs: institutionalMetadata.crs,
        },
        files
      );

      await syncLayersFromBackend({ preserveSessionVisibility: false });

      const hydrated = state.userLayers.find((layer) => layer.backendLayerId === createdLayer.id);
      if (hydrated) {
        if (isPublishedStatus(hydrated.status)) {
          fitLayer(hydrated);
        } else {
          await previewLayer(hydrated);
        }
      }

      return {
        title: createdLayer.title,
        description:
          state.session.role === "admin"
            ? "La capa se registró en el backend y quedó aprobada. Aún puedes publicarla desde el panel."
            : "La capa se registró en el backend y quedó pendiente de revisión administrativa.",
        extra: [
          `Municipio: ${createdLayer.municipality || municipality}`,
          `Fenómeno: ${getThematicGroupTitle(category)}`,
          `Formato principal: ${(createdLayer.sourceType || getExtension(firstFile.name)).toUpperCase()}`,
          createdLayer.metadata?.properties?.responsibleAgency
            ? `Dependencia: ${createdLayer.metadata.properties.responsibleAgency}`
            : "",
        ],
      };
    }

    const localLayers = state.uploadDraft.previewLayers.length
      ? state.uploadDraft.previewLayers.map((layer) => cloneLayerForLocalPersistence(layer))
      : (await createLayersFromFiles(files)).map((layer) => ({ ...layer }));

    localLayers.forEach((layer) => {
      applyCategoryToLayer(layer, category);
      layer.status = state.session.role === "admin" ? "approved" : "pending_review";
      layer.title = title;
      layer.description =
        institutionalMetadata.description || layer.description || "Capa cargada desde el visor institucional.";
      layer.municipality = municipality;
      layer.metadata = buildLayerMetadata(institutionalMetadata, layer);
      state.userLayers.push(layer);
    });

    renderSession();
    renderLayerCatalog(elements.layerSearch.value.trim().toLowerCase());
    captureVisibleSnapshot();

    if (localLayers[0]) {
      if (isPublishedStatus(localLayers[0].status)) {
        addUserLayerToMap(localLayers[0]);
        state.renderedLayers.set(localLayers[0].id, true);
        fitLayer(localLayers[0]);
      } else {
        await previewLayer(localLayers[0]);
      }
    }

    return {
      title,
      description:
        state.session.role === "admin"
          ? "La capa demo se guardó localmente y quedó aprobada para pruebas."
          : "La capa demo se guardó localmente y quedó en revisión administrativa.",
      extra: [
        `Municipio: ${municipality}`,
        `Fenómeno: ${getThematicGroupTitle(category)}`,
        `Formato principal: ${getExtension(firstFile.name).toUpperCase()}`,
        institutionalMetadata.responsibleAgency ? `Dependencia: ${institutionalMetadata.responsibleAgency}` : "",
      ],
    };
  }

  async function hydrateBackendLayer(record) {
    const remoteFiles = [...(record.files || [])];
    if (!remoteFiles.length) {
      throw new Error("La capa no tiene archivos asociados.");
    }

    const sourceType = (record.sourceType || remoteFiles[0].extension || "").toLowerCase();
    const category = extractCategoryFromRecord(record);
    let hydratedLayer = null;

    const resourceType = record.resourceType || record.metadata?.properties?.resourceType || "vector";
    if ((resourceType === "ground-overlay" || resourceType === "mixed") && record.groundOverlays?.length) {
      hydratedLayer = createGroundOverlayLayerFromBackend(record);
      if (resourceType === "mixed" && record.processedGeojsonUrl) {
        hydratedLayer.processedGeojsonUrl = record.processedGeojsonUrl;
        hydratedLayer.isVectorDataDeferred = true;
        hydratedLayer.symbology = getPersistedVectorSymbology(record);
        hydratedLayer.legend = record.rasterLegend || hydratedLayer.legend || getPersistedVectorLegend(record);
      }
    } else if (record.isVisualizable && record.processedGeojsonUrl) {
      hydratedLayer = createDeferredProcessedGeoJsonLayerFromBackend(record);
    } else if (sourceType === "geojson") {
      hydratedLayer = await createGeoJsonLayerFromRemoteRecord(record, remoteFiles[0]);
    } else if (sourceType === "kml" || sourceType === "kmz") {
      hydratedLayer = await createKmlLayer(await fetchRemoteFile(remoteFiles[0]));
    } else if (sourceType === "zip") {
      hydratedLayer = await createShapefileLayerFromRemoteZip(record, remoteFiles[0]);
    } else if (sourceType === "tif" || sourceType === "tiff") {
      hydratedLayer = await createGeoTiffLayer(await fetchRemoteFile(remoteFiles[0]));
    } else if (sourceType === "shp") {
      hydratedLayer = await createShapefileLayerFromRemoteParts(record, remoteFiles);
    } else {
      throw new Error(`Formato remoto no soportado para visualización: ${sourceType}`);
    }

    return {
      ...hydratedLayer,
      id: `backend-${record.id}`,
      backendLayerId: record.id,
      title: record.title,
      description: record.description || hydratedLayer.description,
      category,
      group: getThematicGroupTitle(category),
      municipality: record.municipality || "Cobertura estatal",
      createdBy: record.createdBy?.name || "Sistema",
      createdById: record.createdBy?.id || null,
      status: record.status,
      createdAt: record.createdAt || hydratedLayer.createdAt,
      approvedAt: record.approvedAt || null,
      publishedAt: record.publishedAt || null,
      fileType: sourceType,
      isVisualizable: Boolean(record.isVisualizable || record.processedGeojsonUrl),
      resourceType,
      groundOverlays: record.groundOverlays || hydratedLayer.groundOverlays || [],
      processedGeojsonUrl: record.processedGeojsonUrl || null,
      processingStatus: record.processingStatus || record.metadata?.properties?.processingStatus || null,
      metadata: normalizeBackendLayerMetadata(record, hydratedLayer),
      download: {
        files: remoteFiles.map((file) => ({
          name: file.originalName,
          mimeType: file.mimeType,
          url: file.publicUrl,
        })),
      },
    };
  }

  function normalizeBackendLayerMetadata(record, hydratedLayer) {
    const metadata = record.metadata || {};
    const properties = metadata.properties || {};
    const localSummary = summarizeLayerGeometry(hydratedLayer);

    return {
      ...metadata,
      featureCount: metadata.featureCount ?? localSummary.featureCount,
      geometryType: metadata.geometryType || properties.geometryType || localSummary.geometryType,
      crs: metadata.crs || properties.crs || "EPSG:4326",
      coverage: properties.coverage || record.municipality || hydratedLayer.municipality,
      source: properties.source || "",
      responsibleAgency: properties.responsibleAgency || "",
      updatedAt: properties.updatedAt || "",
      scaleOrResolution: properties.scaleOrResolution || "",
      createdAt: record.createdAt || "",
      publishedAt: record.publishedAt || "",
      processingStatus: record.processingStatus || properties.processingStatus || "",
      resourceType: record.resourceType || properties.resourceType || hydratedLayer.resourceType || "vector",
      processedGeojsonUrl: record.processedGeojsonUrl || properties.processedGeojsonUrl || "",
      groundOverlays: record.groundOverlays || properties.groundOverlays || hydratedLayer.groundOverlays || [],
      rasterLegend: record.rasterLegend || properties.rasterLegend || hydratedLayer.legend || null,
      vectorLegend: normalizePublishedVectorLegend(record) || properties.vectorLegend || null,
      isVisualizable: Boolean(record.isVisualizable || properties.isVisualizable),
      properties: {
        ...properties,
        coverage: properties.coverage || record.municipality || hydratedLayer.municipality,
        vectorLegend: normalizePublishedVectorLegend(record) || properties.vectorLegend || null,
      },
    };
  }

  function createDeferredProcessedGeoJsonLayerFromBackend(record) {
    return createUserLayer({
      title: record.title,
      category: extractCategoryFromRecord(record),
      fileType: record.sourceType || "geojson",
      sourceKind: "geojson",
      resourceType: record.resourceType || "vector",
      data: null,
      description: record.description || "Capa publicada desde el backend institucional.",
      backendLayerId: record.id,
      createdById: record.createdBy?.id || null,
      municipality: record.municipality || "Cobertura estatal",
      status: record.status,
      metadata: record.metadata || null,
      processedGeojsonUrl: record.processedGeojsonUrl,
      symbology: getPersistedVectorSymbology(record),
      legend: getPersistedVectorLegend(record),
    });
  }

  function getPersistedVectorSymbology(record) {
    return record.symbology || record.metadata?.symbology || record.metadata?.properties?.symbology || null;
  }

  function getPersistedVectorLegend(record) {
    const primaryVectorLegend = record && record.vectorLegend;
    return normalizePublishedVectorLegend(primaryVectorLegend ? { ...record, vectorLegend: primaryVectorLegend } : record);
  }

  async function createProcessedGeoJsonLayerFromBackend(record) {
    const response = await fetch(record.processedGeojsonUrl);
    if (!response.ok) {
      throw new Error("No se pudo descargar el GeoJSON procesado del backend.");
    }

    const normalizedRemote = normalizeBackendProcessedGeoJson(ensureFeatureCollection(await response.json()), record);
    const geojson = normalizedRemote.geojson;
    console.info("Capa cargada desde backend:", record.title);
    return createUserLayer({
      title: record.title,
      category: extractCategoryFromRecord(record),
      fileType: record.sourceType || "geojson",
      sourceKind: "geojson",
      data: geojson,
      description: record.description || "Capa publicada desde el backend institucional.",
      backendLayerId: record.id,
      createdById: record.createdBy?.id || null,
      municipality: record.municipality || "Cobertura estatal",
      status: record.status,
      metadata: record.metadata || null,
      symbology: normalizedRemote.symbology,
      legend: normalizedRemote.legend,
    });
  }

  function cloneLayerForLocalPersistence(layer) {
    (layer.groundOverlays || []).forEach((overlay) => {
      overlay.revokeUrl = false;
    });
    return {
      ...layer,
      groundOverlays: (layer.groundOverlays || []).map((overlay) => ({
        ...overlay,
        revokeUrl: true,
      })),
    };
  }

  function createGroundOverlayLayerFromBackend(record) {
    const overlays = (record.groundOverlays || [])
      .map((overlay, index) => ({
        id: overlay.id || `ground-overlay-${index + 1}`,
        name: overlay.name || `GroundOverlay ${index + 1}`,
        imageUrl: overlay.imageUrl,
        coordinates: overlay.coordinates,
        bounds: overlay.bounds,
        bbox: overlay.bbox,
        rotation: overlay.rotation || 0,
        drawOrder: overlay.drawOrder ?? index,
      }))
      .filter((overlay) => overlay.imageUrl && Array.isArray(overlay.coordinates));

    if (!overlays.length) {
      throw new Error("La capa GroundOverlay no contiene imágenes georreferenciadas válidas.");
    }

    return createUserLayer({
      title: record.title,
      category: extractCategoryFromRecord(record),
      fileType: record.sourceType || "kmz",
      sourceKind: record.resourceType === "mixed" ? "mixed" : "ground-overlay",
      resourceType: record.resourceType || "ground-overlay",
      groundOverlays: overlays,
      imageUrl: overlays[0].imageUrl,
      coordinates: overlays[0].coordinates,
      description: record.description || "Capa raster georreferenciada publicada desde el backend institucional.",
      backendLayerId: record.id,
      createdById: record.createdBy?.id || null,
      municipality: record.municipality || "Cobertura estatal",
      status: record.status,
      metadata: record.metadata || null,
      legend: record.rasterLegend || {
        type: "raster",
        field: "Simbologia raster",
        classes: [{
          label: GROUND_OVERLAY_FALLBACK_LEGEND_LABEL,
          color: "transparent",
          outlineColor: "rgba(70, 36, 49, 0.35)",
        }],
      },
    });
  }

  function getClickedVectorFeature(event, layerMeta) {
    const directFeature = event.features && event.features[0];
    if (hasPopupProperties(directFeature?.properties)) return directFeature;

    const layerIds = (layerMeta.interactiveLayerIds || [])
      .filter((id) => map.getLayer(id));
    if (!layerIds.length) return directFeature || null;

    const queriedFeatures = map.queryRenderedFeatures(event.point, { layers: layerIds });
    return queriedFeatures.find((feature) => hasPopupProperties(feature.properties)) || directFeature || null;
  }

  function hasPopupProperties(properties = {}) {
    return Object.entries(properties || {}).some(([key, value]) => {
      return !key.startsWith("__") && isUsablePopupValue(value);
    });
  }

  function normalizeBackendProcessedGeoJson(geojson, record = null) {
    const features = geojson.features.map((feature) => ({
      ...feature,
      properties: normalizeBackendFeatureProperties(feature.properties || {}),
    }));
    const featuresWithExistingStyle = features.map((feature) => ({
      ...feature,
      properties: applyExistingRemoteStyle(feature.properties || {}, record),
    }));
    const existingStyleIsUsable = hasUsefulExistingStyle(featuresWithExistingStyle);
    const styleField = chooseBackendStyleFieldSafe(featuresWithExistingStyle);
    const symbology = buildRemoteLayerSymbology(featuresWithExistingStyle, styleField, record, { existingStyleIsUsable });

    return {
      geojson: {
        ...geojson,
        features: featuresWithExistingStyle.map((feature) => ({
          ...feature,
          properties: applyBackendFeatureStyle(feature.properties || {}, symbology, { preserveExistingStyle: existingStyleIsUsable }),
        })),
      },
      symbology,
      legend: symbology?.legend || null,
    };
  }

  function hasUsefulExistingStyle(features) {
    const fills = getUniqueStyleValues(features, "__styleFill").filter((value) => parseRemoteColorValue(value));
    if (fills.length > 1) return true;
    if (!fills.length) return false;

    const styleField = chooseBackendStyleFieldSafe(features);
    const thematicValues = styleField ? getUniqueSafeStyleValues(features, styleField.field) : [];
    if (thematicValues.length > 1) {
      console.info("Estilo persistido colapsado; se usará campo temático como respaldo:", styleField.field);
      return false;
    }

    return true;
  }

  function normalizeBackendFeatureProperties(properties) {
    const normalized = { ...properties };
    const description = getPropertyValueByAlias(properties, ["description", "Description"]);
    const descriptionAttributes = parseKmlDescriptionHtmlAttributes(description);

    if (Object.keys(descriptionAttributes).length) {
      console.info("Descripción HTML KML detectada");
      console.info("Atributos KML extraídos:", descriptionAttributes);
      Object.entries(descriptionAttributes).forEach(([key, value]) => {
        if (normalized[key] === undefined || normalized[key] === null || String(normalized[key]).trim() === "") {
          normalized[key] = value;
        }
      });
    }

    applyBackendAttributeAliases(normalized);
    if (isUsablePopupValue(normalized.Intensidad) && Object.keys(descriptionAttributes).length) {
      console.info("Intensidad extraída del HTML:", normalized.Intensidad);
    }

    return normalized;
  }

  function parseKmlDescriptionHtmlAttributes(description) {
    if (typeof description !== "string" || !description.trim()) return {};
    const attributes = parseHtmlTableAttributes(description);
    if (Object.keys(attributes).length) return attributes;

    const decoded = new DOMParser().parseFromString(description, "text/html").body.textContent || "";
    if (decoded && decoded !== description && decoded.includes("<")) {
      return parseHtmlTableAttributes(decoded);
    }

    return {};
  }

  function parseHtmlTableAttributes(html) {
    const htmlDoc = new DOMParser().parseFromString(html, "text/html");
    const attributes = {};

    [...htmlDoc.querySelectorAll("tr")].forEach((row) => {
      const cells = row.querySelectorAll("td, th");
      if (cells.length >= 2) {
        const key = normalizeWhitespace(cells[0].textContent).replace(/:$/u, "");
        const value = normalizeWhitespace(cells[1].textContent);
        if (key && value) attributes[key] = value;
      }
    });

    return attributes;
  }

  function applyBackendAttributeAliases(properties) {
    const lookup = new Map(
      Object.entries(properties)
        .filter(([_key, value]) => isUsablePopupValue(value))
        .map(([key, value]) => [normalizeAttributeKey(key), { key, value }])
    );
    const aliases = [
      ["Municipio", ["Municipio", "Name", "name"]],
      ["Intensidad", ["Intensidad"]],
      ["Detalles", ["Detalles"]],
      ["Clasificación", ["Fen_Clasif", "Clasificacion", "Clasificación"]],
      ["Amenaza", ["Ame_Ampl", "Amenaza"]],
      ["Magnitud", ["Magni_num", "Magnitud"]],
      ["Indicador", ["R_P_V_E_A", "Indicador"]],
      ["Fuente", ["Fuente"]],
    ];

    aliases.forEach(([canonical, keys]) => {
      if (isUsablePopupValue(properties[canonical])) return;
      const matched = keys.map(normalizeAttributeKey).map((key) => lookup.get(key)).find(Boolean);
      if (matched) {
        properties[canonical] = String(matched.value).trim();
      }
    });
  }

  function getIntensityFillColor(value) {
    const normalized = normalizeAttributeKey(value).replace(/\s+/g, " ").trim();
    const colors = {
      "muy bajo": "#006100",
      "muy baja": "#006100",
      bajo: "#7aab00",
      baja: "#7aab00",
      medio: "#ffff00",
      media: "#ffff00",
      alto: "#ff9900",
      alta: "#ff9900",
      "muy alto": "#ff2200",
      "muy alta": "#ff2200",
    };
    return colors[normalized] || null;
  }

  function applyExistingRemoteStyle(properties, record = null) {
    if (properties.__styleFill) {
      console.info("Se conserva __styleFill:", properties.__styleFill);
      return properties;
    }

    const styleColor = getRemoteStyleColor(properties, record);
    if (!styleColor) return properties;

    console.info("Estilo remoto existente detectado:", styleColor);
    return {
      ...properties,
      __styleFill: styleColor,
    };
  }

  function getRemoteStyleColor(properties, record = null) {
    const styleKeys = [
      "__styleFill",
      "fill",
      "fillColor",
      "fill-color",
      "FillColor",
      "Style",
      "style",
      "color",
      "Color",
      "stroke",
      "styleUrl",
      "OGR_STYLE",
      "ogr_style",
    ];
    const directValue = getPropertyValueByAlias(properties, styleKeys);
    const parsedDirect = parseRemoteColorValue(directValue);
    if (parsedDirect) return parsedDirect;

    const metadataProperties = record?.metadata?.properties || {};
    const metadataValue = getPropertyValueByAlias(metadataProperties, [
      "fillColor",
      "fill",
      "color",
      "defaultFillColor",
      "layerColor",
    ]);
    return parseRemoteColorValue(metadataValue);
  }

  function parseRemoteColorValue(value) {
    if (!isUsablePopupValue(value)) return null;
    const raw = String(value).trim();
    const cssColorMatch = raw.match(/rgba?\([^)]+\)/iu);
    if (cssColorMatch) return cssColorMatch[0];
    const hexMatch = raw.match(/#?([0-9a-f]{6}|[0-9a-f]{8})\b/iu);
    if (!hexMatch) return null;

    const hex = hexMatch[1];
    if (hex.length === 6) return `#${hex}`;
    return parseKmlColor(hex);
  }

  function chooseBackendStyleField(features) {
    const priorityFields = [
      "Intensidad",
      "Riesgo",
      "Peligro",
      "Vulnerabilidad",
      "Nivel",
      "Categoria",
      "Categoría",
      "Clasificación",
      "Fen_Clasif",
      "IVS_FINAL",
      "Magni_num",
      "Intens_num",
    ];

    const priorityField = priorityFields.find((field) => getUniqueStyleValues(features, field).length > 0);
    const selectedField = priorityField || findMostVariableStyleField(features);
    if (!selectedField) return null;

    const uniqueValues = getUniqueStyleValues(features, selectedField);
    console.info("Campo de estilo elegido:", selectedField);
    console.info("Número de valores únicos de clasificación:", uniqueValues.length);
    if (uniqueValues.length <= 1) {
      console.info("Se aplica estilo único:", uniqueValues[0] || "sin valor");
    } else {
      console.info("Se aplica simbología por categorías:", selectedField);
    }
    return {
      field: selectedField,
      uniqueCount: uniqueValues.length,
    };
  }

  function hasVaryingUsableValues(features, field) {
    const values = getFeatureFieldValues(features, field);
    return values.length > 0 && new Set(values.map(normalizeStyleValueKey)).size > 1;
  }

  function getUniqueStyleValues(features, field) {
    return [...new Set(getFeatureFieldValues(features, field).map(normalizeStyleValueKey))];
  }

  function findMostVariableStyleField(features) {
    const ignoredKeys = new Set([
      "description",
      "name",
      "Name",
      "Municipio",
      "__styleLine",
      "__styleFill",
      "__styleIcon",
      "__styleWidth",
    ]);
    const scores = new Map();

    features.forEach((feature) => {
      Object.entries(feature.properties || {}).forEach(([key, value]) => {
        if (ignoredKeys.has(key) || key.startsWith("__") || !isUsablePopupValue(value)) return;
        if (!scores.has(key)) scores.set(key, new Set());
        scores.get(key).add(normalizeStyleValueKey(value));
      });
    });

    return [...scores.entries()]
      .filter(([_key, values]) => values.size > 1)
      .sort((a, b) => b[1].size - a[1].size)[0]?.[0] || null;
  }

  function getFeatureFieldValues(features, field) {
    return features
      .map((feature) => getPropertyValueByAlias(feature.properties || {}, [field]))
      .filter(isUsablePopupValue)
      .map((value) => String(value).trim());
  }

  function applyBackendFeatureStyle(properties, styleField, options = {}) {
    if (styleField?.type === "continuous") {
      return properties;
    }

    if (options.preserveExistingStyle && properties.__styleFill) {
      console.info("Se conserva __styleFill:", properties.__styleFill);
      return properties;
    }

    const intensity = getPropertyValueByAlias(properties, ["Intensidad"]);
    const intensityColor = getTextCategoryColor(intensity);
    if (intensityColor) {
      console.info("Campo de simbología final:", "Intensidad");
      console.info("Valor de estilo detectado:", intensity);
      console.info("Color por intensidad aplicado:", intensityColor);
      return {
        ...properties,
        __styleFill: intensityColor,
      };
    }

    if (properties.__styleFill) {
      console.info("Se conserva __styleFill:", properties.__styleFill);
      return properties;
    }
    const fieldName = typeof styleField === "string" ? styleField : styleField?.field;
    const styleValue = fieldName ? getPropertyValueByAlias(properties, [fieldName]) : null;
    const color = getStyleColorForValue(styleValue, styleField);
    if (color) {
      console.info("Valor de estilo detectado:", styleValue);
      console.info("Color final aplicado:", color);
      return {
        ...properties,
        __styleFill: color,
      };
    }
    return properties;
  }

  function getStyleColorForValue(value, styleField = null) {
    if (!isUsablePopupValue(value)) return null;
    const textColor = getTextCategoryColor(value);
    if (textColor) return textColor;
    const numericColor = getNumericCategoryColor(value);
    if (numericColor) return numericColor;
    if (styleField?.uniqueCount <= 1) return null;
    return getCategoricalColor(value);
  }

  function getTextCategoryColor(value) {
    const normalized = normalizeAttributeKey(value).replace(/\s+/g, " ").trim();
    if (normalized.includes("muy bajo") || normalized.includes("muy baja")) return "#006100";
    if (normalized.includes("muy alto") || normalized.includes("muy alta")) return "#ff2200";
    if (normalized.includes("bajo") || normalized.includes("baja")) return "#7aab00";
    if (normalized.includes("medio") || normalized.includes("media")) return "#ffff00";
    if (normalized.includes("alto") || normalized.includes("alta")) return "#ff9900";
    return null;
  }

  function getNumericCategoryColor(value) {
    const numeric = Number(String(value).replace(",", ".").trim());
    if (!Number.isFinite(numeric)) return null;
    if (numeric >= 0 && numeric <= 0.2) return "#006100";
    if (numeric > 0.2 && numeric <= 0.4) return "#7aab00";
    if (numeric > 0.4 && numeric <= 0.6) return "#ffff00";
    if (numeric > 0.6 && numeric <= 0.8) return "#ff9900";
    if (numeric > 0.8 && numeric <= 1) return "#ff2200";
    return null;
  }

  function getCategoricalColor(value) {
    const palette = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];
    const key = normalizeStyleValueKey(value);
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
      hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
    }
    return palette[hash % palette.length];
  }

  function getPropertyValueByAlias(properties, aliases) {
    const lookup = new Map(
      Object.entries(properties).map(([key, value]) => [normalizeAttributeKey(key), value])
    );
    const alias = aliases.map(normalizeAttributeKey).find((key) => lookup.has(key));
    return alias ? lookup.get(alias) : null;
  }

  function normalizeStyleValueKey(value) {
    return normalizeAttributeKey(value).replace(/\s+/g, " ").trim();
  }

  function chooseBackendStyleFieldSafe(features) {
    const priorityFields = [
      "Intensidad",
      "Riesgo",
      "Peligro",
      "Vulnerabilidad",
      "Nivel",
      "Categoria",
      "Categoría",
      "Clasificación",
      "Fen_Clasif",
      "IVS_FINAL",
      "Magni_num",
      "Intens_num",
    ];
    const priorityField = priorityFields.find((field) => getUniqueSafeStyleValues(features, field).length > 0);
    const selectedField = priorityField || findMostVariableSafeStyleField(features);
    if (!selectedField) return null;

    const uniqueValues = getUniqueSafeStyleValues(features, selectedField);
    console.info("Campo seleccionado para simbología:", selectedField);
    console.info("Valores únicos detectados:", uniqueValues.length <= 12 ? uniqueValues : `${uniqueValues.length} valores`);
    return {
      field: selectedField,
      uniqueCount: uniqueValues.length,
    };
  }

  function findMostVariableSafeStyleField(features) {
    const scores = new Map();

    features.forEach((feature) => {
      Object.entries(feature.properties || {}).forEach(([key, value]) => {
        if (!isSafeStyleFieldCandidate(key, value)) return;
        if (!scores.has(key)) scores.set(key, new Set());
        scores.get(key).add(normalizeStyleValueKey(value));
      });
    });

    return [...scores.entries()]
      .filter(([_key, values]) => values.size > 1)
      .sort((a, b) => b[1].size - a[1].size)[0]?.[0] || null;
  }

  function getUniqueSafeStyleValues(features, field) {
    return [...new Set(getSafeFeatureFieldValues(features, field).map(normalizeStyleValueKey))];
  }

  function getSafeFeatureFieldValues(features, field) {
    return features
      .map((feature) => getPropertyValueByAlias(feature.properties || {}, [field]))
      .filter((value) => isSafeStyleValue(value, field))
      .map((value) => String(value).trim());
  }

  function buildRemoteLayerSymbology(features, styleField, record = null, options = {}) {
    const publishedLegend = normalizePublishedVectorLegend(record);
    if (publishedLegend) {
      const symbology = {
        type: publishedLegend.type,
        field: publishedLegend.field,
        legend: publishedLegend,
        diagnostics: {
          layerName: record?.title || "Capa remota",
          field: publishedLegend.field,
          type: "leyenda vectorial publicada",
          featureCount: features.length,
          uniqueCount: publishedLegend.classes.length,
        },
      };
      console.info("Diagnóstico simbología remota:", symbology.diagnostics);
      return symbology;
    }

    if (options.existingStyleIsUsable) {
      const preservedLegend =
        buildSemanticLegendFromFeatures(features, styleField?.field) ||
        buildTechnicalStyleFallbackLegend(features);
      return {
        type: "kml-preserved",
        field: "__styleFill",
        legend: preservedLegend,
        diagnostics: {
          layerName: record?.title || "Capa remota",
          field: "__styleFill",
          type: "estilo KML preservado",
          featureCount: features.length,
          uniqueCount: getUniqueStyleValues(features, "__styleFill").length,
        },
      };
    }

    if (!styleField?.field || isTechnicalStyleField(styleField.field)) return null;

    const analysis = analyzeStyleField(features, styleField.field);
    if (!analysis.validCount) return null;

    let classification = null;
    if (analysis.type === "continuous") {
      classification = buildContinuousClassification(styleField.field, analysis.numericValues);
    }

    const symbology = classification?.type === "continuous" || classification?.type === "single"
      ? {
          type: "continuous",
          field: styleField.field,
          fillColorExpression: classification.expression,
          lineColorExpression: classification.expression,
          pointColorExpression: classification.expression,
          legend: {
            type: "continuous",
            field: styleField.field,
            classes: classification.legend,
            method: classification.method,
          },
          diagnostics: {
            layerName: record?.title || "Capa remota",
            field: styleField.field,
            type: "numérico continuo",
            featureCount: features.length,
            validCount: analysis.validCount,
            uniqueCount: analysis.uniqueCount,
            min: classification.min,
            max: classification.max,
            method: classification.method,
            cuts: classification.cuts,
            expression: classification.expression,
          },
        }
      : {
          type: "categorical",
          field: styleField.field,
          legend: null,
          diagnostics: {
            layerName: record?.title || "Capa remota",
            field: styleField.field,
            type: "categórico",
            featureCount: features.length,
            validCount: analysis.validCount,
            uniqueCount: analysis.uniqueCount,
            min: null,
            max: null,
            method: "categorical",
            cuts: [],
            expression: null,
          },
        };

    console.info("Diagnóstico simbología remota:", symbology.diagnostics);
    return symbology;
  }

  function isSafeStyleFieldCandidate(key, value) {
    const blockedFields = new Set([
      "description",
      "Description",
      "html",
      "HTML",
      "snippet",
      "Snippet",
      "name",
      "Name",
      "Style",
      "style",
      "styleUrl",
      "OGR_STYLE",
      "fill",
      "fillColor",
      "fill-color",
      "color",
      "stroke",
      "altitudeMode",
      "tessellate",
      "extrude",
      "visibility",
    ]);

    const blockedNormalized = new Set([...blockedFields].map(normalizeAttributeKey));
    if (blockedFields.has(key) || blockedNormalized.has(normalizeAttributeKey(key)) || key.startsWith("__") || isTechnicalStyleField(key)) return false;
    return isSafeStyleValue(value, key);
  }

  function isSafeStyleValue(value, key = null) {
    if (!isUsablePopupValue(value)) return false;
    const text = String(value).trim();
    if (containsStyleHtml(text)) {
      if (key) console.info("Campo descartado por HTML:", key);
      return false;
    }
    return isNumericStyleValueSafe(text) || text.length <= 80;
  }

  function containsStyleHtml(value) {
    const text = String(value || "").toLowerCase();
    return ["<html", "<table", "<tr", "<td"].some((token) => text.includes(token));
  }

  function isNumericStyleValueSafe(value) {
    return Number.isFinite(Number(String(value).replace(",", ".").trim()));
  }

  async function createGeoJsonLayerFromRemoteRecord(record, remoteFile) {
    const response = await fetch(remoteFile.publicUrl);
    if (!response.ok) {
      throw new Error("No se pudo descargar el GeoJSON remoto.");
    }

    const normalizedRemote = normalizeBackendProcessedGeoJson(ensureFeatureCollection(await response.json()), record);
    const geojson = normalizedRemote.geojson;
    return createUserLayer({
      title: record.title,
      category: extractCategoryFromRecord(record),
      fileType: "geojson",
      sourceKind: "geojson",
      data: geojson,
      description: record.description || "Capa GeoJSON publicada desde el backend institucional.",
      backendLayerId: record.id,
      createdById: record.createdBy?.id || null,
      municipality: record.municipality || "Cobertura estatal",
      status: record.status,
      metadata: record.metadata || null,
      symbology: normalizedRemote.symbology,
      legend: normalizedRemote.legend || getPersistedVectorLegend(record),
    });
  }

  async function createShapefileLayerFromRemoteZip(record, remoteFile) {
    const file = await fetchRemoteFile(remoteFile);
    const arrayBuffer = await file.arrayBuffer();
    const result = await window.shp(arrayBuffer);
    const collections = Array.isArray(result) ? result : [result];
    const merged = collections.reduce(
      (accumulator, collection) => {
        const featureCollection = ensureFeatureCollection(collection);
        accumulator.features.push(...featureCollection.features);
        return accumulator;
      },
      { type: "FeatureCollection", features: [] }
    );

    const normalizedRemote = normalizeBackendProcessedGeoJson(merged, record);

    return createUserLayer({
      title: record.title,
      category: extractCategoryFromRecord(record),
      fileType: "shp",
      sourceKind: "geojson",
      data: normalizedRemote.geojson,
      description: record.description || "Shapefile institucional publicado desde el backend.",
      backendLayerId: record.id,
      createdById: record.createdBy?.id || null,
      municipality: record.municipality || "Cobertura estatal",
      status: record.status,
      metadata: record.metadata || null,
      symbology: normalizedRemote.symbology,
      legend: normalizedRemote.legend || getPersistedVectorLegend(record),
    });
  }

  async function createShapefileLayerFromRemoteParts(record, remoteFiles) {
    const files = await Promise.all(remoteFiles.map((file) => fetchRemoteFile(file)));
    const layers = await createShapefileLayersFromParts(files);
    return {
      ...layers[0],
      category: extractCategoryFromRecord(record),
      group: getThematicGroupTitle(extractCategoryFromRecord(record)),
      title: record.title,
      description: record.description || layers[0].description,
      backendLayerId: record.id,
      createdById: record.createdBy?.id || null,
      municipality: record.municipality || "Cobertura estatal",
      status: record.status,
    };
  }

  async function fetchRemoteFile(remoteFile) {
    const response = await fetch(remoteFile.publicUrl);
    if (!response.ok) {
      throw new Error(`No se pudo descargar ${remoteFile.originalName}.`);
    }

    const blob = await response.blob();
    return new File([blob], remoteFile.originalName, {
      type: remoteFile.mimeType || blob.type || guessMimeType(remoteFile.originalName),
    });
  }

  function extractCategoryFromRecord(record) {
    const tags = record?.metadata?.properties?.tags;
    if (Array.isArray(tags)) {
      const tag = tags.find((value) => String(value).toLowerCase().startsWith("category:"));
      if (tag) {
        return normalizeLayerCategoryKey(String(tag).split(":").slice(1).join(":").trim()) || "otras";
      }
    }

    return (
      normalizeLayerCategoryKey(
        [
          record?.category,
          record?.theme,
          record?.topic,
          record?.title,
          record?.description,
        ]
          .filter(Boolean)
          .join(" ")
      ) ||
      resolveLayerCategory({
        category: record?.category,
        theme: record?.theme,
        topic: record?.topic,
        title: record?.title,
        description: record?.description,
        municipality: record?.municipality,
        fileType: record?.sourceType,
      })
    );
  }
