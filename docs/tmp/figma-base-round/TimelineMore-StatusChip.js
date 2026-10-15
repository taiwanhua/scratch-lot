// Draft/ScheduleTimelineMore + Draft/StatusChip(底座規格 10.11 / 10.5)。在 scratch-lot Screens 的 Base Draft 頁(41:5914)執行,只綁 wowgo-base 變數。
// ScheduleTimelineMore(408:8012):週模式收起窄條「+N 人」(容器最後一條,和長條同寬、高度同容器)/「+N 需求」(當天欄最右邊,高度對齊被收起需求)。
//   垂直 auto layout、框與底畫在元件本身,實例依位置改寬高;Tone = Neutral / Success / Warning / Error × State = Default / Hover / Selected × Size;屬性 Label。
//   Size=Strip 是上述窄條;Size=Compact 是小徽章(水平 auto layout、寬高 hug、圓角 9):容器只放得下 1 條且人數 > 1 時,
//   放在那條長條底部內側(距底 4px、水平置中),點了 = 打開那筆人力需求對話框;顏色與互動狀態同窄條。
//   取代專案的 Draft/MoreStrip(已刪除,實例全部換掉);Draft/ScheduleTimeline 週模式原本拿 ScheduleTimelineDemand 改字的「+1 需求」也換成它。
// StatusChip(408:8040):人數 / 彙總等短文字標籤,寬高 hug;Tone = Neutral(grey/100 + divider 細框)/ Warning / Error × State = Default / Hover / Selected;
//   屬性 Label、Sub(第二行,text/secondary)、HasSub。RosterGrid 群組列 / 彙總列、MonthCalendar 格子內容、時間軸清單浮層的人數標籤都用它。
const KEYS = {
  bgdef: "f3cf90e5f836dd44d0124f96199feb7ce961d9fc",
  divider: "860a5dc497e0d365947731af9f273cd963ca1d04",
  tp: "d55b27457c6f95c898e614be4c16cef386fe1f65",
  ts: "c11ac6a81b471a6a46f85602d056355c19fd4166",
  g100: "6a1782058955b5f1b570298844375dfdede51f73",
  g500: "c84c76fe3426c8a7433557941dff0bed92c7d2bb",
  wl: "15f96b616735c06dd4034cd95ca8dc525c66977a",
  wd: "39797cd1b142124ac07aa6fee4d0d09437d1f01e",
  wm: "c4795bb776010891dbb7e03790c05d403ac4c75a",
  el: "bf0c706be97615148e026899f796626275e5d07a",
  ed: "d4fc0e5cb1a056c4bb694852fc2b93df0c0fa62d",
  em: "0d2b086b0de059122075ae1efcdf53c86d10497d",
  sm: "6e398ee88e62c802e89a1f46853dfda221b9d453",
  sd: "ac8c30c7ab66719184ca649b28ae7a18bf1a4303",
  hover: "9d069b9ff19a0e0bb8e82e1205e9b20fa27eea47",
  sel: "37f80e5dfc92ba565ff5e53f7dd2c91ea8e4a323",
  pm: "3666ac0c6b3d12e8e38f6be8270287eb55a5cce1",
};
const V = {};
for (const [k, v] of Object.entries(KEYS))
  V[k] = await figma.variables.importVariableByKeyAsync(v);
const capSB = await figma.importStyleByKeyAsync(
  "7cfa2be1b685e1bf7c2d32270742cbf2e41d61d2",
);
const cap = await figma.importStyleByKeyAsync(
  "cf4328c6d8830674997c8a3f7d6aa200f50eab70",
);
await figma.loadFontAsync(capSB.fontName);
await figma.loadFontAsync(cap.fontName);
const P = (v) =>
  figma.variables.setBoundVariableForPaint(
    { type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } },
    "color",
    v,
  );
