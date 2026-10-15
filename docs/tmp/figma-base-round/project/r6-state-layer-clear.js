// 疊色改 state layer 後(StateLayer.js),把實例上「照主元件補回的填色 / 框色」覆寫清掉,讓實例直接繼承主元件。
// Figma 的覆寫旗標在值和主元件相同時也不會消失,只能 resetOverrides;所以先記下其他覆寫(元件屬性、尺寸、名稱、內距、圓角、
// 子節點的顯示 / 填色 / 內距 / 文字),reset 後照原值補回,只有實例本身的 fills / strokes 不補(之後專案頁跑 brand-rebind 補綁專案色)。
// 對象:主元件是 Hover / Selected 變體(有 state-layer)的實例。一次一頁,把 PAGE_ID 換成要清的頁(41:5914、70:14、401:805)。
figma.skipInvisibleInstanceChildren = false;
const PAGE_ID = "70:14";
const SETS = [
  "259:4770",
  "286:77949",
  "408:8012",
  "408:8040",
  "49:493",
  "497:8040",
];
const targets = new Set();
for (const id of SETS)
  for (const v of (await figma.getNodeByIdAsync(id)).children)
    if (v.findChild((c) => c.name === "state-layer")) targets.add(v.id);
const ROOT = [
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
  "topLeftRadius",
  "topRightRadius",
  "bottomLeftRadius",
  "bottomRightRadius",
  "primaryAxisSizingMode",
  "counterAxisSizingMode",
  "strokesIncludedInLayout",
];
const CHILD = [
  "visible",
  "fills",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
];
const page = await figma.getNodeByIdAsync(PAGE_ID);
await page.loadAsync();
const done = [];
for (const i of page.findAllWithCriteria({ types: ["INSTANCE"] })) {
  const mc = await i.getMainComponentAsync();
  if (!mc || !targets.has(mc.id)) continue;
  const rootOv = i.overrides.find((o) => o.id === i.id)?.overriddenFields || [];
  if (!rootOv.includes("fills") && !rootOv.includes("strokes")) continue;
  // 記下要補回的值
  const props = {};
  for (const [k, p] of Object.entries(i.componentProperties))
    if (p.type !== "INSTANCE_SWAP") props[k] = p.value;
  const snap = {
    name: i.name,
    w: i.width,
    h: i.height,
    x: i.x,
    y: i.y,
    root: Object.fromEntries(
      ROOT.filter((f) => rootOv.includes(f) || /SizingMode/.test(f)).map(
        (f) => [f, i[f]],
      ),
    ),
    kids: [],
  };
  for (const o of i.overrides) {
    if (o.id === i.id) continue;
    const n = await figma.getNodeByIdAsync(o.id);
    const k = { id: o.id, v: {} };
    for (const f of o.overriddenFields) {
      if (CHILD.includes(f))
        k.v[f] = f === "fills" ? n.fills.map((p) => ({ ...p })) : n[f];
      if (f === "characters") k.v.characters = n.characters;
    }
    if (Object.keys(k.v).length) snap.kids.push(k);
  }
  i.resetOverrides();
  i.setProperties(props);
  i.name = snap.name;
  for (const [f, v] of Object.entries(snap.root)) i[f] = v;
  if (Math.abs(i.width - snap.w) > 0.5 || Math.abs(i.height - snap.h) > 0.5)
    i.resize(snap.w, snap.h);
  for (const k of snap.kids) {
    const n = await figma.getNodeByIdAsync(k.id);
    for (const [f, v] of Object.entries(k.v)) {
      if (f === "characters") {
        if (n.characters === v) continue;
        for (const fn of n.getRangeAllFontNames(0, n.characters.length))
          await figma.loadFontAsync(fn);
        n.characters = v;
      } else n[f] = v;
    }
  }
  i.x = snap.x;
  i.y = snap.y;
  const left = (
    i.overrides.find((o) => o.id === i.id)?.overriddenFields || []
  ).filter((f) => f === "fills" || f === "strokes");
  done.push(
    `${i.id} ${mc.parent.name.replace("Draft/", "")} ${mc.name}${left.length ? " 仍有 " + left : ""}`,
  );
}
return { page: page.name, cleared: done.length, done };
