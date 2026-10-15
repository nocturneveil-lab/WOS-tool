// マップ上の操作：ツール・選択・ドラッグ（移動・パン・ピンチ）・ひとつ戻る。
"use strict";

// ---- 選択 ----
function setSelection(placement){
  selectedKey = placement ? placementKey(placement) : null;
  render();
}

// ---- 配置・消去・移動 ----
// 重ね置き禁止：type を anchor に置いたとき、ignore 以外のオブジェクトと重ならないか。
function canOccupy(type, anchor, ignore){
  var cells = getPlacementCells(type, anchor);
  return !placements.some(function(placement){
    return placement !== ignore && placement.cells.some(function(key){ return cells.indexOf(key) !== -1; });
  });
}
function shiftedAnchor(anchor, deltaCol, deltaRow){
  var parts = anchor.split("_");
  return (parseInt(parts[0], 10) + deltaCol) + "_" + (parseInt(parts[1], 10) + deltaRow);
}
function removePlacementAt(index){
  var placement = placements[index];
  placements.splice(index, 1);
  placement.cells.forEach(function(key){ syncPlacementCell(key, placement.type); });
}
// マスの種類（classifications）を、そのマスに残っている一番上のオブジェクトに合わせる。
function syncPlacementCell(key, removedType){
  var underlying = findTopPlacementAt(key);
  if (underlying) classifications[key] = underlying.type;
  else if (classifications[key] === removedType) delete classifications[key];
}
function placeStructure(type, anchorKey, name){
  var cells = getPlacementCells(type, anchorKey);
  rememberMapState();
  cells.forEach(function(key){ classifications[key] = type; });
  var placement = { type: type, anchor: anchorKey, cells: cells, anchorMode: "bottom-cell" };
  if (isNameRequired(type)) placement.name = name;
  placements.push(placement);
  markLayoutChanged();
  render();
}
function eraseAt(key){
  var target = findTopPlacementAt(key);
  if (!target && (!Object.prototype.hasOwnProperty.call(classifications, key) || classifications[key] === "none")) return;
  rememberMapState();
  if (target) removePlacementAt(placements.indexOf(target));
  else classifications[key] = "none";
  markLayoutChanged();
  render();
}
function deleteSelectedPlacement(){
  var placement = getSelectedPlacement();
  if (!placement) return;
  rememberMapState();
  removePlacementAt(placements.indexOf(placement));
  selectedKey = null;
  markLayoutChanged();
  render();
}
// 移動したオブジェクトは一番上（配列の最後）にする。
function movePlacement(placement, deltaCol, deltaRow){
  var placementIndex = placements.indexOf(placement);
  if (placementIndex === -1 || (!deltaCol && !deltaRow)) return;
  rememberMapState();
  var wasSelected = selectedKey === placementKey(placement);
  var previousCells = placement.cells.slice();
  placement.anchor = shiftedAnchor(placement.anchor, deltaCol, deltaRow);
  placement.cells = getPlacementCells(placement.type, placement.anchor);
  if (wasSelected) selectedKey = placementKey(placement);
  placements.splice(placementIndex, 1);
  placements.push(placement);
  var changedCells = {};
  previousCells.concat(placement.cells).forEach(function(key){ changedCells[key] = true; });
  Object.keys(changedCells).forEach(function(key){ syncPlacementCell(key, placement.type); });
  markLayoutChanged();
  render();
}
function handleCellClick(key, event){
  if (!editMode) return;
  if (suppressNextClick || event.ctrlKey || Date.now() < suppressClickUntil) return;
  if (activeTool === "erase"){
    eraseAt(key);
    return;
  }
  var target = findTopPlacementAt(key);
  // 選択ツール：オブジェクトを選択、空きマスで選択解除。
  // 配置ツール：既存オブジェクトの上なら配置せずにそれを選択する（重ね置き禁止）。
  if (activeTool === "select" || target){
    setSelection(target);
    return;
  }
  if (!canOccupy(activeTool, key, null)){
    showMessage("ほかのオブジェクトと重なるため配置できません");
    return;
  }
  if (selectedKey) setSelection(null);
  // 配置ツールは配置後も選んだまま（連続配置のため）。
  if (isNameRequired(activeTool)) openNewNameDialog(key);
  else placeStructure(activeTool, key, "");
}

