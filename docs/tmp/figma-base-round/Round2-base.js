// 第二輪底座草稿修改(Base Draft 頁 41:5914)。前置:_compact.js。
// 1. Draft/RosterGrid 加表頭彙總列(BOOLEAN Summary)
// 2. 58mm 版面零件:Draft/Receipt58Header / TableRow / Range / Total / Divider / QR;Draft/Receipt58 改成用零件組成的示範
// (Section 的 slot 見 Section.js;Stepper 見 Stepper.js)
await figma.setCurrentPageAsync(await figma.getNodeByIdAsync("41:5914"));
const out = {};

// ---- 1. RosterGrid 表頭彙總列 ----
{
  const g = await figma.getNodeByIdAsync("49:494");
  const hr = g.findChild((n) => n.name === "header-row");
  const sr = al("HORIZONTAL", { name: "summary-row" });
  const cell = async (t, w, tone, frozen) => {
    const c = al("VERTICAL", {
      name: frozen ? "frozen-summary" : "summary-cell(內容由使用處放入)",
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 4,
      paddingBottom: 4,
      counterAxisAlignItems: frozen ? "MIN" : "CENTER",
      primaryAxisAlignItems: "CENTER",
    });
    c.fills = [await paint("bg/default")];
    c.strokes = [await paint("divider")];
    c.strokeWeight = 1;
    c.strokeAlign = "INSIDE";
    c.resize(w, 28);
    c.primaryAxisSizingMode = "FIXED";
    c.counterAxisSizingMode = "FIXED";
    add(c, await txt(t, frozen ? "Caption/SemiBold" : "Caption", tone));
    return c;
  };
  add(sr, await cell("需求 / 可排", 176, "text/secondary", true));
  const data = [
    ["需 2 · 可排 2", "text/secondary"],
    ["需 3 · 可排 3", "text/secondary"],
    ["需 3 · 可排 2", "warning/main"],
    ["需 3 · 可排 3", "text/secondary"],
    ["需 3 · 可排 1", "error/main"],
    ["需 4 · 可排 4", "text/secondary"],
    ["需 4 · 可排 3", "warning/main"],
  ];
  for (const [t, c] of data) add(sr, await cell(t, 128, c));
  g.insertChild(g.children.indexOf(hr) + 1, sr);
  const p = g.addComponentProperty("Summary", "BOOLEAN", true);
  sr.componentPropertyReferences = { visible: p };
  g.description +=
    " 表頭彙總列(BOOLEAN Summary,選用):日期表頭下方一列,每天一格,內容由使用的模組決定(例「需 3 · 可排 2」,不足時 warning / error 色)。";
  out.roster = { grid: g.id, summaryRow: sr.id };
}

// ---- 2. 58mm 版面零件 ----
const W = 352;
const parts = [];
function base(name) {
  const c = figma.createComponent();
  c.name = name;
  c.fills = [];
  parts.push(c);
  return c;
}
// Header
const H = base("Draft/Receipt58Header");
H.layoutMode = "VERTICAL";
H.itemSpacing = 4;
H.counterAxisAlignItems = "CENTER";
H.resize(W, 10);
H.counterAxisSizingMode = "FIXED";
H.primaryAxisSizingMode = "AUTO";
const hOrg = add(H, await txt("好運商行", "Subtitle/1", "grey/900", "org"));
const hTitle = add(H, await txt("收據", "Subtitle/2", "grey/900", "title"));
const hRp = al("HORIZONTAL", {
  name: "reprint",
  paddingLeft: 8,
  paddingRight: 8,
  paddingTop: 2,
  paddingBottom: 2,
});
hRp.strokes = [await paint("grey/900")];
hRp.strokeWeight = 1;
const hRpT = add(
  hRp,
  await txt("補印(第 2 次)", "Caption/SemiBold", "grey/900", "reprint-text"),
);
add(H, hRp);
const hMeta = add(
  H,
  al("HORIZONTAL", { name: "meta", itemSpacing: 8 }),
  "FILL",
);
const hNo = add(hMeta, await txt("單號 C-0031", "Body/2", "grey/900", "no"));
add(hMeta, al("HORIZONTAL", { name: "spacer" }), "FILL");
const hTime = add(
  hMeta,
  await txt("2026-10-13 15:02", "Body/2", "grey/900", "time"),
);
for (const [n, d, node] of [
  ["Org", "好運商行", hOrg],
  ["Title", "收據", hTitle],
  ["No", "單號 C-0031", hNo],
  ["Time", "2026-10-13 15:02", hTime],
  ["ReprintText", "補印(第 2 次)", hRpT],
])
  node.componentPropertyReferences = {
    characters: H.addComponentProperty(n, "TEXT", d),
  };
