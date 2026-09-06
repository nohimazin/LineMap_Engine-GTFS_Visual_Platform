const savedView = JSON.parse(localStorage.getItem("linemap:view") || "null");
const savedState = JSON.parse(localStorage.getItem("linemap:state") || "{}");
const UI_BUILD_VERSION = "2026-05-02-display-settings-v1";
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
  return BASEMAP_STYLES.bright;
}

async function retryRtConnection() {
  const url = document.getElementById("rtUrlInput").value.trim();
  const interval = Number(document.getElementById("rtIntervalInput").value || "10");

  try {
    setRtStatus("再接続を試行しています...", "neutral");
    // 再設定を投げてサービス側で再接続を促す
    await api("/settings/gtfs_rt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gtfs_rt_url: url || null, interval_sec: interval }),
    });

    // 現在の状態を即座に取得して反映
    const payload = await api("/vehicles");
    renderRtStatus(payload.status);
  } catch (err) {
    setRtStatus(`再接続失敗: ${err.message}`, "error");
    if (rtErrorDetails) rtErrorDetails.textContent = String(err.message || "");
  }
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
  stopConnectionsLineWidth: savedState.stopConnectionsLineWidth ?? 2.5,
  baseMapStyle: initialStyle,
};

const routeList = document.getElementById("routeList");
const routeSearchInput = document.getElementById("routeSearchInput");
const stopSearchInput = document.getElementById("stopSearchInput");
const stopSearchList = document.getElementById("stopSearchList");
const uploadResult = document.getElementById("uploadResult");
const gtfsLoadProgressWrap = document.getElementById("gtfsLoadProgressWrap");
const gtfsLoadProgressBar = document.getElementById("gtfsLoadProgressBar");
const gtfsLoadProgressText = document.getElementById("gtfsLoadProgressText");
const rtStatus = document.getElementById("rtStatus");
const rtErrorDetails = document.getElementById("rtErrorDetails");
const gtfsSelect = document.getElementById("gtfsSelect");
const gtfsSelectResult = document.getElementById("gtfsSelectResult");
const appVersion = document.getElementById("appVersion");
const mapStyleSelect = document.getElementById("mapStyleSelect");
const mergeRoundTripToggle = document.getElementById("mergeRoundTripToggle");
const mergeColorSideSelect = document.getElementById("mergeColorSideSelect");
const stopConnectionsWidthRange = document.getElementById("stopConnectionsWidthRange");
const stopConnectionsWidthInput = document.getElementById("stopConnectionsWidthInput");
const toggleStopsBtn = document.getElementById("toggleStopsBtn");
const toggleVehiclesBtn = document.getElementById("toggleVehiclesBtn");
const toggleStopConnectionsBtn = document.getElementById("toggleStopConnectionsBtn");
let debugOverlay = null;

if (appVersion) {
  appVersion.textContent = `Version: ${UI_BUILD_VERSION}`;
}

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
    `uiVersion: ${UI_BUILD_VERSION}`,
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

function formatRtLastUpdate(lastUpdateUnix) {
  if (!lastUpdateUnix) {
    return "未取得";
  }

  const date = new Date(lastUpdateUnix * 1000);
  if (Number.isNaN(date.getTime())) {
    return "未取得";
  }

  return date.toLocaleString("ja-JP", { hour12: false });
}

function formatRtErrorHistory(status) {
  const history = Array.isArray(status?.error_history) ? status.error_history : [];
  if (!history.length) {
    return "";
  }

  return history
    .map((entry) => {
      const when = formatRtLastUpdate(entry?.unix);
      const httpStatus = entry?.http_status ? `HTTP ${entry.http_status}` : "HTTP status不明";
      const retryCount = entry?.retry_count ?? "?";
      return `${when} | ${httpStatus} | retry ${retryCount}\n${entry?.message ?? ""}`;
    })
    .join("\n\n");
}

function setRtStatus(message, kind = "neutral") {
  if (!rtStatus) {
    return;
  }

  rtStatus.textContent = message;
  rtStatus.dataset.state = kind;
}

