// Draft/DataScopeRuleCard:資料範圍規則卡片新版(底座規格 3.0)。
// 前置:貼上 _resolve.js;目標頁已有 Draft/AudiencePicker。屬性:Title(TEXT)。
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
async function filterTree() {
  const g = al("VERTICAL", {
    name: "group(根)",
    itemSpacing: 10,
    paddingLeft: 14,
    paddingRight: 14,
    paddingTop: 12,
    paddingBottom: 12,
  });
  g.fills = [await paint("bg/default")];
  await radius(g, "radius/sm");
  const h = al("HORIZONTAL", {
    name: "group-header",
    itemSpacing: 10,
    counterAxisAlignItems: "CENTER",
  });
  add(h, await sel("組合", "AND — 全部成立才放行", 220));
  add(g, h, "FILL");
  add(
    g,
    await row([
      await sel("欄位", "建立者", 140),
      await sel("條件", "屬於", 110),
      await sel("值", "【操作者本人】", 200),
    ]),
    "FILL",
  );
  add(
    g,
    await row([
      await sel("欄位", "狀態", 140),
      await sel("條件", "不屬於", 110),
      await sel("值", "已作廢", 200),
    ]),
    "FILL",
  );
  const foot = al("HORIZONTAL", { name: "add-actions", itemSpacing: 16 });
  add(foot, await link("+ 條件"));
  add(foot, await link("+ 群組"));
  add(g, foot);
  return g;
}
const c = figma.createComponent();
c.name = "Draft/DataScopeRuleCard";
c.layoutMode = "VERTICAL";
c.itemSpacing = 12;
c.paddingLeft = c.paddingRight = 16;
c.paddingTop = c.paddingBottom = 14;
c.counterAxisSizingMode = "FIXED";
c.resize(820, 100);
c.primaryAxisSizingMode = "AUTO";
c.fills = [await paint("bg/paper")];
c.strokes = [await paint("divider")];
c.strokeWeight = 1;
c.clipsContent = false;
await radius(c, "radius/sm");
const head = al("HORIZONTAL", {
  name: "header",
  itemSpacing: 10,
  counterAxisAlignItems: "CENTER",
});
const title = add(
  head,
  await txt("規則 1", "Subtitle/2", "text/primary", "title"),
);
const sp = add(head, al("HORIZONTAL", { name: "spacer" }), "FILL");
sp.resize(sp.width, 1);
add(head, await link("刪除規則"));
add(c, head, "FILL");
add(
  c,
  await txt("套用對象", "Caption/SemiBold", "text/secondary", "label-audience"),
);
const api = draft("Draft/AudiencePicker")
  .children.find((v) => v.name === "AllowEveryone=True, Value=Conditions")
  .createInstance();
api.name = "audience";
add(c, api, "FILL");
const line = figma.createRectangle();
line.name = "divider";
line.resize(10, 1);
line.fills = [await paint("divider")];
add(c, line, "FILL");
add(
  c,
  await txt("條件組合", "Caption/SemiBold", "text/secondary", "label-filter"),
);
add(c, await filterTree(), "FILL");
title.componentPropertyReferences = {
  characters: c.addComponentProperty("Title", "TEXT", "規則 1"),
};
c.description =
  DESC_PREFIX +
  "資料範圍規則卡片新版(底座規格 3.0「資料範圍的變更」;程式 DataScopePage/RuleEditorPanel/RuleCard)。上半「套用對象」= Draft/AudiencePicker(AllowEveryone=True,所有人 / 符合條件);分隔線;下半「條件組合」= 既有過濾條件樹(欄位依資料目標目錄,比較方式 屬於 / 不屬於 / 之間 / 之前 / 之後,動態值【操作者本人】【操作者的所屬組織】)。兩棵樹根層下拉都標「組合」,巢狀仍標「群組組合」。右上 Link「刪除規則」。規則合成(頁面層級)不變。取代資料範圍頁現有規則卡(Figma「Screen / 資料範圍」要跟著改)。";
return { id: c.id };