hRp.componentPropertyReferences = {
  visible: H.addComponentProperty("Reprint", "BOOLEAN", false),
};
H.description =
  DESC_PREFIX +
  "58mm 單據表頭(底座規格 B8 版面零件):Org(最上層組織名稱,不印平台名稱)、Title(單據名稱)、No(單號)、Time(時間)、Reprint(BOOLEAN)+ ReprintText(補印與第幾次)。";

// TableRow:Kind=Head / Body,最多 3 欄
async function trow(kind) {
  const c = figma.createComponent();
  c.name = "Kind=" + kind;
  c.layoutMode = "HORIZONTAL";
  c.itemSpacing = 8;
  c.resize(W, 10);
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "AUTO";
  c.fills = [];
  const st = kind === "Head" ? "Caption/SemiBold" : "Body/2";
  const a = add(c, await txt("品項", st, "grey/900", "col1"), "FILL");
  const b = await txt("數量", st, "grey/900", "col2");
  b.textAutoResize = "HEIGHT";
  b.resize(56, b.height);
  b.textAlignHorizontal = "RIGHT";
  add(c, b);
  const d = await txt("金額", st, "grey/900", "col3");
  d.textAutoResize = "HEIGHT";
  d.resize(80, d.height);
  d.textAlignHorizontal = "RIGHT";
  add(c, d);
  return c;
}
const TR = figma.combineAsVariants(
  [await trow("Head"), await trow("Body")],
  figma.currentPage,
);
TR.name = "Draft/Receipt58TableRow";
TR.layoutMode = "VERTICAL";
TR.itemSpacing = 8;
TR.paddingLeft = TR.paddingRight = TR.paddingTop = TR.paddingBottom = 16;
TR.primaryAxisSizingMode = "AUTO";
TR.counterAxisSizingMode = "AUTO";
for (const [n, d, k] of [
  ["Col1", "品項", "col1"],
  ["Col2", "數量", "col2"],
  ["Col3", "金額", "col3"],
]) {
  const p = TR.addComponentProperty(n, "TEXT", d);
  for (const v of TR.children)
    v.findOne((x) => x.name === k).componentPropertyReferences = {
      characters: p,
    };
}
TR.description =
  DESC_PREFIX +
  "58mm 單據表格列(最多 3 欄):Kind=Head(粗體表頭)/ Body;Col1 靠左填滿,Col2(56)/ Col3(80)靠右。";
parts.push(TR);

// Range:號碼區段
const RG = base("Draft/Receipt58Range");
RG.layoutMode = "VERTICAL";
RG.resize(W, 10);
RG.counterAxisSizingMode = "FIXED";
RG.primaryAxisSizingMode = "AUTO";
const rgT = add(
  RG,
  await txt("序號:#012~016、#020(6 筆)", "Body/2", "grey/900", "text"),
  "FILL",
);
rgT.textAutoResize = "HEIGHT";
rgT.componentPropertyReferences = {
  characters: RG.addComponentProperty(
    "Text",
    "TEXT",
    "序號:#012~016、#020(6 筆)",
  ),
};
RG.description =
  DESC_PREFIX +
  "58mm 單據的號碼區段(連號以 ~ 表示,不連號以、分隔,括號內為筆數);可換行。";

// Total:合計列
const TT = base("Draft/Receipt58Total");
TT.layoutMode = "HORIZONTAL";
TT.itemSpacing = 8;
TT.resize(W, 10);
TT.primaryAxisSizingMode = "FIXED";
TT.counterAxisSizingMode = "AUTO";
const ttL = add(TT, await txt("合計", "Subtitle/1", "grey/900", "label"));
add(TT, al("HORIZONTAL", { name: "spacer" }), "FILL");
const ttV = add(TT, await txt("3,400", "Subtitle/1", "grey/900", "value"));
ttL.componentPropertyReferences = {
  characters: TT.addComponentProperty("Label", "TEXT", "合計"),
};
ttV.componentPropertyReferences = {
  characters: TT.addComponentProperty("Value", "TEXT", "3,400"),
};
TT.description = DESC_PREFIX + "58mm 單據的合計列(粗體):Label、Value。";

