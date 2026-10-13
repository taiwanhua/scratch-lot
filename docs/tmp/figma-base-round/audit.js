// 驗收稽核(底座規格 0.3a 的 Figma 檢查)。在 scratch-lot Screens 執行,不需要 _resolve.js。
// 一次只稽核一頁(use_figma 一次只切一次頁):把 PAGE_ID 換成要查的頁,所有頁平行各跑一次再加總。
// 回收完成時 baseDraftComponents、instancesOfBaseDrafts、nodesWithDraftMarker 三項加總都應為 0。
// nonBaseBindingsInBaseDrafts 任何時候都應為 0(底座草稿只能綁 wowgo-base 的變數)。
// basePrimaryBindings(Base Draft 以外的頁)任何時候都應為 0(專案頁的主色要綁 scratch-lot Brand Library)。
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
      if (!BASE_COLLECTIONS.includes(key))
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

return {
  page: page.name,
  basePrimaryBindings,
  baseDraftComponents: baseDrafts.length,
  instancesOfBaseDrafts,
  nodesWithDraftMarker: comps.filter((c) =>
    (c.description || "").includes(MARKER),
  ).length,
  nonBaseBindingsInBaseDrafts: nonBase.length,
  nonBaseSample: nonBase.slice(0, 10),
};
