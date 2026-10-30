// Draft/ScheduleTimeline(底座規格 10.11,容器模式):Mode = Day / Week。前置:貼上 _resolve.js;
// 草稿頁已有 Draft/ScheduleTimelineBlock、Draft/ScheduleTimelineDemand(ScheduleTimeline-parts.js)、Draft/ScheduleTimelineMore(TimelineMore-StatusChip.js);
// 表頭用底座 Draft/TableHeaderCell。原本直接在 Figma 畫(nodes.md 第 502、698、722 行),2026-10-30 照 scratch-lot Base Draft 289:66461 補成腳本。
// 示範資料、位置與實例覆寫照當時的節點;排版規則見元件說明。
const blockSet = draft("Draft/ScheduleTimelineBlock");
const demandSet = draft("Draft/ScheduleTimelineDemand");
const moreSet = draft("Draft/ScheduleTimelineMore");
async function rect(parent, name, x, y, w, h) {
  const r = figma.createRectangle();
  r.name = name;
  parent.appendChild(r);
  r.x = x;
  r.y = y;
  r.resize(w, h);
  r.fills = [{ ...(await paint("divider")), opacity: 0.24 }];
  return r;
}
async function header(parent, label, x, y, w) {
  const i = await inst("Draft/TableHeaderCell", {}, { Label: label });
  parent.appendChild(i);
  i.x = x;
  i.y = y;
  i.resize(w, 22);
  return i;
}
async function place(parent, set, variant, props, [x, y, w, h], hug) {
  const main = variantOf(set, variant);
  const i = main.createInstance();
  parent.appendChild(i);
  i.x = x;
  i.y = y;
  i.resize(w, h);
  // resize 會把高度改成固定;沒指定時恢復主元件的模式
  if ("primaryAxisSizingMode" in i && main.layoutMode !== "NONE")
    i.primaryAxisSizingMode =
      hug === true
        ? "AUTO"
        : hug === false
          ? "FIXED"
          : main.primaryAxisSizingMode;
  await setProps(i, props);
  // 副標空白時隱藏(現況的長條實例沒有副標,高度只有標題一行)
  if (props.Subtitle === "") {
    const sub = i.findOne((n) => n.name === "subtitle");
    if (sub) sub.visible = false;
  }
  return i;
}
const D = (tone, title, box) => [
  demandSet,
  { Tone: tone, Interaction: "Default" },
  { Title: title },
  box,
];
const B = (state, auto, props, box, hug) => [
  blockSet,
  { State: state, Auto: auto, Interaction: "Default" },
  { Subtitle: "", ...props },
  box,
  hug,
];
// 長條接延伸段:相接那一側不畫框、不圓角(元件說明「State=Extension」)
function joinSide(i, side) {
  const ks =
    side === "right"
      ? ["topRightRadius", "bottomRightRadius"]
      : ["topLeftRadius", "bottomLeftRadius"];
  for (const k of ks) {
    i.setBoundVariable(k, null);
    i[k] = 0;
  }
  if (side === "left") i.strokeLeftWeight = 0;
}
async function frame(name, w, h) {
  const c = figma.createComponent();
  c.name = name;
  c.resize(w, h);
  c.fills = [await paint("bg/paper")];
  c.strokes = [{ ...(await paint("divider")), opacity: 0.24 }];
  c.strokeWeight = 1;
  c.strokeAlign = "INSIDE";
  c.clipsContent = true;
  return c;
}

// ---- Mode=Day:06:00–23:00 每小時 64 寬 ----
const day = await frame("Mode=Day", 1152, 325);
for (let i = 0; i < 18; i++)
  await header(day, String(6 + i).padStart(2, "0") + ":00", 64 * i, 0, 64);
