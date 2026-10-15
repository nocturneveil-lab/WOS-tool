// グリッド計算・マップの状態・描画・レイアウトの読み書き・PNG/SVG出力。
"use strict";

// ---- 設定の保存（ブラウザ） ----
var LABEL_SIZE_KEY = "alliance_map_label_size_v1";
var MAP_COLS_KEY = "alliance_map_cols_v1";
var MAP_ROWS_KEY = "alliance_map_rows_v1";
var BEAR_TRAP_LABEL_SIZE_KEY = "alliance_map_bear_trap_label_size_v1";
var OBJECT_COLOR_KEY = "alliance_map_object_colors_v1";
var CELL_KEY_PATTERN = /^-?\d+_-?\d+$/;
var COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
function parseInteger(value){ return parseInt(value, 10); }
function loadNumberSetting(key, fallback, minValue, maxValue, parse){
  try{
    var saved = parse(localStorage.getItem(key));
    if (!isNaN(saved) && saved >= minValue && saved <= maxValue) return saved;
  }catch(e){ console.error("setting load failed", e); }
  return fallback;
}
function saveSetting(key, value){
  try{ localStorage.setItem(key, value); }
  catch(e){ console.error("setting save failed", e); }
}
function clampInteger(value, fallback, minValue, maxValue){
  var numeric = parseInt(value, 10);
  if (isNaN(numeric)) return fallback;
  return Math.max(minValue, Math.min(maxValue, numeric));
}

// MAPサイズ（マス数）。全体範囲は中心を基準に左右・上下に広がる。
var MAP_SIZE_DEFAULT = 32, MAP_SIZE_MIN = 10, MAP_SIZE_MAX = 80;
function clampMapSize(value){ return clampInteger(value, MAP_SIZE_DEFAULT, MAP_SIZE_MIN, MAP_SIZE_MAX); }
var mapCols = loadNumberSetting(MAP_COLS_KEY, MAP_SIZE_DEFAULT, MAP_SIZE_MIN, MAP_SIZE_MAX, parseInteger);
var mapRows = loadNumberSetting(MAP_ROWS_KEY, MAP_SIZE_DEFAULT, MAP_SIZE_MIN, MAP_SIZE_MAX, parseInteger);
function saveMapRange(){
  saveSetting(MAP_COLS_KEY, String(mapCols));
  saveSetting(MAP_ROWS_KEY, String(mapRows));
}
// 「文字サイズ」スライダーの値（熊罠以外の名前の文字サイズ）。
var LABEL_SCALE_MIN = 6, LABEL_SCALE_MAX = 12;
var labelScale = loadNumberSetting(LABEL_SIZE_KEY, 8, LABEL_SCALE_MIN, LABEL_SCALE_MAX, parseFloat);
// 熊罠の文字サイズは「文字サイズ」スライダーとは独立した固定値。
var DEFAULT_BEAR_TRAP_LABEL_SIZE = 12;
var BEAR_TRAP_LABEL_SIZE_MIN = 6, BEAR_TRAP_LABEL_SIZE_MAX = 30;
function clampBearTrapLabelSize(value, fallback){ return clampInteger(value, fallback, BEAR_TRAP_LABEL_SIZE_MIN, BEAR_TRAP_LABEL_SIZE_MAX); }
var bearTrapLabelSize = loadNumberSetting(BEAR_TRAP_LABEL_SIZE_KEY, DEFAULT_BEAR_TRAP_LABEL_SIZE, BEAR_TRAP_LABEL_SIZE_MIN, BEAR_TRAP_LABEL_SIZE_MAX, parseInteger);
function saveBearTrapLabelSize(){ saveSetting(BEAR_TRAP_LABEL_SIZE_KEY, String(bearTrapLabelSize)); }

