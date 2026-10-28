// 圖例與色票稽核(FIGMA-13、FIGMA-14):顏色只用共用色票、圖例和畫面一致。一次一頁,把 PAGE_ID 換成要查的頁。
// 執行:project/config.js 全文 + 本檔全文一起貼進 use_figma(見 README)。
// 兩項都要是 0 才算畫完:
//   unboundColors  畫面裡 fills / strokes 有可見的 SOLID 卻沒有綁變數的節點數。
//                  排除:白色(r、g、b 都 ≥ 0.99)、paint 隱藏或透明度 0、名為 scrim 的遮罩(黑色半透明)、
//                  元件實例內部的節點(由元件負責)、「背景:」複本、尺寸 Section 外的框外文字。
//   legendMismatch 只查有圖例(名為 legend 的框)的畫面:
//                  (1) 圖例樣本(設定 legend.legendItem 的 marker / symbol)用的顏色(Square 只看填色),同畫面(不含圖例與背景複本)沒有任何節點用到;
//                  (2) 同畫面用到的「標示用」顏色(設定 legend.mark)在圖例找不到同色樣本。標示用節點只算非實例節點,
//                      以及標示用元件(設定 legend.markers)的實例內部;一般元件(按鈕、標籤、提示)本身的顏色不算。
//                  顏色以「解析後的實際色值」比對(同名 primary/lighter 在底座與品牌 Library 是不同顏色,不能只比名稱);
//                  mark 以變數名稱判斷是不是標示用顏色。
//                  例外:設定 legend.exempt 列的頁(值是理由),圖例照程式清單固定列出「可能出現」的記號,
//                  (1) 不算錯、改列在 legendExempted(回報時照列理由);(2) 照查。
const PAGE_ID = ""; // 要稽核的頁 id(必填)
if (typeof AUDIT_CONFIG === "undefined")
  throw new Error("先貼 project/config.js 再貼本檔");
if (!PAGE_ID) throw new Error("PAGE_ID 未填");
const MARK = AUDIT_CONFIG.legend.mark;
const MARKERS = AUDIT_CONFIG.legend.markers;
const EXEMPT_REASON = (AUDIT_CONFIG.legend.exempt ?? {})[PAGE_ID];
figma.skipInvisibleInstanceChildren = true;
const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);
const screens = page.children
  .flatMap((n) => (n.type === "SECTION" ? [...n.children] : [n]))
  .filter((n) => n.visible && n.type !== "TEXT" && "children" in n);
