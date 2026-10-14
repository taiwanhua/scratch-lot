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

// ---------- 4. Draft/WizardStep:精靈步驟(交班 / 日結共用)----------
// 第二輪已升格為底座 Draft/StepperStep(Stepper.js),本段只留作紀錄,不要再執行;專案草稿已刪除。
{
  const mk = async (state) => {
    const c = figma.createComponent();
    c.name = "State=" + state;
    c.layoutMode = "HORIZONTAL";
    c.itemSpacing = 8;
    c.counterAxisAlignItems = "CENTER";
    c.primaryAxisSizingMode = "AUTO";
    c.counterAxisSizingMode = "AUTO";
    c.fills = [];
    const dot = add(
      c,
      al("HORIZONTAL", {
        name: "index",
        primaryAxisAlignItems: "CENTER",
        counterAxisAlignItems: "CENTER",
      }),
    );
    dot.resize(24, 24);
    dot.primaryAxisSizingMode = "FIXED";
    dot.counterAxisSizingMode = "FIXED";
    dot.cornerRadius = 12;
    const n = add(
      dot,
      await txt("1", "Caption/SemiBold", "primary/contrast", "n"),
    );
    const l = add(c, await txt("盤點", "Subtitle/2", "text/primary", "label"));
    if (state === "Done") dot.fills = [await paint("success/main")];
    else if (state === "Current") dot.fills = [await paint("primary/main")];
    else {
      dot.fills = [await paint("action/disabledBackground")];
      n.fills = [await paint("text/secondary")];
      l.fills = [await paint("text/secondary")];
    }
    return c;
  };
  const set = figma.combineAsVariants(
    [await mk("Done"), await mk("Current"), await mk("Todo")],
    page,
  );
  set.name = "Draft/WizardStep";
  set.layoutMode = "HORIZONTAL";
  set.itemSpacing = 24;
  set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 16;
  const pi = set.addComponentProperty("Index", "TEXT", "1");
  const pl = set.addComponentProperty("Label", "TEXT", "盤點");
  for (const v of set.children) {
    v.findOne((n) => n.name === "n").componentPropertyReferences = {
      characters: pi,
    };
    v.findOne((n) => n.name === "label").componentPropertyReferences = {
      characters: pl,
    };
  }
  set.description =
    DESC_PROJECT +
    "結帳精靈的步驟指示(交班 4 步、日結 5 步)。Done = 已完成(success)、Current = 目前、Todo = 未到。⚠ 這是通用元件,底座目前沒有 Stepper;若其他專案也需要,下一輪考慮升級為底座元件。";
  set.x = 860;
  set.y = 520;
  created.wizardStep = set.id;
}

// ---------- 5. Draft/CashPointHeader:看板的收銀點列 ----------
// State=Open(本機收銀點、開班中)/ Closed(未開班)/ Other(其他收銀點、開班中,只顯示狀態);
// BOOLEAN Mine:Other 時那一班是自己開的 → 顯示 [切換到這個收銀點]。
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
    c.name = "State=" + state;
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
      await stat("本班售出", "42 張 / 8,400");
      if (state === "Open") add(c, await btnI("最近售出", "Text"));
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
  const vs = [await mk("Open"), await mk("Closed"), await mk("Other")];
  const set = figma.combineAsVariants(
    vs.map((v) => v.c),
    page,
  );
  set.name = "Draft/CashPointHeader";
  set.layoutMode = "VERTICAL";
  set.itemSpacing = 16;
  set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 16;
  const pMine = set.addComponentProperty("Mine", "BOOLEAN", false);
  vs[2].mine.componentPropertyReferences = { visible: pMine };
  set.description =
    DESC_PROJECT +
    "店面管理看板上每個收銀點的標題列(專案規格 6.1 / 6.2 / 6.6 / 6.7 / 6.9)。Open = 本機收銀點開班中:負責人、協同(來自排班)、本班售出、[最近售出]、應有現金、[兌獎] [投庫] [出庫] [拆本] [交班結帳];Closed:上一班留在抽屜的金額、[開班];Other = 其他收銀點開班中:只顯示狀態,Mine = 那一班是自己開的 → [切換到這個收銀點]。";
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
return created;
