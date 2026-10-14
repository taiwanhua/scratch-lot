// 專案元件(scratch-lot 專屬,不回收底座)。前置:貼上 project/_header.js。
// 建在「Project Draft / 刮刮樂元件」頁(沒有就新建)。
let page = figma.root.children.find(
  (p) => p.name === "Project Draft / 刮刮樂元件",
);
if (!page) {
  page = figma.createPage();
  page.name = "Project Draft / 刮刮樂元件";
}
await figma.setCurrentPageAsync(page);
PROJ_PAGE = page;
const created = {};

// ---------- 1. Draft/ScratchLotSideNav:專案側欄(由底座 NavItem / NavGroup 實例組成)----------
{
  const c = figma.createComponent();
  c.name = "Draft/ScratchLotSideNav";
  c.layoutMode = "VERTICAL";
  c.resize(240, 900);
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "FIXED";
  c.paddingLeft = c.paddingRight = 12;
  c.paddingTop = 16;
  c.paddingBottom = 16;
  c.itemSpacing = 2;
  c.fills = [await paint("bg/paper")];
  c.strokes = [await paint("divider")];
  c.strokeLeftWeight = c.strokeTopWeight = c.strokeBottomWeight = 0;
  c.strokeRightWeight = 1;
  const head = add(
    c,
    al("VERTICAL", {
      name: "brand",
      paddingLeft: 8,
      paddingBottom: 12,
      itemSpacing: 2,
    }),
    "FILL",
  );
  add(head, await txt("好運彩券行", "Subtitle/1", "primary/main", "brandName"));
  add(head, await txt("後台管理", "Caption", "text/secondary"));
  const item = async (label, badge) => {
    const i = await inst("Draft/NavItem", {}, { Label: label, Badge: !!badge });
    i.name = "nav:" + label;
    if (badge) {
      const b = i.findOne(
        (n) =>
          n.type === "INSTANCE" &&
          Object.keys(n.componentProperties).some((k) =>
            k.startsWith("Content"),
          ),
      );
      if (b) await setProps(b, { Content: String(badge) });
    }
    return i;
  };
  const group = async (label, children, expanded = true) => {
    const g = await inst(
      "Draft/NavGroup",
      { State: expanded ? "Expanded" : "Collapsed" },
      { Label: label },
    );
    g.name = "group:" + label;
    add(c, g, "FILL");
    if (expanded && children.length) {
      const box = add(
        c,
        al("VERTICAL", {
          name: "group-children:" + label,
          paddingLeft: 12,
          itemSpacing: 2,
        }),
        "FILL",
      );
      for (const [l, b] of children) add(box, await item(l, b), "FILL");
    }
  };
  add(c, await item("總覽"), "FILL");
  add(c, await item("店面管理"), "FILL");
  add(c, await item("庫存管理"), "FILL");
  await group("叫貨與進貨", [["叫貨、採購單"], ["進貨單"], ["調貨單"]]);
  add(c, await item("帳戶管理", 2), "FILL");
  add(c, await item("輸出報表"), "FILL");
  add(c, await item("經銷商管理", 3), "FILL");
  add(c, await item("檔案管理"), "FILL");
  await group("班表管理", [
    ["我的班表"],
    ["排班作業"],
    ["排班設定"],
    ["出勤紀錄"],
  ]);
  add(c, await item("申請中心", 5), "FILL");
  await group("系統管理", [], false);
  c.description =
    DESC_PROJECT +
    "scratch-lot 後台側欄示意(專案規格 3.1 選單)。由底座 Draft/NavItem、Draft/NavGroup 實例組成;底座 Draft/AdminSideNav 的頂層備用槽只有 2 個,放不下專案的 8 個頂層模組,所以專案畫面先用這個組合元件。選取中的項目用 selectNav() 覆寫底色 primary/lighter + 字色 primary/dark。帳戶管理 = 待結清款項數、經銷商管理 = 逾期與證照到期、申請中心 = 待審數(側欄計數)。";
  page.appendChild(c);
  c.x = 0;
  c.y = 0;
  created.sideNav = c.id;
}

