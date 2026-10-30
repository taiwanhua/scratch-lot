// 驗收稽核(FIGMA-13、FIGMA-17):草稿元件與標記、草稿色票綁定、畫面內開發文字、畫布重疊。
// 執行:project/config.js 全文 + 本檔全文一起貼進 use_figma(見 README)。
// 一次只稽核一頁(use_figma 一次只切一次頁):把 PAGE_ID 換成要查的頁,所有頁平行各跑一次再加總。
// 回收完成時 baseDraftComponents、instancesOfBaseDrafts、nodesWithDraftMarker 三項加總都應為 0。
// nonBaseBindingsInBaseDrafts 任何時候都應為 0(底座草稿只能綁底座變數集合,設定 baseCollections)。
// basePrimaryBindings(底座草稿頁以外的頁)任何時候都應為 0(專案頁的主色要綁專案 Brand Library)。
// baseScreensNotFromRef、nonBaseInBaseScreens(底座草稿頁)任何時候都應為 0:參考畫面以現有底座畫面為底、只綁底座變數。
// draftTokenBindings:綁到本機草稿變數集合(名稱以設定 draftCollectionPrefix 開頭,Library 還沒有的過渡變數)的節點數。
//   回收前只回報、不算錯(上面兩項 nonBase* 也不把它算進去);回收到底座後改綁 Library 的同名集合,這一項必須是 0。
// canvasOverlap 任何時候都應為 0:畫布上頁面頂層節點彼此、尺寸 Section 內的子節點彼此,範圍(外框)不能重疊。
//   例外:框外註解卡(名稱「<畫面名> · 註解」的文字)不算;隱藏的節點不算。
// devTextInScreens 任何時候都應為 0:畫面框內不能有設計稿編號、規格章節號、開發用說明(設定 audit.devText);註解放在畫面框外。
// 頁太大、一次跑不完(use_figma 逾時)時,填 SECTION_ID 逐個尺寸 Section 分段跑,回報時加總。
const PAGE_ID = ""; // 要稽核的頁 id(必填)
const SECTION_ID = ""; // 選填:只查這頁的某一個 Section;空白 = 整頁
if (typeof AUDIT_CONFIG === "undefined")
  throw new Error("先貼 project/config.js 再貼本檔");
if (!PAGE_ID) throw new Error("PAGE_ID 未填");
const MARKER = AUDIT_CONFIG.draftMarker;
const BASE_COLLECTIONS = AUDIT_CONFIG.baseCollections;
const BASE_PAGE = AUDIT_CONFIG.baseDraftPagePrefix;
const A = AUDIT_CONFIG.audit;
figma.skipInvisibleInstanceChildren = false;
const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);
const section = SECTION_ID ? await figma.getNodeByIdAsync(SECTION_ID) : null;
if (
  SECTION_ID &&
  (!section || section.type !== "SECTION" || section.parent !== page)
)
  throw new Error("SECTION_ID 不是這頁的 Section");
const root = section || page; // 稽核範圍

const descOf = (c) => {
  if (!c) return "";
  const owner = c.parent && c.parent.type === "COMPONENT_SET" ? c.parent : c;
  return owner.description || "";
};
const comps = root.findAllWithCriteria({
  types: ["COMPONENT", "COMPONENT_SET"],
});
const baseDrafts = comps
  .filter((c) => c.type !== "COMPONENT" || c.parent.type !== "COMPONENT_SET")
  .filter((c) => (c.description || "").includes(MARKER));

const instances = root.findAllWithCriteria({ types: ["INSTANCE"] });
let instancesOfBaseDrafts = 0;
for (const i of instances) {
  const mc = await i.getMainComponentAsync();
  if (mc && !mc.remote && descOf(mc).includes(MARKER)) instancesOfBaseDrafts++;
}

// 底座草稿內的變數綁定都要來自底座變數集合
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
    !!col &&
    !col.remote &&
    col.name.startsWith(AUDIT_CONFIG.draftCollectionPrefix));
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

