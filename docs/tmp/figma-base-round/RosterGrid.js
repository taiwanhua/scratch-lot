// Draft/RosterCell + Draft/RosterGrid(底座規格 10.5)。前置:貼上 _resolve.js。頂部固定群組 / 收合彙總見 RosterGrid-group.js(之後執行);
// Hover / Focus 由 Interaction-states.js 從 Filled 複製。
// Cell 屬性:State=Empty / Filled / Selected;Lead(BOOLEAN)+ LeadText(TEXT):時間前面的負責人小標(success/lighter 底、success/darker 字);
// Break(BOOLEAN)+ BreakText(TEXT):休息「☕ 30 分」;Corner(BOOLEAN)+ CornerContent(SLOT):右上角標示槽(2026-10-30 照 scratch-lot 現況補進腳本)。
// MUI LocalCafeOutlined(和 ScheduleTimeline-parts.js 同一個路徑)
const CAFE_PATH =
  "M 7 1 L 7 5 C 7 5.550000011920929 6.550000011920929 6 6 6 L 3 6 C 2.449999988079071 6 2 5.550000011920929 2 5 L 2 1 L 7 1 Z M 9 0 L 1 0 L 1 5 C 1 6.105000019073486 1.8949999809265137 7 3 7 L 6 7 C 7.105000019073486 7 8 6.105000019073486 8 5 L 8 3.5 L 9 3.5 C 9.555000007152557 3.5 10 3.0550000071525574 10 2.5 L 10 1 C 10 0.4449999928474426 9.555000007152557 0 9 0 Z M 8 2.5 L 8 1 L 9 1 L 9 2.5 L 8 2.5 Z M 9 8 L 0 8 L 0 9 L 9 9 L 9 8 Z";
async function breakRow() {
  const r = al("HORIZONTAL", {
    name: "break",
    itemSpacing: 2,
    counterAxisAlignItems: "CENTER",
  });
  r.clipsContent = true;
  const f = figma.createFrame();
  f.name = "local-cafe";
  f.resize(12, 12);
  f.fills = [];
  f.clipsContent = true;
  const v = figma.createVector();
  v.name = "Vector";
  v.vectorPaths = [{ windingRule: "NONZERO", data: CAFE_PATH }];
  f.appendChild(v);
  v.x = 1;
  v.y = 1.5;
  v.fills = [await paint("text/secondary")];
  v.strokes = [];
  v.constraints = { horizontal: "SCALE", vertical: "SCALE" };
  add(r, f, "FIXED", "FIXED");
  add(r, await txt("30 分", "Caption", "text/secondary", "break-text"));
  r.visible = false;
  return r;
}
async function rcell(state) {
  const c = figma.createComponent();
  c.name = "State=" + state;
  c.layoutMode = "VERTICAL";
  c.itemSpacing = 4;
  c.paddingLeft = c.paddingRight = c.paddingTop = c.paddingBottom = 6;
  c.resize(128, 64);
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "FIXED";
  c.fills = [await paint("bg/paper")];
  // Selected 照互動狀態(底座規格 10.11):白底上疊 grey/500 × 16% + 1px grey/500 框(框不佔版面)
  c.strokes = [await paint(state === "Selected" ? "grey/500" : "divider")];
  c.strokeWeight = 1;
  c.strokeAlign = "INSIDE";
  if (state === "Selected") c.strokesIncludedInLayout = false;
  c.clipsContent = false;
  const slot = al("VERTICAL", {
    name: "slot(格子內容由使用處放入)",
    itemSpacing: 2,
    paddingLeft: 6,
    paddingRight: 6,
    paddingTop: 4,
    paddingBottom: 4,
  });
  if (state !== "Empty") {
    slot.fills = [await paint("primary/lighter")];
    await radius(slot, "radius/sm");
    const row = al("HORIZONTAL", {
      name: "line-1-row",
      itemSpacing: 4,
      counterAxisAlignItems: "CENTER",
    });
    row.clipsContent = true;
    add(slot, row, "FILL");
    const chip = al("HORIZONTAL", {
      name: "lead-chip",
      paddingLeft: 4,
      paddingRight: 4,
    });
    chip.fills = [await paint("success/lighter")];
    chip.cornerRadius = 4;
    chip.clipsContent = true;
    add(
      chip,
      await txt("早", "Caption/SemiBold", "success/darker", "lead-text"),
    );
    add(row, chip);
    chip.visible = false;
    add(
      row,
      await txt("09:00–17:00", "Caption/SemiBold", "text/primary", "line-1"),
      "FILL",
    );
    add(row, await breakRow());
    add(slot, await txt("櫃台 A", "Caption", "text/secondary", "line-2"));
  }
  add(c, slot, "FILL", state === "Empty" ? "FILL" : "HUG");
  // 右上角標示槽:靠右上、距邊 4,內容由使用的模組放入
  const corner = c.createSlot();
  corner.name = "CornerContent";
  corner.layoutMode = "HORIZONTAL";
  corner.primaryAxisAlignItems = "MAX";
  corner.counterAxisAlignItems = "MIN";
  corner.fills = [];
  corner.layoutPositioning = "ABSOLUTE";
  corner.primaryAxisSizingMode = corner.counterAxisSizingMode = "FIXED";
  corner.resize(48, 22);
  corner.x = 76;
  corner.y = 4;
  corner.constraints = { horizontal: "MAX", vertical: "MIN" };
  corner.visible = false;
  if (state === "Selected") {
    const r = figma.createRectangle();
    r.name = "state-layer";
    c.insertChild(0, r);
    r.layoutPositioning = "ABSOLUTE";
    r.x = r.y = 0;
    r.resize(128, 64);
    r.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
    r.fills = [await paint("grey/500")];
    r.opacity = 0.16;
  }
  return c;
}
const rs = figma.combineAsVariants(
  [await rcell("Empty"), await rcell("Filled"), await rcell("Selected")],
  figma.currentPage,
);
rs.name = "Draft/RosterCell";
{
  const kL = rs.addComponentProperty("Lead", "BOOLEAN", false);
  const kT = rs.addComponentProperty("LeadText", "TEXT", "早");
  const kB = rs.addComponentProperty("Break", "BOOLEAN", false);
  const kBT = rs.addComponentProperty("BreakText", "TEXT", "30 分");
  const kC = rs.addComponentProperty("Corner", "BOOLEAN", false);
  for (const v of rs.children) {
    const corner = v.findOne((n) => n.name === "CornerContent");
    corner.componentPropertyReferences = {
      ...corner.componentPropertyReferences,
      visible: kC,
    };
    const chip = v.findOne((n) => n.name === "lead-chip");
    if (!chip) continue;
    chip.componentPropertyReferences = { visible: kL };
    v.findOne((n) => n.name === "lead-text").componentPropertyReferences = {
      characters: kT,
    };
    v.findOne((n) => n.name === "break").componentPropertyReferences = {
      visible: kB,
    };
    v.findOne((n) => n.name === "break-text").componentPropertyReferences = {
      characters: kBT,
    };
  }
}
rs.layoutMode = "HORIZONTAL";
rs.itemSpacing = 16;
rs.paddingLeft = rs.paddingRight = rs.paddingTop = rs.paddingBottom = 16;
rs.primaryAxisSizingMode = "AUTO";
rs.counterAxisSizingMode = "AUTO";
rs.description =
  DESC_PREFIX +
  "RosterGrid 的格子(底座規格 10.5)。State=Empty / Filled / Selected(白底上疊 grey/500 × 16% + 1px grey/500 框)。格子內容由使用的模組決定(內容槽);排班以 primary/lighter 卡片示意「時間 + 崗位 · 職責」。 State=Hover(白底上疊 grey/500 × 8%、框 grey/500)/ State=Focus(action/focus 2px 外框);State=Selected 為選取。 右上角標示槽:BOOLEAN Corner 打開 + SLOT CornerContent(由使用的模組放入標示,例:未對應排班的打卡張數;靠右上、距邊 4)。";