// ---------- 2. Draft/TicketCell + Draft/TicketGrid:張數格子(規格 7.5)----------
{
  const mk = async (state) => {
    const c = figma.createComponent();
    c.name = "State=" + state;
    c.layoutMode = "HORIZONTAL";
    c.primaryAxisAlignItems = "CENTER";
    c.counterAxisAlignItems = "CENTER";
    c.resize(40, 28);
    c.primaryAxisSizingMode = "FIXED";
    c.counterAxisSizingMode = "FIXED";
    await radius(c, "radius/sm");
    const t = await txt("012", "Caption", "text/primary", "no");
    add(c, t);
    if (state === "Available") {
      c.fills = [await paint("bg/paper")];
      c.strokes = [await paint("divider")];
      c.strokeWeight = 1;
    } else if (state === "Selected") {
      c.fills = [await paint("primary/main")];
      t.fills = [await paint("primary/contrast")];
    } else {
      c.fills = [await paint("action/disabledBackground")];
      t.fills = [await paint("text/disabled")];
    }
    return c;
  };
  const vs = [
    await mk("Available"),
    await mk("Selected"),
    await mk("Unavailable"),
  ];
  const set = figma.combineAsVariants(vs, page);
  set.name = "Draft/TicketCell";
  set.layoutMode = "HORIZONTAL";
  set.itemSpacing = 12;
  set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 16;
  const p = set.addComponentProperty("No", "TEXT", "012");
  for (const v of set.children)
    v.findOne((n) => n.name === "no").componentPropertyReferences = {
      characters: p,
    };
  set.description =
    DESC_PROJECT +
    "張數格子的一格(專案規格 7.5)。Available = 可選;Selected = 已選(主色,字用主色的對比色);Unavailable = 不能選(已售、跳號、報廢、被其他單據鎖定),灰底。";
  set.x = 300;
  set.y = 0;
  created.ticketCell = set.id;

  const g = figma.createComponent();
  g.name = "Draft/TicketGrid";
  g.layoutMode = "VERTICAL";
  g.itemSpacing = 12;
  g.paddingLeft = g.paddingRight = g.paddingTop = g.paddingBottom = 16;
  g.fills = [await paint("bg/paper")];
  g.strokes = [await paint("divider")];
  g.strokeWeight = 1;
  await radius(g, "radius/md");
  const hd = add(
    g,
    al("HORIZONTAL", {
      name: "header",
      itemSpacing: 8,
      counterAxisAlignItems: "CENTER",
    }),
    "FILL",
  );
  add(
    hd,
    await txt(
      "5164 發大財 · 本號 056527",
      "Subtitle/2",
      "text/primary",
      "book",
    ),
  );
  add(
    hd,
    await txt("檯面 #000~099,在中山店", "Caption", "text/secondary", "where"),
  );
  const q = add(
    g,
    al("HORIZONTAL", {
      name: "quick",
      itemSpacing: 8,
      counterAxisAlignItems: "CENTER",
    }),
    "FILL",
  );
  add(q, await txt("連號快選 從", "Body/2", "text/secondary"));
  const f1 = add(
    q,
    await inst(
      "TextField",
      { Size: "Small", State: "Default" },
      { Label: "", Value: "012", Helper: "" },
    ),
  );
  f1.resize(88, f1.height);
  add(q, await txt("到", "Body/2", "text/secondary"));
  const f2 = add(
    q,
    await inst(
      "TextField",
      { Size: "Small", State: "Default" },
      { Label: "", Value: "016", Helper: "" },
    ),
  );
  f2.resize(88, f2.height);
  add(
    q,
    await inst(
      "Button",
      {
        Variant: "Outlined",
        Size: "Small",
        State: "Default",
        Color: "Primary",
      },
      { Label: "加入" },
    ),
  );
  const cellSet = await figma.getNodeByIdAsync(created.ticketCell);
  const sel = new Set([12, 13, 14, 15, 16, 20]);
  const off = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 31, 47]);
  const grid = add(g, al("VERTICAL", { name: "grid", itemSpacing: 4 }));
  for (let r = 0; r < 10; r++) {
    const row = add(
      grid,
      al("HORIZONTAL", { name: "row-" + r, itemSpacing: 4 }),
    );
    for (let k = 0; k < 10; k++) {
      const n = r * 10 + k + 1; // 張號從 001 起;
      const state = sel.has(n)
        ? "Selected"
        : off.has(n)
          ? "Unavailable"
          : "Available";
      add(
        row,
        await instOf(
          cellSet,
          { State: state },
          { No: String(n).padStart(3, "0") },
        ),
      );
    }
  }
  add(
    g,
    await txt(
      "已選 #012~016、#020(6 張)· Shift 可連選",
      "Body/2",
      "text/primary",
      "summary",
    ),
  );
  g.description =
    DESC_PROJECT +
    "張數格子(專案規格 7.5):調貨選張、拆本標註跳號、更正跳號、盤點、本的詳情頁、看板展開卡片共用。每列 10 格;灰 = 不能選、已選 = 主色;Shift 連選;連號快選 從 / 到;已選以區段顯示。";
  page.appendChild(g);
  g.x = 300;
  g.y = 120;
  created.ticketGrid = g.id;
}

