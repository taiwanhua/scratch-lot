// 58mm 測試頁(底座規格 6「測試列印」):[測試列印] 印這一張,涵蓋所有列印格式。前置:_compact.js;Print.js、Round2-base.js 已執行。
// 新零件:Draft/Receipt58Text(Style = Large / Normal / Small / Bold × Align = Left / Center / Right;TEXT Text,可換行)、
// Draft/Receipt58Barcode(一維條碼,Value)、Draft/Receipt58Cut(切紙位置)。
// 測試頁本身是用零件組成的單據圖「BS-18d 測試頁(58mm)」,放在 BS-18c 旁邊(r4-layout 依 BS-18 分列)。
await toDraftPage();
const W = 352;
const STY = {
  Large: "Heading/H6",
  Normal: "Body/2",
  Small: "Caption",
  Bold: "Subtitle/2",
};
const ALIGN = { Left: "LEFT", Center: "CENTER", Right: "RIGHT" };
// Text:12 個變體
const tv = [];
for (const s of Object.keys(STY))
  for (const a of Object.keys(ALIGN)) {
    const c = figma.createComponent();
    c.name = `Style=${s}, Align=${a}`;
    c.layoutMode = "VERTICAL";
    c.resize(W, 10);
    c.counterAxisSizingMode = "FIXED";
    c.primaryAxisSizingMode = "AUTO";
    c.fills = [];
    const t = add(c, await txt("文字", STY[s], "grey/900", "text"), "FILL");
    t.textAutoResize = "HEIGHT";
    t.textAlignHorizontal = ALIGN[a];
    tv.push(c);
  }
const TX = figma.combineAsVariants(tv, figma.currentPage);
TX.name = "Draft/Receipt58Text";
TX.layoutMode = "VERTICAL";
TX.itemSpacing = 8;
TX.paddingLeft = TX.paddingRight = TX.paddingTop = TX.paddingBottom = 16;
TX.primaryAxisSizingMode = TX.counterAxisSizingMode = "AUTO";
const kText = TX.addComponentProperty("Text", "TEXT", "文字");
for (const v of TX.children)
  v.findOne((n) => n.name === "text").componentPropertyReferences = {
    characters: kText,
  };
TX.description =
  DESC_PREFIX +
  "58mm 單據的文字列:Style = Large(大字)/ Normal / Small / Bold,Align = Left / Center / Right;太長自動換行。";

// Barcode:一維條碼(Code128 示意)+ 下方數字
const BC = figma.createComponent();
BC.name = "Draft/Receipt58Barcode";
BC.layoutMode = "VERTICAL";
BC.itemSpacing = 4;
BC.counterAxisAlignItems = "CENTER";
BC.resize(W, 10);
BC.counterAxisSizingMode = "FIXED";
BC.primaryAxisSizingMode = "AUTO";
BC.fills = [];
const bars = figma.createFrame();
bars.name = "bars";
bars.fills = [];
bars.resize(240, 48);
const pattern = [
  2, 1, 1, 3, 2, 1, 1, 2, 3, 1, 2, 2, 1, 1, 3, 1, 2, 1, 2, 3, 1, 1, 2, 1, 3, 2,
  1, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 2, 2, 1,
];
let x = 4;
for (let i = 0; i < pattern.length && x < 236; i++) {
  const w = pattern[i] * 2;
  if (i % 2 === 0) {
    const r = figma.createRectangle();
    r.resize(w, 48);
    r.fills = [await paint("grey/900")];
    bars.appendChild(r);
    r.x = x;
    r.y = 0;
  }
  x += w;
}
bars.resize(x + 4, 48); // 條碼寬度貼合線條,置中
add(BC, bars);
const bcT = add(
  BC,
  await txt("D0031202610150001", "Caption", "grey/900", "value"),
);
bcT.componentPropertyReferences = {
  characters: BC.addComponentProperty("Value", "TEXT", "D0031202610150001"),
};
BC.description =
  DESC_PREFIX +
  "58mm 一維條碼(Code128;測試頁用來確認機器支援;一般單據用 QR code)。";