// ---- ひとつ戻る ----
var undoStack = [];
var undoButton = document.getElementById("undoAction");
function updateUndoButton(){ undoButton.disabled = undoStack.length === 0; }
function rememberMapState(){
  undoStack.push({
    classifications: JSON.parse(JSON.stringify(classifications)),
    placements: JSON.parse(JSON.stringify(placements)),
    panX: panX,
    panY: panY,
    zoom: zoom,
    selectedKey: selectedKey
  });
  if (undoStack.length > 50) undoStack.shift();
  updateUndoButton();
}
function clearUndoHistory(){
  undoStack = [];
  updateUndoButton();
}
function undoMapAction(){
  if (!undoStack.length) return;
  var previous = undoStack.pop();
  classifications = previous.classifications;
  placements = previous.placements;
  panX = previous.panX;
  panY = previous.panY;
  zoom = previous.zoom;
  selectedKey = previous.selectedKey || null;
  updateGridMetrics();
  markLayoutChanged("undo");
  updateZoomReadout();
  updateUndoButton();
  render();
}
undoButton.addEventListener("click", undoMapAction);

// ---- ポインター操作 ----
var coordReadout = document.getElementById("coordReadout");
var dragState = null;
var objectDragState = null;
var suppressNextClick = false;
var activePointers = {};
var pinchState = null;
// ドラッグ（パン・移動）の直後に届くクリックで、配置や選択をしないようにする。
function suppressClickOnce(){
  suppressNextClick = true;
  window.setTimeout(function(){ suppressNextClick = false; }, 0);
}
svg.addEventListener("pointermove", function(event){
  var coord = getCoordFromKey(cellKeyAtClientPoint(event.clientX, event.clientY));
  coordReadout.textContent = "x:" + coord.x + " y:" + coord.y;
  coordReadout.style.display = "block";
});
svg.addEventListener("pointerleave", function(){
  coordReadout.style.display = "none";
});
// スマホは長押し、PCは右クリック（contextmenu）で名称変更を開く。
var LONG_PRESS_MS = 500;
var longPressState = null;
var suppressClickUntil = 0;
function startLongPress(event, placement){
  cancelLongPress();
  if (!editMode) return;
  longPressState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    fired: false,
    timer: window.setTimeout(function(){
      if (!longPressState) return;
      longPressState.fired = true;
      suppressClickUntil = Date.now() + 60000;
      dragState = null;
      objectDragState = null;
      setSelection(placement);
      openRenameDialog(placement);
    }, LONG_PRESS_MS)
  };
}
function cancelLongPress(){
  if (!longPressState) return;
  window.clearTimeout(longPressState.timer);
  if (longPressState.fired) suppressClickUntil = Date.now() + 400;
  longPressState = null;
}
// 選択中のオブジェクトだけドラッグで移動できる（マウス・タッチ共通）。
// それ以外の場所から始めたドラッグはマップのスクロールになる。
function startObjectDrag(event, placement){
  if (!editMode || event.button !== 0 || event.ctrlKey || placementKey(placement) !== selectedKey) return;
  objectDragState = {
    pointerId: event.pointerId,
    placement: placement,
    startX: event.clientX,
    startY: event.clientY,
    moved: false
  };
}
function cancelObjectDrag(){
  if (!objectDragState) return;
  var wasMoved = objectDragState.moved;
  objectDragState = null;
  if (wasMoved) render();
}
// ドラッグした量（マップ上の長さ）。
function dragWorldDelta(drag, clientX, clientY){
  var bounds = svg.getBoundingClientRect();
  return {
    x: (clientX - drag.startX) * VIEW_W / bounds.width / zoom,
    y: (clientY - drag.startY) * VIEW_H / bounds.height / zoom
  };
}
// ドラッグした量を、マス単位の移動量に直す。
function dragCellDelta(drag, clientX, clientY){
  var delta = dragWorldDelta(drag, clientX, clientY);
  return { col: Math.round((delta.x / HW + delta.y / HH) / 2), row: Math.round((delta.y / HH - delta.x / HW) / 2) };
}
// ドラッグ中の移動先を表示する。重なって置けない位置なら赤くする。
function updateDropPreview(drag, delta){
  var preview = svg.querySelector(".drop-preview");
  if (!delta.col && !delta.row){
    if (preview) preview.remove();
    return;
  }
  var placement = drag.placement;
  var anchor = shiftedAnchor(placement.anchor, delta.col, delta.row);
  var blocked = !canOccupy(placement.type, anchor, placement);
  if (!preview){
    preview = el("polygon", { class: "drop-preview", "vector-effect": "non-scaling-stroke", "pointer-events": "none", "stroke-width": 2.5, "stroke-linejoin": "round" });
    gridLayer.appendChild(preview);
  }
  preview.setAttribute("points", placementPolygon({ type: placement.type, anchor: anchor }));
  preview.setAttribute("fill", blocked ? "rgba(220,53,69,0.35)" : "rgba(31,111,214,0.18)");
  preview.setAttribute("stroke", blocked ? "#dc3545" : "#1f6fd6");
  preview.setAttribute("stroke-dasharray", blocked ? "" : "6 4");
  svg.querySelectorAll(".object-layer.selected .selection-outline").forEach(function(outline){
    outline.setAttribute("stroke", blocked ? "#dc3545" : "#1f6fd6");
  });
}
// ドラッグ中は、選択中のオブジェクトとその名前を一緒に動かして見せる。
function setSelectedNodesTransform(transform){
  svg.querySelectorAll(".object-layer.selected, .object-label.selected").forEach(function(node){
    if (transform) node.setAttribute("transform", transform);
    else node.removeAttribute("transform");
  });
}
function zoomAt(nextZoom, pointX, pointY){
  nextZoom = clampZoom(nextZoom);
  var worldX = (pointX - panX) / zoom;
  var worldY = (pointY - panY) / zoom;
  zoom = nextZoom;
  updateZoomReadout();
  panX = pointX - worldX * zoom;
  panY = pointY - worldY * zoom;
  render();
}
svg.addEventListener("wheel", function(event){
  if (!event.ctrlKey) return;
  event.preventDefault();
  var point = clientToSvg(event.clientX, event.clientY);
  zoomAt(zoom * Math.exp(-event.deltaY * 0.001), point.x, point.y);
}, {passive:false});
function updateMapCursor(){
  mapWrap.style.cursor = editMode ? "default" : "grab";
}
// 2本指の間の距離と、その中点（SVG座標）。
function pinchMetrics(first, second){
  var dx = first.x - second.x, dy = first.y - second.y;
  return {
    distance: Math.sqrt(dx * dx + dy * dy),
    center: clientToSvg((first.x + second.x) / 2, (first.y + second.y) / 2)
  };
}
svg.addEventListener("pointerdown", function(event){
  activePointers[event.pointerId] = {x:event.clientX, y:event.clientY};
  var pointerIds = Object.keys(activePointers);
  if (event.pointerType === "touch" && pointerIds.length === 2){
    var pinch = pinchMetrics(activePointers[pointerIds[0]], activePointers[pointerIds[1]]);
    pinchState = {
      distance: pinch.distance,
      zoom: zoom,
      worldX: (pinch.center.x - panX) / zoom,
      worldY: (pinch.center.y - panY) / zoom
    };
    dragState = null;
    cancelObjectDrag();
    cancelLongPress();
    return;
  }
  if (event.button !== 0) return;
  // 選択中のオブジェクトの上で押した場合は、オブジェクトの移動（objectDragState）になる。
  if (objectDragState && objectDragState.pointerId === event.pointerId) return;
  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    panX: panX,
    panY: panY,
    moved: false
  };
  if (!editMode) mapWrap.style.cursor = "grabbing";
});
window.addEventListener("pointermove", function(event){
  if (longPressState && !longPressState.fired && event.pointerId === longPressState.pointerId &&
      Math.abs(event.clientX - longPressState.startX) + Math.abs(event.clientY - longPressState.startY) > 10){
    cancelLongPress();
  }
  if (activePointers[event.pointerId]){
    activePointers[event.pointerId].x = event.clientX;
    activePointers[event.pointerId].y = event.clientY;
  }
  if (objectDragState && event.pointerId === objectDragState.pointerId){
    if (Math.abs(event.clientX - objectDragState.startX) + Math.abs(event.clientY - objectDragState.startY) > 3) objectDragState.moved = true;
    if (objectDragState.moved){
      var local = dragWorldDelta(objectDragState, event.clientX, event.clientY);
      setSelectedNodesTransform("translate(" + local.x + " " + local.y + ")");
      updateDropPreview(objectDragState, dragCellDelta(objectDragState, event.clientX, event.clientY));
    }
    return;
  }
  if (pinchState && Object.keys(activePointers).length >= 2){
    var pinchPointers = Object.keys(activePointers).slice(0, 2).map(function(id){ return activePointers[id]; });
    var pinch = pinchMetrics(pinchPointers[0], pinchPointers[1]);
    zoom = clampZoom(pinchState.zoom * pinch.distance / pinchState.distance);
    updateZoomReadout();
    panX = pinch.center.x - pinchState.worldX * zoom;
    panY = pinch.center.y - pinchState.worldY * zoom;
    render();
    return;
  }
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  var dx = event.clientX - dragState.startX;
  var dy = event.clientY - dragState.startY;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragState.moved = true;
  if (!dragState.moved || !gridLayer) return;
  var bounds = svg.getBoundingClientRect();
  var scaleX = VIEW_W / bounds.width;
  var scaleY = VIEW_H / bounds.height;
  gridLayer.setAttribute("transform", "translate(" + (dragState.panX + dx * scaleX) + " " + (dragState.panY + dy * scaleY) + ") scale(" + zoom + ")");
});
function finishDrag(event){
  if (longPressState && event.pointerId === longPressState.pointerId) cancelLongPress();
  delete activePointers[event.pointerId];
  if (objectDragState && event.pointerId === objectDragState.pointerId){
    var objectDrag = objectDragState;
    objectDragState = null;
    if (objectDrag.moved){
      var delta = dragCellDelta(objectDrag, event.clientX, event.clientY);
      suppressClickOnce();
      var placement = objectDrag.placement;
      if (event.type === "pointercancel" || (!delta.col && !delta.row)) render();
      else if (!canOccupy(placement.type, shiftedAnchor(placement.anchor, delta.col, delta.row), placement)){
        showMessage("ほかのオブジェクトと重なるため移動できません");
        render();
      }
      else movePlacement(placement, delta.col, delta.row);
    }
    return;
  }
  if (pinchState && Object.keys(activePointers).length < 2) pinchState = null;
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  if (dragState.moved){
    var bounds = svg.getBoundingClientRect();
    panX = dragState.panX + (event.clientX - dragState.startX) * VIEW_W / bounds.width;
    panY = dragState.panY + (event.clientY - dragState.startY) * VIEW_H / bounds.height;
    suppressClickOnce();
    render();
  }
  dragState = null;
  updateMapCursor();
}
window.addEventListener("pointerup", finishDrag);
window.addEventListener("pointercancel", finishDrag);