function setGtfsLoadProgress(percent, message, detail = "") {
  if (!gtfsLoadProgressWrap || !gtfsLoadProgressBar || !gtfsLoadProgressText) {
    return;
  }

  const clampedPercent = Math.max(0, Math.min(100, percent));
  gtfsLoadProgressWrap.classList.remove("is-hidden");
  gtfsLoadProgressBar.style.width = `${clampedPercent}%`;
  gtfsLoadProgressText.textContent = detail ? `${message} ${detail}` : message;
}

function renderRtStatus(status) {
  if (status?.last_error) {
    const retryText = status?.consecutive_error_count ? ` / 連続失敗 ${status.consecutive_error_count}回` : "";
    const httpText = status?.last_http_status ? ` / HTTP ${status.last_http_status}` : "";
    setRtStatus(`RT Error: ${status.last_error}${retryText}${httpText}`, "error");
    if (rtErrorDetails) {
      rtErrorDetails.textContent = formatRtErrorHistory(status) || String(status.last_error || "");
    }
    return;
  }

  const lastUpdateText = formatRtLastUpdate(status?.last_update_unix);
  const lastSuccessText = formatRtLastUpdate(status?.last_success_unix);
  const intervalText = status?.interval_sec ? `${status.interval_sec}秒間隔` : "間隔未設定";
  const urlText = status?.url ? "接続設定あり" : "未設定";
  const retryText = status?.consecutive_error_count ? ` / 連続失敗 ${status.consecutive_error_count}回` : "";
  const httpText = status?.last_http_status ? ` / HTTP ${status.last_http_status}` : "";
  setRtStatus(`RT更新: ${lastUpdateText} / 成功: ${lastSuccessText} / ${intervalText} / ${urlText}${retryText}${httpText}`, status?.url ? "ok" : "neutral");
  if (rtErrorDetails) rtErrorDetails.textContent = formatRtErrorHistory(status);
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
      stopConnectionsLineWidth: state.stopConnectionsLineWidth,
      baseMapStyle: state.baseMapStyle,
    }),
  );
}

function clampStopConnectionsLineWidth(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 2.5;
  }
  return Math.max(1, Math.min(20, numericValue));
}

function formatStopConnectionsLineWidth(value) {
  return Number(value).toFixed(1);
}

function syncStopConnectionsWidthControls() {
  if (stopConnectionsWidthRange) {
    stopConnectionsWidthRange.value = String(state.stopConnectionsLineWidth);
  }
  if (stopConnectionsWidthInput) {
    stopConnectionsWidthInput.value = formatStopConnectionsLineWidth(state.stopConnectionsLineWidth);
  }
}

function applyStopConnectionsLineWidth() {
  if (map.getLayer("stop-connections-line")) {
    map.setPaintProperty("stop-connections-line", "line-width", state.stopConnectionsLineWidth);
  }
  if (map.getLayer("stop-connections-line-hit")) {
    map.setPaintProperty("stop-connections-line-hit", "line-width", Math.max(10, state.stopConnectionsLineWidth + 7));
  }
}

