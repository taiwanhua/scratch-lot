// Draft/ScheduleTimelineMore + Draft/StatusChip(底座規格 10.11 / 10.5)。前置:貼上 _resolve.js;在草稿頁執行(scratch:Base Draft、base:Draft / 本輪)。
// 2026-10-30 起資源一律經 _resolve.js 的 paint() / txt() 取(原本寫死頁 id、直接從 Library 匯入),兩種 MODE 都能跑。
// ScheduleTimelineMore(408:8012):週模式的「+N」長條(底座規格 10.11 週模式排版):有容器被收起時,當天欄最右邊一條,
//   寬 20、高度佔滿時間軸(實例依位置改高度);Label「+收起筆數」。底 grey/100;Tone = Neutral(divider 框)/ Warning / Error
//   × State = Default / Hover(疊同色系 main × 8%、框 main)/ Selected(疊 main × 16% + 1px main 框)。
//   第二十四輪後續之十三起不再有「+N 人」窄條與長條上的小徽章(Size=Strip / Compact、Tone=Success 已刪除)。
// StatusChip(408:8040):人數 / 彙總等短文字標籤,寬高 hug;Tone = Neutral(grey/100 + divider 細框)/ Warning / Error × State = Default / Hover / Selected;
//   屬性 Label、Sub(第二行,text/secondary)、HasSub。RosterGrid 群組列 / 彙總列、MonthCalendar 格子內容、時間軸清單浮層的人數標籤都用它。
const page = figma.currentPage;
const PREFIX = "【底座・本輪草稿,完成後搬回 wowgo-base Design System】";
const T = (s, st, c, name) => txt(s, st, c, name);
// 互動狀態(照 MUI):Hover = 原底色上疊同色系 main × 8%、框同色系 main;
//   Selected = 疊同色系 main × 16% + 1px 同色系 main 框。Neutral 用 grey/500、Warning warning/main、Error error/main。
//   疊色用 state layer 圖層:最底層 `state-layer` 矩形(絕對定位、四邊 STRETCH),填色綁同色系 main、圖層不透明度 8% / 16%
//   (不用 paint 不透明度:新建的實例會畫成 100%,見 StateLayer.js)。
const state = async (c, st, toneMain) => {
  if (st === "Hover" || st === "Selected") {
    const r = figma.createRectangle();
    r.name = "state-layer";
    c.insertChild(0, r);
    r.layoutPositioning = "ABSOLUTE";
    r.x = r.y = 0;
    r.resize(c.width, c.height);
    r.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
    r.cornerRadius = c.cornerRadius;
    r.fills = [await paint(toneMain)];
    r.opacity = st === "Hover" ? 0.08 : 0.16;
    c.strokes = [await paint(toneMain)];
    c.strokeWeight = 1;
    if (st === "Selected") c.strokesIncludedInLayout = false;
  }
};
// 1. ScheduleTimelineMore:[框, 字, 互動狀態的同色系 main]
const TM = {
  Neutral: ["divider", "text/secondary", "grey/500"],
  Warning: ["warning/main", "warning/darker", "warning/main"],
  Error: ["error/main", "error/darker", "error/main"],
};
const mores = [];
for (const tone of Object.keys(TM))
  for (const st of ["Default", "Hover", "Selected"]) {
    const [sk, tc, hs] = TM[tone];
    const c = figma.createComponent();
    c.name = `Tone=${tone}, State=${st}`;
    c.layoutMode = "VERTICAL";
    c.counterAxisAlignItems = "CENTER";
    c.paddingTop = c.paddingBottom = 6;
    c.paddingLeft = c.paddingRight = 2;
    c.cornerRadius = 6;
    c.fills = [await paint("grey/100")];
    c.strokes = [await paint(sk)];
    c.strokeWeight = 1;
    c.strokeAlign = "INSIDE";
    c.primaryAxisSizingMode = c.counterAxisSizingMode = "FIXED";
    c.resize(20, 120);
    c.appendChild(await T("+1", "Caption/SemiBold", tc, "label"));
    await state(c, st, hs);
    page.appendChild(c);
    mores.push(c);
  }
const ms = figma.combineAsVariants(mores, page);
ms.name = "Draft/ScheduleTimelineMore";
const km = ms.addComponentProperty("Label", "TEXT", "+1");
for (const v of ms.children)
  v.findOne((n) => n.name === "label").componentPropertyReferences = {
    characters: km,
  };
ms.description =
  PREFIX +
  "ScheduleTimeline 週模式的「+N」長條(底座規格 10.11 週模式排版):有容器被收起時,當天欄最右邊一條,寬 20、高度佔滿時間軸 00:00~24:00(實例依位置改高度);Label 寫「+收起筆數」。底 grey/100;Tone 由模組依被收起內容決定:Neutral(divider 框)/ Warning(warning/main 框,收起的有缺協同)/ Error(error/main 框,收起的有缺負責)。State:Default / Hover(grey/100 上疊同色系 main × 8%:Neutral grey/500、Warning warning/main、Error error/main;框同色系 main)/ Selected(疊同色系 main × 16% + 1px 同色系 main 框)。點了回呼模組(例:清單浮層)。";
// 2. StatusChip:[底, 字, 框, 框加深]
const TS = {
  Neutral: ["grey/100", "text/primary", "divider", "grey/500"],
  Warning: ["warning/lighter", "warning/darker", null, "warning/main"],
  Error: ["error/lighter", "error/darker", null, "error/main"],
};
const chips = [];
for (const tone of Object.keys(TS))
  for (const st of ["Default", "Hover", "Selected"]) {
    const [bg, tc, sk, hs] = TS[tone];
    const c = figma.createComponent();
    c.name = `Tone=${tone}, State=${st}`;
    c.layoutMode = "VERTICAL";
    c.paddingLeft = c.paddingRight = 6;
    c.paddingTop = c.paddingBottom = 2;
    c.cornerRadius = 4;
    c.primaryAxisSizingMode = c.counterAxisSizingMode = "AUTO";
    c.fills = [await paint(bg)];
    if (sk) {
      c.strokes = [await paint(sk)];
      c.strokeWeight = 1;
    }
    c.strokeAlign = "INSIDE";
    c.strokesIncludedInLayout = false;
    c.appendChild(await T("負1/1 協1/1", "Caption/SemiBold", tc, "label"));
    c.appendChild(await T("缺 1 · 可排 2", "Caption", "text/secondary", "sub"));
    await state(c, st, hs);
    page.appendChild(c);
    chips.push(c);
  }
const cs = figma.combineAsVariants(chips, page);
cs.name = "Draft/StatusChip";
const kl = cs.addComponentProperty("Label", "TEXT", "負1/1 協1/1");
const ksub = cs.addComponentProperty("Sub", "TEXT", "缺 1 · 可排 2");
const kh = cs.addComponentProperty("HasSub", "BOOLEAN", false);
for (const v of cs.children) {
  v.findOne((n) => n.name === "label").componentPropertyReferences = {
    characters: kl,
  };
  v.findOne((n) => n.name === "sub").componentPropertyReferences = {
    characters: ksub,
    visible: kh,
  };
}
cs.description =
  PREFIX +
  "狀態標籤(底座規格 10.5 / 10.11):文字由使用處傳入(Label;HasSub 時第二行 Sub);Tone Neutral(grey/100 + divider 細框)/ Warning / Error;State Default / Hover / Selected。";
return { more: ms.id, chip: cs.id };