// ---------- 3. Draft/DenominationCount:面額清點表 ----------
{
  const c = figma.createComponent();
  c.name = "Draft/DenominationCount";
  c.layoutMode = "VERTICAL";
  c.resize(360, 100);
  c.primaryAxisSizingMode = "AUTO";
  c.counterAxisSizingMode = "FIXED";
  c.fills = [];
  const row = async (a, b, d, head, name) => {
    const r = add(
      c,
      al("HORIZONTAL", {
        name: name || "row",
        paddingTop: 6,
        paddingBottom: 6,
        itemSpacing: 12,
        counterAxisAlignItems: "CENTER",
      }),
      "FILL",
    );
    r.strokes = [await paint("divider")];
    r.strokeTopWeight = r.strokeLeftWeight = r.strokeRightWeight = 0;
    r.strokeBottomWeight = 1;
    const st = head ? "Subtitle/2" : "Body/2";
    const col = head ? "text/secondary" : "text/primary";
    const w1 = add(r, al("HORIZONTAL", { name: "denom" }));
    w1.resize(80, 20);
    w1.primaryAxisSizingMode = "FIXED";
    add(w1, await txt(a, st, col));
    const w2 = add(r, al("HORIZONTAL", { name: "count" }));
    w2.resize(120, 20);
    w2.primaryAxisSizingMode = "FIXED";
    if (head || typeof b === "string") add(w2, await txt(b, st, col));
    else add(w2, b, "FILL");
    const w3 = add(
      r,
      al("HORIZONTAL", { name: "subtotal", primaryAxisAlignItems: "MAX" }),
      "FILL",
    );
    add(w3, await txt(d, head ? "Subtitle/2" : "Body/2", col));
    return r;
  };
  await row("面額", "張 / 枚", "小計", true, "thead");
  const data = [
    ["1,000", "8", "8,000"],
    ["500", "3", "1,500"],
    ["100", "21", "2,100"],
    ["50", "6", "300"],
    ["10", "37", "370"],
    ["5", "12", "60"],
    ["1", "20", "20"],
  ];
  for (const [d, n, s] of data) {
    const f = await inst(
      "TextField",
      { Size: "Small", State: "Default" },
      { Label: "", Value: n, Helper: "" },
    );
    await row(d, f, s);
  }
  const tot = await row("實點合計", "", "12,350", true, "total");
  tot.strokes = [];
  c.description =
    DESC_PROJECT +
    "交班結帳 ③ 抽屜、日結 ③ 小金庫的依面額清點表(專案規格 6.9 / 6.10)。實點 = 各面額小計加總;存「各面額張數」。";
  page.appendChild(c);
  c.x = 860;
  c.y = 0;
  created.denom = c.id;
}

// ---------- 4.(已移除)Draft/WizardStep:第二輪升格為底座 Draft/StepperStep(Stepper.js)----------

