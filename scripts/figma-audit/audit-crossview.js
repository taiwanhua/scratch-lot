// 跨畫面資料比對框架(FIGMA-16):同一份示範資料在各檢視、各尺寸與背景複本要一致。
// 底座提供框架,比對規則由專案寫在 project/config.js 的 crossView(名稱 → 規則)。
// 執行:project/config.js 全文 + 本檔全文一起貼進 use_figma(見 README),把 RULE 換成要跑的規則名稱。
// 規則欄位:
//   page        要找比對對象的頁 id
//   ref         參考畫面(或參考節點)的 id;參考對象 = 它本身符合 target 時就是它,否則是它底下第一個符合 target 的節點
//   target(n)   哪些節點是比對對象(例:名稱是某個組成框的節點);會在 page 底下全部找出
//   signature(n) 把一個比對對象轉成 { 比對欄位: 值 } 的平面物件(值是字串)
//   same(key, value, refValue, ctx)  選填:true 視為相同(例:互動狀態不算資料差異);未給時比字串相等
//   ctx = { screen: 比對對象所在的頂層畫面名稱, node: 比對對象 }
// 只比兩邊都有的欄位(較窄的尺寸顯示的欄位較少)。結果 total 必須是 0。
const RULE = ""; // project/config.js 的 crossView 規則名稱(必填)
if (typeof AUDIT_CONFIG === "undefined")
  throw new Error("先貼 project/config.js 再貼本檔");
const R = (AUDIT_CONFIG.crossView || {})[RULE];
if (!R) throw new Error(`crossView 沒有規則「${RULE}」`);
const pg = await figma.getNodeByIdAsync(R.page);
const refRoot = await figma.getNodeByIdAsync(R.ref);
const ref = R.target(refRoot) ? refRoot : refRoot.findOne(R.target);
if (!ref) throw new Error("參考畫面裡找不到比對對象");
const refSig = R.signature(ref);
const topOf = (n) => {
  let t = n;
  while (t.parent && t.parent.type !== "SECTION" && t.parent.type !== "PAGE")
    t = t.parent;
  return t;
};
const targets = pg.findAll(R.target);
let total = 0;
const res = [];
for (const g of targets) {
  if (g.id === ref.id) continue;
  const ctx = { screen: topOf(g).name, node: g };
  const sig = R.signature(g);
  const diffs = [];
  for (const [k, v] of Object.entries(sig)) {
    if (refSig[k] === undefined) continue;
    const same = R.same ? R.same(k, v, refSig[k], ctx) : v === refSig[k];
    if (!same) diffs.push(`${k}: ${v} ≠ ${refSig[k]}`);
  }
  total += diffs.length;
  if (diffs.length)
    res.push(
      `${ctx.screen.slice(0, 30)}(${g.id}):${diffs.slice(0, 3).join(" ; ")}`,
    );
}
return { rule: RULE, targets: targets.length, total, res };