// Cut:切紙位置
const CT = figma.createComponent();
CT.name = "Draft/Receipt58Cut";
CT.layoutMode = "HORIZONTAL";
CT.itemSpacing = 6;
CT.counterAxisAlignItems = "CENTER";
CT.resize(W, 10);
CT.primaryAxisSizingMode = "FIXED";
CT.counterAxisSizingMode = "AUTO";
CT.fills = [];
add(CT, await txt("✂", "Caption", "grey/900", "icon"));
const cl = figma.createRectangle();
cl.name = "cut-line";
cl.resize(10, 1);
cl.fills = [];
cl.strokes = [await paint("grey/900")];
cl.dashPattern = [2, 2];
add(CT, cl, "FILL");
add(CT, await txt("切紙", "Caption", "grey/900", "label"));
CT.description =
  DESC_PREFIX + "58mm 單據的切紙位置(印完自動切紙;測試頁確認切刀)。";

// 排在 Receipt58 零件旁
const qr = figma.currentPage.findChild((n) => n.name === "Draft/Receipt58QR");
let px = qr ? qr.x + qr.width + 80 : 0;
for (const p of [TX, BC, CT]) {
  p.x = px;
  p.y = qr ? qr.y : 0;
  px += p.width + 80;
}

// ---- BS-18d 測試頁 ----
const R = draft("Draft/Receipt58");
const page = figma.createFrame();
page.name = "BS-18d 測試頁(58mm)";
page.layoutMode = "VERTICAL";
page.itemSpacing = R.itemSpacing;
page.paddingLeft = R.paddingLeft;
page.paddingRight = R.paddingRight;
page.paddingTop = R.paddingTop;
page.paddingBottom = R.paddingBottom;
page.resize(R.width, 10);
page.counterAxisSizingMode = "FIXED";
page.primaryAxisSizingMode = "AUTO";
page.fills = R.fills;
page.effectStyleId = R.effectStyleId;
const one = (name) => {
  const c = figma.currentPage.findChild((n) => n.name === name);
  if (!c) throw new Error("找不到 " + name);
  return c;
};
const put = async (set, variant, props) => {
  const v =
    set.type === "COMPONENT_SET"
      ? set.children.find((c) => c.name === variant) || set.defaultVariant
      : set;
  const i = v.createInstance();
  add(page, i, "FILL");
  if (props) await setProps(i, props);
  return i;
};
const T = (style, align, text) =>
  put(TX, `Style=${style}, Align=${align}`, { Text: text });
const DV = one("Draft/Receipt58Divider");
await put(one("Draft/Receipt58Header"), null, {
  Title: "測試頁",
  No: "櫃台收據機 · 192.168.1.50",
  Time: "2026-10-15 10:30",
});
await put(DV);
await T("Large", "Left", "大字 ABC 123");
await T("Normal", "Left", "一般字 ABC 123");
await T("Small", "Left", "小字 ABC 123");
await T("Bold", "Left", "粗體字 ABC 123");
await put(DV);
await T("Normal", "Left", "靠左");
await T("Normal", "Center", "置中");
await T("Normal", "Right", "靠右");
await put(DV);
await put(one("Draft/Receipt58Row"), null, { Label: "左欄", Value: "右欄" });
await put(one("Draft/Receipt58TableRow"), "Kind=Head");
await put(one("Draft/Receipt58TableRow"), "Kind=Body", {
  Col1: "示範品項",
  Col2: "2",
  Col3: "400",
});
await T(
  "Normal",
  "Left",
  "長文字換行:這一行故意寫得很長,用來確認超過一行約 16 個中文字時會自動換到下一行,不會被截斷。",
);
await put(DV);
await put(BC);
await put(one("Draft/Receipt58QR"), null, { Caption: "掃描開啟印表機管理" });
await put(CT);
const ref = figma.currentPage.findChild((n) => /^BS-18c /.test(n.name));
if (ref) {
  page.x = ref.x + ref.width + 80;
  page.y = ref.y;
}
return { text: TX.id, barcode: BC.id, cut: CT.id, page: page.id };
