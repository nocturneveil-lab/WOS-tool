// ツールバー・「⋯」メニュー・ダイアログ・設定。
"use strict";

var toastTimer = 0;
function showMessage(text){
  var toast = document.getElementById("cloudToast");
  toast.textContent = text;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(function(){ toast.hidden = true; }, 3000);
}
document.getElementById("resetMapAction").addEventListener("click", function(){
  if (!placements.length && !Object.keys(classifications).some(function(key){ return classifications[key] !== "none"; }) && panX === (VIEW_W / 2 - CX * zoomBase) && panY === (VIEW_H / 2 - CY * zoomBase) && zoom === zoomBase) return;
  var resetMessage = currentRole === "saver" ?
    "マップの配置をすべて消去します。\nWeb上のマップが全員分消えます（リセット前の状態は履歴から戻せます）。よろしいですか？" :
    "マップの配置をすべて消去します。よろしいですか？";
  if (!window.confirm(resetMessage)) return;
  var previousLayout = getLayout();
  rememberMapState();
  placements = [];
  classifications = {};
  zoom = zoomBase;
  centerMapView();
  markLayoutChanged("reset", previousLayout);
  updateZoomReadout();
  render();
});
var layoutFileInput = document.getElementById("layoutFileInput");
document.getElementById("saveLayoutButton").addEventListener("click", function(){
  var savedAt = new Date();
  var layout = getLayout();
  layout.savedAt = savedAt.toISOString();
  downloadFile(new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" }),
    "alliance-map-" + formatFileTimestamp(savedAt) + ".json");
  hasUnsavedChanges = false;
  showMessage("JSONを保存しました");
});
document.getElementById("exportSvgButton").addEventListener("click", function(){
  downloadFile(new Blob([buildExportSvg()], { type: "image/svg+xml" }),
    "alliance-map-" + formatFileTimestamp(new Date()) + ".svg");
  showMessage("SVGを出力しました");
});
var imagePreviewDialog = document.getElementById("imagePreviewDialog");
var imagePreview = document.getElementById("imagePreview");
var shareImageButton = document.getElementById("shareImage");
var previewFile = null;
function isTouchDevice(){
  return window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
}
function openImagePreview(file){
  previewFile = file;
  if (imagePreview.src) URL.revokeObjectURL(imagePreview.src);
  imagePreview.src = URL.createObjectURL(file);
  shareImageButton.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  imagePreviewDialog.hidden = false;
}
function closeImagePreview(){
  imagePreviewDialog.hidden = true;
}
document.getElementById("exportPngButton").addEventListener("click", function(){
  showMessage("画像を作成しています…");
  renderPngBlob(function(blob){
    var fileName = "alliance-map-" + formatFileTimestamp(new Date()) + ".png";
    if (isTouchDevice()){
      openImagePreview(new File([blob], fileName, { type: "image/png" }));
      showMessage("画像を作成しました");
    }else{
      downloadFile(blob, fileName);
      showMessage("画像を出力しました");
    }
  });
});
shareImageButton.addEventListener("click", function(){
  if (!previewFile) return;
  navigator.share({ files: [previewFile] }).catch(function(error){
    if (error && error.name !== "AbortError") showMessage("共有できません: " + error.message);
  });
});
document.getElementById("downloadImage").addEventListener("click", function(){
  if (previewFile) downloadFile(previewFile, previewFile.name);
});
document.getElementById("closeImagePreview").addEventListener("click", closeImagePreview);
imagePreviewDialog.addEventListener("click", function(event){
  if (event.target === imagePreviewDialog) closeImagePreview();
});
document.addEventListener("keydown", function(event){
  if (event.key === "Escape" && !imagePreviewDialog.hidden) closeImagePreview();
});
document.getElementById("loadLayoutButton").addEventListener("click", function(){ layoutFileInput.click(); });
layoutFileInput.addEventListener("change", function(){
  var file = layoutFileInput.files && layoutFileInput.files[0];
  if (!file) return;
  if (currentRole === "saver" && !window.confirm("Webのマップを置き換えます（読み込み前の状態は履歴から戻せます）。よろしいですか？")){
    layoutFileInput.value = "";
    return;
  }
  file.text().then(function(text){
    var previousLayout = getLayout();
    applyLayout(JSON.parse(text), { source: "file" });
    emitLocalChange("file", previousLayout);
    showMessage("配置を読み込みました");
  }).catch(function(error){
    showMessage("読み込めません: " + error.message);
  }).finally(function(){
    layoutFileInput.value = "";
  });
});
var cityNameDialog = document.getElementById("cityNameDialog");
var cityNameForm = document.getElementById("cityNameForm");
var cityNameInput = document.getElementById("cityNameInput");
var cityNameTextarea = document.getElementById("cityNameTextarea");
var activeNameField = cityNameInput;
var cityNameTitle = document.getElementById("cityNameTitle");
var cityNameSubmit = document.getElementById("cityNameSubmit");
var pendingCity = null;
// multiline のときは改行できる textarea（熊罠用）、それ以外は1行の input を使う。
function showNameDialog(title, submitText, value, required, placeholder, multiline){
  activeNameField = multiline ? cityNameTextarea : cityNameInput;
  var inactiveField = multiline ? cityNameInput : cityNameTextarea;
  inactiveField.hidden = true;
  inactiveField.required = false;
  activeNameField.hidden = false;
  cityNameTitle.textContent = title;
  cityNameSubmit.textContent = submitText;
  activeNameField.value = value;
  activeNameField.required = required;
  activeNameField.placeholder = placeholder;
  cityNameDialog.hidden = false;
  activeNameField.focus();
  activeNameField.select();
}
function normalizeName(value){
  return value.split(/\r?\n/).map(function(line){ return line.trim(); }).filter(Boolean).join("\n");
}
function openNewNameDialog(anchorKey){
  pendingCity = { anchor: anchorKey };
  showNameDialog(activeTool === "allianceBuilding" ? "同盟建築物名" : "都市名", "配置", "", true, "");
}
function openRenameDialog(placement){
  if (!editMode) return;
  pendingCity = { placement: placement };
  var required = isNameRequired(placement.type);
  var multiline = placement.type === "bearTrap";
  showNameDialog("名称変更（" + TYPE_LABELS[placement.type] + "）", "変更", placement.name || "", required,
    required ? "" : (multiline ? "改行できます。空欄で標準表示に戻ります" : "空欄で標準表示に戻ります"), multiline);
}
function closeNameDialog(){
  pendingCity = null;
  cityNameDialog.hidden = true;
}
cityNameForm.addEventListener("submit", function(event){
  event.preventDefault();
  if (!pendingCity) return;
  var name = normalizeName(activeNameField.value);
  var placement = pendingCity.placement;
  if (placement){
    if (!name && isNameRequired(placement.type)) return;
    if ((placement.name || "") !== name){
      rememberMapState();
      if (name) placement.name = name;
      else delete placement.name;
      markLayoutChanged();
      render();
    }
  }else{
    if (!name) return;
    placeStructure(activeTool === "allianceBuilding" ? "allianceBuilding" : "city", pendingCity.anchor, name);
  }
  closeNameDialog();
});
document.getElementById("cancelCityName").addEventListener("click", closeNameDialog);
cityNameDialog.addEventListener("click", function(event){
  if (event.target === cityNameDialog) closeNameDialog();
});
document.addEventListener("keydown", function(event){
  if (event.key === "Escape" && !cityNameDialog.hidden) closeNameDialog();
});
var labelSizeInput = document.getElementById("labelSizeInput");
var labelSizeOutput = document.getElementById("labelSizeOutput");
var mapColsInput = document.getElementById("mapColsInput");
var mapRowsInput = document.getElementById("mapRowsInput");
var editModeToggle = document.getElementById("editModeToggle");
// ヘッダー（広い画面）と「⋯」メニュー（狭い画面）の両方に表示する。
var zoomValues = Array.from(document.querySelectorAll(".zoom-value"));
function updateZoomReadout(){
  var text = Math.round(zoom / zoomBase * 100) + "%";
  zoomValues.forEach(function(node){ node.textContent = text; });
}
var objectColorDialog = document.getElementById("objectColorDialog");
var objectColorForm = document.getElementById("objectColorForm");
var objectColorInputs = Array.from(objectColorForm.querySelectorAll("[data-object-color]"));
function refreshObjectColorInputs(){
  objectColorInputs.forEach(function(input){ input.value = TYPE_COLORS[input.getAttribute("data-object-color")]; });
}
function updateMapToolColors(){
  document.querySelectorAll(".map-tool[data-type]").forEach(function(button){
    var type = button.getAttribute("data-type");
    if (TYPE_COLORS[type]) button.style.setProperty("--tool-color", TYPE_COLORS[type]);
  });
}
function closeObjectColorDialog(){ objectColorDialog.hidden = true; }
var bearTrapLabelSizeInput = document.getElementById("bearTrapLabelSizeInput");
document.getElementById("openObjectColorSettings").addEventListener("click", function(){
  refreshObjectColorInputs();
  refreshMapRangeInputs();
  bearTrapLabelSizeInput.value = String(bearTrapLabelSize);
  objectColorDialog.hidden = false;
  objectColorInputs[0].focus();
});
document.getElementById("cancelObjectColors").addEventListener("click", closeObjectColorDialog);
document.getElementById("resetObjectColors").addEventListener("click", function(){
  objectColorInputs.forEach(function(input){ input.value = DEFAULT_TYPE_COLORS[input.getAttribute("data-object-color")]; });
});
objectColorDialog.addEventListener("click", function(event){
  if (event.target === objectColorDialog) closeObjectColorDialog();
});
document.addEventListener("keydown", function(event){
  if (event.key === "Escape" && !objectColorDialog.hidden) closeObjectColorDialog();
});
function getSharedSettingsKey(){
  return JSON.stringify([TYPE_COLORS, bearTrapLabelSize, mapCols, mapRows]);
}
objectColorForm.addEventListener("submit", function(event){
  event.preventDefault();
  var previousSettings = getSharedSettingsKey();
  objectColorInputs.forEach(function(input){ TYPE_COLORS[input.getAttribute("data-object-color")] = input.value.toLowerCase(); });
  saveTypeColors();
  bearTrapLabelSize = clampMapSize(bearTrapLabelSizeInput.value, bearTrapLabelSize, 6, 30);
  saveBearTrapLabelSize();
  updateMapToolColors();
  closeObjectColorDialog();
  applyMapRange();
  if (getSharedSettingsKey() !== previousSettings) markLayoutChanged("settings");
});
refreshObjectColorInputs();
updateMapToolColors();
function refreshMapRangeInputs(){
  mapColsInput.value = String(mapCols);
  mapRowsInput.value = String(mapRows);
}
function refreshLabelSizeInput(){
  labelSizeInput.value = String(labelScale);
  labelSizeOutput.textContent = Math.round(labelScale) + " px";
}
refreshLabelSizeInput();
refreshMapRangeInputs();
labelSizeInput.addEventListener("input", function(){
  labelScale = Number(labelSizeInput.value);
  labelScale = Math.min(12, Math.max(6, labelScale));
  refreshLabelSizeInput();
  try{ localStorage.setItem(LABEL_SIZE_KEY, String(labelScale)); }
  catch(e){ console.error("label size save failed", e); }
  render();
});
function applyMapRange(){
  mapCols = clampMapSize(mapColsInput.value, 32, 10, 80);
  mapRows = clampMapSize(mapRowsInput.value, 32, 10, 80);
  refreshMapRangeInputs();
  saveMapRange();
  updateGridMetrics();
  render();
}
function updateEditModeButton(){
  editModeToggle.classList.toggle("active", editMode);
  editModeToggle.classList.toggle("view-mode", !editMode);
  editModeToggle.setAttribute("aria-pressed", editMode ? "true" : "false");
  document.getElementById("editModeLabel").textContent = editMode ? "編集モード" : "閲覧モード";
  editModeToggle.title = editMode ? "編集モード（配置・編集が有効です）" : "閲覧モード（配置をせずにMAP閲覧のみです）";
  editModeToggle.setAttribute("aria-label", editMode ? "編集モード" : "閲覧モード");
  mapWrap.classList.toggle("edit-mode", editMode);
}
editModeToggle.addEventListener("click", function(){
  if (currentRole === "viewer" || readOnly) return;
  editMode = !editMode;
  if (!editMode) selectedKey = null;
  updateEditModeButton();
  updateMapCursor();
  render();
});
// ---- ツール一覧と「⋯」メニュー（すべての幅で、ボタンの下に開くポップアップ） ----
var mapControls = document.querySelector(".map-controls");
var toolPickerButton = document.getElementById("toolPickerButton");
var toolList = document.getElementById("toolList");
var moreMenu = document.getElementById("moreMenu");
var moreMenuButton = document.getElementById("moreMenuButton");
var toolButtons = Array.from(document.querySelectorAll("#toolList .map-tool"));
// ポップアップは position:fixed（ヘッダーの横スクロール領域に切り取られないように）なので、開くたびに位置を合わせる。
function positionPopup(popup, toggle, alignRight){
  var rect = toggle.getBoundingClientRect();
  popup.style.top = Math.round(rect.bottom + 6) + "px";
  var width = popup.offsetWidth;
  var left = alignRight ? rect.right - width : rect.left;
  popup.style.left = Math.round(Math.max(8, Math.min(left, window.innerWidth - width - 8))) + "px";
}
function setMenuOpen(popup, toggle, open){
  popup.classList.toggle("open", open);
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) positionPopup(popup, toggle, popup === moreMenu);
  mapControls.classList.toggle("menu-open", isMenuOpen());
}
function closeMenus(){
  setMenuOpen(toolList, toolPickerButton, false);
  setMenuOpen(moreMenu, moreMenuButton, false);
}
function isMenuOpen(){
  return toolList.classList.contains("open") || moreMenu.classList.contains("open");
}
toolPickerButton.addEventListener("click", function(){
  var open = !toolList.classList.contains("open");
  closeMenus();
  setMenuOpen(toolList, toolPickerButton, open);
});
moreMenuButton.addEventListener("click", function(){
  var open = !moreMenu.classList.contains("open");
  closeMenus();
  setMenuOpen(moreMenu, moreMenuButton, open);
});
// メニューの項目（ボタン）を選んだら閉じる。文字サイズのスライダーでは閉じない。
moreMenu.addEventListener("click", function(event){
  if (event.target.closest("button")) closeMenus();
});
// メニューの外を押したら閉じる。マップを押した場合は、その操作（配置など）はしない。
document.addEventListener("pointerdown", function(event){
  if (!isMenuOpen() || event.target.closest(".header-popup, .tool-picker-button, .more-menu-button")) return;
  if (svg.contains(event.target)) suppressClickUntil = Date.now() + 400;
  closeMenus();
}, true);
document.addEventListener("keydown", function(event){
  if (event.key === "Escape" && isMenuOpen()) closeMenus();
});
window.addEventListener("resize", closeMenus);
function updateToolPicker(){
  var activeButton = toolButtons.filter(function(button){ return button.getAttribute("data-type") === activeTool; })[0];
  toolPickerButton.setAttribute("data-type", activeTool);
  toolPickerButton.textContent = activeButton ? activeButton.textContent : "";
  if (TYPE_COLORS[activeTool]) toolPickerButton.style.setProperty("--tool-color", TYPE_COLORS[activeTool]);
  else toolPickerButton.style.removeProperty("--tool-color");
}
toolButtons.forEach(function(button){
  button.addEventListener("click", function(){
    closeMenus();
    if (!editMode) return;
    activeTool = button.getAttribute("data-type");
    toolButtons.forEach(function(tool){
      var selected = tool === button;
      tool.classList.toggle("active", selected);
      tool.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    updateToolPicker();
  });
});
updateToolPicker();
// ---- 選択中のオブジェクトの操作 ----
var selectionBar = document.getElementById("selectionBar");
var selectionSwatch = document.getElementById("selectionSwatch");
var selectionLabel = document.getElementById("selectionLabel");
function updateSelectionBar(placement){
  selectionBar.hidden = !placement;
  if (!placement) return;
  selectionSwatch.style.background = TYPE_COLORS[placement.type];
  var label = getPlacementLabel(placement).replace(/\n/g, " ");
  selectionLabel.textContent = TYPE_LABELS[placement.type] + (label && label !== TYPE_LABELS[placement.type] ? "：" + label : "");
}
document.getElementById("renameSelection").addEventListener("click", function(){
  var placement = getSelectedPlacement();
  if (placement) openRenameDialog(placement);
});
document.getElementById("deleteSelection").addEventListener("click", deleteSelectedPlacement);
document.getElementById("clearSelection").addEventListener("click", function(){ setSelection(null); });
document.addEventListener("keydown", function(event){
  if (!selectedKey || isBusy() || !cityNameDialog.hidden) return;
  var tag = event.target && event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (event.key === "Delete" || event.key === "Backspace"){
    event.preventDefault();
    deleteSelectedPlacement();
  }else if (event.key === "Escape"){
    setSelection(null);
  }
});
updateEditModeButton();
updateMapCursor();
