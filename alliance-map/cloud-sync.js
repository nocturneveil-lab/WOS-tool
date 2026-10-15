// Web のマップの受信と適用、保存可の自動保存、ヘッダーの保存状態と帯の表示。
import { mapApp, state, sdk, mapRef, setCloudStatus, showBanner, hideBanner, showToast, formatTime, formatDateTime, pickLayout, layoutContentKey, isSameAsLocal, applyRemoteLayout, buildSaveLayout, rememberSavedKey, mapDocument, setSettingsMessage } from "./cloud-shared.js";
import { historyTitle, addHistory, endPreview, restoreHistory } from "./cloud-history.js";
import { refreshRole } from "./cloud-auth.js";

// 最後の変更からこの時間が経ったら、まとめてWebに保存する。
const SAVE_DEBOUNCE_MS = 1000;
// このクライアントで最後に変更してからこの時間が経っていたら、保存の前に「編集開始前」の履歴を残す。
const BEFORE_EDIT_INTERVAL_MS = 10 * 60 * 1000;

// マップを丸ごと置き換える操作と、その直前に必ず残す履歴の種類。
const REPLACE_HISTORY_KINDS = { reset: "before-reset", file: "before-import" };

// Webの最新（未登録・オフライン時は default-layout.json）に戻す。表示位置は変えない。
export function revertToLatest() {
  const useRemote = state.remote && !state.showingFallback;
  const latest = useRemote ? state.remote.layout : state.fallbackLayout;
  if (latest && !applyRemoteLayout(latest, false)) return;
  if (useRemote) state.baseRev = state.remote.rev;
  state.localDirty = false;
  state.remoteChangedWhileDirty = false;
  refreshUi();
}

// ---- 表示状態の更新 ----
function refreshBanner() {
  if (state.previewing) {
    const actions = [];
    if (state.role === "saver") actions.push({ label: "この状態に復元", onClick: () => restoreHistory(state.previewing) });
    actions.push({ label: "プレビューを終了", onClick: endPreview });
    showBanner("プレビュー中：" + historyTitle(state.previewing) + "（" + formatDateTime(state.previewing.createdAt) + "）",
      actions, "preview");
    return;
  }
  const canRegister = state.role === "saver" && state.docMissing;
  const registerAction = { label: "公開用の配置をWebに登録", onClick: registerMap };
  if (state.localDirty) {
    const text = state.remoteChangedWhileDirty ? "Webで更新がありました" :
      state.role === "editor" ? "ローカル編集中（保存されません）" : "オフライン表示中の変更は保存されません";
    const actions = [{ label: "最新に戻す", onClick: revertToLatest }];
    if (canRegister) actions.push(registerAction);
    showBanner(text, actions);
    return;
  }
  if (state.showingFallback) {
    showBanner(state.docMissing ? "Webにマップが未登録のため、公開用の配置を表示しています" :
      "オフライン表示（Webに接続できないため、公開用の配置を表示しています）", canRegister ? [registerAction] : [], "offline");
    return;
  }
  hideBanner();
}
function refreshStatus() {
  if (state.role === "saver" && state.remote && !state.showingFallback) {
    const pending = state.dirty || state.saving;
    if (state.saveError) {
      // 狭い画面では「↻失敗」（赤字・押すと再試行）。
      setCloudStatus("保存失敗（押して再試行）", { short: "失敗", icon: "saving", error: true, action: { label: "再試行", onClick: saveNow } });
    } else if (!state.online) {
      setCloudStatus(pending ? "オフライン（未保存の変更あり）" : "オフライン", { short: pending ? "未保存" : "圏外", icon: "offline", error: true });
    } else if (pending) {
      setCloudStatus("保存中…", { short: "保存中", icon: "saving" });
    } else {
      const savedAt = state.lastSavedAt || state.remote.updatedAt;
      if (savedAt) setCloudStatus("保存済み " + formatTime(savedAt), { short: "保存済", icon: "saved" });
      else setCloudStatus("Web同期中", { short: "同期中", icon: "sync" });
    }
    return;
  }
  if (!state.online) setCloudStatus("オフライン", { short: "圏外", icon: "offline", error: true });
  else if (state.showingFallback) setCloudStatus("オフライン表示", { short: "未接続", icon: "offline" });
  else if (state.remote) setCloudStatus("Web同期中", { short: "同期中", icon: "sync" });
  else setCloudStatus("接続中…", { short: "接続中", icon: "saving" });
}