// ---------- 5. Draft/CashPointHeader:看板的收銀點列 ----------
// Size=Desktop(一列)/ Tablet / Mobile(直排:名稱 → 負責人 → 統計 + [最近售出] [最近兌獎] → 操作按鈕,按鈕會換行);
// State=Open(本機收銀點、自己開的班開班中)/ Closed(未開班)/ Other(其他收銀點、開班中,只顯示狀態);
// BOOLEAN Mine:Other 時那一班是自己開的 → 顯示 [切換到這個收銀點]。[最近售出] [最近兌獎] 只在 Open(專案規格 6.2)。
{
  const btnI = (l, v) =>
    inst(
      "Button",
      { Variant: v, Size: "Small", State: "Default", Color: "Primary" },
      { Label: l },
    );
  const mk = async (state) => {
    const open = state !== "Closed";
    const c = figma.createComponent();
    c.name = "Size=Desktop, State=" + state;
    c.layoutMode = "HORIZONTAL";
    c.resize(1100, 64);
    c.primaryAxisSizingMode = "FIXED";
    c.counterAxisSizingMode = "AUTO";
    c.paddingLeft = c.paddingRight = 16;
    c.paddingTop = c.paddingBottom = 12;
    c.itemSpacing = 16;
    c.counterAxisAlignItems = "CENTER";
    c.fills = [await paint("bg/paper")];
    await radius(c, "radius/md");
    const id = add(c, al("VERTICAL", { name: "id", itemSpacing: 2 }));
    const l1 = add(
      id,
      al("HORIZONTAL", {
        name: "line1",
        itemSpacing: 8,
        counterAxisAlignItems: "CENTER",
      }),
    );
    add(l1, await txt("店內櫃台", "Subtitle/1", "text/primary", "name"));
    if (state !== "Other")
      add(l1, await inst("Draft/Tag", { Tone: "Primary" }, { Label: "本機" }));
    add(
      l1,
      await inst(
        "Draft/Tag",
        { Tone: open ? "Success" : "Grey" },
        { Label: open ? "開班中" : "未開班" },
      ),
    );
    add(
      id,
      await txt(
        open
          ? "負責人 王小明 · 08:02 開班 · 協同 李小華"
          : "上一班 18:05 交班,留在抽屜 3,000",
        "Caption",
        "text/secondary",
        "who",
      ),
    );
    spacer(c);
    let mine = null;
    if (open) {
      const stat = async (k, v) => {
        const s = add(c, al("VERTICAL", { name: "stat", itemSpacing: 0 }));
        add(s, await txt(k, "Caption", "text/secondary"));
        add(s, await txt(v, "Subtitle/1", "text/primary"));
      };
      await stat("本班已售", "42 張 / 8,400");
      if (state === "Open") {
        add(c, await btnI("最近售出", "Text"));
        add(c, await btnI("最近兌獎", "Text"));
      }
      await stat("應有現金", "12,350");
      if (state === "Open")
        for (const [l, v] of [
          ["兌獎", "Outlined"],
          ["投庫", "Outlined"],
          ["出庫", "Outlined"],
          ["拆本", "Outlined"],
          ["交班結帳", "Contained"],
        ])
          add(c, await btnI(l, v));
      else mine = add(c, await btnI("切換到這個收銀點", "Outlined"));
    } else add(c, await btnI("開班", "Contained"));
    return { c, mine };
  };
  // 平板 / 手機:同樣的內容直排,寬度跟著畫面(實例設 FILL)
  const mkN = async (size, state) => {
    const open = state !== "Closed";
    const c = figma.createComponent();
    c.name = `Size=${size}, State=${state}`;
    c.layoutMode = "VERTICAL";
    c.resize(size === "Tablet" ? 926 : 358, 120);
    c.primaryAxisSizingMode = "AUTO";
    c.counterAxisSizingMode = "FIXED";
    c.paddingLeft = c.paddingRight = 14;
    c.paddingTop = c.paddingBottom = 10;
    c.itemSpacing = 8;
    c.fills = [await paint("bg/paper")];
    await radius(c, "radius/md");
    const row = (name, wrap, gap = 8) =>
      add(
        c,
        al("HORIZONTAL", {
          name,
          itemSpacing: gap,
          counterAxisAlignItems: "CENTER",
          layoutWrap: wrap ? "WRAP" : "NO_WRAP",
          counterAxisSpacing: wrap ? 8 : 0,
        }),
        "FILL",
      );
    const l1 = row("line1", true);
    add(
      l1,
      await txt(
        { Open: "店內櫃台", Other: "店外攤位", Closed: "彩券機旁" }[state],
        "Subtitle/1",
        "text/primary",
        "name",
      ),
    );
    if (state === "Open")
      add(l1, await inst("Draft/Tag", { Tone: "Warning" }, { Label: "本機" }));
    add(
      l1,
      await inst(
        "Draft/Tag",
        { Tone: open ? "Success" : "Grey" },
        { Label: open ? "開班中" : "未開班" },
      ),
    );
    add(
      c,
      await txt(
        {
          Open: "負責人 王小明 · 08:02 開班 · 協同 李小華",
          Other: "負責人 王小明 · 13:00 開班",
          Closed: "上一班 18:05 交班,留在抽屜 3,000",
        }[state],
        "Caption",
        "text/secondary",
        "who",
      ),
    );
    if (open) {
      const st = row("stats", false, 16);
      const stat = async (k, v) => {
        const s = add(st, al("VERTICAL", { name: "stat", itemSpacing: 0 }));
        add(s, await txt(k, "Caption", "text/secondary"));
        add(s, await txt(v, "Subtitle/1", "text/primary"));
      };
      await stat(
        "本班已售",
        state === "Open" ? "42 張 / 8,400" : "18 張 / 3,600",
      );
      await stat("應有現金", state === "Open" ? "12,350" : "7,200");
      // 平板:[最近售出] [最近兌獎] 靠右跟統計同一列;手機寬度不夠,另起一列
      if (size === "Tablet") spacer(st);
      if (state === "Open") {
        const rr = size === "Tablet" ? st : row("recent", false);
        add(rr, await btnI("最近售出", "Text"));
        add(rr, await btnI("最近兌獎", "Text"));
      }
    }
    const chips = row("chips", true);
    let mine = null;
    if (state === "Open")
      for (const [l, v] of [
        ["兌獎", "Outlined"],
        ["投庫", "Outlined"],
        ["出庫", "Outlined"],
        ["拆本", "Outlined"],
        ["交班結帳", "Contained"],
      ])
        add(chips, await btnI(l, v));
    else if (state === "Other")
      mine = add(chips, await btnI("切換到這個收銀點", "Outlined"));
    else add(chips, await btnI("開班", "Outlined"));
    return { c, mine };
  };
  const vs = [await mk("Open"), await mk("Closed"), await mk("Other")];
  for (const size of ["Tablet", "Mobile"])
    for (const state of ["Open", "Other", "Closed"])
      vs.push(await mkN(size, state));
  const set = figma.combineAsVariants(
    vs.map((v) => v.c),
    page,
  );
  set.name = "Draft/CashPointHeader";
  set.layoutMode = "VERTICAL";
  set.itemSpacing = 16;
  set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 16;
  const pMine = set.addComponentProperty("Mine", "BOOLEAN", false);
  for (const v of vs)
    if (v.mine) v.mine.componentPropertyReferences = { visible: pMine };
  set.description =
    DESC_PROJECT +
    "店面管理看板上每個收銀點的標題列(專案規格 6.1 / 6.2 / 6.6 / 6.7 / 6.9)。Open = 本機收銀點、自己開的班:負責人、協同(來自排班)、本班已售、[最近售出] [最近兌獎]、應有現金、[兌獎] [投庫] [出庫] [拆本] [交班結帳];Closed:上一班留在抽屜的金額、[開班];Other = 其他收銀點開班中:只顯示狀態,Mine = 那一班是自己開的 → [切換到這個收銀點]([最近售出] [最近兌獎] 要切換過去才有)。Size = 電腦 / 平板 / 手機,三種尺寸的按鈕一樣(平板 / 手機直排、按鈕換行)。";
  set.x = 0;
  set.y = 1000;
  created.cashPointHeader = set.id;
}

