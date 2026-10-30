// Draft/Section:可收合區塊(底座規格 10.3)。前置:貼上 _resolve.js;底座 Draft/ActionIcon 已併入本輪圖示(README「搬回底座的方法」第 2 步)。
// 屬性:Title(TEXT)、Summary(TEXT)、Content(SLOT,只在 Expanded)、State=Expanded / Collapsed。
const icons = await comp("Draft/ActionIcon");
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
  add(head, await txt("基本資料", "Subtitle/1", "text/primary", "title"));
  const summary = add(
    head,
    await txt("示範摘要", "Body/2", "text/secondary", "summary"),
  );
  summary.visible = !expanded;
  const sp = figma.createFrame(); // 一般框(不是 auto layout),和現況一致
  sp.name = "spacer";
  sp.fills = [];
  add(head, sp, "FILL");
  sp.layoutSizingVertical = "FIXED";
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
    // 內容區是 SLOT(屬性 Content):使用處直接放入欄位、表格等任何內容(程式對應 children)
    const slot = c.createSlot();
    slot.name = "Content";
    slot.layoutMode = "VERTICAL";
    slot.paddingLeft = slot.paddingRight = 16;
    slot.paddingTop = 12;
    slot.paddingBottom = 16;
    slot.itemSpacing = 12;
    slot.fills = [];
    slot.layoutSizingHorizontal = "FILL";
    slot.primaryAxisSizingMode = "AUTO";
    add(
      slot,
      await txt("放入欄位、表格或任何內容", "Body/2", "text/secondary"),
    );
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
const tP = set.addComponentProperty("Title", "TEXT", "基本資料");
const sP = set.addComponentProperty("Summary", "TEXT", "示範摘要");
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
  "@repo/ui Section 可收合區塊(底座規格 10.3):一般頁面 <Section id title summary defaultCollapsed> 與表單版面區塊共用。State=Expanded 顯示內容 slot(SLOT 屬性 Content,使用處直接放入欄位、表格等任何內容;程式對應 children);Collapsed 隱藏內容、標題列顯示 Summary。收合狀態存 localStorage `<slug>-admin-sections:<userId>`,表單有錯時自動展開並捲到第一個錯誤。收合鈕 = Draft/IconButton(Plain / Small)實例,Icon 換 Draft/ActionIcon+ key=expand-less(展開時)/ expand-more(收合時);搬回底座後改指 Draft/ActionIcon 同名變體。屬性:Title(TEXT)、Summary(TEXT,只在 Collapsed 顯示)、State=Expanded / Collapsed(對應 defaultCollapsed 與目前狀態)。只綁 wowgo-base 變數與文字樣式,不得綁 scratch-lot Brand。";
return { setId: set.id, variants: set.children.map((v) => v.id) };
