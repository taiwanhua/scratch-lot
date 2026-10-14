// Draft/PrintButton、Draft/Receipt58Row、Draft/Receipt58Signature、Draft/Receipt58(底座規格 B8)。
// 前置:貼上 _resolve.js;目標頁已有 Draft/ActionIcon+。
const icons = draft("Draft/ActionIcon+");
const glyph = (k) => icons.children.find((c) => c.name === "key=" + k);
async function coloredIcon(k, col, size = 20) {
  const i = glyph(k).createInstance();
  i.resize(size, size);
  for (const x of i.findAll((n) => n.name === "glyph"))
    x.fills = [await paint(col)];
  return i;
}

// ---- PrintButton:State=Default / Sending / Printed / Failed / Reprint / Disabled ----
async function pb(state) {
  const c = figma.createComponent();
  c.name = "State=" + state;
  c.layoutMode = "HORIZONTAL";
  c.itemSpacing = 8;
  c.counterAxisAlignItems = "CENTER";
  c.primaryAxisSizingMode = "AUTO";
  c.counterAxisSizingMode = "AUTO";
  c.fills = [];
  c.clipsContent = false;
  const btnWrap = al("VERTICAL", {
    name: "button-wrap",
    itemSpacing: 4,
    counterAxisAlignItems: "CENTER",
  });
  if (state === "Disabled") {
    const tip = await inst("Draft/Tooltip", { Placement: "Top" });
    for (const t of tip.findAll((n) => n.type === "TEXT")) {
      await figma.loadFontAsync(t.fontName);
      t.characters = "本店未設定印表機";
    }
    add(btnWrap, tip);
  }
  const disabled = state === "Disabled" || state === "Sending";
  add(
    btnWrap,
    await inst(
      "Button",
      {
        Variant: "Outlined",
        Size: "Small",
        State: disabled ? "Disabled" : "Default",
        Color: "Primary",
      },
      { Label: state === "Reprint" ? "補印" : "列印" },
    ),
  );
  add(c, btnWrap);
  const status = al("HORIZONTAL", {
    name: "status",
    itemSpacing: 4,
    counterAxisAlignItems: "CENTER",
  });
  if (state === "Sending")
    add(status, await txt("已送到印表機…", "Caption", "text/secondary"));
  if (state === "Printed") {
    add(status, await coloredIcon("check-circle", "success/main"));
    add(status, await txt("已印出", "Caption", "text/secondary"));
  }
  if (state === "Failed") {
    add(status, await coloredIcon("error-outline", "error/main"));
    add(status, await txt("失敗:缺紙", "Caption", "text/primary", "reason"));
  }
  if (state === "Reprint")
    add(status, await txt("已印 1 次", "Caption", "text/secondary"));
  if (status.children.length) add(c, status);
  else status.remove();
  return c;
}
const variants = [];
for (const s of [
  "Default",
  "Sending",
  "Printed",
  "Failed",
  "Reprint",
  "Disabled",
])
  variants.push(await pb(s));
const pset = figma.combineAsVariants(variants, figma.currentPage);
pset.name = "Draft/PrintButton";
pset.layoutMode = "HORIZONTAL";
pset.itemSpacing = 32;
pset.counterAxisAlignItems = "MAX";
pset.paddingLeft =
  pset.paddingRight =
  pset.paddingTop =
  pset.paddingBottom =
    24;
pset.primaryAxisSizingMode = "AUTO";
pset.counterAxisSizingMode = "AUTO";
pset.description =
  DESC_PREFIX +
  "列印按鈕(底座規格 B8「列印按鈕元件」)。Button(Outlined / Small)+ 狀態文字:Default「列印」;Sending 按鈕停用 +「已送到印表機…」;Printed check-circle(success/main)+「已印出」;Failed error-outline(error/main)+「失敗:<原因>」(缺紙 / 代理程式離線);Reprint 已印過改「補印」+「已印 n 次」,補印單據標示「補印」與第幾次;Disabled 分店沒有登記印表機時灰色 + Tooltip「本店未設定印表機」。沒有 api.printing.print 權限時整顆不顯示。選印表機:預設專案提供的預設 → 分店預設。結果由即時通道 user:<id> 的 print-result 信號更新。";

// ---- Receipt58Row ----
const rr = figma.createComponent();
rr.name = "Draft/Receipt58Row";
rr.layoutMode = "HORIZONTAL";
rr.itemSpacing = 8;
rr.resize(352, 10);
rr.primaryAxisSizingMode = "FIXED";
rr.counterAxisSizingMode = "AUTO";
rr.fills = [];
const rl = add(rr, await txt("櫃台", "Body/2", "grey/900", "label"));
const rsp = add(rr, al("HORIZONTAL", { name: "spacer" }), "FILL");
rsp.resize(rsp.width, 1);
const rv = add(rr, await txt("1 號櫃台", "Body/2", "grey/900", "value"));
rl.componentPropertyReferences = {
  characters: rr.addComponentProperty("Label", "TEXT", "櫃台"),
};
rv.componentPropertyReferences = {
  characters: rr.addComponentProperty("Value", "TEXT", "1 號櫃台"),
};
rr.description =
  DESC_PREFIX +
  "58mm 單據的「標籤:值」列(底座規格 B8「版面零件」)。寬 352(384 點扣左右各 16 邊界);字一律 grey/900(熱感紙只有黑);屬性 Label / Value。";

