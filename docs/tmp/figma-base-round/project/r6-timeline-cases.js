// 規則示範頁「Screen / 班表時間軸 · 各種情況」(底座規格 10.11「週模式排版」、專案規格 14.5「週檢視排版」「滑過提示」;不是產品畫面)。
// 前置:先貼上 `_timeline-layout.js`(layoutTimeline;和 r6-week.js 同一個函式算位置,不手填座標)。
// 在 scratch-lot Screens 執行;放在班表頁(70:14)後面。每列一個測試案例 T-xx:週檢視電腦一天寬 157 | 週檢視平板一天寬 125 | 日檢視(橫向,每人一列不收起)| 輸入、預期輸出與規則(框外註解樣式)。
// 每個案例寫死預期輸出(exp),腳本用 layoutTimeline 算出實際結果並比對,不一致的列在回傳的 mismatch(要回報,不要改 exp 湊答案)。
// 全部用正式元件:Draft/ScheduleTimelineBlock / ScheduleTimelineDemand / ScheduleTimelineMore / StatusChip / LeadTag / BreakMark / ScheduleAutoMark,以及底座 Draft/Tag(同一筆排班「×2」)。
// 範本實例取自 SC-44 電腦(週)與 SC-45 電腦(日),顏色綁共用色票;畫完跑 brand-rebind.js(PAGE_ID = 本頁)。
const PAGE_NAME = "Screen / 班表時間軸 · 各種情況";
const WEEK_SRC = "272:86970",
  DAY_SRC = "272:87899",
  TIP_SRC = "345:92675";
const K = {
  paper: "7875005cdf746478c3e17c225db9fce44ab90451",
  bgdef: "f3cf90e5f836dd44d0124f96199feb7ce961d9fc",
  divider: "860a5dc497e0d365947731af9f273cd963ca1d04",
  tp: "d55b27457c6f95c898e614be4c16cef386fe1f65",
  ts: "c11ac6a81b471a6a46f85602d056355c19fd4166",
  g200: "ff65fc9dfea7c90e278a7909f54de2fea8d50137",
  g100: "6a1782058955b5f1b570298844375dfdede51f73",
  el: "bf0c706be97615148e026899f796626275e5d07a",
  ed: "d4fc0e5cb1a056c4bb694852fc2b93df0c0fa62d",
  wl: "15f96b616735c06dd4034cd95ca8dc525c66977a",
  wd: "39797cd1b142124ac07aa6fee4d0d09437d1f01e",
  pm: "3666ac0c6b3d12e8e38f6be8270287eb55a5cce1",
};
const SK = {
  h6: "1be1d72d4db6f0630bc69d0fb1271637413e60f5",
  s2: "10d300c90c1c0adee2e8665d86ade62c9d3a0d38",
  b2: "5fb1ba864f8fa1d388e29e66d1664b889e0a24ee",
  cap: "cf4328c6d8830674997c8a3f7d6aa200f50eab70",
  capSB: "7cfa2be1b685e1bf7c2d32270742cbf2e41d61d2",
  shadow: "5f6fb8fd430e5a57b2fe73bd4f77fda6914fe14a",
};
const V = {};
for (const [k, v] of Object.entries(K))
  V[k] = await figma.variables.importVariableByKeyAsync(v);
V.cyan = await figma.variables.getVariableByIdAsync("VariableID:341:97601"); // Draft/tagPalettes cyan/bg(特殊日)
V.cyanT = await figma.variables.getVariableByIdAsync("VariableID:341:97602");
const S = {};
for (const [k, v] of Object.entries(SK)) {
  S[k] = await figma.importStyleByKeyAsync(v);
  if (S[k].type === "TEXT") await figma.loadFontAsync(S[k].fontName);
}
const Pt = (v) =>
  figma.variables.setBoundVariableForPaint(
    { type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } },
    "color",
    v,
  );
const T = async (s, st, c = "tp", name) => {
  const t = figma.createText();
  await t.setTextStyleIdAsync(S[st].id);
  t.characters = s;
  t.fills = [Pt(V[c])];
  if (name) t.name = name;
  return t;
};
const rect = (p, name, x, y, w, h, c) => {
  const r = figma.createRectangle();
  r.name = name;
  p.appendChild(r);
  r.x = x;
  r.y = y;
  r.resize(Math.max(1, w), Math.max(1, h));
  r.fills = [Pt(V[c])];
  return r;
};
const pk = (i, p) =>
  Object.keys(i.componentProperties).find((k) => k.startsWith(p + "#"));
const vert = (s) => s.split("").join("\n");
// ---- 元件與範本 ----
const more = await figma.getNodeByIdAsync("408:8012"); // Draft/ScheduleTimelineMore(底座)「+N」長條
const MORE = (t) =>
  more.children.find((c) => c.name === `Tone=${t}, State=Default`);
const tlb = await figma.getNodeByIdAsync("259:4770");
const BV = (s) =>
  tlb.children.find(
    (c) => c.name === `State=${s}, Auto=False, Interaction=Default`,
  );