const days = [
  ["10/11", "日"],
  ["10/12", "一"],
  ["10/13", "二"],
  ["10/14", "三"],
  ["10/15", "四"],
  ["10/16", "五"],
  ["10/17", "六"],
];
const g = figma.createComponent();
g.name = "Draft/RosterGrid";
g.layoutMode = "VERTICAL";
g.primaryAxisSizingMode = "AUTO";
g.counterAxisSizingMode = "AUTO";
g.fills = [await paint("bg/paper")];
g.strokes = [await paint("divider")];
g.strokeWeight = 1;
g.clipsContent = true;
await radius(g, "radius/sm");
async function headCell(t1, t2, w, frozen) {
  const h = al("VERTICAL", {
    name: frozen ? "frozen-header" : "date-header",
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 3,
    paddingBottom: 3,
  });
  h.fills = [await paint("bg/default")];
  h.strokes = [await paint("divider")];
  h.strokeWeight = 1;
  h.strokeAlign = "INSIDE";
  h.resize(w, 48);
  h.primaryAxisSizingMode = "FIXED";
  h.counterAxisSizingMode = "FIXED";
  add(h, await txt(t1, "Subtitle/2", "text/secondary"));
  if (t2) add(h, await txt(t2, "Caption", "text/secondary"));
  return h;
}
const hr = al("HORIZONTAL", { name: "header-row" });
add(hr, await headCell("人員", "", 176, true));
for (const [d, w] of days) add(hr, await headCell(d, w, 128));
add(g, hr);
const people = [
  ["王小明", "店長"],
  ["李小華", "店員"],
  ["陳大文", "店員"],
  ["林美麗", "店員"],
];
const v = (s) => rs.children.find((x) => x.name === "State=" + s);
const pattern = [
  [1, 1, 0, 1, 1, 0, 0],
  [0, 1, 1, 2, 1, 1, 0],
  [1, 0, 1, 1, 0, 1, 1],
  [0, 0, 1, 0, 1, 1, 1],
];
for (let i = 0; i < people.length; i++) {
  const r = al("HORIZONTAL", { name: "row-" + (i + 1) });
  const f = al("VERTICAL", {
    name: "frozen-cell",
    paddingLeft: 12,
    paddingRight: 8,
    paddingTop: 10,
    paddingBottom: 10,
    itemSpacing: 2,
  });
  f.fills = [await paint("bg/paper")];
  f.strokes = [await paint("divider")];
  f.strokeWeight = 1;
  f.strokeAlign = "INSIDE";
  f.resize(176, 64);
  f.primaryAxisSizingMode = "FIXED";
  f.counterAxisSizingMode = "FIXED";
  add(f, await txt(people[i][0], "Subtitle/2", "text/primary"));
  add(f, await txt(people[i][1], "Caption", "text/secondary"));
  add(r, f);
  for (let d = 0; d < 7; d++)
    add(r, v(["Empty", "Filled", "Selected"][pattern[i][d]]).createInstance());
  add(g, r);
}
g.description =
  DESC_PREFIX +
  "RosterGrid 人 × 日期矩陣(@repo/ui,底座規格 10.5;建立在既有 DataTable(TanStack Table + Virtual)上)。第一欄凍結(人員 + 角色),表頭 bg/default 顯示日期與星期(週日開頭);格子 = Draft/RosterCell 實例(Empty / Filled / Selected),格子內容由使用的模組決定;元件負責版面、選取(點 / 拖選)、捲動、凍結欄。";
return { cellSet: rs.id, grid: g.id };