// ---- グリッドと表示位置 ----
var panX = 0, panY = 0;
var zoom = 2.5;
// 表示上の100%にあたる実ズーム。公開用の初期配置を読み込んだときのズームを基準にする。
var zoomBase = 2.5;
function clampZoom(value){ return Math.max(0.25, Math.min(4, value)); }
var mapHeight;
var VIEW_W, VIEW_H, HW, HH, CX, CY;
var COORD_ORIGIN_CELL = { col: 10, row: -13 };
var COORD_ORIGIN_POINT = { x: 659, y: 389 };
function updateGridMetrics(){
  mapCols = clampMapSize(mapCols);
  mapRows = clampMapSize(mapRows);
  mapHeight = Math.max(1, window.innerHeight - document.querySelector(".map-controls").offsetHeight);
  var minDimension = Math.min(window.innerWidth, mapHeight);
  var gridSize = Math.max(1, Math.max(mapCols, mapRows));
  VIEW_W = 900 * window.innerWidth / minDimension;
  VIEW_H = 900 * mapHeight / minDimension;
  HW = HH = 900 / (2 * gridSize);
  CX = VIEW_W / 2;
  CY = VIEW_H / 2;
}
// 表示位置は「画面中央に映っている点がマップ中心から何マス分ずれているか」で扱う。
// panX/panY は画面サイズに依存するため、保存や画面サイズ変更ではこの値を使う。
function getViewCenter(){
  return {
    x: ((VIEW_W / 2 - panX) / zoom - CX) / HW,
    y: ((VIEW_H / 2 - panY) / zoom - CY) / HH
  };
}
function setViewCenter(center){
  panX = VIEW_W / 2 - (CX + center.x * HW) * zoom;
  panY = VIEW_H / 2 - (CY + center.y * HH) * zoom;
}
function centerMapView(){
  setViewCenter({ x: 0, y: 0 });
}
updateGridMetrics();
centerMapView();
window.addEventListener("resize", function(){
  var center = getViewCenter();
  updateGridMetrics();
  setViewCenter(center);
  render();
});

function toScreen(x, y){
  return {
    x: CX + (x - y) * HW,
    y: CY + (x + y) * HH
  };
}
function clientToSvg(clientX, clientY){
  var bounds = svg.getBoundingClientRect();
  return {
    x: (clientX - bounds.left) * VIEW_W / bounds.width,
    y: (clientY - bounds.top) * VIEW_H / bounds.height
  };
}
function cellKeyAtClientPoint(clientX, clientY){
  var point = clientToSvg(clientX, clientY);
  var worldX = (point.x - panX) / zoom;
  var worldY = (point.y - panY) / zoom;
  var dx = (worldX - CX) / HW;
  var dy = (worldY - CY) / HH;
  return Math.round((dx + dy) / 2) + "_" + Math.round((dy - dx) / 2);
}
// ゲーム内の座標（画面右下に表示する x/y）。
function getCoordFromKey(cellKey){
  var parts = cellKey.split("_");
  var cellCol = parseInt(parts[0], 10);
  var cellRow = parseInt(parts[1], 10);
  return {
    x: COORD_ORIGIN_POINT.x - (cellRow - COORD_ORIGIN_CELL.row),
    y: COORD_ORIGIN_POINT.y - (cellCol - COORD_ORIGIN_CELL.col)
  };
}

// ---- 多角形（SVG の points 文字列） ----
function formatPoints(points){
  return points.map(function(point){ return point.x.toFixed(1) + "," + point.y.toFixed(1); }).join(" ");
}
function parsePoints(points){
  return points.split(" ").map(function(point){
    var pair = point.split(",");
    return { x: parseFloat(pair[0]), y: parseFloat(pair[1]) };
  });
}
function polygonCenter(vertices){
  return vertices.reduce(function(total, point){
    total.x += point.x / vertices.length;
    total.y += point.y / vertices.length;
    return total;
  }, { x: 0, y: 0 });
}
// マス座標で (left, top) を角とする size×size の正方形を、画面上のひし形にする。
function squarePolygon(left, top, size){
  return formatPoints([
    toScreen(left, top),
    toScreen(left + size, top),
    toScreen(left + size, top + size),
    toScreen(left, top + size)
  ]);
}
function cellPolygon(col, row){
  return squarePolygon(col - 0.5, row - 0.5, 1);
}
function placementPolygon(placement){
  var anchor = placement.anchor.split("_");
  var size = PLACEMENT_SIZES[placement.type];
  var offset = 1 - size;
  return squarePolygon(parseInt(anchor[0], 10) + offset - 0.5, parseInt(anchor[1], 10) + offset - 0.5, size);
}
// 中心に向かって縮める（insetScale=1 でそのまま）。
function cellInsetPolygon(points, insetScale){
  var vertices = parsePoints(points);
  var center = polygonCenter(vertices);
  var inset = Math.max(0, 1 - insetScale);
  return vertices.map(function(point){
    return (center.x + (point.x - center.x) * (1 - inset)).toFixed(1) + "," +
      (center.y + (point.y - center.y) * (1 - inset)).toFixed(1);
  }).join(" ");
}