const wtl = (await figma.getNodeByIdAsync(WEEK_SRC)).findOne(
  (n) => n.name === "ScheduleTimeline(週模式,容器)",
);
const dtl = (await figma.getNodeByIdAsync(DAY_SRC)).findOne((n) =>
  /ScheduleTimeline\(日模式/.test(n.name),
);
const isLead = (c) => c.componentProperties[pk(c, "Lead")].value;
const W = {
  dem: wtl.children.find(
    (c) =>
      /^demand /.test(c.name) && c.componentProperties.Tone.value === "Normal",
  ),
  lab: wtl.children.find((c) => c.name === "demand-label"),
  lead: wtl.children.find((c) => /^bar /.test(c.name) && isLead(c)),
  bar: wtl.children.find((c) => /^bar /.test(c.name) && !isLead(c)),
  ext: wtl.children.find((c) => /^ext /.test(c.name)),
};
const D = {
  dem: dtl.children.find(
    (c) =>
      c.type === "INSTANCE" &&
      /Demand/.test(c.name) &&
      c.componentProperties.Tone.value === "Normal",
  ),
  lead: dtl.children.find(
    (c) =>
      c.type === "INSTANCE" &&
      c.componentProperties.State?.value === "Normal" &&
      isLead(c),
  ),
  bar: dtl.children.find(
    (c) =>
      c.type === "INSTANCE" &&
      c.componentProperties.State?.value === "Normal" &&
      !isLead(c),
  ),
  ext: dtl.children.find((c) => /^ext /.test(c.name)),
};
await figma.loadFontAsync(W.lab.fontName);
const tipSrc = await figma.getNodeByIdAsync(TIP_SRC);
// 同一筆排班掛兩筆職責(一人顧兩個收銀點)的標記:底座 Draft/Tag(Library,14:529)Tone=Grey「×2」,不自畫
const TAG_GREY = (await figma.getNodeByIdAsync("14:529")).children.find(
  (v) => v.name === "Tone=Grey",
);
await figma.loadFontAsync(TAG_GREY.findOne((n) => n.type === "TEXT").fontName);
const sameMark = (fr, b, week) => {
  const t = TAG_GREY.createInstance();
  t.setProperties({ "Label#76:8": "×2" });
  fr.appendChild(t);
  t.name = "同一筆排班 ×2";
  t.x = b.x + (b.width - t.width) / 2;
  t.y = week ? b.y + b.height - t.height - 4 : b.y + (b.height - t.height) / 2;
  return t;
};
// ---- 資料 ----
// C:人力需求(id、簡稱 s、名稱 nm、開始 a、結束 b、人數標籤 lab「已排/需求」、人 items、Tone、崗位排序 ord、範本排序 tmpl)
const P = (n, lead, o = {}) => ({ n, lead, ...o }); // o:s 提早、e 延後、a/b 只上一段、auto、brk(休息分)、ix 互動狀態
const Vc = (k) => ({ vac: k }); // warn 缺協同 / err 缺負責
const Dis = (n, label, a, b) => ({ dis: true, n, label, a, b }); // 已排於其他分店 / 時段不可排(只在日檢視列出)
const C = (
  id,
  s,
  nm,
  a,
  b,
  lab,
  items,
  tone = "Normal",
  ord = 1,
  tmpl = 1,
) => ({
  id,
  s,
  nm,
  a,
  b,
  lab,
  items,
  tone,
  ord,
  tmpl,
  slots: items.length, // max(需求人數, 已排人數):items 含缺額空位
});
const hm = (t) =>
  `${String(Math.floor(t)).padStart(2, "0")}:${t % 1 ? "30" : "00"}`;
const CASES = [
  {
    t: "T-01 剛好放下",
    G: [C(1, "早", "早班", 8.5, 14.5, "2/2", [P("王小明", 1), P("李小華")])],
    exp: { 157: "早 0–76", 125: "早 0–76" },
    note: "容器寬 = 20 + 28 × 條數(2 條 = 76);長條寬 26、間隔 2,負責人姓名綠底。",
  },
  {
    t: "T-02 共用位置(早接晚)",
    G: [
      C(1, "早", "早班", 8.5, 14.5, "2/2", [P("王小明", 1), P("李小華")]),
      C(2, "晚", "晚班", 14.5, 22, "2/2", [P("陳大文", 1), P("林美麗")]),
    ],
    exp: { 157: "早 0–76、晚 0–76", 125: "早 0–76、晚 0–76" },
    note: "時間不重疊(早班 14:30 結束、晚班 14:30 開始)的容器共用同一位置。",
  },
  {
    t: "T-03 缺額佔條",
    G: [
      C(
        1,
        "早",
        "早班",
        8.5,
        14.5,
        "2/3",
        [P("王小明", 1), P("李小華"), Vc("warn")],
        "Warning",
      ),
      C(2, "晚", "晚班", 14.5, 22, "1/2", [Vc("err"), P("林美麗")], "Error"),
    ],
    exp: { 157: "早 0–104、晚 0–76", 125: "早 0–104、晚 0–76" },
    note: "條數 = max(需求人數, 已排人數):缺額一人一條虛線空位、每條寫「缺負責 1」/「缺協同 1」(缺負責紅、缺協同橘),容器框色同;長條依職責排、同職責先人後缺額:負責 → 缺負責 → 協同 → 缺協同(晚班沒有負責人,缺負責排最前面)。",
  },
  {
    t: "T-04 多排(已排 > 需求)",
    G: [
      C(1, "早", "早班", 8.5, 14.5, "3/2", [
        P("王小明", 1),
        P("李小華"),
        P("張小芳"),
      ]),
    ],
    exp: { 157: "早 0–104", 125: "早 0–104" },
    note: "已排 3 人多於需求 2 人時條數取 3(104 寬),人數標籤寫「3/2」,不列入檢核。",
  },
  {
    t: "T-05 單筆太寬收起",
    G: [
      C(1, "早", "早班", 8.5, 14.5, "5/5", [
        P("陳大文", 1),
        P("李小華"),
        P("王小明"),
        P("黃志明"),
        P("吳佳玲"),
      ]),
    ],
    exp: {
      157: "(無);收起 早 →「+1」灰",
      125: "(無);收起 早 →「+1」灰",
    },
    note: "5 條需 160 寬,比一天欄寬還寬 → 整筆收起(排班長條不單獨收起);當天欄最右邊一條佔滿時間軸的「+N」長條。",
  },
  {
    t: "T-06 中途放不下收起(11/11)",
    G: [
      C(1, "早", "早班", 8.5, 14.5, "2/2", [P("王小明", 1), P("李小華")]),
      C(
        3,
        "補",
        "補貨",
        13,
        17,
        "1/1",
        [P("張小芳", 0, { e: 18 })],
        "Normal",
        2,
      ),
      C(
        4,
        "臨",
        "店慶加開",
        13,
        18,
        "負0/1 協1/1",
        [Vc("err"), P("張小芳")],
        "Error",
        3,
        99,
      ),
      C(2, "晚", "晚班", 14.5, 22, "2/2", [P("陳大文", 1), P("林美麗")]),
    ],
    exp: {
      157: "早 0–76、補 76–124、晚 0–76;收起 臨 →「+1」紅",
      125: "早 0–76、晚 0–76;收起 補、臨 →「+2」紅",
    },
    note: "依排序逐一放:早、補放好後,店慶加開在 13:00–18:00 找不到空得下 76 的位置 → 收起;有收起時保留最右邊 24px 重排(電腦可用 133、平板 101),平板補貨也放不下。晚班接在早班同一欄。收起的有缺負責 →「+N」紅框。",
  },
  {
    t: "T-07 後續也放不下(平板 11/10)",
    G: [
      C(1, "早", "早班", 8.5, 14.5, "5/5", [
        P("陳大文", 1),
        P("李小華"),
        P("王小明"),
        P("黃志明"),
        P("吳佳玲"),
      ]),
      C(3, "補", "補貨", 13, 17, "1/1", [P("周家豪")], "Normal", 2),
      C(2, "晚", "晚班", 14.5, 22, "2/2", [P("林美麗", 1), P("張小芳")]),
    ],
    exp: {
      157: "補 0–48、晚 48–124;收起 早 →「+1」灰",
      125: "補 0–48;收起 早、晚 →「+2」灰",
    },
    note: "已放好的不移動:補貨在 0–48,晚班和補貨重疊只能放 48 起;平板保留 24px 後只剩 101,晚班從 48 起需到 124 放不下 → 也收起。留白落在容器與「+N」長條之間。",
  },
  {
    t: "T-08 同時開始的平手排序",
    G: [
      C(
        3,
        "盤",
        "盤點",
        9,
        12,
        "2/2",
        [P("林美麗", 1), P("黃志明")],
        "Normal",
        2,
        2,
      ),
      C(2, "補", "補貨", 9, 13, "1/1", [P("張小芳")], "Normal", 2, 1),
      C(
        1,
        "櫃",
        "店內櫃台",
        9,
        13,
        "2/2",
        [P("王小明", 1), P("李小華")],
        "Normal",
        1,
        1,
      ),
    ],
    exp: {
      157: "櫃 0–76、補 76–124;收起 盤 →「+1」灰",
      125: "櫃 0–76;收起 補、盤 →「+2」灰",
    },
    note: "三筆都 09:00 開始:依崗位排序(櫃台 1 → 補貨 / 盤點 2),同崗位再依範本排序(補貨 1 → 盤點 2),再依建立時間、id;輸入順序打亂結果相同。",
  },
  {
    t: "T-09 同一天 7 筆需求 + 清單浮層",
    G: [
      C(
        1,
        "櫃",
        "店內櫃台",
        9,
        17,
        "2/2",
        [P("王小明", 1), P("李小華")],
        "Normal",
        1,
      ),
      C(2, "補", "補貨", 9, 13, "1/1", [P("張小芳")], "Normal", 2),
      C(3, "盤", "盤點", 10, 12, "協1/1", [P("林美麗")], "Normal", 3),
      C(
        4,
        "促",
        "促銷攤位",
        11,
        15,
        "協1/2",
        [P("陳大文"), Vc("warn")],
        "Warning",
        4,
      ),
      C(5, "臨", "店慶加開", 13, 18, "負0/1", [Vc("err")], "Error", 5, 99),
      C(6, "清", "清潔", 14, 15, "協1/1", [P("黃志明")], "Normal", 6),
      C(7, "教", "新人教育", 15, 17, "協1/1", [P("吳佳玲")], "Normal", 7),
    ],
    list: true,
    exp: {
      157: "櫃 0–76、補 76–124、臨 76–124;收起 盤、促、清、教 →「+4」橘",
      125: "櫃 0–76;收起 補、盤、促、臨、清、教 →「+6」紅",
    },
    note: "店慶加開 13:00 開始時補貨已結束 → 放在補貨的位置。點「+N」→ 清單浮層:依開始時間列出被收起的需求(簡稱、名稱、時間、人數三態顏色);點一列 → 那筆人力需求對話框;底部 [看整天(日檢視) ›];需求多時浮層內捲動。",
  },
  {
    t: "T-10 早到晚走:長條延伸出容器",
    G: [
      C(1, "早", "早班", 8.5, 14.5, "2/2", [
        P("林美麗", 1, { s: 8 }),
        P("張小芳", 0, { e: 15.5 }),
      ]),
    ],
    exp: { 157: "早 0–76", 125: "早 0–76" },
    note: "超出人力需求的時間由同一條長條延伸出容器:淡色底 + 虛線框,和實線段相接(相接側不畫框、不圓角);容器大小與排版不變。",
  },
  {
    t: "T-11 一人一筆排班掛兩筆需求",
    G: [
      C(
        1,
        "補",
        "補貨",
        13,
        17,
        "1/1",
        [P("張小芳", 0, { e: 18 })],
        "Normal",
        2,
      ),
      C(
        2,
        "臨",
        "店慶加開",
        15,
        18,
        "協1/1",
        [P("張小芳", 0, { s: 13 })],
        "Normal",
        3,
        99,
      ),
    ],
    exp: { 157: "補 0–48、臨 48–96", 125: "補 0–48、臨 48–96" },
    note: "一筆排班(張小芳 13:00–18:00)同時算進兩筆需求:兩個容器都有她,各自超出容器的時段用延伸段畫出。",
  },
  {
    t: "T-12 同一天兩段排班",
    G: [
      C(1, "早", "早班", 8.5, 14.5, "2/2", [P("王小明", 1), P("張小芳")]),
      C(2, "晚", "晚班", 14.5, 22, "2/2", [
        P("林美麗", 1),
        P("張小芳", 0, { a: 17, b: 22 }),
      ]),
    ],
    exp: { 157: "早 0–76、晚 0–76", 125: "早 0–76、晚 0–76" },
    note: "同一人同一天兩段排班各自畫在所屬容器。張小芳 08:30–14:30(☕ 30)+ 17:00–22:00 = 10.5 小時,超過「每天最多上班時數」8 小時 → 檢核面板提醒(時間軸不另外標示)。",
  },
  {
    t: "T-13 休息、負責人、自動排入、臨",
    G: [
      C(1, "晚", "晚班", 14.5, 22, "1/1", [P("李小華", 1, { brk: 90 })]),
      C(
        2,
        "臨",
        "店慶加開",
        13,
        18,
        "協1/1",
        [P("張小芳", 0, { auto: true })],
        "Normal",
        3,
        99,
      ),
    ],
    exp: { 157: "臨 0–48、晚 48–96", 125: "臨 0–48、晚 48–96" },
    note: "休息寫「☕ 分鐘」;負責人綠色標籤;自動排入在長條右上角(手動改過就消失);沒有套用範本的人力需求簡稱「臨」,範本排序排最後。",
  },
  {
    t: "T-14 店休、特殊日、已排於其他分店、時段不可排",
    special: "店慶",
    closedTablet: true,
    G: [
      C(
        1,
        "早",
        "早班",
        8.5,
        14.5,
        "1/2",
        [P("王小明", 1), Vc("warn")],
        "Warning",
      ),
    ],
    dayExtra: [
      Dis("陳大文", "已排於新竹店", 8.5, 14.5),
      Dis("張小芳", "時段不可排", 9, 13),
    ],
    exp: { 157: "早 0–76", 125: "店休" },
    note: "電腦欄示範特殊日(行事曆設定的顏色,示範 cyan,整欄);平板欄示範店休(整欄 grey/200,不能排班、不排容器)。日檢視列出不能排的人:已排於其他分店、時段不可排(灰色停用條,點了看原因)。",
  },
  {
    t: "T-15 滑過 / 已選取 + 提示框",
    G: [
      C(1, "早", "早班", 8.5, 14.5, "2/2", [
        P("王小明", 1, { ix: "Selected" }),
        P("李小華", 0, { ix: "Hover" }),
      ]),
    ],
    tip: "李小華 · 08:30–14:30 · ☕ 30 分 · 協同 · 店內櫃台",
    exp: { 157: "早 0–76", 125: "早 0–76" },
    note: "滑過長條:原底色上疊 primary/main × 8%、框 primary/main,旁邊提示框(姓名 · 時間 · ☕ 休息 · 職責 · 崗位);已選取:疊 primary/main × 16% + 1px primary/main 框;鍵盤焦點:action/focus 外框。手機沒有滑過,按下時底色加深。",
  },
  {
    t: "T-16 滑過留白處",
    G: [
      C(1, "早", "早班", 8.5, 14.5, "5/5", [
        P("陳大文", 1),
        P("李小華"),
        P("王小明"),
        P("黃志明"),
        P("吳佳玲"),
      ]),
      C(3, "補", "補貨", 13, 17, "1/1", [P("周家豪")], "Normal", 2),
      C(2, "晚", "晚班", 14.5, 22, "2/2", [P("林美麗", 1), P("張小芳")]),
    ],
    emptyHover: [9, 10],
    exp: {
      157: "補 0–48、晚 48–124;收起 早 →「+1」灰",
      125: "補 0–48;收起 早、晚 →「+2」灰",
    },
    note: "收起後留下的空白(容器與「+N」長條之間、或收起的需求原本的時段)照一般空白處處理:滑過的那一格顯示淡色「+ 人力需求」,點了新增人力需求。",
  },
  {
    t: "T-17 邊界:124 寬剛好放進平板 125(11/13)",
    G: [
      C(1, "早", "早班", 8.5, 14.5, "2/2", [P("陳大文", 1), P("李小華")]),
      C(3, "補", "補貨", 13, 17, "1/1", [P("張小芳")], "Normal", 2),
      C(2, "晚", "晚班", 14.5, 22, "2/2", [P("林美麗", 1), P("王小明")]),
    ],
    exp: {
      157: "早 0–76、補 76–124、晚 0–76",
      125: "早 0–76、補 76–124、晚 0–76",
    },
    note: "早班 76 + 補貨 48 = 124 ≤ 平板一天 125 → 全部放得下,不保留 24px、沒有「+N」。欄寬只有跨過整數條時排法才改變(例:平板若是 120,補貨就會收起)。",
  },
  {
    t: "T-18 一人顧兩個收銀點(同一筆排班、兩筆職責)",
    G: [
      C(1, "A", "櫃台 A", 14, 22, "負1/1", [P("王小明", 1, { same: true })]),
      // 滑過放在櫃台 B(最後一列),日檢視的提示框才不會蓋到櫃台 B 的標題
      C(
        2,
        "B",
        "櫃台 B",
        14,
        22,
        "負1/1",
        [P("王小明", 1, { same: true, ix: "Hover" })],
        "Normal",
        2,
      ),
    ],
    tip: "王小明 14:00–22:00 · 同一筆排班 · 櫃台 A、櫃台 B 負責",
    exp: { 157: "A 0–48、B 48–96", 125: "A 0–48、B 48–96" },
    note: "王小明一筆排班 14:00–22:00、兩筆職責(櫃台 A、櫃台 B 都是負責):兩個容器都畫他的完整長條(不是延伸段),長條上小標籤「×2」表示是同一筆排班;滑過提示寫「同一筆排班 · 櫃台 A、櫃台 B 負責」。兩個收銀點各自開班都選這一筆排班,打卡只有一組;班數算 1 班、工時算一次。",
  },
];
const WS = 24; // 週檢視每小時 24px(08:00–22:00)
const Yw = (t) => 22 + (t - 8) * WS;
const TONE = { Normal: "Normal", Warning: "Warning", Error: "Error" };
const TONE_ZH = { Neutral: "灰", Warning: "橘", Error: "紅" };
const fmtLayout = (r) =>
  (r.placed.length
    ? r.placed.map((p) => `${p.g.s} ${p.x}–${p.x + p.w}`).join("、")
    : "(無)") +
  (r.hidden.length
    ? `;收起 ${r.hidden.map((g) => g.s).join("、")} →「+${r.hidden.length}」${TONE_ZH[tlMoreTone(r.hidden)]}`
    : "");
// 容器左側直排的人數:多組「已排/需求」(例:負0/1 協1/1)加總成一組
const labSum = (lab) => {
  const m = [...lab.matchAll(/(\d+)\/(\d+)/g)];
  return `${m.reduce((t, x) => t + +x[1], 0)}/${m.reduce((t, x) => t + +x[2], 0)}`;
};
const hoverSrc = (await figma.getNodeByIdAsync("426:51988")).findOne(
  (n) => n.name === "empty-hover + 人力需求",
); // SC-60b 的淡色「+ 人力需求」格子
async function week(cs, CW, closed, special) {
  const f = figma.createFrame();
  f.name = `週 ${CW}px`;
  f.resize(40 + CW, 22 + 14 * WS);
  f.fills = [Pt(V.paper)];
  f.strokes = [Pt(V.divider)];
  f.strokeWeight = 1;
  f.clipsContent = false;
  for (let h = 8; h <= 22; h++) {
    rect(f, "grid-h", 40, Yw(h), CW, 1, "divider");
    if (h < 22) {
      const t = await T(hm(h), "cap", "ts", "time");
      f.appendChild(t);
      t.x = 4;
      t.y = Yw(h) - 2;
    }
  }
  rect(f, "grid-v", 40, 0, 1, f.height, "divider");
  const head = await T(
    closed ? "11/3 二 · 店休" : special ? "11/11 三 店慶" : "11/× 一天",
    "capSB",
    "tp",
    "date",
  );
  f.appendChild(head);
  head.x = 44;
  head.y = 3;
  if (closed) {
    rect(f, "店休 整欄", 41, 22, CW - 1, 14 * WS, "g200");
    const t = await T("店休", "capSB", "ts", "店休");
    f.appendChild(t);
    t.x = 40 + CW / 2 - 12;
    t.y = Yw(12);
    return { f, strip: null, hidden: [], res: "店休" };
  }
  if (special) {
    const r = rect(
      f,
      "special-day " + special,
      41,
      0,
      CW - 1,
      f.height,
      "paper",
    );
    r.fills = [Pt(V.cyan)];
    f.insertChild(0, r);
  }
  const r = layoutTimeline(cs.G, CW);
  const bar = (p, x, w, a, b) => {
    const src = p.dis ? null : p.lead ? W.lead : W.bar;
    const i = src ? src.clone() : BV("Disabled").createInstance();
    f.appendChild(i);
    i.name = (p.dis ? "disabled " : "bar ") + p.n;
    const pr = {};
    if (p.dis) pr[pk(i, "Title")] = vert(p.label.slice(0, 4));
    else if (p.lead) {
      pr[pk(i, "LeadText")] = vert(p.n);
      pr[pk(i, "Title")] = "";
    } else {
      pr[pk(i, "Title")] = vert(p.n);
      pr[pk(i, "Lead")] = false;
    }
    // 週檢視長條不放休息(太窄;休息看日檢視、班表格子)
    i.setProperties(pr);
    if (p.auto) {
      // 自動排入標記(ScheduleAutoMark)在右上角:窄長條把名字往下推,寬長條右側留位
      i.setProperties({ Auto: "True" });
      if (w < 40) i.paddingTop = 20;
    }
    if (p.ix) {
      // 互動狀態的底色 / 框色以變體為準(實例覆寫的品牌色要換掉,之後 brand-rebind 再補綁)
      i.setProperties({ Interaction: p.ix });
      const m = tlb.children.find(
        (c) => c.name === `State=Normal, Auto=False, Interaction=${p.ix}`,
      );
      i.fills = m.fills;
      i.strokes = m.strokes;
      if (p.ix === "Selected") i.strokesIncludedInLayout = false; // 已選取的框不佔版面
    }
    i.resize(w, Yw(b) - Yw(a) - 2);
    i.x = x;
    i.y = Yw(a) + 1;
    i.paddingLeft = w < 40 ? 5 : 8;
    i.paddingRight = w < 40 ? 3 : 6;
    i.topLeftRadius =
      i.topRightRadius =
      i.bottomLeftRadius =
      i.bottomRightRadius =
        8;
    return i;
  };
  const ext = (b, before, y0, y1) => {
    const e = W.ext.clone();
    f.insertChild(f.children.indexOf(b) + 1, e);
    e.name = "ext " + b.name.slice(4);
    e.resize(b.width, y1 - y0);
    e.x = b.x;
    e.y = y0;
    e.strokeLeftWeight = b.strokeLeftWeight;
    e.strokeTopWeight = e.strokeBottomWeight = e.strokeRightWeight = 1;
    e.topLeftRadius =
      e.topRightRadius =
      e.bottomLeftRadius =
      e.bottomRightRadius =
        8;
    if (before) {
      b.topLeftRadius = b.topRightRadius = 0;
      e.bottomLeftRadius = e.bottomRightRadius = 0;
      e.strokeBottomWeight = 0;
    } else {
      b.bottomLeftRadius = b.bottomRightRadius = 0;
      e.topLeftRadius = e.topRightRadius = 0;
      e.strokeTopWeight = 0;
    }
  };
  // 容器:位置與寬度由 layoutTimeline 算(容器寬 20 + 28 × 條數;長條寬 26、間隔 2)
  const cont = (c, x, w) => {
    const n = c.slots;
    const sw = (w - 22 - 2 * (n - 1)) / n;
    const d = W.dem.clone();
    f.appendChild(d);
    d.setProperties({ Tone: TONE[c.tone] });
    d.name = `demand ${c.s} ${c.lab}`;
    d.resize(w, Yw(c.b) - Yw(c.a));
    d.x = x;
    d.y = Yw(c.a);
    const l = W.lab.clone();
    f.appendChild(l);
    l.characters = c.s + "\n" + labSum(c.lab);
    l.x = x + 1;
    l.y = d.y + 3;
    tlOrder(c.items).forEach((p, i) => {
      const x0 = x + 22 + i * (sw + 2);
      if (p.vac) {
        const v = BV(
          p.vac === "err" ? "MissingLead" : "MissingHelper",
        ).createInstance();
        f.appendChild(v);
        v.name = p.vac === "err" ? "vacancy 缺負責" : "vacancy 缺協同";
        v.setProperties({
          [pk(v, "Title")]: p.vac === "err" ? "缺\n負\n責\n1" : "缺\n協\n同\n1",
          [pk(v, "Subtitle")]: "",
        });
        v.resize(sw, d.height - 2);
        v.x = x0;
        v.y = d.y + 1;
        return;
      }
      const a = p.a ?? c.a,
        bb = p.b ?? c.b;
      const b = bar(p, x0, sw, a, bb);
      if (p.same) sameMark(f, b, true);
      if (p.s !== undefined) ext(b, true, Yw(p.s), b.y);
      if (p.e !== undefined) ext(b, false, b.y + b.height, Yw(p.e));
    });
  };
  for (const p of r.placed) cont(p.g, 41 + p.x, p.w);
  let strip = null;
  if (r.hidden.length) {
    // 當天欄最右邊一條「+N」長條,高度佔滿時間軸
    strip = MORE(tlMoreTone(r.hidden)).createInstance();
    f.appendChild(strip);
    strip.name = "more +" + r.hidden.length;
    strip.setProperties({ "Label#408:0": "+" + r.hidden.length });
    strip.resize(20, f.height - 24);
    strip.x = 41 + CW - TL_MORE + 2;
    strip.y = 23;
  }
  if (cs.emptyHover) {
    // 留白處滑過:淡色「+ 人力需求」格子(「+N」長條左邊的可用寬度)
    const e = hoverSrc.clone();
    f.appendChild(e);
    e.x = 43;
    e.y = Yw(cs.emptyHover[0]) + 1;
    e.resize(
      CW - (r.hidden.length ? TL_MORE : 0) - 4,
      Yw(cs.emptyHover[1]) - Yw(cs.emptyHover[0]) - 2,
    );
  }
  return { f, strip, hidden: r.hidden, res: fmtLayout(r) };
}
const DS = 64; // 日檢視 44px / 小時
const Xd = (t) => 40 + (t - 8) * DS;
async function day(cs) {
  const f = figma.createFrame();
  f.name = "日檢視";
  f.fills = [Pt(V.paper)];
  f.strokes = [Pt(V.divider)];
  f.strokeWeight = 1;
  f.clipsContent = false;
  const all = [...cs.G].sort(tlCmp);
  // 重疊的往下排:每筆需求放在第一個放得下的軌道
  const tracks = [];
  const place = [];
  for (const c of all) {
    const rows =
      c.items.length + (cs.dayExtra && c === cs.G[0] ? cs.dayExtra.length : 0);
    const h = 26 + rows * 30 + 2;
    let t = tracks.findIndex((tr) => tr.end <= c.a);
    if (t < 0) {
      tracks.push({ end: 0, h: 0 });
      t = tracks.length - 1;
    }
    tracks[t].end = c.b;
    tracks[t].h = Math.max(tracks[t].h, h);
    place.push({ c, t, h, rows });
  }
  let y = 30;
  const ty = tracks.map((tr) => {
    const v = y;
    y += tr.h + 8;
    return v;
  });
  f.resize(Xd(22) + 12, y + 4);
  for (let h = 8; h <= 22; h += 2) {
    rect(f, "grid-v", Xd(h), 22, 1, y - 22, "divider");
    const t = await T(hm(h), "cap", "ts", "time");
    f.appendChild(t);
    t.x = Xd(h) - 14;
    t.y = 3;
  }
  rect(f, "grid-h", 0, 22, f.width, 1, "divider");
  for (const { c, t, h } of place) {
    const d = D.dem.clone();
    f.appendChild(d);
    d.setProperties({
      Tone: TONE[c.tone],
      // 容器太窄時標題縮短(簡稱 + 人數,或簡稱 + 時間 + 人數)
      [pk(d, "Title")]:
        Xd(c.b) - Xd(c.a) < 180
          ? `${c.s} ${c.lab}`
          : Xd(c.b) - Xd(c.a) < 240
            ? `${c.s} ${hm(c.a)}–${hm(c.b)} · ${c.lab}`
            : `${c.nm} ${hm(c.a)}–${hm(c.b)} · ${c.lab}`,
      [pk(d, "Break")]: false,
    });
    d.resize(Xd(c.b) - Xd(c.a), h);
    d.x = Xd(c.a);
    d.y = ty[t];
    const items = [
      ...tlOrder(c.items),
      ...(cs.dayExtra && c === cs.G[0] ? cs.dayExtra : []),
    ];
    items.forEach((p, i) => {
      const yy = d.y + 26 + i * 30;
      let b;
      if (p.vac) {
        b = BV(
          p.vac === "err" ? "MissingLead" : "MissingHelper",
        ).createInstance();
        b.setProperties({
          [pk(b, "Title")]: p.vac === "err" ? "缺負責 1" : "缺協同 1",
          [pk(b, "Subtitle")]: "",
        });
        f.appendChild(b);
        b.resize(d.width, 26);
        b.x = d.x;
        b.y = yy;
        return;
      }
      if (p.dis) {
        b = BV("Disabled").createInstance();
        f.appendChild(b);
        b.setProperties({
          [pk(b, "Title")]: `${p.n} · ${p.label} ${hm(p.a)}–${hm(p.b)}`,
          [pk(b, "Subtitle")]: "",
        });
        b.resize(Xd(p.b) - Xd(p.a), 26);
        b.x = Xd(p.a);
        b.y = yy;
        return;
      }
      b = (p.lead ? D.lead : D.bar).clone();
      f.appendChild(b);
      const pr = {};
      if (p.lead) {
        pr[pk(b, "LeadText")] = p.n;
        pr[pk(b, "Title")] = "";
      } else {
        pr[pk(b, "Title")] = p.n;
        pr[pk(b, "Lead")] = false;
      }
      // 長條太短時不放休息(姓名會被擠到換行)
      const a0 = p.a ?? c.a,
        b0 = p.b ?? c.b;
      pr[pk(b, "Break")] = (Xd(b0) - Xd(a0) >= 140 && !(p.a || p.b)) || !!p.brk;
      pr[pk(b, "BreakText")] = (p.brk || 30) + " 分";
      b.setProperties(pr);
      b.setProperties({ Auto: p.auto ? "True" : "False" });
      if (p.ix) {
        b.setProperties({ Interaction: p.ix });
        const m = tlb.children.find(
          (v) => v.name === `State=Normal, Auto=False, Interaction=${p.ix}`,
        );
        b.fills = m.fills;
        b.strokes = m.strokes;
      }
      const a = p.a ?? c.a,
        bb = p.b ?? c.b;
      b.resize(Xd(bb) - Xd(a), 26);
      b.x = Xd(a);
      b.y = yy;
      b.name = "bar " + p.n;
      if (p.same) sameMark(f, b, false);
      const ex = (x0, x1, before) => {
        const e = D.ext.clone();
        f.insertChild(f.children.indexOf(b) + 1, e);
        e.name = "ext " + p.n;
        e.resize(x1 - x0, 26);
        e.x = x0;
        e.y = yy;
        e.strokeTopWeight =
          e.strokeBottomWeight =
          e.strokeLeftWeight =
          e.strokeRightWeight =
            1;
        e.topLeftRadius =
          e.topRightRadius =
          e.bottomLeftRadius =
          e.bottomRightRadius =
            8;
        if (before) {
          b.topLeftRadius = b.bottomLeftRadius = 0;
          e.topRightRadius = e.bottomRightRadius = 0;
          e.strokeRightWeight = 0;
        } else {
          b.topRightRadius = b.bottomRightRadius = 0;
          e.topLeftRadius = e.bottomLeftRadius = 0;
          e.strokeLeftWeight = 0;
        }
      };
      if (p.s !== undefined) ex(Xd(p.s), b.x, true);
      if (p.e !== undefined) ex(b.x + b.width, Xd(p.e), false);
    });
  }
  return f;
}
// ---- 頁面 ----
let page = figma.root.children.find((p) => p.name === PAGE_NAME);
if (!page) {
  page = figma.createPage();
  page.name = PAGE_NAME;
  const ref = await figma.getNodeByIdAsync("70:14");
  figma.root.insertChild(figma.root.children.indexOf(ref) + 1, page);
}
await figma.setCurrentPageAsync(page);
for (const c of [...page.children]) c.remove();
const title = await T(
  "班表時間軸 · 各種情況(規則示範頁,不是產品畫面)",
  "h6",
  "tp",
  "page-title",
);
page.appendChild(title);
const sub = await T(
  "每列一個測試案例 T-xx(排版函式 layoutTimeline 的固定輸入 / 預期輸出):週檢視電腦一天寬 157 / 平板一天寬 125 / 日檢視(橫向,每人一列不收起)/ 輸入、預期輸出與規則。規格:底座 10.11「週模式排版」、排班 14.5「週檢視排版」「滑過提示」。",
  "b2",
  "ts",
  "page-sub",
);
page.appendChild(sub);
sub.y = 40;
let Y0 = 100;
const ids = [],
  mismatch = [];
for (const cs of CASES) {
  const sec = figma.createFrame();
  sec.name = cs.t;
  sec.fills = [];
  sec.clipsContent = false;
  page.appendChild(sec);
  sec.x = 0;
  sec.y = Y0;
  const ht = await T(cs.t, "s2", "tp", "case-title");
  sec.appendChild(ht);
  ht.x = 0;
  ht.y = 0;
  const wd = await week(cs, 157, false, cs.special);
  const wt = await week(
    cs,
    125,
    !!cs.closedTablet,
    cs.closedTablet ? null : cs.special,
  );
  const dv = await day(cs);
  const parts = [wd.f, wt.f, dv];
  let x = 0;
  for (const p of parts) {
    sec.appendChild(p);
    p.x = x;
    p.y = 32;
    x += p.width + 32;
  }
  // 提示框(T-15)
  if (cs.tip) {
    for (const fr of [wd.f, dv]) {
      const hov = fr.findOne(
        (n) =>
          n.type === "INSTANCE" &&
          n.componentProperties?.Interaction?.value === "Hover",
      );
      if (!hov) continue;
      const t = tipSrc.clone();
      fr.appendChild(t);
      t.setProperties({ Placement: "Bottom" });
      const tt = t.findOne((n) => n.type === "TEXT");
      await figma.loadFontAsync(tt.fontName);
      tt.characters = cs.tip;
      t.name = "浮層 Tooltip 滑過";
      // 週檢視不蓋到左側時間欄(40px)
      t.x = Math.max(
        fr.name === "日檢視" ? 0 : 42,
        hov.x + hov.width / 2 - t.width / 2,
      );
      t.y = hov.y + Math.min(hov.height, 80) + 2;
      // 提示框超出電腦欄時,平板欄與日檢視往右讓出位置
      const shift = fr === wd.f ? wd.f.x + t.x + t.width + 16 - wt.f.x : 0;
      if (shift > 0) {
        wt.f.x += shift;
        dv.x += shift;
        x += shift;
      }
    }
  }
  // 清單浮層(T-09)
  if (cs.list && wd.strip) {
    const H = [...wd.hidden].sort(tlCmp);
    const card = figma.createFrame();
    card.name = "浮層 +N 需求清單";
    card.layoutMode = "VERTICAL";
    card.itemSpacing = 6;
    card.paddingLeft =
      card.paddingRight =
      card.paddingTop =
      card.paddingBottom =
        12;
    card.cornerRadius = 8;
    card.fills = [Pt(V.paper)];
    card.strokes = [Pt(V.divider)];
    card.strokeWeight = 1;
    await card.setEffectStyleIdAsync(S.shadow.id);
    card.resize(280, 10);
    card.primaryAxisSizingMode = "AUTO";
    card.counterAxisSizingMode = "FIXED";
    card.appendChild(
      await T(`11/×(×)收起的人力需求(${H.length})`, "s2", "tp", "title"),
    );
    for (const c of H) {
      const r = figma.createFrame();
      r.name = "row " + c.nm;
      r.layoutMode = "HORIZONTAL";
      r.itemSpacing = 8;
      r.counterAxisAlignItems = "CENTER";
      r.primaryAxisAlignItems = "SPACE_BETWEEN";
      r.fills = [];
      r.paddingTop = r.paddingBottom = 4;
      card.appendChild(r);
      r.layoutSizingHorizontal = "FILL";
      r.counterAxisSizingMode = "AUTO";
      r.appendChild(
        await T(`${c.s} ${c.nm} ${hm(c.a)}–${hm(c.b)}`, "cap", "tp"),
      );
      // 人數標籤用底座 Draft/StatusChip(408:8040)
      const chip = (await figma.getNodeByIdAsync("408:8040")).children
        .find(
          (v) =>
            v.name ===
            `Tone=${c.tone === "Normal" ? "Neutral" : c.tone}, State=Default`,
        )
        .createInstance();
      chip.setProperties({ "Label#408:13": c.lab, "HasSub#408:33": false });
      chip.name = "status-chip";
      r.appendChild(chip);
    }
    const dvd = figma.createRectangle();
    dvd.name = "divider";
    dvd.resize(10, 1);
    dvd.fills = [Pt(V.divider)];
    card.appendChild(dvd);
    dvd.layoutSizingHorizontal = "FILL";
    card.appendChild(await T("看整天(日檢視) ›", "capSB", "pm", "link 看整天"));
    sec.appendChild(card);
    card.x = wd.f.x + wd.f.width + 4;
    card.y = 32 + wd.strip.y;
    // 平板欄往右讓出浮層
    const shift = card.x + card.width + 32 - wt.f.x;
    if (shift > 0) {
      wt.f.x += shift;
      dv.x += shift;
      x += shift;
    }
  }
  // 輸入 / 預期 / 實際:預期寫死在 exp,實際由 layoutTimeline 算;不一致列進 mismatch
  const nums = (lab) =>
    [...lab.matchAll(/(\d+)\/(\d+)/g)].reduce(
      (t, m) => [t[0] + +m[1], t[1] + +m[2]],
      [0, 0],
    );
  const input = cs.G.map((c) => {
    const [asg, need] = nums(c.lab);
    return `${c.s} ${c.nm} ${hm(c.a)}–${hm(c.b)} 需求 ${need} · 已排 ${asg}(${c.slots} 條)`;
  }).join("\n");
  for (const [k, got] of [
    [157, wd.res],
    [125, wt.res],
  ])
    if (got !== cs.exp[k])
      mismatch.push(
        `${cs.t.split(" ")[0]} ${k}:預期 ${cs.exp[k]} / 實際 ${got}`,
      );
  const note = await T(
    cs.note +
      "\n輸入(排序鍵:開始 → 崗位排序 → 範本排序 → 建立時間 → id):\n" +
      input +
      "\n預期輸出(電腦 157):" +
      cs.exp[157] +
      "\n預期輸出(平板 125):" +
      cs.exp[125] +
      "\n點擊:容器 / 長條 → 人力需求對話框;「+N」→ 清單浮層;空白處 → 新增人力需求。",
    "cap",
    "ts",
    cs.t.split(" ")[0] + " · 註解",
  );
  sec.appendChild(note);
  note.textAutoResize = "HEIGHT";
  note.resize(360, note.height);
  note.x = x;
  note.y = 32;
  sec.resize(x + 380, Math.max(...sec.children.map((c) => c.y + c.height)) + 8);
  ids.push(sec.name + " " + sec.id);
  Y0 += sec.height + 64;
}
// 中文字重新排版:新頁上用元件屬性 / 複製文字改出來的中文,沒先載入字型時截圖會漏字;載入後重設一次文字
const loadedFonts = new Set();
for (const t of page.findAllWithCriteria({ types: ["TEXT"] })) {
  if (!/[一-鿿]/.test(t.characters)) continue;
  for (const fn of t.getRangeAllFontNames(0, t.characters.length)) {
    const k = JSON.stringify(fn);
    if (!loadedFonts.has(k)) {
      await figma.loadFontAsync(fn);
      loadedFonts.add(k);
    }
  }
  const c = t.characters;
  t.characters = c + " ";
  t.characters = c;
}
return { page: page.id, ids, mismatch };