// ---------- 6. Draft/BoardBookCard:看板上的一本(某本 × 某收銀點的檯面)----------
{
  const mk = async (state) => {
    const c = figma.createComponent();
    c.name = "State=" + state;
    c.layoutMode = "HORIZONTAL";
    c.resize(260, 100);
    c.primaryAxisSizingMode = "FIXED";
    c.counterAxisSizingMode = "AUTO";
    c.itemSpacing = 0;
    c.fills = [await paint("bg/paper")];
    c.strokes = [await paint("divider")];
    c.strokeWeight = 1;
    c.clipsContent = true;
    await radius(c, "radius/md");
    const strip = add(c, figma.createFrame(), null, "FILL");
    strip.name = "game-color";
    strip.resize(6, 100);
    strip.layoutSizingVertical = "FILL";
    strip.fills = [await paint("info/main")];
    const b = add(
      c,
      al("VERTICAL", {
        name: "body",
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 10,
        paddingBottom: 10,
        itemSpacing: 6,
      }),
      "FILL",
    );
    const t = add(
      b,
      al("HORIZONTAL", {
        name: "title",
        itemSpacing: 6,
        counterAxisAlignItems: "CENTER",
      }),
      "FILL",
    );
    add(t, await txt("5164 發大財", "Subtitle/2", "text/primary", "game"));
    spacer(t);
    add(t, await txt("200 元", "Caption", "text/secondary", "price"));
    add(
      b,
      await txt(
        "本號 056527 · 今日售出 12",
        "Caption",
        "text/secondary",
        "meta",
      ),
    );
    const bar = add(b, figma.createFrame(), "FILL");
    bar.name = "progress";
    bar.resize(236, 6);
    bar.cornerRadius = 3;
    bar.fills = [await paint("grey/300")];
    const fill = figma.createRectangle();
    bar.appendChild(fill);
    const ratio = state === "LowStock" ? 0.06 : 0.35;
    fill.resize(Math.round(236 * ratio), 6);
    fill.cornerRadius = 3;
    fill.fills = [
      await paint(state === "LowStock" ? "error/main" : "primary/main"),
    ];
    const r = add(
      b,
      al("HORIZONTAL", {
        name: "foot",
        itemSpacing: 6,
        counterAxisAlignItems: "CENTER",
      }),
      "FILL",
    );
    add(
      r,
      await txt(
        state === "LowStock" ? "剩 6 / 100" : "剩 35 / 100",
        "Body/2",
        "text/primary",
        "left",
      ),
    );
    spacer(r);
    if (state === "LowStock")
      add(r, await inst("Draft/Tag", { Tone: "Error" }, { Label: "剩很少" }));
    return c;
  };
  const set = figma.combineAsVariants(
    [await mk("Normal"), await mk("LowStock")],
    page,
  );
  set.name = "Draft/BoardBookCard";
  set.layoutMode = "HORIZONTAL";
  set.itemSpacing = 16;
  set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 16;
  set.description =
    DESC_PROJECT +
    "店面管理看板的卡片 = 某本 × 某收銀點的檯面(專案規格 6.2):遊戲名稱(左側色條 = 遊戲顏色,欄位管理 tagPalettes)、面額、本號、剩餘 / 總張數、今日售出;LowStock = 剩很少。點卡片在原位置往下展開張數格子(電腦 / 平板占滿整列;手機用底部面板),一次只展開一張;展開中的卡片用主色框。";
  set.x = 0;
  set.y = 1400;
  created.bookCard = set.id;
}
// ---------- 收尾:set / 格子的大小改為 hug,清點表欄位垂直置中,重新排位置 ----------
for (const id of [
  created.ticketCell,
  created.wizardStep,
  created.cashPointHeader,
  created.bookCard,
  created.ticketGrid,
]) {
  const n = await figma.getNodeByIdAsync(id);
  n.primaryAxisSizingMode = "AUTO";
  n.counterAxisSizingMode = "AUTO";
}
{
  const d = await figma.getNodeByIdAsync(created.denom);
  for (const f of d.findAll(
    (n) =>
      n.type === "FRAME" && ["count", "denom", "subtotal"].includes(n.name),
  )) {
    f.counterAxisSizingMode = "AUTO";
    f.counterAxisAlignItems = "CENTER";
  }
}
// ---------- 7. TicketCell 的其他狀態 + Draft/TicketGridLegend(共用圖例,規格 7.5)----------
// 狀態變體:Shift 本班售出、Skipped 跳號、Scrapped 報廢、Lost 待查 / 遺失、Assigned 已分配、Other 在別的收銀點。
// 圖例的色塊直接用這些變體,格子改色圖例跟著變;每個狀態一個 BOOLEAN 開關 + 一個 TEXT(文字可覆寫)。
{
  const set = await figma.getNodeByIdAsync(created.ticketCell);
  const V = (n) => set.children.find((v) => v.name === "State=" + n);
  const mk = async (name, base, fn) => {
    const old = V(name);
    if (old) old.remove();
    const v = V(base).clone();
    set.appendChild(v);
    v.name = "State=" + name;
    await fn(
      v,
      v.findOne((n) => n.type === "TEXT"),
    );
  };
  await mk("Shift", "Unavailable", async (v) => {
    v.strokes = [await paint("primary/main")];
    v.strokeWeight = 2;
  });
  await mk("Skipped", "Unavailable", async (v) => {
    v.strokes = [await paint("error/main")];
    v.strokeWeight = 2;
    v.dashPattern = [4, 3];
  });
  await mk("Scrapped", "Unavailable", async (v) => {
    v.strokes = [await paint("error/main")];
    v.strokeWeight = 1.5;
  });
  await mk("Lost", "Unavailable", async (v) => {
    v.strokes = [await paint("warning/main")];
    v.strokeWeight = 2;
  });
  await mk("Assigned", "Available", async (v, t) => {
    v.fills = [await paint("primary/lighter")];
    v.strokes = [];
    t.fills = [await paint("text/secondary")];
  });
  // 在別的收銀點:淺灰底 + 細斜線底紋、次要文字色虛線框、號碼字色比未售淡
  await mk("Other", "Available", async (v, t) => {
    v.fills = [await paint("bg/default")];
    v.strokes = [await paint("text/secondary")];
    v.strokeWeight = 1;
    v.dashPattern = [3, 2];
    t.fills = [await paint("text/secondary")];
    v.clipsContent = true;
    for (let i = 0; i < 4; i++) {
      const l = figma.createRectangle();
      l.name = "hatch";
      l.resize(1, 80);
      l.fills = [await paint("divider")];
      v.appendChild(l);
      l.layoutPositioning = "ABSOLUTE";
      l.rotation = 45;
      l.x = -10 + i * 14;
      l.y = 0;
      v.insertChild(0, l);
    }
  });
  let x = 16;
  for (const v of set.children) {
    v.x = x;
    v.y = 16;
    x += v.width + 12;
  }
  set.resizeWithoutConstraints(x + 4, 60);
  set.description =
    DESC_PROJECT +
    "張數格子的一格(專案規格 7.5)。Available = 未售 / 未分配;Selected = 已選;Unavailable = 已售或不能選;Shift = 本班售出(可選來撤銷);Other = 在別的收銀點(淺灰底 + 斜線、次要文字色虛線框,不能選,tooltip 顯示收銀點);Assigned = 已分配到某個收銀點(拆本分放);Skipped = 跳號;Scrapped = 報廢;Lost = 待查 / 遺失。";

  const lg = figma.createComponent();
  lg.name = "Draft/TicketGridLegend";
  page.appendChild(lg);
  lg.layoutMode = "HORIZONTAL";
  lg.layoutWrap = "WRAP";
  lg.itemSpacing = 12;
  lg.counterAxisSpacing = 6;
  lg.primaryAxisAlignItems = "MAX";
  lg.counterAxisAlignItems = "CENTER";
  lg.resize(436, 20);
  lg.primaryAxisSizingMode = "FIXED";
  lg.counterAxisSizingMode = "AUTO";
  lg.fills = [];
  for (const [label, state, on] of [
    ["未售", "Available", true],
    ["未分配", "Available", false],
    ["已售", "Unavailable", true],
    ["本班售出", "Shift", false],
    ["在別的收銀點", "Other", false],
    ["已分配", "Assigned", false],
    ["跳號", "Skipped", false],
    ["報廢", "Scrapped", false],
    ["待查·遺失", "Lost", false],
    ["已選", "Selected", true],
  ]) {
    const it = add(
      lg,
      al("HORIZONTAL", {
        name: "item:" + label,
        itemSpacing: 6,
        counterAxisAlignItems: "CENTER",
      }),
    );
    const sw = V(state).createInstance();
    sw.name = "swatch";
    await setText(sw, "no", "");
    sw.resize(16, 16);
    for (const k of [
      "topLeftRadius",
      "topRightRadius",
      "bottomLeftRadius",
      "bottomRightRadius",
    ])
      sw[k] = 3;
    add(it, sw);
    const t = add(it, await txt(label, "Caption", "text/secondary", "label"));
    it.componentPropertyReferences = {
      visible: lg.addComponentProperty(label, "BOOLEAN", on),
    };
    t.componentPropertyReferences = {
      characters: lg.addComponentProperty(label + " 文字", "TEXT", label),
    };
  }
  lg.description =
    DESC_PROJECT +
    "張數格子的共用圖例(專案規格 7.5)。放在格子正上方靠右,寬度跟格子一樣,窄螢幕自動換行。每個狀態一個開關,只打開畫面用得到的;色塊是 Draft/TicketCell 的變體本身,格子改色圖例跟著變。文字可覆寫(例:盤點把「已選」改成「在(已點)」)。";
  created.legend = lg.id;
  // TicketGrid 也放圖例(格子正上方)
  const tg = await figma.getNodeByIdAsync(created.ticketGrid);
  const li = lg.createInstance();
  li.name = "legend(TicketGridLegend)";
  tg.insertChild(
    tg.children.findIndex((n) => n.name === "grid"),
    li,
  );
  li.layoutSizingHorizontal = "FILL";
}