export function refreshUi() {
  refreshRole();
  refreshBanner();
  refreshStatus();
}

// ---- 受信 ----
let busyRetryTimer = 0;
export function processRemote() {
  // プレビュー中は適用を止め、終了後に最新を適用する。
  if (!state.remote || state.showingFallback || state.previewing) return;
  // ドラッグ中や名前入力中は、操作が終わってから適用する。
  if (mapApp.isBusy()) {
    window.clearTimeout(busyRetryTimer);
    busyRetryTimer = window.setTimeout(processRemote, 500);
    return;
  }
  if (isSameAsLocal(state.remote.layout)) {
    state.baseRev = Math.max(state.baseRev, state.remote.rev);
    if (state.localDirty) {
      state.localDirty = false;
      state.remoteChangedWhileDirty = false;
      refreshUi();
    }
    return;
  }
  if (state.localDirty) {
    state.remoteChangedWhileDirty = true;
    refreshUi();
    return;
  }
  if (state.role === "saver") {
    // 保存待ち・保存中は自分の内容で上書きするので適用しない。
    if (state.dirty || state.saving || state.saveError) return;
    // 自分が先に保存した古い内容の反映は無視する（新しい保存の反映がこのあと届く）。
    if (state.remote.own) return;
    // 自分の保存より前の版は適用しない。保存が完了した通知が、その反映（スナップショット）より先に
    // 届くことがあり、そのときに保存前の内容を適用すると自分の変更が消えてしまうため。
    if (state.remote.rev <= state.baseRev) return;
  }
  if (applyRemoteLayout(state.remote.layout, false)) state.baseRev = state.remote.rev;
}

// ---- ローカルの変更 ----
export function handleLocalChange(kind, previousLayout) {
  if (state.role === "editor" || (state.role === "saver" && (state.showingFallback || !state.remote))) {
    // editor の変更と、Webの内容をもとにしていない saver の変更は保存しない。
    state.localDirty = true;
    refreshUi();
    return;
  }
  if (state.role === "saver") {
    const now = Date.now();
    const replaceKind = REPLACE_HISTORY_KINDS[kind];
    if (replaceKind && previousLayout) {
      // リセット・JSON読み込みは、10分ルールに関係なく直前の状態（未保存の変更を含む）を必ず残す。
      state.pendingHistories.push({ kind: replaceKind, layout: buildSaveLayout(previousLayout) });
    } else if (!state.lastLocalChangeAt || now - state.lastLocalChangeAt >= BEFORE_EDIT_INTERVAL_MS) {
      // しばらくぶり（またはセッションで初めて）の変更なら、変更前のWebの状態を履歴に残す。
      state.pendingHistories.push({ kind: "before-edit", layout: state.remote.layout });
    }
    state.lastLocalChangeAt = now;
    state.dirty = true;
    scheduleSave();
    refreshUi();
  }
}

// ---- 自動保存（saver） ----
let saveTimer = 0;
export function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, SAVE_DEBOUNCE_MS);
}
export function cancelScheduledSave() {
  window.clearTimeout(saveTimer);
  state.dirty = false;
  state.saveError = false;
  state.pendingHistories = [];
}

async function saveNow() {
  window.clearTimeout(saveTimer);
  if (state.saving || state.role !== "saver" || !state.remote || state.showingFallback || state.previewing) return;
  if (!state.dirty && !state.saveError) return;
  state.dirty = false;
  state.saveError = false;
  state.saving = true;
  refreshStatus();
  const layout = buildSaveLayout();
  if (state.remote.rev > state.baseRev) {
    // 後から保存した側が優先。上書きされる内容は「編集開始前」の履歴に残し、そこから復元できるようにする。
    showToast("他の人が先に更新しました。あなたの内容で上書きします");
    if (!state.pendingHistories.some((entry) => entry.kind === "before-edit")) {
      state.pendingHistories.unshift({ kind: "before-edit", layout: state.remote.layout });
    }
  }
  try {
    // 履歴を書き込めてからマップを保存する。履歴に失敗したらマップも保存せず、再試行で両方やり直す。
    while (state.pendingHistories.length) {
      const entry = state.pendingHistories[0];
      await addHistory(entry.kind, entry.layout);
      state.pendingHistories.shift();
    }
    rememberSavedKey(layout);
    const revBeforeSave = state.remote.rev;
    await sdk.updateDoc(mapRef, { ...mapDocument(layout), rev: sdk.increment(1) });
    // 保存できた時点で、Web の rev は保存前に見ていた値より必ず大きい。
    state.baseRev = Math.max(state.baseRev, revBeforeSave + 1);
    state.lastSavedAt = new Date();
  } catch (error) {
    console.error("map save failed", error);
    state.saveError = true;
  } finally {
    state.saving = false;
  }
  if (state.dirty && !state.saveError) scheduleSave();
  refreshUi();
  if (!state.dirty && !state.saveError) processRemote();
}