// ---- オブジェクトの種類 ----
var DEFAULT_TYPE_COLORS = { headquarters: "#ed817a", flag: "#f4d57b", city: "#82b8e8", bearTrap: "#8fcda0", allianceBuilding: "#7d96ff", largeGatheringSite: "#d5a783", unavailable: "#b8b8b8" };
function loadTypeColors(){
  var colors = Object.assign({}, DEFAULT_TYPE_COLORS);
  try{
    var parsed = JSON.parse(localStorage.getItem(OBJECT_COLOR_KEY) || "{}");
    Object.keys(DEFAULT_TYPE_COLORS).forEach(function(type){
      if (parsed && typeof parsed[type] === "string" && COLOR_PATTERN.test(parsed[type])) colors[type] = parsed[type].toLowerCase();
    });
  }catch(e){ console.error("object color load failed", e); }
  return colors;
}
function saveTypeColors(){ saveSetting(OBJECT_COLOR_KEY, JSON.stringify(TYPE_COLORS)); }
var TYPE_COLORS = loadTypeColors();
var TYPE_LABELS = { headquarters: "本部", flag: "旗", city: "都市", bearTrap: "熊罠", allianceBuilding: "同盟建築物", largeGatheringSite: "大型採集場", unavailable: "配置不能" };
var PLACEMENT_SIZES = { headquarters: 3, bearTrap: 3, city: 2, flag: 1, allianceBuilding: 2, largeGatheringSite: 3, unavailable: 1 };
// 都市・同盟建築物は名前必須。それ以外は空欄なら種類名（旗・配置不能は表示なし）に戻る。
function isNameRequired(type){
  return type === "city" || type === "allianceBuilding";
}
function getPlacementLabel(placement){
  if (placement.name) return placement.name;
  return placement.type === "flag" || placement.type === "unavailable" ? "" : TYPE_LABELS[placement.type];
}
// アンカー（右下のマス）から、オブジェクトが占めるマスの一覧を求める。
function getPlacementCells(type, anchorKey){
  var parts = anchorKey.split("_");
  var col = parseInt(parts[0], 10), row = parseInt(parts[1], 10);
  var size = PLACEMENT_SIZES[type];
  var offsets = Array.from({length:size}, function(_, index){ return index - size + 1; });
  var cells = [];
  offsets.forEach(function(colOffset){
    offsets.forEach(function(rowOffset){
      cells.push((col + colOffset) + "_" + (row + rowOffset));
    });
  });
  return cells;
}

// ---- マップの状態 ----
// 配置はWeb（cloud.js）から読み込み、ブラウザには保存しない。
// Webに接続できないときは default-layout.json を読み込む。
var classifications = {};
var placements = [];
var activeTool = "select";
var editMode = false;
// 選択中のオブジェクト。配列の入れ替え（ひとつ戻る・Webの更新）をまたいで追えるよう「種類|アンカー」で持つ。
var selectedKey = null;
function placementKey(placement){ return placement.type + "|" + placement.anchor; }
// そのマスにある一番上（配列の後ろ）のオブジェクト。
function findTopPlacementAt(cellKey){
  for (var layerIndex = placements.length - 1; layerIndex >= 0; layerIndex--){
    if (placements[layerIndex].cells.indexOf(cellKey) !== -1) return placements[layerIndex];
  }
  return null;
}
function getSelectedPlacement(){
  if (!selectedKey || !editMode) return null;
  for (var layerIndex = placements.length - 1; layerIndex >= 0; layerIndex--){
    if (placementKey(placements[layerIndex]) === selectedKey) return placements[layerIndex];
  }
  return null;
}