// ---------- 9. Draft/StoreTopBar:店面管理看板頂部列 ----------
// 分店(電腦)、本機收銀點、你開著的班、即時(電腦)、上次日結、[盤點] [存銀行] [日結]。
// Size=Desktop(一列)/ Tablet / Mobile(卡片直排,三個按鈕均分);BOOLEAN MyShifts:這台裝置有自己開著的班才顯示「你開著的班:…」。
{
  const btnI = (l, v, sz) =>
    inst(
      "Button",
      { Variant: v, Size: sz, State: "Default", Color: "Primary" },
      { Label: l },
    );
  const sel = async () => {
    const s = await inst("Draft/SelectField", { State: "Default" });
    await setText(s, "label", "本機收銀點");
    await setText(s, "value", "店內櫃台");
    return s;
  };
  const vs = [];
  {
    const c = figma.createComponent();
    c.name = "Size=Desktop";
    c.layoutMode = "HORIZONTAL";
    c.resize(1100, 56);
    c.primaryAxisSizingMode = "FIXED";
    c.counterAxisSizingMode = "AUTO";
    c.itemSpacing = 12;
    c.counterAxisAlignItems = "CENTER";
    c.fills = [];
    add(
      c,
      await binst("Draft/OrgTreeSelect", { State: "Closed", Mode: "Single" }),
    );
    add(c, await sel());
    const shift = add(
      c,
      await txt("你開著的班:店內櫃台 · 店外攤位", "Body/2", "primary/dark"),
    );
    const rt = add(
      c,
      al("HORIZONTAL", {
        name: "realtime",
        itemSpacing: 6,
        counterAxisAlignItems: "CENTER",
      }),
    );
    const dot = figma.createEllipse();
    dot.resize(8, 8);
    dot.fills = [await paint("success/main")];
    add(rt, dot);
    add(rt, await txt("即時", "Caption", "text/secondary"));
    spacer(c);
    add(c, await txt("上次日結:10/13(已 3 天)", "Body/2", "warning/main"));
    add(c, await btnI("盤點", "Outlined", "Medium"));
    add(c, await btnI("存銀行", "Outlined", "Medium"));
    add(c, await btnI("日結", "Contained", "Medium"));
    vs.push({ c, shift });
  }
  for (const [size, w] of [
    ["Tablet", 926],
    ["Mobile", 358],
  ]) {
    const c = figma.createComponent();
    c.name = "Size=" + size;
    c.layoutMode = "VERTICAL";
    c.resize(w, 120);
    c.primaryAxisSizingMode = "AUTO";
    c.counterAxisSizingMode = "FIXED";
    c.paddingLeft = c.paddingRight = 12;
    c.paddingTop = c.paddingBottom = 8;
    c.itemSpacing = 8;
    c.fills = [await paint("bg/paper")];
    await radius(c, "radius/md");
    const row = () =>
      add(
        c,
        al("HORIZONTAL", { itemSpacing: 8, counterAxisAlignItems: "CENTER" }),
        "FILL",
      );
    add(row(), await sel(), "FILL");
    const r2 = row();
    const shift = add(
      r2,
      await txt("你開著的班:店內櫃台 · 店外攤位", "Caption", "primary/dark"),
    );
    add(r2, await txt("上次日結:10/13(已 3 天)", "Caption", "warning/main"));
    const r3 = row();
    add(r3, await btnI("盤點", "Outlined", "Small"), "FILL");
    add(r3, await btnI("存銀行", "Outlined", "Small"), "FILL");
    add(r3, await btnI("日結", "Contained", "Small"), "FILL");
    vs.push({ c, shift });
  }
  const set = figma.combineAsVariants(
    vs.map((v) => v.c),
    page,
  );
  set.name = "Draft/StoreTopBar";
  set.layoutMode = "HORIZONTAL";
  set.itemSpacing = 40;
  set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 24;
  const pMy = set.addComponentProperty("MyShifts", "BOOLEAN", true);
  for (const v of vs) v.shift.componentPropertyReferences = { visible: pMy };
  set.description =
    DESC_PROJECT +
    "店面管理看板頂部列(專案規格 6.1 / 6.2)。三種尺寸按鈕一樣;MyShifts = 這台裝置有自己開著的班。";
  created.storeTopBar = set.id;
}

