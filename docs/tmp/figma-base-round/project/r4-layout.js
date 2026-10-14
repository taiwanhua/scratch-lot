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
    ["刷到票、快速銷售", ["ST-05", "ST-06"]],
    ["開班、兌獎、投庫 / 出庫", ["ST-04", "ST-11", "ST-12"]],
    ["拆本", ["ST-37", "ST-09"]],
    ["盤點", ["ST-16", "ST-13", "ST-14", "ST-15"]],
    ["交班結帳", ["ST-17", "ST-18", "ST-19"]],
    [
      "日結、存銀行",
      ["ST-20", "ST-21", "ST-22", "ST-23", "ST-24", "ST-25", "ST-26"],
    ],
    [
      "分頁:結帳、盤點紀錄與申請單",
      ["ST-27", "ST-28", "ST-29", "ST-30", "ST-31", "ST-32", "ST-33"],
    ],
  ],
  "91:14": [
    ["庫存、查票與本的詳情", ["IN-01", "IN-02", "IN-03", "IN-04"]],
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
    ["我的班表、畫休與打卡", ["SC-01", "SC-25", "SC-02", "SC-23"]],
    [
      "排班表",
      ["SC-03", "SC-04", "SC-16", "SC-17", "SC-15", "SC-19", "SC-18", "SC-21"],
    ],
    ["自動排班", ["SC-05", "SC-20"]],
    ["畫休總覽", ["SC-06", "SC-24"]],
    ["行事曆", ["SC-07", "SC-28"]],
    ["排班設定", ["SC-08", "SC-26", "SC-09", "SC-22", "SC-10", "SC-27"]],
    ["出勤紀錄與補打卡", ["SC-11", "SC-12", "SC-29", "SC-13", "SC-30"]],
    ["支援需求單", ["SC-14", "SC-31"]],
  ],
  // Base Draft:依節點 id 分列
  "41:5914": [
    [
      "元件:區塊、圖示、受眾、資料範圍、組織選單",
      ["41:5932", "43:66", "45:248", "46:156", "47:409"],
    ],
    ["元件:月曆、排班格", ["48:359", "48:360", "49:493", "49:494"]],
    ["元件:通知", ["50:567", "50:582", "50:620", "50:621"]],
    [
      "元件:列印按鈕與 58mm 單據",
      [
        "51:625",
        "51:626",
        "51:630",
        "51:633",
        "80:1491",
        "80:1508",
        "80:1509",
        "80:1511",
        "80:1515",
        "80:1517",
      ],
    ],
    ["元件:Stepper", ["79:1325", "79:1361"]],
    ["通知設定", ["54:610", "59:1524", "54:1002"]],
    [
      "印表機管理與列印",
      [
        "55:1116",
        "59:1528",
        "55:1424",
        "131:28357",
        "131:28422",
        "131:28474",
        "131:28825",
        "85:2052",
      ],
    ],
    ["流程設計器", ["56:1089", "56:1496", "82:1338"]],
    [
      "表單、表單設計器與申請中心",
      ["82:1829", "82:2077", "85:2158", "83:2264", "83:2559"],
    ],
    ["個人設定", ["83:1609", "83:1959", "83:2226"]],
    [
      "欄位管理、側欄、頁內分頁、Stepper 示範",
      ["85:2497", "85:2784", "85:2921", "85:3187"],
    ],
  ],
};
const SIZE = ["電腦 1440", "平板 1024", "手機 390"];
const GAP = 80,
  ROW_GAP = 200,
  LABEL_W = 280,
  X0 = 120;
const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);
const labelSrc = await figma.getNodeByIdAsync("125:2093"); // Heading/H6,綁 text/primary
async function fnt(t) {
  for (const f of t.getRangeAllFontNames(0, Math.max(1, t.characters.length)))
    await figma.loadFontAsync(f);
}
async function label(parent, text) {
  const t = labelSrc.clone();
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
}
const codeKey = (n) => {
  const m = /^([A-Z]{2}-\d\d)([a-c]?)/.exec(n.name);
  return m ? m[1] : null;
};
async function arrange(container, nodes, rows, emptyNote) {
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
        .filter((f) => !used.has(f) && (codeKey(f) === k || f.id === k))
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
    const lb = await label(
      container,
      list.length ? title : title + "\n(這個尺寸照共用規則,不另畫)",
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
  return { w: maxX + X0, h: y };
}
const rows = ROWS[PAGE_ID];
const out = [];
if (PAGE_ID === "41:5914") {
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
  let y0 = 0;
  for (const s of SIZE.map((l) =>
    page.children.find((n) => n.type === "SECTION" && n.name === l),
  ).filter(Boolean)) {
    const r = await arrange(s, [...s.children], rows);
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
return out;