// Divider
const DV = base("Draft/Receipt58Divider");
DV.layoutMode = "VERTICAL";
DV.resize(W, 1);
DV.counterAxisSizingMode = "FIXED";
DV.primaryAxisSizingMode = "AUTO";
const dl = figma.createRectangle();
dl.name = "dash";
dl.resize(W, 1);
dl.fills = [];
dl.strokes = [await paint("grey/900")];
dl.dashPattern = [4, 3];
add(DV, dl, "FILL");
DV.description = DESC_PREFIX + "58mm 單據的區段分隔(虛線)。";

// QR
const QR = base("Draft/Receipt58QR");
QR.layoutMode = "VERTICAL";
QR.itemSpacing = 4;
QR.counterAxisAlignItems = "CENTER";
QR.resize(W, 10);
QR.counterAxisSizingMode = "FIXED";
QR.primaryAxisSizingMode = "AUTO";
const q = figma.createFrame();
q.name = "qr(單據在後台的連結)";
q.resize(96, 96);
q.fills = [];
q.strokes = [await paint("grey/900")];
q.strokeWeight = 2;
const qt = await txt("QR", "Caption/SemiBold", "grey/900");
q.appendChild(qt);
qt.x = 38;
qt.y = 40;
add(QR, q);
const qc = add(QR, await txt("掃描開啟單據", "Caption", "grey/900", "caption"));
qc.componentPropertyReferences = {
  characters: QR.addComponentProperty("Caption", "TEXT", "掃描開啟單據"),
};
QR.description =
  DESC_PREFIX +
  "58mm 單據底部 QR code:內容 = 這張單據在後台的連結(掃了直接打開);不用一維條碼。";

// 排列新零件
const others = figma.currentPage.children.filter((n) => !parts.includes(n));
const maxY = others.reduce((m, n) => Math.max(m, n.y + n.height), 0);
const minX = others.reduce((m, n) => Math.min(m, n.x), 1e9);
let x = minX;
for (const p of parts) {
  p.x = x;
  p.y = maxY + 160;
  x += p.width + 80;
}

// ---- Receipt58 改成用零件組成 ----
const R = await figma.getNodeByIdAsync("51:633");
for (const k of Object.keys(R.componentPropertyDefinitions))
  R.deleteComponentProperty(k);
for (const ch of [...R.children]) ch.remove();
const row = await figma.getNodeByIdAsync("51:626");
const sign = await figma.getNodeByIdAsync("51:630");
const v = (set, kind) => set.children.find((c) => c.name === "Kind=" + kind);
const put = async (comp, props) => {
  const i = comp.createInstance();
  add(R, i, "FILL");
  if (props) await setProps(i, props);
  return i;
};
await put(H, { Reprint: true });
await put(DV);
for (const [l, val] of [
  ["分店", "中山店"],
  ["櫃台", "1 號櫃台"],
])
  await put(row, { Label: l, Value: val });
await put(DV);
await put(v(TR, "Head"));
for (const [a, b, c] of [
  ["A 商品", "12", "2,400"],
  ["B 商品", "5", "1,000"],
])
  await put(v(TR, "Body"), { Col1: a, Col2: b, Col3: c });
await put(RG);
await put(TT, { Label: "合計", Value: "3,400" });
await put(DV);
await put(QR);
for (const r of ["經手人簽名", "收件人簽名"]) await put(sign, { Role: r });
R.description =
  DESC_PREFIX +
  "58mm 單據**示範**(底座規格 B8):用版面零件組成,不是固定版面。零件:Draft/Receipt58Header、Draft/Receipt58Row(標籤:值)、Draft/Receipt58TableRow(最多 3 欄)、Draft/Receipt58Range(號碼區段)、Draft/Receipt58Total(合計)、Draft/Receipt58Divider、Draft/Receipt58QR(後台連結)、Draft/Receipt58Signature。寬 384px = 384 點;顏色只有 grey/900 與 common/white。";
out.receipt = { receipt: R.id, parts: parts.map((p) => [p.name, p.id]) };
await R.screenshot();
return out;
