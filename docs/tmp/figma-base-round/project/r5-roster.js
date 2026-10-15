// ==== 第十九輪:排班作業(排班表)共用的組件函式。貼在 r5-kit.js 後面一起執行 ====
// 第二十三輪:人員欄固定在左、統計欄固定在右(班數、負責班數、總工時、畫休);格子寫「休 30」;
// 自動排入改用 Draft/ScheduleAutoMark 圖示;圖例改用 Draft/LegendItem;⚙ 顯示欄位三尺寸都有;檢核「限制 / 提醒」。
// 示範資料:中山店 2026 年 11 月(草稿);11/3(二)店休;11/11 特殊日「店慶」。
const PEOPLE = [
  { n: "王小明", t: "正職 · 可負責", s: ["20", "12", "128:30", "2 天"] },
  { n: "李小華", t: "正職", s: ["18", "4", "115:30", "3 天"] },
  { n: "陳大文", t: "正職 · 可負責", s: ["19", "10", "152:30", "1 天"] },
  { n: "林美麗", t: "正職 · 可負責", s: ["17", "2", "109:00", "5 天"] },
  { n: "張小芳", t: "兼職", s: ["9", "0", "36:00", "0 天"] },
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
    ["f", "早 ★ · 休 30", "08:30–14:30"],
    ["s"],
    ["a", "晚 ★ · 休 30", "14:30–22:00"],
    ["f", "早 ★ · 休 30", "08:30–14:30"],
    ["h", "休", "畫休"],
    ["f", "早 ★ · 休 30", "08:30–14:30"],
  ],
  [
    ["f", "早 · 休 30", "08:30–14:30"],
    ["a", "晚 · 休 30", "14:30–22:00"],
    ["s"],
    ["f", "早 ★ · 休 30", "08:30–14:30"],
    ["f", "晚 · 休 30", "14:30–22:00"],
    ["a", "早 · 休 30", "08:30–14:30"],
    ["e"],
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
    ["x", "不可排", "09:00–13:00"],
    ["s"],
    ["f", "補 臨", "13:00–17:00"],
    ["f", "早 · 休 30", "08:30–14:30"],
    ["e"],
    ["f", "早 · 休 30", "08:30–14:30"],
  ],
];
// 未對應排班的打卡(人-天 → 張數):王小明 11/5 有班但 3 張打卡沒對應;林美麗 11/1 沒排班臨時來(2 張);張小芳 11/4 排補貨 13:00–17:00,09:02 / 15:10 兩張超出容許範圍(出勤紀錄 SC-12 同一筆)
const PUNCH = { "0-4": 3, "3-0": 2, "4-3": 2 };
const SUMMARY = [
  ["需 5 · 已排 5", "ok"],
  ["需 5 · 已排 4", "warn"],
  ["店休", "off"],
  ["需 4 · 已排 4", "ok"],
  ["需 5 · 已排 5 +1", "over"],
  ["需 4 · 已排 4", "ok"],
  ["需 4 · 已排 4", "ok"],
];
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
  const sr = row(0, "summary-row", "MIN");
  add(
    sr,
    await headCell(
      frozenW < 100 ? "需求 / 已排" : "人力需求 / 已排",
      null,
      frozenW,
      "capSB",
      "ts",
      "def",
    ),
    null,
    "FILL",
  );
  for (let d = 0; d < days; d++) {
    const [t, k] = SUMMARY[d + D0];
    const c = {
      ok: "ts",
      warn: "wd",
      off: "tdis",
      over: "idk",
    }[k];
    add(
      sr,
      await headCell(
        t,
        k === "warn" ? "缺 1 · 可排 2" : null,
        colW,
        "capSB",
        c,
        k === "warn" ? "wl" : k === "off" ? "g200" : "def",
      ),
      null,
      "FILL",
    );
  }
  if (stats === "full")
    for (const [, w] of STATS)
      add(sr, await headCell(" ", null, w, "cap", "ts", "def"), null, "FILL");
  if (stats === "narrow")
    add(
      sr,
      await headCell(" ", null, NARROW_W, "cap", "ts", "def"),
      null,
      "FILL",
    );
  add(g, sr);
  const marks = [];
  const punches = [];
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
      else if (k === "h") c = await rcell("Filled", l1, l2, { bg: "il" });
      else if (opts.sel && p === 1 && d + D0 === 3)
        c = await rcell("Selected", l1, l2);
      else c = await rcell("Filled", l1, l2);
      add(r, c);
      c.layoutSizingHorizontal = "FIXED";
      c.resize(colW, 72);
      // 上方留 22px 給右上角的圖示(自動排入、未對應打卡),不蓋到文字
      if (k !== "e") c.children[0].paddingTop = 22;
      if (PUNCH[p + "-" + (d + D0)] && !opts.published)
        punches.push([
          r,
          frozenW + d * colW + colW,
          PUNCH[p + "-" + (d + D0)],
          k === "a",
        ]);
      if (k === "a" && !opts.published)
        marks.push([r, frozenW + d * colW + colW]);
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
const ROSTER_LEGEND = [
  ["Symbol", "Primary", "負責人", "★"],
  ["Symbol", "Primary", "沒有套用範本的人力需求", "臨"],
  ["Auto", "Primary", "自動排入(手動改過就消失)"],
  ["Square", "Neutral", "店休 / 已排在其他分店 / 時段不可排"],
  ["Square", "Info", "畫休"],
  ["Symbol", "Info", "超過人力需求", "+1"],
  ["Bar", "Error", "違反限制"],
  ["Bar", "Warning", "提醒"],
  ["Punch", "Warning", "未對應排班的打卡(張數)"],
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
        : "草稿",
    o.published ? "Success" : "Warning",
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
  const chk = await btn(
    o.checkLabel || "限制 1 · 提醒 6",
    o.panel ? "Contained" : "Outlined",
    "Small",
    o.checkColor || (o.checkOk ? "Success" : "Error"),
  );
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
    if (acts.length) {
      const r2 = row(8, "toolbar-actions");
      r2.layoutWrap = "WRAP";
      r2.counterAxisSpacing = 8;
      for (const a of acts) add(r2, a);
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
    const s = await box("最近一次自動排班", "il", 12, 6, "md");
    add(
      s,
      await T(
        "11/9 14:20 填入 112 人次 · 補上 18 天的人力需求",
        "body2",
        "idk",
      ),
      "FILL",
    );
    s.children[0].textAutoResize = "HEIGHT";
    add(s, await btn("清除自動排入的人", "Text", "Small"));
    add(p, s, "FILL");
  }
  add(p, await seg(["全部 7", "限制 1", "提醒 6"], 0, "篩選"));
  const items = [
    ["限制", "Error", "林美麗 本月畫休 5 天,超過上限 4 天"],
    ["提醒", "Warning", "人力不足:11/2 晚班 店內櫃台 缺 1 人(可排 2 人)"],
    ["提醒", "Warning", "陳大文 11/6–11/12 連續上班 7 天(最多 6 天)"],
    [
      "提醒",
      "Warning",
      "王小明 11/4 晚班到 11/5 早班只休息 10.5 小時(最少 11 小時)",
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
      "填不滿",
      "Default",
      "11/24 補貨 13:00–17:00:沒有可排的人(2 人畫休、1 人時段不可排)",
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
