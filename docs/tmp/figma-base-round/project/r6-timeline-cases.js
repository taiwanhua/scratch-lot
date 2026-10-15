// 規則示範頁「Screen / 班表時間軸 · 各種情況」(規格 14.5「並排與 +N」「滑過提示」;不是產品畫面)。
// 在 scratch-lot Screens 執行;放在班表頁(70:14)後面。每個情況一列:標題 | 週檢視電腦一天寬(157px)| 週檢視平板一天寬(120px)| 日檢視(橫向)| 規則說明(框外註解樣式)。
// 全部用正式元件:Draft/ScheduleTimelineBlock / ScheduleTimelineDemand / ScheduleTimelineMore / StatusChip / LeadTag(長條的 Lead)/ BreakMark(長條的 Break)/ ScheduleAutoMark(Auto=True)。
// 範本實例取自 SC-44 電腦(週)與 SC-45 電腦(日),顏色綁共用色票。週檢視的並排 / 收起規則(含可放條數 = 1 時的 +N 徽章,情況 16)和 r6-week.js 相同。
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
const strips = await figma.getNodeByIdAsync("408:8012"); // Draft/ScheduleTimelineMore(底座)
const ST = (t) =>
  strips.children.find(
    (c) => c.name === `Tone=${t}, State=Default, Size=Strip`,
  );
const STC = (t) =>
  strips.children.find(
    (c) => c.name === `Tone=${t}, State=Default, Size=Compact`,
  );
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
// ---- 資料 ----
// C:人力需求(簡稱 s、名稱 nm、開始 a、結束 b、人數標籤 lab、人 items、Tone、lead / help 需要人數)
const P = (n, lead, o = {}) => ({ n, lead, ...o }); // o:s 提早、e 延後、a/b 只上一段、auto、brk(休息分)、ix 互動狀態
const Vc = (k) => ({ vac: k }); // warn 缺協同 / err 缺負責
const Dis = (n, label, a, b) => ({ dis: true, n, label, a, b }); // 已排於其他分店 / 時段不可排
const C = (s, nm, a, b, lab, items, tone = "Normal") => ({
  s,
  nm,
  a,
  b,
  lab,
  items,
  tone,
});
const hm = (t) =>
  `${String(Math.floor(t)).padStart(2, "0")}:${t % 1 ? "30" : "00"}`;
