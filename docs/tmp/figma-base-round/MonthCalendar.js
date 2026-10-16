// Draft/MonthCalendarCell + Draft/MonthCalendar(底座規格 10.5)。前置:貼上 _resolve.js;目標頁已有 Draft/ActionIcon+。
// Cell 屬性:State=Default / Today / Selected / Outside、Day(TEXT)、Show tag(BOOLEAN)、Show slot(BOOLEAN)。
const icons = draft("Draft/ActionIcon+");
const glyph = (k) => icons.children.find((c) => c.name === "key=" + k);
async function iconBtn(k) {
  const b = await inst("Draft/IconButton", {
    Variant: "Outlined",
    Size: "Small",
  });
  const pk = Object.keys(b.componentProperties).find((x) =>
    x.startsWith("Icon"),
  );
  b.setProperties({ [pk]: glyph(k).id });
  return b;
}
async function cell(state) {
  const c = figma.createComponent();
  c.name = "State=" + state;
  c.layoutMode = "VERTICAL";
  c.itemSpacing = 4;
  c.paddingLeft = c.paddingRight = c.paddingTop = c.paddingBottom = 6;
  c.resize(112, 96);
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "FIXED";
  c.fills = [
    await paint(state === "Selected" ? "action/selected" : "bg/paper"),
  ];
  c.strokes = [await paint(state === "Selected" ? "primary/main" : "divider")];
  c.strokeWeight = state === "Selected" ? 2 : 1;
  c.strokeAlign = "INSIDE";
  c.clipsContent = false;
  const num = al("HORIZONTAL", {
    name: "day",
    paddingLeft: 6,
    paddingRight: 6,
    paddingTop: 1,
    paddingBottom: 1,
    counterAxisAlignItems: "CENTER",
  });
  add(
    num,
    await txt(
      "15",
      "Body/2",
      state === "Outside"
        ? "text/disabled"
        : state === "Today"
          ? "primary/contrast"
          : "text/primary",
      "day-number",
    ),
  );
  if (state === "Today") {
    num.fills = [await paint("primary/main")];
    num.cornerRadius = 12;
  }
  add(c, num);
  const tag = await inst(
    "Draft/Tag",
    { Tone: "Warning" },
    { Label: "國定假日" },
  );
  tag.name = "calendar-tag";
  add(c, tag);
  const slot = figma.createFrame();
  slot.name = "slot(格子內容由使用處放入)";
  slot.fills = [];
  slot.strokes = [await paint("divider")];
  slot.dashPattern = [3, 3];
  add(c, slot, "FILL", "FILL");
  return c;
}
const cs = figma.combineAsVariants(
  [
    await cell("Default"),
    await cell("Today"),
    await cell("Selected"),
    await cell("Outside"),
  ],
  figma.currentPage,
);
cs.name = "Draft/MonthCalendarCell";
cs.layoutMode = "HORIZONTAL";
cs.itemSpacing = 16;
cs.paddingLeft = cs.paddingRight = cs.paddingTop = cs.paddingBottom = 16;
cs.primaryAxisSizingMode = "AUTO";
cs.counterAxisSizingMode = "AUTO";
const pDay = cs.addComponentProperty("Day", "TEXT", "15");
const pTag = cs.addComponentProperty("Show tag", "BOOLEAN", false);
const pSlot = cs.addComponentProperty("Show slot", "BOOLEAN", true);
for (const v of cs.children) {
  v.findOne((n) => n.name === "day-number").componentPropertyReferences = {
    characters: pDay,
  };
  v.findOne((n) => n.name === "calendar-tag").componentPropertyReferences = {
    visible: pTag,
  };
  v.findOne((n) => n.name.startsWith("slot")).componentPropertyReferences = {
    visible: pSlot,
  };
}
cs.description =
  DESC_PREFIX +
  "MonthCalendar 的日期格(底座規格 10.5)。State=Default / Today(日期數字 primary 圓底)/ Selected(action/selected 底 + primary 2px 框)/ Outside(非本月,數字 text/disabled)。屬性:Day(TEXT)、Show tag(BOOLEAN,行事曆標示,例「國定假日」用 Draft/Tag,顏色依欄位管理選項色)、Show slot(BOOLEAN,格子內容槽,內容由使用的模組決定,例:我的班表放排班時段)。";