function createVehicleArrowIcon() {
  /**
   * 車両用の矢印アイコンを生成する
   * 返り値: ImageData形式で、map.addImage()で登録可能
   */
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  
  // 背景を透明に
  ctx.clearRect(0, 0, size, size);
  
  // 矢印を描画（上向き）
  ctx.fillStyle = '#dd5c23';
  ctx.strokeStyle = '#fff4de';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  
  // 矢印の三角形
  const arrowPoints = [
    [size / 2, 4],        // 先端
    [size - 6, size - 4], // 右下
    [size / 2, size - 10], // 中点
    [6, size - 4],        // 左下
  ];
  
  ctx.beginPath();
  ctx.moveTo(arrowPoints[0][0], arrowPoints[0][1]);
  ctx.lineTo(arrowPoints[1][0], arrowPoints[1][1]);
  ctx.lineTo(arrowPoints[2][0], arrowPoints[2][1]);
  ctx.lineTo(arrowPoints[3][0], arrowPoints[3][1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // 白いハイライト（中央）
  ctx.fillStyle = 'rgba(255, 244, 222, 0.6)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2 + 2, 3, 0, Math.PI * 2);
  ctx.fill();
  
  return ctx.getImageData(0, 0, size, size);
}


function applyRouteLineWidth() {
  const routeLineWidth = state.mergeRoundTrip ? state.stopConnectionsLineWidth : 3;
  if (map.getLayer("routes-line")) {
    map.setPaintProperty("routes-line", "line-width", routeLineWidth);
  }
}

function syncSourcesData() {
  map.getSource("routes")?.setData(state.routes);
  map.getSource("stops")?.setData(state.stops);
  map.getSource("stop-connections")?.setData(state.stopConnections);
  map.getSource("vehicles")?.setData(state.vehicles);
}

function applyLayerVisibility() {
  const stopConnectionsVisible = state.showStopConnections && !state.mergeRoundTrip;
  if (map.getLayer("stops-circle")) {
    map.setLayoutProperty("stops-circle", "visibility", state.showStops ? "visible" : "none");
  }
  if (map.getLayer("stop-connections-line")) {
    map.setLayoutProperty("stop-connections-line", "visibility", stopConnectionsVisible ? "visible" : "none");
  }
  if (map.getLayer("stop-connections-line-hit")) {
    map.setLayoutProperty("stop-connections-line-hit", "visibility", stopConnectionsVisible ? "visible" : "none");
  }
  if (map.getLayer("vehicles-symbol")) {
    map.setLayoutProperty("vehicles-symbol", "visibility", state.showVehicles ? "visible" : "none");
  }
    console.log("[applyLayerVisibility]", { showStops: state.showStops, showVehicles: state.showVehicles, showStopConnections: state.showStopConnections, mergeRoundTrip: state.mergeRoundTrip, stopConnectionsVisible });
    updateDebugOverlay();
}

function syncDisplayControls() {
  if (toggleStopsBtn) {
    toggleStopsBtn.textContent = state.showStops ? "停留所 ON" : "停留所 OFF";
  }
  if (toggleVehiclesBtn) {
    toggleVehiclesBtn.textContent = state.showVehicles ? "車両 ON" : "車両 OFF";
  }
  if (toggleStopConnectionsBtn) {
    toggleStopConnectionsBtn.disabled = state.mergeRoundTrip;
    toggleStopConnectionsBtn.textContent = state.mergeRoundTrip
      ? "停留所連結線（統合表示中は非表示）"
      : state.showStopConnections
        ? "停留所連結線 ON"
        : "停留所連結線 OFF";
  }
}

function applyDisplaySettings() {
  applyMergeModeVisualPolicy();
  updateRouteFilter();
  applyLayerVisibility();
  applyStopConnectionsLineWidth();
  syncDisplayControls();
}

function refreshOverlayLayers() {
  // 矢印アイコンをマップに登録（既に登録されていないか確認）
  if (!map.hasImage('vehicle-arrow')) {
    const arrowImageData = createVehicleArrowIcon();
    if (arrowImageData) {
      map.addImage('vehicle-arrow', arrowImageData, { sdf: false });
    }
  }
  
  createLayersIfNeeded();
  syncSourcesData();
  applyDisplaySettings();
}

function applyMergeModeVisualPolicy() {
  if (state.mergeRoundTrip) {
    if (map.getLayer("routes-line")) {
      map.setLayoutProperty("routes-line", "visibility", "visible");
    }
    if (map.getLayer("routes-line-hit")) {
      map.setLayoutProperty("routes-line-hit", "visibility", "visible");
    }
  } else {
    if (map.getLayer("routes-line")) {
      map.setLayoutProperty("routes-line", "visibility", "visible");
    }
    if (map.getLayer("routes-line-hit")) {
      map.setLayoutProperty("routes-line-hit", "visibility", "visible");
    }
  }

  applyRouteLineWidth();
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
        "line-width": state.mergeRoundTrip ? state.stopConnectionsLineWidth : 3,
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
        "line-width": state.stopConnectionsLineWidth,
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
        "line-width": Math.max(10, state.stopConnectionsLineWidth + 7),
        "line-opacity": 0,
      },
      layout: { visibility: state.showStopConnections ? "visible" : "none" },
    }, "stop-connections-line");
  }

  if (!map.getSource("vehicles")) {
    map.addSource("vehicles", { type: "geojson", data: state.vehicles });
    map.addLayer({
      id: "vehicles-symbol",
      type: "symbol",
      source: "vehicles",
      layout: {
        "icon-image": "vehicle-arrow",
        "icon-size": 1.2,
        "icon-rotate": ["coalesce", ["get", "bearing"], 0],
        "icon-allow-overlap": true,
        "text-field": ["get", "vehicle_id"],
        "text-font": ["Open Sans Regular"],
        "text-size": 9,
        "text-offset": [0, 1.8],
        "text-anchor": "top",
        visibility: state.showVehicles ? "visible" : "none",
      },
      paint: {
        "text-color": "#333",
        "text-halo-color": "#fff",
        "text-halo-width": 0.8,
      },
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

function normalizeDisplayText(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower === "null" || lower === "none" || lower === "nan" || text === "-") {
    return "";
  }
  return text;
}

function buildStopPopupHtml(properties) {
  const stopName = normalizeDisplayText(properties?.stop_name);
  const stopCode = normalizeDisplayText(properties?.stop_code);
  const stopId = normalizeDisplayText(properties?.stop_id);
  const parentStation = normalizeDisplayText(properties?.parent_station);
  const title = stopName || stopCode || `バス停 ${stopId || "不明"}`;
  const routes = Array.isArray(properties?.routes) ? properties.routes.filter(Boolean) : [];
  const times = Array.isArray(properties?.times) ? properties.times.filter(Boolean) : [];

  const lines = [`<b>バス停名: ${title} (stop_id: ${stopId || "不明"})</b>`, `stop_id: ${stopId}`];
  if (stopCode) {
    lines.push(`標柱コード: ${stopCode}`);
  }
  if (parentStation) {
    lines.push(`親停留所: ${parentStation}`);
  }
  if (routes.length > 0) {
    lines.push(`通過路線: ${routes.slice(0, 5).join(", ")}`);
  }
  if (times.length > 0) {
    lines.push(`時刻(簡易): ${times.slice(0, 5).join(", ")}`);
  }
  return lines.join("<br/>");
}

function buildStopPopupText(properties) {
  const stopName = normalizeDisplayText(properties?.stop_name);
  const stopCode = normalizeDisplayText(properties?.stop_code);
  const stopId = normalizeDisplayText(properties?.stop_id);
  const parentStation = normalizeDisplayText(properties?.parent_station);
  const title = stopName || stopCode || `バス停 ${stopId || "不明"}`;
  const routes = Array.isArray(properties?.routes) ? properties.routes.filter(Boolean) : [];
  const times = Array.isArray(properties?.times) ? properties.times.filter(Boolean) : [];

  const lines = [`バス停名: ${title} (stop_id: ${stopId || "不明"})`, `stop_id: ${stopId}`];
  if (stopCode) {
    lines.push(`標柱コード: ${stopCode}`);
  }
  if (parentStation) {
    lines.push(`親停留所: ${parentStation}`);
  }
  if (routes.length > 0) {
    lines.push(`通過路線: ${routes.slice(0, 5).join(", ")}`);
  }
  if (times.length > 0) {
    lines.push(`時刻(簡易): ${times.slice(0, 5).join(", ")}`);
  }
  return lines.join("\n");
}

function resolveStopPropertiesById(stopId, fallbackProperties) {
  const normalizedStopId = normalizeDisplayText(stopId);
  if (!normalizedStopId) {
    return fallbackProperties || {};
  }

  const matchedFeature = (state.stops.features || []).find(
    (feature) => normalizeDisplayText(feature?.properties?.stop_id) === normalizedStopId,
  );
  return {
    ...(fallbackProperties || {}),
    ...(matchedFeature?.properties || {}),
  };
}

async function resolveStopPropertiesWithApiFallback(stopId, fallbackProperties) {
  const resolved = resolveStopPropertiesById(stopId, fallbackProperties);
  const hasName = normalizeDisplayText(resolved?.stop_name);
  if (hasName) {
    return resolved;
  }

  try {
    const stopsPayload = await api("/stops");
    const fallbackFeature = (stopsPayload?.features || []).find(
      (feature) => normalizeDisplayText(feature?.properties?.stop_id) === normalizeDisplayText(stopId),
    );
    if (fallbackFeature?.properties) {
      return {
        ...(fallbackProperties || {}),
        ...fallbackFeature.properties,
      };
    }
  } catch (err) {
    console.warn("停留所情報の再取得に失敗しました", err);
  }

  return resolved;
}

function performStopSearch(query) {
  if (!query.trim()) {
    return [];
  }
  const normalizedQuery = normalizeDisplayText(query);
  return (state.stops.features || [])
    .filter((feature) => {
      const stopName = normalizeDisplayText(feature?.properties?.stop_name || "");
      return stopName.includes(normalizedQuery);
    })
    .slice(0, 30);
}

function renderStopSearchResults(results) {
  stopSearchList.innerHTML = "";
  if (results.length === 0) {
    const noResults = document.createElement("div");
    noResults.className = "hint";
    noResults.style.padding = "6px 8px";
    noResults.textContent = "検索結果なし";
    stopSearchList.appendChild(noResults);
    return;
  }

  results.forEach((feature) => {
    const item = document.createElement("div");
    item.className = "stop-search-item";
    const stopName = feature?.properties?.stop_name || feature?.properties?.stop_id || "不明";
    const routeCount = (feature?.properties?.routes || []).length;
    item.textContent = `${stopName}${routeCount > 0 ? ` (路線: ${routeCount})` : ""}`;
    item.addEventListener("click", () => {
      zoomToStop(feature.geometry.coordinates);
    });
    stopSearchList.appendChild(item);
  });

  if (results.length >= 30) {
    const more = document.createElement("div");
    more.className = "hint";
    more.style.padding = "6px 8px";
    more.textContent = "他にも多数あります...";
    stopSearchList.appendChild(more);
  }
}

function zoomToStop(coordinates) {
  map.easeTo({
    center: [coordinates[0], coordinates[1]],
    zoom: 15,
    duration: 800,
  });
}

async function refreshGtfsList() {
  try {
    const response = await api("/gtfs_list");
    const gtfsList = response.gtfs_list || [];

    gtfsSelect.innerHTML = "";
    gtfsList.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.gtfs_id;
      option.textContent = `${item.gtfs_id} (路線: ${item.route_count}, 停留所: ${item.stop_count})`;
      option.selected = item.is_current;
      gtfsSelect.appendChild(option);
    });

    if (gtfsList.length > 0) {
      const current = gtfsList.find((item) => item.is_current);
      if (current) {
        gtfsSelectResult.textContent = `現在: ${current.gtfs_id} (路線: ${current.route_count}, 停留所: ${current.stop_count})`;
      }
    }
  } catch (err) {
    console.warn("GTFS一覧の取得に失敗しました", err);
    gtfsSelectResult.textContent = `読み込みエラー: ${err.message}`;
  }
}

