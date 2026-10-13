// Draft/Section:可收合區塊(底座規格 10.3)。前置:貼上 _resolve.js;目標頁已有 Draft/ActionIcon+。
// 屬性:Title(TEXT)、Summary(TEXT)、State=Expanded / Collapsed。
const icons = draft("Draft/ActionIcon+");
const glyph = (k) => icons.children.find((c) => c.name === "key=" + k);

async function variant(expanded) {
  const c = figma.createComponent();
  c.name = "State=" + (expanded ? "Expanded" : "Collapsed");
  c.layoutMode = "VERTICAL";
  c.counterAxisSizingMode = "FIXED";
  c.resize(560, 100);
  c.primaryAxisSizingMode = "AUTO";
  c.fills = [await paint("bg/paper")];
  c.strokes = [await paint("divider")];
  c.strokeWeight = 1;
  c.clipsContent = false;
  await radius(c, "radius/md");

  const head = add(
    c,
    al("HORIZONTAL", {
      name: "header",
      itemSpacing: 12,
      paddingLeft: 16,
      paddingRight: 12,
      paddingTop: 12,
      paddingBottom: 12,
      counterAxisAlignItems: "CENTER",
    }),
    "FILL",
  );
  add(head, await txt("經銷商資訊", "Subtitle/1", "text/primary", "title"));
  const summary = add(
    head,
    await txt("甲類 · 營業中", "Body/2", "text/secondary", "summary"),
  );
  summary.visible = !expanded;
  const sp = add(head, al("HORIZONTAL", { name: "spacer" }), "FILL");
  sp.resize(sp.width, 1);
  const btn = await inst("Draft/IconButton", {
    Variant: "Plain",
    Size: "Small",
  });
  btn.name = "toggle";
  const k = Object.keys(btn.componentProperties).find((x) =>
    x.startsWith("Icon"),
  );
  btn.setProperties({
    [k]: glyph(expanded ? "expand-less" : "expand-more").id,
  });
  add(head, btn);

  if (expanded) {
    const body = add(
      c,
      al("VERTICAL", {
        name: "content",
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 4,
        paddingBottom: 16,
        itemSpacing: 8,
      }),
      "FILL",
    );
    const slot = figma.createFrame();
    slot.name = "slot(內容由使用處放入)";
    slot.fills = [];
    slot.strokes = [await paint("divider")];
    slot.dashPattern = [4, 4];
    add(body, slot, "FILL");
    slot.resize(slot.width, 96);
  }
  return c;
}

const set = figma.combineAsVariants(
  [await variant(true), await variant(false)],
  figma.currentPage,
);
set.name = "Draft/Section";
set.layoutMode = "VERTICAL";
set.itemSpacing = 24;
set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 24;
set.primaryAxisSizingMode = "AUTO";
set.counterAxisSizingMode = "AUTO";
const tP = set.addComponentProperty("Title", "TEXT", "經銷商資訊");
const sP = set.addComponentProperty("Summary", "TEXT", "甲類 · 營業中");
for (const v of set.children) {
  v.findOne((n) => n.name === "title").componentPropertyReferences = {
    characters: tP,
  };
  v.findOne((n) => n.name === "summary").componentPropertyReferences = {
    characters: sP,
  };
}
set.description =
  DESC_PREFIX +
  "@repo/ui Section 可收合區塊(底座規格 10.3):一般頁面 <Section id title summary defaultCollapsed> 與表單版面區塊共用。State=Expanded 顯示內容槽;Collapsed 隱藏內容、標題列顯示 Summary。收合狀態存 localStorage `<slug>-admin-sections:<userId>`,表單有錯時自動展開並捲到第一個錯誤。收合鈕 = Draft/IconButton(Plain / Small)實例,Icon 換 Draft/ActionIcon+ key=expand-less(展開時)/ expand-more(收合時);搬回底座後改指 Draft/ActionIcon 同名變體。屬性:Title(TEXT)、Summary(TEXT,只在 Collapsed 顯示)、State=Expanded / Collapsed(對應 defaultCollapsed 與目前狀態)。只綁 wowgo-base 變數與文字樣式,不得綁 scratch-lot Brand。";
return { setId: set.id, variants: set.children.map((v) => v.id) };
