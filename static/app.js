const savedView = JSON.parse(localStorage.getItem("linemap:view") || "null");
const savedState = JSON.parse(localStorage.getItem("linemap:state") || "{}");

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: savedView?.center || [139.767, 35.681],
  zoom: savedView?.zoom || 11,
  fadeDuration: 0,
  renderWorldCopies: false,
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

const state = {
  routes: { type: "FeatureCollection", features: [] },
  routeCatalog: [],
  stops: { type: "FeatureCollection", features: [] },
  stopConnections: { type: "FeatureCollection", features: [] },
  vehicles: { type: "FeatureCollection", features: [] },
  visibleRouteIds: new Set(savedState.visibleRouteIds || []),
  showStops: savedState.showStops ?? true,
  showStopConnections: savedState.showStopConnections ?? false,
  showVehicles: savedState.showVehicles ?? true,
};

const routeList = document.getElementById("routeList");
const routeSearchInput = document.getElementById("routeSearchInput");
const uploadResult = document.getElementById("uploadResult");
const rtStatus = document.getElementById("rtStatus");

function saveUiState() {
  localStorage.setItem(
    "linemap:state",
    JSON.stringify({
      visibleRouteIds: Array.from(state.visibleRouteIds),
      showStops: state.showStops,
      showStopConnections: state.showStopConnections,
      showVehicles: state.showVehicles,
    }),
  );
}

function saveMapView() {
  const center = map.getCenter();
  localStorage.setItem(
    "linemap:view",
    JSON.stringify({ center: [center.lng, center.lat], zoom: map.getZoom() }),
  );
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${body}`);
  }
  return response.json();
}

function createLayersIfNeeded() {
  if (!map.getSource("routes")) {
    map.addSource("routes", { type: "geojson", data: state.routes });
    map.addLayer({
      id: "routes-line",
      type: "line",
      source: "routes",
      paint: {
        "line-color": ["concat", "#", ["get", "route_color"]],
        "line-width": 3,
        "line-opacity": 0.95,
      },
      filter: ["in", ["get", "route_id"], ["literal", Array.from(state.visibleRouteIds)]],
    });
  }

  if (!map.getSource("stops")) {
    map.addSource("stops", { type: "geojson", data: state.stops });
    map.addLayer({
      id: "stops-circle",
      type: "circle",
      source: "stops",
      paint: {
        "circle-radius": 4,
        "circle-color": "#124734",
        "circle-stroke-width": 1,
        "circle-stroke-color": "#e7f6ec",
      },
      layout: { visibility: state.showStops ? "visible" : "none" },
    });
  }

  if (!map.getSource("stop-connections")) {
    map.addSource("stop-connections", { type: "geojson", data: state.stopConnections });
    map.addLayer({
      id: "stop-connections-line",
      type: "line",
      source: "stop-connections",
      paint: {
        "line-color": ["concat", "#", ["get", "route_color"]],
        "line-width": 2.5,
        "line-opacity": 0.55,
      },
      layout: { visibility: state.showStopConnections ? "visible" : "none" },
    });
  }

  if (!map.getSource("vehicles")) {
    map.addSource("vehicles", { type: "geojson", data: state.vehicles });
    map.addLayer({
      id: "vehicles-symbol",
      type: "circle",
      source: "vehicles",
      paint: {
        "circle-radius": 6,
        "circle-color": "#dd5c23",
        "circle-stroke-color": "#fff4de",
        "circle-stroke-width": 2,
      },
      layout: { visibility: state.showVehicles ? "visible" : "none" },
    });
  }
}

function updateRouteFilter() {
  if (!map.getLayer("routes-line")) return;
  map.setFilter("routes-line", ["in", ["get", "route_id"], ["literal", Array.from(state.visibleRouteIds)]]);
  if (map.getLayer("stop-connections-line")) {
    map.setFilter("stop-connections-line", ["in", ["get", "route_id"], ["literal", Array.from(state.visibleRouteIds)]]);
  }
}

function renderRouteList() {
  const keyword = routeSearchInput.value.trim().toLowerCase();
  routeList.innerHTML = "";

  const filtered = state.routeCatalog.filter((route) => {
    const label = `${route.route_short_name || ""} ${route.route_long_name || ""}`.toLowerCase();
    return !keyword || label.includes(keyword);
  });

  filtered.forEach((route) => {
    const id = route.route_id;
    const item = document.createElement("label");
    item.className = "route-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.visibleRouteIds.has(id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.visibleRouteIds.add(id);
      } else {
        state.visibleRouteIds.delete(id);
      }
      updateRouteFilter();
      saveUiState();
    });

    const chip = document.createElement("span");
    chip.className = "route-chip";
    chip.style.backgroundColor = `#${route.route_color}`;

    const label = document.createElement("div");
    label.className = "route-label";
    const name = `${route.route_short_name || ""} ${route.route_long_name || ""}`.trim() || route.route_id;
    label.textContent = `${name} (${route.route_id})`;

    item.append(checkbox, chip, label);
    routeList.appendChild(item);
  });
}