async function selectGtfs(gtfsId) {
  try {
    gtfsSelectResult.textContent = "切り替え中...";
    const response = await api(`/gtfs/select?gtfs_id=${encodeURIComponent(gtfsId)}`, {
      method: "POST",
    });

    gtfsSelectResult.textContent = `✓ 切り替え完了: ${gtfsId}`;
    await reloadAllData();
  } catch (err) {
    gtfsSelectResult.textContent = `✗ 切り替え失敗: ${err.message}`;
    console.error("GTFS選択に失敗しました", err);
  }
}

async function reloadAllData() {
  setGtfsLoadProgress(10, "GTFSデータを読み込み中...", "路線情報を取得しています");
  const routes = await api("/routes");
  setGtfsLoadProgress(30, "GTFSデータを読み込み中...", "路線カタログを取得しています");
  const routeCatalog = await api("/route_catalog");
  setGtfsLoadProgress(50, "GTFSデータを読み込み中...", "停留所情報を取得しています");
  const stops = await api("/stops");
  setGtfsLoadProgress(70, "GTFSデータを読み込み中...", "停留所連結線を取得しています");
  const stopConnections = await api("/stop_connections");
  setGtfsLoadProgress(90, "GTFSデータを読み込み中...", "車両情報を取得しています");
  const vehiclesPayload = await api("/vehicles");

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
  applyDisplaySettings();
  updateDebugOverlay();
  renderRtStatus(vehiclesPayload.status);
  setGtfsLoadProgress(100, "GTFSデータの読み込みが完了しました。");
}