// ---- Receipt58Signature ----
const sg = figma.createComponent();
sg.name = "Draft/Receipt58Signature";
sg.layoutMode = "VERTICAL";
sg.itemSpacing = 28;
sg.resize(352, 10);
sg.primaryAxisSizingMode = "AUTO";
sg.counterAxisSizingMode = "FIXED";
sg.fills = [];
const sl = add(sg, await txt("經手人簽名", "Body/2", "grey/900", "role"));
const line = figma.createRectangle();
line.name = "sign-line";
line.resize(352, 1);
line.fills = [await paint("grey/900")];
add(sg, line, "FILL");
sl.componentPropertyReferences = {
  characters: sg.addComponentProperty("Role", "TEXT", "經手人簽名"),
};
sg.description =
  DESC_PREFIX +
  "58mm 單據簽名欄(底座規格 B8)。屬性 Role(例:經手人簽名 / 收件人簽名 / 主管簽名)。";

// ---- Receipt58(示範組合)----
const R = figma.createComponent();
R.name = "Draft/Receipt58";
R.layoutMode = "VERTICAL";
R.itemSpacing = 6;
R.paddingLeft = R.paddingRight = 16;
R.paddingTop = R.paddingBottom = 20;
R.resize(384, 10);
R.primaryAxisSizingMode = "AUTO";
R.counterAxisSizingMode = "FIXED";
R.counterAxisAlignItems = "CENTER";
R.fills = [await paint("common/white")];
R.effectStyleId = (await style("Shadow/Card")).id;
R.clipsContent = false;
const org = add(R, await txt("示範商店", "Subtitle/1", "grey/900", "org"));
const title = add(R, await txt("收據", "Subtitle/2", "grey/900", "title"));
const rp = al("HORIZONTAL", {
  name: "reprint",
  paddingLeft: 8,
  paddingRight: 8,
  paddingTop: 2,
  paddingBottom: 2,
});
rp.strokes = [await paint("grey/900")];
rp.strokeWeight = 1;
add(rp, await txt("補印(第 2 次)", "Caption/SemiBold", "grey/900"));
add(R, rp);
async function dash() {
  const d = figma.createRectangle();
  d.name = "dash";
  d.resize(352, 1);
  d.fills = [];
  d.strokes = [await paint("grey/900")];
  d.dashPattern = [4, 3];
  add(R, d, "FILL");
}
async function rows(list) {
  for (const [l, v] of list) {
    const i = rr.createInstance();
    await setProps(i, { Label: l, Value: v });
    add(R, i, "FILL");
  }
}
await dash();
await rows([
  ["分店", "示範分店 A"],
  ["櫃台", "1 號櫃台"],
  ["時間", "2026-10-13 15:02"],
  ["單號", "C-0031"],
]);
await dash();
const tbl = al("VERTICAL", { name: "table(最多 3 欄)", itemSpacing: 2 });
for (const [a, b, c2, bold] of [
  ["品項", "數量", "金額", true],
  ["A 商品", "12", "2,400", false],
  ["B 商品", "5", "1,000", false],
]) {
  const st = bold ? "Caption/SemiBold" : "Body/2";
  const r = al("HORIZONTAL", { name: "tr", itemSpacing: 8 });
  add(r, await txt(a, st, "grey/900"), "FILL");
  const x2 = await txt(b, st, "grey/900");
  x2.textAlignHorizontal = "RIGHT";
  x2.resize(56, x2.height);
  add(r, x2);
  const x3 = await txt(c2, st, "grey/900");
  x3.textAlignHorizontal = "RIGHT";
  x3.resize(80, x3.height);
  add(r, x3);
  add(tbl, r, "FILL");
}
add(R, tbl, "FILL");
const rng = add(
  R,
  await txt("序號:#012~016、#020(6 筆)", "Body/2", "grey/900", "ranges"),
  "FILL",
);
rng.textAutoResize = "HEIGHT";
await dash();
await rows([
  ["應有現金", "12,350"],
  ["實點", "12,300"],
  ["差額", "−50(找錯零錢)"],
]);
await dash();
const qr = figma.createFrame();
qr.name = "qr-code(單號連結)";
qr.resize(96, 96);
qr.fills = [];
qr.strokes = [await paint("grey/900")];
qr.strokeWeight = 2;
const qt = await txt("QR", "Caption/SemiBold", "grey/900");
qr.appendChild(qt);
qt.x = 38;
qt.y = 40;
add(R, qr);
for (const role of ["經手人簽名", "收件人簽名"]) {
  const i = sg.createInstance();
  await setProps(i, { Role: role });
  add(R, i, "FILL");
}
org.componentPropertyReferences = {
  characters: R.addComponentProperty("Org", "TEXT", "示範商店"),
};
title.componentPropertyReferences = {
  characters: R.addComponentProperty("Title", "TEXT", "收據"),
};
rp.componentPropertyReferences = {
  visible: R.addComponentProperty("Reprint", "BOOLEAN", true),
};
R.description =
  DESC_PREFIX +
  "58mm 收據版面示範(底座規格 B8「版面零件」):寬 384px = 384 點(可列印約 48mm,一行約 16 個中文字),瀏覽器把同一個元件畫成黑白 PNG 送代理程式。上方印 Org(最上層組織名稱,不印平台名稱)、Title(單據名稱)、Reprint(補印與第幾次);區段以虛線分隔;Draft/Receipt58Row「標籤:值」;表格最多 3 欄;號碼用區段;底部 QR code(不用一維條碼);Draft/Receipt58Signature 簽名欄。螢幕預覽與列印用同一個元件。顏色只有 grey/900 與 common/white。";
return { printSet: pset.id, row: rr.id, sign: sg.id, receipt: R.id };
