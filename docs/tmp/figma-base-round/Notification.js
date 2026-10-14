// Draft/NotificationBell、Draft/NotificationItem、Draft/NotificationPanel、Draft/NotificationToast(底座規格 B7)。
// 前置:貼上 _resolve.js;目標頁已有 Draft/ActionIcon+。
const icons = draft("Draft/ActionIcon+");
const glyph = (k) => icons.children.find((c) => c.name === "key=" + k);
async function iconBtn(k, variant = "Plain", size = "Medium") {
  const b = await inst("Draft/IconButton", { Variant: variant, Size: size });
  const pk = Object.keys(b.componentProperties).find((x) =>
    x.startsWith("Icon"),
  );
  b.setProperties({ [pk]: glyph(k).id });
  return b;
}
function spacer(p) {
  const s = add(p, al("HORIZONTAL", { name: "spacer" }), "FILL");
  s.resize(s.width, 1);
  return s;
}
function hugSet(set, dir) {
  set.layoutMode = dir;
  set.itemSpacing = dir === "VERTICAL" ? 16 : 24;
  set.paddingLeft =
    set.paddingRight =
    set.paddingTop =
    set.paddingBottom =
      dir === "VERTICAL" ? 16 : 24;
  set.primaryAxisSizingMode = "AUTO";
  set.counterAxisSizingMode = "AUTO";
  set.counterAxisAlignItems = "MIN";
}

// ---- Bell:Unread=True / False ----
async function bell(unread) {
  const c = figma.createComponent();
  c.name = "Unread=" + (unread ? "True" : "False");
  c.resize(40, 40);
  c.fills = [];
  c.clipsContent = false;
  const b = await iconBtn("notifications");
  c.appendChild(b);
  if (unread) {
    const bd = await inst(
      "Draft/Badge",
      { Color: "Primary", Variant: "Standard" },
      { Content: "3" },
    );
    bd.name = "badge";
    c.appendChild(bd);
    bd.x = 22;
    bd.y = 2;
  }
  return c;
}
const bellSet = figma.combineAsVariants(
  [await bell(true), await bell(false)],
  figma.currentPage,
);
bellSet.name = "Draft/NotificationBell";
hugSet(bellSet, "HORIZONTAL");
bellSet.description =
  DESC_PREFIX +
  "通知鈴(底座規格 B7「UI」;放在 Draft/AdminAppBar 右側、語言切換左邊)。Draft/IconButton(Plain / Medium)+ Draft/ActionIcon+ key=notifications;Unread=True 時右上 Draft/Badge(Primary)顯示未讀數(0 不顯示、超過 99 顯示 99+)。點開 Draft/NotificationPanel。未讀數由即時通道 user:<id> 的 notification 信號觸發重抓。";

// ---- Item:Read=False / True;屬性 Title / Body / Time ----
async function item(read) {
  const c = figma.createComponent();
  c.name = "Read=" + (read ? "True" : "False");
  c.layoutMode = "HORIZONTAL";
  c.itemSpacing = 10;
  c.paddingLeft = c.paddingRight = 16;
  c.paddingTop = c.paddingBottom = 12;
  c.resize(360, 10);
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "AUTO"; // resize 之後再設,否則高度被固定
  c.counterAxisAlignItems = "MIN";
  c.fills = [];
  c.clipsContent = false;
  const dot = figma.createEllipse();
  dot.name = "unread-dot";
  dot.resize(8, 8);
  dot.fills = [await paint(read ? "divider" : "primary/main")];
  dot.opacity = read ? 0 : 1;
  const dw = al("VERTICAL", { name: "dot-slot", paddingTop: 6 });
  add(dw, dot);
  add(c, dw);
  const col = al("VERTICAL", { name: "content", itemSpacing: 2 });
  add(
    col,
    await txt(
      "待你審核:示範表單 #F-0012",
      "Subtitle/2",
      read ? "text/secondary" : "text/primary",
      "title",
    ),
    "FILL",
  );
  const body = await txt(
    "王小明 送出示範表單,共 5 筆明細。",
    "Body/2",
    "text/secondary",
    "body",
  );
  add(col, body);
  body.textAutoResize = "HEIGHT";
  body.layoutSizingHorizontal = "FILL";
  add(col, await txt("10 分鐘前", "Caption", "text/disabled", "time"));
  add(c, col, "FILL");
  return c;
}
const itemSet = figma.combineAsVariants(
  [await item(false), await item(true)],
  figma.currentPage,
);
itemSet.name = "Draft/NotificationItem";
hugSet(itemSet, "VERTICAL");
const pT = itemSet.addComponentProperty(
  "Title",
  "TEXT",
  "待你審核:示範表單 #F-0012",
);
const pB = itemSet.addComponentProperty(
  "Body",
  "TEXT",
  "王小明 送出示範表單,共 5 筆明細。",
);
const pTm = itemSet.addComponentProperty("Time", "TEXT", "10 分鐘前");
for (const v of itemSet.children) {
  v.findOne((n) => n.name === "title").componentPropertyReferences = {
    characters: pT,
  };
  v.findOne((n) => n.name === "body").componentPropertyReferences = {
    characters: pB,
  };
  v.findOne((n) => n.name === "time").componentPropertyReferences = {
    characters: pTm,
  };
}
itemSet.description =
  DESC_PREFIX +
  "通知清單的一列(底座規格 B7;資料 notifications)。Read=False:左側 primary 小圓點、標題 text/primary;Read=True:無圓點、標題 text/secondary。屬性 Title / Body / Time(TEXT)。點擊 = 標已讀並開連結(ref)。";