function uploadGtfsWithProgress(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/upload");
    xhr.responseType = "json";

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        setGtfsLoadProgress(20, "GTFSファイルを送信中...", "進捗を計算しています");
        return;
      }

      const uploadPercent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      setGtfsLoadProgress(Math.min(60, Math.max(5, uploadPercent * 0.6)), "GTFSファイルを送信中...", `${uploadPercent}%`);
    };

    xhr.onload = () => {
      const responseBody = xhr.response ?? (() => {
        try {
          return JSON.parse(xhr.responseText || "null");
        } catch (error) {
          return null;
        }
      })();

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(responseBody);
        return;
      }

      const detail = responseBody?.detail || xhr.responseText || "GTFSアップロードに失敗しました。";
      reject(new Error(`${xhr.status} ${detail}`));
    };

    xhr.onerror = () => reject(new Error("GTFSアップロード中に通信エラーが発生しました。"));
    xhr.send(formData);
  });
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
    setGtfsLoadProgress(5, "GTFSアップロードを開始しています...");
    const result = await uploadGtfsWithProgress(formData);
    setGtfsLoadProgress(70, "GTFSをサーバーで読み込み中...");
    uploadResult.textContent = `${result.message} routes=${result.routes}, stops=${result.stops}`;
    await reloadAllData();
    await refreshGtfsList();
  } catch (err) {
    uploadResult.textContent = `失敗: ${err.message}`;
    setGtfsLoadProgress(100, "GTFSの読み込みに失敗しました。", String(err.message || ""));
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
    renderRtStatus(result.status);
  } catch (err) {
    setRtStatus(`保存失敗: ${err.message}`, "error");
  }
}

