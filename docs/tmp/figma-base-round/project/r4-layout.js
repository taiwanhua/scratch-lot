// 第七輪:畫面高度貼合內容 + 依操作流程排列(scratch-lot Screens)。
// 用法:`const PAGE_ID = "65:14";` + 本檔(不需要 r4-lib.js)。每頁跑一次。
// 專案頁:三個尺寸 Section(電腦 / 平板 / 手機)由上到下;Section 內一個流程一列,入口畫面後面接它打開的畫面;
// 列的左邊是框外列標題「列標題 / <名稱>」;三個 Section 的列與順序相同(該尺寸沒有畫面的列只留標題並註明照共用規則)。
// 框外註解「<畫面名> · 註解」跟在它的畫面右邊。Base Draft 頁沒有尺寸 Section,直接在頁上分列。
const ROWS = {
  "65:14": [
    [
      "看板與卡片操作",
      [
        "ST-01",
        "ST-02",
        "ST-03",
        "ST-34",
        "ST-35",
        "ST-08",
        "ST-36",
        "ST-07",
        "ST-10",
      ],
    ],
    ["刷到刮刮樂、快速銷售", ["ST-05", "ST-06"]],
    [
      "開班、兌獎、投庫 / 出庫",
      ["ST-04", "ST-11", "ST-38", "ST-41", "ST-39", "ST-12"],
    ],
    ["拆本", ["ST-37", "ST-09"]],
    ["盤點", ["ST-16", "ST-13", "ST-14", "ST-15"]],
    ["交班結帳", ["ST-17", "ST-18", "ST-19"]],
    [
      "日結、存銀行",
      ["ST-20", "ST-21", "ST-22", "ST-23", "ST-24", "ST-25", "ST-26"],
    ],
    [
      "分頁:結帳、盤點紀錄、申請單與兌獎紀錄",
      ["ST-27", "ST-28", "ST-29", "ST-30", "ST-31", "ST-32", "ST-40", "ST-33"],
    ],
  ],
  "91:14": [
    ["庫存、查刮刮樂與本的詳情", ["IN-01", "IN-02", "IN-03", "IN-04"]],
    ["待查·遺失", ["IN-05"]],
    ["預計要給本數", ["IN-06"]],
  ],
  "69:14": [
    ["叫貨與採購清單", ["PU-01", "PU-02", "PU-03"]],
    ["進貨與點收", ["PU-04", "PU-05", "PU-06", "PU-07", "PU-11"]],
    ["調貨", ["PU-08", "PU-09", "PU-10"]],
  ],
  "93:14": [
    ["銀行帳戶", ["AC-01", "AC-02", "AC-03"]],
    ["即時現金帳", ["AC-04"]],
    ["待結清款項", ["AC-05"]],
    ["關帳", ["AC-06", "AC-07"]],
  ],
  "94:14": [
    ["選報表與預覽", ["RE-01", "RE-03", "RE-02", "RE-04"]],
    ["班次結帳歷史報表", ["RE-05"]],
  ],
  "95:14": [
    ["甲類經銷商", ["DE-01", "DE-03", "DE-04", "DE-06"]],
    ["乙類經銷商", ["DE-02", "DE-05"]],
    ["關係人", ["DE-07", "DE-08"]],
    ["標準頁的平板 / 手機規則", ["RW-01", "RW-02", "RW-03", "RW-04"]],
  ],
  "97:14": [
    ["遊戲", ["MD-01", "MD-02", "MD-03", "MD-04"]],
    ["收銀點", ["MD-05"]],
  ],
  "70:14": [
    [
      "我的班表 · 班表與打卡",
      ["SC-01", "SC-25", "SC-32", "SC-38", "SC-39", "SC-40"],
    ],
    ["我的班表 · 我的畫休", ["SC-02", "SC-41a*", "SC-41b*", "SC-42", "SC-23"]],
    [
      "排班作業 · 排班表的四種檢視",
      [
        "SC-03",
        "SC-59",
        "SC-57",
        "SC-58",
        "SC-55",
        "SC-56",
        "SC-43",
        "SC-44",
        "SC-45",
        "SC-46",
        "SC-47",
        "SC-18",
      ],
    ],
    [
      "排班作業 · 人力需求與排班的對話框",
      [
        "SC-21",
        "SC-53",
        "SC-49a*",
        "SC-48",
        "SC-04",
        "SC-54",
        "SC-52a*",
        "SC-49b*",
        "SC-34a*",
        "SC-34b*",
        "SC-16",
        "SC-52b*",
        "SC-50",
      ],
    ],
    ["排班作業 · 套用範本", ["SC-17a*", "SC-17b*"]],
    ["排班作業 · 排班表的其他狀態", ["SC-35", "SC-33"]],
    [
      "排班作業 · 自動排班",
      ["SC-20a*", "SC-36", "SC-20c*", "SC-20b*", "SC-37"],
    ],
    [
      "排班作業 · 發布與發布後異動",
      ["SC-15a*", "SC-15c*", "SC-15d*", "SC-15b*", "SC-19"],
    ],
    ["排班作業 · 畫休總覽與代改", ["SC-06", "SC-24"]],
    ["排班作業 · 行事曆", ["SC-07", "SC-28"]],
    [
      "排班作業 · 支援需求單(平板 / 手機照 RW-01 / RW-02 共用規則,不另畫)",
      ["SC-31", "SC-14"],
    ],
    ["排班設定 · 排班人員", ["SC-08", "SC-26"]],
    [
      "排班設定 · 人力需求範本與人力需求週範本",
      ["SC-09a*", "SC-22a*", "SC-09b*", "SC-22b*"],
    ],
    ["排班設定 · 規則", ["SC-10", "SC-27"]],
    [
      "出勤紀錄(依人員(月)的平板 / 手機照 RW-01 共用規則)",
      ["SC-11", "SC-12", "SC-29"],
    ],
    ["補打卡申請(平板 / 手機照 RW-02 / RW-03 共用規則)", ["SC-13", "SC-30"]],
  ],
  // Base Draft:依名稱分列(在 wowgo-base 重建時也能用);「*」結尾是名稱開頭比對
  base: [
    [
      "元件:區塊、圖示、受眾、資料範圍、組織選單",
      [
        "Draft/Section",
        "Draft/ActionIcon+",
        "Draft/AudiencePicker",
        "Draft/DataScopeRuleCard",
        "Draft/OrgTreeSelect",
        "Draft/AdminSideNav+",
      ],
    ],
    [
      "元件:月曆、排班格",
      [
        "Draft/MonthCalendarCell",
        "Draft/MonthCalendar",
        "Draft/RosterCell",
        "Draft/RosterGrid",
        "BS-23",
      ],
    ],
    [
      "元件:通知",
      [
        "Draft/NotificationBell",
        "Draft/NotificationItem",
        "Draft/NotificationPanel",
        "Draft/Snackbar+",
      ],
    ],
    [
      "元件:列印按鈕與 58mm 單據",
      [
        "Draft/PrintButton",
        "Draft/Receipt58Row",
        "Draft/Receipt58Signature",
        "Draft/Receipt58",
        "Draft/Receipt58Header",
        "Draft/Receipt58TableRow",
        "Draft/Receipt58Range",
        "Draft/Receipt58Total",
        "Draft/Receipt58Divider",
        "Draft/Receipt58QR",
        "Draft/Receipt58Text",
        "Draft/Receipt58Barcode",
        "Draft/Receipt58Cut",
      ],
    ],
    ["元件:Stepper", ["Draft/StepperStep", "Draft/Stepper"]],
    [
      "元件:時間軸(ScheduleTimeline)",
      ["Draft/ScheduleTimelineBlock", "Draft/ScheduleTimeline", "BS-22"],
    ],
    // 參考畫面:每張都以現有底座畫面為底(Screens2-base.js + Base-ref.js)
    ["資料範圍", ["BS-01"]],
    ["流程設計器", ["BS-02", "BS-03"]],
    ["表單模組與表單設計器", ["BS-04", "BS-12", "BS-21"]],
    ["個人設定", ["BS-05", "BS-06"]],
    ["申請中心與頁內分頁", ["BS-07", "BS-15"]],
    ["通知", ["BS-08", "BS-09"]],
    [
      "印表機管理與列印",
      ["BS-10", "BS-17", "BS-18", "BS-19", "BS-20", "BS-11"],
    ],
    ["欄位管理、側欄計數、Stepper", ["BS-13", "BS-14", "BS-16"]],
  ],
};
const SIZE = ["電腦 1440", "平板 1024", "手機 390"];
const GAP = 80,
  ROW_GAP = 200,
  LABEL_W = 280,
  X0 = 120;
