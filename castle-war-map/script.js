(function(){
  "use strict";

  // ---- 色定義 ----
  var COLORS = {
    navy:      "#1d4e79",
    gray:      "#8f8f8f",
    blue:      "#1f6fd6",
    red:       "#e2231a",
    lightgray: "#e7e7e7",
    stf:       "#f1c40f",
    ydk:       "#4f9d69",
    third:     "#8e5cd9",
    white:     "#ffffff"
  };
  var COLOR_LABELS = {
    navy: "太陽城",
    gray: "防衛リング",
    blue: "拠点",
    red: "レッドゾーン",
    lightgray: "未区分",
    stf: "STF",
    ydk: "YDK",
    third: "第3同盟",
    white: "(白)"
  };
  var STORAGE_KEY = "castle_redzone_map_v6";
  var META_KEY = "castle_redzone_map_meta_v1";
  var ALLIANCE_COLOR_KEY = "castle_redzone_map_alliance_colors_v1";

  function loadAllianceColors(){
    var defaults = { stf: COLORS.stf, ydk: COLORS.ydk, third: COLORS.third };
    try{
      var raw = localStorage.getItem(ALLIANCE_COLOR_KEY);
      if (raw){
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object"){
          if (typeof parsed.stf === "string") COLORS.stf = parsed.stf;
          if (typeof parsed.ydk === "string") COLORS.ydk = parsed.ydk;
          if (typeof parsed.third === "string") COLORS.third = parsed.third;
          return;
        }
      }
    }catch(e){ console.error("alliance color load failed", e); }
  }
  function saveAllianceColors(){
    try{
      localStorage.setItem(ALLIANCE_COLOR_KEY, JSON.stringify({ stf: COLORS.stf, ydk: COLORS.ydk, third: COLORS.third }));
    }catch(e){ console.error("alliance color save failed", e); }
  }
  loadAllianceColors();

  function defaultDateStr(){
    var d = nextEveryFourWeeks(1)[0];
    return d.getFullYear() + "/" + (d.getMonth()+1) + "/" + d.getDate();
  }

  function loadMeta(){
    var defaults = { title: "Castle War Deployment Map", date: defaultDateStr() };
    try{
      var raw = localStorage.getItem(META_KEY);
      if (raw){
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object"){
          return {
            title: (typeof parsed.title === "string" && parsed.title.length) ? parsed.title : defaults.title,
            date: (typeof parsed.date === "string" && parsed.date.length) ? parsed.date : defaults.date
          };
        }
      }
    }catch(e){ console.error("meta load failed", e); }
    return defaults;
  }

  function saveMeta(meta){
    try{
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    }catch(e){ console.error("meta save failed", e); }
  }

  var meta = loadMeta();

  // ---- 自軍陣地(東西)・STF/YDK(南北)トグル ----
  var TOGGLE_KEY = "castle_redzone_map_toggles_v1";
  function loadToggles(){
    var defaults = { ownSide: "west", stfSide: "north", allianceMode: "2" };
    try{
      var raw = localStorage.getItem(TOGGLE_KEY);
      if (raw){
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object"){
          return {
            ownSide: (parsed.ownSide === "east" || parsed.ownSide === "west") ? parsed.ownSide : defaults.ownSide,
            stfSide: (parsed.stfSide === "north" || parsed.stfSide === "south") ? parsed.stfSide : defaults.stfSide,
            allianceMode: (parsed.allianceMode === "2" || parsed.allianceMode === "3") ? parsed.allianceMode : defaults.allianceMode
          };
        }
      }
    }catch(e){ console.error("toggle load failed", e); }
    return defaults;
  }
  function saveToggles(t){
    try{ localStorage.setItem(TOGGLE_KEY, JSON.stringify(t)); }catch(e){ console.error("toggle save failed", e); }
  }
  var toggles = loadToggles();

  // ---- ホバー時のハイライト色(ネオンピンク/ネオンライムグリーン) ----
  var HOVER_COLOR_KEY = "castle_redzone_map_hover_color_v1";
  var HOVER_COLORS = { pink: "#ff2fd6", lime: "#c6ff1a", purple: "#a742ff", orange: "#ff7a00" };
  function loadHoverColorKey(){
    try{
      var v = localStorage.getItem(HOVER_COLOR_KEY);
      if (v === "pink" || v === "lime" || v === "purple" || v === "orange") return v;
    }catch(e){ console.error("hover color load failed", e); }
    return "pink";
  }
  function saveHoverColorKey(v){
    try{ localStorage.setItem(HOVER_COLOR_KEY, v); }catch(e){ console.error("hover color save failed", e); }
  }
  var hoverColorKey = loadHoverColorKey();

  // ---- マス内番号のフォントサイズ ----
  var NUMBER_SIZE_KEY = "castle_redzone_map_number_size_v1";
  function loadNumberFontSize(){
    try{
      var v = parseInt(localStorage.getItem(NUMBER_SIZE_KEY), 10);
      if (!isNaN(v) && v >= 6 && v <= 24) return v;
    }catch(e){ console.error("number size load failed", e); }
    return 16;
  }
  function saveNumberFontSize(v){
    try{ localStorage.setItem(NUMBER_SIZE_KEY, String(v)); }catch(e){ console.error("number size save failed", e); }
  }
  var numberFontSize = loadNumberFontSize();

  // ---- 第3同盟の名称(3同盟体制のときのみ使用、テキスト入力で自由に変更可) ----
  var ALLIANCE_NAME_KEY = "castle_redzone_map_third_name_v1";
  function loadAllianceName(){
    try{
      var v = localStorage.getItem(ALLIANCE_NAME_KEY);
      if (typeof v === "string" && v.length) return v;
    }catch(e){ console.error("alliance name load failed", e); }
    return "第3同盟";
  }
  function saveAllianceName(v){
    try{ localStorage.setItem(ALLIANCE_NAME_KEY, v); }catch(e){ console.error("alliance name save failed", e); }
  }
  var allianceName = loadAllianceName();

  // ---- グリッド設定 ----
  // 全体は14×14マス。太陽城(中心)は4×4マス(列・行ともに中央の5〜8番目)。
  var GRID_N = 14;            // 全体: 0..13 (14マス)
  var CORE_MIN = 5, CORE_MAX = 8; // 中心4×4マスの範囲(列・行とも)
  var HW = 30, HH = 30;       // セル半幅・半高
  var CX = 450, CY = 470;     // 中心座標
  var HALF = (GRID_N - 1) / 2; // 6.5 (グリッド中心オフセット / 画面配置用)
  var CORE_HALF = (CORE_MAX - CORE_MIN + 1) / 2; // 4マス幅の半分 = 2
  var CORE_CENTER = (CORE_MIN + CORE_MAX) / 2;    // 太陽城の中心座標 = 6.5

  function toScreen(x, y){
    return {
      x: CX + (x - y) * HW,
      y: CY + (x + y) * HH
    };
  }

  function cellPolygon(col, row){
    var pts = [
      toScreen(col - HALF - 0.5, row - HALF - 0.5),
      toScreen(col - HALF + 0.5, row - HALF - 0.5),
      toScreen(col - HALF + 0.5, row - HALF + 0.5),
      toScreen(col - HALF - 0.5, row - HALF + 0.5)
    ];
    return pts.map(function(p){ return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" ");
  }

  function isCore(col, row){
    return col >= CORE_MIN && col <= CORE_MAX && row >= CORE_MIN && row <= CORE_MAX;
  }

  // 各マスの属性(色・ロック有無・陣営区分)をまとめて判定する
  // - 太陽城(中心4×4): navy / ロック
  // - その外周1マス: グレー(東西南北の頂点4マスだけ拠点=青)/ ロックなし
  // - それより外側の南北の中央ライン(1マス幅、太陽城中心を貫く): red / ロック
  // - それより外側の東西の中央ライン(1マス幅): デフォルトはグレー(未ロック・塗り替え可)
  // - それ以外: side(east/west)・vert(north/south)を判定(テーブル分類・トグル用。デフォルト表示は未区分)
  function cellSpec(col, row){
    if (isCore(col, row)){
      return { locked: true, forced: "navy" };
    }

    var a = col - CORE_CENTER, b = row - CORE_CENTER; // 太陽城中心からのオフセット
    var ring = Math.round(Math.max(Math.abs(a), Math.abs(b)) - CORE_HALF + 0.5) - 1;
    if (ring < 0) ring = 0;

    var side = (a - b) > 0 ? "east" : "west";   // dx>0=東, dx<0=西
    var vert = (a + b) < 0 ? "north" : "south"; // dy<0=北, dy>=0=南

    if (ring === 0){
      var isCorner = Math.abs(a) === Math.abs(b); // 東西南北の頂点(拠点)
      return { locked: true, forced: isCorner ? "blue" : "gray", ring0: true, corner: isCorner, side: side, vert: vert, baseColor: isCorner ? "blue" : "gray" };
    }

    // 南北の中央ライン(太陽城の中心を通る1マス幅の縦ライン)→ レッドゾーン・ロック
    if (col === row){
      return { locked: true, forced: "red" };
    }

    // 東西の中央ライン(太陽城の中心を通る1マス幅の横ライン)→ デフォルトはグレー(ロックなし)
    var onEWLine = (a + b === 0);

    return { locked: false, forced: null, ring0: false, side: side, vert: vert, onEWLine: onEWLine, ring: ring, a: a, b: b };
  }

  // 未塗装マスの表示色(初期状態ではSTF/YDKには自動着色しない)
  function unpaintedColor(spec){
    if (spec.ring0) return spec.baseColor;     // 防衛リング/拠点は固定
    if (spec.onEWLine) return "gray";          // 東西の中央ラインは既定でグレー
    return "lightgray";                        // それ以外は未区分(クリックでSTF/YDK等を配置)
  }

  // マスの陣営区分ラベル(テーブル分類用・トグル設定に応じる): "stf" | "ydk" | "third" | "other"
  function zoneLabel(col, row, spec){
    if (toggles.allianceMode === "3" && isThirdZoneCell(col, row)) return "third";
    if (spec.side === toggles.ownSide){
      return (spec.vert === toggles.stfSide) ? "stf" : "ydk";
    }
    return "other";
  }

  // 「陣地(自軍側の無地エリア)」を押したときに自動で塗る色。該当しないマスはnull(パレット操作で通常通り塗る)
  function autoZoneColor(col, row, spec){
    if (spec.ring0) return null; // 防衛リング・拠点は常に対象外(第3同盟エリアより優先)
    var inThird = toggles.allianceMode === "3" && isThirdZoneCell(col, row);
    if (spec.onEWLine){
      return inThird ? "third" : null; // 東西ラインは、3同盟体制かつ第3同盟エリア内のときだけ変更可
    }
    if (inThird) return "third";
    if (spec.side === toggles.ownSide){
      return (spec.vert === toggles.stfSide) ? "stf" : "ydk";
    }
    return null; // 敵陣側は自動着色の対象外
  }

  // ---- 自国側のマスへの通し番号 ----
  // 自国側(東西トグルで選ばれている方)だけを対象に、STF/YDKの区別なく行(row)ごとに上から下、
  // 各行は左から右へ採番する(1から詰めて歯抜けなし)。デフォルト設定では列0・行1が1になる。
  var cellNumbers = {};
  var numberToKey = {};
  function recomputeNumbering(){
    cellNumbers = {};
    numberToKey = {};
    var cells = [];
    for (var col = 0; col < GRID_N; col++){
      for (var row = 0; row < GRID_N; row++){
        var spec = cellSpec(col, row);
        if (spec.locked) continue;
        if (spec.side !== toggles.ownSide) continue;
        if (spec.onEWLine && toggles.allianceMode !== "3") continue; // 2同盟体制では東西ラインは採番不要
        cells.push({ col: col, row: row });
      }
    }
    cells.sort(function(x, y){
      if (x.row !== y.row) return x.row - y.row; // 行ごとに上から下へ
      return x.col - y.col;                       // 各行の中は左から右へ
    });
    cells.forEach(function(c, idx){
      var key = c.col + "_" + c.row;
      var n = idx + 1;
      cellNumbers[key] = n;
      numberToKey[n] = key;
    });
  }
  recomputeNumbering();

  // ---- 3同盟体制:第3同盟の割当マス(番号ではなく位置ベース。ナンバリングを変えてもズレない) ----
  // 自国側の対角にあたらない方の隅の5×5ブロック(ロック対象マスを含まない):
  //   自国=西 → 列0-4・行9-13 / 自国=東 → 列9-13・行0-4
  function isThirdZoneCell(col, row){
    if (toggles.ownSide === "west"){
      return col <= 4 && row >= 9;
    }
    return col >= 9 && row <= 4;
  }

  function loadState(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw){
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
    }catch(e){ console.error("load failed", e); }
    return {};
  }

  function saveState(state){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }catch(e){ console.error("save failed", e); }
  }

  var state = loadState();

  var svgns = "http://www.w3.org/2000/svg";
  var svg = document.getElementById("mapSvg");

  function clearSvg(){
    while(svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function el(tag, attrs){
    var e = document.createElementNS(svgns, tag);
    for (var k in attrs){ e.setAttribute(k, attrs[k]); }
    return e;
  }

  function render(){
    clearSvg();

    // 背景
    svg.appendChild(el("rect", {x:0,y:0,width:900,height:900,fill:"#ffffff"}));

    // 背景の点線グリッド(縦横)
    var gGuides = el("g", {stroke:"#cfd6dc", "stroke-width":1, "stroke-dasharray":"1,4"});
    for (var gx = 40; gx <= 860; gx += 40){
      gGuides.appendChild(el("line", {x1:gx,y1:20,x2:gx,y2:880}));
    }
    for (var gy = 40; gy <= 880; gy += 40){
      gGuides.appendChild(el("line", {x1:20,y1:gy,x2:860,y2:gy}));
    }
    svg.appendChild(gGuides);

    // 外枠の点線(赤・青の基準線ふう)
    svg.appendChild(el("line", {x1:CX,y1:18,x2:CX,y2:882, stroke:"#e2231a","stroke-width":1,"stroke-dasharray":"1,4",opacity:0.5}));
    svg.appendChild(el("line", {x1:18,y1:CY,x2:882,y2:CY, stroke:"#1f6fd6","stroke-width":1,"stroke-dasharray":"1,4",opacity:0.5}));
    svg.appendChild(el("rect", {x:20,y:20,width:840,height:842, fill:"none", stroke:"#cfd6dc","stroke-width":1,"stroke-dasharray":"1,4"}));

    // グリッド本体
    var gCells = el("g", {});
    var gNumbers = el("g", {});
    var hoverHighlight = el("polygon", {
      points: "",
      fill: "none",
      stroke: HOVER_COLORS[hoverColorKey],
      "stroke-width": 3,
      "pointer-events": "none",
      style: "display:none; filter:drop-shadow(0 0 5px " + HOVER_COLORS[hoverColorKey] + ");"
    });
    for (var col = 0; col < GRID_N; col++){
      for (var row = 0; row < GRID_N; row++){
        var key = col + "_" + row;
        var spec = cellSpec(col, row);
        var locked = spec.locked;
        var colorKey = locked ? spec.forced : (Object.prototype.hasOwnProperty.call(state, key) ? state[key] : unpaintedColor(spec));
        var cellClass = "cell" + (locked ? " locked" : "");
        var poly = el("polygon", {
          points: cellPolygon(col, row),
          fill: COLORS[colorKey] || COLORS.lightgray,
          stroke: "#aaaaaa",
          "stroke-width": 1,
          class: cellClass,
          "data-key": key,
          "data-locked": locked ? "1" : "0"
        });
        poly.addEventListener("mouseenter", function(ev){
          hoverHighlight.setAttribute("points", ev.currentTarget.getAttribute("points"));
          hoverHighlight.style.display = "";
        });
        poly.addEventListener("mouseleave", function(){
          hoverHighlight.style.display = "none";
        });
        poly.addEventListener("click", function(ev){
          if (ev.currentTarget.getAttribute("data-locked") === "1") return; // 太陽城・中央ラインはロック中
          var k = ev.currentTarget.getAttribute("data-key");
          var kp = k.split("_");
          var kCol = parseInt(kp[0], 10), kRow = parseInt(kp[1], 10);
          var cSpec = cellSpec(kCol, kRow);
          var auto = autoZoneColor(kCol, kRow, cSpec);
          if (auto){
            // 自国陣地の無地エリア: 押すと自動でSTF/YDK/第3同盟色、同じ状態でもう一度押すとデフォルトに戻る
            if (state[k] === auto) delete state[k];
            else state[k] = auto;
            saveState(state);
            render();
          }
        });
        gCells.appendChild(poly);

        // 通し番号(中心の防衛リング・拠点は対象外、自国側のマスのみ表示)
        var showNumber = !locked && !spec.ring0 && spec.side === toggles.ownSide && (!spec.onEWLine || toggles.allianceMode === "3");
        if (showNumber){
          var pts = cellPolygon(col, row).split(" ").map(function(s){
            var xy = s.split(",");
            return { x: parseFloat(xy[0]), y: parseFloat(xy[1]) };
          });
          var cxCell = (pts[0].x + pts[2].x) / 2;
          var cyCell = (pts[0].y + pts[2].y) / 2;

          var numText = el("text", {
            x: cxCell, y: cyCell + numberFontSize * 0.35,
            "text-anchor":"middle",
            "font-size":numberFontSize,
            fill:"#222222",
            class:"cell-number"
          });
          numText.textContent = cellNumbers[key];
          gNumbers.appendChild(numText);
        }
      }
    }
    svg.appendChild(gCells);
    svg.appendChild(gNumbers);
    svg.appendChild(hoverHighlight);

    // 中心ラベル(太陽城4×4マスの中央)
    var labelPos = toScreen(CORE_CENTER - HALF, CORE_CENTER - HALF);
    var t = el("text", {
      x: labelPos.x, y: labelPos.y + 6,
      "text-anchor":"middle",
      "font-size":22,
      "font-weight":"bold",
      fill:"#ffffff",
      "font-family":"inherit"
    });
    t.textContent = "太陽城";
    svg.appendChild(t);

    // 陣地ラベル(空白コーナーに大きく表示: STF/YDK、3同盟体制なら第3同盟も自国側の先端付近に)
    function zoneBadge(cx, cy, label, color, w, h){
      var g = el("g", {});
      g.appendChild(el("rect", {
        x: cx - w/2, y: cy - h/2, width: w, height: h, rx: 10, ry: 10,
        fill: color, opacity: 0.92
      }));
      var baseSize = h > 50 ? 20 : 16;
      var fitSize = Math.floor((w - 12) / Math.max(1, String(label).length) * 1.7);
      var fontSize = Math.max(9, Math.min(baseSize, fitSize));
      var t2 = el("text", {
        x: cx, y: cy + fontSize * 0.35,
        "text-anchor":"middle",
        "font-size": fontSize,
        "font-weight":"bold",
        fill:"#ffffff"
      });
      t2.textContent = label;
      g.appendChild(t2);
      return g;
    }

    var westSide = (toggles.ownSide === "west");
    var stfIsNorth = (toggles.stfSide === "north");
    var topCorner = { x: 150, y: 150 };
    var bottomCorner = { x: 150, y: 790 };
    if (!westSide){ topCorner.x = 750; bottomCorner.x = 750; }

    var stfCorner = stfIsNorth ? topCorner : bottomCorner;
    var ydkCorner = stfIsNorth ? bottomCorner : topCorner;

    svg.appendChild(zoneBadge(stfCorner.x, stfCorner.y, "STF", COLORS.stf, 110, 54));
    svg.appendChild(zoneBadge(ydkCorner.x, ydkCorner.y, "YDK", COLORS.ydk, 110, 54));

    // タイトル・日付
    var title = el("text", {x:26, y:38, "font-size":19, "font-weight":"600", fill:"#222222"});
    title.textContent = meta.title;
    svg.appendChild(title);

    var dateText = el("text", {x:874, y:866, "text-anchor":"end", "font-size":16, fill:"#555555"});
    dateText.textContent = meta.date;
    svg.appendChild(dateText);

    var footerLeft = el("text", {x:26, y:866, "font-size":16, fill:"#555555"});
    footerLeft.textContent = "#2863";
    svg.appendChild(footerLeft);

    renderPlacementTables();
  }

  // ---- 同盟カラー設定UI ----
  var stfColorInput = document.getElementById("stfColorInput");
  var ydkColorInput = document.getElementById("ydkColorInput");
  var thirdColorInput = document.getElementById("thirdColorInput");
  stfColorInput.value = COLORS.stf;
  ydkColorInput.value = COLORS.ydk;
  thirdColorInput.value = COLORS.third;

  function refreshDots(){
    var stfDotEl = document.getElementById("stfDot");
    var ydkDotEl = document.getElementById("ydkDot");
    var thirdDotEl = document.getElementById("thirdDot");
    if (stfDotEl) stfDotEl.style.background = COLORS.stf;
    if (ydkDotEl) ydkDotEl.style.background = COLORS.ydk;
    if (thirdDotEl) thirdDotEl.style.background = COLORS.third;
  }

  stfColorInput.addEventListener("input", function(){
    COLORS.stf = stfColorInput.value;
    saveAllianceColors();
    refreshDots();
    render();
  });
  ydkColorInput.addEventListener("input", function(){
    COLORS.ydk = ydkColorInput.value;
    saveAllianceColors();
    refreshDots();
    render();
  });
  thirdColorInput.addEventListener("input", function(){
    COLORS.third = thirdColorInput.value;
    saveAllianceColors();
    refreshDots();
    render();
  });

  var numberSizeInput = document.getElementById("numberSizeInput");
  var numberSizeValue = document.getElementById("numberSizeValue");
  numberSizeInput.value = numberFontSize;
  numberSizeValue.textContent = numberFontSize;
  numberSizeInput.addEventListener("input", function(){
    numberFontSize = parseInt(numberSizeInput.value, 10);
    numberSizeValue.textContent = numberFontSize;
    saveNumberFontSize(numberFontSize);
    render();
  });

  // ---- タイトル・日付入力欄(日付は基準日から4週毎の土曜日を先3回分から選択) ----
  var titleInput = document.getElementById("titleInput");
  var dateInput = document.getElementById("dateInput");
  titleInput.value = meta.title;

  function formatDate(d){
    return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
  }
  // 基準日(前回開催日 2026/9/12)から28日ごとに数えた、今日以降の開催日を count 件返す
  // (loadMeta から早い段階で呼ばれるため、基準日は関数内に持つ)
  function nextEveryFourWeeks(count){
    var anchor = new Date(2026, 8, 12);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var elapsed = Math.round((today - anchor) / 86400000);
    var k = Math.max(0, Math.ceil(elapsed / 28));
    var results = [];
    for (var i = 0; i < count; i++){
      results.push(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + (k + i) * 28));
    }
    return results;
  }

  var dateOptions = nextEveryFourWeeks(3).map(formatDate);
  dateInput.innerHTML = "";
  dateOptions.forEach(function(dstr){
    var opt = document.createElement("option");
    opt.value = dstr;
    opt.textContent = dstr;
    dateInput.appendChild(opt);
  });
  if (dateOptions.indexOf(meta.date) === -1){
    meta.date = dateOptions[0];
    saveMeta(meta);
  }
  dateInput.value = meta.date;

  titleInput.addEventListener("input", function(){
    meta.title = titleInput.value;
    saveMeta(meta);
    render();
  });
  dateInput.addEventListener("change", function(){
    meta.date = dateInput.value;
    saveMeta(meta);
    render();
  });

  document.getElementById("resetBtn").addEventListener("click", function(){
    if (!confirm("配置(色塗り・キャラ名)をすべてクリアします。よろしいですか？")) return;
    state = {};
    saveState(state);
    names = {};
    saveNames(names);
    render();
  });

  // ---- 自国陣地・STFの位置・同盟体制 トグル ----
  function renderToggles(){
    var ownButtons = document.querySelectorAll("#ownSideToggle button");
    ownButtons.forEach(function(btn){
      btn.classList.toggle("active", btn.getAttribute("data-value") === toggles.ownSide);
    });
    var stfButtons = document.querySelectorAll("#stfSideToggle button");
    stfButtons.forEach(function(btn){
      btn.classList.toggle("active", btn.getAttribute("data-value") === toggles.stfSide);
    });
    var allianceButtons = document.querySelectorAll("#allianceModeToggle button");
    allianceButtons.forEach(function(btn){
      btn.classList.toggle("active", btn.getAttribute("data-value") === toggles.allianceMode);
    });
    document.getElementById("thirdNameInput").style.display = (toggles.allianceMode === "3") ? "" : "none";
    document.getElementById("thirdColorGroup").style.display = (toggles.allianceMode === "3") ? "" : "none";
    var hoverColorButtons = document.querySelectorAll("#hoverColorToggle button");
    hoverColorButtons.forEach(function(btn){
      btn.classList.toggle("active", btn.getAttribute("data-value") === hoverColorKey);
    });
  }
  document.querySelectorAll("#ownSideToggle button").forEach(function(btn){
    btn.addEventListener("click", function(){
      toggles.ownSide = btn.getAttribute("data-value");
      saveToggles(toggles);
      recomputeNumbering();
      renderToggles();
      render();
    });
  });
  document.querySelectorAll("#stfSideToggle button").forEach(function(btn){
    btn.addEventListener("click", function(){
      toggles.stfSide = btn.getAttribute("data-value");
      saveToggles(toggles);
      recomputeNumbering();
      renderToggles();
      render();
    });
  });
  document.querySelectorAll("#allianceModeToggle button").forEach(function(btn){
    btn.addEventListener("click", function(){
      toggles.allianceMode = btn.getAttribute("data-value");
      saveToggles(toggles);
      recomputeNumbering();
      renderToggles();
      render();
    });
  });
  document.querySelectorAll("#hoverColorToggle button").forEach(function(btn){
    btn.addEventListener("click", function(){
      hoverColorKey = btn.getAttribute("data-value");
      saveHoverColorKey(hoverColorKey);
      renderToggles();
      render();
      document.getElementById("hoverColorPopup").style.display = "none";
    });
  });

  var hoverColorLink = document.getElementById("hoverColorLink");
  var hoverColorPopup = document.getElementById("hoverColorPopup");
  hoverColorLink.addEventListener("click", function(ev){
    ev.preventDefault();
    ev.stopPropagation();
    hoverColorPopup.style.display = (hoverColorPopup.style.display === "none") ? "block" : "none";
  });
  document.addEventListener("click", function(ev){
    if (hoverColorPopup.style.display === "block" &&
        !hoverColorPopup.contains(ev.target) && ev.target !== hoverColorLink){
      hoverColorPopup.style.display = "none";
    }
  });

  var thirdNameInput = document.getElementById("thirdNameInput");
  thirdNameInput.value = allianceName;
  thirdNameInput.addEventListener("input", function(){
    allianceName = thirdNameInput.value;
    saveAllianceName(allianceName);
    render();
  });

  // ---- キャラ名の保存(番号マスごと) ----
  var NAMES_KEY = "castle_redzone_map_names_v1";
  function loadNames(){
    try{
      var raw = localStorage.getItem(NAMES_KEY);
      if (raw){
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
    }catch(e){ console.error("names load failed", e); }
    return {};
  }
  function saveNames(n){
    try{ localStorage.setItem(NAMES_KEY, JSON.stringify(n)); }catch(e){ console.error("names save failed", e); }
  }
  var names = loadNames();

  // ---- 配置一覧テーブル ----
  document.getElementById("stfDot").style.background = COLORS.stf;
  document.getElementById("ydkDot").style.background = COLORS.ydk;
  document.getElementById("thirdDot").style.background = COLORS.third;

  function buildTable(rows){
    if (!rows.length){
      var p = document.createElement("div");
      p.className = "empty-note";
      p.textContent = "配置なし";
      return p;
    }
    rows.sort(function(x, y){ return x.number - y.number; });
    var table = document.createElement("table");
    table.className = "placement-table";
    var thead = document.createElement("tr");
    ["№","キャラ名"].forEach(function(h){
      var th = document.createElement("th");
      th.textContent = h;
      thead.appendChild(th);
    });
    table.appendChild(thead);
    rows.forEach(function(r){
      var tr = document.createElement("tr");
      var tdN = document.createElement("td");
      tdN.textContent = String(r.number);
      var tdName = document.createElement("td");
      var input = document.createElement("input");
      input.type = "text";
      input.placeholder = "キャラ名を入力";
      input.value = names[r.key] || "";
      input.style.cssText = "width:100%;padding:4px 6px;border:1px solid var(--panel-border);border-radius:4px;background:var(--bg);color:var(--text);font-family:inherit;font-size:13px;";
      input.addEventListener("input", function(){
        names[r.key] = input.value;
        saveNames(names);
      });
      tdName.appendChild(input);
      tr.appendChild(tdN);
      tr.appendChild(tdName);
      table.appendChild(tr);
    });
    return table;
  }

  function computePlacementRows(){
    var stfRows = [], ydkRows = [], thirdRows = [];
    Object.keys(state).forEach(function(key){
      var parts = key.split("_");
      var col = parseInt(parts[0], 10), row = parseInt(parts[1], 10);
      var spec = cellSpec(col, row);
      if (spec.locked || spec.ring0) return; // ロック済み・防衛リング/拠点マスは配置対象外
      var row2 = { number: cellNumbers[key], key: key, name: names[key] || "" };
      var zone = zoneLabel(col, row, spec);
      if (zone === "stf") stfRows.push(row2);
      else if (zone === "ydk") ydkRows.push(row2);
      else if (zone === "third") thirdRows.push(row2);
    });
    stfRows.sort(function(x,y){ return x.number - y.number; });
    ydkRows.sort(function(x,y){ return x.number - y.number; });
    thirdRows.sort(function(x,y){ return x.number - y.number; });
    return { stf: stfRows, ydk: ydkRows, third: thirdRows };
  }

  function renderPlacementTables(){
    var rows = computePlacementRows();

    var stfHolder = document.getElementById("stfTableHolder");
    var ydkHolder = document.getElementById("ydkTableHolder");
    stfHolder.innerHTML = ""; stfHolder.appendChild(buildTable(rows.stf));
    ydkHolder.innerHTML = ""; ydkHolder.appendChild(buildTable(rows.ydk));

    var thirdCard = document.getElementById("thirdAllianceCard");
    var thirdTitle = document.getElementById("thirdAllianceTitle");
    if (toggles.allianceMode === "3"){
      thirdCard.style.display = "";
      thirdTitle.textContent = (allianceName || "第3同盟") + " 配置一覧";
      var thirdHolder = document.getElementById("thirdTableHolder");
      thirdHolder.innerHTML = ""; thirdHolder.appendChild(buildTable(rows.third));
    } else {
      thirdCard.style.display = "none";
    }
  }


  var DOWNLOAD_NAME_COUNTER_KEY = "castle_redzone_map_download_name_counts_v1";
  function loadDownloadNameCounts(){
    try{
      var raw = localStorage.getItem(DOWNLOAD_NAME_COUNTER_KEY);
      if (raw){
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
    }catch(e){ console.error("download name count load failed", e); }
    return {};
  }
  function saveDownloadNameCounts(counts){
    try{ localStorage.setItem(DOWNLOAD_NAME_COUNTER_KEY, JSON.stringify(counts)); }catch(e){ console.error("download name count save failed", e); }
  }

  var usedDownloadNames = loadDownloadNameCounts();
  function normalizeDownloadName(filename){
    var raw = String(filename || "castle_map").replace(/[\\/:*?\"<>|]/g, "_").replace(/#/g, "").trim();
    if (!raw){ raw = "castle_map"; }

    raw = raw.replace(/\s+\(\d+\)(?=\.[A-Za-z0-9]+$)/g, "");
    var extMatch = raw.match(/(\.[A-Za-z0-9]+)$/);
    var ext = extMatch ? extMatch[1] : "";
    var stem = extMatch ? raw.slice(0, -ext.length) : raw;
    stem = stem.replace(/\s+\(\d+\)$/g, "");

    while (stem && ext && stem.toLowerCase().endsWith(ext.toLowerCase())){
      stem = stem.slice(0, -ext.length);
    }
    if (!stem) stem = "castle_map";

    return { stem: stem, ext: ext };
  }

  function makeUniqueDownloadName(filename){
    var normalized = normalizeDownloadName(filename);
    var base = normalized.stem + normalized.ext;
    var key = base;
    var count = Number(usedDownloadNames[key]) || 0;
    var candidate = (count === 0) ? base : normalized.stem + " (" + count + ")" + normalized.ext;
    usedDownloadNames[key] = count + 1;
    saveDownloadNameCounts(usedDownloadNames);
    return candidate;
  }

  function makePdfName(baseName){
    var clean = String(baseName || "castle_map").replace(/[\\/:*?\"<>|]/g, "_").replace(/#/g, "").trim();
    if (!clean){ clean = "castle_map"; }
    return makeUniqueDownloadName(clean + ".pdf");
  }

  function downloadSvgString(src, filename){
    var blob = new Blob([src], {type:"image/svg+xml"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = makeUniqueDownloadName(filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  document.getElementById("downloadBtn").addEventListener("click", function(){
    try{
      var serializer = new XMLSerializer();
      var src = serializer.serializeToString(svg);
      var safeSvgTitle = (meta.title || "castle_map").replace(/[\\/:*?"<>|]/g, "_").replace(/#/g, "");
      downloadSvgString(src, safeSvgTitle + ".svg");
    }catch(e){
      console.error("download failed", e);
    }
  });

  document.getElementById("tableDownloadBtn").addEventListener("click", function(){
    try{
      var pageW = 900;
      var marginX = 40, colGap = 24, numberColW = 46, headerH = 22, rowH = 28, titleTop = 12;
      var jpFont = '"Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif';

      var rowsData = computePlacementRows();
      var sections = [
        { title: "STF 配置一覧", rows: rowsData.stf }
      ];
      sections.push({ title: "YDK 配置一覧", rows: rowsData.ydk });
      if (toggles.allianceMode === "3"){
        sections.push({ title: (allianceName || "第3同盟") + " 配置一覧", rows: rowsData.third });
      }
      var maxRows = 0;
      sections.forEach(function(s){ maxRows = Math.max(maxRows, s.rows.length || 1); });
      var tableH = titleTop + 12 + headerH + maxRows * rowH + 12;

      var exportSvg = document.createElementNS(svgns, "svg");
      exportSvg.setAttribute("viewBox", "0 0 " + pageW + " " + tableH);
      exportSvg.setAttribute("xmlns", svgns);

      var bgRect = document.createElementNS(svgns, "rect");
      bgRect.setAttribute("x", 0); bgRect.setAttribute("y", 0);
      bgRect.setAttribute("width", pageW); bgRect.setAttribute("height", tableH);
      bgRect.setAttribute("fill", "#ffffff");
      exportSvg.appendChild(bgRect);

      var colWidth = (pageW - marginX * 2 - colGap * (sections.length - 1)) / sections.length;
      sections.forEach(function(section, ci){
        var x = marginX + ci * (colWidth + colGap);
        var y = titleTop;

        var head = document.createElementNS(svgns, "text");
        head.setAttribute("x", x + 2); head.setAttribute("y", y + 13);
        head.setAttribute("font-size", 15);
        head.setAttribute("font-weight", "bold");
        head.setAttribute("font-family", jpFont);
        head.setAttribute("fill", "#141414");
        head.textContent = section.title;
        exportSvg.appendChild(head);
        y += 18;

        if (!section.rows.length){
          var emptyBox = document.createElementNS(svgns, "rect");
          emptyBox.setAttribute("x", x - 2); emptyBox.setAttribute("y", y - 3);
          emptyBox.setAttribute("width", colWidth + 4); emptyBox.setAttribute("height", 22);
          emptyBox.setAttribute("fill", "#ffffff"); emptyBox.setAttribute("stroke", "#444444"); emptyBox.setAttribute("stroke-width", 1);
          exportSvg.appendChild(emptyBox);

          var empty = document.createElementNS(svgns, "text");
          empty.setAttribute("x", x + 4); empty.setAttribute("y", y + 10);
          empty.setAttribute("font-size", 13);
          empty.setAttribute("font-family", jpFont);
          empty.setAttribute("fill", "#787878");
          empty.textContent = "配置なし";
          exportSvg.appendChild(empty);
        } else {
          var rowStartY = y;
          var tableWidth = colWidth;
          var numberColW = 46;
          var nameColW = tableWidth - numberColW;
          var headerCellHeight = 22;

          var headerRowY = rowStartY;
          var headerNumBg = document.createElementNS(svgns, "rect");
          headerNumBg.setAttribute("x", x); headerNumBg.setAttribute("y", headerRowY);
          headerNumBg.setAttribute("width", numberColW); headerNumBg.setAttribute("height", headerCellHeight);
          headerNumBg.setAttribute("fill", "#f0f0f0"); headerNumBg.setAttribute("stroke", "#8a8a8a"); headerNumBg.setAttribute("stroke-width", 1);
          exportSvg.appendChild(headerNumBg);

          var headerNameBg = document.createElementNS(svgns, "rect");
          headerNameBg.setAttribute("x", x + numberColW); headerNameBg.setAttribute("y", headerRowY);
          headerNameBg.setAttribute("width", nameColW); headerNameBg.setAttribute("height", headerCellHeight);
          headerNameBg.setAttribute("fill", "#f0f0f0"); headerNameBg.setAttribute("stroke", "#8a8a8a"); headerNameBg.setAttribute("stroke-width", 1);
          exportSvg.appendChild(headerNameBg);

          var divider = document.createElementNS(svgns, "line");
          divider.setAttribute("x1", x + numberColW); divider.setAttribute("y1", headerRowY);
          divider.setAttribute("x2", x + numberColW); divider.setAttribute("y2", headerRowY + headerCellHeight);
          divider.setAttribute("stroke", "#8a8a8a"); divider.setAttribute("stroke-width", 1);
          exportSvg.appendChild(divider);

          var headerNum = document.createElementNS(svgns, "text");
          headerNum.setAttribute("x", x + 8); headerNum.setAttribute("y", headerRowY + 15);
          headerNum.setAttribute("font-size", 12); headerNum.setAttribute("font-family", jpFont); headerNum.setAttribute("font-weight", "bold"); headerNum.setAttribute("fill", "#111111");
          headerNum.textContent = "№";
          exportSvg.appendChild(headerNum);

          var headerName = document.createElementNS(svgns, "text");
          headerName.setAttribute("x", x + numberColW + 8); headerName.setAttribute("y", headerRowY + 15);
          headerName.setAttribute("font-size", 12); headerName.setAttribute("font-family", jpFont); headerName.setAttribute("font-weight", "bold"); headerName.setAttribute("fill", "#111111");
          headerName.textContent = "キャラ名";
          exportSvg.appendChild(headerName);

          y += headerCellHeight;

          section.rows.forEach(function(r, ri){
            var rowY = y;
            var fill = "#ffffff";
            var numRect = document.createElementNS(svgns, "rect");
            numRect.setAttribute("x", x); numRect.setAttribute("y", rowY);
            numRect.setAttribute("width", numberColW); numRect.setAttribute("height", 28);
            numRect.setAttribute("fill", fill); numRect.setAttribute("stroke", "#8a8a8a"); numRect.setAttribute("stroke-width", 1);
            exportSvg.appendChild(numRect);

            var nameRect = document.createElementNS(svgns, "rect");
            nameRect.setAttribute("x", x + numberColW); nameRect.setAttribute("y", rowY);
            nameRect.setAttribute("width", nameColW); nameRect.setAttribute("height", 28);
            nameRect.setAttribute("fill", fill); nameRect.setAttribute("stroke", "#8a8a8a"); nameRect.setAttribute("stroke-width", 1);
            exportSvg.appendChild(nameRect);

            var divider2 = document.createElementNS(svgns, "line");
            divider2.setAttribute("x1", x + numberColW); divider2.setAttribute("y1", rowY);
            divider2.setAttribute("x2", x + numberColW); divider2.setAttribute("y2", rowY + 28);
            divider2.setAttribute("stroke", "#8a8a8a"); divider2.setAttribute("stroke-width", 1);
            exportSvg.appendChild(divider2);

            var numEl = document.createElementNS(svgns, "text");
            numEl.setAttribute("x", x + 8); numEl.setAttribute("y", rowY + 18);
            numEl.setAttribute("font-size", 13);
            numEl.setAttribute("font-family", jpFont);
            numEl.setAttribute("fill", "#141414");
            numEl.textContent = String(r.number);
            exportSvg.appendChild(numEl);

            var nameEl = document.createElementNS(svgns, "text");
            nameEl.setAttribute("x", x + numberColW + 8); nameEl.setAttribute("y", rowY + 18);
            nameEl.setAttribute("font-size", 13);
            nameEl.setAttribute("font-family", jpFont);
            nameEl.setAttribute("fill", "#141414");
            nameEl.textContent = r.name || "";
            exportSvg.appendChild(nameEl);

            y += 28;
          });
        }
      });

      var serializer2 = new XMLSerializer();
      var src2 = serializer2.serializeToString(exportSvg);
      var safeTableTitle = (meta.title || "castle_map").replace(/[\\/:*?"<>|]/g, "_").replace(/#/g, "");
      downloadSvgString(src2, safeTableTitle + "_table.svg");
    }catch(e){
      console.error("table download failed", e);
    }
  });

  document.getElementById("pdfBtn").addEventListener("click", function(){
    var pdfBtn = document.getElementById("pdfBtn");
    var originalLabel = pdfBtn.textContent;
    pdfBtn.textContent = "生成中...";
    pdfBtn.disabled = true;

    try{
      var serializer = new XMLSerializer();
      var src = serializer.serializeToString(svg);
      var svgBlob = new Blob([src], {type:"image/svg+xml;charset=utf-8"});
      var svgUrl = URL.createObjectURL(svgBlob);

      var img = new Image();
      img.onload = function(){
        try{
          var scale = 2; // 高解像度で出力
          var canvas = document.createElement("canvas");
          canvas.width = 900 * scale;
          canvas.height = 900 * scale;
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(svgUrl);

          var pngDataUrl = canvas.toDataURL("image/png");

          if (!window.jspdf || !window.jspdf.jsPDF){
            throw new Error("jsPDF not loaded");
          }
          var JsPdf = window.jspdf.jsPDF;
          var pdf = new JsPdf({
            orientation: "portrait",
            unit: "px",
            format: [900, 900]
          });
          pdf.addImage(pngDataUrl, "PNG", 0, 0, 900, 900);

          // ---- テーブル(STF/YDK/第3同盟)を横並び(最大3列)でページに追加(日本語文字化け対策でCanvas経由の画像として埋め込む) ----
          var rows = computePlacementRows();
          var sections = [
            { title: "STF 配置一覧", rows: rows.stf }
          ];
          sections.push({ title: "YDK 配置一覧", rows: rows.ydk });
          if (toggles.allianceMode === "3"){
            sections.push({ title: (allianceName || "第3同盟") + " 配置一覧", rows: rows.third });
          }

          var pageW = 900, pageH = 900;
          var marginX = 40, marginTop = 12, marginBottom = 20, colGap = 24, numberColW = 46, headerH = 22, rowH = 28;
          var jpFont = '"Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif';
          var colWidth = (pageW - marginX * 2 - colGap * (sections.length - 1)) / sections.length;
          var tablePage = null; // { canvas, ctx }

          function flushTablePage(){
            if (tablePage){
              var dataUrl = tablePage.canvas.toDataURL("image/png");
              pdf.addImage(dataUrl, "PNG", 0, 0, pageW, pageH);
            }
          }

          function newTablePage(){
            flushTablePage();
            pdf.addPage([pageW, pageH]);

            var canvas = document.createElement("canvas");
            canvas.width = pageW * scale;
            canvas.height = pageH * scale;
            var tctx = canvas.getContext("2d");
            tctx.fillStyle = "#ffffff";
            tctx.fillRect(0, 0, canvas.width, canvas.height);
            tctx.scale(scale, scale);
            tablePage = { canvas: canvas, ctx: tctx };
          }

          // 各列(同盟)の現在の描画Y座標と、まだ描いていない行のインデックスを列ごとに管理
          var colY = sections.map(function(){ return marginTop + 14; });
          var rowIdx = sections.map(function(){ return 0; });

          function drawColumnHeader(colIdx){
            var x = marginX + colIdx * (colWidth + colGap);
            var ctx2 = tablePage.ctx;
            ctx2.fillStyle = "#141414";
            ctx2.font = "bold 15px " + jpFont;
            ctx2.fillText(sections[colIdx].title, x + 2, colY[colIdx] + 12);
            colY[colIdx] += 18;

            var headerY = colY[colIdx];
            var nameW = colWidth - numberColW;
            ctx2.fillStyle = "#f0f0f0";
            ctx2.fillRect(x, headerY, numberColW, headerH);
            ctx2.fillRect(x + numberColW, headerY, nameW, headerH);
            ctx2.strokeStyle = "#8a8a8a";
            ctx2.lineWidth = 1;
            ctx2.strokeRect(x, headerY, numberColW, headerH);
            ctx2.strokeRect(x + numberColW, headerY, nameW, headerH);
            ctx2.beginPath();
            ctx2.moveTo(x + numberColW, headerY);
            ctx2.lineTo(x + numberColW, headerY + headerH);
            ctx2.stroke();

            ctx2.fillStyle = "#111111";
            ctx2.font = "bold 12px " + jpFont;
            ctx2.fillText("№", x + 8, headerY + 15);
            ctx2.fillText("キャラ名", x + numberColW + 8, headerY + 15);
            colY[colIdx] += headerH;

            ctx2.font = "13px " + jpFont;
            if (!sections[colIdx].rows.length){
              ctx2.fillStyle = "#ffffff";
              ctx2.fillRect(x, colY[colIdx], colWidth, rowH);
              ctx2.strokeStyle = "#8a8a8a";
              ctx2.strokeRect(x, colY[colIdx], colWidth, rowH);
              ctx2.fillStyle = "#787878";
              ctx2.fillText("配置なし", x + 6, colY[colIdx] + 18);
              colY[colIdx] += rowH;
            }
          }

          newTablePage();
          sections.forEach(function(_, colIdx){ drawColumnHeader(colIdx); });

          // 列ごとに独立して行を進め、いずれかの列が下端に達したら全列そろえて改ページする
          var anyRemaining = true;
          while (anyRemaining){
            anyRemaining = false;
            for (var ci = 0; ci < sections.length; ci++){
              var x = marginX + ci * (colWidth + colGap);
              var secRows = sections[ci].rows;
              while (rowIdx[ci] < secRows.length && colY[ci] <= pageH - marginBottom){
                var r = secRows[rowIdx[ci]];
                var ctx3 = tablePage.ctx;
                var rowY = colY[ci];
                var nameW = colWidth - numberColW;
                ctx3.fillStyle = "#ffffff";
                ctx3.fillRect(x, rowY, numberColW, rowH);
                ctx3.fillRect(x + numberColW, rowY, nameW, rowH);
                ctx3.strokeStyle = "#8a8a8a";
                ctx3.strokeRect(x, rowY, numberColW, rowH);
                ctx3.strokeRect(x + numberColW, rowY, nameW, rowH);
                ctx3.beginPath();
                ctx3.moveTo(x + numberColW, rowY);
                ctx3.lineTo(x + numberColW, rowY + rowH);
                ctx3.stroke();
                ctx3.font = "13px " + jpFont;
                ctx3.fillStyle = "#141414";
                ctx3.fillText(String(r.number), x + 8, rowY + 18);
                ctx3.fillText(r.name || "", x + numberColW + 8, rowY + 18);
                colY[ci] += rowH;
                rowIdx[ci]++;
              }
              if (rowIdx[ci] < secRows.length) anyRemaining = true;
            }
            if (anyRemaining){
              newTablePage();
              colY = sections.map(function(){ return marginTop; });
              sections.forEach(function(_, colIdx){
                var x2 = marginX + colIdx * (colWidth + colGap);
                var ctx4 = tablePage.ctx;
                ctx4.fillStyle = "#141414";
                ctx4.font = "bold 15px " + jpFont;
                ctx4.fillText(sections[colIdx].title + "(つづき)", x2, colY[colIdx]);
                colY[colIdx] += lineH * 1.3;
              });
            }
          }
          flushTablePage();

          var safeTitle = (meta.title || "castle_map").replace(/[\\/:*?"<>|]/g, "_").replace(/#/g, "");
          pdf.save(makePdfName(safeTitle));
        }catch(err){
          console.error("pdf build failed", err);
          alert("PDFの生成に失敗しました。時間をおいて再度お試しください。");
        }finally{
          pdfBtn.textContent = originalLabel;
          pdfBtn.disabled = false;
        }
      };
      img.onerror = function(){
        console.error("svg image load failed");
        alert("PDFの生成に失敗しました。");
        pdfBtn.textContent = originalLabel;
        pdfBtn.disabled = false;
        URL.revokeObjectURL(svgUrl);
      };
      img.src = svgUrl;
    }catch(e){
      console.error("pdf export failed", e);
      alert("PDFの生成に失敗しました。");
      pdfBtn.textContent = originalLabel;
      pdfBtn.disabled = false;
    }
  });

  // ---- チーム共有(db capability): 同じアーティファクトを開いた組織内メンバー間で配置を共有 ----
  var sharedDbRef = null;

  function syncInputsFromState(){
    titleInput.value = meta.title;
    if (dateOptions.indexOf(meta.date) === -1){ meta.date = dateOptions[0]; }
    dateInput.value = meta.date;
    thirdNameInput.value = allianceName;
    stfColorInput.value = COLORS.stf;
    ydkColorInput.value = COLORS.ydk;
    thirdColorInput.value = COLORS.third;
  }

  function applySharedData(data){
    if (data.state && typeof data.state === "object"){ state = data.state; saveState(state); }
    if (data.names && typeof data.names === "object"){ names = data.names; saveNames(names); }
    if (data.meta && typeof data.meta === "object"){ meta = data.meta; saveMeta(meta); }
    if (data.toggles && typeof data.toggles === "object"){ toggles = data.toggles; saveToggles(toggles); }
    if (data.colors && typeof data.colors === "object"){
      if (data.colors.stf) COLORS.stf = data.colors.stf;
      if (data.colors.ydk) COLORS.ydk = data.colors.ydk;
      if (data.colors.third) COLORS.third = data.colors.third;
      saveAllianceColors();
    }
    if (typeof data.allianceName === "string"){ allianceName = data.allianceName; saveAllianceName(allianceName); }
    recomputeNumbering();
    syncInputsFromState();
    renderToggles();
    render();
  }

  function setShareStatus(text, enabled){
    document.getElementById("shareStatus").textContent = text;
    document.getElementById("shareBtn").disabled = !enabled;
  }

  // ---- 名前を付けて保存(この端末のブラウザに複数パターンを保存・呼び出し) ----
  var SAVED_MAPS_KEY = "castle_redzone_map_saved_maps_v1";
  function loadSavedMaps(){
    try{
      var raw = localStorage.getItem(SAVED_MAPS_KEY);
      if (raw){
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
    }catch(e){ console.error("saved maps load failed", e); }
    return {};
  }
  function saveSavedMaps(m){
    try{ localStorage.setItem(SAVED_MAPS_KEY, JSON.stringify(m)); }catch(e){ console.error("saved maps save failed", e); }
  }
  function collectCurrentPayload(){
    return {
      state: state,
      names: names,
      meta: meta,
      toggles: toggles,
      colors: { stf: COLORS.stf, ydk: COLORS.ydk, third: COLORS.third },
      allianceName: allianceName,
      savedAt: new Date().toISOString()
    };
  }

  var savedMaps = loadSavedMaps();
  var savedListSelect = document.getElementById("savedListSelect");

  function refreshSavedList(){
    var names2 = Object.keys(savedMaps).sort();
    savedListSelect.innerHTML = "";
    if (!names2.length){
      var opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = "(保存なし)";
      savedListSelect.appendChild(opt0);
      return;
    }
    names2.forEach(function(n){
      var opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      savedListSelect.appendChild(opt);
    });
  }
  refreshSavedList();

  document.getElementById("saveNamedBtn").addEventListener("click", function(){
    var nameInput = document.getElementById("saveNameInput");
    var saveName = nameInput.value.trim();
    if (!saveName){
      alert("保存名を入力してください。");
      return;
    }
    if (savedMaps[saveName]) {
      savedMaps[saveName] = collectCurrentPayload();
      saveSavedMaps(savedMaps);
      refreshSavedList();
      savedListSelect.value = saveName;
      nameInput.value = "";
      alert("「" + saveName + "」を上書き保存しました。");
      return;
    }
    savedMaps[saveName] = collectCurrentPayload();
    saveSavedMaps(savedMaps);
    refreshSavedList();
    savedListSelect.value = saveName;
    nameInput.value = "";
    alert("「" + saveName + "」として保存しました。");
  });

  document.getElementById("loadNamedBtn").addEventListener("click", function(){
    var saveName = savedListSelect.value;
    if (!saveName || !savedMaps[saveName]){
      alert("読み込む保存を選択してください。");
      return;
    }
    applySharedData(savedMaps[saveName]);
    alert("「" + saveName + "」を読み込みました。");
  });

  document.getElementById("deleteNamedBtn").addEventListener("click", function(){
    var saveName = savedListSelect.value;
    if (!saveName || !savedMaps[saveName]){
      alert("削除する保存を選択してください。");
      return;
    }
    if (!confirm("「" + saveName + "」を削除します。よろしいですか？")) return;
    delete savedMaps[saveName];
    saveSavedMaps(savedMaps);
    refreshSavedList();
  });

  document.getElementById("shareBtn").addEventListener("click", function(){
    if (!sharedDbRef){
      alert("共有機能が利用できません(組織内アカウントでこのリンクを開いている場合のみ使えます)。");
      return;
    }
    var shareBtn = document.getElementById("shareBtn");
    var original = shareBtn.textContent;
    shareBtn.textContent = "共有中...";
    shareBtn.disabled = true;
    sharedDbRef.set({
      state: state,
      names: names,
      meta: meta,
      toggles: toggles,
      colors: { stf: COLORS.stf, ydk: COLORS.ydk, third: COLORS.third },
      allianceName: allianceName
    }).then(function(){
      setShareStatus("共有済み(このリンクを開いた人に反映されます)", true);
    }).catch(function(err){
      console.error("share save failed", err);
      alert("共有への保存に失敗できませんでした。閲覧のみの権限の可能性があります。");
      setShareStatus("共有: 保存に失敗しました", true);
    }).finally(function(){
      shareBtn.textContent = original;
      shareBtn.disabled = false;
    });
  });

  var SHARE_FEATURE_ENABLED = false; // 共有ボタンは一時的に非表示・無効化中

  (function initSharedDb(){
    if (!SHARE_FEATURE_ENABLED) return;
    if (typeof claude === "undefined" || !claude || typeof claude.use !== "function"){
      setShareStatus("共有機能: 利用不可(この環境では使えません)", false);
      return;
    }
    claude.use("db").then(function(dbNs){
      if (!dbNs){
        setShareStatus("共有機能: 利用不可(組織内アカウントでのみ使えます)", false);
        return;
      }
      sharedDbRef = dbNs.doc("shared/map");
      sharedDbRef.onSnapshot(function(snap){
        if (snap.exists){
          applySharedData(snap.data());
        }
        setShareStatus("共有: 有効(他の人の保存が自動反映されます)", true);
      }, function(err){
        console.error("db subscribe error", err);
        setShareStatus("共有機能: エラーが発生しました", false);
      });
    }).catch(function(e){
      console.error("db init failed", e);
      setShareStatus("共有機能: 利用不可", false);
    });
  })();

  renderToggles();
  render();
})();
