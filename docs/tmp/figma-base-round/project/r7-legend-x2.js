// 第二十五輪:班表上有「晚 ×2」(陳大文 11/5,一人顧兩台)的畫面,圖例在最後加一項「×2 同一筆排班顧多台」(Draft/LegendItem Kind=Symbol, Tone=Neutral);
// 圖例照「畫面有才放」:手機看不到 11/5,不加。可重跑(已有就跳過)。
figma.skipInvisibleInstanceChildren = false;
const page = await figma.getNodeByIdAsync("70:14");
await page.loadAsync();
const v = (await figma.getNodeByIdAsync("289:88348")).children.find(
  (c) => c.name === "Kind=Symbol, Tone=Neutral",
);
const t0 = v.findOne((n) => n.type === "TEXT");
await figma.loadFontAsync(t0.fontName);
for (const t of v.findAll((n) => n.type === "TEXT"))
  await figma.loadFontAsync(t.fontName);
let added = 0;
for (const g of page.findAll((n) => n.name === "RosterGrid(組成)")) {
  const has = g.findOne(
    (n) =>
      n.type === "INSTANCE" &&
      Object.values(n.componentProperties || {}).some(
        (p) => p.value === "晚 ×2",
      ),
  );
  if (!has) continue;
  const lg = g.parent.children.find((n) => n.name === "legend");
  if (!lg) continue;
  if (
    lg.children.some((c) =>
      Object.values(c.componentProperties || {}).some(
        (p) => p.value === "同一筆排班顧多台",
      ),
    )
  )
    continue;
  const i = v.createInstance();
  i.setProperties({ "Label#289:0": "同一筆排班顧多台", "Symbol#289:32": "×2" });
  lg.appendChild(i);
  added++;
}
return { added };