// ---- 変更の通知 ----
var hasUnsavedChanges = false;
var localChangeListeners = [];
// kind: "edit"（配置・移動・消去・名前変更）、"undo"、"reset"、"settings"、"file"
// previousLayout: マップを丸ごと置き換える操作（reset・file）のときだけ、変更前のレイアウトを渡す。
function emitLocalChange(kind, previousLayout){
  localChangeListeners.forEach(function(callback){
    try{ callback(kind, previousLayout); }catch(e){ console.error("local change listener failed", e); }
  });
}
function markLayoutChanged(kind, previousLayout){
  hasUnsavedChanges = true;
  emitLocalChange(kind || "edit", previousLayout);
}
// 離脱警告の判定。cloud.js が権限に応じた判定に差し替える。
var unloadGuard = function(){ return hasUnsavedChanges; };
window.addEventListener("beforeunload", function(event){
  if (!unloadGuard()) return;
  event.preventDefault();
  event.returnValue = "";
});

// ---- レイアウトの読み書き ----
// 「ファイルに保存」と同じ形式のレイアウト。Webへの保存にもこの形式を使う。
function getLayout(){
  return JSON.parse(JSON.stringify({
    format: "alliance-map-layout",
    version: 1,
    classifications: classifications,
    placements: placements,
    objectColors: TYPE_COLORS,
    bearTrapLabelSize: bearTrapLabelSize,
    view: { center: getViewCenter(), zoom: zoom, mapCols: mapCols, mapRows: mapRows }
  }));
}
function applyLayout(imported, options){
  if (!imported || imported.format !== "alliance-map-layout" || imported.version !== 1 ||
      !imported.classifications || typeof imported.classifications !== "object" || Array.isArray(imported.classifications) ||
      !Array.isArray(imported.placements) || imported.placements.length > 2000){
    throw new Error("未対応の保存ファイルです");
  }
  var nextClassifications = {};
  Object.keys(imported.classifications).forEach(function(key){
    var value = imported.classifications[key];
    if (!CELL_KEY_PATTERN.test(key) || (value !== "none" && !Object.prototype.hasOwnProperty.call(TYPE_COLORS, value))){
      throw new Error("セルデータが不正です");
    }
    nextClassifications[key] = value;
  });
  var nextPlacements = imported.placements.map(function(item){
    if (!item || !Object.prototype.hasOwnProperty.call(PLACEMENT_SIZES, item.type) ||
        typeof item.anchor !== "string" || !CELL_KEY_PATTERN.test(item.anchor)){
      throw new Error("配置データが不正です");
    }
    var placement = {
      type: item.type,
      anchor: item.anchor,
      anchorMode: "bottom-cell",
      cells: getPlacementCells(item.type, item.anchor)
    };
    if (isNameRequired(item.type) || item.name !== undefined){
      var trimmedName = typeof item.name === "string" ? item.name.trim() : "";
      if (typeof item.name !== "string" || trimmedName.length > 24 || (isNameRequired(item.type) && !trimmedName)){
        throw new Error("名称が不正です");
      }
      if (trimmedName) placement.name = trimmedName;
    }
    placement.cells.forEach(function(key){ nextClassifications[key] = placement.type; });
    return placement;
  });
  var nextTypeColors = Object.assign({}, TYPE_COLORS);
  if (imported.objectColors !== undefined){
    if (!imported.objectColors || typeof imported.objectColors !== "object" || Array.isArray(imported.objectColors)){
      throw new Error("色設定が不正です");
    }
    Object.keys(DEFAULT_TYPE_COLORS).forEach(function(type){
      var color = imported.objectColors[type];
      if (color !== undefined){
        if (typeof color !== "string" || !COLOR_PATTERN.test(color)) throw new Error("色設定が不正です");
        nextTypeColors[type] = color.toLowerCase();
      }
    });
  }
  var view = imported.view && typeof imported.view === "object" ? imported.view : {};
  var nextZoom = Number.isFinite(view.zoom) ? clampZoom(view.zoom) : zoomBase;
  // 表示位置は画面サイズに依存しない view.center（マス単位）で扱う。旧形式の panX/panY は使わない。
  var nextCenter = view.center && typeof view.center === "object" &&
    Number.isFinite(view.center.x) && Number.isFinite(view.center.y) ?
    { x: view.center.x, y: view.center.y } : { x: 0, y: 0 };
  var nextMapCols = Number.isInteger(view.mapCols) ? clampMapSize(view.mapCols) : mapCols;
  var nextMapRows = Number.isInteger(view.mapRows) ? clampMapSize(view.mapRows) : mapRows;
  var nextBearTrapLabelSize = Number.isInteger(imported.bearTrapLabelSize) ?
    clampBearTrapLabelSize(imported.bearTrapLabelSize, DEFAULT_BEAR_TRAP_LABEL_SIZE) : bearTrapLabelSize;
  // ここまでで検証を終え、以降だけで状態を書き換える（途中で例外が起きても状態が壊れないように）。
  // source: "file"（JSON読み込み）、"default"（default-layout.json）、"cloud-initial"（Webの初回）、
  // "cloud"（Webの更新・最新に戻す）、"preview"（履歴のプレビュー）。
  // 表示位置（view.center と zoom）は file/default/cloud-initial のときだけ適用し、
  // それ以外は今の表示位置を保つ。ひとつ戻るの対象になるのは file だけ。
  var source = options && options.source || "file";
  var applyView = source === "file" || source === "default" || source === "cloud-initial";
  var keepCenter = applyView ? nextCenter : getViewCenter();
  if (source === "file") rememberMapState();
  else clearUndoHistory();
  classifications = nextClassifications;
  placements = nextPlacements;
  TYPE_COLORS = nextTypeColors;
  bearTrapLabelSize = nextBearTrapLabelSize;
  if (applyView) zoom = nextZoom;
  if (source === "default" || source === "cloud-initial") zoomBase = zoom;
  mapCols = nextMapCols;
  mapRows = nextMapRows;
  refreshMapRangeInputs();
  updateZoomReadout();
  updateGridMetrics();
  setViewCenter(keepCenter);
  hasUnsavedChanges = false;
  saveMapRange();
  saveTypeColors();
  saveBearTrapLabelSize();
  refreshObjectColorInputs();
  updateMapToolColors();
  render();
}