// ---------- 10. Draft/ScratchLotNavRail:平板的收合側欄(電腦用 ScratchLotSideNav,手機收進 app-bar 的 ☰)----------
{
  const c = figma.createComponent();
  c.name = "Draft/ScratchLotNavRail";
  c.layoutMode = "VERTICAL";
  c.resize(66, 768);
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "AUTO";
  c.paddingLeft = c.paddingRight = 12;
  c.paddingTop = 16;
  c.itemSpacing = 4;
  c.fills = [await paint("bg/paper")];
  c.strokes = [await paint("divider")];
  c.strokeLeftWeight = c.strokeTopWeight = c.strokeBottomWeight = 0;
  c.strokeRightWeight = 1;
  for (const g of ["≡", "◧", "▤", "⇄", "$", "▦", "☰"]) {
    const it = add(
      c,
      al("HORIZONTAL", {
        name: "rail-item",
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 10,
        paddingBottom: 10,
        counterAxisAlignItems: "CENTER",
      }),
    );
    add(it, await txt(g, "Subtitle/1", "text/secondary"));
  }
  c.description =
    DESC_PROJECT + "平板(1024)的收合側欄:只有圖示。實例在畫面殼裡設高度 FILL。";
  created.navRail = c.id;
}

// 版面:側欄在左,其他元件在右邊直向排列(間距 120),避免變體增加後互相重疊
{
  const side = await figma.getNodeByIdAsync(created.sideNav || "");
  const order = [
    created.ticketCell,
    created.ticketGrid,
    created.legend,
    created.denom,
    created.cashPointHeader,
    created.bookCard,
    created.storeTopBar,
    created.navRail,
  ];
  let x = side ? side.x + side.width + 160 : 600,
    y = 0;
  for (const id of order) {
    const n = id && (await figma.getNodeByIdAsync(id));
    if (!n) continue;
    n.x = x;
    n.y = y;
    y += n.height + 120;
  }
}
return created;
