// 互動狀態的疊色改成 state layer 圖層(底座規格 10.11「互動狀態」:疊色用 state layer 圖層)。在 scratch-lot Screens 執行,只動 Base Draft 頁的元件。
// 原本 Hover / Selected 變體用「第二層填色 + paint 不透明度 8% / 16%」疊色;實測綁變數的 paint 不透明度在主元件正常,
// 但新建的實例會畫成 100%(實心)。改成:最底層一個 `state-layer` 矩形(絕對定位、四邊 STRETCH、圓角同元件),
// 填色綁同色系 main 變數(和原疊色同一個變數),圖層不透明度 8% / 16%;元件本身只留原底色一層。
// 對象:Draft/ScheduleTimelineBlock(259:4770)、ScheduleTimelineDemand(286:77949)、ScheduleTimelineMore(408:8012)、
// StatusChip(408:8040)、RosterCell(49:493)。Draft/ToggleButton(497:8040)建立時就是這個結構(ToggleButton.js)。
// 已經轉過的變體(有 state-layer)會跳過,可重跑。
const SETS = ["259:4770", "286:77949", "408:8012", "408:8040", "49:493"];
const out = [];
for (const id of SETS) {
  const set = await figma.getNodeByIdAsync(id);
  for (const v of set.children) {
    if (v.findChild((c) => c.name === "state-layer")) continue;
    const i = v.fills.findIndex((f) => (f.opacity ?? 1) < 0.999);
    if (i < 0) continue;
    const ov = v.fills[i];
    const op = ov.opacity;
    const vr = await figma.variables.getVariableByIdAsync(
      ov.boundVariables.color.id,
    );
    v.fills = v.fills.filter((_, k) => k !== i);
    const r = figma.createRectangle();
    r.name = "state-layer";
    v.insertChild(0, r);
    if (v.layoutMode !== "NONE") r.layoutPositioning = "ABSOLUTE";
    r.x = r.y = 0;
    r.resize(v.width, v.height);
    r.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
    r.topLeftRadius = v.topLeftRadius;
    r.topRightRadius = v.topRightRadius;
    r.bottomLeftRadius = v.bottomLeftRadius;
    r.bottomRightRadius = v.bottomRightRadius;
    const c = vr.resolveForConsumer(v).value;
    r.fills = [
      figma.variables.setBoundVariableForPaint(
        { type: "SOLID", color: { r: c.r, g: c.g, b: c.b } },
        "color",
        vr,
      ),
    ];
    r.opacity = op;
    out.push(`${set.name} ${v.name}:${vr.name} × ${Math.round(op * 100)}%`);
  }
}
return out;
