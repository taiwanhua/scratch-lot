// ==== 第十九輪:排班作業(排班表)共用的組件函式。貼在 r5-kit.js 後面一起執行 ====
// 第二十三輪:人員欄固定在左、統計欄固定在右(班數、負責班數、總工時、畫休);格子寫「休 30」;
// 自動排入改用 Draft/ScheduleAutoMark 圖示;圖例改用 Draft/LegendItem;⚙ 顯示欄位三尺寸都有;檢核「限制 / 提醒」。
// 示範資料:中山店 2026 年 11 月(未發布);11/3(二)店休;11/11 特殊日「店慶」。
const PEOPLE = [
  { n: "王小明", t: "正職 · 可負責", s: ["20", "12", "129:00", "2 天"] },
  { n: "李小華", t: "正職 · 可負責", s: ["19", "4", "120:00", "3 天"] },
  { n: "陳大文", t: "正職 · 可負責", s: ["20", "10", "159:30", "1 天"] },
  { n: "林美麗", t: "正職 · 可負責", s: ["17", "2", "109:00", "5 天"] },
  { n: "張小芳", t: "兼職", s: ["11", "0", "48:00", "0 天"] },
  // 第二十四輪後續之九:11/10 早班 5 人 + 補貨 1 人的示範,新增 3 位兼職(11/1–11/7 沒有排班)
  { n: "黃志明", t: "兼職", s: ["8", "0", "44:00", "0 天"] },
  { n: "吳佳玲", t: "兼職", s: ["8", "0", "44:00", "0 天"] },
  { n: "周家豪", t: "兼職", s: ["8", "0", "44:00", "0 天"] },
];
// 統計欄(固定在右):標題、寬度;畫休超過上限變紅(林美麗)
const STATS = [
  ["班數", 56],
  ["負責班數", 72],
  ["總工時", 72],
  ["畫休", 72],
];
const STATS_W = STATS.reduce((s, x) => s + x[1], 0);
const NARROW_W = 52; // [統計 ▸] 要完整可讀
const WEEK = [
  ["11/1", "日"],
  ["11/2", "一"],
  ["11/3", "二"],
  ["11/4", "三"],
  ["11/5", "四"],
  ["11/6", "五"],
  ["11/7", "六"],
];
// 每人每天:[種類, line1, line2];種類 f=有班 a=自動排入 o=其他分店 x=時段不可排 h=畫休 s=店休 e=空
const GRID = [
  [
    ["f", "早 ★ · 休 30", "08:30–14:30"],
    ["f", "早 ★ · 休 30", "08:00–14:30"],
    ["s"],
    ["a", "晚 ★ · 休 30", "14:30–22:00"],
    ["f", "早 ★ · 休 30", "08:30–14:30"],
    ["h", "畫休", ""],
    ["f", "早 ★ · 休 30", "08:30–14:30"],
  ],
  [
    ["f", "早 · 休 30", "08:30–14:30"],
    ["a", "晚 ★ · 休 90", "14:30–22:00"],
    ["s"],
    ["f", "早 ★ · 休 30", "08:30–14:30"],
    ["f", "晚 · 休 30", "14:30–22:00"],
    ["a", "早 · 休 30", "08:30–14:30"],
    ["f", "早 · 休 30", "08:30–14:30"],
  ],
  [
    ["f", "晚 ★ · 休 30", "14:30–22:00"],
    ["o", "已排於新竹店", "14:00–22:00"],
    ["s"],
    ["e"],
    ["f", "晚 ★ · 休 30", "14:30–22:00"],
    ["a", "晚 ★ · 休 30", "14:30–22:00"],
    ["f", "晚 ★ · 休 30", "14:30–22:00"],
  ],
  [
    ["e"],
    ["f", "早 · 休 30", "08:30–14:30"],
    ["s"],
    ["f", "早 · 休 30", "08:30–14:30"],
    ["f", "補", "13:00–17:00"],
    ["f", "早 ★ · 休 30", "08:30–14:30"],
    ["f", "晚 · 休 30", "14:30–22:00"],
  ],
  [
    ["f", "補", "13:00–17:00"],
    ["f", "補", "13:00–17:00"],
    ["s"],
    ["f", "臨", "13:00–17:00"],
    ["f", "早 · 休 30", "08:30–14:30"],
    ["x", "不可排", "09:00–13:00"],
    // 11/7 同日兩段:早 08:30–14:30(☕ 30)+ 晚 17:00–22:00 → 10.5 小時,超過「每天最多上班時數」8 小時(提醒)
    ["f", "早 + 晚 · 休 30", "08:30–14:30\n17:00–22:00"],
  ],
  ...[0, 1, 2].map(() => [["e"], ["e"], ["s"], ["e"], ["e"], ["e"], ["e"]]),
];
// 未對應排班的打卡(人-天 → 張數):王小明 11/5 有班但 3 張打卡沒對應;林美麗 11/1 沒排班臨時來(2 張);張小芳 11/4 排補貨 13:00–17:00,09:02 / 15:10 兩張超出容許範圍(出勤紀錄 SC-12 同一筆)
const PUNCH = { "0-4": 3, "3-0": 2, "4-3": 2 };
// 人力需求區(頂部固定群組列「▾ 人力需求」,取代舊的 summary-row):每個人力需求一列,格子寫「負 已排/需 協 已排/需」;
// 滿 = 灰(grey/100)、缺協同 = 橘(warning)、缺負責 = 紅(error);店休灰底。和月 / 週 / 日檢視、檢核面板同一份資料:
// 11/1、11/2、11/4、11/6 晚班缺協同;11/4 張小芳排「臨」(沒有套用範本的人力需求);
// 11/7 早班多排李小華 → 協2/1,標籤旁灰字「+1」(超過人力需求;月檢視寫「協2/1」/「早 3/2」)
const DEMAND = [
  [
    "早班",
    [
      "負1/1 協1/1",
      "負1/1 協1/1",
      0,
      "負1/1 協1/1",
      "負1/1 協1/1",
      "負1/1 協1/1",
      "負1/1 協2/1",
    ],
  ],
  ["補貨", ["協1/1", "協1/1", 0, null, "協1/1", null, null]],
  [
    "晚班",
    [
      "負1/1 協0/1",
      "負1/1 協0/1",
      0,
      "負1/1 協0/1",
      "負1/1 協1/1",
      "負1/1 協0/1",
      "負1/1 協2/2",
    ],
  ],
  ["臨", [null, null, 0, "協1/1", null, null, null]],
];
// 手機收合成一列彙總(「▸ 人力需求」,點了展開成 SC-59)
const SUMMARY = [
  ["需 5 · 已排 4", "warn", "缺 1 · 可排 1"],
  ["需 5 · 已排 4", "warn", "缺 1 · 可排 2"],
  ["店休", "off"],
  ["需 5 · 已排 4", "warn", "缺 1 · 可排 1"],
  ["需 5 · 已排 5", "full"],
  ["需 4 · 已排 3", "warn", "缺 1 · 可排 1"],
  ["需 4 · 已排 4", "full"],
];
// 格子內的小標籤:full 灰(grey/100 + divider 細框,白底上看得見;圖例「人力需求已滿」同外觀)、warn 橘(缺協同)、short 紅(缺負責)
// 第二十四輪後續之十:改用底座 Draft/StatusChip(408:8040;Tone Neutral = grey/100 + divider 細框 / Warning / Error)
async function demandChip(lines, tone) {
  const set = await figma.getNodeByIdAsync("408:8040");
  const t = { full: "Neutral", warn: "Warning", short: "Error" }[tone];
  const c = set.children
    .find((v) => v.name === `Tone=${t}, State=Default`)
    .createInstance();
  c.setProperties({
    "Label#408:13": lines[0],
    "Sub#408:23": lines[1] || " ",
    "HasSub#408:33": !!lines[1],
  });
  c.name = "status-chip";
  return c;
}
// 已排超過需要的人數:標籤旁灰字「+N」
const overBy = (s) =>
  [...(s || "").matchAll(/(\d+)\/(\d+)/g)].reduce(
    (n, m) => n + Math.max(0, +m[1] - +m[2]),
    0,
  );
