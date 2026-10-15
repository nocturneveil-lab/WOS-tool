// 履歴：一覧・プレビュー・復元・名前付き保存。
import { mapApp, state, el, sdk, mapRef, historyRef, showToast, formatDateTime, pickLayout, buildSaveLayout, rememberSavedKey, mapDocument } from "./cloud-shared.js";
import { refreshUi, processRemote, scheduleSave, cancelScheduledSave, revertToLatest } from "./cloud-sync.js";

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
export function closeHistoryDialog() {
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
export function setupHistoryUi() {
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

