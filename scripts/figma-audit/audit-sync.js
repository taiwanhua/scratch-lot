// 三尺寸同步檢查(FIGMA-11、FIGMA-12;一次跑設定 sync.pages 的全部專案頁;不改任何節點)。
// 執行:project/config.js 全文 + 本檔全文一起貼進 use_figma(見 README)。設定欄位見 config 的 sync。
// 1. 標題列按鈕一致(syncDiffs):同一個畫面編號(sync.screenCode,含 a / b / c)在各尺寸 Section(sync.sizes)中,
//    標題列 / 頂部列的按鈕文字集合要一樣,差異要是 0。
//    標題列 = sync.headInstance 的實例、名稱符合 sync.headFrame 的框,電腦以外再加 sync.appBar 的實例
//    (kindProp=skipKind 是全螢幕對話框,它的按鈕是對話框按鈕,不算)。按鈕 = 有文字的實例(sync.nonButton 不算);
//    手機收進「更多」選單的(sync.merged),選單裡的文字也算有。該編號只有一個尺寸有畫的不比。
//    版面本來就不同的列在 sync.exempt(要寫理由,回報時照列)。
// 2. 共用區塊非元件數(sharedHandDrawn):三尺寸都出現的共用區塊,只要在任何尺寸是手畫框而不是元件實例就列出來,數量要是 0。
//    哪些框名是共用區塊、應該用哪個元件,寫在 sync.sharedBlocks。由元件實例組成的容器算元件化。
// 3. 寬度不符(sectionMismatch):每張畫面 = 一個視窗尺寸。尺寸 Section 裡每張畫面的寬度要等於該 Section 的寬度,
//    名稱帶 sync.sizeSuffix 後綴的要在對應 Section。多個對話框並排、精靈步驟並排的都算不符。不在 sync.sizes 的 Section 不檢查。數量要是 0。
// 4. 篩選抽屜(filterDrawerMissing):電腦以外的畫面有篩選按鈕(sync.filterButton),就要有同編號的篩選抽屜畫面(名稱符合 sync.filterDrawer),
//    或它的框外註解寫明照共用規則(sync.filterNote)。數量要是 0。
// 5. 遮罩畫面要有頁面背景(overlayNoPage):有遮罩(半透明黑底或 scrim)的畫面,除了對話框 / 抽屜 / 底部面板外,
//    要放打開它的那個頁面(子節點「背景:<入口畫面>」或畫面本身的 main / 側欄)。全部專案頁 + sync.overlayOnlyPages 都查,數量要是 0。
//    背景頁裡的標題列不算進第 1 項的按鈕比對。
// 6. 遮罩 / 全螢幕對話框蓋滿畫面(overlayNotCovering):有「背景:…」或 scrim 的畫面,直屬子節點裡的
//    scrim、full-dialog(或名稱含「全螢幕」)、背景:… 要從頂到底、左到右蓋滿畫面框;drawer(或含「抽屜」)要從頂到底;
//    bottom-sheet(或含「底部面板」)要貼齊畫面底部(容許 1px)。背景變高之後遮罩沒跟著撐滿、底下露出背景內容就算。數量要是 0。
// 頁多、一次跑不完(use_figma 逾時)時,填 ONLY_PAGES 分批跑(每批列幾個頁 id),回報時加總;第 1 項只比同一頁內,分批不影響結果。
const ONLY_PAGES = ""; // 選填:逗號分隔的頁 id(sync.pages 或 sync.overlayOnlyPages 裡的);空白 = 全部
if (typeof AUDIT_CONFIG === "undefined")
  throw new Error("先貼 project/config.js 再貼本檔");
const C = AUDIT_CONFIG.sync;
figma.skipInvisibleInstanceChildren = false;
const ONLY = ONLY_PAGES
  ? ONLY_PAGES.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : null;
