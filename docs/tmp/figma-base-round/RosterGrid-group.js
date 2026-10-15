// Draft/RosterGrid 頂部固定群組(底座規格 10.5)。前置:貼上 _resolve.js、先跑 TimelineMore-StatusChip.js;在 Base Draft 頁(41:5914)執行。
// 取代 Round2-base.js 的表頭彙總列(BOOLEAN Summary):Draft/RosterGrid 改成元件集合,變體 Group=None / Expanded / Collapsed。
// - Expanded:日期表頭下方、人員列上方的群組(群組標題列「▾ 標題」+ 群組列,每格一個狀態標籤)。
// - Collapsed:群組收合成一列彙總(「▸ 標題」+ 每天一格,主行 + 副行)。
// 群組內容、列數、顏色、收合預設值由使用的模組決定;示範用班表的「人力需求」(滿 = 灰底 + divider 細框、缺 = warning、缺負責 = error)。
const g = figma.currentPage.findOne(
  (n) => n.type === "COMPONENT" && n.name === "Draft/RosterGrid",
);
const DAYS = 7;
const FROZEN_W = 176;
const DAY_W = 128;
// 舊的表頭彙總列與 Summary 屬性拿掉(收合後的彙總列取代它)
{
  const sr = g.children.find((n) => n.name === "summary-row");
  if (sr) sr.remove();
  const k = Object.keys(g.componentPropertyDefinitions).find((x) =>
    x.startsWith("Summary#"),
  );
  if (k) g.deleteComponentProperty(k);
}
async function cell(w, name, bg = "bg/default") {
  const c = al("VERTICAL", {
    name,
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 6,
    paddingBottom: 6,
    itemSpacing: 0,
  });
  c.fills = [await paint(bg)];
  c.strokes = [await paint("divider")];
  c.strokeWeight = 1;
  c.strokeAlign = "INSIDE";
  c.resize(w, 36);
  c.primaryAxisSizingMode = "AUTO";
  c.counterAxisSizingMode = "FIXED";
  return c;
}
// 狀態標籤:full 灰底 + divider 細框(白底上看得見)、warn、short
// 狀態標籤:底座 Draft/StatusChip(TimelineMore-StatusChip.js 先建好;full = Neutral,grey/100 + divider 細框)
async function chip(lines, tone) {
  const set = figma.currentPage.findOne(
    (n) => n.type === "COMPONENT_SET" && n.name === "Draft/StatusChip",
  );
  const t = { full: "Neutral", warn: "Warning", short: "Error" }[tone];
  const c = set.children
    .find((v) => v.name === `Tone=${t}, State=Default`)
    .createInstance();
  const k = (p) =>
    Object.keys(c.componentProperties).find((x) => x.startsWith(p + "#"));
  c.setProperties({
    [k("Label")]: lines[0],
    [k("Sub")]: lines[1] || " ",
    [k("HasSub")]: !!lines[1],
  });
  c.name = "status-chip";
  return c;
}
async function groupRow(name, label, cells) {
  const r = al("HORIZONTAL", { name });
  add(
    r,
    await (async () => {
      const f = await cell(FROZEN_W, "frozen-group");
      add(f, await txt(label, "Caption/SemiBold", "text/secondary"));
      return f;
    })(),
    null,
    "FILL",
  );
  for (let d = 0; d < DAYS; d++) {
    const c = await cell(DAY_W, "group-cell(內容由使用處放入)");
    if (cells && cells[d]) add(c, await chip(...cells[d]));
    add(r, c, null, "FILL");
  }
  return r;
}
const hr = g.children.find((n) => n.name === "header-row");
const exp = g.clone();
const col = g.clone();
g.name = "Group=None";
exp.name = "Group=Expanded";
col.name = "Group=Collapsed";
{
  let i = exp.children.indexOf(exp.children.find((n) => n.name === hr.name));
  const F = [["負1/1 協1/1"], "full"];
  const W = [["負1/1 協0/1"], "warn"];
  const S = [["負0/1 協1/1"], "short"];
  const rows = [
    ["group-header", "▾ 人力需求", null],
    ["group-row 早班", "早班", [F, F, F, W, F, F, F]],
    ["group-row 晚班", "晚班", [F, W, F, F, S, F, F]],
  ];
  for (const [n, l, c] of rows) exp.insertChild(++i, await groupRow(n, l, c));
}
{
  const i = col.children.indexOf(col.children.find((n) => n.name === hr.name));
  const F = [["需 4 · 已排 4"], "full"];
  const W = [["需 4 · 已排 3", "缺 1 · 可排 2"], "warn"];
  const S = [["需 4 · 已排 3", "缺 1 · 可排 0"], "short"];
  col.insertChild(
    i + 1,
    await groupRow("group-summary", "▸ 人力需求", [F, W, F, W, S, F, F]),
  );
}
// 停用欄(例:店休)整欄同一底色 grey/200:日期表頭、群組列 / 彙總列、人員列都用同一個來源(欄位 disabled 狀態)
for (const v of [g, exp, col]) {
  const hrow = v.children.find((r) => r.name === "header-row");
  const off = hrow.children.find((c) =>
    c.findOne((t) => t.type === "TEXT" && t.characters === "10/13"),
  );
  const sub = off.findAll((t) => t.type === "TEXT")[1];
  if (sub) sub.characters = "二 · 店休";
  off.fills = [await paint("grey/200")];
  for (const r of v.children.filter((r) => r !== hrow)) {
    const c = r.children.find((x) => Math.abs(x.x - off.x) < 2);
    if (!c) continue;
    if (c.type === "INSTANCE") {
      const wh = [c.width, c.height];
      c.setProperties({ State: "Empty" });
      c.resize(...wh);
    } else
      for (const k of [...c.children])
        if (/^status-chip/.test(k.name)) k.remove();
    c.fills = [await paint("grey/200")];
  }
}
const set = figma.combineAsVariants([g, exp, col], g.parent);
set.name = "Draft/RosterGrid";
set.layoutMode = "VERTICAL";
set.itemSpacing = 24;
set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 16;
set.primaryAxisSizingMode = "AUTO";
set.counterAxisSizingMode = "AUTO";
set.description =
  g.description.replace(/ 表頭彙總列[\s\S]*$/, "") +
  " 頂部固定群組(Group,選用):Expanded = 日期表頭下方、人員列上方一組列(群組標題「▾ 標題」+ 群組列,每格一個狀態標籤),和表頭、左右固定欄一起固定,不隨人員列捲動;Collapsed = 收合成一列彙總(「▸ 標題」+ 每天一格,主行 + 副行);None = 沒有群組。群組內容、列數、標籤顏色、收合預設值與收合狀態保存由使用的模組決定(示範:班表人力需求,滿 = grey/100 + divider 細框、缺 = warning、缺負責 = error)。";
for (const v of set.children) v.description = "";
return { set: set.id, variants: set.children.map((v) => v.name + " " + v.id) };
