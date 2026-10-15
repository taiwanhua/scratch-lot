// Base Draft 頁排版(取代 project/r4-layout.js 的 ROWS.base):元件區在上、畫面區在下,同類一列,彼此不重疊。
// 用法:`const PAGE_ID = "41:5914";` + 本檔(不需要其他檔頭)。只移動頂層節點的位置,不改元件與畫面內容。
// 規則:每列左邊一個列標題「列標題 / <名稱>」;同列節點左到右、間距 GAP;列與列之間 ROW_GAP;元件區與畫面區之間 REGION_GAP,
// 區塊標題「區塊 / 元件」「區塊 / 畫面」。框外註解「<名稱> · 註解」跟在它的節點右邊。沒列進 ROWS 的放到該區最後一列「其他」。
// 名稱比對:「BS-xx」比畫面編號(含 a / b / c / d);「Draft/…」比完整名稱。
const ROWS = {
  元件: [
    [
      "區塊、圖示、受眾、資料範圍、組織選單、側欄",
      [
        "Draft/Section",
        "Draft/ActionIcon+",
        "Draft/AudiencePicker",
        "Draft/DataScopeRuleCard",
        "Draft/OrgTreeSelect",
        "Draft/AdminSideNav+",
      ],
    ],
    [
      "月曆、排班格",
      [
        "Draft/MonthCalendarCell",
        "Draft/MonthCalendar",
        "Draft/RosterCell",
        "Draft/RosterGrid",
        "BS-23",
      ],
    ],
    [
      "時間軸(ScheduleTimeline)",
      [
        "Draft/ScheduleTimelineBlock",
        "Draft/ScheduleTimelineDemand",
        "Draft/ScheduleTimelineMore",
        "Draft/ScheduleAutoMark",
        "Draft/BreakMark",
        "Draft/StatusChip",
        "Draft/ScheduleTimeline",
        "BS-22",
      ],
    ],
    [
      "通知與提示",
      [
        "Draft/NotificationBell",
        "Draft/NotificationItem",
        "Draft/NotificationPanel",
        "Draft/Snackbar+",
      ],
    ],
    [
      "列印按鈕與 58mm 單據零件",
      [
        "Draft/PrintButton",
        "Draft/Receipt58",
        "Draft/Receipt58Header",
        "Draft/Receipt58Row",
        "Draft/Receipt58TableRow",
        "Draft/Receipt58Range",
        "Draft/Receipt58Total",
        "Draft/Receipt58Divider",
        "Draft/Receipt58Text",
        "Draft/Receipt58Barcode",
        "Draft/Receipt58QR",
        "Draft/Receipt58Signature",
        "Draft/Receipt58Cut",
      ],
    ],
    ["Stepper", ["Draft/StepperStep", "Draft/Stepper"]],
  ],
  畫面: [
    ["資料範圍", ["BS-01"]],
    ["流程設計器", ["BS-02", "BS-03"]],
    ["表單模組與表單設計器", ["BS-04", "BS-12", "BS-21"]],
    ["個人設定", ["BS-05", "BS-06"]],
    ["申請中心與頁內分頁", ["BS-07", "BS-15"]],
    ["通知", ["BS-08", "BS-09"]],
    [
      "印表機管理與列印",
      ["BS-10", "BS-17", "BS-18", "BS-19", "BS-20", "BS-11"],
    ],
    ["欄位管理、側欄計數、Stepper", ["BS-13", "BS-14", "BS-16"]],
  ],
};
const GAP = 80,
  ROW_GAP = 200,
  REGION_GAP = 480,
  LABEL_W = 280,
  X0 = 120;
const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);
const isLabel = (n) =>
  n.type === "TEXT" &&
  (n.name.startsWith("列標題 / ") ||
    n.name.startsWith("區塊 / ") ||
    n.name === "row-label");
// 標題字型沿用頁上既有列標題(沒有就用 Inter)
const tpl = page.children.find(isLabel);
let font = { family: "Inter", style: "Semi Bold" },
  size = 20,
  fills = null;
if (tpl) {
  font = tpl.fontName;
  size = tpl.fontSize;
  fills = tpl.fills;
}
await figma.loadFontAsync(font);
for (const n of [...page.children]) if (isLabel(n)) n.remove();
const notes = new Map();
for (const n of page.children)
  if (n.type === "TEXT" && n.name.endsWith(" · 註解"))
    notes.set(n.name.slice(0, -5), n);
const items = page.children.filter(
  (n) => n.type !== "TEXT" && n.visible && !/^_tmp/.test(n.name),
);
const code = (n) => (/^(BS-\d\d)/.exec(n.name) || [])[1];
const used = new Set();
const match = (key) =>
  items
    .filter(
      (n) =>
        !used.has(n) &&
        (key.startsWith("BS-") ? code(n) === key : n.name === key),
    )
    .sort((a, b) => (a.name < b.name ? -1 : 1));
async function label(text, x, y, big) {
  const t = figma.createText();
  t.fontName = font;
  t.fontSize = big ? size * 1.6 : size;
  if (fills) t.fills = fills;
  t.characters = text;
  t.name = (big ? "區塊 / " : "列標題 / ") + text;
  page.appendChild(t);
  t.textAutoResize = "HEIGHT";
  t.resize(LABEL_W, t.height);
  t.x = x;
  t.y = y;
  return t;
}
let y = 160;
const out = {};
for (const [region, rows] of Object.entries(ROWS)) {
  const rl = await label(region, X0, y, true);
  y += rl.height + 80;
  const list = rows.map(([t, keys]) => [
    t,
    keys.flatMap((k) => {
      const m = match(k);
      m.forEach((n) => used.add(n));
      return m;
    }),
  ]);
  out[region] = list.map(([t, l]) => t + ":" + l.length);
  for (const [title, nodes] of list) {
    if (!nodes.length) continue;
    const lb = await label(title, X0, y);
    let x = X0 + LABEL_W + GAP,
      h = lb.height;
    for (const n of nodes) {
      n.x = x;
      n.y = y;
      x += n.width + GAP;
      h = Math.max(h, n.height);
      const nt = notes.get(n.name);
      if (nt) {
        nt.x = x - GAP + 24;
        nt.y = y;
        x += nt.width + 24;
        h = Math.max(h, nt.height);
      }
    }
    y += h + ROW_GAP;
  }
  y += REGION_GAP - ROW_GAP;
}
const rest = items.filter((n) => !used.has(n));
if (rest.length) {
  const lb = await label("其他(沒有列進 Base-layout.js 的節點)", X0, y);
  let x = X0 + LABEL_W + GAP;
  for (const n of rest) {
    n.x = x;
    n.y = y;
    x += n.width + GAP;
  }
  out.其他 = rest.map((n) => n.name);
}
return out;
