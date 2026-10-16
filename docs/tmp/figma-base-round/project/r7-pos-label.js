// 第二十五輪(修正):崗位不加簡稱。同一天同一班別多筆時,每個標籤兩行:上行崗位名稱(cap、text/secondary,不截斷),下行人數標籤。
// 把 r7-roster-data.js / r7-month.js 做出來的「A …」「B …」標籤改成「櫃台 A」/「櫃台 B」+ 標籤(班表人力需求區、月檢視電腦 / 平板);
// 改完同一列(班表)/ 同一週(月檢視)一樣高,殼跟著內容長高,Overlay 背景變高時遮罩跟著蓋滿。
figma.skipInvisibleInstanceChildren = false;
const page = await figma.getNodeByIdAsync("70:14");
await page.loadAsync();
const st = await figma.importStyleByKeyAsync(
  "cf4328c6d8830674997c8a3f7d6aa200f50eab70",
); // cap
await figma.loadFontAsync(st.fontName);
const ts = await figma.variables.getVariableByIdAsync(
  "VariableID:c11ac6a81b471a6a46f85602d056355c19fd4166/6:204",
);
const loaded = new Set();
const fonts = async (n) => {
  for (const t of n.findAll((x) => x.type === "TEXT" && x.characters.length))
    for (const f of t.getRangeAllFontNames(0, t.characters.length)) {
      const k = JSON.stringify(f);
      if (!loaded.has(k)) {
        await figma.loadFontAsync(f);
        loaded.add(k);
      }
    }
};
const labelKey = (i) =>
  Object.keys(i.componentProperties).find((k) => k.startsWith("Label#"));
const POS = { A: "櫃台 A", B: "櫃台 B" };
const cells = new Set();
let n = 0;
for (const chip of page.findAll(
  (x) =>
    x.type === "INSTANCE" &&
    x.name === "status-chip" &&
    /^[AB] /.test(x.componentProperties[labelKey(x)]?.value || ""),
)) {
  await fonts(chip);
  const v = chip.componentProperties[labelKey(chip)].value;
  const cell = chip.parent;
  const g = figma.createAutoLayout("VERTICAL", {
    name: "demand-group",
    itemSpacing: 2,
  });
  g.fills = [];
  cell.insertChild(cell.children.indexOf(chip), g);
  const t = figma.createText();
  t.fontName = st.fontName;
  await t.setTextStyleIdAsync(st.id);
  t.characters = POS[v[0]];
  t.fills = [
    figma.variables.setBoundVariableForPaint(
      { type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } },
      "color",
      ts,
    ),
  ];
  t.name = "position";
  g.appendChild(t);
  g.appendChild(chip);
  chip.setProperties({ [labelKey(chip)]: v.slice(2) });
  if (cell.layoutMode === "VERTICAL") {
    g.layoutSizingHorizontal = "FILL";
    chip.layoutSizingHorizontal =
      chip.parent.parent.name === "day" ? "FILL" : "HUG";
  }
  cells.add(cell);
  n++;
}
// 一列 / 一週一樣高
const need = (d) =>
  d.paddingTop +
  d.paddingBottom +
  d.children.reduce((s, c) => s + c.height, 0) +
  d.itemSpacing * Math.max(0, d.children.length - 1);
const rows = new Set([...cells].map((c) => c.parent));
for (const r of rows) {
  const kids = r.children.filter((c) => c.layoutPositioning !== "ABSOLUTE");
  const h = Math.max(...kids.map((c) => Math.max(c.height, need(c))));
  for (const c of kids) c.resize(c.width, h);
}
// 殼與 Overlay
const H = { 1440: 900, 1024: 768, 390: 844 };
const shells = new Set();
for (const c of cells) {
  let s = c.parent;
  while (s && !(s.children && s.children.some((k) => k.name === "main")))
    s = s.parent;
  if (s) shells.add(s);
}
for (const s of shells) {
  const was = s.locked;
  s.locked = false;
  const m = s.children.find((k) => k.name === "main");
  const c = m.children.find((k) => k.name === "content");
  c.layoutSizingVertical = "HUG";
  m.layoutSizingVertical = "HUG";
  s.resize(s.width, Math.max(H[Math.round(s.width)] || 0, m.height));
  m.layoutSizingVertical = "FILL";
  c.layoutSizingVertical = "FILL";
  s.locked = was;
  const o = s.parent;
  if (s.name.startsWith("背景:") && o) {
    if (s.height > o.height) o.resize(o.width, s.height);
    for (const k of o.children)
      if (/bottom-sheet|底部面板/.test(k.name)) k.y = o.height - k.height;
      else if (
        k.name === "scrim" ||
        k.name.startsWith("背景:") ||
        /^(full-dialog|drawer)|全螢幕|抽屜/.test(k.name)
      ) {
        k.y = 0;
        k.resize(k.width, o.height);
      }
  }
}
return { labels: n, rows: rows.size, shells: shells.size };
