const savedView = JSON.parse(localStorage.getItem("linemap:view") || "null");
const savedState = JSON.parse(localStorage.getItem("linemap:state") || "{}");
const BASEMAP_STYLES = {
  liberty: "https://tiles.openfreemap.org/styles/liberty",
  bright: "https://tiles.openfreemap.org/styles/bright",
  positron: "https://tiles.openfreemap.org/styles/positron",
};

function resolveInitialStyle(styleUrl) {
  const candidates = Object.values(BASEMAP_STYLES);
  if (styleUrl && candidates.includes(styleUrl)) {
    return styleUrl;
  }
  return BASEMAP_STYLES.liberty;
}

const initialStyle = resolveInitialStyle(savedState.baseMapStyle);

const map = new maplibregl.Map({
  container: "map",
  style: initialStyle,
  center: savedView?.center || [139.767, 35.681],
  zoom: savedView?.zoom || 11,
  fadeDuration: 0,
  renderWorldCopies: false,
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

const state = {
  rawRoutes: { type: "FeatureCollection", features: [] },
  rawRouteCatalog: [],
  rawStopConnections: { type: "FeatureCollection", features: [] },
  routes: { type: "FeatureCollection", features: [] },
  routeCatalog: [],
  stops: { type: "FeatureCollection", features: [] },
  stopConnections: { type: "FeatureCollection", features: [] },
  vehicles: { type: "FeatureCollection", features: [] },
  routeToGroup: {},
  groupToRoutes: {},
  visibleRouteIds: new Set(savedState.visibleRouteIds || []),
  showStops: savedState.showStops ?? true,
  showStopConnections: savedState.showStopConnections ?? false,
  showVehicles: savedState.showVehicles ?? true,
  mergeRoundTrip: savedState.mergeRoundTrip ?? false,
  mergeColorSide: savedState.mergeColorSide || "first",
  baseMapStyle: initialStyle,
};

const routeList = document.getElementById("routeList");
const routeSearchInput = document.getElementById("routeSearchInput");
const uploadResult = document.getElementById("uploadResult");
const rtStatus = document.getElementById("rtStatus");
const mapStyleSelect = document.getElementById("mapStyleSelect");
const mergeRoundTripToggle = document.getElementById("mergeRoundTripToggle");
const mergeColorSideSelect = document.getElementById("mergeColorSideSelect");
const toggleStopConnectionsBtn = document.getElementById("toggleStopConnectionsBtn");
let debugOverlay = null;

function getLayerVisibility(layerId) {
  if (!map.getLayer(layerId)) return "missing";
  return map.getLayoutProperty(layerId, "visibility") || "visible";
}

function ensureDebugOverlay() {
  if (debugOverlay) return debugOverlay;
  debugOverlay = document.createElement("pre");
  debugOverlay.id = "debugOverlay";
  debugOverlay.className = "debug-overlay";
  document.body.appendChild(debugOverlay);
  return debugOverlay;
}

function updateDebugOverlay() {
  const node = ensureDebugOverlay();
  const lines = [
    "Debug Overlay",
    `mergeRoundTrip: ${state.mergeRoundTrip ? "ON" : "OFF"}`,
    `mergeColorSide: ${state.mergeColorSide}`,
    `visibleRouteIds: ${state.visibleRouteIds.size}`,
    `routes(features): ${state.routes.features?.length || 0}`,
    `stopConnections(features): ${state.stopConnections.features?.length || 0}`,
    "",
    "Layer Visibility",
    `routes-line: ${getLayerVisibility("routes-line")}`,
    `routes-line-hit: ${getLayerVisibility("routes-line-hit")}`,
    `stop-connections-line: ${getLayerVisibility("stop-connections-line")}`,
    `stop-connections-line-hit: ${getLayerVisibility("stop-connections-line-hit")}`,
    `stops-circle: ${getLayerVisibility("stops-circle")}`,
    `vehicles-symbol: ${getLayerVisibility("vehicles-symbol")}`,
  ];
  node.textContent = lines.join("\n");
}

function saveUiState() {
  localStorage.setItem(
    "linemap:state",
    JSON.stringify({
      visibleRouteIds: Array.from(state.visibleRouteIds),
      showStops: state.showStops,
      showStopConnections: state.showStopConnections,
      showVehicles: state.showVehicles,
      mergeRoundTrip: state.mergeRoundTrip,
      mergeColorSide: state.mergeColorSide,
      baseMapStyle: state.baseMapStyle,
    }),
  );
}

function syncSourcesData() {
  map.getSource("routes")?.setData(state.routes);
  map.getSource("stops")?.setData(state.stops);
  map.getSource("stop-connections")?.setData(state.stopConnections);
  map.getSource("vehicles")?.setData(state.vehicles);
}

function applyLayerVisibility() {
  if (map.getLayer("stops-circle")) {
    map.setLayoutProperty("stops-circle", "visibility", state.showStops ? "visible" : "none");
  }
  if (map.getLayer("stop-connections-line")) {
    map.setLayoutProperty("stop-connections-line", "visibility", state.showStopConnections ? "visible" : "none");
  }
  if (map.getLayer("stop-connections-line-hit")) {
    map.setLayoutProperty("stop-connections-line-hit", "visibility", state.showStopConnections ? "visible" : "none");
  }
  if (map.getLayer("vehicles-symbol")) {
    map.setLayoutProperty("vehicles-symbol", "visibility", state.showVehicles ? "visible" : "none");
  }
  updateDebugOverlay();
}

function refreshOverlayLayers() {
  createLayersIfNeeded();
  syncSourcesData();
  updateRouteFilter();
  applyMergeModeVisualPolicy();
  applyLayerVisibility();
  updateDebugOverlay();
}

function applyMergeModeVisualPolicy() {
  if (state.mergeRoundTrip) {
    state.showStopConnections = false;
    if (map.getLayer("routes-line")) {
      map.setLayoutProperty("routes-line", "visibility", "visible");
    }
    if (map.getLayer("routes-line-hit")) {
      map.setLayoutProperty("routes-line-hit", "visibility", "visible");
    }
    if (map.getLayer("stop-connections-line")) {
      map.setLayoutProperty("stop-connections-line", "visibility", "none");
    }
    if (map.getLayer("stop-connections-line-hit")) {
      map.setLayoutProperty("stop-connections-line-hit", "visibility", "none");
    }
  } else {
    if (map.getLayer("routes-line")) {
      map.setLayoutProperty("routes-line", "visibility", "visible");
    }
    if (map.getLayer("routes-line-hit")) {
      map.setLayoutProperty("routes-line-hit", "visibility", "visible");
    }
  }

  if (toggleStopConnectionsBtn) {
    toggleStopConnectionsBtn.disabled = state.mergeRoundTrip;
    toggleStopConnectionsBtn.textContent = state.mergeRoundTrip
      ? "停留所連結線 ON/OFF（統合中は無効）"
      : "停留所連結線 ON/OFF";
  }
  updateDebugOverlay();
}

function switchBaseMapStyle(styleUrl) {
  if (!styleUrl || styleUrl === state.baseMapStyle) {
    return;
  }

  state.baseMapStyle = styleUrl;
  saveUiState();
  rtStatus.textContent = "地図スタイルを切り替え中...";
  map.setStyle(styleUrl);
  map.once("style.load", () => {
    refreshOverlayLayers();
    rtStatus.textContent = "地図スタイルを切り替えました。";
  });
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

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function distance2d(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function lineLength(line) {
  if (!Array.isArray(line) || line.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < line.length - 1; i += 1) {
    total += distance2d(line[i], line[i + 1]);
  }
  return total;
}

function flattenToLines(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") {
    return [geometry.coordinates || []];
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates || [];
  }
  return [];
}

function pickLongestLine(geometry) {
  const lines = flattenToLines(geometry);
  if (lines.length === 0) return [];
  let best = lines[0];
  let bestLen = lineLength(best);
  for (let i = 1; i < lines.length; i += 1) {
    const currentLen = lineLength(lines[i]);
    if (currentLen > bestLen) {
      best = lines[i];
      bestLen = currentLen;
    }
  }
  return best;
}

function pointAtDistance(line, targetDistance) {
  if (!Array.isArray(line) || line.length === 0) return null;
  if (line.length === 1) return line[0];
  if (targetDistance <= 0) return line[0];

  let walked = 0;
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    const segLen = distance2d(a, b);
    if (segLen === 0) continue;

    if (walked + segLen >= targetDistance) {
      const ratio = (targetDistance - walked) / segLen;
      return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
    }
    walked += segLen;
  }
  return line[line.length - 1];
}

function resampleLine(line, count) {
  if (!Array.isArray(line) || line.length < 2) return [];
  const total = lineLength(line);
  if (total === 0) return [];
  const result = [];
  for (let i = 0; i < count; i += 1) {
    const ratio = i / (count - 1);
    const pt = pointAtDistance(line, total * ratio);
    if (pt) result.push(pt);
  }
  return result;
}

function alignLineDirection(sampleA, sampleB) {
  const direct = distance2d(sampleA[0], sampleB[0]) + distance2d(sampleA[sampleA.length - 1], sampleB[sampleB.length - 1]);
  const reversed =
    distance2d(sampleA[0], sampleB[sampleB.length - 1]) +
    distance2d(sampleA[sampleA.length - 1], sampleB[0]);
  if (reversed < direct) {
    return [...sampleB].reverse();
  }
  return sampleB;
}

function buildCenterLine(lineA, lineB) {
  if (lineA.length < 2 || lineB.length < 2) return [];
  const sampleCount = Math.max(24, Math.min(140, Math.max(lineA.length, lineB.length) * 2));
  const sampleA = resampleLine(lineA, sampleCount);
  const sampleB = resampleLine(lineB, sampleCount);
  if (sampleA.length < 2 || sampleB.length < 2) return [];

  const alignedB = alignLineDirection(sampleA, sampleB);
  const center = [];
  for (let i = 0; i < sampleCount; i += 1) {
    center.push([(sampleA[i][0] + alignedB[i][0]) / 2, (sampleA[i][1] + alignedB[i][1]) / 2]);
  }

  // Remove near-duplicate consecutive points to keep geometry compact.
  const deduped = [center[0]];
  for (let i = 1; i < center.length; i += 1) {
    if (distance2d(center[i], deduped[deduped.length - 1]) > 1e-9) {
      deduped.push(center[i]);
    }
  }
  return deduped;
}

function normalizeTerminalName(value) {
  return (value || "")
    .trim()
    .replace(/[\s　]+/g, " ")
    .toLowerCase();
}

function parseDirectionalPair(longName) {
  const text = (longName || "").trim();
  if (!text) return null;

  // Example: "xyz駅発abc前行き"
  const depArrPattern = text.match(/^(.+?)発(.+?)行(?:き|)$/);
  if (depArrPattern) {
    const from = normalizeTerminalName(depArrPattern[1]);
    const to = normalizeTerminalName(depArrPattern[2]);
    if (from && to) {
      return [from, to];
    }
  }

  // Examples:
  // "xyz駅->abc前"
  // "三角産交→三角病院～大口→松橋駅" (first/last terminal are used)
  const arrowParts = text
    .split(/\s*(?:<->|->|←|→|⇔|↔|⇄)\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (arrowParts.length >= 2) {
    const from = normalizeTerminalName(arrowParts[0]);
    const to = normalizeTerminalName(arrowParts[arrowParts.length - 1]);
    if (from && to) {
      return [from, to];
    }
  }

  return null;
}

function buildRouteDirectionKey(route) {
  const directionalPair = parseDirectionalPair(route.route_long_name || "");
  if (directionalPair) {
    const pair = [...directionalPair].sort();
    return `pair:${pair[0]}|${pair[1]}`;
  }

  const shortName = normalizeTerminalName(route.route_short_name || "");
  if (shortName) {
    return `short:${shortName}`;
  }

  const longName = normalizeTerminalName(route.route_long_name || "");
  if (longName) {
    return `long:${longName}`;
  }

  return `route:${String(route.route_id || "")}`;
}

function buildMergedLabel(routes) {
  if (routes.length === 1) {
    const route = routes[0];
    return `${route.route_short_name || ""} ${route.route_long_name || ""}`.trim() || route.route_id;
  }

  const names = routes
    .map((route) => `${route.route_short_name || ""} ${route.route_long_name || ""}`.trim())
    .filter((name) => name);
  const uniqueNames = Array.from(new Set(names));
  return uniqueNames.slice(0, 2).join(" / ") || routes.map((route) => route.route_id).join(" / ");
}

function normalizeRouteId(value) {
  return String(value ?? "").trim();
}

function normalizeRouteDatasets() {
  if (!state.mergeRoundTrip) {
    state.routes = deepClone(state.rawRoutes);
    state.routeCatalog = deepClone(state.rawRouteCatalog);
    state.stopConnections = deepClone(state.rawStopConnections);
    state.routeToGroup = {};
    state.groupToRoutes = {};
    state.routeCatalog.forEach((route) => {
      state.routeToGroup[route.route_id] = route.route_id;
      state.groupToRoutes[route.route_id] = [route.route_id];
    });
    return;
  }

  const groups = new Map();
  for (const route of state.rawRouteCatalog) {
    const key = buildRouteDirectionKey(route);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(route);
  }

  const mergedCatalog = [];
  const mergedById = {};
  const routeToGroup = {};
  const groupToRoutes = {};
  for (const [key, routes] of groups.entries()) {
    routes.sort((a, b) => String(a.route_id).localeCompare(String(b.route_id)));
    const groupId = `merged:${key}`;
    const colorRoute = state.mergeColorSide === "second" ? routes[routes.length - 1] : routes[0];
    const memberRouteIds = routes.map((route) => normalizeRouteId(route.route_id)).filter((routeId) => routeId);

    mergedCatalog.push({
      route_id: groupId,
      route_short_name: routes[0].route_short_name || "",
      route_long_name: buildMergedLabel(routes),
      route_color: colorRoute.route_color,
      route_text_color: colorRoute.route_text_color || "",
      color_source_route_id: normalizeRouteId(colorRoute.route_id),
      member_route_ids: memberRouteIds,
    });
    mergedById[groupId] = mergedCatalog[mergedCatalog.length - 1];

    groupToRoutes[groupId] = memberRouteIds;
    routes.forEach((route) => {
      const routeId = normalizeRouteId(route.route_id);
      if (routeId) {
        routeToGroup[routeId] = groupId;
      }
    });
  }

  const routeFeaturesByRouteId = {};
  for (const feature of state.rawRoutes.features || []) {
    const rid = normalizeRouteId(feature?.properties?.route_id);
    if (rid) {
      routeFeaturesByRouteId[rid] = feature;
    }
  }

  // Fallback: some GTFS feeds have no shapes/routes line geometry.
  // In that case, use stop-connection geometries as route geometry source.
  for (const feature of state.rawStopConnections.features || []) {
    const rid = normalizeRouteId(feature?.properties?.route_id);
    if (rid && !routeFeaturesByRouteId[rid]) {
      routeFeaturesByRouteId[rid] = {
        type: "Feature",
        geometry: deepClone(feature.geometry),
        properties: {
          ...(feature.properties || {}),
          route_id: rid,
        },
      };
    }
  }

  const mergedRouteFeatures = [];
  for (const mergedItem of mergedCatalog) {
    const memberRouteIds = mergedItem.member_route_ids || [];
    const memberFeatures = memberRouteIds.map((rid) => routeFeaturesByRouteId[normalizeRouteId(rid)]).filter(Boolean);
    if (memberFeatures.length === 0) {
      continue;
    }

    const baseFeature = deepClone(memberFeatures[0]);
    let geometry = baseFeature.geometry;

    if (memberFeatures.length >= 2) {
      const lineA = pickLongestLine(memberFeatures[0].geometry);
      const lineB = pickLongestLine(memberFeatures[1].geometry);
      const centerLine = buildCenterLine(lineA, lineB);
      if (centerLine.length >= 2) {
        geometry = { type: "LineString", coordinates: centerLine };
      }
    }

    mergedRouteFeatures.push({
      type: "Feature",
      geometry,
      properties: {
        ...baseFeature.properties,
        route_id: mergedItem.route_id,
        route_color:
          routeFeaturesByRouteId[mergedItem.color_source_route_id]?.properties?.route_color || mergedItem.route_color,
        route_short_name: mergedItem.route_short_name,
        route_long_name: mergedItem.route_long_name,
        member_route_ids: memberRouteIds,
      },
    });
  }

  const mergedRoutes = { type: "FeatureCollection", features: mergedRouteFeatures };

  if (mergedRoutes.features.length === 0) {
    for (const mergedItem of mergedCatalog) {
      const memberRouteIds = mergedItem.member_route_ids || [];
      const firstFeature = memberRouteIds.map((rid) => routeFeaturesByRouteId[normalizeRouteId(rid)]).find(Boolean);
      if (!firstFeature) {
        continue;
      }
      mergedRoutes.features.push({
        type: "Feature",
        geometry: deepClone(firstFeature.geometry),
        properties: {
          ...firstFeature.properties,
          route_id: mergedItem.route_id,
          route_color:
            routeFeaturesByRouteId[mergedItem.color_source_route_id]?.properties?.route_color || mergedItem.route_color,
          route_short_name: mergedItem.route_short_name,
          route_long_name: mergedItem.route_long_name,
          member_route_ids: memberRouteIds,
        },
      });
    }
  }

  const connectionFeaturesByRouteId = {};
  for (const feature of state.rawStopConnections.features || []) {
    const rid = normalizeRouteId(feature?.properties?.route_id);
    if (rid) {
      connectionFeaturesByRouteId[rid] = feature;
    }
  }

  const mergedConnectionFeatures = [];
  for (const mergedItem of mergedCatalog) {
    const memberRouteIds = mergedItem.member_route_ids || [];
    const memberFeatures = memberRouteIds.map((rid) => connectionFeaturesByRouteId[normalizeRouteId(rid)]).filter(Boolean);
    if (memberFeatures.length === 0) {
      continue;
    }

    const baseFeature = deepClone(memberFeatures[0]);
    let geometry = baseFeature.geometry;
    if (memberFeatures.length >= 2) {
      const lineA = pickLongestLine(memberFeatures[0].geometry);
      const lineB = pickLongestLine(memberFeatures[1].geometry);
      const centerLine = buildCenterLine(lineA, lineB);
      if (centerLine.length >= 2) {
        geometry = { type: "LineString", coordinates: centerLine };
      }
    }

    mergedConnectionFeatures.push({
      type: "Feature",
      geometry,
      properties: {
        ...baseFeature.properties,
        route_id: mergedItem.route_id,
        route_color:
          routeFeaturesByRouteId[mergedItem.color_source_route_id]?.properties?.route_color || mergedItem.route_color,
        member_route_ids: memberRouteIds,
      },
    });
  }

  const mergedConnections = { type: "FeatureCollection", features: mergedConnectionFeatures };

  state.routes = mergedRoutes;
  state.routeCatalog = mergedCatalog;
  state.stopConnections = mergedConnections;
  state.routeToGroup = routeToGroup;
  state.groupToRoutes = groupToRoutes;
}

function rebuildVisibleRouteIds() {
  const availableRouteIds = new Set(state.routeCatalog.map((route) => route.route_id));
  if (state.visibleRouteIds.size === 0) {
    state.routeCatalog.forEach((route) => state.visibleRouteIds.add(route.route_id));
    return;
  }

  const nextVisible = new Set();
  for (const routeId of state.visibleRouteIds) {
    if (availableRouteIds.has(routeId)) {
      nextVisible.add(routeId);
    }
  }

  if (nextVisible.size === 0) {
    state.routeCatalog.forEach((route) => nextVisible.add(route.route_id));
  }
  state.visibleRouteIds = nextVisible;
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
    map.addLayer({
      id: "routes-line-hit",
      type: "line",
      source: "routes",
      paint: {
        "line-color": "#000000",
        "line-width": 8,
        "line-opacity": 0,
      },
      filter: ["in", ["get", "route_id"], ["literal", Array.from(state.visibleRouteIds)]],
    }, "routes-line");
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
    map.addLayer({
      id: "stop-connections-line-hit",
      type: "line",
      source: "stop-connections",
      paint: {
        "line-color": "#000000",
        "line-width": 7,
        "line-opacity": 0,
      },
      layout: { visibility: state.showStopConnections ? "visible" : "none" },
    }, "stop-connections-line");
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
  if (map.getLayer("routes-line-hit")) {
    map.setFilter("routes-line-hit", ["in", ["get", "route_id"], ["literal", Array.from(state.visibleRouteIds)]]);
  }
  if (map.getLayer("stop-connections-line")) {
    map.setFilter("stop-connections-line", ["in", ["get", "route_id"], ["literal", Array.from(state.visibleRouteIds)]]);
  }
  if (map.getLayer("stop-connections-line-hit")) {
    map.setFilter("stop-connections-line-hit", ["in", ["get", "route_id"], ["literal", Array.from(state.visibleRouteIds)]]);
  }
  updateDebugOverlay();
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

function getRouteDisplayName(routeId) {
  if (!routeId) return "不明路線";
  const route = state.routeCatalog.find((item) => item.route_id === routeId);
  if (!route) return routeId;
  const name = `${route.route_short_name || ""} ${route.route_long_name || ""}`.trim();
  return name || routeId;
}

async function reloadAllData() {
  const [routes, routeCatalog, stops, stopConnections, vehiclesPayload] = await Promise.all([
    api("/routes"),
    api("/route_catalog"),
    api("/stops"),
    api("/stop_connections"),
    api("/vehicles"),
  ]);

  state.rawRoutes = routes;
  state.rawRouteCatalog = routeCatalog;
  state.stops = stops;
  state.rawStopConnections = stopConnections;
  state.vehicles = vehiclesPayload.vehicles;

  normalizeRouteDatasets();
  rebuildVisibleRouteIds();
  applyMergeModeVisualPolicy();

  if (state.visibleRouteIds.size === 0) {
    state.routeCatalog.forEach((r) => state.visibleRouteIds.add(r.route_id));
  }

  createLayersIfNeeded();
  refreshOverlayLayers();
  renderRouteList();
  updateDebugOverlay();
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
  mapStyleSelect.value = state.baseMapStyle;
  mergeRoundTripToggle.checked = state.mergeRoundTrip;
  mergeColorSideSelect.value = state.mergeColorSide;
  mergeColorSideSelect.disabled = !state.mergeRoundTrip;

  mapStyleSelect.addEventListener("change", (event) => {
    switchBaseMapStyle(event.target.value);
  });

  mergeRoundTripToggle.addEventListener("change", () => {
    state.mergeRoundTrip = mergeRoundTripToggle.checked;
    mergeColorSideSelect.disabled = !state.mergeRoundTrip;
    normalizeRouteDatasets();
    rebuildVisibleRouteIds();
    applyMergeModeVisualPolicy();
    refreshOverlayLayers();
    renderRouteList();
    saveUiState();
  });

  mergeColorSideSelect.addEventListener("change", () => {
    state.mergeColorSide = mergeColorSideSelect.value;
    if (state.mergeRoundTrip) {
      normalizeRouteDatasets();
      rebuildVisibleRouteIds();
      refreshOverlayLayers();
      renderRouteList();
    }
    saveUiState();
  });

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
    if (state.mergeRoundTrip) {
      return;
    }
    state.showStopConnections = !state.showStopConnections;
    map.setLayoutProperty(
      "stop-connections-line",
      "visibility",
      state.showStopConnections ? "visible" : "none",
    );
    if (map.getLayer("stop-connections-line-hit")) {
      map.setLayoutProperty(
        "stop-connections-line-hit",
        "visibility",
        state.showStopConnections ? "visible" : "none",
      );
    }
    saveUiState();
  });

  document.getElementById("exportPngBtn").addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = map.getCanvas().toDataURL("image/png");
    link.download = `linemap-${Date.now()}.png`;
    link.click();
  });

  map.on("click", "routes-line-hit", (e) => {
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

  map.on("click", "stop-connections-line-hit", (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties || {};
    const routeName = getRouteDisplayName(p.route_id);
    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(
        `<b>停留所連結線</b><br/>路線名: ${routeName}<br/>route_id: ${p.route_id || ""}<br/>trip_id: ${p.trip_id || ""}`,
      )
      .addTo(map);
  });

  map.on("moveend", saveMapView);
}

map.on("load", async () => {
  ensureDebugOverlay();
  refreshOverlayLayers();
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
