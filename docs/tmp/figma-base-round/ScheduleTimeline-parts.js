// Draft/ScheduleAutoMark、Draft/BreakMark、Draft/ScheduleTimelineDemand(底座規格 10.11 ScheduleTimeline 系列)。前置:貼上 _resolve.js。
// 這幾個元件原本直接在 Figma 畫(nodes.md 第 478、500、620、656 行),2026-10-30 照 scratch-lot Base Draft 當時的節點補成腳本:
// ScheduleAutoMark 286:77901、BreakMark 350:7571、ScheduleTimelineDemand 286:77949。
// 互動狀態的疊色用最底層的 state-layer 矩形(圖層不透明度),和 StateLayer.js / ToggleButton.js 同一個結構。
// ScheduleTimelineBlock 接在本檔後半(用到 ScheduleAutoMark)。

// MUI LocalCafeOutlined(@mui/icons-material),12 × 12 框內 10 × 9
const CAFE_PATH =
  "M 7 1 L 7 5 C 7 5.550000011920929 6.550000011920929 6 6 6 L 3 6 C 2.449999988079071 6 2 5.550000011920929 2 5 L 2 1 L 7 1 Z M 9 0 L 1 0 L 1 5 C 1 6.105000019073486 1.8949999809265137 7 3 7 L 6 7 C 7.105000019073486 7 8 6.105000019073486 8 5 L 8 3.5 L 9 3.5 C 9.555000007152557 3.5 10 3.0550000071525574 10 2.5 L 10 1 C 10 0.4449999928474426 9.555000007152557 0 9 0 Z M 8 2.5 L 8 1 L 9 1 L 9 2.5 L 8 2.5 Z M 9 8 L 0 8 L 0 9 L 9 9 L 9 8 Z";
async function cafeIcon() {
  const f = figma.createFrame();
  f.name = "local-cafe";
  f.resize(12, 12);
  f.fills = [];
  f.clipsContent = true;
  const v = figma.createVector();
  v.name = "Vector";
  v.vectorPaths = [{ windingRule: "NONZERO", data: CAFE_PATH }];
  f.appendChild(v);
  v.x = 1;
  v.y = 1.5;
  v.fills = [await paint("text/secondary")];
  v.strokes = [];
  v.constraints = { horizontal: "SCALE", vertical: "SCALE" };
  return f;
}
// 「☕ 30 分」:圖示 + 分鐘數(BreakMark 本體與長條 / 容器裡的 break 列共用)
async function breakRow(name) {
  const r = al("HORIZONTAL", {
    name,
    itemSpacing: 2,
    counterAxisAlignItems: "CENTER",
  });
  add(r, await cafeIcon(), "FIXED", "FIXED");
  add(
    r,
    await txt("30 分", "Caption", "text/secondary", "break-text"),
    "HUG",
    "HUG",
  );
  return r;
}
// 最底層的疊色(互動狀態)
async function stateLayer(c, colorName, opacity, r = 8) {
  const s = figma.createRectangle();
  s.name = "state-layer";
  c.insertChild(0, s);
  s.layoutPositioning = "ABSOLUTE";
  s.x = s.y = 0;
  s.resize(c.width, c.height);
  s.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
  s.cornerRadius = r;
  s.fills = [await paint(colorName)];
  s.opacity = opacity;
  return s;
}
async function stroke(
  node,
  colorName,
  { weight = 1, align = "INSIDE", opacity } = {},
) {
  const p = await paint(colorName);
  node.strokes = [opacity == null ? p : { ...p, opacity }];
  node.strokeWeight = weight;
  node.strokeAlign = align;
}
const out = {};

// ---- Draft/ScheduleAutoMark ----
{
  const c = figma.createComponent();
  c.name = "Draft/ScheduleAutoMark";
  c.layoutMode = "HORIZONTAL";
  c.primaryAxisAlignItems = c.counterAxisAlignItems = "CENTER";
  c.primaryAxisSizingMode = c.counterAxisSizingMode = "FIXED";
  c.resize(14, 14);
  c.fills = [await paint("primary/main")];
  c.cornerRadius = 7;
  const font = { family: "Public Sans", style: "SemiBold" };
  await figma.loadFontAsync(font);
  const g = figma.createText();
  g.name = "glyph";
  g.fontName = font;
  g.fontSize = 9;
  g.lineHeight = { unit: "PERCENT", value: 150 };
  g.characters = "✦";
  g.fills = [await paint("primary/contrast")];
  add(c, g, "HUG", "HUG");
  c.description =
    "【底座・本輪草稿,第 29 項】自動排入標記:自動排班排入的人,在格子 / 長條 / 標籤右上角固定顯示這個小圖示(四種檢視一致);手動改過就消失。";
  out.autoMark = c.id;
}