function wireActions() {
  document.getElementById("uploadBtn").addEventListener("click", uploadGtfs);
  document.getElementById("rtSaveBtn").addEventListener("click", saveRtConfig);
  const rtRetryBtn = document.getElementById("rtRetryBtn");
  if (rtRetryBtn) rtRetryBtn.addEventListener("click", retryRtConnection);

  if (gtfsSelect) {
    gtfsSelect.addEventListener("change", async (event) => {
      await selectGtfs(event.target.value);
    });
  }

  if (stopSearchInput) {
    stopSearchInput.addEventListener("input", (event) => {
      const query = event.target.value;
      const results = performStopSearch(query);
      renderStopSearchResults(results);
    });
  }

  mapStyleSelect.value = state.baseMapStyle;
  mergeRoundTripToggle.checked = state.mergeRoundTrip;
  mergeColorSideSelect.value = state.mergeColorSide;
  mergeColorSideSelect.disabled = !state.mergeRoundTrip;
  syncStopConnectionsWidthControls();

  mapStyleSelect.addEventListener("change", (event) => {
    switchBaseMapStyle(event.target.value);
  });

  mergeRoundTripToggle.addEventListener("change", () => {
    state.mergeRoundTrip = mergeRoundTripToggle.checked;
    mergeColorSideSelect.disabled = !state.mergeRoundTrip;
    normalizeRouteDatasets();
    rebuildVisibleRouteIds();
    applyDisplaySettings();
    refreshOverlayLayers();
    renderRouteList();
    saveUiState();
  });

  mergeColorSideSelect.addEventListener("change", () => {
    state.mergeColorSide = mergeColorSideSelect.value;
    if (state.mergeRoundTrip) {
      normalizeRouteDatasets();
      rebuildVisibleRouteIds();
      applyDisplaySettings();
      refreshOverlayLayers();
      renderRouteList();
    }
    saveUiState();
  });

  function updateStopConnectionsWidth(value) {
    state.stopConnectionsLineWidth = clampStopConnectionsLineWidth(value);
    syncStopConnectionsWidthControls();
    applyStopConnectionsLineWidth();
    applyRouteLineWidth();
    saveUiState();
  }

  stopConnectionsWidthRange?.addEventListener("input", (event) => {
    updateStopConnectionsWidth(event.target.value);
  });

  stopConnectionsWidthInput?.addEventListener("change", (event) => {
    updateStopConnectionsWidth(event.target.value);
  });

  routeSearchInput.addEventListener("input", renderRouteList);

  document.getElementById("toggleStopsBtn").addEventListener("click", () => {
    state.showStops = !state.showStops;
    applyDisplaySettings();
    saveUiState();
  });

  document.getElementById("toggleVehiclesBtn").addEventListener("click", () => {
    state.showVehicles = !state.showVehicles;
    applyDisplaySettings();
    saveUiState();
  });

  document.getElementById("toggleStopConnectionsBtn").addEventListener("click", () => {
    state.showStopConnections = !state.showStopConnections;
    applyDisplaySettings();
    saveUiState();
  });

  document.getElementById("exportPngBtn").addEventListener("click", () => {
    const exportWithQuality = async () => {
      // デバッグオーバーレイを一時的に隠す
      const debugOverlay = document.querySelector('.debug-overlay');
      const wasVisible = debugOverlay && debugOverlay.style.display !== 'none';
      if (debugOverlay) {
        debugOverlay.style.display = 'none';
      }

      try {
        // キャンバスの寸法を取得
        const canvas = map.getCanvas();
        const originalWidth = canvas.width;
        const originalHeight = canvas.height;

        // レンダリングを完了させるまで待機
        await new Promise((resolve) => {
          const checkIdle = () => {
            if (map.isStyleLoaded() && map.areTilesLoaded?.()) {
              resolve();
            } else {
              setTimeout(checkIdle, 100);
            }
          };
          checkIdle();
        });

        // 現在の表示状態でスクリーンショット取得
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataUrl;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        link.download = `linemap-${timestamp}.png`;
        link.click();
      } finally {
        // デバッグオーバーレイを復元
        if (debugOverlay && wasVisible) {
          debugOverlay.style.display = '';
        }
      }
    };

    exportWithQuality();
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

  map.on("click", "stops-circle", async (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties || {};
    const resolved = await resolveStopPropertiesWithApiFallback(p.stop_id, p);
    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setText(buildStopPopupText(resolved))
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

  map.on("click", "vehicles-symbol", (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties || {};
    const vehicleId = normalizeDisplayText(p.vehicle_id) || "不明";
    const tripId = normalizeDisplayText(p.trip_id) || "不明";
    const routeName = getRouteDisplayName(p.route_id) || "不明";
    const bearing = p.bearing ? `${p.bearing.toFixed(1)}°` : "不明";
    const speed = p.speed ? `${p.speed.toFixed(1)} m/s` : "不明";
    const timestamp = p.timestamp ? new Date(p.timestamp * 1000).toLocaleTimeString('ja-JP') : "不明";
    
    const lines = [
      `<b>車両情報</b>`,
      `ID: ${vehicleId}`,
      `路線: ${routeName}`,
      `trip_id: ${tripId}`,
      `方位: ${bearing}`,
      `速度: ${speed}`,
      `更新時刻: ${timestamp}`,
    ];
    
    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(lines.join("<br/>"))
      .addTo(map);
  });

  map.on("moveend", saveMapView);
}

map.on("load", async () => {
  ensureDebugOverlay();
  refreshOverlayLayers();
  wireActions();
  rtStatus.textContent = "ベースマップを表示中...";
  setGtfsLoadProgress(5, "GTFSデータを読み込み中...", "初期化しています");

  try {
    await refreshGtfsList();
  } catch (err) {
    console.warn("GTFS一覧の初期取得に失敗しました", err);
  }

  map.once("idle", async () => {
    try {
      setRtStatus("GTFSデータを読み込み中...", "neutral");
      await reloadAllData();
      applyDisplaySettings();
    } catch (err) {
      setRtStatus(`初期読み込み失敗: ${err.message}`, "error");
    }
  });

  setInterval(async () => {
    try {
      const payload = await api("/vehicles");
      state.vehicles = payload.vehicles;
      map.getSource("vehicles")?.setData(state.vehicles);
      renderRtStatus(payload.status);
    } catch (err) {
      setRtStatus(`RT取得失敗: ${err.message}`, "error");
    }
  }, 10000);
});