const CASES = [
  {
    t: "1 一筆需求剛好(早 2/2)",
    L: [C("早", "早班", 8.5, 14.5, "2/2", [P("王小明", 1), P("李小華")])],
    note: "需求容器高度 = 人力需求時間;每位排班一條長條,寬度平均分配。負責人姓名套綠色標籤。\n點容器 / 長條 → 那筆人力需求對話框;點空白時段 → 新增人力需求。",
  },
  {
    t: "2 一筆需求人多(早 5/5):放不下 → 最後一條「+N 人」",
    L: [
      C("早", "早班", 8.5, 14.5, "5/5", [
        P("陳大文", 1),
        P("李小華"),
        P("王小明"),
        P("黃志明"),
        P("吳佳玲"),
      ]),
    ],
    note: "每條至少約 28px(名字直排)。電腦一天約 157px 放 4 條、平板約 120px 放 3 條;放不下時,容器最後一條改成「+N 人」窄條(同寬、高度同容器)。\n點「+N 人」= 點容器 → 那筆人力需求對話框(列出全部的人)。",
  },
  {
    t: "3 兩筆重疊(早 + 補):寬度依人數分配",
    L: [C("早", "早班", 8.5, 14.5, "2/2", [P("王小明", 1), P("李小華")])],
    R: [C("補", "補貨", 13, 17, "1/1", [P("張小芳")])],
    note: "同時段有兩筆需求時並排,容器寬度依各自需要的條數分配(每個至少 1 條寬)。",
  },
  {
    t: "4 11/10:早 5/5 + 補 1/1 + 晚 2/2(晚接在早同一欄)",
    L: [
      C("早", "早班", 8.5, 14.5, "5/5", [
        P("陳大文", 1),
        P("李小華"),
        P("王小明"),
        P("黃志明"),
        P("吳佳玲"),
      ]),
      C("晚", "晚班", 14.5, 22, "2/2", [P("林美麗", 1), P("張小芳")]),
    ],
    R: [C("補", "補貨", 13, 17, "1/1", [P("周家豪")])],
    note: "不重疊的需求(早、晚)排在同一欄;只有 2 筆重疊時一律並排(補貨 1 條寬),寬度先補給需要更多條的容器。放不下的容器畫(條數 − 1)人 +「+N 人」(和長條同寬);平板較窄、只放得下 1 條時,畫 1 條長條(負責人優先)+ 小「+N」徽章(見情況 16)。",
  },
  {
    t: "5 三筆同時重疊(11/11 店慶):第 3 筆 → 右側「+N 需求」",
    L: [
      C("早", "早班", 8.5, 14.5, "2/2", [P("王小明", 1), P("李小華")]),
      C("晚", "晚班", 14.5, 22, "2/2", [P("陳大文", 1), P("林美麗")]),
    ],
    R: [C("補", "補貨", 13, 17, "1/1", [P("張小芳", 0, { e: 18 })])],
    X: [
      C(
        "臨",
        "店慶加開",
        13,
        18,
        "負0/1 協1/1",
        [Vc("err"), P("張小芳")],
        "Error",
      ),
    ],
    note: "同一時段最多並排兩排容器,第 3 筆起收進當天欄最右邊的「+N 需求」窄條,高度對齊被收起需求的時間;框色取最嚴重(缺負責 = 紅)。\n點「+N 需求」→ 清單浮層(見情況 15);日檢視全部展開。",
  },
  {
    t: "6 缺協同、缺負責:缺額佔一條",
    L: [
      C(
        "早",
        "早班",
        8.5,
        14.5,
        "2/3",
        [P("王小明", 1), P("李小華"), Vc("warn")],
        "Warning",
      ),
      C("晚", "晚班", 14.5, 22, "1/2", [Vc("err"), P("林美麗")], "Error"),
    ],
    note: "缺額也佔一條虛線空位:缺協同 = 橘、缺負責 = 紅;容器框色同。日檢視每個缺額一列。",
  },
  {
    t: "7 收起的人含缺額 / 含負責人",
    L: [
      C(
        "早",
        "早班",
        8.5,
        14.5,
        "4/5",
        [P("王小明", 1), P("李小華"), P("林美麗"), P("張小芳"), Vc("warn")],
        "Warning",
      ),
      C("晚", "晚班(負責 3)", 14.5, 22, "5/5", [
        P("陳大文", 1),
        P("林美麗", 1),
        P("王小明", 1),
        P("李小華"),
        P("張小芳"),
      ]),
    ],
    note: "順序:負責人 → 協同 → 缺額。收起的部分含缺額時「+N 人」框橘(缺負責紅),只含人但有負責人時標綠,其他灰。",
  },
  {
    t: "8 早到 / 晚走:同一條長條延伸出容器",
    L: [
      C("早", "早班", 8.5, 14.5, "2/2", [
        P("林美麗", 1, { s: 8 }),
        P("張小芳", 0, { e: 15.5 }),
      ]),
    ],
    note: "超出人力需求的時間由同一條長條直接延伸出容器:淡色底 + 虛線框,和實線段相接(相接側不畫框、不圓角),長度對齊實際時間;容器大小不變。延伸段不可蓋到相鄰容器的文字或長條。",
  },
  {
    t: "9 只上一段(10:00–14:30):長條比容器短",
    L: [
      C("早", "早班", 8.5, 14.5, "2/2", [
        P("王小明", 1),
        P("李小華", 0, { a: 10, b: 14.5 }),
      ]),
    ],
    note: "只上部分時段時,長條上下(日檢視左右)對齊實際上下班時間,容器其餘時段留白。",
  },
  {
    t: "10 一人一筆排班掛兩筆需求",
    L: [C("補", "補貨", 13, 17, "1/1", [P("張小芳", 0, { e: 18 })])],
    R: [C("臨", "店慶加開", 15, 18, "協1/1", [P("張小芳", 0, { s: 13 })])],
    note: "一筆排班(張小芳 13:00–18:00)同時算進兩筆需求:兩個容器都有她,各自超出容器的時段用延伸段畫出。",
  },
  {
    t: "11 同一天兩段排班(早 + 晚)",
    L: [
      C("早", "早班", 8.5, 14.5, "2/2", [P("王小明", 1), P("張小芳")]),
      C("晚", "晚班", 14.5, 22, "2/2", [
        P("林美麗", 1),
        P("張小芳", 0, { a: 17, b: 22 }),
      ]),
    ],
    note: "同一人同一天可有多段排班,各自畫在所屬容器。張小芳 08:30–14:30(☕ 30)+ 17:00–22:00 = 10.5 小時,超過「每天最多上班時數」8 小時 → 檢核面板提醒(時間軸本身不另外標示)。",
  },
  {
    t: "12 ☕ 90 分、負責人綠底、自動排入、臨",
    L: [C("晚", "晚班", 14.5, 22, "1/1", [P("李小華", 1, { brk: 90 })])],
    R: [C("臨", "店慶加開", 13, 18, "協1/1", [P("張小芳", 0, { auto: true })])],
    note: "休息寫「☕ 分鐘」(BreakMark);負責人綠色標籤;自動排入在長條右上角(ScheduleAutoMark,手動改過就消失);沒有套用範本的人力需求簡稱寫「臨」。",
  },
  {
    t: "13 店休、特殊日、已排於其他分店、時段不可排",
    special: "店慶",
    L: [
      C(
        "早",
        "早班",
        8.5,
        14.5,
        "1/2",
        [P("王小明", 1), Dis("陳大文", "已排於新竹店", 8.5, 14.5)],
        "Warning",
      ),
    ],
    closedTablet: true,
    note: "電腦欄示範特殊日(行事曆設定的顏色,示範 cyan,整欄);平板欄示範店休(整欄 grey/200,不能排班)。日檢視列出不能排的人:已排於其他分店、時段不可排(灰色停用條,點了看原因)。",
    dayExtra: [Dis("張小芳", "時段不可排", 9, 13)],
  },
  {
    t: "14 滑過 / 已選取 + 提示框",
    L: [
      C("早", "早班", 8.5, 14.5, "2/2", [
        P("王小明", 1, { ix: "Selected" }),
        P("李小華", 0, { ix: "Hover" }),
      ]),
    ],
    tip: "李小華 · 08:30–14:30 · ☕ 30 分 · 協同 · 店內櫃台",
    note: "電腦 / 平板滑過長條:底疊 action/hover、框加深,旁邊提示框(姓名 · 時間 · ☕ 休息 · 職責 · 崗位);已選取:action/selected + 加粗框;鍵盤焦點:action/focus 外框。手機沒有滑過,按下時底色加深,內容看對話框。",
  },
  {
    t: "15 同一時段 7 筆需求:兩個容器 + 「+5 需求」+ 清單浮層",
    L: [C("櫃", "店內櫃台", 9, 17, "2/2", [P("王小明", 1), P("李小華")])],
    R: [C("補", "補貨", 9, 13, "1/1", [P("張小芳")])],
    X: [
      C("盤", "盤點", 10, 12, "協1/1", [P("林美麗")]),
      C(
        "促",
        "促銷攤位",
        11,
        15,
        "協1/2",
        [P("陳大文"), Vc("warn")],
        "Warning",
      ),
      C("臨", "店慶加開", 13, 18, "負0/1", [Vc("err")], "Error"),
      C("清", "清潔", 14, 15, "協1/1", [P("黃志明")]),
      C("教", "新人教育", 15, 17, "協1/1", [P("吳佳玲")]),
    ],
    list: true,
    note: "第 3 筆起全部收進「+N 需求」(高度涵蓋被收起需求的最早開始到最晚結束)。點了跳出清單浮層:依開始時間列出(簡稱、名稱、時間、人數,三態顏色);點一列 → 那筆人力需求對話框;底部 [看整天(日檢視) ›];需求多時浮層內捲動。",
  },
  {
    t: "16 只放得下 1 條:1 條長條 + 小「+N」徽章",
    L: [
      C("早", "早班", 8.5, 14.5, "3/3", [
        P("林美麗", 1),
        P("李小華"),
        P("王小明", 0, { a: 9, b: 14.5 }),
      ]),
    ],
    R: [C("補", "補貨", 13, 17, "1/1", [P("張小芳")])],
    X: [C("臨", "店慶加開", 13, 18, "協1/1", [P("周家豪")])],
    note: "容器只放得下 1 條(可放條數 = 1)而人數 > 1 時:畫 1 條長條(負責人優先,否則開始時間最早的人),這條長條底部內側放小「+N」徽章(ScheduleTimelineMore Size=Compact,顏色規則同窄條:含缺額橘 / 紅、含負責人綠、其他灰)。點徽章 = 打開那筆人力需求對話框(同窄條)。可放條數 ≥ 2 時照「條數 − 1 人 +「+N 人」窄條」。",
  },
];
// ---- 週檢視(一天寬)----
const MIN = 28,
  LBL = 23,
  STRIP = 20,
  WS = 24; // 週檢視 24px / 小時