// 專案頁(底座草稿頁以外)不得留下底座的 primary/* 綁定:要補綁專案 Brand Library
const BASE_PRIMARY_COLLECTIONS = AUDIT_CONFIG.basePrimaryCollections;
let basePrimaryBindings = null;
if (!page.name.startsWith(BASE_PAGE)) {
  basePrimaryBindings = 0;
  const varCache = {};
  for (const n of root.findAll(() => true)) {
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

// 畫面框內的開發用文字(FIGMA-17)。頁上或尺寸 Section 內的頂層節點算畫面;名稱以「說明」開頭的註解卡與框外的註解文字不算。
const screenNodes = root.children
  .flatMap((n) => (n.type === "SECTION" ? [...n.children] : [n]))
  .filter(
    (n) => n.type !== "TEXT" && !n.name.startsWith("說明") && "findAll" in n,
  );
const devText = [];
for (const s of screenNodes)
  for (const t of s.findAll((x) => x.type === "TEXT")) {
    const c = t.characters;
    if (A.devText.some((re) => re.test(c)))
      devText.push({
        screen: s.name.slice(0, 30),
        id: t.id,
        text: c.slice(0, 30),
      });
  }

// 底座草稿頁的參考畫面要以現有底座畫面為底(FIGMA-17):
// 寬度與名稱符合的畫面要有框外註解寫「對應現有畫面」、頁首用 Library 的 app bar 實例(不是自畫的框),
// 畫面裡的顏色只綁底座變數(現有畫面在專案檔帶專案品牌色,複製後要改綁回底座)。
const baseScreensNotFromRef = [];
let nonBaseInBaseScreens = 0;
if (page.name.startsWith(BASE_PAGE)) {
  const notes = new Set(
    root.children
      .filter((n) => n.type === "TEXT" && n.characters.includes(A.baseRefNote))
      .map((n) => n.name.replace(/ · 註解$/, "")),
  );
  for (const f of root.children.filter(
    (n) =>
      n.type === "FRAME" &&
      A.baseRefScreen.test(n.name) &&
      n.width === A.baseRefWidth,
  )) {
    const why = [];
    if (!notes.has(f.name)) why.push(`沒有「${A.baseRefNote}」註解`);
    let bar = false;
    for (const i of f.findAll(
      (n) => n.type === "INSTANCE" && A.baseAppBar.test(n.name),
    )) {
      const mc = await i.getMainComponentAsync();
      if (mc && mc.remote) bar = true;
    }
    if (!bar) why.push("頁首不是 Library 的 AdminAppBar");
    // 左右兩欄要填滿畫面高度(FIGMA-12)
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
for (const n of root.findAll(() => true)) {
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

// 畫布重疊:頁面頂層、每個 Section 的子節點,兩兩比外框
const canvasOverlaps = [];
{
  const hitBox = (a, b) =>
    a.x < b.x + b.width - 1 &&
    b.x < a.x + a.width - 1 &&
    a.y < b.y + b.height - 1 &&
    b.y < a.y + a.height - 1;
  const groups = [
    root.children,
    ...root.children
      .filter((n) => n.type === "SECTION")
      .map((sec) => sec.children),
  ];
  for (const g of groups) {
    const ns = g.filter(
      (n) => n.visible && !(n.type === "TEXT" && n.name.endsWith(" · 註解")),
    );
    for (let i = 0; i < ns.length; i++)
      for (let j = i + 1; j < ns.length; j++)
        if (hitBox(ns[i], ns[j]))
          canvasOverlaps.push(
            ns[i].name.slice(0, 30) + " × " + ns[j].name.slice(0, 30),
          );
  }
}

return {
  page: page.name,
  section: section ? section.name : null,
  canvasOverlap: canvasOverlaps.length,
  canvasOverlapSample: canvasOverlaps.slice(0, 10),
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
