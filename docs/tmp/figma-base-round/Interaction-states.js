// 互動狀態(底座規格 10.11「互動狀態」;專案規格 14.5「滑過提示」)。前置:貼上 _resolve.js;在 scratch-lot Screens 執行。
// Draft/ScheduleTimelineBlock(259:4770)、Draft/ScheduleTimelineDemand(286:77949)加變體屬性 Interaction = Default / Hover / Selected / Focus
// (只做 State=Normal、Tone=Normal 一組,其他狀態沿用同規則);Draft/RosterCell(49:493)的 State 加 Hover / Focus(Selected 原本就有);
// (專案 Draft/MoreStrip 的 Interaction 已隨元件移到底座 Draft/ScheduleTimelineMore 的 State,見 TimelineMore-StatusChip.js。)
//   Hover    = 底色換同色系深一階的共用色票(primary/lighter → primary/light、warning/lighter → warning/light、
//              error/lighter → error/light、grey/100 → grey/200),框換同色系 dark(primary/dark、warning/dark、error/dark;divider → grey/500)。
//              不再疊 action/hover(灰 8% 疊在黃色上會變髒);只能用既有色票;白底(bg/default、bg/paper)滑過 → grey/100、框 grey/500。
//   Selected = 滑過的底色 + 2px 同色系 dark 框(框不佔版面);不疊 action/selected
//   Focus    = action/focus 2px 外框(鍵盤焦點;畫面不用每張畫)
// 手機沒有滑過:按下時底色加深(同 Hover 外觀),內容看對話框。Base Draft 的 BS-22 加一列「互動狀態」示範。
const KEY = {
  hover: "9d069b9ff19a0e0bb8e82e1205e9b20fa27eea47",
  sel: "37f80e5dfc92ba565ff5e53f7dd2c91ea8e4a323",
  focus: "906e5a99b09714d270bb29494c2b153ee90e6f8f",
  pdark: "c4d9e8d337cf252393a3cb8ec36da76e173ee699",
  g500: "c84c76fe3426c8a7433557941dff0bed92c7d2bb",
  pmain: "3666ac0c6b3d12e8e38f6be8270287eb55a5cce1",
};
const V = {};
for (const [k, v] of Object.entries(KEY))
  V[k] = await figma.variables.importVariableByKeyAsync(v);
const Pt = (v) =>
  figma.variables.setBoundVariableForPaint(
    { type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } },
    "color",
    v,
  );
// 複製變體時元件屬性的連結會掉,要照原變體補回
const copyRefs = (a, b) => {
  const A = [a, ...a.findAll(() => true)],
    B = [b, ...b.findAll(() => true)];
  for (let i = 0; i < A.length && i < B.length; i++) {
    const r = A[i].componentPropertyReferences;
    if (r && Object.keys(r).length)
      try {
        B[i].componentPropertyReferences = r;
      } catch (e) {}
  }
};
// Hover 用的「深一階」與「框 dark」:依變數名稱到 wowgo-base Library 查(Color 優先,其次 Primitives),只用既有色票
const STEP = {
  "bg/default": "grey/100",
  "bg/paper": "grey/100",
  "primary/lighter": "primary/light",
  "warning/lighter": "warning/light",
  "error/lighter": "error/light",
  "grey/100": "grey/200",
};
const DARK = {
  primary: "primary/dark",
  warning: "warning/dark",
  error: "error/dark",
  success: "success/dark",
  divider: "grey/500",
};
const libCols = (
  await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()
).filter((c) => c.libraryName === "wowgo-base Design System");
const libVar = async (name) => {
  for (const cn of ["Color", "Primitives"]) {
    const c = libCols.find((x) => x.name === cn);
    const v = (
      await figma.teamLibrary.getVariablesInLibraryCollectionAsync(c.key)
    ).find((x) => x.name === name);
    if (v) return figma.variables.importVariableByKeyAsync(v.key);
  }
  throw new Error("沒有共用色票 " + name + ",回報不要自創");
};
const varName = async (p) =>
  p?.boundVariables?.color
    ? (await figma.variables.getVariableByIdAsync(p.boundVariables.color.id))
        .name
    : null;
const darker = async (n) => {
  const nm = await varName(n.strokes?.[0]);
  if (!nm) return;
  const fam = nm.split("/")[0];
  if (DARK[fam]) n.strokes = [Pt(await libVar(DARK[fam]))];
};
const make = async (base, mode) => {
  const c = base.clone();
  base.parent.appendChild(c);
  copyRefs(base, c);
  if (mode === "Hover") {
    const nm = await varName(c.fills[0]);
    if (!STEP[nm])
      throw new Error("沒有深一階的共用色票:" + nm + ",回報不要自創");
    c.fills = [Pt(await libVar(STEP[nm]))];
    await darker(c);
  }
  if (mode === "Selected") {
    // 滑過的底色 + 2px 同色系 dark 框(框不佔版面)
    const nm = await varName(c.fills[0]);
    if (!STEP[nm])
      throw new Error("沒有深一階的共用色票:" + nm + ",回報不要自創");
    c.fills = [Pt(await libVar(STEP[nm]))];
    await darker(c);
    c.strokeWeight = 2;
    if (c.layoutMode !== "NONE") c.strokesIncludedInLayout = false;
  }
  if (mode === "Focus") {
    c.strokes = [Pt(V.focus)];
    c.strokeWeight = 2;
    c.strokeAlign = "OUTSIDE";
  }
  return c;
};
const addProp = async (setId, baseName, modes, nameOf) => {
  const set = await figma.getNodeByIdAsync(setId);
  for (const v of set.children) v.name += ", Interaction=Default";
  const base = set.children.find(
    (v) => v.name === baseName + ", Interaction=Default",
  );
  for (const m of modes) (await make(base, m)).name = nameOf(m);
};
await addProp(
  "259:4770",
  "State=Normal, Auto=False",
  ["Hover", "Selected", "Focus"],
  (m) => `State=Normal, Auto=False, Interaction=${m}`,
);
await addProp(
  "286:77949",
  "Tone=Normal",
  ["Hover", "Selected", "Focus"],
  (m) => `Tone=Normal, Interaction=${m}`,
);
{
  const set = await figma.getNodeByIdAsync("49:493");
  const base = set.children.find((v) => v.name === "State=Filled");
  for (const m of ["Hover", "Focus"]) (await make(base, m)).name = "State=" + m;
}
return "ok";