if (ONLY) {
  const known = [...C.pages, ...(C.overlayOnlyPages || []).map((p) => p.id)];
  const unknown = ONLY.filter((id) => !known.includes(id));
  if (unknown.length)
    throw new Error(`ONLY_PAGES 有設定裡沒有的頁:${unknown.join(", ")}`);
}
const PAGES = ONLY ? C.pages.filter((id) => ONLY.includes(id)) : C.pages;
const OVERLAY_ONLY = (C.overlayOnlyPages || []).filter(
  (p) => !ONLY || ONLY.includes(p.id),
);
const SIZE = Object.fromEntries(
  Object.entries(C.sizes).map(([k, v]) => [k, v.code]),
);
const MERGED = C.merged;
const EXEMPT = C.exempt;
const NONBTN = C.nonButton;
const label0 = C.pageLabel;
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
  (n.type === "INSTANCE" && C.headInstance.test(n.name)) ||
  (sz !== "D" &&
    n.type === "INSTANCE" &&
    C.appBar.name.test(n.name) &&
    n.componentProperties?.[C.appBar.kindProp]?.value !== C.appBar.skipKind) ||
  (n.type === "FRAME" && !inInstance(n) && C.headFrame.test(n.name));
const sectionMismatch = [],
  filterDrawerMissing = [];
const W = Object.fromEntries(
  Object.entries(C.sizes).map(([k, v]) => [k, v.width]),
);
const DESKTOP = Object.keys(C.sizes).filter((k) => C.sizes[k].code === "D");
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
      const m = C.screenCode.exec(f.name);
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
    // 手機把幾顆按鈕收進一個選單(sync.merged):選單和它收起來的按鈕視為同一組
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
        else syncDiffs.push(`${label0(page.name)} ${k}「${l}」缺 ${x}`);
      }
  }
  // 共用區塊非元件(sync.sharedBlocks:第一條框名符合、且頁面符合的規則生效)
  const topOf = (n) => {
    let f = n;
    while (f.parent && f.parent.type !== "SECTION") f = f.parent;
    return f;
  };
  const hit = (n, why) =>
    sharedHandDrawn.push(
      `${label0(page.name)} ${topOf(n).name.slice(0, 24)}:${n.name}(${why})`,
    );
  for (const n of page.findAll((x) => x.type === "FRAME" && !inInstance(x))) {
    const rule = C.sharedBlocks.find(
      (r) => r.frame.test(n.name) && (!r.pages || r.pages.includes(pid)),
    );
    if (!rule) continue;
    if (rule.why) hit(n, rule.why);
    if (rule.children)
      for (const c of n.children)
        if (c.type !== "INSTANCE") hit(c, rule.children);
    for (const [re, why] of rule.contains || [])
      if (!n.findOne((x) => x.type === "INSTANCE" && re.test(x.name)))
        hit(n, why);
  }
  // 放錯尺寸 / 篩選抽屜
  for (const s of page.children.filter(
    (n) => n.type === "SECTION" && W[n.name],
  ))
    for (const f of s.children) {
      if (f.type === "TEXT") continue;
      checkOverlay(label0(page.name), f);
      checkCover(label0(page.name), f);
      const tag =
        Object.entries(C.sizeSuffix).find(([suffix]) =>
          f.name.includes(suffix),
        )?.[1] ?? null;
      const w = Math.round(f.width);
      if ((tag && tag !== s.name) || Math.abs(w - W[s.name]) > 2)
        sectionMismatch.push(`${label0(page.name)} ${s.name}:${f.name} w${w}`);
      if (
        DESKTOP.includes(s.name) ||
        !("findAll" in f) ||
        C.filterDrawer.test(f.name)
      )
        continue; // 抽屜畫面本身不算
      const hasFilter = f.findOne(
        (b) =>
          b.type === "INSTANCE" &&
          b.visible &&
          !inBg(b) &&
          !!b.findOne(
            (t) => t.type === "TEXT" && C.filterButton.test(t.characters),
          ),
      );
      if (!hasFilter) continue;
      const code = (C.screenCode.exec(f.name) || [])[1];
      const drawer = s.children.some(
        (x) =>
          x !== f &&
          x.type !== "TEXT" &&
          x.name.startsWith(code) &&
          C.filterDrawer.test(x.name),
      );
      const cap = s.children.find(
        (x) => x.type === "TEXT" && x.name === f.name + " · 註解",
      );
      if (!drawer && !(cap && C.filterNote.test(cap.characters)))
        filterDrawerMissing.push(`${label0(page.name)} ${f.name}`);
    }
  counts[label0(page.name)] = Object.keys(groups).length;
}
for (const { id, label: pageLabel } of OVERLAY_ONLY) {
  const extra = await figma.getNodeByIdAsync(id); // 沒有尺寸 Section 的頁(例:底座草稿頁)
  await extra.loadAsync();
  for (const f of extra.children) {
    checkOverlay(pageLabel, f);
    checkCover(pageLabel, f);
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