async function reloadAllData() {
  const [routes, routeCatalog, stops, stopConnections, vehiclesPayload] = await Promise.all([
    api("/routes"),
    api("/route_catalog"),
    api("/stops"),
    api("/stop_connections"),
    api("/vehicles"),
  ]);

  state.routes = routes;
  state.routeCatalog = routeCatalog;
  state.stops = stops;
  state.stopConnections = stopConnections;
  state.vehicles = vehiclesPayload.vehicles;

  if (state.visibleRouteIds.size === 0) {
    routeCatalog.forEach((r) => state.visibleRouteIds.add(r.route_id));
  }

  createLayersIfNeeded();

  map.getSource("routes")?.setData(state.routes);
  map.getSource("stops")?.setData(state.stops);
  map.getSource("stop-connections")?.setData(state.stopConnections);
  map.getSource("vehicles")?.setData(state.vehicles);

  updateRouteFilter();
  renderRouteList();
  rtStatus.textContent = vehiclesPayload.status?.last_error
    ? `RT Error: ${vehiclesPayload.status.last_error}`
    : `RT更新: ${vehiclesPayload.status?.last_update_unix || "未取得"}`;
}

async function uploadGtfs() {
  const input = document.getElementById("gtfsZipInput");
  const file = input.files?.[0];
  if (!file) {
    uploadResult.textContent = "ZIPファイルを選択してください。";
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  try {
    const result = await api("/upload", { method: "POST", body: formData });
    uploadResult.textContent = `${result.message} routes=${result.routes}, stops=${result.stops}`;
    await reloadAllData();
  } catch (err) {
    uploadResult.textContent = `失敗: ${err.message}`;
  }
}

async function saveRtConfig() {
  const url = document.getElementById("rtUrlInput").value.trim();
  const interval = Number(document.getElementById("rtIntervalInput").value || "10");

  try {
    const result = await api("/settings/gtfs_rt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gtfs_rt_url: url || null, interval_sec: interval }),
    });
    rtStatus.textContent = `設定保存: ${result.status.url || "未設定"}`;
  } catch (err) {
    rtStatus.textContent = `保存失敗: ${err.message}`;
  }
}

function wireActions() {
  document.getElementById("uploadBtn").addEventListener("click", uploadGtfs);
  document.getElementById("rtSaveBtn").addEventListener("click", saveRtConfig);

  routeSearchInput.addEventListener("input", renderRouteList);

  document.getElementById("toggleStopsBtn").addEventListener("click", () => {
    state.showStops = !state.showStops;
    map.setLayoutProperty("stops-circle", "visibility", state.showStops ? "visible" : "none");
    saveUiState();
  });

  document.getElementById("toggleVehiclesBtn").addEventListener("click", () => {
    state.showVehicles = !state.showVehicles;
    map.setLayoutProperty("vehicles-symbol", "visibility", state.showVehicles ? "visible" : "none");
    saveUiState();
  });

  document.getElementById("toggleStopConnectionsBtn").addEventListener("click", () => {
    state.showStopConnections = !state.showStopConnections;
    map.setLayoutProperty(
      "stop-connections-line",
      "visibility",
      state.showStopConnections ? "visible" : "none",
    );
    saveUiState();
  });

  document.getElementById("exportPngBtn").addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = map.getCanvas().toDataURL("image/png");
    link.download = `linemap-${Date.now()}.png`;
    link.click();
  });

  map.on("click", "routes-line", (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties || {};
    const name = `${p.route_short_name || ""} ${p.route_long_name || ""}`.trim();
    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(`<b>${name || p.route_id}</b><br/>route_id: ${p.route_id}`)
      .addTo(map);
  });

  map.on("click", "stops-circle", (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties || {};
    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(`<b>${p.stop_name || "停留所"}</b><br/>stop_id: ${p.stop_id}`)
      .addTo(map);
  });

  map.on("click", "stop-connections-line", (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties || {};
    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(`<b>停留所連結線</b><br/>route_id: ${p.route_id}<br/>trip_id: ${p.trip_id}`)
      .addTo(map);
  });

  map.on("moveend", saveMapView);
}

map.on("load", async () => {
  createLayersIfNeeded();
  wireActions();
  rtStatus.textContent = "ベースマップを表示中...";

  map.once("idle", async () => {
    try {
      rtStatus.textContent = "GTFSデータを読み込み中...";
      await reloadAllData();
    } catch (err) {
      rtStatus.textContent = `初期読み込み失敗: ${err.message}`;
    }
  });

  setInterval(async () => {
    try {
      const payload = await api("/vehicles");
      state.vehicles = payload.vehicles;
      map.getSource("vehicles")?.setData(state.vehicles);
      rtStatus.textContent = payload.status?.last_error
        ? `RT Error: ${payload.status.last_error}`
        : `RT更新: ${payload.status?.last_update_unix || "未取得"}`;
    } catch (err) {
      rtStatus.textContent = `RT取得失敗: ${err.message}`;
    }
  }, 10000);
});
