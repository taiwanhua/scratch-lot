// Draft/ToggleButton(底座規格 10.11 互動狀態)。在 scratch-lot Screens 的 Base Draft 頁(41:5914)執行,只綁 wowgo-base 變數。
// 開關型按鈕(實作用 MUI ToggleButton):按一下展開 / 收合面板,展開時是 Selected。第一個用處:排班的檢核按鈕「限制 n · 提醒 n」。
// 外觀和底座 Button Outlined Small 同一套(高 32、左右內距 10、圓角 8、1px 框、文字取自 Library Button 的 label):
//   Color = Error(error/main 框與字)/ Warning(warning/main 框與字)/ Neutral(grey/500 框、text/secondary 字)
//   × State = Default(無底)/ Hover(疊同色系 main × 8%)/ Selected(疊同色系 main × 16%);框一律 1px 同色系 main、不佔版面。
//   疊色是最底層的 state-layer 矩形(圖層不透明度),不是第二層 paint。
// 屬性 Label。放在 Base Draft 元件區「時間軸」那一列的最後面。
const KEYS = {
  em: "0d2b086b0de059122075ae1efcdf53c86d10497d", // error/main
  wm: "c4795bb776010891dbb7e03790c05d403ac4c75a", // warning/main
  g500: "c84c76fe3426c8a7433557941dff0bed92c7d2bb", // grey/500
  ts: "c11ac6a81b471a6a46f85602d056355c19fd4166", // text/secondary
};
const BUTTON_KEY = "70952d51062bc2783af95327d7634b98982b98dd"; // Library Button Variant=Outlined, Size=Small, State=Default, Color=Error
const V = {};
for (const [k, v] of Object.entries(KEYS))
  V[k] = await figma.variables.importVariableByKeyAsync(v);
// 綁變數時 paint 的底色先填變數解析後的值:只填灰色時,複製來的文字節點會一直畫成灰色(Error 字變灰)
const P = (v, node) => {
  const c = node
    ? v.resolveForConsumer(node).value
    : { r: 0.5, g: 0.5, b: 0.5 };
  return figma.variables.setBoundVariableForPaint(
    { type: "SOLID", color: { r: c.r, g: c.g, b: c.b } },
    "color",
    v,
  );
};
const page = await figma.getNodeByIdAsync("41:5914");
await figma.setCurrentPageAsync(page);
const PREFIX = "【底座・本輪草稿,完成後搬回 wowgo-base Design System】";
// 文字樣式照 Library Button:取它的 label 複本(字型、字級、行高一致)
const ref = (
  await figma.importComponentByKeyAsync(BUTTON_KEY)
).createInstance();
const refText = ref.findOne((n) => n.type === "TEXT");
await figma.loadFontAsync(refText.fontName);
// [框 / 疊色, 字]
const TONE = {
  Error: ["em", "em"],
  Warning: ["wm", "wm"],
  Neutral: ["g500", "ts"],
};
const LABEL = {
  Error: "限制 1 · 提醒 12",
  Warning: "限制 0 · 提醒 2",
  Neutral: "檢核 ✓",
};
const comps = [];
for (const color of Object.keys(TONE))
  for (const st of ["Default", "Hover", "Selected"]) {
    const [main, txt] = TONE[color];
    const c = figma.createComponent();
    c.name = `Color=${color}, State=${st}`;
    c.layoutMode = "HORIZONTAL";
    c.primaryAxisAlignItems = c.counterAxisAlignItems = "CENTER";
    c.primaryAxisSizingMode = "AUTO";
    c.counterAxisSizingMode = "FIXED";
    c.paddingLeft = c.paddingRight = 10;
    c.paddingTop = c.paddingBottom = 0;
    c.cornerRadius = 8;
    c.strokes = [P(V[main], c)];
    c.strokeWeight = 1;
    c.strokeAlign = "INSIDE";
    c.strokesIncludedInLayout = false;
    const t = refText.clone();
    c.appendChild(t);
    t.name = "label";
    t.characters = LABEL[color];
    t.fills = [P(V[txt], t)];
    c.resize(c.width, 32);
    c.fills = [];
    // 疊色用一層 state-layer(同色系 main、圖層不透明度 8% / 16%),不用 paint 不透明度:
    // 綁變數的 paint 不透明度在主元件上看得到,但新建的實例會畫成 100%(實測),圖層不透明度沒有這個問題
    const op = { Default: 0, Hover: 0.08, Selected: 0.16 }[st];
    if (op) {
      const r = figma.createRectangle();
      r.name = "state-layer";
      c.insertChild(0, r);
      r.layoutPositioning = "ABSOLUTE";
      r.x = r.y = 0;
      r.resize(c.width, c.height);
      r.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
      r.cornerRadius = 8;
      r.fills = [P(V[main], c)];
      r.opacity = op;
    }
    page.appendChild(c);
    comps.push(c);
  }
ref.remove();
const set = figma.combineAsVariants(comps, page);
set.name = "Draft/ToggleButton";
const kl = set.addComponentProperty("Label", "TEXT", "限制 1 · 提醒 12");
for (const v of set.children)
  v.findOne((n) => n.name === "label").componentPropertyReferences = {
    characters: kl,
  };
// 變體排成表格:列 = Color、欄 = State(欄寬取最寬的變體)
const colW = Math.max(...comps.map((c) => c.width));
comps.forEach((c, i) => {
  c.x = 16 + (i % 3) * (colW + 16);
  c.y = 16 + Math.floor(i / 3) * (32 + 16);
});
set.resize(16 + 3 * (colW + 16), 16 + 3 * (32 + 16));
set.description =
  PREFIX +
  "開關型按鈕(實作用 MUI ToggleButton):按一下展開 / 收合面板,展開時 State=Selected,再按一次收合回 Default。外觀同 Button Outlined Small(高 32、圓角 8、1px 框)。Color:Error(error/main)/ Warning(warning/main)/ Neutral(grey/500 框、text/secondary 字),由模組依狀態決定(例:排班檢核有限制 Error、只有提醒 Warning、沒有問題 Neutral)。State:Default(無底)/ Hover(疊同色系 main × 8%)/ Selected(疊同色系 main × 16%),框一律 1px 同色系 main(照底座規格 10.11 互動狀態)。屬性 Label。";
// 放在「時間軸(ScheduleTimeline)」列的最後面(列與節點間距同 Base-layout.js:GAP 80)
const title = page.children.find(
  (n) => n.name === "列標題 / 時間軸(ScheduleTimeline)",
);
const next = page.children
  .filter((n) => /^列標題 \//.test(n.name) && n.y > title.y)
  .sort((a, b) => a.y - b.y)[0];
const inRow = page.children.filter(
  (n) => n !== set && n !== title && n.y >= title.y - 1 && n.y < next.y - 1,
);
set.x = Math.max(...inRow.map((n) => n.x + n.width)) + 80;
set.y = title.y;
return {
  set: set.id,
  variants: set.children.map((v) => `${v.name} ${v.id} ${v.width}×${v.height}`),
  pos: [set.x, set.y, set.width, set.height],
};
