// 互動狀態(底座規格 10.11「互動狀態」;專案規格 14.5「滑過提示」)。前置:貼上 _resolve.js;在草稿頁執行(scratch:Base Draft、base:Draft / 本輪)。
// 2026-10-30 起元件依名稱在目前頁找、變數經 tok() 取(原本寫死 scratch-lot 節點 id、用 teamLibrary 查);已經有互動狀態的元件跳過,可重跑。
// Draft/ScheduleTimelineBlock(259:4770)、Draft/ScheduleTimelineDemand(286:77949)加變體屬性 Interaction = Default / Hover / Selected / Focus
// (只做 State=Normal、Tone=Normal 一組,其他狀態沿用同規則);Draft/RosterCell(49:493)的 State 加 Hover / Focus(Selected 原本就有);
// (專案 Draft/MoreStrip 的 Interaction 已隨元件移到底座 Draft/ScheduleTimelineMore 的 State,見 TimelineMore-StatusChip.js。)
//   Hover    = 照 MUI:原底色上疊一層同色系 main(綁變數)× 8%(action.hoverOpacity),邊框換同色系 main。
//   Selected = 疊同色系 main × 16%(action.selectedOpacity)+ 1px 同色系 main 邊框。
//              色系:長條 primary/main;白底(bg/default、bg/paper)與 grey 底 grey/500;warning/* → warning/main;error/* → error/main。
//              疊色用 state layer 圖層(最底層 `state-layer` 矩形,圖層不透明度;見 StateLayer.js),不新增變數、不寫死色碼。
//   Focus    = action/focus 2px 外框(鍵盤焦點;畫面不用每張畫)
// 手機沒有滑過:按下時底色加深(同 Hover 外觀),內容看對話框。Base Draft 的 BS-22 加一列「互動狀態」示範。
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
// 互動狀態的色系:依原底色的變數名稱決定疊色與框色(main),到 wowgo-base Library 依名稱查(Color 優先,其次 Primitives)
const TONE = (nm) =>
  /^primary\//.test(nm)
    ? "primary/main"
    : /^warning\//.test(nm)
      ? "warning/main"
      : /^error\//.test(nm)
        ? "error/main"
        : /^(bg\/|grey\/)/.test(nm)
          ? "grey/500"
          : null;
const libVar = (name) => tok(name);
const varName = async (p) =>
  p?.boundVariables?.color
    ? (await figma.variables.getVariableByIdAsync(p.boundVariables.color.id))
        .name
    : null;
const make = async (base, mode) => {
  const c = base.clone();
  base.parent.appendChild(c);
  copyRefs(base, c);
  if (mode === "Hover" || mode === "Selected") {
    const nm = await varName(c.fills[0]);
    const tone = TONE(nm);
    if (!tone) throw new Error("沒有對應色系:" + nm + ",回報不要自創");
    const v = await libVar(tone);
    const r = figma.createRectangle();
    r.name = "state-layer";
    c.insertChild(0, r);
    if (c.layoutMode !== "NONE") r.layoutPositioning = "ABSOLUTE";
    r.x = r.y = 0;
    r.resize(c.width, c.height);
    r.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
    r.topLeftRadius = c.topLeftRadius;
    r.topRightRadius = c.topRightRadius;
    r.bottomLeftRadius = c.bottomLeftRadius;
    r.bottomRightRadius = c.bottomRightRadius;
    r.fills = [Pt(v)];
    r.opacity = mode === "Hover" ? 0.08 : 0.16;
    c.strokes = [Pt(v)];
    if (mode === "Selected") {
      c.strokeWeight = 1;
      c.strokesIncludedInLayout = false; // 框不佔版面,窄長條的內容不被擠
    }
  }
  if (mode === "Focus") {
    c.strokes = [Pt(await tok("action/focus"))];
    c.strokeWeight = 2;
    c.strokeAlign = "OUTSIDE";
  }
  return c;
};
const addProp = async (setName, baseName, modes, nameOf) => {
  const set = draft(setName);
  // ScheduleTimeline-parts.js 建立時就有 Interaction,不重複加
  if (set.componentPropertyDefinitions.Interaction) return;
  for (const v of set.children) v.name += ", Interaction=Default";
  const base = set.children.find(
    (v) => v.name === baseName + ", Interaction=Default",
  );
  for (const m of modes) (await make(base, m)).name = nameOf(m);
};
await addProp(
  "Draft/ScheduleTimelineBlock",
  "State=Normal, Auto=False",
  ["Hover", "Selected", "Focus"],
  (m) => `State=Normal, Auto=False, Interaction=${m}`,
);
await addProp(
  "Draft/ScheduleTimelineDemand",
  "Tone=Normal",
  ["Hover", "Selected", "Focus"],
  (m) => `Tone=Normal, Interaction=${m}`,
);
{
  const set = draft("Draft/RosterCell");
  const base = set.children.find((v) => v.name === "State=Filled");
  if (!set.children.some((v) => v.name === "State=Hover"))
    for (const m of ["Hover", "Focus"])
      (await make(base, m)).name = "State=" + m;
}
return "ok";
