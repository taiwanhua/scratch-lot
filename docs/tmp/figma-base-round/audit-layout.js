// 版面稽核(畫圖檢查清單 1、2、6):clippedText、misalignedRows、basePrimaryBindings,三項都要是 0 才算畫完。
// 一次一頁:把 PAGE_ID 換成要查的頁,所有頁平行各跑一次。畫面可以直接放在頁上或放在尺寸 Section 裡。
//   clippedText    文字被裁切:設了截斷、固定高度放不下一行,或文字框超出任何一層 clipsContent 的祖先(容許 1px)。
//   misalignedRows 同一個水平 auto layout 列裡,各欄的「欄位」(TextField / SelectField / Select / Autocomplete /
//                  OrgTreeSelect / DatePicker 實例,自己或兩層內)上緣或高度不一致(容許 1px);並排彈窗的列(dialogs)不算。
//   basePrimaryBindings 專案頁殘留 wowgo-base 的 primary/* 綁定(Base Draft 頁不檢查)。
const PAGE_ID = "65:14";
const FIELD =
  /TextField|SelectField|^Draft\/Select$|Autocomplete|OrgTreeSelect|DatePicker/;
const BASE_PRIMARY = [
  "9d2d67ea73654a9894d5c083e28754341526fba4",
  "aa51fafef4bb2e4d3b578ccaa8bc8f1a930ed17e",
];
figma.skipInvisibleInstanceChildren = true;
const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);
const screens = page.children
  .flatMap((n) => (n.type === "SECTION" ? [...n.children] : [n]))
  .filter((n) => n.visible && n.type !== "TEXT");
const visibleChain = (n) => {
  for (let x = n; x && x.type !== "PAGE"; x = x.parent)
    if (x.visible === false) return false;
  return true;
};
const box = (n) => n.absoluteBoundingBox;
const inside = (a, b) =>
  a.x >= b.x - 1 &&
  a.y >= b.y - 1 &&
  a.x + a.width <= b.x + b.width + 1 &&
  a.y + a.height <= b.y + b.height + 1;
const top = (n) => {
  let x = n;
  while (x.parent && x.parent.type !== "PAGE" && x.parent.type !== "SECTION")
    x = x.parent;
  return x;
};
const clipped = [];
for (const s of screens) {
  if (!("findAllWithCriteria" in s)) continue;
  for (const t of s.findAllWithCriteria({ types: ["TEXT"] })) {
    if (!t.characters.trim() || !visibleChain(t)) continue;
    const b = box(t);
    if (!b) continue;
    let why = null,
      by = null;
    if (t.textTruncation === "ENDING") why = "truncation";
    else if (t.textAutoResize === "NONE" || t.textAutoResize === "TRUNCATE") {
      const lh = typeof t.fontSize === "number" ? t.fontSize * 1.2 : 12;
      if (t.height + 1 < lh) why = "fixed-height";
    }
    if (!why)
      for (
        let a = t.parent;
        a && a.type !== "PAGE" && a.type !== "SECTION";
        a = a.parent
      ) {
        if (
          "clipsContent" in a &&
          a.clipsContent &&
          box(a) &&
          !inside(b, box(a))
        ) {
          why = "clipped";
          by = a;
          break;
        }
      }
    if (why)
      clipped.push({
        screen: top(t).name,
        id: t.id,
        text: t.characters.slice(0, 16),
        why,
        by: by ? by.id + " " + by.type + " " + by.name : null,
      });
  }
}
const mcName = new Map();
async function fieldName(i) {
  if (mcName.has(i.id)) return mcName.get(i.id);
  const mc = await i.getMainComponentAsync();
  const nm = mc
    ? mc.parent && mc.parent.type === "COMPONENT_SET"
      ? mc.parent.name
      : mc.name
    : "";
  mcName.set(i.id, nm);
  return nm;
}
async function anchor(ch) {
  if (ch.type === "INSTANCE" && FIELD.test(await fieldName(ch))) return ch;
  if (!("findAllWithCriteria" in ch) || ch.type === "INSTANCE") return null;
  for (const i of ch.findAllWithCriteria({ types: ["INSTANCE"] })) {
    let d = 0;
    for (let x = i.parent; x && x !== ch; x = x.parent) d++;
    if (d <= 2 && FIELD.test(await fieldName(i))) return i;
  }
  return null;
}
const misaligned = [];
for (const s of screens) {
  if (!("findAllWithCriteria" in s)) continue;
  const rows = s
    .findAllWithCriteria({ types: ["FRAME", "COMPONENT"] })
    .filter(
      (f) =>
        f.layoutMode === "HORIZONTAL" &&
        f.name !== "dialogs" &&
        f.children.length > 1 &&
        visibleChain(f),
    );
  for (const r of rows) {
    const as = [];
    for (const ch of r.children) {
      if (!ch.visible) continue;
      const a = await anchor(ch);
      if (a && box(a)) as.push([box(a), await fieldName(a)]);
    }
    if (as.length < 2) continue;
    const ys = as.map((b) => b[0].y),
      hs = as.map((b) => b[0].height);
    if (
      Math.max(...ys) - Math.min(...ys) > 1 ||
      Math.max(...hs) - Math.min(...hs) > 1
    )
      misaligned.push({
        screen: top(r).name.slice(0, 30),
        id: r.id,
        row: r.name,
        f: as
          .map(
            (a) =>
              a[1] + ":" + Math.round(a[0].y) + "/" + Math.round(a[0].height),
          )
          .join(","),
      });
  }
}
let basePrimaryBindings = null;
if (!page.name.startsWith("Base Draft")) {
  basePrimaryBindings = 0;
  const vc = {};
  for (const n of page.findAll(() => true))
    for (const p of ["fills", "strokes"]) {
      if (!(p in n) || !Array.isArray(n[p])) continue;
      for (const paint of n[p]) {
        const id = paint.boundVariables?.color?.id;
        if (!id) continue;
        if (!(id in vc)) {
          const v = await figma.variables.getVariableByIdAsync(id);
          let key = null;
          if (v)
            key = (
              await figma.variables.getVariableCollectionByIdAsync(
                v.variableCollectionId,
              )
            )?.key;
          vc[id] =
            !!v && v.name.startsWith("primary/") && BASE_PRIMARY.includes(key);
        }
        if (vc[id]) basePrimaryBindings++;
      }
    }
}
const byBy = {};
for (const c of clipped) {
  const k = c.why + " " + (c.by ? c.by.replace(/^\S+ /, "") : "");
  byBy[k] = (byBy[k] || 0) + 1;
}
return {
  page: page.name,
  screens: screens.length,
  clippedText: clipped.length,
  byBy,
  misalignedRows: misaligned.length,
  basePrimaryBindings,
  clippedSample: clipped.slice(0, 8),
  misalignedSample: misaligned.slice(0, 12),
};