const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);
// 列標題樣式:沿用頁上既有的列標題(Heading/H6,綁 text/primary);頁上沒有時用 222:16949,再沒有就用 Inter
const pageLabel = page.findOne(
  (n) => n.type === "TEXT" && n.name.startsWith("列標題 / "),
);
let labelSrc = pageLabel
  ? pageLabel.clone()
  : await figma.getNodeByIdAsync("222:16949");
if (pageLabel) {
  page.appendChild(labelSrc);
  labelSrc.visible = false;
  labelSrc.name = "_label-template"; // 不能叫「列標題 / 」:Base Draft 的列標題直接在頁上,排列前會被清掉
}
async function fnt(t) {
  for (const f of t.getRangeAllFontNames(0, Math.max(1, t.characters.length)))
    await figma.loadFontAsync(f);
}
async function label(parent, text) {
  let t;
  if (labelSrc) {
    t = labelSrc.clone();
    t.visible = true;
  } else {
    await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
    t = figma.createText();
    t.fontName = { family: "Inter", style: "Semi Bold" };
    t.fontSize = 20;
  }
  parent.appendChild(t);
  await fnt(t);
  t.characters = text;
  t.name = "列標題 / " + text.split("\n")[0];
  t.textAutoResize = "HEIGHT";
  t.resize(LABEL_W, t.height);
  return t;
}
// 畫面高度貼合內容:殼(main > content)改 HUG 量高度;遮罩彈窗與手機底部面板不動
function fit(f) {
  if (f.type !== "FRAME" || !("children" in f)) return;
  const main = f.children.find((n) => n.name === "main" && n.type === "FRAME");
  if (!main) return;
  const c = main.children.find(
    (n) => n.name === "content" && n.type === "FRAME",
  );
  if (!c || f.children.some((n) => n.name === "scrim")) return;
  const minH = f.width >= 1440 ? 900 : f.width >= 1024 ? 768 : 844; // 至少一個視窗高,側欄不被切
  for (const k of f.children)
    if (
      k !== main &&
      k.layoutPositioning !== "ABSOLUTE" &&
      f.layoutMode !== "NONE"
    )
      k.layoutSizingVertical = "FILL";
  c.layoutSizingVertical = "HUG";
  main.layoutSizingVertical = "HUG";
  f.resize(f.width, Math.max(minH, Math.ceil(main.height)));
  main.layoutSizingVertical = "FILL";
  // 固定在底部的操作列(絕對定位)跟著新的高度貼齊底部
  for (const k of main.children)
    if (k.layoutPositioning === "ABSOLUTE" && /^bottom-bar/.test(k.name))
      k.y = main.height - k.height;
}
const codeKey = (n) => {
  const m = /^([A-Z]{2}-\d\d)([a-c]?)/.exec(n.name);
  return m ? m[1] : null;
};
async function arrange(container, nodes, rows, deskRows) {
  for (const n of [...container.children])
    if (
      n.type === "TEXT" &&
      (n.name.startsWith("列標題 / ") || n.name === "row-label")
    )
      n.remove();
  nodes = nodes.filter((n) => !n.removed);
  const caps = new Map();
  for (const n of nodes)
    if (n.type === "TEXT" && n.name.endsWith(" · 註解"))
      caps.set(n.name.slice(0, -5), n);
  const frames = nodes.filter((n) => !(n.type === "TEXT"));
  const used = new Set();
  const byRow = rows.map(([title, keys]) => {
    const list = [];
    for (const k of keys)
      for (const f of frames
        .filter(
          (f) =>
            !used.has(f) &&
            (codeKey(f) === k ||
              f.id === k ||
              f.name === k ||
              (k.endsWith("*") && f.name.startsWith(k.slice(0, -1)))),
        )
        .sort((a, b) => (a.name < b.name ? -1 : 1))) {
        list.push(f);
        used.add(f);
      }
    return [title, list];
  });
  const rest = frames.filter((f) => !used.has(f));
  if (rest.length) byRow.push(["其他", rest]);
  let y = 160,
    maxX = 0;
  for (const [title, list] of byRow) {
    // 這個尺寸少了電腦版有的畫面 → 列標題註明其餘照共用規則
    const have = new Set(list.map((f) => codeKey(f)));
    const desk = deskRows ? deskRows.get(title) : null;
    const partial = desk && [...desk].some((c) => !have.has(c));
    const lb = await label(
      container,
      !list.length
        ? title + "\n(這個尺寸照共用規則,不另畫)"
        : partial
          ? title + "\n(其餘畫面照共用規則,不另畫)"
          : title,
    );
    lb.x = X0;
    lb.y = y;
    let x = X0 + LABEL_W + GAP,
      h = lb.height;
    for (const f of list) {
      fit(f);
      f.x = x;
      f.y = y;
      x += f.width + GAP;
      h = Math.max(h, f.height);
      const cp = caps.get(f.name);
      if (cp) {
        cp.x = x - GAP + 24;
        cp.y = y;
        x += cp.width + 24;
        h = Math.max(h, cp.height);
      }
    }
    maxX = Math.max(maxX, x);
    y += h + ROW_GAP;
  }
  arrange.lastRows = new Map(
    byRow.map(([t, l]) => [t, new Set(l.map((f) => codeKey(f)))]),
  );
  return { w: maxX + X0, h: y };
}
const rows = ROWS[PAGE_ID] || (/本輪/.test(page.name) ? ROWS.base : null);
const out = [];
if (/本輪/.test(page.name)) {
  const r = await arrange(
    page,
    [...page.children].filter(
      (n) =>
        !(
          n.type === "TEXT" &&
          (n.name === "row-label" || n.name.startsWith("列標題 / "))
        ),
    ),
    rows,
  );
  out.push(r);
} else {
  // 缺的尺寸 Section 也建出來(只放列標題),三個 Section 的列一致
  for (const l of SIZE)
    if (!page.children.find((n) => n.type === "SECTION" && n.name === l)) {
      const ns = figma.createSection();
      ns.name = l;
      ns.resizeWithoutConstraints(2000, 400);
    }
  let y0 = 0,
    deskRows = null;
  for (const s of SIZE.map((l) =>
    page.children.find((n) => n.type === "SECTION" && n.name === l),
  ).filter(Boolean)) {
    const r = await arrange(
      s,
      [...s.children],
      rows,
      s.name === SIZE[0] ? null : deskRows,
    );
    if (s.name === SIZE[0]) deskRows = arrange.lastRows;
    s.x = 0;
    s.y = y0;
    s.resizeWithoutConstraints(Math.max(r.w, 2000), r.h);
    y0 += s.height + 400;
    out.push([s.name, Math.round(r.w), Math.round(r.h)]);
  }
  for (const s of page.children.filter(
    (n) => n.type === "SECTION" && !SIZE.includes(n.name),
  )) {
    s.x = 0;
    s.y = y0;
    y0 += s.height + 400;
  }
}
if (pageLabel) labelSrc.remove();
return out;