for (let i = 0; i <= 18; i++) await rect(day, "grid-v", 64 * i, 22, 1, 303);
const DAY = [
  D(
    "Warning",
    "早班 · 櫃台 A 08:30–14:30 · 負責 1/1 · 協同 1/2 · 休 30 分",
    [162, 30, 380, 125],
  ),
  B(
    "Normal",
    "True",
    { Title: "休 30 分", Lead: true, LeadText: "王小明" },
    [166, 61, 372, 26],
    true,
  ),
  B(
    "Normal",
    "False",
    { Title: "李小華 · 休 30 分" },
    [166, 91, 372, 26],
    true,
  ),
  B("MissingHelper", "False", { Title: "缺協同 1" }, [166, 121, 372, 28]),
  D(
    "Warning",
    "晚班 · 櫃台 A 14:30–22:00 · 負責 1/1 · 協同 0/1 · 休 30 分",
    [546, 30, 476, 95],
  ),
  B(
    "Normal",
    "False",
    { Title: "休 30 分", Lead: true, LeadText: "陳大文" },
    [550, 61, 468, 26],
    true,
  ),
  B("MissingHelper", "False", { Title: "缺協同 1" }, [550, 91, 468, 28]),
  D(
    "Error",
    "早班 · 櫃台 B 08:30–14:30 · 負責 0/1 · 休 30 分",
    [162, 181, 380, 65],
  ),
  B("MissingLead", "False", { Title: "缺負責 1" }, [166, 212, 372, 28]),
  D(
    "Normal",
    "晚班 · 櫃台 B 14:30–22:00 · 負責 1/1 · 休 30 分",
    [546, 181, 476, 63],
  ),
  B(
    "Normal",
    "False",
    { Title: "休 30 分", Lead: true, LeadText: "陳大文" },
    [550, 212, 468, 26],
    true,
  ),
  D("Normal", "補貨 · 補貨區 13:00–17:00 · 協同 1/1", [450, 254, 252, 63]),
  B("Normal", "False", { Title: "林美麗" }, [454, 285, 244, 26], true),
  B(
    "Extension",
    "False",
    { Title: "林美麗 排到 20:00" },
    [698, 285, 192, 26],
    false,
  ),
];
const dayInst = [];
for (const a of DAY) dayInst.push(await place(day, ...a));
joinSide(dayInst[12], "right");
joinSide(dayInst[13], "left");

