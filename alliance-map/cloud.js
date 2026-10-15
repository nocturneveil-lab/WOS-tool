// Alliance Map の Web 保存・リアルタイム同期（Firebase / Cloud Firestore）の起動。
// map-app.js が公開する window.AllianceMapApp を通してマップを操作する。
import { state, el, mapApp, sdk, auth, mapRef, loadSdk, connectFirestore, connectAuth, historyRef, showToast, formatDateTime, pickLayout, buildSaveLayout, rememberSavedKey, mapDocument, iconElement, labelElements, setSettingsMessage } from "./cloud-shared.js";
import { refreshUi, handleLocalChange, hasUnsavedWork, handleSnapshot, showFallback, saveInitialView, processRemote, scheduleSave, cancelScheduledSave, revertToLatest } from "./cloud-sync.js";

// ---- 履歴：一覧・プレビュー・復元・名前付き保存。
// 自動の履歴（名前付き保存以外）は最新のこの件数だけ残す。
const AUTO_HISTORY_LIMIT = 30;
const NAMED_HISTORY_LIMIT = 20;
const HISTORY_NAME_MAX_LENGTH = 30;
// named 以外はすべて自動の履歴として扱う（件数の上限も共通）。
const HISTORY_KIND_LABELS = {
  "before-edit": "編集開始前",
  "before-restore": "復元前",
  "before-reset": "リセット前",
  "before-import": "読み込み前",
  named: "名前付き保存"
};

