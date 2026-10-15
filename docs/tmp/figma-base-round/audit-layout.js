// 版面稽核(畫圖檢查清單 1~3、6):每頁 clippedText、misalignedRows、overflowNodes、basePrimaryBindings 都要是 0 才算畫完。
// 一次一頁:把 PAGE_ID 換成要查的頁,所有頁平行各跑一次。畫面可以直接放在頁上或放在尺寸 Section 裡。
//   clippedText    文字或元件實例被裁切:設了截斷、固定高度放不下一行,或超出任何一層 clipsContent 的祖先(容許 1px);
//                  名稱含「可捲動」的框(例:PageTabs(可捲動))裡超出的內容是捲動內容,不算。
//   misalignedRows 同一個水平 auto layout 列裡,各欄的「欄位」(TextField / SelectField / Select / Autocomplete /
//                  OrgTreeSelect / DatePicker 實例本身,或以欄位開頭的包裝框)上緣或高度不一致(容許 1px);並排彈窗的列不算。
//   overflowNodes  auto layout 的子節點左右超出父框(例:張數格子比對話框寬、表格欄寬總和超過卡片)。
//   overlapText    絕對定位(或放在非 auto layout 框裡)的元件實例,疊在同一個父層裡較早的節點上,蓋到那些節點的文字(容許 1px)。
//                  例外:名稱含「浮層」的節點(彈出選單、通知清單這類本來就蓋在頁面上的浮層)本身蓋到下層文字不算;
//                  浮層「裡面」的元件蓋到浮層內的文字照樣檢查(同「可捲動」的寫法,要用名稱明寫)。
//   basePrimaryBindings 專案頁殘留 wowgo-base 的 primary/* 綁定,含元件實例內部實際生效的綁定(Base Draft 頁不檢查)。
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
const inInstance = (n, root) => {
  for (let a = n.parent; a && a !== root; a = a.parent)
    if (a.type === "INSTANCE") return true;
  return false;
};
const clipAncestor = (n, b) => {
  for (
    let a = n.parent;
    a && a.type !== "PAGE" && a.type !== "SECTION";
    a = a.parent
  ) {
    if (/可捲動/.test(a.name)) return null; // 可捲動的分頁列:超出的分頁是捲動內容,不算裁切
    if ("clipsContent" in a && a.clipsContent && box(a) && !inside(b, box(a)))
      return a;
  }
  return null;
};
const clipped = [];
for (const s of screens) {
  if (!("findAllWithCriteria" in s)) continue;
  for (const t of s.findAllWithCriteria({ types: ["TEXT"] })) {
    if (!t.characters.trim() || !visibleChain(t)) continue;
    const b = box(t);
    if (!b) continue;
    let why = null;
    if (t.textTruncation === "ENDING") why = "truncation";
    else if (t.textAutoResize === "NONE" || t.textAutoResize === "TRUNCATE") {
      const lh = typeof t.fontSize === "number" ? t.fontSize * 1.2 : 12;
      if (t.height + 1 < lh) why = "fixed-height";
    }
    const by = why ? null : clipAncestor(t, b);
    if (by) why = "clipped";
    if (why)
      clipped.push({
        screen: top(t).name.slice(0, 30),
        id: t.id,
        text: t.characters.slice(0, 16),
        why,
        by: by && by.name,
      });
  }
  // 元件實例(例:按鈕)整個被外框切到
  for (const i of s.findAllWithCriteria({ types: ["INSTANCE"] })) {
    if (!visibleChain(i) || inInstance(i, s)) continue;
    const b = box(i);
    const by = b && clipAncestor(i, b);
    if (by)
      clipped.push({
        screen: top(i).name.slice(0, 30),
        id: i.id,
        text: "[instance] " + i.name,
        why: "clipped",
        by: by.name,
      });
  }
}
const overflow = [];
for (const s of screens) {
  if (!("findAllWithCriteria" in s)) continue;
  for (const f of s.findAllWithCriteria({ types: ["FRAME"] })) {
    if (f.layoutMode === "NONE" || !visibleChain(f) || inInstance(f, s))
      continue;
    const fb = box(f);
    if (!fb) continue;
    for (const ch of f.children) {
      if (!ch.visible || ch.layoutPositioning === "ABSOLUTE") continue;
      const cb = box(ch);
      if (cb && (cb.x < fb.x - 1 || cb.x + cb.width > fb.x + fb.width + 1))
        overflow.push({
          screen: top(f).name.slice(0, 30),
          id: ch.id,
          name: ch.name,
          parent: f.name,
        });
    }
  }
}
// 疊在上面的元件實例蓋到文字(例:格子角落的圖示蓋到時間)
const overlapText = [];
const hit = (a, b) =>
  a.x < b.x + b.width - 1 &&
  b.x < a.x + a.width - 1 &&
  a.y < b.y + b.height - 1 &&
  b.y < a.y + a.height - 1;
for (const s of screens) {
  if (!("findAllWithCriteria" in s)) continue;
  for (const i of s.findAllWithCriteria({ types: ["INSTANCE"] })) {
    if (!visibleChain(i) || inInstance(i, s)) continue;
    if (/浮層/.test(i.name)) continue; // 浮層本身蓋在頁面上是預期的(見檔頭)
    const par = i.parent;
    if (!par || !("layoutMode" in par)) continue;
    if (!(i.layoutPositioning === "ABSOLUTE" || par.layoutMode === "NONE"))
      continue;
    const ib = box(i);
    if (!ib) continue;
    const below = par.children.slice(0, par.children.indexOf(i));
    for (const sib of below) {
      if (!sib.visible) continue;
      const texts =
        sib.type === "TEXT"
          ? [sib]
          : "findAll" in sib
            ? sib.findAll(
                (n) => n.type === "TEXT" && n.visible && n.characters.trim(),
              )
            : [];
      const t = texts.find((x) => box(x) && hit(ib, box(x)));
      if (t) {
        overlapText.push({
          screen: top(i).name.slice(0, 30),
          id: i.id,
          name: i.name,
          text: t.characters.slice(0, 16),
        });
        break;
      }
    }
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
// 欄位本身,或以欄位開頭的包裝框;卡片(以標題開頭)不算
async function anchor(ch) {
  if (ch.type === "INSTANCE" && FIELD.test(await fieldName(ch))) return ch;
  if (!("children" in ch) || ch.type === "INSTANCE") return null;
  const first = ch.children.find((x) => x.visible);
  if (first && first.type === "INSTANCE" && FIELD.test(await fieldName(first)))
    return first;
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
  // 連元件實例內部(含隱藏的子節點)一起算:實例沒被品牌覆寫、仍綁底座 primary 的節點也是錯的
  figma.skipInvisibleInstanceChildren = false;
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
return {
  page: page.name,
  screens: screens.length,
  clippedText: clipped.length,
  misalignedRows: misaligned.length,
  overflowNodes: overflow.length,
  overlapText: overlapText.length,
  basePrimaryBindings,
  clippedSample: clipped.slice(0, 8),
  misalignedSample: misaligned.slice(0, 8),
  overflowSample: overflow.slice(0, 8),
  overlapSample: overlapText.slice(0, 8),
};
