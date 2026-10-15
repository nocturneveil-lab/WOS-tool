// Alliance Map の Web 保存・リアルタイム同期（Firebase / Cloud Firestore）。
// index.html の IIFE が公開する window.AllianceMapApp を通してマップを操作する。
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDq9vYAx3tiqBhNeJL0tWv0I4xyDvDeJ1Y",
  authDomain: "alliance-map-fbbf6.firebaseapp.com",
  projectId: "alliance-map-fbbf6",
  storageBucket: "alliance-map-fbbf6.firebasestorage.app",
  messagingSenderId: "378934098264",
  appId: "1:378934098264:web:e884dcd6475bf709b18d2d"
};
// 編集(保存不可)用の共有アカウント。合言葉=このアカウントのパスワード
const EDITOR_EMAIL = "editor@alliance-map.app";
// 保存可能アカウントのメールは「アカウント名 + このドメイン」で内部生成する
const SAVER_EMAIL_DOMAIN = "saver.alliance-map.app";

const SDK_BASE = "https://www.gstatic.com/firebasejs/13.0.0/";
// 最初のスナップショットがこの時間内に届かなければ default-layout.json を表示する。
const FIRST_SNAPSHOT_TIMEOUT_MS = 8000;

const mapApp = window.AllianceMapApp;

const state = {
  // 初回表示（Web または default-layout.json）を済ませたか
  initialShown: false,
  // default-layout.json を表示している（オフライン表示）
  showingFallback: false,
  // maps/main が存在しないことを確認した
  docMissing: false,
  // 最後に受信した maps/main（レイアウトとメタ情報）
  remote: null,
  online: navigator.onLine
};

const el = {
  controls: document.getElementById("cloudControls"),
  status: document.getElementById("cloudStatus"),
  banner: document.getElementById("cloudBanner"),
  bannerText: document.getElementById("cloudBannerText"),
  bannerActions: document.getElementById("cloudBannerActions"),
  toast: document.getElementById("cloudToast")
};

// ---- 表示まわり ----
function setCloudStatus(text, options) {
  el.status.textContent = text;
  el.status.classList.toggle("error", !!(options && options.error));
  if (options && options.action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = options.action.label;
    button.addEventListener("click", options.action.onClick);
    el.status.appendChild(button);
  }
}
// actions: [{label, onClick}]
function showBanner(text, actions, variant) {
  el.bannerText.textContent = text;
  el.bannerActions.replaceChildren(...(actions || []).map((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", action.onClick);
    return button;
  }));
  el.banner.className = "cloud-banner" + (variant ? " " + variant : "");
  el.banner.hidden = false;
}
function hideBanner() {
  el.banner.hidden = true;
}
let toastTimer = 0;
function showToast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.toast.hidden = true; }, 5000);
}
function formatTime(date) {
  return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}

// ---- レイアウト ----
// Firestore のドキュメントから、レイアウト形式（「ファイルに保存」と同じ形）だけを取り出す。
function pickLayout(data) {
  return {
    format: data.format,
    version: data.version,
    classifications: data.classifications,
    placements: data.placements,
    objectColors: data.objectColors,
    bearTrapLabelSize: data.bearTrapLabelSize,
    view: data.view
  };
}
// キーの順序に左右されない JSON 文字列（Firestore はマップのキー順を保たないため）。
function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  }
  return JSON.stringify(value === undefined ? null : value);
}
// 表示位置（view.center / zoom）を除いた中身の比較用キー。
function layoutContentKey(layout) {
  const view = layout.view || {};
  return stableStringify({
    classifications: layout.classifications || {},
    placements: (layout.placements || []).map((item) => [item.type, item.anchor, item.name || ""]),
    objectColors: layout.objectColors || {},
    bearTrapLabelSize: layout.bearTrapLabelSize,
    mapCols: view.mapCols,
    mapRows: view.mapRows
  });
}
function isSameAsLocal(layout) {
  return layoutContentKey(layout) === layoutContentKey(mapApp.getLayout());
}
function applyRemoteLayout(layout, initial) {
  try {
    mapApp.applyLayout(layout, { source: initial ? "cloud-initial" : "cloud" });
    return true;
  } catch (error) {
    console.error("cloud layout apply failed", error);
    showToast("Webのマップを読み込めません: " + error.message);
    return false;
  }
}

