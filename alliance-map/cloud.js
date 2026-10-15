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

const ACCOUNT_NAME_PATTERN = /^[a-z0-9_-]{1,20}$/;
const ACCOUNT_NAME_KEY = "alliance_map_account_name_v1";
const LOGIN_FAILED_MESSAGE = "アカウント名または合言葉が違います";

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
  // default-layout.json の内容（Web未登録・オフライン時の「最新」）
  fallbackLayout: null,
  online: navigator.onLine,
  // "viewer" | "editor" | "saver"
  role: "viewer",
  // saver のアカウント名
  account: "",
  // editor：ローカルで変更している
  localDirty: false,
  // editor：ローカル変更中にWebが更新された
  remoteChangedWhileDirty: false
};

let sdk = null;
let auth = null;
let db = null;
let mapRef = null;

const el = {
  controls: document.getElementById("cloudControls"),
  status: document.getElementById("cloudStatus"),
  roleBadge: document.getElementById("roleBadge"),
  loginButton: document.getElementById("loginButton"),
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

// Webの最新（未登録・オフライン時は default-layout.json）に戻す。表示位置は変えない。
function revertToLatest() {
  const latest = state.remote && !state.showingFallback ? state.remote.layout : state.fallbackLayout;
  if (latest && !applyRemoteLayout(latest, false)) return;
  state.localDirty = false;
  state.remoteChangedWhileDirty = false;
  refreshUi();
}

// ---- 表示状態の更新 ----
function refreshBanner() {
  if (state.role === "editor" && state.localDirty) {
    showBanner(state.remoteChangedWhileDirty ? "Webで更新がありました" : "ローカル編集中（保存されません）",
      [{ label: "最新に戻す", onClick: revertToLatest }]);
    return;
  }
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
function refreshRole() {
  el.roleBadge.setAttribute("data-role", state.role);
  el.roleBadge.textContent = state.role === "saver" ? "保存可：" + state.account :
    state.role === "editor" ? "編集" : "閲覧";
  el.loginButton.textContent = state.role === "viewer" ? "ログイン" : "ログアウト";
}
function refreshUi() {
  refreshRole();
  refreshBanner();
  refreshStatus();
}

// ---- 受信 ----
let busyRetryTimer = 0;
function processRemote() {
  if (!state.remote || state.showingFallback) return;
  // ドラッグ中や名前入力中は、操作が終わってから適用する。
  if (mapApp.isBusy()) {
    window.clearTimeout(busyRetryTimer);
    busyRetryTimer = window.setTimeout(processRemote, 500);
    return;
  }
  if (isSameAsLocal(state.remote.layout)) {
    if (state.role === "editor") {
      state.localDirty = false;
      state.remoteChangedWhileDirty = false;
      refreshUi();
    }
    return;
  }
  if (state.role === "editor" && state.localDirty) {
    state.remoteChangedWhileDirty = true;
    refreshUi();
    return;
  }
  applyRemoteLayout(state.remote.layout, false);
}

// ---- ローカルの変更 ----
function handleLocalChange() {
  if (state.role === "editor") {
    state.localDirty = true;
    refreshUi();
  }
}

// ---- 権限 ----
function roleForUser(user) {
  if (!user || !user.email) return { role: "viewer", account: "" };
  const email = user.email.toLowerCase();
  if (email === EDITOR_EMAIL) return { role: "editor", account: "" };
  const suffix = "@" + SAVER_EMAIL_DOMAIN;
  if (email.endsWith(suffix)) {
    const account = email.slice(0, -suffix.length);
    if (ACCOUNT_NAME_PATTERN.test(account)) return { role: "saver", account };
  }
  return null;
}
function handleAuthChanged(user) {
  const next = roleForUser(user);
  if (!next) {
    // 想定外のアカウントはログアウトして閲覧として扱う。
    sdk.signOut(auth).catch((error) => console.error("sign out failed", error));
    return;
  }
  const previousRole = state.role;
  state.role = next.role;
  state.account = next.account;
  if (previousRole !== "viewer" && next.role === "viewer" && state.localDirty) {
    // ログアウトしたら、ローカルの変更を捨ててWebの最新に戻す。
    revertToLatest();
  }
  if (next.role !== "editor") {
    state.localDirty = false;
    state.remoteChangedWhileDirty = false;
  }
  mapApp.setRole(next.role);
  refreshUi();
  processRemote();
}
function hasUnsavedWork() {
  return state.role === "editor" && state.localDirty;
}

// ---- ログイン ----
let loginMode = "editor";
function setLoginMode(mode) {
  loginMode = mode;
  el.loginTabs.forEach((tab) => {
    tab.setAttribute("aria-selected", tab.getAttribute("data-login-mode") === mode ? "true" : "false");
  });
  el.loginAccountField.hidden = mode !== "saver";
  el.loginModeNote.textContent = mode === "saver" ?
    "編集した内容はWebに自動保存され、全員の画面に反映されます。" :
    "編集はできますが、変更はこのブラウザ内だけで、Webには保存されません。";
  el.loginError.textContent = "";
}
function openLoginDialog(mode) {
  setLoginMode(mode || loginMode);
  try { el.loginAccountInput.value = localStorage.getItem(ACCOUNT_NAME_KEY) || ""; } catch (e) { /* 記憶できない環境 */ }
  el.loginPasswordInput.value = "";
  el.loginSubmit.disabled = false;
  el.loginDialog.hidden = false;
  (loginMode === "saver" && !el.loginAccountInput.value ? el.loginAccountInput : el.loginPasswordInput).focus();
}
function closeLoginDialog() {
  el.loginDialog.hidden = true;
  el.loginPasswordInput.value = "";
}
async function submitLogin(event) {
  event.preventDefault();
  const password = el.loginPasswordInput.value;
  let email = EDITOR_EMAIL;
  let account = "";
  if (loginMode === "saver") {
    account = el.loginAccountInput.value.trim().toLowerCase();
    if (!ACCOUNT_NAME_PATTERN.test(account)) {
      el.loginError.textContent = "アカウント名は半角英小文字・数字・_・- の1〜20文字で入力してください";
      return;
    }
    email = account + "@" + SAVER_EMAIL_DOMAIN;
  }
  if (password.length < 6) {
    el.loginError.textContent = "合言葉は6文字以上です";
    return;
  }
  el.loginSubmit.disabled = true;
  el.loginError.textContent = "";
  try {
    await sdk.signInWithEmailAndPassword(auth, email, password);
    if (account) {
      try { localStorage.setItem(ACCOUNT_NAME_KEY, account); } catch (e) { /* 記憶できない環境 */ }
    }
    closeLoginDialog();
  } catch (error) {
    // エラーの種類は外部に見せない。
    console.error("sign in failed", error.code);
    el.loginError.textContent = LOGIN_FAILED_MESSAGE;
  } finally {
    el.loginSubmit.disabled = false;
  }
}
async function logout() {
  if (hasUnsavedWork() && !window.confirm("ログアウトすると、保存されていない変更は失われます。よろしいですか？")) return;
  try {
    await sdk.signOut(auth);
  } catch (error) {
    console.error("sign out failed", error);
    showToast("ログアウトできません");
  }
}
function setupLoginUi() {
  el.loginButton.addEventListener("click", () => {
    if (state.role === "viewer") openLoginDialog();
    else logout();
  });
  el.loginTabs.forEach((tab) => {
    tab.addEventListener("click", () => setLoginMode(tab.getAttribute("data-login-mode")));
  });
  el.loginForm.addEventListener("submit", submitLogin);
  document.getElementById("cancelLogin").addEventListener("click", closeLoginDialog);
  el.loginDialog.addEventListener("click", (event) => {
    if (event.target === el.loginDialog) closeLoginDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !el.loginDialog.hidden) closeLoginDialog();
  });
  el.changePasswordButton.addEventListener("click", changePassword);
}

// ---- 合言葉の変更（saver） ----
function setSettingsMessage(text, isError) {
  el.settingsCloudMessage.textContent = text;
  el.settingsCloudMessage.classList.toggle("error", !!isError);
}
async function changePassword() {
  const password = el.newPasswordInput.value;
  if (password.length < 6) {
    setSettingsMessage("合言葉は6文字以上にしてください", true);
    return;
  }
  if (password !== el.newPasswordConfirmInput.value) {
    setSettingsMessage("確認用の合言葉が一致しません", true);
    return;
  }
  if (!auth.currentUser || state.role !== "saver") return;
  el.changePasswordButton.disabled = true;
  try {
    await sdk.updatePassword(auth.currentUser, password);
    el.newPasswordInput.value = "";
    el.newPasswordConfirmInput.value = "";
    setSettingsMessage("合言葉を変更しました");
  } catch (error) {
    console.error("password update failed", error.code);
    if (error.code === "auth/requires-recent-login") {
      setSettingsMessage("安全のため、もう一度ログインしてから変更してください", true);
      if (window.confirm("合言葉を変更するには、もう一度ログインする必要があります。ログアウトしてログイン画面を開きますか？")) {
        await logout();
        if (!auth.currentUser) openLoginDialog("saver");
      }
    } else if (error.code === "auth/weak-password") {
      setSettingsMessage("合言葉は6文字以上にしてください", true);
    } else {
      setSettingsMessage("合言葉を変更できません", true);
    }
  } finally {
    el.changePasswordButton.disabled = false;
  }
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
  if (!state.initialShown) {
    // 初回は表示位置（view）も適用する。
    if (applyRemoteLayout(state.remote.layout, true)) {
      state.initialShown = true;
      mapApp.setStatus("");
    }
  } else if (state.showingFallback) {
    // オフライン表示中にWebへつながった。ローカルで変更していなければ初回と同じ扱いで表示する。
    state.showingFallback = false;
    if (hasUnsavedWork()) state.remoteChangedWhileDirty = true;
    else applyRemoteLayout(state.remote.layout, true);
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
    fallbackLoading = mapApp.loadDefaultLayout().then((layout) => {
      state.fallbackLayout = layout;
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
  try {
    const [appModule, authModule, firestoreModule] = await Promise.all([
      import(SDK_BASE + "firebase-app.js"),
      import(SDK_BASE + "firebase-auth.js"),
      import(SDK_BASE + "firebase-firestore.js")
    ]);
    sdk = { ...appModule, ...authModule, ...firestoreModule };
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
  const firebaseApp = sdk.initializeApp(FIREBASE_CONFIG);
  db = sdk.initializeFirestore(firebaseApp, { ignoreUndefinedProperties: true });
  mapRef = sdk.doc(db, "maps", "main");
  window.setTimeout(() => { if (!state.initialShown) showFallback(); }, FIRST_SNAPSHOT_TIMEOUT_MS);
  sdk.onSnapshot(mapRef, { includeMetadataChanges: true }, handleSnapshot, (error) => {
    console.error("map snapshot failed", error);
    showFallback();
  });
  // ログイン状態はブラウザに保持する（browserLocalPersistence）。
  auth = sdk.initializeAuth(firebaseApp, { persistence: sdk.browserLocalPersistence });
  setupLoginUi();
  sdk.onAuthStateChanged(auth, handleAuthChanged);
}
window.addEventListener("online", () => { state.online = true; refreshUi(); });
window.addEventListener("offline", () => { state.online = false; refreshUi(); });
start();
