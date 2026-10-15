// Draft/ScheduleTimelineMore + Draft/StatusChip(底座規格 10.11 / 10.5)。在 scratch-lot Screens 的 Base Draft 頁(41:5914)執行,只綁 wowgo-base 變數。
// ScheduleTimelineMore(408:8012):週模式的「+N」長條(底座規格 10.11 週模式排版):有容器被收起時,當天欄最右邊一條,
//   寬 20、高度佔滿時間軸(實例依位置改高度);Label「+收起筆數」。底 grey/100;Tone = Neutral(divider 框)/ Warning / Error
//   × State = Default / Hover(底 grey/200、框換同色系 dark)/ Selected(grey/200 + 2px 同色系 dark 框)。
//   第二十四輪後續之十三起不再有「+N 人」窄條與長條上的小徽章(Size=Strip / Compact、Tone=Success 已刪除)。
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
  g200: "ff65fc9dfea7c90e278a7909f54de2fea8d50137",
  wlight: "0037d0dd2c631bb8026f2af4a43bae1e7d38086a",
  elight: "bc7d026babd8167a86c89c1663274858d15f3e95",
  wdk: "70cd53039f08a6ba60b4664611f63d6e4c2d4aca",
  edk: "f595ae96fed0942be2c3e6028cfc9e8b1e0f6227",
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
// 互動狀態:Hover = 底色換同色系深一階的共用色票(grey/100 → grey/200、warning/lighter → warning/light、error/lighter → error/light),
//   框換同色系 dark(不疊 action/hover;只用既有色票)。
//   Selected = 滑過的底色 + 2px 同色系 dark 框(框不佔版面;不疊 action/selected)
const HOVER_BG = { g100: "g200", wl: "wlight", el: "elight" };
const state = (c, st, hoverStroke, bg) => {
  if (st === "Hover") {
    c.fills = HOVER_BG[bg] ? [P(V[HOVER_BG[bg]])] : [...c.fills, P(V.hover)];
    c.strokes = [P(V[hoverStroke])];
    c.strokeWeight = 1;
  }
  if (st === "Selected") {
    c.fills = [P(V[HOVER_BG[bg]])];
    c.strokes = [P(V[hoverStroke])];
    c.strokeWeight = 2;
    c.strokesIncludedInLayout = false;
  }
};
// 1. ScheduleTimelineMore:[框, 字, Hover 框(同色系 dark)]
const TM = {
  Neutral: ["divider", "ts", "g500"],
  Warning: ["wm", "wd", "wdk"],
  Error: ["em", "ed", "edk"],
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
    c.fills = [P(V.g100)];
    c.strokes = [P(V[sk])];
    c.strokeWeight = 1;
    c.strokeAlign = "INSIDE";
    c.primaryAxisSizingMode = c.counterAxisSizingMode = "FIXED";
    c.resize(20, 120);
    c.appendChild(await T("+1", capSB, tc, "label"));
    state(c, st, hs, "g100");
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
  "ScheduleTimeline 週模式的「+N」長條(底座規格 10.11 週模式排版):有容器被收起時,當天欄最右邊一條,寬 20、高度佔滿時間軸 00:00~24:00(實例依位置改高度);Label 寫「+收起筆數」。底 grey/100;Tone 由模組依被收起內容決定:Neutral(divider 框)/ Warning(warning/main 框,收起的有缺協同)/ Error(error/main 框,收起的有缺負責)。State:Default / Hover(底換深一階 grey/200、框換同色系 dark:grey/500 / warning/dark / error/dark)/ Selected(grey/200 + 2px 同色系 dark 框,框不佔版面)。點了回呼模組(例:清單浮層)。";
// 2. StatusChip:[底, 字, 框, 框加深]
const TS = {
  Neutral: ["g100", "tp", "divider", "g500"],
  Warning: ["wl", "wd", null, "wdk"],
  Error: ["el", "ed", null, "edk"],
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
    state(c, st, hs, bg);
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
