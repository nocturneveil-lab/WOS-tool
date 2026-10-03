// iPhoneでのダブルタップズーム防止
document.addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
let lastTouch = 0;
document.addEventListener('touchend', (e) => {
    const now = new Date().getTime();
    if (now - lastTouch <= 300) {
        if (!['INPUT', 'SELECT', 'BUTTON'].includes(e.target.tagName)) e.preventDefault();
    }
    lastTouch = now;
}, false);

// スプレッドシート連携URL
const SPREADSHEET_API_URL = "https://script.google.com/macros/s/AKfycbwWEDwwO4vSFzdOkMY6NEbqIrd-DEREvKgUg5YZTFWPODvlVHsPChv5UtlMbM9u_mCD/exec";

// 兵士データ定数
const D = {
    盾: {"なし":{T7:[7,7],T8:[8,8],T9:[9,9],T10:[10,10],T11:[12,12]},"1":{T10:[11,10],T11:[13,12]},"2":{T10:[12,11],T11:[14,13]},"3":{T10:[13,12],T11:[15,14]},"4":{T10:[13,13],T11:[15,15]},"5":{T10:[14,13],T11:[16,15]},"6":{T10:[14,13],T11:[17,16]},"7":{T10:[15,14],T11:[17,16]},"8":{T10:[15,15],T11:[18,17]},"9":{T10:[15,14],T11:[18,17]},"10":{T10:[16,15],T11:[19,18]}},
    槍: {"なし":{T7:[9,10],T8:[10,11],T9:[12,12],T10:[13,14],T11:[15,16]},"1":{T10:[14,15],T11:[16,17]},"2":{T10:[16,16],T11:[18,18]},"3":{T10:[17,17],T11:[19,19]},"4":{T10:[18,18],T11:[20,20]},"5":{T10:[20,19],T11:[22,22]},"6":{T10:[21,20],T11:[23,22]},"7":{T10:[22,21],T11:[24,24]},"8":{T10:[23,22],T11:[25,24]},"9":{T10:[24,22],T11:[27,25]},"10":{T10:[25,23],T11:[28,26]}},
    弓: {"なし":{T7:[9,10],T8:[10,11],T9:[12,12],T10:[14,15],T11:[16,17]},"1":{T10:[15,16],T11:[17,18]},"2":{T10:[17,17],T11:[19,19]},"3":{T10:[18,18],T11:[20,20]},"4":{T10:[19,19],T11:[21,21]},"5":{T10:[21,20],T11:[23,22]},"6":{T10:[22,21],T11:[24,23]},"7":{T10:[23,22],T11:[25,24]},"8":{T10:[24,23],T11:[26,25]},"9":{T10:[25,23],T11:[28,26]},"10":{T10:[26,24],T11:[30,27]}}
};

// 状態管理
let isP = {I:1,L:1,A:1}, cur = {I:33000,L:33000,A:34000};
let memberData = { ruby: { tr: 100000, fc: "4", t: "T10" }, junk: { tr: 100000, fc: "5", t: "T10" } };
let currentMember = "ruby";

// 初期化
async function it() {
    const fcs = ["なし","1","2","3","4","5","6","7","8","9","10"];
    const tiers = ["T7","T8","T9","T10","T11"];
    document.querySelectorAll('[id^="fc"]').forEach(s => { fcs.forEach(f => s.add(new Option("FC "+f,f))); });
    document.querySelectorAll('select[id^="t"]').forEach(s => { tiers.forEach(t => s.add(new Option(t,t))); });
    await fetchData();
}

// スプレッドシートからのデータ取得
async function fetchData() {
    try {
        const response = await fetch(SPREADSHEET_API_URL);
        const data = await response.json();
        if(data.ruby) memberData.ruby.tr = data.ruby;
        if(data.junk) memberData.junk.tr = data.junk;
    } catch (e) { console.warn("スプシ連携スキップ"); }
    applyMemberSettings();
}

// メンバー設定の反映
function applyMemberSettings() {
    const config = memberData[currentMember];
    document.getElementById('tr').value = config.tr;
    document.querySelectorAll('[id^="fc"]').forEach(s => s.value = config.fc);
    document.querySelectorAll('select[id^="t"]').forEach(s => s.value = config.t);
    sy();
}

// エディション切り替え
function toggleEdition() {
    document.body.classList.toggle('junk-theme');
    currentMember = document.body.classList.contains('junk-theme') ? "junk" : "ruby";
    document.getElementById('editionLabel').innerText = (currentMember === "junk" ? "じゃんく" : "るびぃ") + "edition";
    applyMemberSettings();
}

// 入力補助関数
function cl(e) { e.value = ""; }
function re(e) { if(e.value==="") e.value="0.0"; sy(); }
function vM(e) { if(e.value < 0) e.value = 0; }
function st(v) { let r = document.getElementById('tr'); r.value = Math.max(0, parseInt(r.value) + v); sy(); }

