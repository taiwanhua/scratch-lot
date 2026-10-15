// 三尺寸同步檢查(scratch-lot Screens,一次跑全部專案頁;不改任何節點)。用法:整段貼進 use_figma 執行。
// 1. 標題列按鈕一致(syncDiffs):同一個畫面編號(例 ST-38,含 a / b / c)在「電腦 1440 / 平板 1024 / 手機 390」三個 Section 中,
//    標題列 / 頂部列的按鈕文字集合要一樣,差異要是 0。
//    標題列 = CashPointHeader / StoreTopBar 實例,以及名稱是 store-top、toolbar、title、doc-head 的框,平板 / 手機再加 ScratchLotAppBar
//    (Kind=Dialog 是全螢幕對話框,它的按鈕是對話框按鈕,不算)。按鈕 = 有文字的實例(Tag、欄位、格子等不算);
//    手機收進「更多」選單的,選單裡的文字也算有。該編號只有一個尺寸有畫的不比。
//    版面本來就不同的列在 EXEMPT(要寫理由,回報時照列)。
// 2. 共用區塊非元件數(sharedHandDrawn):三尺寸都出現的共用區塊,只要在任何尺寸是手畫框而不是元件實例就列出來,數量要是 0。
//    收銀點標題列(cash-point*)→ Draft/CashPointHeader;看板頂部列(店面管理的 store-top / toolbar)→ Draft/StoreTopBar;
//    平板側欄(nav-rail*)→ Draft/ScratchLotNavRail;平板 / 手機最上面的標題列(app-bar)→ Draft/ScratchLotAppBar;電腦側欄(side-nav*)→ Draft/ScratchLotSideNav;
//    看板卡片(cards 裡的框)→ Draft/BoardBookCard;張數格子(grid+legend / ticket-grid)要由 Draft/TicketCell 組成、圖例用 Draft/TicketGridLegend;
//    Stepper(Stepper / stepper / steps)要由 Draft/StepperStep 組成。由元件實例組成的容器(格子、Stepper、PageTabs)算元件化。
// 3. 寬度不符(sectionMismatch):每張畫面 = 一個視窗尺寸。尺寸 Section 裡每張畫面的寬度要等於該 Section 的寬度(電腦 1440 / 平板 1024 / 手機 390),
//    名稱含「 · 平板 / · 手機」的要在對應 Section。多個對話框並排、精靈步驟並排的都算不符。58mm 單據 Section 不檢查。數量要是 0。
// 4. 篩選抽屜(filterDrawerMissing):平板 / 手機畫面有 [篩選…] 按鈕,就要有同編號的篩選抽屜畫面(名稱含「篩選」),
//    或它的框外註解寫明照 RW-01。數量要是 0。
// 5. 遮罩畫面要有頁面背景(overlayNoPage):有遮罩(半透明黑底或 scrim)的畫面,除了對話框 / 抽屜 / 底部面板外,
//    要放打開它的那個頁面(子節點「背景:<入口畫面>」或畫面本身的 main / 側欄)。全部專案頁 + Base Draft 都查,數量要是 0。
//    背景頁裡的標題列不算進第 1 項的按鈕比對。
// 6. 遮罩 / 全螢幕對話框蓋滿畫面(overlayNotCovering):有「背景:…」或 scrim 的畫面,直屬子節點裡的
//    scrim、full-dialog(或名稱含「全螢幕」)、背景:… 要從頂到底、左到右蓋滿畫面框;drawer(或含「抽屜」)要從頂到底;
//    bottom-sheet(或含「底部面板」)要貼齊畫面底部(容許 1px)。背景變高之後遮罩沒跟著撐滿、底下露出背景內容就算。數量要是 0。
figma.skipInvisibleInstanceChildren = false;
const PAGES = [
  "65:14",
  "91:14",
  "69:14",
  "70:14",
  "93:14",
  "94:14",
  "95:14",
  "97:14",
];
const SIZE = { "電腦 1440": "D", "平板 1024": "T", "手機 390": "M" };
// 手機收進選單的按鈕:[選單按鈕, 收起來的按鈕](已發布時 [⋯] 只有套用範本)
const MERGED = [
  ["+ 新增 ▾", ["+ 人力需求", "+ 新增排班"]],
  ["⋯", ["套用範本", "自動排班"]],
];
// SC-46 結構不同:電腦 / 平板是整頁(工具列在畫面裡)加日期浮層;手機是 SC-45 當背景加底部月曆,工具列在背景裡(背景不計),所以手機看起來「缺」工具列按鈕
const SC46_WHY =
  "電腦 / 平板是整頁加日期浮層;手機是 SC-45 背景加底部月曆,工具列在背景裡不計(結構不同)";
