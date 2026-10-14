// Draft/OrgTreeSelect(底座規格 10.2)。前置:貼上 _resolve.js;目標頁已有 Draft/ActionIcon+。
// 變體:State=Closed / Open × Mode=Single / Multiple。
const icons = draft("Draft/ActionIcon+");
const icon = (k) => {
  const i = icons.children.find((c) => c.name === "key=" + k).createInstance();
  i.name = "icon-" + k;
  return i;
};
function spacer(p) {
  const s = add(p, al("HORIZONTAL", { name: "spacer" }), "FILL");
  s.resize(s.width, 1);
  return s;
}
async function input(multiple) {
  const box = al("HORIZONTAL", {
    name: "input",
    itemSpacing: 6,
    paddingLeft: 12,
    paddingRight: 8,
    paddingTop: 8,
    paddingBottom: 8,
    counterAxisAlignItems: "CENTER",
  });
  box.strokes = [await paint("divider")];
  box.strokeWeight = 1;
  await radius(box, "radius/sm");
  if (multiple)
    for (const l of ["A 店", "B 店"])
      add(box, await inst("Draft/Tag", { Tone: "Grey" }, { Label: l }));
  else add(box, await txt("A 店", "Body/2", "text/primary", "value"));
  spacer(box);
  add(box, icon("arrow-drop-down"));
  // 浮動標籤(和 TextField / SelectField 一致):輸入框高 40,標籤壓在上框線(10, −8),底部留 16 給說明文字,總高 56
  const w = al("VERTICAL", { name: "field", paddingBottom: 16 });
  w.clipsContent = false;
  add(w, box, "FILL");
  box.layoutSizingVertical = "FIXED";
  box.resize(box.width, 40);
  const lw = al("HORIZONTAL", {
    name: "labelWrap",
    paddingLeft: 4,
    paddingRight: 4,
  });
  lw.fills = [await paint("bg/paper")];
  add(w, lw);
  lw.layoutPositioning = "ABSOLUTE";
  lw.x = 10;
  lw.y = -8;
  add(lw, await txt("組織", "Caption", "text/secondary", "label"));
  return w;
}
// 樹的每一列沿用現有的 Draft/OrgTreeItem(與「選擇所屬組織」對話框同一個元件):深度、選取、勾選框都是它的屬性;
// 現有的組織樹不收合,所以這裡也不畫展開箭頭(第十九輪改,原本自畫列 + 箭頭)
async function treeRow(level, label, multiple, checked) {
  // 單選:選到的列 State=Selected(反白);多選:列維持 Default,裡面的勾選框改 Checked(和現有對話框一樣)
  const r = await inst(
    "Draft/OrgTreeItem",
    {
      State: checked && !multiple ? "Selected" : "Default",
      Depth: String(Math.min(level, 3)),
    },
    { Label: label, ShowCheckbox: multiple, ShowTag: false },
  );
  if (multiple && checked) {
    const cb = r.findOne(
      (n) => n.type === "INSTANCE" && /Checkbox/.test(n.name),
    );
    await setProps(cb, { State: "Checked" });
  }
  return r;
}
async function panel(multiple) {
  const p = al("VERTICAL", {
    name: "popup",
    itemSpacing: 4,
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 8,
    paddingBottom: 8,
  });
  p.fills = [await paint("bg/paper")];
  p.effectStyleId = (await style("Shadow/Dropdown")).id;
  await radius(p, "radius/md");
  p.clipsContent = false;
  // 搜尋框沿用現有 TextField(與「選擇所屬組織」對話框相同)
  const s = await inst(
    "TextField",
    { Size: "Small", State: "Default" },
    { Label: "搜尋組織", Value: "" },
  );
  add(p, s, "FILL");
  const rows = [
    [0, "示範公司(最上層組織)", false],
    [1, "北區", false],
    [2, "A 店", true],
    [2, "B 店", multiple],
    [1, "南區", false],
  ];
  for (const [l, t, ck] of rows)
    add(p, await treeRow(l, t, multiple, ck), "FILL");
  if (multiple)
    add(p, await txt("已選 2 / 上限 5", "Caption", "text/secondary", "count"));
  return p;
}
async function variant(state, mode) {
  const c = figma.createComponent();
  c.name = `State=${state}, Mode=${mode}`;
  c.layoutMode = "VERTICAL";
  c.itemSpacing = 4;
  c.counterAxisSizingMode = "FIXED";
  c.resize(320, 10);
  c.primaryAxisSizingMode = "AUTO";
  c.fills = [];
  c.clipsContent = false;
  const m = mode === "Multiple";
  add(c, await input(m), "FILL");
  if (state === "Open") add(c, await panel(m), "FILL");
  return c;
}
const set = figma.combineAsVariants(
  [
    await variant("Closed", "Single"),
    await variant("Closed", "Multiple"),
    await variant("Open", "Single"),
    await variant("Open", "Multiple"),
  ],
  figma.currentPage,
);
set.name = "Draft/OrgTreeSelect";
set.layoutMode = "HORIZONTAL";
set.layoutWrap = "WRAP";
set.itemSpacing = 32;
set.counterAxisSpacing = 32;
set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 24;
set.primaryAxisSizingMode = "FIXED";
set.resize(24 * 2 + 320 * 2 + 32, 10);
set.counterAxisSizingMode = "AUTO";
set.description =
  DESC_PREFIX +
  "OrgTreeSelect 組織樹下拉(底座規格 10.2;內部沿用 OrgTreePicker 與 lib/org-tree.ts)。State=Closed:輸入框顯示已選組織(Single 為文字、Multiple 為 Draft/Tag chip)+ arrow-drop-down;State=Open:下拉面板(bg/paper、radius/md、Shadow/Dropdown)= 搜尋框 + 組織樹(每層縮排 20、expand-more / chevron-right 展開、Multiple 用 Draft/Checkbox、Single 選中列 action/selected 底)。只列操作者可見範圍內的組織;可設上限(Multiple 底部「已選 n / 上限 m」)。最上層組織在租戶畫面顯示實際名稱,不寫「租戶」。屬性:State=Closed / Open、Mode=Single / Multiple。";
return { setId: set.id };