// Webにマップがないとき、表示中の配置を maps/main として登録する。
async function registerMap() {
  if (state.role !== "saver" || !state.docMissing) return;
  if (!window.confirm("表示中の配置をWebに登録します。よろしいですか？")) return;
  const layout = buildSaveLayout();
  try {
    await sdk.setDoc(mapRef, { ...mapDocument(layout), rev: 1 });
    state.localDirty = false;
    state.remoteChangedWhileDirty = false;
    showToast("Webに登録しました");
  } catch (error) {
    console.error("map register failed", error);
    showToast("Webに登録できません");
  }
  refreshUi();
}
// 現在の表示位置とズームを、全員の初期表示として保存する。
export async function saveInitialView() {
  if (state.role !== "saver" || !state.remote || state.showingFallback) return;
  const view = mapApp.getLayout().view;
  try {
    await sdk.updateDoc(mapRef, {
      "view.center": view.center,
      "view.zoom": view.zoom,
      updatedAt: sdk.serverTimestamp(),
      updatedBy: state.account,
      rev: sdk.increment(1)
    });
    mapApp.setZoomBase(view.zoom);
    setSettingsMessage("現在の表示を初期表示にしました");
  } catch (error) {
    console.error("initial view save failed", error);
    setSettingsMessage("初期表示を保存できません", true);
  }
}

// 離脱警告の判定。editor はローカルの変更、saver は保存待ち（と保存されない変更）があるとき。
export function hasUnsavedWork() {
  if (state.role === "viewer") return false;
  return state.localDirty || state.dirty || state.saving || state.saveError;
}

export function handleSnapshot(snapshot) {
  if (snapshot.metadata.hasPendingWrites) return;
  if (!snapshot.exists()) {
    // キャッシュからの「存在しない」はオフラインによるもの。サーバーで確認できたときだけ未登録とみなす。
    if (!snapshot.metadata.fromCache) state.docMissing = true;
    showFallback();
    return;
  }
  const data = snapshot.data();
  const layout = pickLayout(data);
  const key = layoutContentKey(layout);
  const rev = Number.isFinite(data.rev) ? data.rev : 0;
  // 自分の保存の反映かどうか。届いた分より前の自分の保存は、もう反映済みなので忘れる。
  const savedIndex = state.recentSavedKeys.lastIndexOf(key);
  let own = false;
  if (savedIndex !== -1) {
    state.recentSavedKeys.splice(0, savedIndex + 1);
    state.baseRev = Math.max(state.baseRev, rev);
    own = true;
  } else if (state.remote && state.remote.own && state.remote.key === key) {
    own = true;
  }
  state.docMissing = false;
  state.remote = {
    layout,
    key,
    rev,
    own,
    updatedBy: data.updatedBy || "",
    updatedAt: data.updatedAt && typeof data.updatedAt.toDate === "function" ? data.updatedAt.toDate() : null
  };
  if (!state.initialShown) {
    // 初回は表示位置（view）も適用する。
    if (applyRemoteLayout(state.remote.layout, true)) {
      state.initialShown = true;
      state.baseRev = rev;
      mapApp.setStatus("");
    }
  } else if (state.showingFallback) {
    // オフライン表示中にWebへつながった。ローカルで変更していなければ初回と同じ扱いで表示する。
    state.showingFallback = false;
    if (state.localDirty && !isSameAsLocal(layout)) state.remoteChangedWhileDirty = true;
    else if (applyRemoteLayout(state.remote.layout, true)) {
      state.localDirty = false;
      state.baseRev = rev;
    }
  } else {
    processRemote();
  }
  refreshUi();
}
let fallbackLoading = null;
export function showFallback() {
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