const EXEMPT = {
  "ST-40|篩選(1)|D":
    "電腦把篩選條件攤在列表上方(篩選列);平板 / 手機照 RW-01 收成 [篩選] 按鈕 + 抽屜",
  "ST-36|開班|M":
    "手機的卡片展開是底部面板,蓋住下面其他收銀點的標題列(電腦 / 平板原地展開,看得到)",
  "PU-10|列印調貨出貨單|T":
    "平板 / 手機只畫第二關(PU-10b);第一關出貨確認(PU-10a,[列印調貨出貨單] 在那一張)照共用規則不另畫",
  "PU-10|列印調貨出貨單|M":
    "平板 / 手機只畫第二關(PU-10b);第一關出貨確認(PU-10a,[列印調貨出貨單] 在那一張)照共用規則不另畫",
  "SC-46|+ 人力需求|M": SC46_WHY,
  "SC-46|+ 新增排班|M": SC46_WHY,
  "SC-46|套用範本|M": SC46_WHY,
  "SC-46|自動排班|M": SC46_WHY,
  "SC-46|發布|M": SC46_WHY,
  "SC-46|月|M": SC46_WHY,
  "SC-46|週|M": SC46_WHY,
  "SC-46|日|M": SC46_WHY,
  "SC-46|班表|M": SC46_WHY,
  "SC-46|限制 1 · 提醒 12|M": SC46_WHY,
  "SC-46|+ 新增 ▾|M": SC46_WHY,
  "SC-46|⋯|M": SC46_WHY,
};
const NONBTN =
  /Tag|Badge|Select|TextField|Radio|Checkbox|Alert|Ticket|Legend|Stepper|Avatar|Icon|OrgTree|Switch|Tab$|Draft\/Tab|SideNav|NavRail|AppBar|BookCard|TableCell/;
const isBtn = (n) =>
  n.type === "INSTANCE" &&
  n.visible &&
  !NONBTN.test(n.name) &&
  !!n.findOne((x) => x.type === "TEXT" && x.characters.trim());
const label = (b) =>
  b.findOne((x) => x.type === "TEXT" && x.characters.trim()).characters.trim();
const inInstance = (n) => {
  for (let a = n.parent; a; a = a.parent)
    if (a.type === "INSTANCE") return true;
  return false;
};
// 元件內部的列(例:月曆自己的「今天」列)不算頁面標題列
const isHead = (n, sz) =>
  (n.type === "INSTANCE" && /CashPointHeader|StoreTopBar/.test(n.name)) ||
  (sz !== "D" &&
    n.type === "INSTANCE" &&
    /ScratchLotAppBar/.test(n.name) &&
    n.componentProperties.Kind.value !== "Dialog") ||
  (n.type === "FRAME" &&
    !inInstance(n) &&
    /^(store-top|toolbar|title|doc-head)$/.test(n.name));
const sectionMismatch = [],
  filterDrawerMissing = [];
const W = { "電腦 1440": 1440, "平板 1024": 1024, "手機 390": 390 };
const overlayNoPage = [];
const inBg = (n) => {
  for (let a = n.parent; a; a = a.parent)
    if (a.name && a.name.startsWith("背景:")) return true;
  return false;
};
const isMask = (f) =>
  Array.isArray(f.fills) &&
  f.fills.some(
    (p) =>
      p.type === "SOLID" &&
      p.visible !== false &&
      (p.opacity ?? 1) < 0.9 &&
      p.color.r < 0.2,
  );