// ---- 描画 ----
var svgns = "http://www.w3.org/2000/svg";
var svg = document.getElementById("mapSvg");
var mapWrap = document.querySelector(".map-wrap");
var gridLayer = null;
function el(tag, attrs){
  var e = document.createElementNS(svgns, tag);
  for (var k in attrs){ e.setAttribute(k, attrs[k]); }
  return e;
}
function labelStyle(fontSize){
  return "paint-order:stroke;stroke:#ffffff;stroke-width:" + (fontSize * 0.22) + "px;stroke-linejoin:round;";
}
function render(){
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute("viewBox", "0 0 " + VIEW_W + " " + VIEW_H);

  gridLayer = el("g", {transform: "translate(" + panX + " " + panY + ") scale(" + zoom + ")"});
  var colStart = -Math.floor(mapCols / 2);
  var colEnd = Math.ceil(mapCols / 2) - 1;
  var rowStart = -Math.floor(mapRows / 2);
  var rowEnd = Math.ceil(mapRows / 2) - 1;
  for (var col = colStart; col <= colEnd; col++){
    for (var row = rowStart; row <= rowEnd; row++){
      var key = col + "_" + row;
      var polygon = el("polygon", {
        points: cellPolygon(col, row),
        fill: "#ffffff",
        stroke: "none",
        class: "map-cell",
        "data-cell-key": key
      });
      (function(cellKey, cell){
        cell.addEventListener("click", function(event){
          handleCellClick(cellKey, event);
        });
      })(key, polygon);
      gridLayer.appendChild(polygon);
    }
  }
  var labelLayer = el("g", {class: "object-label-layer", "pointer-events": "none"});
  var selectedPlacement = getSelectedPlacement();
  if (!selectedPlacement) selectedKey = null;
  placements.forEach(function(placement, layerIndex){
    var footprint = placementPolygon(placement);
    var isSelected = placement === selectedPlacement;
    var objectLayer = el("g", {
      class: "object-layer" + (isSelected ? " selected" : ""),
      "data-layer-id": "layer-" + layerIndex + "-" + placement.type + "-" + placement.anchor,
      "data-object-type": placement.type,
      "data-anchor": placement.anchor,
      "data-name": getPlacementLabel(placement) || TYPE_LABELS[placement.type]
    });
    objectLayer.appendChild(el("polygon", {
      points: footprint,
      fill: "transparent",
      stroke: "none",
      "pointer-events": "all",
      class: "object-padding"
    }));
    var innerPaddingRatio = 0.18;
    objectLayer.appendChild(el("polygon", {
      points: cellInsetPolygon(footprint, 1 - innerPaddingRatio),
      fill: TYPE_COLORS[placement.type],
      stroke: "none",
      "pointer-events": "all",
      class: placement.type === "city" ? "city-fill" : "object-shape"
    }));
    if (isSelected){
      objectLayer.appendChild(el("polygon", {
        points: footprint,
        fill: "rgba(31,111,214,0.12)",
        stroke: "#1f6fd6",
        "stroke-width": 2.5,
        "stroke-linejoin": "round",
        "vector-effect": "non-scaling-stroke",
        "pointer-events": "none",
        class: "selection-outline"
      }));
    }
    objectLayer.addEventListener("pointerdown", function(event){
      if (event.pointerType === "touch") startLongPress(event, placement);
      if (event.ctrlKey || event.metaKey) return;
      startObjectDrag(event, placement);
    });
    objectLayer.addEventListener("contextmenu", function(event){
      if (!editMode) return;
      event.preventDefault();
      if (Date.now() < suppressClickUntil) return;
      setSelection(placement);
      openRenameDialog(placement);
    });
    objectLayer.addEventListener("click", function(event){
      if (event.ctrlKey || event.metaKey) return;
      handleCellClick(cellKeyAtClientPoint(event.clientX, event.clientY), event);
    });
    var label = getPlacementLabel(placement);
    if (label){
      var vertices = parsePoints(footprint);
      var center = polygonCenter(vertices);
      // 熊罠は設定の固定サイズで描き、自動縮小しない。改行は熊罠の名前でのみ入力できる。
      var isBearTrap = placement.type === "bearTrap";
      var baseFontSize = isBearTrap ? bearTrapLabelSize : labelScale;
      var lines = label.split("\n");
      var minX = Math.min.apply(null, vertices.map(function(point){ return point.x; }));
      var maxX = Math.max.apply(null, vertices.map(function(point){ return point.x; }));
      var labelAttrs = {
        x: center.x,
        y: center.y + baseFontSize * 0.35,
        "text-anchor": "middle",
        "font-size": baseFontSize,
        "font-weight": "600",
        fill: "#222222",
        "pointer-events": "none",
        "data-center-y": center.y,
        class: "object-label" + (isSelected ? " selected" : ""),
        style: labelStyle(baseFontSize)
      };
      if (!isBearTrap && lines.length === 1) labelAttrs["data-fit-width"] = (maxX - minX) * (1 - innerPaddingRatio);
      var labelText = el("text", labelAttrs);
      if (lines.length === 1){
        labelText.textContent = label;
      }else{
        var lineHeight = baseFontSize * 1.2;
        var firstLineY = center.y + baseFontSize * 0.35 - lineHeight * (lines.length - 1) / 2;
        lines.forEach(function(line, lineIndex){
          var tspan = el("tspan", { x: center.x, y: firstLineY + lineHeight * lineIndex });
          tspan.textContent = line;
          labelText.appendChild(tspan);
        });
      }
      labelLayer.appendChild(labelText);
    }
    gridLayer.appendChild(objectLayer);
  });
  var gridLineLayer = el("g", {class: "map-grid-lines", "pointer-events": "none"});
  for (var gridCol = colStart; gridCol <= colEnd; gridCol++){
    for (var gridRow = rowStart; gridRow <= rowEnd; gridRow++){
      gridLineLayer.appendChild(el("polygon", {
        points: cellPolygon(gridCol, gridRow),
        fill: "none",
        stroke: "#b8b8b8",
        "stroke-width": 0.3,
        class: "map-grid-line-cell"
      }));
    }
  }
  gridLayer.appendChild(gridLineLayer);
  gridLayer.appendChild(labelLayer);
  gridLayer.appendChild(el("circle", {
    cx: CX,
    cy: CY,
    r: 4 * 900 / (Math.min(window.innerWidth, mapHeight) * zoom),
    fill: "#222222",
    stroke: "#ffffff",
    "stroke-width": 1.5,
    "vector-effect": "non-scaling-stroke",
    "pointer-events": "none",
    class: "map-center-point"
  }));
  svg.appendChild(gridLayer);
  updateSelectionBar(selectedPlacement);
  // 1行の名前がオブジェクトの幅に収まらないときは、収まるまで文字を小さくする（描画後に幅を測る）。
  Array.from(gridLayer.querySelectorAll(".object-label")).forEach(function(labelText){
    var requestedSize = parseFloat(labelText.getAttribute("font-size"));
    var allowedWidth = parseFloat(labelText.getAttribute("data-fit-width"));
    var textWidth = labelText.getComputedTextLength();
    var renderedWidth = textWidth + requestedSize * 0.22;
    if (textWidth > 0 && renderedWidth > allowedWidth){
      var fittedSize = requestedSize * allowedWidth / renderedWidth;
      labelText.setAttribute("font-size", fittedSize);
      labelText.setAttribute("y", parseFloat(labelText.getAttribute("data-center-y")) + fittedSize * 0.35);
      labelText.setAttribute("style", labelStyle(fittedSize));
    }
  });
}

