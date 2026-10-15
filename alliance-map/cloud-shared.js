// cloud-*.js で共有する設定・状態・Firebase の接続・表示の部品・レイアウトの変換。
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDq9vYAx3tiqBhNeJL0tWv0I4xyDvDeJ1Y",
  authDomain: "alliance-map-fbbf6.firebaseapp.com",
  projectId: "alliance-map-fbbf6",
  storageBucket: "alliance-map-fbbf6.firebasestorage.app",
  messagingSenderId: "378934098264",
  appId: "1:378934098264:web:e884dcd6475bf709b18d2d"
};

const SDK_BASE = "https://www.gstatic.com/firebasejs/13.0.0/";

export const mapApp = window.AllianceMapApp;

export const state = {
  // 初回表示（Web または default-layout.json）を済ませたか
  initialShown: false,
  // default-layout.json を表示している（オフライン表示）
  showingFallback: false,
  // maps/main が存在しないことを確認した
  docMissing: false,
  // 最後に受信した maps/main（レイアウトとメタ情報）
  remote: null,
  // default-layout.json の内容（Web未登録・オフライン時の「最新」）
  fallbackLayout: null,
  online: navigator.onLine,
  // "viewer" | "editor" | "saver"
  role: "viewer",
  // saver のアカウント名
  account: "",
  // Webに保存されないローカルの変更がある（editor、またはオフライン表示中の saver）
  localDirty: false,
  // ローカル変更中にWebが更新された
  remoteChangedWhileDirty: false,
  // ---- saver の自動保存 ----
  // 保存待ちの変更がある
  dirty: false,
  saving: false,
  saveError: false,
  lastSavedAt: null,
  // ローカルの内容のもとになった maps/main の rev（衝突の検知に使う）
  baseRev: 0,
  // 自分が保存した内容のキー（自分の書き込みの反映を見分けるため。古い順）
  recentSavedKeys: [],
  // ---- 履歴 ----
  // このクライアントで最後に変更した時刻
  lastLocalChangeAt: 0,
  // 次のマップ保存の前に書き込む履歴（古い順）。[{kind, layout}]
  pendingHistories: [],
  // プレビュー中の履歴と、プレビュー前のローカルの状態
  previewing: null,
  prePreviewLayout: null,
  historyEntries: []
};

export let sdk = null;
export let auth = null;
export let mapRef = null;
export let historyRef = null;
export async function loadSdk() {
  const [appModule, authModule, firestoreModule] = await Promise.all([
    import(SDK_BASE + "firebase-app.js"),
    import(SDK_BASE + "firebase-auth.js"),
    import(SDK_BASE + "firebase-firestore.js")
  ]);
  sdk = { ...appModule, ...authModule, ...firestoreModule };
}
// maps/main とその履歴に接続する。戻り値は Firebase のアプリ（connectAuth に渡す）。
export function connectFirestore() {
  const firebaseApp = sdk.initializeApp(FIREBASE_CONFIG);
  const db = sdk.initializeFirestore(firebaseApp, { ignoreUndefinedProperties: true });
  mapRef = sdk.doc(db, "maps", "main");
  historyRef = sdk.collection(db, "maps", "main", "history");
  return firebaseApp;
}
// ログイン状態はブラウザに保持する（browserLocalPersistence）。
export function connectAuth(firebaseApp) {
  auth = sdk.initializeAuth(firebaseApp, { persistence: sdk.browserLocalPersistence });
}

export const el = {
  controls: document.getElementById("cloudControls"),
  status: document.getElementById("cloudStatus"),
  accountButton: document.getElementById("accountButton"),
  loginDialog: document.getElementById("loginDialog"),
  loginForm: document.getElementById("loginForm"),
  loginTabs: Array.from(document.querySelectorAll("[data-login-mode]")),
  loginModeNote: document.getElementById("loginModeNote"),
  loginAccountField: document.getElementById("loginAccountField"),
  loginAccountInput: document.getElementById("loginAccountInput"),
  loginPasswordInput: document.getElementById("loginPasswordInput"),
  loginError: document.getElementById("loginError"),
  loginSubmit: document.getElementById("loginSubmit"),
  newPasswordInput: document.getElementById("newPasswordInput"),
  newPasswordConfirmInput: document.getElementById("newPasswordConfirmInput"),
  changePasswordButton: document.getElementById("changePasswordButton"),
  settingsCloudMessage: document.getElementById("settingsCloudMessage"),
  historyButton: document.getElementById("historyButton"),
  historyDialog: document.getElementById("historyDialog"),
  historyList: document.getElementById("historyList"),
  historyMessage: document.getElementById("historyMessage"),
  historyNameInput: document.getElementById("historyNameInput"),
  saveNamedButton: document.getElementById("saveNamedButton"),
  banner: document.getElementById("cloudBanner"),
  bannerText: document.getElementById("cloudBannerText"),
  bannerActions: document.getElementById("cloudBannerActions"),
  toast: document.getElementById("cloudToast")
};