const checkOverlay = (pageName, f) => {
  if (f.type !== "FRAME") return;
  const scrim = f.children.some((k) => k.name === "scrim");
  if (!isMask(f) && !scrim) return;
  const page = f.children.some(
    (k) =>
      k.name.startsWith("背景:") ||
      k.name === "main" ||
      /SideNav|NavRail/.test(k.name),
  );
  if (!page) overlayNoPage.push(`${pageName} ${f.name}`);
};
const overlayNotCovering = [];
const checkCover = (pageName, f) => {
  if (f.type !== "FRAME" || !f.visible) return;
  if (!f.children.some((k) => k.name.startsWith("背景:") || k.name === "scrim"))
    return;
  for (const c of f.children) {
    if (!c.visible) continue;
    const sheet = /bottom-sheet|底部面板/.test(c.name);
    const drawer = /^drawer|抽屜/.test(c.name);
    const full =
      !sheet &&
      !drawer &&
      (c.name === "scrim" ||
        /^full-dialog|全螢幕/.test(c.name) ||
        c.name.startsWith("背景:"));
    if (!sheet && !drawer && !full) continue;
    const bottom = c.y + c.height >= f.height - 1;
    const ok = sheet
      ? bottom
      : c.y <= 1 &&
        bottom &&
        (drawer || (c.x <= 1 && c.x + c.width >= f.width - 1));
    if (!ok)
      overlayNotCovering.push(
        `${pageName} ${f.name}:${c.name}(y ${Math.round(c.y)} 高 ${Math.round(c.height)} / 畫面高 ${Math.round(f.height)})`,
      );
  }
};
const syncDiffs = [],
  exempted = [],
  sharedHandDrawn = [];