const page = await figma.getNodeByIdAsync("41:5914");
await figma.setCurrentPageAsync(page);
const PREFIX = "【底座・本輪草稿,完成後搬回 wowgo-base Design System】";
const T = async (s, st, c, name) => {
  const t = figma.createText();
  await t.setTextStyleIdAsync(st.id);
  t.characters = s;
  t.fills = [P(V[c])];
  t.name = name;
  return t;
};
// 互動狀態:Hover = 底疊 action/hover、框加深;Selected = 底疊 action/selected、2px primary/main 框
const state = (c, st, hoverStroke) => {
  if (st === "Hover") {
    c.fills = [...c.fills, P(V.hover)];
    c.strokes = [P(V[hoverStroke])];
    c.strokeWeight = 1;
  }
  if (st === "Selected") {
    c.fills = [...c.fills, P(V.sel)];
    c.strokes = [P(V.pm)];
    c.strokeWeight = 2;
  }
};
// 1. ScheduleTimelineMore:[框, 字, 框加深]
const TM = {
  Neutral: ["divider", "ts", "g500"],
  Success: ["sm", "sd", "sm"],
  Warning: ["wm", "wd", "wm"],
  Error: ["em", "ed", "em"],
};
const mores = [];
for (const tone of Object.keys(TM))
  for (const st of ["Default", "Hover", "Selected"]) {
    const [sk, tc, hs] = TM[tone];
    const c = figma.createComponent();
    c.name = `Tone=${tone}, State=${st}, Size=Strip`;
    c.layoutMode = "VERTICAL";
    c.counterAxisAlignItems = "CENTER";
    c.paddingTop = c.paddingBottom = 6;
    c.paddingLeft = c.paddingRight = 2;
    c.cornerRadius = 6;
    c.fills = [P(V.bgdef)];
    c.strokes = [P(V[sk])];
    c.strokeWeight = 1;
    c.strokeAlign = "INSIDE";
    c.primaryAxisSizingMode = c.counterAxisSizingMode = "FIXED";
    c.resize(28, 120);
    c.appendChild(await T("+1", capSB, tc, "label"));
    state(c, st, hs);
    page.appendChild(c);
    mores.push(c);
    // Size=Compact:長條底部內側的小徽章
    const b = figma.createComponent();
    b.name = `Tone=${tone}, State=${st}, Size=Compact`;
    b.layoutMode = "HORIZONTAL";
    b.primaryAxisAlignItems = b.counterAxisAlignItems = "CENTER";
    b.primaryAxisSizingMode = b.counterAxisSizingMode = "AUTO";
    b.paddingTop = b.paddingBottom = 1;
    b.paddingLeft = b.paddingRight = 5;
    b.cornerRadius = 9;
    b.fills = [P(V.bgdef)];
    b.strokes = [P(V[sk])];
    b.strokeWeight = 1;
    b.strokeAlign = "INSIDE";
    b.appendChild(await T("+1", capSB, tc, "label"));
    state(b, st, hs);
    page.appendChild(b);
    mores.push(b);
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
  "ScheduleTimeline 週模式的收起窄條(底座規格 10.11):「+N 人」= 容器最後一條、「+N 需求」= 當天欄最右邊一條;Tone 四種(缺額優先)、State Default / Hover / Selected;屬性 Label。Size:Strip(窄條)/ Compact(小徽章:容器只放得下 1 條且人數 > 1 時放在那條長條底部內側,點了 = 打開那筆人力需求對話框;顏色與互動狀態同窄條)。";
// 2. StatusChip:[底, 字, 框, 框加深]
const TS = {
  Neutral: ["g100", "tp", "divider", "g500"],
  Warning: ["wl", "wd", null, "wm"],
  Error: ["el", "ed", null, "em"],
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
    c.fills = [P(V[bg])];
    if (sk) {
      c.strokes = [P(V[sk])];
      c.strokeWeight = 1;
    }
    c.strokeAlign = "INSIDE";
    c.strokesIncludedInLayout = false;
    c.appendChild(await T("負1/1 協1/1", capSB, tc, "label"));
    c.appendChild(await T("缺 1 · 可排 2", cap, "ts", "sub"));
    state(c, st, hs);
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