// ---- 表示まわり ----
// ヘッダー用の線画アイコン（固定の文字列なので innerHTML で入れてよい）。
const ICONS = {
  saved: '<path d="M5 12l5 5L20 7"/>',
  saving: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  error: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  offline: '<path d="M3 3l18 18"/><path d="M8.5 8.6A5 5 0 0 0 6 18h11"/><path d="M11 6.1A6 6 0 0 1 18 11a4 4 0 0 1 3 5.4"/>',
  sync: '<path d="M7 18a5 5 0 0 1-.4-10A7 7 0 0 1 20 10a4 4 0 0 1-1 8z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>'
};
export function iconElement(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name];
  return svg;
}
// 広い画面では long、狭い画面では short を表示する（CSS の .label-long / .label-short）。
export function labelElements(long, short) {
  const longLabel = document.createElement("span");
  longLabel.className = "label-long";
  longLabel.textContent = long;
  const shortLabel = document.createElement("span");
  shortLabel.className = "label-short";
  shortLabel.textContent = short || long;
  return [longLabel, shortLabel];
}
export function createButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}
// ダイアログの外側（背景）を押すか Esc キーで閉じる。
export function closeDialogOnDismiss(dialog, close) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dialog.hidden) close();
  });
}
// ダイアログ内のメッセージ欄（isError で赤字）。
export function setMessage(node, text, isError) {
  node.textContent = text;
  node.classList.toggle("error", !!isError);
}
// options: { short, icon, error, action:{label, onClick} }
// action があるときは、表示全体を押せるボタンにする（狭い画面でも押しやすく、幅も増えない）。
export function setCloudStatus(text, options) {
  const opts = options || {};
  const parts = [iconElement(opts.icon || "sync"), ...labelElements(text, opts.short)];
  el.status.classList.toggle("error", !!opts.error);
  el.status.title = text;
  if (opts.action) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = opts.action.label;
    button.append(...parts);
    button.addEventListener("click", opts.action.onClick);
    el.status.replaceChildren(button);
  } else {
    el.status.replaceChildren(...parts);
  }
}
// actions: [{label, onClick}]
export function showBanner(text, actions, variant) {
  el.bannerText.textContent = text;
  el.bannerActions.replaceChildren(...(actions || []).map((action) => createButton(action.label, action.onClick)));
  el.banner.className = "cloud-banner" + (variant ? " " + variant : "");
  el.banner.hidden = false;
}
export function hideBanner() {
  el.banner.hidden = true;
}
let toastTimer = 0;
export function showToast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.toast.hidden = true; }, 5000);
}
export function formatTime(date) {
  return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}
export function formatDateTime(date) {
  if (!date) return "日時不明";
  return (date.getMonth() + 1) + "/" + date.getDate() + " " + formatTime(date);
}

// ---- レイアウト ----
// Firestore のドキュメントから、レイアウト形式（「ファイルに保存」と同じ形）だけを取り出す。
export function pickLayout(data) {
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
// 受信したデータは applyLayout で検証する前にここを通るので、形が壊れていても例外を出さない。
export function layoutContentKey(layout) {
  const view = layout.view && typeof layout.view === "object" ? layout.view : {};
  const placements = Array.isArray(layout.placements) ? layout.placements : [];
  return stableStringify({
    classifications: layout.classifications || {},
    placements: placements.map((item) => item && typeof item === "object" ? [item.type, item.anchor, item.name || ""] : null),
    objectColors: layout.objectColors || {},
    bearTrapLabelSize: layout.bearTrapLabelSize,
    mapCols: view.mapCols,
    mapRows: view.mapRows
  });
}
export function isSameAsLocal(layout) {
  return layoutContentKey(layout) === layoutContentKey(mapApp.getLayout());
}
export function applyRemoteLayout(layout, initial) {
  try {
    mapApp.applyLayout(layout, { source: initial ? "cloud-initial" : "cloud" });
    return true;
  } catch (error) {
    console.error("cloud layout apply failed", error);
    showToast("Webのマップを読み込めません: " + error.message);
    return false;
  }
}

// 保存用のレイアウト。表示位置（view.center / zoom）は自分の画面ではなく、Webの初期表示を保つ。
export function buildSaveLayout(baseLayout) {
  const layout = baseLayout ? JSON.parse(JSON.stringify(baseLayout)) : mapApp.getLayout();
  const source = state.remote && !state.showingFallback ? state.remote.layout : state.fallbackLayout;
  const sharedView = source && source.view && typeof source.view === "object" ? source.view : {};
  layout.view = {
    center: sharedView.center || { x: 0, y: 0 },
    zoom: Number.isFinite(sharedView.zoom) ? sharedView.zoom : layout.view.zoom,
    mapCols: layout.view.mapCols,
    mapRows: layout.view.mapRows
  };
  return layout;
}
// ローカルの変更（Webに保存されない変更）を、なかったことにする。
export function clearLocalDirty() {
  state.localDirty = false;
  state.remoteChangedWhileDirty = false;
}

// 設定ダイアログの「初期表示」「合言葉の変更」のメッセージ欄。
export function setSettingsMessage(text, isError) {
  setMessage(el.settingsCloudMessage, text, isError);
}

