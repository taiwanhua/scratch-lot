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
  const w = al("VERTICAL", { name: "field", itemSpacing: 4 });
  add(w, await txt("組織", "Caption", "text/secondary", "label"));
  add(w, box, "FILL");
  return w;
}
async function treeRow(level, label, state, multiple, checked) {
  const r = al("HORIZONTAL", {
    name: "tree-row",
    itemSpacing: 4,
    paddingLeft: 8 + level * 20,
    paddingRight: 8,
    paddingTop: 4,
    paddingBottom: 4,
    counterAxisAlignItems: "CENTER",
  });
  if (state === "leaf") {
    const sp = figma.createFrame();
    sp.name = "indent";
    sp.fills = [];
    sp.resize(24, 24);
    add(r, sp);
  } else add(r, icon(state === "open" ? "expand-more" : "chevron-right"));
  if (multiple)
    add(
      r,
      await inst("Draft/Checkbox", {
        State: checked ? "Checked" : "Unchecked",
        Enabled: "True",
      }),
    );
  add(r, await txt(label, "Body/2", "text/primary", "label"));
  if (!multiple && checked) r.fills = [await paint("action/selected")];
  await radius(r, "radius/sm");
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
  const s = al("HORIZONTAL", {
    name: "search",
    itemSpacing: 6,
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 6,
    paddingBottom: 6,
    counterAxisAlignItems: "CENTER",
  });
  s.strokes = [await paint("divider")];
  s.strokeWeight = 1;
  await radius(s, "radius/sm");
  add(s, icon("search"));
  add(s, await txt("搜尋組織", "Body/2", "text/secondary", "placeholder"));
  add(p, s, "FILL");
  const rows = [
    [0, "好運彩券(最上層組織)", "open", false],
    [1, "北區", "open", false],
    [2, "A 店", "leaf", true],
    [2, "B 店", "leaf", multiple],
    [1, "南區", "closed", false],
  ];
  for (const [l, t, st, ck] of rows)
    add(p, await treeRow(l, t, st, multiple, ck), "FILL");
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