const counts = {};
for (const pid of PAGES) {
  const page = await figma.getNodeByIdAsync(pid);
  await page.loadAsync();
  const groups = {};
  for (const s of page.children.filter(
    (n) => n.type === "SECTION" && SIZE[n.name],
  ))
    for (const f of s.children) {
      if (!("findAll" in f)) continue;
      const m = /^([A-Z]{2}-\d\d)/.exec(f.name);
      if (!m) continue;
      const sz = SIZE[s.name];
      const g =
        groups[m[1]] ||
        (groups[m[1]] = { D: new Set(), T: new Set(), M: new Set(), has: {} });
      g.has[sz] = true;
      const heads = f
        .findAll((h) => isHead(h, sz))
        .filter((h) => {
          if (inBg(h)) return false;
          for (let a = h.parent; a && a !== f; a = a.parent)
            if (isHead(a, sz)) return false;
          return true;
        });
      for (const h of heads)
        for (const b of h.findAll(isBtn)) g[sz].add(label(b));
    }
  for (const [k, g] of Object.entries(groups)) {
    // 手機把幾顆按鈕收進一個選單(班表的 [+ 新增 ▾]、[⋯]):選單和它收起來的按鈕視為同一組
    const wide = new Set([...g.D, ...g.T]);
    for (const [menu, items] of MERGED) {
      if (g.M.has(menu)) for (const it of items) if (wide.has(it)) g.M.add(it);
      for (const x of ["D", "T"])
        if (items.some((it) => g[x].has(it))) g[x].add(menu);
    }
    const sizes = ["D", "T", "M"].filter((x) => g.has[x]);
    if (sizes.length < 2) continue;
    const all = new Set(sizes.flatMap((x) => [...g[x]]));
    for (const l of all)
      for (const x of sizes.filter((x) => !g[x].has(l))) {
        const key = `${k}|${l}|${x}`;
        if (EXEMPT[key]) exempted.push(key + ":" + EXEMPT[key]);
        else syncDiffs.push(`${page.name.slice(9)} ${k}「${l}」缺 ${x}`);
      }
  }
  // 共用區塊非元件
  const topOf = (n) => {
    let f = n;
    while (f.parent && f.parent.type !== "SECTION") f = f.parent;
    return f;
  };
  const hit = (n, why) =>
    sharedHandDrawn.push(
      `${page.name.slice(9)} ${topOf(n).name.slice(0, 24)}:${n.name}(${why})`,
    );
  for (const n of page.findAll((x) => x.type === "FRAME" && !inInstance(x))) {
    if (/^cash-point(:|$)/.test(n.name)) hit(n, "要用 CashPointHeader");
    else if (pid === "65:14" && /^(store-top|toolbar)$/.test(n.name))
      hit(n, "要用 StoreTopBar");
    else if (/^nav-rail/.test(n.name)) hit(n, "要用 ScratchLotNavRail");
    else if (n.name === "app-bar") hit(n, "要用 ScratchLotAppBar");
    else if (/^side-?nav/i.test(n.name)) hit(n, "要用 ScratchLotSideNav");
    else if (n.name === "cards") {
      for (const c of n.children)
        if (c.type !== "INSTANCE") hit(c, "看板卡片要用 BoardBookCard");
    } else if (/^(grid\+legend|ticket-grid)$/.test(n.name)) {
      if (!n.findOne((x) => x.type === "INSTANCE" && /TicketCell/.test(x.name)))
        hit(n, "格子要用 TicketCell");
      if (
        n.name === "grid+legend" &&
        !n.findOne(
          (x) => x.type === "INSTANCE" && /TicketGridLegend/.test(x.name),
        )
      )
        hit(n, "圖例要用 TicketGridLegend");
    } else if (/^(Stepper|stepper|steps)$/.test(n.name)) {
      if (
        !n.findOne((x) => x.type === "INSTANCE" && /StepperStep/.test(x.name))
      )
        hit(n, "要用 StepperStep");
    }
  }
  // 放錯尺寸 / 篩選抽屜
  for (const s of page.children.filter(
    (n) => n.type === "SECTION" && W[n.name],
  ))
    for (const f of s.children) {
      if (f.type === "TEXT") continue;
      checkOverlay(page.name.slice(9), f);
      checkCover(page.name.slice(9), f);
      const tag = / · 平板/.test(f.name)
        ? "平板 1024"
        : / · 手機/.test(f.name)
          ? "手機 390"
          : null;
      const w = Math.round(f.width);
      if ((tag && tag !== s.name) || Math.abs(w - W[s.name]) > 2)
        sectionMismatch.push(`${page.name.slice(9)} ${s.name}:${f.name} w${w}`);
      if (s.name === "電腦 1440" || !("findAll" in f) || /篩選/.test(f.name))
        continue; // 抽屜畫面本身不算
      const hasFilter = f.findOne(
        (b) =>
          b.type === "INSTANCE" &&
          b.visible &&
          !inBg(b) &&
          !!b.findOne((t) => t.type === "TEXT" && /^篩選/.test(t.characters)),
      );
      if (!hasFilter) continue;
      const code = (/^([A-Z]{2}-\d\d)/.exec(f.name) || [])[1];
      const drawer = s.children.some(
        (x) =>
          x !== f &&
          x.type !== "TEXT" &&
          x.name.startsWith(code) &&
          /篩選/.test(x.name),
      );
      const cap = s.children.find(
        (x) => x.type === "TEXT" && x.name === f.name + " · 註解",
      );
      if (!drawer && !(cap && /RW-01/.test(cap.characters)))
        filterDrawerMissing.push(`${page.name.slice(9)} ${f.name}`);
    }
  counts[page.name.slice(9)] = Object.keys(groups).length;
}
{
  const base = await figma.getNodeByIdAsync("41:5914"); // Base Draft / 本輪底座元件(沒有尺寸 Section)
  await base.loadAsync();
  for (const f of base.children) {
    checkOverlay("Base Draft", f);
    checkCover("Base Draft", f);
  }
}
return {
  overlayNoPage: overlayNoPage.length,
  overlayNotCovering: overlayNotCovering.length,
  overlayNotCoveringList: overlayNotCovering.slice(0, 20),
  overlayList: overlayNoPage,
  syncDiffs: syncDiffs.length,
  sharedHandDrawn: sharedHandDrawn.length,
  sectionMismatch: sectionMismatch.length,
  filterDrawerMissing: filterDrawerMissing.length,
  exempted,
  groupsPerPage: counts,
  syncList: syncDiffs,
  sharedList: sharedHandDrawn,
  sectionList: sectionMismatch,
  filterList: filterDrawerMissing,
};
