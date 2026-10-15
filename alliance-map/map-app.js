// 権限・window.AllianceMapApp（cloud.js との窓口）・起動。
"use strict";

// ---- 権限 ----
// "local"：Webに接続していない（cloud.js が動かない）状態。現行どおりすべての操作を使える。
// "viewer" / "editor" / "saver"：cloud.js が設定する。表示の出し分けは CSS（body[data-role]）で行う。
var currentRole = "local";
var readOnly = false;
function applyRoleUi(){
  document.body.setAttribute("data-role", currentRole);
  document.body.classList.toggle("read-only", readOnly);
  if (currentRole === "viewer" || readOnly){
    editMode = false;
    closeNameDialog();
    closeObjectColorDialog();
    closeMenus();
    cancelObjectDrag();
    if (selectedKey){
      selectedKey = null;
      render();
    }
  }
  updateEditModeButton();
  updateMapCursor();
}
function setRole(role){
  currentRole = role;
  applyRoleUi();
}
// 履歴のプレビュー中など、一時的に編集を止める。
function setReadOnly(value){
  readOnly = !!value;
  applyRoleUi();
}
function isBusy(){
  return !!(objectDragState || pinchState || longPressState || (dragState && dragState.moved) ||
    !cityNameDialog.hidden || !objectColorDialog.hidden);
}
function loadDefaultLayout(){
  return fetch("./default-layout.json", { cache: "no-cache" })
    .then(function(response){
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then(function(layout){
      applyLayout(layout, { source: "default" });
      return layout;
    });
}
var cloudAttached = false;
window.AllianceMapApp = {
  getLayout: getLayout,
  applyLayout: function(layout, options){ applyLayout(layout, options); },
  loadDefaultLayout: loadDefaultLayout,
  setRole: setRole,
  getRole: function(){ return currentRole; },
  setReadOnly: setReadOnly,
  onLocalChange: function(callback){ localChangeListeners.push(callback); },
  isBusy: isBusy,
  setUnloadGuard: function(guard){ unloadGuard = guard; },
  // 一時的なお知らせ（画面下のトースト）。空文字なら何もしない。
  setStatus: function(text){ if (text) showMessage(text); },
  // 現在のズームを100%表示の基準にする（「現在の表示を初期表示にする」用）。
  setZoomBase: function(value){
    zoomBase = value;
    updateZoomReadout();
  },
  attachCloud: function(){ cloudAttached = true; }
};

applyRoleUi();
render();
// cloud.js が読み込めない環境（file:// やCDNに接続できない場合）は、現行どおり default-layout.json を表示する。
window.setTimeout(function(){
  if (cloudAttached) return;
  loadDefaultLayout().catch(function(error){
    console.error("published layout load failed", error);
    showMessage("公開用の配置を読み込めません: " + error.message);
  });
}, 1500);
