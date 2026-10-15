// 驗收稽核(底座規格 0.3a 的 Figma 檢查)。在 scratch-lot Screens 執行,不需要 _resolve.js。
// 一次只稽核一頁(use_figma 一次只切一次頁):把 PAGE_ID 換成要查的頁,所有頁平行各跑一次再加總。
// 回收完成時 baseDraftComponents、instancesOfBaseDrafts、nodesWithDraftMarker 三項加總都應為 0。
// nonBaseBindingsInBaseDrafts 任何時候都應為 0(底座草稿只能綁 wowgo-base 的變數)。
// basePrimaryBindings(Base Draft 以外的頁)任何時候都應為 0(專案頁的主色要綁 scratch-lot Brand Library)。
// baseScreensNotFromRef、nonBaseInBaseScreens(Base Draft 頁)任何時候都應為 0:參考畫面以現有底座畫面為底、只綁底座變數。
// draftTokenBindings:綁到本機「Draft/」開頭變數集合(例 Draft/tagPalettes,Library 還沒有的過渡變數)的節點數。
//   現階段只回報、不算錯(上面兩項 nonBase* 也不把它算進去);回收到 wowgo-base 後改綁 Library 的同名集合,這一項必須是 0。
// devTextInScreens 任何時候都應為 0:畫面框內不能有設計稿編號、規格章節號、開發用說明(畫圖檢查清單 9);註解放在畫面框外。
const PAGE_ID = "41:5914";
const MARKER = "本輪草稿"; // 底座草稿 description 的固定前綴「【底座・本輪草稿,…】」
// wowgo-base Design System 的變數集合 key(Color / Radius / Primitives / Brand)
const BASE_COLLECTIONS = [
  "9d2d67ea73654a9894d5c083e28754341526fba4",
  "84c5f309f7b50688d1eca745ea4db116afb1ad5a",
  "1eea29cadf44f500544c6b840aea015c8a3b092b",
  "aa51fafef4bb2e4d3b578ccaa8bc8f1a930ed17e",
];
figma.skipInvisibleInstanceChildren = false;
const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);

const descOf = (c) => {
  if (!c) return "";
  const owner = c.parent && c.parent.type === "COMPONENT_SET" ? c.parent : c;
  return owner.description || "";
};
const comps = page.findAllWithCriteria({
  types: ["COMPONENT", "COMPONENT_SET"],
});
const baseDrafts = comps
  .filter((c) => c.type !== "COMPONENT" || c.parent.type !== "COMPONENT_SET")
  .filter((c) => (c.description || "").includes(MARKER));

const instances = page.findAllWithCriteria({ types: ["INSTANCE"] });
let instancesOfBaseDrafts = 0;
for (const i of instances) {
  const mc = await i.getMainComponentAsync();
  if (mc && !mc.remote && descOf(mc).includes(MARKER)) instancesOfBaseDrafts++;
}

// 底座草稿內的變數綁定都要來自 wowgo-base
const collectionKeyCache = {};
const draftCol = {}; // 變數 id → 是否屬於本機 Draft/ 集合
async function isDraftVar(varId) {
  if (varId in draftCol) return draftCol[varId];
  const v = await figma.variables.getVariableByIdAsync(varId);
  const col =
    v &&
    (await figma.variables.getVariableCollectionByIdAsync(
      v.variableCollectionId,
    ));
  return (draftCol[varId] =
    !!col && !col.remote && col.name.startsWith("Draft/"));
}
async function collectionKeyOf(varId) {
  if (collectionKeyCache[varId] !== undefined) return collectionKeyCache[varId];
  const v = await figma.variables.getVariableByIdAsync(varId);
  let key = null;
  if (v) {
    const col = await figma.variables.getVariableCollectionByIdAsync(
      v.variableCollectionId,
    );
    key = col ? col.key : null;
  }
  return (collectionKeyCache[varId] = key);
}
function aliasIds(bv) {
  const out = [];
  const walk = (x) => {
    if (!x) return;
    if (Array.isArray(x)) x.forEach(walk);
    else if (typeof x === "object") {
      if (x.type === "VARIABLE_ALIAS" && x.id) out.push(x.id);
      else Object.values(x).forEach(walk);
    }
  };
  walk(bv);
  return out;
}
const nonBase = [];
for (const d of baseDrafts) {
  const nodes = [d, ...d.findAll(() => true)];
  for (const n of nodes) {
    const ids = aliasIds(n.boundVariables);
    for (const p of ["fills", "strokes"]) {
      if (Array.isArray(n[p]))
        for (const paint of n[p]) ids.push(...aliasIds(paint.boundVariables));
    }
    for (const id of ids) {
      const key = await collectionKeyOf(id);
      if (!BASE_COLLECTIONS.includes(key) && !(await isDraftVar(id)))
        nonBase.push({ node: n.id, name: n.name, var: id, collection: key });
    }
  }
}

// 專案頁(Base Draft 以外)不得留下 wowgo-base 的 primary/* 綁定:要補綁 scratch-lot Brand Library(project/brand-rebind.js)
const BASE_PRIMARY_COLLECTIONS = [BASE_COLLECTIONS[0], BASE_COLLECTIONS[3]];
let basePrimaryBindings = null;
if (!page.name.startsWith("Base Draft")) {
  basePrimaryBindings = 0;
  const varCache = {};
  for (const n of page.findAll(() => true)) {
    for (const p of ["fills", "strokes"]) {
      if (!(p in n) || !Array.isArray(n[p])) continue;
      for (const paint of n[p]) {
        const id = paint.boundVariables?.color?.id;
        if (!id) continue;
        if (!(id in varCache)) {
          const v = await figma.variables.getVariableByIdAsync(id);
          varCache[id] =
            !!v &&
            v.name.startsWith("primary/") &&
            BASE_PRIMARY_COLLECTIONS.includes(await collectionKeyOf(id));
        }
        if (varCache[id]) basePrimaryBindings++;
      }
    }
  }
}

