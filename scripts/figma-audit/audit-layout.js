// 版面稽核(FIGMA-12、FIGMA-13):每頁各項都要是 0 才算畫完(設定關掉的項目回報 null)。
// 執行:project/config.js 全文 + 本檔全文一起貼進 use_figma(見 README)。
// 一次一頁:把 PAGE_ID 換成要查的頁,所有頁平行各跑一次。畫面可以直接放在頁上或放在尺寸 Section 裡。
//   clippedText    文字或元件實例被裁切:設了截斷、固定高度放不下一行,或超出任何一層 clipsContent 的祖先(容許 1px);
//                  名稱含「可捲動」的框(例:PageTabs(可捲動))裡超出的內容是捲動內容,不算。
//   misalignedRows 同一個水平 auto layout 列裡,各欄的「欄位」(TextField / SelectField / Select / Autocomplete /
//                  OrgTreeSelect / DatePicker 實例本身,或以欄位開頭的包裝框)上緣或高度不一致(容許 1px);並排彈窗的列不算。
//   overflowNodes  auto layout 的子節點左右超出父框(例:格子區比對話框寬、表格欄寬總和超過卡片)。
//   overlapText    絕對定位(或放在非 auto layout 框裡)的元件實例,疊在同一個父層裡較早的節點上,蓋到那些節點的文字(容許 1px)。
//                  例外:名稱含「浮層」的節點(彈出選單、通知清單這類本來就蓋在頁面上的浮層)本身蓋到下層文字不算;
//                  浮層「裡面」的元件蓋到浮層內的文字照樣檢查(同「可捲動」的寫法,要用名稱明寫)。
//   overflowTextInInstance 元件實例(含主元件本身)內可見的文字,範圍超出它所在的最近一層「有填色或框線」的父框(容許 1px)。
//                  直屬父框是 auto layout 時,文字也要在它的內距範圍內(容許 1px;放不下才會被擠出內距)。
//                  例:圖例樣本小框裡的「+N」貼框底溢出、窄長條裡的人名超出長條。往上找父框時遇到名稱含「可捲動」的框就不算(捲動內容);
//                  浮層照舊(浮層本身蓋在頁面上不算,浮層裡面的文字照樣檢查)。overflowNodes / clippedText 不看實例內部,這項補上。
//   rowGapInContainer 容器(設定 layout.rowGap.container)裡上下堆疊的各列(layout.rowGap.rows)間距要一致為 gap(容許 1px);
//                  列變矮後沒重排、留下大空隙就算。只看寬度 ≥ 容器 minWidthRatio 的列,左右並排的直排窄條不比。
//   basePrimaryBindings 專案頁殘留底座 primary/* 綁定(設定 basePrimaryCollections),含元件實例內部實際生效的綁定(底座草稿頁不檢查)。
const PAGE_ID = ""; // 要稽核的頁 id(必填)
if (typeof AUDIT_CONFIG === "undefined")
  throw new Error("先貼 project/config.js 再貼本檔");
if (!PAGE_ID) throw new Error("PAGE_ID 未填");
const FIELD = AUDIT_CONFIG.layout.field;
const ROW_GAP = AUDIT_CONFIG.layout.rowGap;
const BASE_PRIMARY = AUDIT_CONFIG.basePrimaryCollections;
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
// 元件實例(含主元件本身)內的文字超出最近一層有填色或框線的父框(見檔頭)
const painted = (n) =>
  ["fills", "strokes"].some(
    (k) =>
      k in n &&
      Array.isArray(n[k]) &&
      n[k].some((p) => p.visible !== false && (p.opacity ?? 1) > 0),
  );
const inComp = (n) => {
  for (let a = n.parent; a && a.type !== "PAGE"; a = a.parent)
    if (a.type === "INSTANCE" || a.type === "COMPONENT") return true;
  return false;
};
const overflowInInst = [];
for (const s of screens) {
  if (!("findAllWithCriteria" in s)) continue;
  for (const t of s.findAllWithCriteria({ types: ["TEXT"] })) {
    if (!t.characters.trim() || !visibleChain(t) || !inComp(t)) continue;
    let a = t.parent,
      skip = false;
    for (; a && a.type !== "PAGE" && a.type !== "SECTION"; a = a.parent) {
      if (/可捲動/.test(a.name)) {
        skip = true;
        break;
      }
      if (painted(a)) break;
    }
    if (skip || !a || a.type === "PAGE" || a.type === "SECTION") continue;
    const tb = box(t),
      ab = box(a);
    // 直屬父框是 auto layout 時,文字也要在它的內距範圍內(放不下才會被擠出內距,例:固定尺寸的小框)
    const par = t.parent,
      pb = box(par);
    const padded =
      pb &&
      "layoutMode" in par &&
      par.layoutMode !== "NONE" &&
      t.layoutPositioning !== "ABSOLUTE"
        ? {
            x: pb.x + par.paddingLeft,
            y: pb.y + par.paddingTop,
            width: pb.width - par.paddingLeft - par.paddingRight,
            height: pb.height - par.paddingTop - par.paddingBottom,
          }
        : null;
    if (tb && ab && (!inside(tb, ab) || (padded && !inside(tb, padded))))
      overflowInInst.push({
        screen: top(t).name.slice(0, 30),
        id: t.id,
        text: t.characters.slice(0, 16),
        parent: a.name,
      });
  }
}
// 容器內上下堆疊的列距(見檔頭)
const rowGapBad = [];
for (const s of ROW_GAP ? screens : []) {
  if (!("findAllWithCriteria" in s)) continue;
  for (const d of s.findAllWithCriteria({ types: ["INSTANCE"] })) {
    if (!ROW_GAP.container.test(d.name) || !visibleChain(d)) continue;
    const par = d.parent;
    if (!par || !("children" in par) || par.type === "INSTANCE") continue;
    const rows = par.children.filter(
      (c) =>
        c !== d &&
        c.visible &&
        c.type === "INSTANCE" &&
        ROW_GAP.rows.test(c.name) &&
        c.y >= d.y - 1 &&
        c.y + c.height <= d.y + d.height + 1 &&
        c.x + c.width > d.x &&
        c.x < d.x + d.width &&
        c.width >= d.width * ROW_GAP.minWidthRatio, // 只看橫向撐滿的列;直排窄條不比
    );
    const ys = [...new Set(rows.map((r) => Math.round(r.y)))].sort(
      (m, n) => m - n,
    );
    if (ys.length < 2 || ys.length < rows.length / 2) continue; // 左右並排不比
    const groups = ys.map((y) => rows.filter((r) => Math.round(r.y) === y));
    const gaps = [];
    for (let i = 1; i < groups.length; i++)
      gaps.push(
        Math.round(
          groups[i][0].y -
            Math.max(...groups[i - 1].map((r) => r.y + r.height)),
        ),
      );
    if (gaps.some((g) => Math.abs(g - ROW_GAP.gap) > 1))
      rowGapBad.push({
        screen: top(d).name.slice(0, 30),
        id: d.id,
        gaps: gaps.join(","),
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
if (!page.name.startsWith(AUDIT_CONFIG.baseDraftPagePrefix)) {
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
  overflowTextInInstance: overflowInInst.length,
  rowGapInContainer: ROW_GAP ? rowGapBad.length : null,
  basePrimaryBindings,
  clippedSample: clipped.slice(0, 8),
  misalignedSample: misaligned.slice(0, 8),
  overflowSample: overflow.slice(0, 8),
  overlapSample: overlapText.slice(0, 8),
  overflowInInstanceSample: overflowInInst.slice(0, 12),
  rowGapSample: rowGapBad.slice(0, 8),
};