// ---- 表示状態の更新 ----
function refreshBanner() {
  if (state.showingFallback) {
    showBanner(state.docMissing ? "Webにマップが未登録のため、公開用の配置を表示しています" :
      "オフライン表示（Webに接続できないため、公開用の配置を表示しています）", [], "offline");
    return;
  }
  hideBanner();
}
function refreshStatus() {
  if (!state.online) setCloudStatus("オフライン", { error: true });
  else if (state.showingFallback) setCloudStatus("オフライン表示");
  else if (state.remote) setCloudStatus("Web同期中");
  else setCloudStatus("接続中…");
}
function refreshUi() {
  refreshBanner();
  refreshStatus();
}

// ---- 受信 ----
function processRemote() {
  if (!state.remote) return;
  if (isSameAsLocal(state.remote.layout)) return;
  applyRemoteLayout(state.remote.layout, false);
}
function handleSnapshot(snapshot) {
  if (snapshot.metadata.hasPendingWrites) return;
  if (!snapshot.exists()) {
    // キャッシュからの「存在しない」はオフラインによるもの。サーバーで確認できたときだけ未登録とみなす。
    if (!snapshot.metadata.fromCache) state.docMissing = true;
    showFallback();
    return;
  }
  const data = snapshot.data();
  state.docMissing = false;
  state.remote = { layout: pickLayout(data), rev: data.rev || 0, updatedBy: data.updatedBy || "" };
  if (!state.initialShown || state.showingFallback) {
    // 初回は表示位置（view）も適用する。オフライン表示中にWebへつながった場合も初回と同じ扱い。
    if (applyRemoteLayout(state.remote.layout, true)) {
      state.initialShown = true;
      state.showingFallback = false;
      mapApp.setStatus("");
    }
  } else {
    processRemote();
  }
  refreshUi();
}
let fallbackLoading = null;
function showFallback() {
  if (state.initialShown && !state.showingFallback) {
    refreshUi();
    return;
  }
  if (!fallbackLoading) {
    fallbackLoading = mapApp.loadDefaultLayout().then(() => {
      state.initialShown = true;
      state.showingFallback = true;
      mapApp.setStatus("");
    }).catch((error) => {
      console.error("published layout load failed", error);
      mapApp.setStatus("公開用の配置を読み込めません: " + error.message);
    }).finally(refreshUi);
  }
  refreshUi();
}

// ---- 起動 ----
async function start() {
  mapApp.attachCloud();
  el.controls.hidden = false;
  refreshUi();
  let sdk;
  try {
    const [appModule, firestoreModule] = await Promise.all([
      import(SDK_BASE + "firebase-app.js"),
      import(SDK_BASE + "firebase-firestore.js")
    ]);
    sdk = { ...appModule, ...firestoreModule };
  } catch (error) {
    // SDK を読み込めない場合は、Web に接続しない従来の動作（すべての操作が使える）に戻す。
    console.error("firebase sdk load failed", error);
    el.controls.hidden = true;
    mapApp.setRole("local");
    showFallback();
    return;
  }
  mapApp.setRole("viewer");
  const firebaseApp = sdk.initializeApp(FIREBASE_CONFIG);
  const db = sdk.initializeFirestore(firebaseApp, { ignoreUndefinedProperties: true });
  const mapRef = sdk.doc(db, "maps", "main");
  window.setTimeout(() => { if (!state.initialShown) showFallback(); }, FIRST_SNAPSHOT_TIMEOUT_MS);
  sdk.onSnapshot(mapRef, { includeMetadataChanges: true }, handleSnapshot, (error) => {
    console.error("map snapshot failed", error);
    showFallback();
  });
}
window.addEventListener("online", () => { state.online = true; refreshUi(); });
window.addEventListener("offline", () => { state.online = false; refreshUi(); });
start();