async function demandCell(lines, tone, w) {
  const h = await headCell(" ", null, w, "cap", "ts", "def");
  if (lines) {
    h.children[0].remove();
    const chip = await demandChip(lines, tone);
    const over = overBy(lines[0]);
    if (over) {
      const r = row(4, "demand-over");
      add(r, chip);
      add(r, await T("+" + over, "capSB", "ts", "+1 超過"));
      add(h, r);
    } else add(h, chip);
  }
  return h;
}
// 負責沒排滿 → 紅;協同沒排滿 → 橘;都滿 → 灰
const demandTone = (s) => {
  const lack = (k) => {
    const m = new RegExp(k + "(\\d+)/(\\d+)").exec(s);
    return m && +m[1] < +m[2];
  };
  return lack("負") ? "short" : lack("協") ? "warn" : "full";
};
// stats:"full" 四欄、"narrow" 收成一個窄欄 [統計 ▸](檢核面板開著、手機)、"none"
async function rosterGrid(colW, frozenW, days = 7, stats = "full", opts = {}) {
  const D0 = opts.from || 0; // 從第幾天開始畫(手機從 11/2)
  const g = AL("VERTICAL", { name: "RosterGrid(組成)", itemSpacing: 0 });
  await fill(g, "paper");
  await stroke(g, "divider");
  const hr = row(0, "header-row", "MIN");
  add(hr, await headCell("人員", null, frozenW, "sub2", "ts"), null, "FILL");
  for (let d = 0; d < days; d++) {
    const h = await headCell(
      WEEK[d + D0][0] + " " + WEEK[d + D0][1],
      d + D0 === 2 ? "店休" : null,
      colW,
      "capSB",
      d + D0 === 2 ? "tdis" : "tp",
      d + D0 === 2 ? "g200" : null,
    );
    if (opts.dayMenu && d + D0 === 1) {
      const r = row(4, "head-top");
      for (const k of [...h.children]) {
        add(r, k);
      }
      sp(r);
      add(r, await T("⋯", "sub2", "ts", "day-menu"));
      add(h, r, "FILL");
    }
    add(hr, h, null, "FILL");
  }
  if (stats === "full")
    for (const [s, w] of STATS)
      add(hr, await headCell(s, null, w, "capSB", "ts", "def"), null, "FILL");
  if (stats === "narrow") {
    const n = await headCell("統計 ▸", null, NARROW_W, "capSB", "tp", "def");
    n.name = "stats-narrow";
    n.children[0].textAutoResize = "HEIGHT";
    n.children[0].textAlignHorizontal = "CENTER";
    n.children[0].layoutSizingHorizontal = "FILL";
    n.paddingLeft = n.paddingRight = 4;
    add(hr, n, null, "FILL");
  }
  add(g, hr);
  // 人力需求區:電腦 / 平板展開(群組列 + 每個人力需求一列);手機預設收合成一列彙總,opts.demandOpen 展開(SC-59)
  const statCells = async (r) => {
    if (stats === "full")
      for (const [, w] of STATS)
        add(r, await headCell(" ", null, w, "cap", "ts", "def"), null, "FILL");
    if (stats === "narrow")
      add(
        r,
        await headCell(" ", null, NARROW_W, "cap", "ts", "def"),
        null,
        "FILL",
      );
  };
  const collapsed = frozenW < 100 && !opts.demandOpen;
  if (collapsed) {
    const sr = row(0, "demand-area-collapsed", "MIN");
    add(
      sr,
      await headCell("▸ 人力需求", null, frozenW, "capSB", "ts", "def"),
      null,
      "FILL",
    );
    for (let d = 0; d < days; d++) {
      const [t, k, sub] = SUMMARY[d + D0];
      add(
        sr,
        k === "off"
          ? await headCell(t, null, colW, "cap", "ts", "g200")
          : await demandCell([t, sub], k, colW),
        null,
        "FILL",
      );
    }
    await statCells(sr);
    add(g, sr);
  } else {
    const ah = row(0, "demand-area-header", "MIN");
    add(
      ah,
      await headCell("▾ 人力需求", null, frozenW, "capSB", "ts", "def"),
      null,
      "FILL",
    );
    for (let d = 0; d < days; d++)
      add(
        ah,
        // 店休整欄灰:人力需求區每一列(含群組標題列)和人員列店休格同一個色票 g200
        await headCell(
          " ",
          null,
          colW,
          "cap",
          "ts",
          d + D0 === 2 ? "g200" : "def",
        ),
        null,
        "FILL",
      );
    await statCells(ah);
    add(g, ah);
    for (const [name, cells] of DEMAND) {
      const dr = row(0, "demand-row " + name, "MIN");
      add(
        dr,
        await headCell(name, null, frozenW, "capSB", "ts", "def"),
        null,
        "FILL",
      );
      for (let d = 0; d < days; d++) {
        const s = cells[d + D0];
        add(
          dr,
          s === 0
            ? await headCell(" ", null, colW, "cap", "ts", "g200")
            : await demandCell(s && [s], s && demandTone(s), colW),
          null,
          "FILL",
        );
      }
      await statCells(dr);
      add(g, dr);
    }
  }
  const marks = [];
  const punches = [];
  const hatches = [];
  for (let p = 0; p < PEOPLE.length; p++) {
    const r = row(0, "row-" + (p + 1), "MIN");
    add(
      r,
      await headCell(PEOPLE[p].n, PEOPLE[p].t, frozenW, "sub2", "tp"),
      null,
      "FILL",
    );
    for (let d = 0; d < days; d++) {
      const [k, l1, l2] = GRID[p][d + D0];
      let c;
      if (k === "e") c = await rcell("Empty");
      else if (k === "s") c = await rcell("Filled", "店休", "", { bg: "g200" });
      else if (k === "o") c = await rcell("Filled", l1, l2, { bg: "g200" });
      else if (k === "x") c = await rcell("Filled", l1, l2, { bg: "g200" });
      else if (k === "h") c = await rcell("Filled", l1, l2);
      else if (opts.sel && p === 1 && d + D0 === 3)
        c = await rcell("Selected", l1, l2);
      else c = await rcell("Filled", l1, l2);
      // 第二十四輪:負責人不用 ★,班別簡稱套綠色標籤(RosterCell 的 Lead / LeadText)
      const lead = /^(\S+) ★\s*(?:·\s*)?(.*)$/.exec(l1 || "");
      if (lead && k !== "o") {
        c.setProperties({ "Lead#319:24": true, "LeadText#319:28": lead[1] });
        await setTxt(c, "line-1", lead[2]);
      }
      // 休息:「☕ 分鐘」(RosterCell 的 Break / BreakText),不寫「休 30」;11/2 晚班李小華休 90 分
      const line1 = lead ? lead[2] : l1 || "";
      const br = /^(.*?)\s*(?:·\s*)?休 (\d+)$/.exec(line1);
      if (br) {
        await setTxt(c, "line-1", br[1]);
        c.setProperties({ "Break#350:27": true, "BreakText#350:31": br[2] });
      }
      add(r, c);
      c.layoutSizingHorizontal = "FIXED";
      c.resize(colW, 72);
      // 上方留 22px 給右上角的圖示(自動排入、未對應打卡),不蓋到文字
      if (k !== "e") c.children[0].paddingTop = 22;
      // 同日兩段(時間兩行)沒有右上角圖示,上方不留空
      if ((l2 || "").includes("\n")) c.children[0].paddingTop = 6;
      // 畫休:格子透明,底下放灰色斜線底 Draft/HatchBg(和店休 / 不可排的實心灰區分)
      if (k === "h") {
        c.fills = [];
        c.children[0].fills = [];
        hatches.push([r, c]);
      }
      // 已發布也一樣顯示(只有狀態與工具列不同;audit-roster.js 逐格比對 SC-03)
      if (PUNCH[p + "-" + (d + D0)])
        punches.push([
          r,
          frozenW + d * colW + colW,
          PUNCH[p + "-" + (d + D0)],
          k === "a",
        ]);
      if (k === "a") marks.push([r, frozenW + d * colW + colW]);
    }
    if (stats === "full")
      for (let i = 0; i < STATS.length; i++) {
        const s = PEOPLE[p].s[i];
        const over = i === 3 && s === "5 天";
        const h = await headCell(
          s,
          null,
          STATS[i][1],
          "body2",
          over ? "ed" : "tp",
        );
        if (over) h.name = "head-cell 畫休超過上限";
        add(r, h, null, "FILL");
      }
    if (stats === "narrow")
      add(
        r,
        await headCell(" ", null, NARROW_W, "cap", "ts", "def"),
        null,
        "FILL",
      );
    add(g, r);
  }
  // 自動排入圖示:格子右上角(四種檢視同一個圖示)
  for (const [r, right] of marks) {
    const m = await autoMark();
    r.appendChild(m);
    m.layoutPositioning = "ABSOLUTE";
    m.x = right - m.width - 4;
    m.y = 4;
  }
  // 未對應排班的打卡:也放格子右上角,有自動排入圖示時排在它左邊(格子上方留了 22px,不蓋文字)
  for (const [r, right, n, hasAuto] of punches) {
    const m = await punchMark(n);
    r.appendChild(m);
    m.layoutPositioning = "ABSOLUTE";
    m.x = right - m.width - 4 - (hasAuto ? 18 : 0);
    m.y = 4;
  }
  for (const [r, c] of hatches) {
    const h = (await figma.getNodeByIdAsync("319:553")).createInstance();
    h.name = "hatch-bg 畫休";
    r.insertChild(0, h);
    h.layoutPositioning = "ABSOLUTE";
    h.resize(c.width, c.height);
    h.x = c.x;
    h.y = c.y;
  }
  return g;
}
// 圖例:items = [[kind, tone, label, symbol?]],用 Draft/LegendItem
async function legendRow(items) {
  const lg = row(12, "legend");
  lg.layoutWrap = "WRAP";
  lg.counterAxisSpacing = 8;
  for (const [k, t, l, s] of items) add(lg, await legend(k, t, l, s));
  return lg;
}
// 圖例:畫面上有的標示才放(電腦 7 天全部;平板 / 手機看不到的日子裡才有的標示會拿掉,見 audit-legend.js)
const ROSTER_LEGEND = [
  ["Lead", "Success", "負責人(名字或班別套綠底)"],
  ["Solid", "Primary", "已排的班"],
  ["Symbol", "Primary", "沒有套用範本的人力需求", "臨"],
  ["Auto", "Primary", "自動排入(手動改過就消失)"],
  ["Punch", "Warning", "未對應排班的打卡(張數)"],
  ["Square", "Neutral", "店休 / 已排在其他分店 / 時段不可排"],
  ["Hatch", "Neutral", "畫休(斜線)"],
  ["Solid", "Warning", "缺協同"],
  ["Break", "Neutral", "休息(分鐘)"],
  ["Solid", "Neutral", "人力需求已滿"],
  ["Symbol", "Neutral", "超過人力需求", "+1"],
];
const VIEWS = ["月", "週", "日", "班表"];
// 工具列:兩列(第一列分店 + 狀態 + 動作;第二列檢視 + 月份 + 顯示欄位 + 檢核)
async function toolbar(sz, o = {}) {
  const wrap = col(sz === "M" ? 8 : 12, "toolbar");
  const org = await selF("分店", "中山店");
  const st = await tag(
    o.published
      ? "已發布 · 10/28 李店長"
      : o.running
        ? "自動排班執行中"
        : "未發布",
    // 月份狀態:未發布(灰色)/ 已發布(和流程單據的草稿不同,不叫草稿)
    o.published ? "Success" : o.running ? "Warning" : "Grey",
  );
  const acts = [];
  if (!o.readonly) {
    acts.push(await btn("+ 人力需求", "Outlined", "Small"));
    acts.push(await btn("+ 新增排班", "Outlined", "Small"));
    acts.push(await btn("套用範本", "Outlined", "Small"));
    if (!o.published) {
      acts.push(await btn("自動排班", "Outlined", "Small"));
      acts.push(await btn("發布", "Contained", "Small"));
    }
  }
  const view = await seg(VIEWS, VIEWS.indexOf(o.view || "班表"), "檢視切換");
  const pg = await pager(o.period || "2026 年 11 月", "sub2");
  // 檢核按鈕 = 底座 Draft/ToggleButton(Base Draft 497:8040,MUI ToggleButton):有限制 Error、只有提醒 Warning、沒有問題 Neutral;
  // 面板展開 = State=Selected。不在實例上覆寫顏色。
  const chkLabel = o.checkLabel || "限制 1 · 提醒 12";
  const chkColor = o.checkOk
    ? "Neutral"
    : /^限制 0/.test(chkLabel)
      ? "Warning"
      : "Error";
  const chkState = o.panel ? "Selected" : "Default";
  const chk = (await figma.getNodeByIdAsync("497:8040")).children
    .find((v) => v.name === `Color=${chkColor}, State=${chkState}`)
    .createInstance();
  chk.setProperties({
    [Object.keys(chk.componentProperties).find((k) => k.startsWith("Label#"))]:
      chkLabel,
  });
  chk.name = `ToggleButton ${chkLabel}` + (o.panel ? "(已選取:面板展開)" : "");
  // ⚙ 顯示欄位:只在班表檢視,三尺寸都有
  const colsBtn =
    (o.view || "班表") === "班表"
      ? await btn("⚙ 顯示欄位", "Text", "Small")
      : null;
  if (sz === "M") {
    const r1 = row(8, "toolbar-1");
    add(r1, org, "FILL");
    add(r1, st);
    add(wrap, r1, "FILL");
    // 第二十四輪:手機操作列一行 [未發布] … [+ 新增 ▾](人力需求 / 排班)[⋯](套用範本 / 自動排班)[發布];選單 SC-55 / SC-56
    if (acts.length) {
      const r2 = row(8, "toolbar-actions");
      add(r2, st);
      sp(r2);
      add(r2, await btn("+ 新增 ▾", "Outlined", "Small"));
      add(r2, await btn("⋯", "Outlined", "Small"));
      if (!o.published) add(r2, await btn("發布", "Contained", "Small"));
      add(wrap, r2, "FILL");
    }
    const r3 = row(8, "toolbar-2");
    add(r3, view);
    sp(r3);
    if (colsBtn) add(r3, colsBtn);
    add(wrap, r3, "FILL");
    const r4 = row(8, "toolbar-3");
    add(r4, pg);
    sp(r4);
    add(r4, chk);
    add(wrap, r4, "FILL");
    return wrap;
  }
  const r1 = row(8, "toolbar-1");
  add(r1, org);
  org.layoutSizingHorizontal = "FIXED";
  org.resize(220, org.height);
  add(r1, st);
  sp(r1);
  for (const a of acts) add(r1, a);
  add(wrap, r1, "FILL");
  const r2 = row(8, "toolbar-2");
  add(r2, view);
  add(r2, pg);
  sp(r2);
  if (colsBtn) add(r2, colsBtn);
  add(r2, chk);
  add(wrap, r2, "FILL");
  return wrap;
}
// 檢核面板內容:限制在前、各自依規則排序;每項 [查看](捲到那一格並閃爍)
async function checkPanelBody(p, o = {}) {
  if (o.auto) {
    const s = await box("最近一次自動排班", "def", 12, 6, "md");
    add(
      s,
      await T("11/9 14:20 填入 112 人次 · 補上 18 天的人力需求", "body2", "tp"),
      "FILL",
    );
    s.children[0].textAutoResize = "HEIGHT";
    add(s, await btn("清除自動排入的人", "Text", "Small"));
    add(p, s, "FILL");
  }
  // 自動排班完成時多一筆「人力不足」(11/24 補貨),數字要和清單筆數對得上
  add(
    p,
    await seg(
      o.auto
        ? ["全部 14", "限制 1", "提醒 13"]
        : ["全部 13", "限制 1", "提醒 12"],
      0,
      "篩選",
    ),
  );
  const items = [
    ["限制", "Error", "林美麗 本月畫休 5 天,超過上限 4 天"],
    ["提醒", "Warning", "人力不足:11/1 晚班 店內櫃台 缺 1 人(可排 1 人)"],
    ["提醒", "Warning", "人力不足:11/2 晚班 店內櫃台 缺 1 人(可排 2 人)"],
    ["提醒", "Warning", "人力不足:11/4 晚班 店內櫃台 缺 1 人(可排 1 人)"],
    ["提醒", "Warning", "人力不足:11/6 晚班 店內櫃台 缺 1 人(可排 1 人)"],
    [
      "提醒",
      "Warning",
      "人力不足:11/11 店慶加開 櫃台 B 13:00–18:00 缺 1 人(負責):可負責的人都已排班",
    ],
    [
      "提醒",
      "Warning",
      "人力不足:11/14 晚班 店內櫃台 14:30–22:00 缺 1 人(協同)",
    ],
    ["提醒", "Warning", "陳大文 11/6–11/12 連續上班 7 天(最多 6 天)"],
    [
      "提醒",
      "Warning",
      "王小明 11/4 晚班到 11/5 早班只休息 10.5 小時(最少 11 小時)",
    ],
    // 每天最多上班時數(預設 8 小時、提醒):同一天所有排班加總(扣休息);只有張小芳 11/7 超過
    [
      "提醒",
      "Warning",
      "每天最多上班時數:張小芳 11/7 排 10.5 小時(最多 8 小時)",
    ],
  ];
  // 未對應排班的打卡:等級提醒,不影響發布
  items.push(
    ["提醒", "Warning", "未對應排班的打卡:王小明 11/5 · 3 張"],
    ["提醒", "Warning", "未對應排班的打卡:林美麗 11/1 · 2 張"],
    ["提醒", "Warning", "未對應排班的打卡:張小芳 11/4 · 2 張"],
  );
  if (o.auto)
    items.push([
      "提醒",
      "Warning",
      "人力不足:11/24 補貨 13:00–17:00 缺 1 人(協同):沒有可排的人(2 人畫休、1 人時段不可排)",
    ]);
  for (const [lv, tone, t] of items) {
    const r = row(8, "item", "MIN");
    add(r, await tag(lv, tone));
    const x = await T(t, "body2");
    add(r, x, "FILL");
    x.textAutoResize = "HEIGHT";
    add(r, await btn("查看", "Text", "Small"));
    add(p, r, "FILL");
  }
}