const vName = {};
async function nameOf(id) {
  if (!(id in vName)) {
    const v = await figma.variables.getVariableByIdAsync(id);
    vName[id] = v ? v.name : null;
  }
  return vName[id];
}
const mainName = new Map();
async function compName(i) {
  if (mainName.has(i.id)) return mainName.get(i.id);
  const m = await i.getMainComponentAsync();
  const n = m
    ? m.parent && m.parent.type === "COMPONENT_SET"
      ? m.parent.name
      : m.name
    : "";
  mainName.set(i.id, n);
  return n;
}
// 顏色鍵 = 解析後的實際色值(#rrggbb);names 記下這個色值對應的變數名稱(判斷 MARK 用)
const names = new Map();
const vars = {};
const hex = (c) =>
  "#" +
  [c.r, c.g, c.b]
    .map((x) =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
async function paintsOf(n, out, props = ["fills", "strokes"], pairs) {
  for (const prop of props) {
    if (!(prop in n) || !Array.isArray(n[prop])) continue;
    for (const p of n[prop]) {
      if (p.type !== "SOLID" || p.visible === false || p.opacity === 0)
        continue;
      const id = p.boundVariables?.color?.id;
      if (!id) continue;
      if (!(id in vars))
        vars[id] = await figma.variables.getVariableByIdAsync(id);
      let c = p.color;
      try {
        const rv = vars[id]?.resolveForConsumer(n).value;
        if (rv && typeof rv === "object" && "r" in rv) c = rv;
      } catch (e) {}
      const k = hex(c);
      out.add(k);
      const nm = await nameOf(id);
      if (pairs) pairs.add(k + "|" + nm);
      if (!names.has(k)) names.set(k, new Set());
      names.get(k).add(await nameOf(id));
    }
  }
}
let unbound = 0;
const unboundSample = [];
const mismatch = [];
const exempted = [];
for (const s of screens) {
  // (a) 沒綁變數的顏色
  const walk = async (n, inInstance) => {
    if (n.name && n.name.startsWith("背景:")) return;
    if (!inInstance && n !== s && n.name !== "scrim") {
      for (const prop of ["fills", "strokes"]) {
        if (!(prop in n) || !Array.isArray(n[prop])) continue;
        for (const p of n[prop]) {
          if (p.type !== "SOLID" || p.visible === false || p.opacity === 0)
            continue;
          if (p.boundVariables?.color) continue;
          const c = p.color;
          if (c.r >= 0.99 && c.g >= 0.99 && c.b >= 0.99) continue;
          unbound++;
          if (unboundSample.length < 10)
            unboundSample.push(`${s.name.slice(0, 24)}:${n.name}`);
        }
      }
    }
    if ("children" in n)
      for (const k of n.children)
        await walk(k, inInstance || n.type === "INSTANCE");
  };
  await walk(s, false);
  // (b) 圖例對照
  const legends = s.findAll(
    (n) =>
      n.type === "FRAME" &&
      n.name === "legend" &&
      !((x) => {
        for (let a = x.parent; a && a !== s; a = a.parent)
          if (a.name.startsWith("背景:")) return true;
        return false;
      })(n),
  );
  if (!legends.length) continue;
  const sample = new Map(); // 顏色 → 圖例項目
  for (const lg of legends)
    for (const li of lg.findAll((n) => n.type === "INSTANCE")) {
      // 用主元件名稱判斷是不是圖例項目,不依賴實例名稱
      if ((await compName(li)) !== AUDIT_CONFIG.legend.legendItem) continue;
      const set = new Set();
      for (const k of li.findAll(
        (n) => n.name === "marker" || n.name === "symbol",
      )) {
        // Square(底色樣本)的外框只是讓淺色看得清楚,只看填色;其他樣本(虛線、圖示、More 外框)填色與外框都算
        const props = /Kind=Square/.test(li.mainComponent?.name || "")
          ? ["fills"]
          : ["fills", "strokes"];
        await paintsOf(k, set, props);
        if ("findAll" in k)
          for (const d of k.findAll(() => true)) await paintsOf(d, set, props);
      }
      const label =
        li.componentProperties[AUDIT_CONFIG.legend.legendLabelProp]?.value ||
        li.name;
      for (const c of set)
        if (c) sample.set(c, (sample.get(c) || []).concat(label));
    }
  const used = new Set(); // 全部節點用到的顏色(含一般元件實例)
  const marked = new Set(); // 標示用節點用到的「色值|變數名稱」(同色值的 bg/default 不算標示)
  const visit = async (n, markerInst) => {
    if (n.name && n.name.startsWith("背景:")) return;
    if (n.type === "FRAME" && n.name === "legend") return;
    // 實例先判斷是不是標示用元件,一般元件(按鈕、標籤、提示)本身的顏色不算標示
    let next = markerInst;
    if (n.type === "INSTANCE" && markerInst === null)
      next = MARKERS.test(await compName(n)) ? true : false;
    const tmp = new Set();
    const pr = new Set();
    await paintsOf(n, tmp, undefined, pr);
    for (const c of tmp) used.add(c);
    if (next !== false) for (const x of pr) marked.add(x);
    if (!("children" in n)) return;
    for (const k of n.children) await visit(k, next);
  };
  for (const k of s.children) await visit(k, null);
  for (const [c, labels] of sample)
    if (!used.has(c))
      (EXEMPT_REASON ? exempted : mismatch).push(
        `${s.name.slice(0, 28)}:圖例「${labels[0]}」的 ${c} 畫面沒用到`,
      );
  for (const x of marked) {
    const [c, nm] = x.split("|");
    if (MARK.includes(nm) && !sample.has(c))
      mismatch.push(`${s.name.slice(0, 28)}:畫面用了 ${nm}(${c}),圖例沒有樣本`);
  }
}
return {
  page: page.name,
  unboundColors: unbound,
  legendMismatch: mismatch.length,
  legendExempted: exempted.length,
  exemptReason: EXEMPT_REASON || null,
  unboundSample,
  mismatchSample: mismatch.slice(0, 40),
  exemptedSample: exempted.slice(0, 10),
};
