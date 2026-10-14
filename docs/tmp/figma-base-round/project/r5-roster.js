// ==== 第十九輪:排班作業(排班表)共用的組件函式。貼在 r5-kit.js 後面一起執行 ====
// 示範資料:中山店 2026 年 11 月(草稿);11/3(二)店休;11/11 特殊日「店慶」。
const PEOPLE = [
  { n: "王小明", t: "正職 · 可負責", s: ["20", "12", "120h", "2"] },
  { n: "李小華", t: "正職", s: ["18", "4", "108h", "3"] },
  { n: "陳大文", t: "正職 · 可負責", s: ["19", "10", "114h", "1"] },
  { n: "林美麗", t: "正職 · 可負責", s: ["17", "2", "102h", "5"] },
  { n: "張小芳", t: "兼職", s: ["9", "0", "36h", "0"] },
];
const WEEK = [
  ["11/1", "日"],
  ["11/2", "一"],
  ["11/3", "二"],
  ["11/4", "三"],
  ["11/5", "四"],
  ["11/6", "五"],
  ["11/7", "六"],
];
// 每人每天:[種類, line1, line2];種類 f=有班 a=自動排入 o=其他分店 x=時段不可排 h=畫休 e=空
const GRID = [
  [
    ["f", "早 ★", "08:30–14:30"],
    ["f", "早 ★", "08:30–14:30"],
    ["s"],
    ["a", "晚 ★ 自動", "14:30–22:00"],
    ["f", "早 ★", "08:30–14:30"],
    ["h", "休", "畫休"],
    ["f", "早 ★", "08:30–14:30"],
  ],
  [
    ["f", "早", "08:30–14:30"],
    ["a", "晚 自動", "14:30–22:00"],
    ["s"],
    ["f", "早 ★", "08:30–14:30"],
    ["f", "晚", "14:30–22:00"],
    ["a", "早 自動", "08:30–14:30"],
    ["e"],
  ],
  [
    ["f", "晚 ★", "14:30–22:00"],
    ["o", "已排於新竹店", "14:00–22:00"],
    ["s"],
    ["e"],
    ["f", "晚 ★", "14:30–22:00"],
    ["a", "晚 ★ 自動", "14:30–22:00"],
    ["f", "晚 ★", "14:30–22:00"],
  ],
  [
    ["e"],
    ["f", "早", "08:30–14:30"],
    ["s"],
    ["f", "早", "08:30–14:30"],
    ["f", "補", "13:00–17:00"],
    ["f", "早 ★", "08:30–14:30"],
    ["f", "晚", "14:30–22:00"],
  ],
  [
    ["f", "補", "13:00–17:00"],
    ["x", "不可排", "09:00–13:00"],
    ["s"],
    ["f", "補 臨", "13:00–17:00"],
    ["f", "早", "08:30–14:30"],
    ["e"],
    ["f", "早", "08:30–14:30"],
  ],
];
const SUMMARY = [
  ["需 5 · 已排 5", "ok"],
  ["需 5 · 已排 4", "warn"],
  ["店休", "off"],
  ["需 4 · 已排 4", "ok"],
  ["需 5 · 已排 5 +1", "over"],
  ["需 4 · 已排 4", "ok"],
  ["需 4 · 已排 4", "ok"],
];
async function rosterGrid(colW, frozenW, days = 7, stats = true, opts = {}) {
  const g = AL("VERTICAL", { name: "RosterGrid(組成)", itemSpacing: 0 });
  await fill(g, "paper");
  await stroke(g, "divider");
  const hr = row(0, "header-row", "MIN");
  add(hr, await headCell("人員", null, frozenW, "sub2", "ts"));
  for (let d = 0; d < days; d++) {
    const h = await headCell(
      WEEK[d][0] + " " + WEEK[d][1],
      d === 2 ? "店休" : null,
      colW,
      "capSB",
      d === 2 ? "tdis" : "tp",
      d === 2 ? "dis" : null,
    );
    if (opts.dayMenu && d === 1) {
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
  if (stats)
    for (const s of ["班數", "負責", "工時", "畫休"])
      add(hr, await headCell(s, null, 64, "capSB", "ts", "def"), null, "FILL");
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
  );
  for (let d = 0; d < days; d++) {
    const [t, k] = SUMMARY[d];
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
        k === "warn" ? "wl" : k === "off" ? "dis" : "def",
      ),
      null,
      "FILL",
    );
  }
  if (stats)
    for (let i = 0; i < 4; i++)
      add(sr, await headCell(" ", null, 64, "cap", "ts", "def"), null, "FILL");
  add(g, sr);
  for (let p = 0; p < PEOPLE.length; p++) {
    const r = row(0, "row-" + (p + 1), "MIN");
    add(
      r,
      await headCell(PEOPLE[p].n, PEOPLE[p].t, frozenW, "sub2", "tp"),
      null,
      "FILL",
    );
    for (let d = 0; d < days; d++) {
      const [k, l1, l2] = GRID[p][d];
      let c;
      if (k === "e") c = await rcell("Empty");
      else if (k === "s") c = await rcell("Filled", "店休", "", { bg: "dis" });
      else if (k === "o") c = await rcell("Filled", l1, l2, { bg: "g200" });
      else if (k === "x") c = await rcell("Filled", l1, l2, { bg: "dis" });
      else if (k === "h") c = await rcell("Filled", l1, l2, { bg: "il" });
      else if (opts.sel && p === 1 && d === 3)
        c = await rcell("Selected", l1, l2);
      else if (opts.published && k === "a")
        c = await rcell("Filled", l1.replace(" 自動", ""), l2);
      else c = await rcell("Filled", l1, l2);
      add(r, c);
      c.layoutSizingHorizontal = "FIXED";
      c.resize(colW, 56);
    }
    if (stats)
      for (const s of PEOPLE[p].s)
        add(
          r,
          await headCell(s, null, 64, "body2", s === "5" ? "ed" : "tp"),
          null,
          "FILL",
        );
    add(g, r);
  }
  return g;
}
async function legendRow(items) {
  const lg = row(12, "legend");
  lg.layoutWrap = "WRAP";
  lg.counterAxisSpacing = 4;
  for (const s of items) add(lg, await T(s, "cap", "ts"));
  return lg;
}
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
    o.checkLabel || "檢核 ⛔ 1 · ⚠ 3",
    o.panel ? "Contained" : "Outlined",
    "Small",
    o.checkOk ? "Success" : "Error",
  );
  const colsBtn =
    (o.view || "班表") === "班表" && sz !== "M"
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
    add(r3, chk);
    add(wrap, r3, "FILL");
    add(wrap, pg);
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
// 檢核面板內容
async function checkPanelBody(p, o = {}) {
  if (o.auto) {
    const s = await box("最近一次自動排班", "il", 12, 6, "md");
    add(
      s,
      await T(
        "11/1 14:20 自動排班:填入 112 人次 · 補上 18 天的人力需求",
        "body2",
        "idk",
      ),
      "FILL",
    );
    s.children[0].textAutoResize = "HEIGHT";
    add(s, await btn("清除自動排入的人", "Text", "Small"));
    add(p, s, "FILL");
  }
  add(p, await seg(["全部 4", "擋下 1", "警告 3"], 0, "篩選"));
  const items = [
    ["擋下", "Error", "林美麗 本月整天畫休 5 天,超過上限 4 天"],
    ["警告", "Warning", "人力不足:11/2 晚班 店內櫃台 缺 1 人(可排 2 人)"],
    ["警告", "Warning", "陳大文 11/6–11/12 連續上班 7 天(最多 6 天)"],
    [
      "警告",
      "Warning",
      "王小明 11/4 晚班到 11/5 早班只休息 10.5 小時(最少 11 小時)",
    ],
  ];
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
    add(p, r, "FILL");
  }
  add(p, await T("點一項,排班表會捲到那一格", "cap", "ts"));
}