// ---- Draft/BreakMark ----
{
  const c = figma.createComponent();
  c.name = "Draft/BreakMark";
  c.layoutMode = "HORIZONTAL";
  c.itemSpacing = 2;
  c.counterAxisAlignItems = "CENTER";
  c.primaryAxisSizingMode = c.counterAxisSizingMode = "AUTO";
  c.fills = [];
  add(c, await cafeIcon(), "FIXED", "FIXED");
  const t = add(
    c,
    await txt("30 分", "Caption", "text/secondary", "break-text"),
    "HUG",
    "HUG",
  );
  const kMin = c.addComponentProperty("Minutes", "TEXT", "30 分");
  t.componentPropertyReferences = { characters: kMin };
  c.description =
    "【底座・本輪草稿】休息:MUI LocalCafeOutlined 圖示 + 分鐘數(「☕ 30 分」,窄時「☕ 90」)。容器標題、時間軸長條、班表格子、對話框共用;畫休另用斜線底,不寫「休」。";
  out.breakMark = c.id;
}

// ---- Draft/ScheduleTimelineDemand ----
{
  const TITLE = "早班 · 櫃台 A 08:30–14:30 · 負責 1/1 · 協同 1/2 · 休 30 分";
  // Tone → [框, 框不透明度, 標題字色];互動狀態只做 Tone=Normal
  const TONE = {
    Normal: ["divider", 0.24, "text/secondary"],
    Warning: ["warning/main", null, "warning/darker"],
    Error: ["error/main", null, "error/darker"],
  };
  async function demand(tone, inter) {
    const c = figma.createComponent();
    c.name = `Tone=${tone}, Interaction=${inter}`;
    c.layoutMode = "VERTICAL";
    c.itemSpacing = 0;
    c.paddingTop = c.paddingBottom = 6;
    c.paddingLeft = c.paddingRight = 8;
    c.primaryAxisSizingMode = c.counterAxisSizingMode = "FIXED";
    c.resize(320, 120);
    c.fills = [await paint("bg/default")];
    await radius(c, "radius/sm");
    const [sc, so, tc] = TONE[tone];
    if (inter === "Default") await stroke(c, sc, { opacity: so });
    else if (inter === "Focus")
      await stroke(c, "action/focus", {
        weight: 2,
        align: "OUTSIDE",
        opacity: 0.24,
      });
    else await stroke(c, "grey/500");
    const row = al("HORIZONTAL", {
      name: "title-row",
      itemSpacing: 4,
      counterAxisAlignItems: "CENTER",
    });
    row.clipsContent = true;
    add(c, row, "FILL", "HUG");
    const t = await txt(TITLE, "Caption/SemiBold", tc, "title");
    add(row, t, "FILL", "FILL");
    t.textAutoResize = "HEIGHT";
    const b = await breakRow("break");
    b.clipsContent = true;
    add(row, b, "HUG", "HUG");
    b.visible = false;
    if (inter === "Hover") await stateLayer(c, "grey/500", 0.08);
    if (inter === "Selected") {
      await stateLayer(c, "grey/500", 0.16);
      c.strokesIncludedInLayout = false;
    }
    return c;
  }
  const vs = [];
  for (const t of ["Normal", "Warning", "Error"])
    vs.push(await demand(t, "Default"));
  for (const i of ["Hover", "Selected", "Focus"])
    vs.push(await demand("Normal", i));
  const set = figma.combineAsVariants(vs, figma.currentPage);
  set.name = "Draft/ScheduleTimelineDemand";
  set.layoutMode = "HORIZONTAL";
  set.itemSpacing = 16;
  set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 16;
  set.primaryAxisSizingMode = set.counterAxisSizingMode = "AUTO";
  set.counterAxisAlignItems = "MIN";
  const kT = set.addComponentProperty("Title", "TEXT", TITLE);
  const kB = set.addComponentProperty("Break", "BOOLEAN", false);
  const kBT = set.addComponentProperty("BreakText", "TEXT", "30 分");
  for (const v of set.children) {
    v.findOne((n) => n.name === "title").componentPropertyReferences = {
      characters: kT,
    };
    v.findOne((n) => n.name === "break").componentPropertyReferences = {
      visible: kB,
    };
    v.findOne((n) => n.name === "break-text").componentPropertyReferences = {
      characters: kBT,
    };
  }
  set.description =
    "【底座・本輪草稿,第 29 項 ScheduleTimeline 容器模式】一個群組(例:一筆人力需求)的容器,底層;標題由模組提供。屬於它的長條(Draft/ScheduleTimelineBlock)疊在容器上方、位置依時間;容器比裡面所有長條高一點。Tone:Normal / Warning(缺人)/ Error(沒人)。 Interaction(互動狀態):Default / Hover(白底上疊 grey/500 × 8%、框 grey/500)/ Selected(疊 grey/500 × 16% + 1px grey/500 框)/ Focus(action/focus 2px 外框);只做 Tone=Normal 一組,其他 Tone 沿用同規則。";
  out.demand = set.id;
}