// 畫面框內的開發用文字(畫圖檢查清單 9)。頁上或尺寸 Section 內的頂層節點算畫面;名稱以「說明」開頭的註解卡與框外的註解文字不算。
const RE_CODE = /\b(ST|IN|PU|AC|RE|DE|MD|SC|RC|RW|BS)-\d{2}[a-c]?\b/;
const RE_SEC = /第 ?\d+(\.\d+)* ?(節|章)|規格/;
const RE_DEV =
  /RANGE_TOO_LARGE|show-cost|\b(store|inventory|purchasing|accounts|reports|dealers|games|schedule|system|master-data)\.[a-z][a-z-]+|swapComponent|Draft\/|PageTabs|SLOT/;
const screenNodes = page.children
  .flatMap((n) => (n.type === "SECTION" ? [...n.children] : [n]))
  .filter(
    (n) => n.type !== "TEXT" && !n.name.startsWith("說明") && "findAll" in n,
  );
const devText = [];
for (const s of screenNodes)
  for (const t of s.findAll((x) => x.type === "TEXT")) {
    const c = t.characters;
    if (RE_CODE.test(c) || RE_SEC.test(c) || RE_DEV.test(c))
      devText.push({
        screen: s.name.slice(0, 30),
        id: t.id,
        text: c.slice(0, 30),
      });
  }

// Base Draft 的參考畫面要以現有底座畫面為底(畫圖檢查清單 17):
// 寬 1440 的 BS 畫面要有框外註解寫「對應現有畫面」、頁首用 Library 的 AdminAppBar 實例(不是自畫的框),
// 畫面裡的顏色只綁底座變數(現有畫面在 scratch-lot 帶專案品牌色,複製後要 rebase)。
const baseScreensNotFromRef = [];
let nonBaseInBaseScreens = 0;
if (page.name.startsWith("Base Draft")) {
  const notes = new Set(
    page.children
      .filter((n) => n.type === "TEXT" && n.characters.includes("對應現有畫面"))
      .map((n) => n.name.replace(/ · 註解$/, "")),
  );
  for (const f of page.children.filter(
    (n) => n.type === "FRAME" && /^BS-/.test(n.name) && n.width === 1440,
  )) {
    const why = [];
    if (!notes.has(f.name)) why.push("沒有「對應現有畫面」註解");
    let bar = false;
    for (const i of f.findAll(
      (n) => n.type === "INSTANCE" && /AdminAppBar/.test(n.name),
    )) {
      const mc = await i.getMainComponentAsync();
      if (mc && mc.remote) bar = true;
    }
    if (!bar) why.push("頁首不是 Library 的 AdminAppBar");
    // 左右兩欄要填滿畫面高度(畫圖檢查清單 18;Base-ref.js 的 fillColumns)
    const main = f.findChild((n) => n.name === "main");
    const content = main && main.findChild((n) => n.name === "content");
    if (content) {
      const isPanel = (n) =>
        n.type === "FRAME" &&
        n.visible &&
        n.fills.length > 0 &&
        n.children.length > 0;
      const row = [content, ...content.findAll((n) => n.type === "FRAME")].find(
        (n) =>
          n.layoutMode === "HORIZONTAL" &&
          n.children.filter(isPanel).length >= 2,
      );
      if (row) {
        const cols = row.children.filter(isPanel);
        const bottom =
          f.absoluteBoundingBox.y + f.height - content.paddingBottom;
        if (
          cols.some(
            (c) => Math.abs(c.absoluteBoundingBox.y + c.height - bottom) > 2,
          )
        )
          why.push("左右兩欄沒有填滿畫面高度");
      }
    }
    if (why.length)
      baseScreensNotFromRef.push(f.name.slice(0, 30) + ":" + why.join("、"));
    for (const n of [f, ...f.findAll(() => true)])
      for (const p of ["fills", "strokes"]) {
        if (!(p in n) || !Array.isArray(n[p])) continue;
        for (const paint of n[p]) {
          const id = paint.boundVariables?.color?.id;
          if (
            id &&
            !BASE_COLLECTIONS.includes(await collectionKeyOf(id)) &&
            !(await isDraftVar(id))
          )
            nonBaseInBaseScreens++;
        }
      }
  }
}

// 綁到本機 Draft/ 變數集合的節點(過渡用,回收後要是 0)
let draftTokenBindings = 0;
for (const n of page.findAll(() => true)) {
  let hit = false;
  for (const p of ["fills", "strokes"]) {
    if (!(p in n) || !Array.isArray(n[p])) continue;
    for (const paint of n[p]) {
      const id = paint.boundVariables?.color?.id;
      if (id && (await isDraftVar(id))) hit = true;
    }
  }
  if (hit) draftTokenBindings++;
}

return {
  page: page.name,
  draftTokenBindings,
  baseScreensNotFromRef: baseScreensNotFromRef.length,
  baseScreensSample: baseScreensNotFromRef.slice(0, 10),
  nonBaseInBaseScreens,
  basePrimaryBindings,
  baseDraftComponents: baseDrafts.length,
  instancesOfBaseDrafts,
  nodesWithDraftMarker: comps.filter((c) =>
    (c.description || "").includes(MARKER),
  ).length,
  nonBaseBindingsInBaseDrafts: nonBase.length,
  nonBaseSample: nonBase.slice(0, 10),
  devTextInScreens: devText.length,
  devTextSample: devText.slice(0, 10),
};