// ---- 出力（JSON・PNG・SVG） ----
function formatFileTimestamp(date){
  function pad(value){ return String(value).padStart(2, "0"); }
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
    "_" + pad(date.getHours()) + "-" + pad(date.getMinutes());
}
function exportFileName(date, extension){
  return "alliance-map-" + formatFileTimestamp(date) + "." + extension;
}
function downloadFile(blob, fileName){
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}
// 表示中のズーム・位置に関係なく、MAP範囲全体を1枚のSVGとして書き出す。
// pixelSize を渡すと、PNG化用に長辺がそのピクセル数になる width/height を付ける。
function buildExportSvg(pixelSize){
  var colStart = -Math.floor(mapCols / 2) - 0.5;
  var colEnd = Math.ceil(mapCols / 2) - 0.5;
  var rowStart = -Math.floor(mapRows / 2) - 0.5;
  var rowEnd = Math.ceil(mapRows / 2) - 0.5;
  var top = toScreen(colStart, rowStart);
  var right = toScreen(colEnd, rowStart);
  var bottom = toScreen(colEnd, rowEnd);
  var left = toScreen(colStart, rowEnd);
  var padding = HW;
  var minX = left.x - padding, minY = top.y - padding;
  var width = right.x - left.x + padding * 2;
  var height = bottom.y - top.y + padding * 2;
  var exportSvg = el("svg", {
    xmlns: svgns,
    // width/height は指定せず、開いた画面に合わせて全体を中央に収める。
    viewBox: minX.toFixed(1) + " " + minY.toFixed(1) + " " + width.toFixed(1) + " " + height.toFixed(1),
    preserveAspectRatio: "xMidYMid meet",
    "font-family": "Hiragino Sans, Yu Gothic UI, Meiryo, sans-serif"
  });
  if (pixelSize){
    var pixelScale = pixelSize / Math.max(width, height);
    exportSvg.setAttribute("width", Math.round(width * pixelScale));
    exportSvg.setAttribute("height", Math.round(height * pixelScale));
  }
  exportSvg.appendChild(el("rect", { x: minX, y: minY, width: width, height: height, fill: "#ffffff" }));
  var content = gridLayer.cloneNode(true);
  content.removeAttribute("transform");
  Array.from(content.querySelectorAll(".map-center-point, .selection-outline")).forEach(function(node){ node.remove(); });
  exportSvg.appendChild(content);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(exportSvg);
}
// iPhone の写真アプリや Discord は SVG を表示できないため、PNG でも出力する。
var PNG_EXPORT_SIZE = 2400;
function renderPngBlob(callback){
  var svgUrl = URL.createObjectURL(new Blob([buildExportSvg(PNG_EXPORT_SIZE)], { type: "image/svg+xml" }));
  var image = new Image();
  image.onload = function(){
    var canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || PNG_EXPORT_SIZE;
    canvas.height = image.naturalHeight || PNG_EXPORT_SIZE;
    var context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(svgUrl);
    canvas.toBlob(function(blob){
      if (blob) callback(blob);
      else showMessage("画像を作成できません");
    }, "image/png");
  };
  image.onerror = function(){
    URL.revokeObjectURL(svgUrl);
    showMessage("画像を作成できません");
  };
  image.src = svgUrl;
}