// ---- Draft/ScheduleTimelineBlock(259:4770)----
{
  // State → [底色, 框色, 框(上右下左)粗細 / 'dash', 字色(標題, 副標)];框色 null = 不畫框
  const ST = {
    Normal: [
      "primary/lighter",
      "primary/main",
      [0, 0, 0, 3],
      "text/primary",
      "text/secondary",
    ],
    Short: [
      "primary/lighter",
      "primary/main",
      [0, 0, 0, 3],
      "text/primary",
      "text/secondary",
    ],
    Warning: [
      "warning/lighter",
      "warning/main",
      [0, 0, 0, 3],
      "warning/darker",
      "warning/darker",
    ],
    Empty: [
      "error/lighter",
      "error/main",
      [0, 0, 0, 3],
      "error/darker",
      "error/darker",
    ],
    Disabled: ["grey/200", null, null, "text/disabled", "text/disabled"],
    MissingLead: [
      "error/lighter",
      "error/main",
      "dash",
      "error/darker",
      "error/darker",
    ],
    MissingHelper: [
      "warning/lighter",
      "warning/main",
      "dash",
      "warning/darker",
      "warning/darker",
    ],
    Extension: [
      "primary/lighter",
      "primary/main",
      "dash",
      "text/disabled",
      "text/disabled",
    ],
  };
  // 變體尺寸照 scratch-lot 現況;HUG 的四種高度跟著內容(表上的高度只是參考)
  const HUG = ["Short", "MissingLead", "MissingHelper", "Extension"];
  const SIZE = {
    "Normal,False": [160, 44],
    "Normal,True": [160, 44],
    "Short,False": [96, 80],
    "Short,True": [96, 98],
    "Warning,False": [160, 44],
    "Warning,True": [160, 44],
    "Empty,False": [160, 44],
    "Empty,True": [160, 44],
    "Disabled,False": [160, 44],
    "MissingLead,False": [160, 46],
    "MissingHelper,False": [160, 46],
    "Extension,False": [160, 46],
  };
  const autoMark = draft("Draft/ScheduleAutoMark");
  async function block(state, auto, inter) {
    const [bg, sc, sw, tc, sc2] = ST[state];
    const c = figma.createComponent();
    c.name = `State=${state}, Auto=${auto}, Interaction=${inter}`;
    c.layoutMode = "VERTICAL";
    c.itemSpacing = 0;
    c.paddingTop = c.paddingBottom = 4;
    c.paddingLeft = 8;
    c.paddingRight = auto === "True" ? 22 : 6;
    c.primaryAxisSizingMode = c.counterAxisSizingMode = "FIXED";
    const [w, h] = SIZE[`${state},${auto}`];
    c.resize(w, h);
    c.fills = [await paint(bg)];
    await radius(c, "radius/sm");
    if (inter === "Focus")
      await stroke(c, "action/focus", {
        weight: 2,
        align: "OUTSIDE",
        opacity: 0.24,
      });
    else if (sc) {
      await stroke(c, sc);
      if (sw === "dash") {
        c.strokeWeight = 1;
        c.dashPattern = [4, 3];
      } else {
        const s = inter === "Selected" ? [1, 1, 1, 3] : sw;
        [
          c.strokeTopWeight,
          c.strokeRightWeight,
          c.strokeBottomWeight,
          c.strokeLeftWeight,
        ] = s;
      }
    } else c.strokes = [];
    if (state === "Extension") c.opacity = 0.7;
    const head = al("HORIZONTAL", {
      name: "head",
      itemSpacing: 4,
      counterAxisAlignItems: "CENTER",
    });
    head.clipsContent = true;
    add(c, head, "FILL", "HUG");
    const row = al("HORIZONTAL", {
      name: "line-1-row",
      itemSpacing: 4,
      counterAxisAlignItems: "CENTER",
    });
    row.clipsContent = true;
    add(head, row, "FILL", "HUG");
    const chip = al("HORIZONTAL", {
      name: "lead-chip",
      paddingLeft: 4,
      paddingRight: 4,
    });
    chip.fills = [await paint("success/lighter")];
    chip.cornerRadius = 4;
    chip.clipsContent = true;
    add(row, chip, "HUG", "HUG");
    add(
      chip,
      await txt("早", "Caption/SemiBold", "success/darker", "lead-text"),
      "HUG",
      "HUG",
    );
    chip.visible = false;
    const t = await txt("王小明 17:00–20:00", "Caption/SemiBold", tc, "title");
    add(row, t, "FILL", "HUG");
    t.textAutoResize = "HEIGHT";
    const b = await breakRow("break");
    b.clipsContent = true;
    add(row, b, "HUG", "HUG");
    b.visible = false;
    const sub = await txt("超出容器的時間", "Caption", sc2, "subtitle");
    add(c, sub, "FILL", "HUG");
    sub.textAutoResize = "HEIGHT";
    if (HUG.includes(state)) c.primaryAxisSizingMode = "AUTO";
    if (auto === "True") {
      const m = autoMark.createInstance();
      c.appendChild(m);
      m.layoutPositioning = "ABSOLUTE";
      m.x = w - 18;
      m.y = 4;
      m.constraints = { horizontal: "MAX", vertical: "MIN" };
    }
    if (inter === "Hover") await stateLayer(c, "primary/main", 0.08);
    if (inter === "Selected") {
      await stateLayer(c, "primary/main", 0.16);
      c.strokesIncludedInLayout = false;
    }
    return c;
  }
  const vs = [];
  for (const s of ["Normal", "Short", "Warning", "Empty"]) {
    vs.push(await block(s, "False", "Default"));
    vs.push(await block(s, "True", "Default"));
  }
  for (const s of ["Disabled", "MissingLead", "MissingHelper", "Extension"])
    vs.push(await block(s, "False", "Default"));
  for (const i of ["Hover", "Selected", "Focus"])
    vs.push(await block("Normal", "False", i));
  const set = figma.combineAsVariants(vs, figma.currentPage);
  set.name = "Draft/ScheduleTimelineBlock";
  set.layoutMode = "HORIZONTAL";
  set.layoutWrap = "WRAP";
  set.itemSpacing = set.counterAxisSpacing = 16;
  set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 16;
  set.primaryAxisSizingMode = "FIXED";
  set.counterAxisSizingMode = "AUTO";
  set.resize(760, set.height);
  const kT = set.addComponentProperty("Title", "TEXT", "王小明 17:00–20:00");
  const kS = set.addComponentProperty("Subtitle", "TEXT", "超出容器的時間");
  const kL = set.addComponentProperty("Lead", "BOOLEAN", false);
  const kLT = set.addComponentProperty("LeadText", "TEXT", "早");
  const kB = set.addComponentProperty("Break", "BOOLEAN", false);
  const kBT = set.addComponentProperty("BreakText", "TEXT", "30 分");
  for (const v of set.children) {
    const f = (nm) => v.findOne((n) => n.name === nm);
    f("title").componentPropertyReferences = { characters: kT };
    f("subtitle").componentPropertyReferences = { characters: kS };
    f("lead-chip").componentPropertyReferences = { visible: kL };
    f("lead-text").componentPropertyReferences = { characters: kLT };
    f("break").componentPropertyReferences = { visible: kB };
    f("break-text").componentPropertyReferences = { characters: kBT };
  }
  set.description =
    "【底座・本輪草稿,第 29 項 ScheduleTimeline】時間軸上的一個時段區塊。State:Normal 正常 / Short 較短(只上部分時段)/ Warning 缺人 / Empty 沒人 / Disabled 不能操作(店休、已排於其他分店、不可排);Auto=True 右上顯示「自動」。寬度依時段長度調整,高度依列高。 State=Extension = 超出人力需求時間的延伸段(淡色底 + 虛線框):接在長條的前或後,和實線段相接,同一條長條延伸出容器;相接那一側不畫框、不圓角(實例覆寫該側 stroke 粗細 0 與兩角圓角 0,實線段相接側圓角也設 0),長度依時間。容器高度 / 寬度不變,長條可超出容器邊界。 Interaction(互動狀態):Default / Hover(原底色上疊 primary/main × 8%、框 primary/main)/ Selected(疊 primary/main × 16% + 1px primary/main 框)/ Focus(action/focus 2px 外框,鍵盤焦點);只做 State=Normal 一組,其他狀態沿用同規則。";
  out.block = set.id;
}
return out;
