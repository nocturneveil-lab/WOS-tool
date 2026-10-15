// Alliance Map の Web 保存・リアルタイム同期（Firebase / Cloud Firestore）の起動。
// map-app.js が公開する window.AllianceMapApp を通してマップを操作する。
import { state, el, mapApp, sdk, auth, mapRef, loadSdk, connectFirestore, connectAuth } from "./cloud-shared.js";
import { refreshUi, handleLocalChange, hasUnsavedWork, handleSnapshot, showFallback, saveInitialView } from "./cloud-sync.js";
import { setupHistoryUi } from "./cloud-history.js";
import { setupLoginUi, handleAuthChanged } from "./cloud-auth.js";

// 最初のスナップショットがこの時間内に届かなければ default-layout.json を表示する。
const FIRST_SNAPSHOT_TIMEOUT_MS = 8000;

async function start() {
  mapApp.attachCloud();
  el.controls.hidden = false;
  refreshUi();
  try {
    await loadSdk();
  } catch (error) {
    // SDK を読み込めない場合は、Web に接続しない従来の動作（すべての操作が使える）に戻す。
    console.error("firebase sdk load failed", error);
    el.controls.hidden = true;
    mapApp.setRole("local");
    showFallback();
    return;
  }
  mapApp.setRole("viewer");
  mapApp.onLocalChange(handleLocalChange);
  mapApp.setUnloadGuard(hasUnsavedWork);
  const firebaseApp = connectFirestore();
  setupHistoryUi();
  window.setTimeout(() => { if (!state.initialShown) showFallback(); }, FIRST_SNAPSHOT_TIMEOUT_MS);
  sdk.onSnapshot(mapRef, { includeMetadataChanges: true }, handleSnapshot, (error) => {
    console.error("map snapshot failed", error);
    showFallback();
  });
  connectAuth(firebaseApp);
  setupLoginUi();
  document.getElementById("saveInitialViewButton").addEventListener("click", saveInitialView);
  sdk.onAuthStateChanged(auth, handleAuthChanged);
}
window.addEventListener("online", () => { state.online = true; refreshUi(); });
window.addEventListener("offline", () => { state.online = false; refreshUi(); });
start();
