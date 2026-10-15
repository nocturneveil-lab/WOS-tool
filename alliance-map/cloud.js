// Alliance Map の Web 保存・リアルタイム同期（Firebase / Cloud Firestore）の起動。
// map-app.js が公開する window.AllianceMapApp を通してマップを操作する。
import { state, el, mapApp, sdk, auth, mapRef, loadSdk, connectFirestore, connectAuth, iconElement, labelElements, showToast, setSettingsMessage } from "./cloud-shared.js";
import { refreshUi, handleLocalChange, hasUnsavedWork, handleSnapshot, showFallback, saveInitialView, processRemote, cancelScheduledSave, revertToLatest } from "./cloud-sync.js";
import { setupHistoryUi, closeHistoryDialog, endPreview } from "./cloud-history.js";

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