// ---- 履歴 ----
export function historyTitle(entry) {
  return entry.kind === "named" ? "★ " + entry.name : HISTORY_KIND_LABELS[entry.kind] || entry.kind;
}
export async function addHistory(kind, layout, name) {
  const entry = {
    kind,
    layout: pickLayout(layout),
    createdAt: sdk.serverTimestamp(),
    createdBy: state.account
  };
  if (kind === "named") entry.name = name;
  await sdk.addDoc(historyRef, entry);
  if (kind !== "named") pruneAutoHistory().catch((error) => console.error("history prune failed", error));
}
async function fetchHistory() {
  const snapshot = await sdk.getDocs(sdk.query(historyRef, sdk.orderBy("createdAt", "desc")));
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      kind: data.kind,
      name: typeof data.name === "string" ? data.name : "",
      layout: data.layout,
      createdAt: data.createdAt && typeof data.createdAt.toDate === "function" ? data.createdAt.toDate() : null,
      createdBy: data.createdBy || ""
    };
  });
}
// 自動の履歴（名前付き保存以外）を新しい順に AUTO_HISTORY_LIMIT 件だけ残す。
async function pruneAutoHistory() {
  const entries = await fetchHistory();
  const stale = entries.filter((entry) => entry.kind !== "named").slice(AUTO_HISTORY_LIMIT);
  await Promise.all(stale.map((entry) => sdk.deleteDoc(sdk.doc(historyRef, entry.id))));
}
function setHistoryMessage(text, isError) {
  el.historyMessage.textContent = text;
  el.historyMessage.classList.toggle("error", !!isError);
}
function historyButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}
function renderHistoryList() {
  // 名前付き保存を先頭にまとめ、そのあとに自動の履歴を新しい順に並べる。
  const named = state.historyEntries.filter((entry) => entry.kind === "named");
  const auto = state.historyEntries.filter((entry) => entry.kind !== "named");
  const items = named.concat(auto).map((entry) => {
    const item = document.createElement("li");
    item.className = "history-item";
    const info = document.createElement("div");
    info.className = "history-item-info";
    const title = document.createElement("span");
    title.className = "history-item-title";
    title.textContent = historyTitle(entry);
    const meta = document.createElement("span");
    meta.className = "history-item-meta";
    meta.textContent = formatDateTime(entry.createdAt) + (entry.createdBy ? "・" + entry.createdBy : "");
    info.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "history-item-actions";
    actions.append(historyButton("プレビュー", () => startPreview(entry)));
    if (state.role === "saver") {
      actions.append(historyButton("復元", () => restoreHistory(entry)));
      if (entry.kind === "named") {
        actions.append(historyButton("名前変更", () => renameHistory(entry)));
        actions.append(historyButton("削除", () => deleteHistory(entry)));
      }
    }
    item.append(info, actions);
    return item;
  });
  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "history-empty";
    empty.textContent = "履歴はまだありません";
    items.push(empty);
  }
  el.historyList.replaceChildren(...items);
}
async function loadHistoryList() {
  setHistoryMessage("読み込み中…");
  try {
    state.historyEntries = await fetchHistory();
    setHistoryMessage("");
  } catch (error) {
    console.error("history load failed", error);
    state.historyEntries = [];
    setHistoryMessage("履歴を読み込めません", true);
  }
  renderHistoryList();
}
function openHistoryDialog() {
  if (state.role === "viewer") return;
  el.historyNameInput.value = "";
  el.historyList.replaceChildren();
  el.historyDialog.hidden = false;
  loadHistoryList();
}
function closeHistoryDialog() {
  el.historyDialog.hidden = true;
}
// 自分の画面だけで履歴の状態を表示する。プレビュー中は編集とWebの適用を止める。
function startPreview(entry) {
  if (!state.previewing) state.prePreviewLayout = mapApp.getLayout();
  try {
    mapApp.applyLayout(entry.layout, { source: "preview" });
  } catch (error) {
    console.error("history preview failed", error);
    setHistoryMessage("この履歴は表示できません: " + error.message, true);
    return;
  }
  state.previewing = entry;
  mapApp.setReadOnly(true);
  closeHistoryDialog();
  refreshUi();
}
export function endPreview() {
  if (!state.previewing) return;
  state.previewing = null;
  if (state.prePreviewLayout) mapApp.applyLayout(state.prePreviewLayout, { source: "preview" });
  state.prePreviewLayout = null;
  mapApp.setReadOnly(false);
  refreshUi();
  if (state.dirty) scheduleSave();
  processRemote();
}
export async function restoreHistory(entry) {
  if (state.role !== "saver" || !state.remote || state.showingFallback) return;
  if (!window.confirm(historyTitle(entry) + "（" + formatDateTime(entry.createdAt) + "）の状態に復元します。\n" +
      "全員のマップが置き換わります（復元前の状態は履歴に残ります）。よろしいですか？")) return;
  const layout = pickLayout(entry.layout);
  try {
    mapApp.applyLayout(layout, { source: "cloud" });
  } catch (error) {
    showToast("この履歴は復元できません: " + error.message);
    return;
  }
  // プレビューは終了し、復元した状態をそのまま表示する。
  state.previewing = null;
  state.prePreviewLayout = null;
  mapApp.setReadOnly(false);
  closeHistoryDialog();
  cancelScheduledSave();
  state.saving = true;
  refreshUi();
  try {
    await addHistory("before-restore", state.remote.layout);
    rememberSavedKey(layout);
    const revBeforeRestore = state.remote.rev;
    await sdk.updateDoc(mapRef, { ...mapDocument(layout), rev: sdk.increment(1) });
    state.baseRev = Math.max(state.baseRev, revBeforeRestore + 1);
    state.lastSavedAt = new Date();
    showToast("復元しました");
  } catch (error) {
    console.error("history restore failed", error);
    showToast("復元できません");
    state.saving = false;
    revertToLatest();
    return;
  }
  state.saving = false;
  refreshUi();
  processRemote();
}
async function saveNamedHistory() {
  if (state.role !== "saver" || !state.remote || state.showingFallback) return;
  const name = el.historyNameInput.value.trim();
  if (!name || name.length > HISTORY_NAME_MAX_LENGTH) {
    setHistoryMessage("名前は1〜" + HISTORY_NAME_MAX_LENGTH + "文字で入力してください", true);
    return;
  }
  if (state.historyEntries.filter((entry) => entry.kind === "named").length >= NAMED_HISTORY_LIMIT) {
    setHistoryMessage("名前付き保存は" + NAMED_HISTORY_LIMIT + "件までです。不要なものを削除してください", true);
    return;
  }
  el.saveNamedButton.disabled = true;
  try {
    // プレビュー中でも保存するのは自分の編集中の状態（プレビュー前の状態）。
    await addHistory("named", buildSaveLayout(state.previewing ? state.prePreviewLayout : undefined), name);
    el.historyNameInput.value = "";
    await loadHistoryList();
    setHistoryMessage("「" + name + "」を保存しました");
  } catch (error) {
    console.error("named history save failed", error);
    setHistoryMessage("保存できません", true);
  } finally {
    el.saveNamedButton.disabled = false;
  }
}
async function renameHistory(entry) {
  if (state.role !== "saver" || entry.kind !== "named") return;
  const input = window.prompt("新しい名前（" + HISTORY_NAME_MAX_LENGTH + "文字まで）", entry.name);
  if (input === null) return;
  const name = input.trim();
  if (!name || name.length > HISTORY_NAME_MAX_LENGTH) {
    setHistoryMessage("名前は1〜" + HISTORY_NAME_MAX_LENGTH + "文字で入力してください", true);
    return;
  }
  try {
    await sdk.updateDoc(sdk.doc(historyRef, entry.id), { name });
    await loadHistoryList();
  } catch (error) {
    console.error("history rename failed", error);
    setHistoryMessage("名前を変更できません", true);
  }
}
async function deleteHistory(entry) {
  if (state.role !== "saver" || entry.kind !== "named") return;
  if (!window.confirm("「" + entry.name + "」を削除します。よろしいですか？")) return;
  try {
    await sdk.deleteDoc(sdk.doc(historyRef, entry.id));
    await loadHistoryList();
  } catch (error) {
    console.error("history delete failed", error);
    setHistoryMessage("削除できません", true);
  }
}
function setupHistoryUi() {
  el.historyButton.addEventListener("click", openHistoryDialog);
  document.getElementById("closeHistory").addEventListener("click", closeHistoryDialog);
  el.historyDialog.addEventListener("click", (event) => {
    if (event.target === el.historyDialog) closeHistoryDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !el.historyDialog.hidden) closeHistoryDialog();
  });
  el.saveNamedButton.addEventListener("click", saveNamedHistory);
}