// ---- Panel:State=List / Empty ----
async function panel(state) {
  const c = figma.createComponent();
  c.name = "State=" + state;
  c.layoutMode = "VERTICAL";
  c.resize(360, 10);
  c.primaryAxisSizingMode = "AUTO";
  c.counterAxisSizingMode = "FIXED";
  c.fills = [await paint("bg/paper")];
  c.effectStyleId = (await style("Shadow/Dropdown")).id;
  await radius(c, "radius/md");
  c.clipsContent = false;
  const h = al("HORIZONTAL", {
    name: "header",
    paddingLeft: 16,
    paddingRight: 12,
    paddingTop: 12,
    paddingBottom: 12,
    counterAxisAlignItems: "CENTER",
  });
  add(h, await txt("通知", "Subtitle/1", "text/primary"));
  spacer(h);
  if (state === "List")
    add(h, await inst("Link", { State: "Default" }, { Label: "全部標為已讀" }));
  add(c, h, "FILL");
  const line = figma.createRectangle();
  line.name = "divider";
  line.resize(10, 1);
  line.fills = [await paint("divider")];
  add(c, line, "FILL");
  if (state === "List") {
    const data = [
      [
        false,
        "待你審核:示範表單 #F-0012",
        "王小明 送出示範表單,共 5 筆明細。",
        "10 分鐘前",
      ],
      [false, "證照到期提醒", "示範資料 A 將於 11/12 到期。", "1 小時前"],
      [
        true,
        "列印失敗:缺紙",
        "收據 #P-0031 未印出,請補紙後補印。",
        "昨天 21:04",
      ],
    ];
    for (const [r, t, b, tm] of data) {
      const i = (
        r ? itemSet.children[1] : itemSet.children[0]
      ).createInstance();
      await setProps(i, { Title: t, Body: b, Time: tm });
      add(c, i, "FILL");
    }
  } else {
    const e = al("VERTICAL", {
      name: "empty",
      paddingTop: 40,
      paddingBottom: 40,
      itemSpacing: 8,
      counterAxisAlignItems: "CENTER",
    });
    add(e, glyph("notifications").createInstance());
    add(e, await txt("目前沒有通知", "Body/2", "text/secondary"));
    add(c, e, "FILL");
  }
  return c;
}
const panelSet = figma.combineAsVariants(
  [await panel("List"), await panel("Empty")],
  figma.currentPage,
);
panelSet.name = "Draft/NotificationPanel";
hugSet(panelSet, "HORIZONTAL");
panelSet.description =
  DESC_PREFIX +
  "通知清單彈出層(底座規格 B7;點通知鈴開啟)。bg/paper、radius/md、Shadow/Dropdown、寬 360。標題列「通知」+ Link「全部標為已讀」;內容為 Draft/NotificationItem 實例(新到舊);State=Empty 顯示「目前沒有通知」。通知保存 90 天(TTL)。";

// ---- Toast ----
const t = figma.createComponent();
t.name = "Draft/NotificationToast";
t.layoutMode = "HORIZONTAL";
t.itemSpacing = 12;
t.paddingLeft = 16;
t.paddingRight = 8;
t.paddingTop = t.paddingBottom = 12;
t.counterAxisAlignItems = "MIN";
t.resize(360, 10);
t.primaryAxisSizingMode = "FIXED";
t.counterAxisSizingMode = "AUTO";
t.fills = [await paint("bg/paper")];
t.effectStyleId = (await style("Shadow/Dialog")).id;
await radius(t, "radius/md");
t.clipsContent = false;
const ic = glyph("notifications").createInstance();
ic.name = "icon";
add(t, ic);
const tc = al("VERTICAL", { name: "content", itemSpacing: 2 });
const tt = add(
  tc,
  await txt("待你審核:示範表單 #F-0012", "Subtitle/2", "text/primary", "title"),
);
const tb = await txt(
  "王小明 送出示範表單,共 5 筆明細。",
  "Body/2",
  "text/secondary",
  "body",
);
add(tc, tb);
tb.textAutoResize = "HEIGHT";
tb.layoutSizingHorizontal = "FILL";
add(t, tc, "FILL");
add(t, await iconBtn("close", "Plain", "Small"));
tt.componentPropertyReferences = {
  characters: t.addComponentProperty(
    "Title",
    "TEXT",
    "待你審核:示範表單 #F-0012",
  ),
};
tb.componentPropertyReferences = {
  characters: t.addComponentProperty(
    "Body",
    "TEXT",
    "王小明 送出示範表單,共 5 筆明細。",
  ),
};
t.description =
  DESC_PREFIX +
  "新通知提示(底座規格 B7「UI」):固定右下角、數秒後自動消失、可按 × 關閉;點內容開連結。與 Draft/Snackbar(右上、mutation 成功 / 失敗)不同用途。icon = Draft/ActionIcon+ key=notifications;屬性 Title / Body(TEXT)。";
return { bell: bellSet.id, item: itemSet.id, panel: panelSet.id, toast: t.id };
