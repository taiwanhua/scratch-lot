// 第二十五輪:既有畫面的小改(班表頁 70:14,含 Overlay 的「背景:」複本)
// 1. 滑過提示加任務內容(SC-60 週檢視長條、SC-61 班表格子)。
// 2. 手機日檢視卡片(SC-45 手機、SC-46 手機背景):不在卡片裡加人 / 移除人(新模型:點標題 → 人力需求對話框、點人 → 編輯排班、點缺額 → 新增排班),
//    拿掉 [移除] 與 [+ 加人];卡片清單最後加一列虛線「+ 人力需求」(手機沒有時間軸空白處,用這一列新增人力需求)。
figma.skipInvisibleInstanceChildren = false;
const page = await figma.getNodeByIdAsync("70:14");
await page.loadAsync();
const loaded = new Set();
const fonts = async (t) => {
  for (const f of t.getRangeAllFontNames(0, t.characters.length)) {
    const k = JSON.stringify(f);
    if (!loaded.has(k)) {
      await figma.loadFontAsync(f);
      loaded.add(k);
    }
  }
};
const out = { tips: 0, btns: 0, add: 0 };
const TIPS = [
  [
    "張小芳 · 08:30–14:30 · ☕ 30 分 · 協同 · 店內櫃台",
    "張小芳 · 08:30–14:30 · ☕ 30 分 · 協同 · 店內事務 · 店內櫃台",
  ],
  [
    "李小華 · 早 08:30–14:30 · ☕ 30 分 · 負責 · 店內櫃台",
    "李小華 · 早 08:30–14:30 · ☕ 30 分 · 負責 · 店內事務與帳目負責 · 店內櫃台",
  ],
];
for (const t of page.findAll((n) => n.type === "TEXT")) {
  const hit = TIPS.find(([a]) => t.characters === a);
  if (!hit) continue;
  await fonts(t);
  t.characters = hit[1];
  out.tips++;
}
const V = async (id) => figma.variables.getVariableByIdAsync(id);
const divider = await V(
  "VariableID:860a5dc497e0d365947731af9f273cd963ca1d04/6:214",
);
const ts = await V("VariableID:c11ac6a81b471a6a46f85602d056355c19fd4166/6:204");
const paint = (v) =>
  figma.variables.setBoundVariableForPaint(
    { type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } },
    "color",
    v,
  );
for (const list of page.findAll(
  (n) => n.type === "FRAME" && n.name === "人力需求卡片",
)) {
  for (const b of list.findAll(
    (n) => n.type === "INSTANCE" && /^Button (移除|\+ 加人)$/.test(n.name),
  )) {
    b.remove();
    out.btns++;
  }
  if (list.children.some((c) => c.name === "add-demand")) continue;
  // 虛線「+ 人力需求」:寬同卡片、高 44,divider 虛線框、text/secondary 字
  const card = list.children.find(
    (c) => c.type === "FRAME" && c.name !== "日期",
  );
  const a = figma.createAutoLayout("HORIZONTAL", {
    name: "add-demand",
    primaryAxisAlignItems: "CENTER",
    counterAxisAlignItems: "CENTER",
  });
  a.fills = [];
  a.strokes = [paint(divider)];
  a.dashPattern = [4, 4];
  a.cornerRadius = card ? card.cornerRadius : 8;
  list.appendChild(a);
  a.layoutSizingHorizontal = "FILL";
  a.layoutSizingVertical = "FIXED";
  a.resize(a.width, 44);
  const t = figma.createText();
  const st = await figma.importStyleByKeyAsync(
    "5fb1ba864f8fa1d388e29e66d1664b889e0a24ee",
  ); // body2
  await figma.loadFontAsync(st.fontName);
  t.fontName = st.fontName;
  await t.setTextStyleIdAsync(st.id);
  t.characters = "+ 人力需求";
  t.fills = [paint(ts)];
  t.name = "+ 人力需求";
  a.appendChild(t);
  out.add++;
}
return out;
