// 專案頁補綁專案色(scratch-lot Screens,一次一頁)。
// 與本機外掛 `wowgo-base Brand Sync` 的「補綁專案色」同一規則(scripts/figma-local/code.js 的 analyzeScreens / applyScreens):
// 只把綁在 wowgo-base `Brand` / `Color` 的 primary/* 換成 scratch-lot Brand Library 同名變數;中性色、error / success 等語意色、
// 文字、圖片、實例連結都不動。實例內的節點以覆寫方式補綁(遠端元件連結保留)。
// 「Base Draft / 本輪底座元件」頁不要跑:那頁的草稿要搬回底座,必須維持綁 wowgo-base。
figma.skipInvisibleInstanceChildren = false; // 實例裡隱藏的子節點(例:側欄 Badge)也要補綁
const PAGE_ID = "65:14"; // 換成要補綁的頁
const DRY = false; // true = 只預覽待補綁數
const SOURCE = "wowgo-base Design System";
const TARGET = "scratch-lot Brand Library";
const ROLES = ["lighter", "light", "main", "dark", "darker", "contrast"];

const page = await figma.getNodeByIdAsync(PAGE_ID);
if (page.name.startsWith("Base Draft")) throw new Error("底座草稿頁不補綁");
await figma.setCurrentPageAsync(page);
const cols =
  await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
const map = new Map();
const targetKeys = new Set();
for (const side of ["Brand", "Color"]) {
  const s = cols.find((c) => c.libraryName === SOURCE && c.name === side);
  const t = cols.find((c) => c.libraryName === TARGET && c.name === side);
  const sv = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(
    s.key,
  );
  const tv = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(
    t.key,
  );
  for (const r of ROLES) {
    const from = sv.find((v) => v.name === "primary/" + r);
    const to = tv.find((v) => v.name === "primary/" + r);
    map.set(from.key, to.key);
    targetKeys.add(to.key);
  }
}
const vcache = new Map();
const getVar = async (id) => {
  if (!vcache.has(id))
    vcache.set(id, await figma.variables.getVariableByIdAsync(id));
  return vcache.get(id);
};
const imported = new Map();
const importVar = async (key) => {
  if (!imported.has(key))
    imported.set(key, await figma.variables.importVariableByKeyAsync(key));
  return imported.get(key);
};
let changed = 0;
let already = 0;
const issues = [];
const fonts = new Set();
for (const node of page.findAll(() => true)) {
  for (const prop of ["fills", "strokes"]) {
    if (!(prop in node)) continue;
    const paints = node[prop];
    if (paints === figma.mixed) {
      issues.push({ code: "MIXED_PAINTS", id: node.id });
      continue;
    }
    if (!Array.isArray(paints) || !paints.length) continue;
    let dirty = false;
    const next = [];
    for (const p of paints) {
      const id = p.boundVariables?.color?.id;
      const v = id ? await getVar(id) : null;
      if (v && targetKeys.has(v.key)) already++;
      if (!v || !map.has(v.key)) {
        next.push(p);
        continue;
      }
      if (DRY) {
        changed++;
        next.push(p);
        continue;
      }
      // 換綁變數會把 paint 的不透明度重設成 1,要保留原值(互動狀態的疊色已改成 state-layer 圖層不透明度,不經過這裡;這裡保護其他帶 paint 不透明度的 primary 色)
      next.push({
        ...figma.variables.setBoundVariableForPaint(
          p,
          "color",
          await importVar(map.get(v.key)),
        ),
        opacity: p.opacity ?? 1,
      });
      dirty = true;
      changed++;
    }
    if (!dirty) continue;
    if (node.type === "TEXT") {
      for (const seg of node.getStyledTextSegments(["fontName"])) {
        const k = seg.fontName.family + "|" + seg.fontName.style;
        if (!fonts.has(k)) {
          await figma.loadFontAsync(seg.fontName);
          fonts.add(k);
        }
      }
    }
    node[prop] = next;
    // 寫入後再確認一次:新綁的 paint 寫入時不透明度有時被重設成 1,用寫入後的 paint 再設回去
    const after = node[prop];
    if (
      after.some(
        (q, i) => Math.abs((q.opacity ?? 1) - (next[i].opacity ?? 1)) > 0.001,
      )
    )
      node[prop] = after.map((q, i) => ({ ...q, opacity: next[i].opacity }));
  }
}
return { page: page.name, dry: DRY, changed, already, issues };
