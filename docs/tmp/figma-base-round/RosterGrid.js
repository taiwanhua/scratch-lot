// Draft/RosterCell + Draft/RosterGrid(底座規格 10.5)。前置:貼上 _resolve.js。
// Cell 屬性:State=Empty / Filled / Selected。
async function rcell(state) {
  const c = figma.createComponent();
  c.name = "State=" + state;
  c.layoutMode = "VERTICAL";
  c.itemSpacing = 4;
  c.paddingLeft = c.paddingRight = c.paddingTop = c.paddingBottom = 6;
  c.resize(128, 64);
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "FIXED";
  c.fills = [
    await paint(state === "Selected" ? "action/selected" : "bg/paper"),
  ];
  c.strokes = [await paint(state === "Selected" ? "primary/main" : "divider")];
  c.strokeWeight = state === "Selected" ? 2 : 1;
  c.strokeAlign = "INSIDE";
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
    add(
      slot,
      await txt("09:00–17:00", "Caption/SemiBold", "text/primary", "line-1"),
    );
    add(slot, await txt("櫃台 A", "Caption", "text/secondary", "line-2"));
  }
  add(c, slot, "FILL", state === "Empty" ? "FILL" : "HUG");
  return c;
}
const rs = figma.combineAsVariants(
  [await rcell("Empty"), await rcell("Filled"), await rcell("Selected")],
  figma.currentPage,
);
rs.name = "Draft/RosterCell";
rs.layoutMode = "HORIZONTAL";
rs.itemSpacing = 16;
rs.paddingLeft = rs.paddingRight = rs.paddingTop = rs.paddingBottom = 16;
rs.primaryAxisSizingMode = "AUTO";
rs.counterAxisSizingMode = "AUTO";
rs.description =
  DESC_PREFIX +
  "RosterGrid 的格子(底座規格 10.5)。State=Empty / Filled / Selected(action/selected 底 + primary 2px 框)。格子內容由使用的模組決定(內容槽);排班以 primary/lighter 卡片示意「時間 + 崗位 · 職責」。";

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
    paddingTop: 6,
    paddingBottom: 6,
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