const cal = figma.createComponent();
cal.name = "Draft/MonthCalendar";
cal.layoutMode = "VERTICAL";
cal.itemSpacing = 8;
cal.primaryAxisSizingMode = "AUTO";
cal.counterAxisSizingMode = "AUTO";
cal.fills = [];
cal.clipsContent = false;
const head = al("HORIZONTAL", {
  name: "toolbar",
  itemSpacing: 8,
  counterAxisAlignItems: "CENTER",
});
add(head, await iconBtn("chevron-left"));
add(head, await txt("2026 年 10 月", "Subtitle/1", "text/primary", "month"));
add(head, await iconBtn("chevron-right"));
const sp = add(head, al("HORIZONTAL", { name: "spacer" }), "FILL");
sp.resize(sp.width, 1);
add(
  head,
  await inst(
    "Button",
    { Variant: "Outlined", Size: "Small", State: "Default", Color: "Primary" },
    { Label: "今天" },
  ),
);
add(cal, head, "FILL");
const wk = al("HORIZONTAL", { name: "weekdays" });
for (const d of ["日", "一", "二", "三", "四", "五", "六"]) {
  const f = al("HORIZONTAL", {
    name: "weekday",
    primaryAxisAlignItems: "CENTER",
    paddingTop: 4,
    paddingBottom: 4,
  });
  f.resize(112, 24);
  f.primaryAxisSizingMode = "FIXED";
  add(f, await txt(d, "Caption/SemiBold", "text/secondary"));
  add(wk, f);
}
add(cal, wk);
// 2026 年 10 月:10/1 是星期四,週日開頭第一列 = 9/27~10/3;10/13 今天、10/16 選取、10/10 國定假日
const grid = al("VERTICAL", { name: "weeks" });
const variant = (s) => cs.children.find((v) => v.name === "State=" + s);
let day = 27;
let month = "prev";
for (let w = 0; w < 5; w++) {
  const r = al("HORIZONTAL", { name: "week-" + (w + 1) });
  for (let d = 0; d < 7; d++) {
    let state = month === "prev" ? "Outside" : "Default";
    if (month === "cur" && day === 13) state = "Today";
    if (month === "cur" && day === 16) state = "Selected";
    const i = variant(state).createInstance();
    const props = {};
    for (const k of Object.keys(i.componentProperties)) {
      if (k.startsWith("Day")) props[k] = String(day);
      if (k.startsWith("Show tag")) props[k] = month === "cur" && day === 10;
      if (k.startsWith("Show slot"))
        props[k] = month === "cur" && [13, 14, 16].includes(day);
    }
    for (const t of i.findAll((n) => n.type === "TEXT"))
      for (const f of t.getRangeAllFontNames(0, t.characters.length))
        await figma.loadFontAsync(f);
    i.setProperties(props);
    add(r, i);
    day++;
    if (month === "prev" && day > 30) {
      day = 1;
      month = "cur";
    } else if (month === "cur" && day > 31) {
      day = 1;
      month = "next";
    }
  }
  add(grid, r);
}
add(cal, grid);
cal.description =
  DESC_PREFIX +
  "MonthCalendar 月曆(@repo/ui,底座規格 10.5;不用第三方行事曆套件)。週日開頭(全系統一週從星期日開始);工具列 上月 / 月份 / 下月 / 今天;日期格 = Draft/MonthCalendarCell 實例(Today、Selected、Outside、行事曆標示 tag、內容槽)。選取、格子內容由使用的模組決定(排班:我的班表、行事曆編輯)。";
return { cellSet: cs.id, cal: cal.id };
