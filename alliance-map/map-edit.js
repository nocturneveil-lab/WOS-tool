// マップ上の操作：ツール・選択・ドラッグ（移動・パン・ピンチ）・ひとつ戻る。
"use strict";

function setSelection(placement){
  selectedKey = placement ? placementKey(placement) : null;
  render();
}
// 重ね置き禁止：type を anchor に置いたとき、ignore 以外のオブジェクトと重ならないか。
function canOccupy(type, anchor, ignore){
  var cells = getPlacementCells(type, anchor);
  return !placements.some(function(placement){
    return placement !== ignore && placement.cells.some(function(key){ return cells.indexOf(key) !== -1; });
  });
}
function removePlacementAt(index){
  var placement = placements[index];
  placements.splice(index, 1);
  placement.cells.forEach(function(key){ syncPlacementCell(key, placement.type); });
}
function syncPlacementCell(key, removedType){
  var underlying = null;
  for (var layerIndex = placements.length - 1; layerIndex >= 0; layerIndex--){
    if (placements[layerIndex].cells.indexOf(key) !== -1){
      underlying = placements[layerIndex];
      break;
    }
  }
  if (underlying) classifications[key] = underlying.type;
  else if (classifications[key] === removedType) delete classifications[key];
}
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
function shiftedAnchor(anchor, deltaCol, deltaRow){
  var parts = anchor.split("_");
  return (parseInt(parts[0], 10) + deltaCol) + "_" + (parseInt(parts[1], 10) + deltaRow);
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
function placeStructure(type, anchorKey, name){
  var cells = getPlacementCells(type, anchorKey);
  rememberMapState();
  cells.forEach(function(key){ classifications[key] = type; });
  var placement = { type: type, anchor: anchorKey, cells: cells };
  placement.anchorMode = "bottom-cell";
  if (type === "city" || type === "allianceBuilding") placement.name = name;
  placements.push(placement);
  markLayoutChanged();
  render();
}
function eraseAt(key){
  var index = -1;
  for (var layerIndex = placements.length - 1; layerIndex >= 0; layerIndex--){
    if (placements[layerIndex].cells.indexOf(key) !== -1){
      index = layerIndex;
      break;
    }
  }
  if (index === -1 && (!Object.prototype.hasOwnProperty.call(classifications, key) || classifications[key] === "none")) return;
  rememberMapState();
  if (index !== -1) removePlacementAt(index);
  else classifications[key] = "none";
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
var coordReadout = document.getElementById("coordReadout");
var dragState = null;
var objectDragState = null;
var suppressNextClick = false;
var activePointers = {};
var pinchState = null;
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
      mapWrap.classList.remove("dragging");
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
  mapWrap.classList.remove("dragging");
  if (wasMoved) render();
}
// ドラッグした量を、マス単位の移動量に直す。
function dragCellDelta(drag, clientX, clientY){
  var bounds = svg.getBoundingClientRect();
  var dx = (clientX - drag.startX) * VIEW_W / bounds.width / zoom;
  var dy = (clientY - drag.startY) * VIEW_H / bounds.height / zoom;
  return { col: Math.round((dx / HW + dy / HH) / 2), row: Math.round((dy / HH - dx / HW) / 2) };
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
  nextZoom = Math.max(0.25, Math.min(4, nextZoom));
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
  mapWrap.classList.toggle("edit-lock", false);
  if (!editMode) {
    mapWrap.style.cursor = "grab";
    return;
  }
  mapWrap.style.cursor = "default";
}
svg.addEventListener("pointerdown", function(event){
  activePointers[event.pointerId] = {x:event.clientX, y:event.clientY, type:event.pointerType};
  var pointerIds = Object.keys(activePointers);
  if (event.pointerType === "touch" && pointerIds.length === 2){
    var first = activePointers[pointerIds[0]], second = activePointers[pointerIds[1]];
    var center = clientToSvg((first.x + second.x) / 2, (first.y + second.y) / 2);
    var dx = first.x - second.x, dy = first.y - second.y;
    pinchState = {
      distance: Math.sqrt(dx * dx + dy * dy),
      zoom: zoom,
      worldX: (center.x - panX) / zoom,
      worldY: (center.y - panY) / zoom
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
    canPan: true,
    moved: false
  };
  if (dragState.canPan && !editMode) {
    mapWrap.classList.add("dragging");
    mapWrap.style.cursor = "grabbing";
  }
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
    var objectDx = event.clientX - objectDragState.startX;
    var objectDy = event.clientY - objectDragState.startY;
    if (Math.abs(objectDx) + Math.abs(objectDy) > 3) objectDragState.moved = true;
    if (objectDragState.moved){
      var objectBounds = svg.getBoundingClientRect();
      var localDx = objectDx * VIEW_W / objectBounds.width / zoom;
      var localDy = objectDy * VIEW_H / objectBounds.height / zoom;
      setSelectedNodesTransform("translate(" + localDx + " " + localDy + ")");
      updateDropPreview(objectDragState, dragCellDelta(objectDragState, event.clientX, event.clientY));
      mapWrap.classList.add("dragging");
    }
    return;
  }
  if (pinchState && Object.keys(activePointers).length >= 2){
    var pinchPointers = Object.keys(activePointers).slice(0, 2).map(function(id){ return activePointers[id]; });
    var pinchDx = pinchPointers[0].x - pinchPointers[1].x;
    var pinchDy = pinchPointers[0].y - pinchPointers[1].y;
    var pinchDistance = Math.sqrt(pinchDx * pinchDx + pinchDy * pinchDy);
    var pinchCenter = clientToSvg((pinchPointers[0].x + pinchPointers[1].x) / 2, (pinchPointers[0].y + pinchPointers[1].y) / 2);
    zoom = Math.max(0.25, Math.min(4, pinchState.zoom * pinchDistance / pinchState.distance));
    updateZoomReadout();
    panX = pinchCenter.x - pinchState.worldX * zoom;
    panY = pinchCenter.y - pinchState.worldY * zoom;
    render();
    return;
  }
  if (!dragState || event.pointerId !== dragState.pointerId || !dragState.canPan) return;
  var dx = event.clientX - dragState.startX;
  var dy = event.clientY - dragState.startY;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragState.moved = true;
  if (!dragState.moved || !gridLayer) return;
  mapWrap.classList.add("dragging");
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
    mapWrap.classList.remove("dragging");
    if (objectDrag.moved){
      var delta = dragCellDelta(objectDrag, event.clientX, event.clientY);
      var deltaCol = delta.col;
      var deltaRow = delta.row;
      suppressNextClick = true;
      window.setTimeout(function(){ suppressNextClick = false; }, 0);
      var placement = objectDrag.placement;
      if (event.type === "pointercancel" || (!deltaCol && !deltaRow)) render();
      else if (!canOccupy(placement.type, shiftedAnchor(placement.anchor, deltaCol, deltaRow), placement)){
        showMessage("ほかのオブジェクトと重なるため移動できません");
        render();
      }
      else movePlacement(placement, deltaCol, deltaRow);
    }
    return;
  }
  if (pinchState && Object.keys(activePointers).length < 2) pinchState = null;
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  if (dragState.moved){
    var bounds = svg.getBoundingClientRect();
    panX = dragState.panX + (event.clientX - dragState.startX) * VIEW_W / bounds.width;
    panY = dragState.panY + (event.clientY - dragState.startY) * VIEW_H / bounds.height;
    suppressNextClick = true;
    window.setTimeout(function(){ suppressNextClick = false; }, 0);
    render();
  }
  dragState = null;
  mapWrap.classList.remove("dragging");
  updateMapCursor();
}
window.addEventListener("pointerup", finishDrag);
window.addEventListener("pointercancel", finishDrag);
window.addEventListener("keydown", function(event){
  if (event.key === "Control") mapWrap.classList.add("pan-ready");
});
window.addEventListener("keyup", function(event){
  if (event.key === "Control") mapWrap.classList.remove("pan-ready");
});
window.addEventListener("blur", function(){ mapWrap.classList.remove("pan-ready"); });