// 割合・人数の同期と100%制御
function sy() {
    const tot = parseInt(document.getElementById('tr').value);
    document.getElementById('tDisp').innerText = tot.toLocaleString();
    let sumP = 0;
    ['I','L','A'].forEach(t => { 
        let val = parseFloat(document.getElementById('i'+t).value)||0;
        if(isP[t] && (sumP + val > 100)) { val = 100 - sumP; document.getElementById('i'+t).value = val; }
        if(isP[t]) cur[t] = Math.floor(tot * val / 100);
        sumP += Math.round(cur[t]/tot*100);
        document.getElementById('r'+t).value = isP[t] ? val : Math.round(cur[t]/tot*100);
    });
    document.getElementById('remDisp').innerText = `残り：${Math.max(0, 100 - sumP)}%`;
    ['I','L','A'].forEach(t => { document.getElementById('s'+t).innerText = `→ ${cur[t].toLocaleString()}`; });
    calc();
}

// スライダー操作時の処理
function sl(t) {
    let val = parseInt(document.getElementById('r'+t).value);
    if(isP[t]) {
        let others = ['I','L','A'].filter(x => x !== t).reduce((sum, x) => sum + (isP[x] ? (parseInt(document.getElementById('i'+x).value)||0) : 0), 0);
        if(others + val > 100) val = 100 - others;
    }
    document.getElementById('i'+t).value = val;
    document.getElementById('r'+t).value = val;
    hi(t);
}

// 兵士割合のプラスマイナスボタン（今回修正箇所）
function st_pct(t, v) {
    let input = document.getElementById('i'+t);
    let val = Math.max(0, (parseInt(input.value) || 0) + v);
    document.getElementById('r'+t).value = val;
    sl(t);
}

// モード切り替え（割合/人数）
function tg(t) {
    isP[t] = !isP[t];
    const b = document.getElementById('m'+t), tot = parseInt(document.getElementById('tr').value);
    b.innerText = isP[t]?"割合":"人数"; b.classList.toggle('active', isP[t]);
    document.getElementById('i'+t).value = isP[t]?Math.round(cur[t]/tot*100):cur[t];
    sy();
}

// 手動入力時の反映
function hi(t) {
    const tot = parseInt(document.getElementById('tr').value), v = parseFloat(document.getElementById('i'+t).value)||0;
    cur[t] = isP[t]?Math.floor(tot*(v/100)):v; sy();
}

// ダメージ計算メインロジック
function calc() {
    let lb = "<span class='log-head'>1. 基礎ステータス</span>\n";
    let lc = "<span class='log-head'>2. バフ適用係数</span>\n";
    let ld = "<span class='log-head'>3. 各兵種ダメージ</span>\n";
    const tot = parseInt(document.getElementById('tr').value);
    
    const process = (row, key, atkId, kilId) => {
        const fc = document.getElementById('fc'+row).value, 
              t = document.getElementById('t'+row).value,
              b = (D[key][fc] && D[key][fc][t]) ? D[key][fc][t] : D[key]["なし"][t],
              a = parseFloat(document.getElementById(atkId).value)||0, 
              k = parseFloat(document.getElementById(kilId).value)||0,
              base = b[0] * b[1], 
              fA = (1 + a/100), 
              fK = (1 + k/100), 
              coeff = base * fA * fK, 
              damage = Math.sqrt(cur[row.toUpperCase()]) * coeff;
        
        lb += `${key}(${t}/${fc}): 攻${b[0]}×守${b[1]}=${base}\n`;
        lc += `${key}: ${base}×攻${fA.toFixed(2)}×殺${fK.toFixed(2)}=係数:${coeff.toFixed(1)}\n`;
        ld += `${key}: √${cur[row.toUpperCase()].toLocaleString()}×${coeff.toFixed(1)}=${Math.floor(damage).toLocaleString()}\n`;
        return {dmg: damage, m: coeff};
    };

    const rI = process('i','盾','bAi','bKi');
    const rL = process('l','槍','bAl','bKl');
    const rA = process('a','弓','bAa','bKa');

    document.getElementById('resDmg').innerText = Math.floor(rI.dmg + rL.dmg + rA.dmg).toLocaleString();
    document.getElementById('log').innerHTML = lb + lc + ld;

    const sQ = rI.m**2 + rL.m**2 + rA.m**2;
    if(sQ > 0) {
        const pI = Math.round(rI.m**2/sQ*100), pL = Math.round(rL.m**2/sQ*100), pA = 100 - pI - pL;
        document.getElementById('bT').innerText = `推奨: 盾${pI}% 槍${pL}% 弓${pA}%`;
        const bDmg = (Math.sqrt(tot * pI/100) * rI.m) + (Math.sqrt(tot * pL/100) * rL.m) + (Math.sqrt(tot * pA/100) * rA.m);
        document.getElementById('bDMG').innerText = `推奨時の推定ダメ: ${Math.floor(bDmg).toLocaleString()}`;
    }
}

// リセット機能
function rs() {
    ['bAi','bKi','bAl','bKl','bAa','bKa'].forEach(id => document.getElementById(id).value="0.0");
    document.getElementById('iI').value=33; document.getElementById('iL').value=33; document.getElementById('iA').value=34;
    applyMemberSettings();
}

window.onload = it;
