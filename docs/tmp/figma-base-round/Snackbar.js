// Draft/Snackbar+(底座規格 10.12):全站統一的提示條,搬回底座時取代現有 Draft/Snackbar(變體與屬性見下)。
// 前置:貼上 _resolve.js;目標頁已有 Draft/ActionIcon+。
// 樣式 = 卡片:底 bg/paper、文字 text/primary、左側 4px 色條 <severity>/main、陰影與尺寸沿用現有 Draft/Snackbar(寬 360、Shadow/z8、radius/md);
// 全部綁主題變數,暗色模式自動套用暗色那組。右側 ✕;有動作時 [動作] 在 ✕ 左邊。
// 變體 Severity = Success / Error / Warning / Info;屬性 Title(TEXT)+ ShowTitle(BOOLEAN)、Message(TEXT)、ShowAction(BOOLEAN);
// 動作按鈕是 exposed instance(現有 Button,Text / Small),實例上直接改 Label。
const icons = draft("Draft/ActionIcon+");
const glyph = (k) => icons.children.find((c) => c.name === "key=" + k);
async function closeBtn() {
  const b = await inst("Draft/IconButton", { Variant: "Plain", Size: "Small" });
  const pk = Object.keys(b.componentProperties).find((x) =>
    x.startsWith("Icon"),
  );
  b.setProperties({ [pk]: glyph("close").id });
  b.name = "close";
  return b;
}
const SEV = {
  Success: "success/main",
  Error: "error/main",
  Warning: "warning/main",
  Info: "info/main",
};
async function variant(sev) {
  const c = figma.createComponent();
  c.name = "Severity=" + sev;
  c.layoutMode = "HORIZONTAL";
  c.itemSpacing = 0;
  c.resize(360, 10);
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "AUTO";
  c.counterAxisAlignItems = "MIN";
  c.fills = [await paint("bg/paper")];
  c.effectStyleId = (await style("Shadow/z8")).id;
  await radius(c, "radius/md");
  c.clipsContent = true; // 色條跟著圓角
  const bar = figma.createRectangle();
  bar.name = "bar";
  bar.resize(4, 10);
  bar.fills = [await paint(SEV[sev])];
  add(c, bar);
  bar.layoutSizingVertical = "FILL";
  const body = al("HORIZONTAL", {
    name: "body",
    itemSpacing: 8,
    paddingLeft: 12,
    paddingRight: 8,
    paddingTop: 10,
    paddingBottom: 10,
    counterAxisAlignItems: "CENTER",
  });
  add(c, body, "FILL");
  const tc = al("VERTICAL", { name: "texts", itemSpacing: 2 });
  add(body, tc, "FILL");
  const title = add(
    tc,
    await txt("已售出", "Subtitle/2", "text/primary", "title"),
    "FILL",
  );
  const msg = add(
    tc,
    await txt("示範單據 #D-0031 · 200 元", "Body/2", "text/primary", "message"),
    "FILL",
  );
  title.textAutoResize = msg.textAutoResize = "HEIGHT";
  const act = await inst(
    "Button",
    { Variant: "Text", Size: "Small", State: "Default", Color: "Primary" },
    { Label: "撤銷" },
  );
  act.name = "action";
  add(body, act);
  add(body, await closeBtn());
  return { c, title, msg, act };
}
const parts = [];
for (const s of Object.keys(SEV)) parts.push(await variant(s));
const set = figma.combineAsVariants(
  parts.map((p) => p.c),
  figma.currentPage,
);
set.name = "Draft/Snackbar+";
set.layoutMode = "HORIZONTAL";
set.itemSpacing = 24;
set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 24;
set.primaryAxisSizingMode = set.counterAxisSizingMode = "AUTO";
set.counterAxisAlignItems = "MIN";
const kT = set.addComponentProperty("Title", "TEXT", "已售出");
const kST = set.addComponentProperty("ShowTitle", "BOOLEAN", true);
const kM = set.addComponentProperty(
  "Message",
  "TEXT",
  "示範單據 #D-0031 · 200 元",
);
const kA = set.addComponentProperty("ShowAction", "BOOLEAN", true);
for (const v of set.children) {
  const t = v.findOne((n) => n.name === "title");
  const m = v.findOne((n) => n.name === "message");
  const a = v.findOne((n) => n.name === "action");
  t.componentPropertyReferences = { characters: kT, visible: kST };
  m.componentPropertyReferences = { characters: kM };
  a.componentPropertyReferences = { visible: kA };
  a.isExposedInstance = true;
}
set.description =
  DESC_PREFIX +
  "全站統一的提示條(底座規格 10.12),搬回底座時取代 Draft/Snackbar。位置:電腦 / 平板右下(距邊 24,往上堆疊,最多 3 則,新的在下面),手機底部置中滿寬(左右 16)。卡片:bg/paper、text/primary、左側色條 <severity>/main、Shadow/z8、radius/md,暗色自動套用。右側 ✕;動作按鈕(例 [撤銷])在 ✕ 左邊。通知提示(新通知)也用它(Severity=Info + Title)。";
return { id: set.id };