// ---- ログイン・ログアウト・権限の判定・合言葉の変更。
// 編集(保存不可)用の共有アカウント。合言葉=このアカウントのパスワード
const EDITOR_EMAIL = "editor@alliance-map.app";
// 保存可能アカウントのメールは「アカウント名 + このドメイン」で内部生成する
const SAVER_EMAIL_DOMAIN = "saver.alliance-map.app";

const ACCOUNT_NAME_PATTERN = /^[a-z0-9_-]{1,20}$/;
const ACCOUNT_NAME_KEY = "alliance_map_account_name_v1";
const LOGIN_FAILED_MESSAGE = "アカウント名または合言葉が違います";

// ログイン状態の表示とログイン・ログアウトを1つのボタンにまとめる。
export function refreshRole() {
  const button = el.accountButton;
  button.setAttribute("data-role", state.role);
  if (state.role === "viewer") {
    button.replaceChildren(iconElement("login"), ...labelElements("ログイン", "ログイン"));
    button.title = "ログイン（現在は閲覧のみ）";
  } else {
    const long = state.role === "saver" ? "保存可：" + state.account : "編集（保存不可）";
    const short = state.role === "saver" ? state.account : "編集";
    const action = document.createElement("span");
    action.className = "label-long account-action";
    action.textContent = "ログアウト";
    button.replaceChildren(iconElement(state.role === "saver" ? "user" : "edit"), ...labelElements(long, short), action);
    button.title = long + "（押すとログアウト）";
  }
  el.historyButton.hidden = state.role === "viewer";
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
  const hadUnsavedWork = hasUnsavedWork();
  state.role = next.role;
  state.account = next.account;
  if (next.role !== "saver") cancelScheduledSave();
  if (next.role === "viewer") {
    closeHistoryDialog();
    endPreview();
  }
  if (next.role === "viewer" && hadUnsavedWork) {
    // ログアウトしたら、保存されていない変更を捨ててWebの最新に戻す。
    revertToLatest();
  }
  if (next.role === "viewer") {
    state.localDirty = false;
    state.remoteChangedWhileDirty = false;
  }
  mapApp.setRole(next.role);
  refreshUi();
  processRemote();
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
  el.accountButton.addEventListener("click", () => {
    if (state.role === "viewer") {
      openLoginDialog();
      return;
    }
    // ログイン状態の表示も兼ねるボタンなので、うっかり押してもすぐにはログアウトしない。
    // 保存されていない変更があるときは logout() 側で警告する。
    if (!hasUnsavedWork() && !window.confirm("ログアウトしますか？")) return;
    logout();
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