// ---- Mode=Week:08:00–21:00 每小時 36 高、7 天各 188 寬 ----
const week = await frame("Mode=Week", 1364, 527);
await header(week, "", 0, 0, 48);
for (let i = 0; i < 14; i++) {
  await rect(week, "grid-h", 48, 22 + 36 * i, 1316, 1);
  await header(
    week,
    String(8 + i).padStart(2, "0") + ":00",
    0,
    22 + 36 * i,
    48,
  );
}
const DAYS = [
  "11/1 日",
  "11/2 一",
  "11/3 二",
  "11/4 三",
  "11/5 四",
  "11/6 五",
  "11/7 六",
];
for (let i = 0; i < 7; i++) {
  await header(week, DAYS[i], 48 + 188 * i, 0, 188);
  await rect(week, "grid-v", 48 + 188 * i, 22, 1, 505);
}
const LM = (name) => ({ Title: "", Lead: true, LeadText: name });
const WEEK = [
  B("Disabled", "False", { Title: "店休 不能排" }, [428, 26, 180, 496], false),
  D("Warning", "早 1/2", [49, 42, 76, 212]),
  B("Normal", "False", LM("王小明"), [53, 73, 68, 26], true),
  B("MissingHelper", "False", { Title: "缺協同 1" }, [53, 103, 68, 28]),
  D("Error", "B 0/1", [125, 42, 48, 212]),
  B("MissingLead", "False", { Title: "缺負責 1" }, [129, 73, 40, 46]),
  D("Normal", "晚 2/2", [49, 258, 76, 266]),
  B("Normal", "False", LM("陳大文"), [53, 289, 68, 26], true),
  B("Normal", "False", { Title: "林美麗" }, [53, 319, 68, 26], true),
  D("Normal", "早 08:30–14:30 2/2", [240, 42, 180, 194]),
  B(
    "Normal",
    "True",
    { Title: "林美麗", LeadText: "林美麗" },
    [244, 73, 172, 26],
    true,
  ),
  B("Normal", "False", LM("王小明"), [244, 103, 172, 26], true),
  D("Warning", "晚 14:30–22:00 1/2", [240, 258, 180, 266]),
  B("Normal", "False", LM("陳大文"), [244, 289, 172, 26], true),
  B("MissingHelper", "False", { Title: "缺協同 1" }, [244, 319, 172, 28]),
  D("Normal", "早 2/2", [616, 42, 88, 212]),
  B("Normal", "False", LM("李小華"), [620, 73, 80, 26], true),
  B("Normal", "False", { Title: "林美麗" }, [620, 103, 80, 26], true),
  D("Normal", "補 1/1", [708, 204, 88, 140]),
  B("Normal", "False", { Title: "張小芳" }, [712, 235, 80, 26], true),
  D("Normal", "晚 17:00–22:00 1/1", [616, 348, 180, 176]),
  B("Normal", "True", LM("王小明"), [620, 379, 172, 26], true),
  D("Normal", "早 08:30–14:30 2/2", [804, 42, 180, 212]),
  B("Normal", "False", LM("王小明"), [808, 73, 172, 26], true),
  B("Normal", "False", { Title: "張小芳" }, [808, 103, 172, 26], true),
  D("Normal", "晚 14:30–22:00 2/2", [804, 258, 180, 266]),
  B("Normal", "False", LM("陳大文"), [808, 289, 172, 26], true),
  B("Normal", "False", { Title: "李小華" }, [808, 319, 172, 26], true),
  D("Normal", "早 08:30–14:30 2/2", [992, 42, 180, 194]),
  B("Normal", "True", LM("林美麗"), [996, 73, 172, 26], true),
  B("Normal", "False", { Title: "李小華" }, [996, 103, 172, 26], true),
  D("Normal", "晚 14:30–22:00 1/1", [992, 258, 180, 266]),
  B("Normal", "False", LM("陳大文"), [996, 289, 172, 26], true),
  D("Normal", "早 08:30–14:30 2/2", [1180, 42, 180, 212]),
  B("Normal", "False", LM("王小明"), [1184, 73, 172, 26], true),
  B("Normal", "False", { Title: "張小芳" }, [1184, 103, 172, 26], true),
  D("Normal", "晚 14:30–22:00 2/2", [1180, 258, 180, 266]),
  B("Normal", "False", LM("陳大文"), [1184, 289, 172, 26], true),
  B("Normal", "False", { Title: "林美麗" }, [1184, 319, 172, 26], true),
];
for (const a of WEEK) await place(week, ...a);
// 第一天同時段第三筆放不下收起 →「+1」長條佔滿時間軸(當天欄最右邊)
const more = await place(
  week,
  moreSet,
  { Tone: "Neutral", State: "Default" },
  { Label: "+1" },
  [215, 23, 20, 503],
);
more.name = "more +1";

const set = figma.combineAsVariants([day, week], figma.currentPage);
set.name = "Draft/ScheduleTimeline";
set.layoutMode = "VERTICAL";
set.itemSpacing = 24;
set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 24;
set.primaryAxisSizingMode = set.counterAxisSizingMode = "AUTO";
set.counterAxisAlignItems = "MIN";
set.description =
  "【底座・本輪草稿,第 29 項 ScheduleTimeline,容器模式】Mode=Day:每筆群組(例:人力需求)是一個 Draft/ScheduleTimelineDemand 容器,重疊的容器往下排;長條(Draft/ScheduleTimelineBlock)放在容器內、依時間定位;缺額用 MissingLead / MissingHelper 虛線空位;長條超出容器時間用 Extension 淡色虛線。Mode=Week:7 天各一欄;週模式排版(底座規格 10.11):容器寬 = 20 + 28 × 條數(max(需求人數, 已排人數)),依排序(開始時間 → 模組排序鍵 → 建立時間 → id)逐一放在最左邊整段時間都空得下的位置,找不到就整個收起;有收起時保留最右邊 24px 重排,當天欄最右邊一條佔滿時間軸的「+N」長條(Draft/ScheduleTimelineMore,點了回呼模組)。示範第一天:早(2 條)+ 補(1 條)並排,同時段第三筆放不下收起 →「+1」。表頭用現有 Draft/TableHeaderCell。";
return { id: set.id, day: day.id, week: week.id };
