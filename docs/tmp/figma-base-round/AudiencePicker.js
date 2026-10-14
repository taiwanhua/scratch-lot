// Draft/AudiencePicker:人員條件(底座規格 3.0)。前置:貼上 _resolve.js;目標頁已有 Draft/ActionIcon+。
// 變體:Value=Everyone / Conditions × AllowEveryone=True / False(False 只有 Conditions)。
// 條件樹樣式對齊資料範圍頁既有規則卡(群組 bg/default 底、radius/sm;條件列 = Draft/Select ×n + Link「刪除」)。
async function sel(label, value, w) {
  const s = await inst(
    "Draft/Select",
    { Variant: "Outlined" },
    { Label: label, Value: value },
  );
  s.resize(w, s.height);
  return s;
}
async function link(label) {
  return inst("Link", { State: "Default" }, { Label: label });
}
async function row(cells) {
  const r = al("HORIZONTAL", {
    name: "condition-row",
    itemSpacing: 10,
    counterAxisAlignItems: "CENTER",
  });
  for (const c of cells) add(r, c);
  const sp = add(r, al("HORIZONTAL", { name: "spacer" }), "FILL");
  sp.resize(sp.width, 1);
  add(r, await link("刪除"));
  return r;
}
async function chips(labels) {
  // 多選值:沿用 Draft/Autocomplete(Closed)外觀,chip 以 Draft/Tag 呈現
  const box = al("HORIZONTAL", {
    name: "value-chips",
    itemSpacing: 6,
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 6,
    paddingBottom: 6,
    counterAxisAlignItems: "CENTER",
  });
  box.strokes = [await paint("divider")];
  box.strokeWeight = 1;
  await radius(box, "radius/sm");
  for (const l of labels)
    add(box, await inst("Draft/Tag", { Tone: "Grey" }, { Label: l }));
  box.primaryAxisSizingMode = "FIXED";
  box.resize(240, 40);
  box.counterAxisSizingMode = "FIXED";
  return box;
}
// 根群組 bg/default;巢狀群組 bg/paper + divider 框(與根群組區分)
async function group(label, value, hint, nested) {
  const g = al("VERTICAL", {
    name: nested ? "group(巢狀)" : "group(根)",
    itemSpacing: 10,
    paddingLeft: 14,
    paddingRight: 14,
    paddingTop: 12,
    paddingBottom: 12,
  });
  g.fills = [await paint(nested ? "bg/paper" : "bg/default")];
  if (nested) {
    g.strokes = [await paint("divider")];
    g.strokeWeight = 1;
  }
  await radius(g, "radius/sm");
  const h = al("HORIZONTAL", {
    name: "group-header",
    itemSpacing: 10,
    counterAxisAlignItems: "CENTER",
  });
  add(h, await sel(label, value, 220));
  if (hint) add(h, await txt(hint, "Caption", "text/secondary", "hint"));
  const sp = add(h, al("HORIZONTAL", { name: "spacer" }), "FILL");
  sp.resize(sp.width, 1);
  if (nested) add(h, await link("刪除群組"));
  add(g, h, "FILL");
  const foot = al("HORIZONTAL", { name: "add-actions", itemSpacing: 16 });
  add(foot, await link("+ 條件"));
  if (!nested) add(foot, await link("+ 群組"));
  add(g, foot);
  return g;
}
function put(g, index, child) {
  g.insertChild(index, child);
  child.layoutSizingHorizontal = "FILL";
}
async function tree() {
  const g = await group("組合", "AND — 全部成立才放行", null, false);
  put(
    g,
    1,
    await row([
      await sel("欄位", "角色", 140),
      await sel("條件", "屬於", 96),
      await chips(["店長"]),
    ]),
  );
  const n = await group(
    "群組組合",
    "OR — 其中一個成立即可",
    "整個群組視為上一層的一個條件",
    true,
  );
  put(
    n,
    1,
    await row([
      await sel("欄位", "所屬組織", 140),
      await sel("條件", "屬於", 96),
      await sel("值", "A 店", 160),
      await sel("範圍", "含下層", 120),
    ]),
  );
  put(
    n,
    2,
    await row([
      await sel("欄位", "權限", 140),
      await sel("條件", "持有", 96),
      await chips(["示範模組 · 編輯"]),
    ]),
  );
  put(g, 2, n);
  return g;
}
async function variant(allowEveryone, value) {
  const c = figma.createComponent();
  c.name = `AllowEveryone=${allowEveryone ? "True" : "False"}, Value=${value}`;
  c.layoutMode = "VERTICAL";
  c.itemSpacing = 12;
  c.counterAxisSizingMode = "FIXED";
  c.resize(760, 100);
  c.primaryAxisSizingMode = "AUTO";
  c.fills = [];
  c.clipsContent = false;
  if (allowEveryone) {
    const radios = al("HORIZONTAL", {
      name: "mode",
      itemSpacing: 24,
      counterAxisAlignItems: "CENTER",
    });
    for (const [label, on] of [
      ["所有人", value === "Everyone"],
      ["符合條件", value === "Conditions"],
    ]) {
      const item = al("HORIZONTAL", {
        name: "radio-" + label,
        itemSpacing: 6,
        counterAxisAlignItems: "CENTER",
      });
      add(
        item,
        await inst("Draft/Radio", { State: on ? "Selected" : "Default" }),
      );
      add(item, await txt(label, "Body/2", "text/primary"));
      add(radios, item);
    }
    add(c, radios);
  }
  if (value === "Conditions") add(c, await tree(), "FILL");
  return c;
}
const set = figma.combineAsVariants(
  [
    await variant(true, "Everyone"),
    await variant(true, "Conditions"),
    await variant(false, "Conditions"),
  ],
  figma.currentPage,
);
set.name = "Draft/AudiencePicker";
set.layoutMode = "VERTICAL";
set.itemSpacing = 32;
set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 24;
set.primaryAxisSizingMode = "AUTO";
set.counterAxisSizingMode = "AUTO";
set.description =
  DESC_PREFIX +
  "人員條件選擇器 AudiencePicker(底座規格 3.0,格式 Audience)。頂層二選一「所有人 / 符合條件」只在 AllowEveryone=True(資料範圍的套用對象)出現;審核者、知會、逾時通知、通知設定一律 AllowEveryone=False、必須至少一個條件列。" +
  "條件樹沿用資料範圍條件組合的 JSON 與編輯器(ConditionGroup / ConditionRow):群組 op + children、每層「組合」AND / OR、巢狀「群組組合」、UI 最多 3 層、空群組不允許。" +
  "欄位四種:使用者、角色、所屬組織(值 + 範圍 本身 / 含下層 / 含上層)、權限(比較方式顯示「持有」);比較方式只有「屬於 / 持有」,不提供「不屬於」(審核者與通知要能反推名單)。" +
  "組織來源依使用處:資料範圍 = 指定組織;流程 = 指定組織 / 表單的組織欄位 / 單據所屬組織 / 最上層組織;通知設定 = 類型宣告、唯讀。共用流程只能用權限與非指定的組織來源(AUDIENCE_IN_SHARED)。值多選以 Draft/Tag chip 示意,實作用 Draft/Autocomplete。";
return {
  setId: set.id,
  variants: set.children.map((v) => v.name + " " + v.id),
};