const Yw = (t) => 22 + (t - 8) * WS;
const toneOf = (items) =>
  items.some((h) => h.vac === "err")
    ? "Error"
    : items.some((h) => h.vac)
      ? "Warning"
      : items.some((h) => h.lead)
        ? "Success"
        : "Neutral";
// 並排寬度依長條數分配(和 r6-week.js 同一套):每排先給 1 條寬,剩下的先補給需要更多條的排,再依人數比例分;
// 只有第 3 筆起同時重疊的需求(X)收進「+N 需求」,2 筆重疊一律並排
function plan(cs, CW) {
  const lanes = [cs.L, ...(cs.R ? [cs.R] : [])];
  const H = [...(cs.X || [])];
  const A = CW - 2 - (H.length ? STRIP + 2 : 0) - (lanes.length - 1) * 2;
  const n = lanes.map((ln) => Math.max(...ln.map((c) => c.items.length)));
  const base = 20 + MIN;
  const W = lanes.map(() => base);
  let extra = A - base * lanes.length;
  const need = n.map((x) => (x - 1) * (MIN + 2));
  const tot = need.reduce((a, b) => a + b, 0);
  if (extra > 0 && tot > 0) {
    const give = Math.min(extra, tot);
    need.forEach((x, i) => (W[i] += (give * x) / tot));
    extra -= give;
  }
  if (extra > 0) {
    const s = n.reduce((a, b) => a + b, 0);
    n.forEach((x, i) => (W[i] += (extra * x) / s));
  }
  return { H, lanes: lanes.map((ln, i) => ({ ln, W: W[i] })) };
}
// 容器可放的條數 = floor((容器寬 − 標題直排寬 20)/ 28);人數超過時畫(條數 − 1)人 +「+N 人」(和長條同寬)
const slotsOf = (w) => Math.max(1, Math.floor((w - 20) / MIN));
const TONE = { Normal: "Normal", Warning: "Warning", Error: "Error" };
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
    return { f, strip: null, H: [] };
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
  const pl = plan(cs, CW);
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
    if (p.auto) i.setProperties({ Auto: "True" });
    if (p.ix) i.setProperties({ Interaction: p.ix });
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
  const cont = (c, x, w) => {
    const k = slotsOf(w);
    const d = W.dem.clone();
    f.appendChild(d);
    d.setProperties({ Tone: TONE[c.tone] });
    d.name = `demand ${c.s} ${c.lab}`;
    d.resize(w, Yw(c.b) - Yw(c.a));
    d.x = x;
    d.y = Yw(c.a);
    const l = W.lab.clone();
    f.appendChild(l);
    // 週檢視容器左欄只寫「簡稱 / 已排/需要」(停用的人不算)
    l.characters =
      c.s +
      "\n" +
      `${c.items.filter((p) => !p.vac && !p.dis).length}/${c.items.filter((p) => !p.dis).length}`;
    l.x = x + 1;
    l.y = d.y + 3;
    const kc = Math.min(c.items.length, k);
    const sw = (w - 22 - 2 * (kc - 1)) / kc;
    let shown = c.items,
      hidden = [],
      compact = false;
    if (c.items.length > k) {
      if (k === 1) {
        // 只放得下 1 條:畫 1 條長條(負責人優先,否則開始時間最早),長條底部內側放小「+N」徽章(Size=Compact)
        const people = c.items.filter(
          (p) => !p.vac && !p.dis && !Array.isArray(p),
        );
        const pick =
          people.find((p) => p.lead) ||
          [...people].sort((a, b) => (a.a ?? c.a) - (b.a ?? c.a))[0] ||
          c.items[0];
        shown = [pick];
        hidden = c.items.filter((p) => p !== pick);
        compact = true;
      } else {
        shown = c.items.slice(0, k - 1);
        hidden = c.items.slice(k - 1);
      }
    }
    shown.forEach((p, i) => {
      const x0 = x + 22 + i * (sw + 2);
      if (p.vac) {
        const v = BV(
          p.vac === "err" ? "MissingLead" : "MissingHelper",
        ).createInstance();
        f.appendChild(v);
        v.name = p.vac === "err" ? "vacancy 缺負責" : "vacancy 缺協同";
        v.setProperties({
          [pk(v, "Title")]: p.vac === "err" ? "缺\n負\n責" : "缺\n協\n同",
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
      if (p.s !== undefined) ext(b, true, Yw(p.s), b.y);
      if (p.e !== undefined) ext(b, false, b.y + b.height, Yw(p.e));
    });
    if (hidden.length && compact) {
      const bar = [...f.children]
        .reverse()
        .find((n) => /^(bar |vacancy)/.test(n.name));
      const s = STC(toneOf(hidden)).createInstance();
      f.appendChild(s);
      s.name = `more-people +${hidden.length}(徽章)`;
      s.setProperties({ "Label#408:0": "+" + hidden.length });
      s.x = bar.x + (bar.width - s.width) / 2;
      s.y = bar.y + bar.height - s.height - 4;
    } else if (hidden.length) {
      const s = ST(toneOf(hidden)).createInstance();
      f.appendChild(s);
      s.name = `more-people +${hidden.length}`;
      s.setProperties({ "Label#408:0": "+" + hidden.length });
      s.resize(sw, d.height - 2);
      s.x = x + 22 + shown.length * (sw + 2);
      s.y = d.y + 1;
    }
  };
  let x = 41;
  for (const ln of pl.lanes) {
    for (const c of ln.ln) cont(c, x, ln.W);
    x += ln.W + 2;
  }
  let strip = null;
  if (pl.H.length) {
    const a = Math.min(...pl.H.map((h) => h.a)),
      b = Math.max(...pl.H.map((h) => h.b));
    const tone = pl.H.some((h) => h.tone === "Error")
      ? "Error"
      : pl.H.some((h) => h.tone === "Warning")
        ? "Warning"
        : "Neutral";
    strip = ST(tone).createInstance();
    f.appendChild(strip);
    strip.name = "more-demand +" + pl.H.length;
    strip.setProperties({ "Label#408:0": "+" + pl.H.length });
    strip.resize(STRIP, Yw(b) - Yw(a));
    strip.x = 40 + CW - 1 - STRIP;
    strip.y = Yw(a);
  }
  return { f, strip, H: pl.H };
}
// ---- 日檢視(橫向,每人一列,不收起)----
const DS = 64; // 日檢視 44px / 小時
const Xd = (t) => 40 + (t - 8) * DS;
async function day(cs) {
  const f = figma.createFrame();
  f.name = "日檢視";
  f.fills = [Pt(V.paper)];
  f.strokes = [Pt(V.divider)];
  f.strokeWeight = 1;
  f.clipsContent = false;
  const all = [...cs.L, ...(cs.R || []), ...(cs.X || [])].sort(
    (a, b) => a.a - b.a,
  );
  // 重疊的往下排:每筆需求放在第一個放得下的軌道
  const tracks = [];
  const place = [];
  for (const c of all) {
    const rows =
      c.items.length + (cs.dayExtra && c === cs.L[0] ? cs.dayExtra.length : 0);
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
      ...c.items,
      ...(cs.dayExtra && c === cs.L[0] ? cs.dayExtra : []),
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
      if (p.ix) b.setProperties({ Interaction: p.ix });
      const a = p.a ?? c.a,
        bb = p.b ?? c.b;
      b.resize(Xd(bb) - Xd(a), 26);
      b.x = Xd(a);
      b.y = yy;
      b.name = "bar " + p.n;
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
  "每列一個情況:週檢視電腦一天寬(157px)/ 平板一天寬(120px)/ 日檢視(橫向,每人一列不收起)/ 規則與點擊行為。規格:排班 14.5「並排與 +N」「滑過提示」;底座 10.11。",
  "b2",
  "ts",
  "page-sub",
);
page.appendChild(sub);
sub.y = 40;
let Y0 = 100;
const ids = [];
for (const cs of CASES) {
  const sec = figma.createFrame();
  sec.name = "情況 " + cs.t;
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
    120,
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
  // 提示框(情況 14)
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
      t.x = Math.max(0, hov.x + hov.width / 2 - t.width / 2);
      t.y = hov.y + Math.min(hov.height, 80) + 2;
    }
  }
  // 清單浮層(情況 15)
  if (cs.list && wd.strip) {
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
    card.appendChild(await T("11/×(×)收起的人力需求(5)", "s2", "tp", "title"));
    for (const c of [...wd.H].sort((a, b) => a.a - b.a)) {
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
  const note = await T(
    cs.note +
      "\n點擊:容器 / 長條 / 「+N 人」→ 人力需求對話框;「+N 需求」→ 清單浮層;空白時段 → 新增人力需求。",
    "cap",
    "ts",
    "情況 " + cs.t.split(" ")[0] + " · 註解",
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
return { page: page.id, ids };
