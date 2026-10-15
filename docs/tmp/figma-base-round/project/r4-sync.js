// 第十四輪「Screen / 店面管理」(65:14):三尺寸同步、最近兌獎規則、撤銷兌獎確認。前置:r4-lib.js + `const PART = "…";` + 本檔。
// 元件化(StoreTopBar / NavRail / CashPointHeader 的 Size 變體)見 components.js 第 5、9、10 節;手畫框換實例用 PART "swap"。
// 依序:swap → 34 → 35 → 38 → 41 → 20 → wiz → fix;第十五輪 appbar → mdlg → 08,最後跑 brand-rebind.js、r4-layout.js、audit.js、audit-sync.js。
const CPH = {
  // 平板 / 手機的 CashPointHeader 實例樣板(ST-36a / ST-36c 裡的):Open = 店內櫃台(本機),Other = 店外攤位(Mine)
  T: { open: "190:25019", other: "190:25050" },
  M: { open: "190:25289", other: "190:25382" },
};
const CP = {
  in: {
    name: "店內櫃台",
    who: "負責人 王小明 · 08:02 開班 · 協同 李小華",
    sold: "42 張 / 8,400",
    cash: "12,350",
  },
  out: {
    name: "店外攤位",
    who: "負責人 王小明 · 13:00 開班",
    sold: "18 張 / 3,600",
    cash: "7,200",
  },
};
// 把實例上的收銀點資料從 a 換成 b(依目前文字比對)
async function setCP(i, a, b) {
  for (const k of ["name", "who", "sold", "cash"]) {
    const t = i.findOne((x) => x.type === "TEXT" && x.characters === a[k]);
    if (t) await setT(t, b[k]);
  }
}
const contentOf = (f) =>
  f.findOne((n) => n.name === "content" && n.type === "FRAME");
const topBar = (c) => c.children.find((n) => /StoreTopBar/.test(n.name));
const selValue = (bar) => {
  const sf = bar
    .findAll((x) => x.type === "INSTANCE" && /SelectField/.test(x.name))
    .find((s) =>
      s.findOne((t) => t.type === "TEXT" && t.characters === "本機收銀點"),
    );
  return sf
    .findAll((t) => t.type === "TEXT" && t.visible)
    .find((t) => !["本機收銀點", "▾"].includes(t.characters));
};
// 在頂部列後面插入本機收銀點(店內櫃台)的 CashPointHeader
async function insertOpenHeader(f, sz) {
  const c = contentOf(f);
  if (c.children.some((n) => /CashPointHeader/.test(n.name))) return;
  const h = (await figma.getNodeByIdAsync(CPH[sz].open)).clone();
  c.insertChild(c.children.indexOf(topBar(c)) + 1, h);
  h.layoutSizingHorizontal = "FILL";
}
// 框外註解(複製 ST-37 的註解樣式)
async function note(f, s) {
  const n = (await figma.getNodeByIdAsync("150:21555")).clone();
  f.parent.appendChild(n);
  n.name = f.name + " · 註解";
  await setT(n, s);
  return n;
}

// 對話框置中(電腦的 dialogs 列、平板的 dialog)
function centerDialogs(f) {
  const row = f.findOne((n) => n.name === "dialogs" || n.name === "dialog");
  row.x = Math.round((f.width - row.width) / 2);
  row.y = 64;
}
// 手機置中小視窗:從平板的遮罩 + 對話框複製,寬 342、垂直置中,超寬的文字改換行(專案規格 16.0)
function mobileDialog(fromT, name) {
  const f = fromT.clone();
  f.name = name;
  fileIn("手機 390", f);
  f.resize(390, 844);
  const d = f.findOne((n) => n.name === "dialog");
  d.resize(342, d.height);
  for (const fr of d.findAll(
    (n) => n.type === "FRAME" && n.layoutMode === "HORIZONTAL",
  )) {
    fr.layoutWrap = "WRAP";
    fr.counterAxisSpacing = 8;
  }
  for (const t of d.findAll((n) => n.type === "TEXT")) {
    const p = t.parent,
      pb = p.absoluteBoundingBox,
      tb = t.absoluteBoundingBox;
    if (p.layoutMode === "NONE" || tb.x + tb.width <= pb.x + pb.width + 1)
      continue;
    if (p.layoutMode === "VERTICAL") t.layoutSizingHorizontal = "FILL";
    else t.layoutGrow = 1;
    t.textAutoResize = "HEIGHT";
  }
  d.x = 24;
  d.y = Math.round((844 - d.height) / 2);
  return f;
}

if (PART === "swap") {
  // 三尺寸共用區塊:手畫的 store-top / toolbar / nav-rail 換成元件實例(cash-point 在第十四輪前半已換成 CashPointHeader)
  const draft = await figma.getNodeByIdAsync("64:14"); // Project Draft / 刮刮樂元件
  const set = draft.findOne((n) => n.name === "Draft/StoreTopBar");
  const rail = draft.findOne((n) => n.name === "Draft/ScratchLotNavRail");
  const V = {};
  for (const v of set.children) V[v.name.replace("Size=", "")] = v;
  const pMy = Object.keys(set.componentPropertyDefinitions).find((k) =>
    k.startsWith("MyShifts"),
  );
  const top = (n) => {
    let f = n;
    while (f.parent && f.parent.type !== "SECTION") f = f.parent;
    return f;
  };
  const swap = (old, i) => {
    const p = old.parent;
    p.insertChild(p.children.indexOf(old), i);
    if (p.layoutMode !== "NONE" && old.layoutPositioning !== "ABSOLUTE") {
      i.layoutSizingHorizontal =
        old.layoutSizingHorizontal === "HUG"
          ? "FIXED"
          : old.layoutSizingHorizontal;
      i.layoutSizingVertical = old.layoutSizingVertical;
      if (i.layoutSizingHorizontal === "FIXED") i.resize(old.width, i.height);
    } else {
      i.x = old.x;
      i.y = old.y;
    }
    old.remove();
  };
  for (const pid of [
    "65:14",
    "91:14",
    "69:14",
    "70:14",
    "93:14",
    "94:14",
    "95:14",
    "97:14",
  ]) {
    const p = await figma.getNodeByIdAsync(pid);
    for (const r of p.findAll(
      (n) => n.type === "FRAME" && n.name === "nav-rail(收合側欄)",
    ))
      swap(r, rail.createInstance());
    for (const r of p.findAll(
      (n) =>
        n.type === "FRAME" && (n.name === "store-top" || n.name === "toolbar"),
    )) {
      const f = top(r);
      const sz =
        f.width >= 1400 ? "Desktop" : f.width >= 1000 ? "Tablet" : "Mobile";
      const shift = r.findOne(
        (t) =>
          t.type === "TEXT" &&
          t.visible &&
          t.characters.startsWith("你開著的班"),
      );
      const i = V[sz].createInstance();
      i.setProperties({ [pMy]: !!shift });
      if (shift)
        await setT(
          i.findOne(
            (t) => t.type === "TEXT" && t.characters.startsWith("你開著的班"),
          ),
          shift.characters,
        );
      await setT(selValue(i), selValue(r).characters);
      swap(r, i);
    }
  }
}

if (PART === "34") {
  // ST-34 平板 / 手機:補「切換後的看板(標題列)」— 從 ST-35 複製頂部列,放店內櫃台(Other、Mine)+ 店外攤位(Open、本機)
  for (const [src, label, name, sz, minH] of [
    ["124:5862", "平板 1024", "ST-34 · 平板 切換後的看板(標題列)", "T", 768],
    ["124:6180", "手機 390", "ST-34 · 手機 切換後的看板(標題列)", "M", 844],
  ]) {
    const f = (await figma.getNodeByIdAsync(src)).clone();
    f.name = name;
    fileIn(label, f);
    const c = contentOf(f);
    for (const k of [...c.children])
      if (!/StoreTopBar/.test(k.name)) k.remove();
    const bar = topBar(c);
    await setT(
      bar.findOne(
        (t) => t.type === "TEXT" && t.characters.startsWith("你開著的班"),
      ),
      "你開著的班:店內櫃台 · 店外攤位",
    );
    await setT(selValue(bar), "店外攤位");
    const other = add(
      c,
      (await figma.getNodeByIdAsync(CPH[sz].other)).clone(),
      "FILL",
    );
    await setCP(other, CP.out, CP.in);
    const open = add(
      c,
      (await figma.getNodeByIdAsync(CPH[sz].open)).clone(),
      "FILL",
    );
    await setCP(open, CP.in, CP.out);
    fitShell(f, minH);
  }
  // 電腦版:店外攤位(Open)的資料改成 13:00 開的那一班
  await setCP(await figma.getNodeByIdAsync("123:23175"), CP.in, CP.out);
}

if (PART === "35") {
  // ST-35 平板 / 手機:頂部列後面補本機收銀點的標題列([最近售出] 的入口)
  await insertOpenHeader(await figma.getNodeByIdAsync("124:5862"), "T");
  await insertOpenHeader(await figma.getNodeByIdAsync("124:6180"), "M");
}

if (PART === "38") {
  // ST-38 拆成 a(兌獎後提示,不自動打開清單)/ b(按標題列 [最近兌獎] 打開清單);平板 / 手機補標題列
  const SRC = [
    [
      "186:11194",
      "",
      "ST-38a 看板:兌獎後提示「已兌獎 … [撤銷]」(不自動打開清單)",
      "ST-38b 看板:按標題列 [最近兌獎] 打開清單",
    ],
    [
      "186:11525",
      "T",
      "ST-38a · 平板 兌獎後提示",
      "ST-38b · 平板 按 [最近兌獎] 打開清單",
    ],
    [
      "186:11590",
      "M",
      "ST-38a · 手機 兌獎後提示",
      "ST-38b · 手機 按 [最近兌獎] 打開清單",
    ],
  ];
  for (const [id, sz, na, nb] of SRC) {
    const b = await figma.getNodeByIdAsync(id);
    if (sz) await insertOpenHeader(b, sz);
    const toastB = b.findOne((n) => n.name.startsWith("toast:"));
    toastB.name = "toast:已兌獎";
    const a = b.clone();
    a.name = na;
    b.parent.appendChild(a);
    b.name = nb;
    toastB.remove();
    // a:拿掉清單(電腦是右側 drawer,平板 / 手機是「最近兌獎」區塊)
    (sz
      ? contentOf(a).children.find((n) => n.name === "最近兌獎")
      : a.findOne((n) => n.name.startsWith("drawer:"))
    ).remove();
    if (sz) fitShell(a, sz === "T" ? 768 : 844);
    if (sz) fitShell(b, sz === "T" ? 768 : 844);
    await note(
      a,
      "兌獎成功後右上角提示「已兌獎 … [撤銷]」;[撤銷] 直接打開那一筆的撤銷兌獎確認(ST-41)。清單不會自動打開。",
    );
    await note(
      b,
      "只在按本機收銀點(自己開的班)標題列的 [最近兌獎] 時打開。每列 [撤銷] → ST-41 撤銷兌獎確認;點列的其他地方 → ST-39 兌獎紀錄詳情。",
    );
  }
}

if (PART === "41") {
  // 撤銷兌獎確認(比照 ST-08):a 確認;b 按 [撤銷] 時已超過 30 分鐘。電腦一個遮罩畫面放兩個對話框(從 ST-37 電腦複製),平板 / 手機各兩張。
  const REC = "5164-056527-031 · 500 元 · 21:50 登記";
  const NAMES = { a: "撤銷兌獎?", b: "已超過 30 分鐘" };
  const para = async (host, s, k = "body2") => {
    const t = add(host, await T(k, s), "FILL");
    t.textAutoResize = "HEIGHT";
    return t;
  };
  const body = async (host, st, mobile) => {
    if (!mobile)
      add(host, await T("h6", st === "a" ? "撤銷兌獎?" : "不能當下撤銷"));
    await para(host, REC, "body1");
    if (st === "a")
      await para(host, "撤銷後 500 元退回店內櫃台的抽屜應有金額。");
    else await para(host, "已超過 30 分鐘,請店長在兌獎紀錄上撤銷。");
    if (mobile) return;
    const a = add(
      host,
      AL("HORIZONTAL", {
        name: "actions",
        itemSpacing: 8,
        counterAxisAlignItems: "CENTER",
      }),
      "FILL",
    );
    sp(a);
    if (st === "a") {
      add(a, await B("取消", "Text", "Medium"));
      add(a, await B("撤銷", "Contained", "Medium", "Error"));
    } else add(a, await B("知道了", "Contained", "Medium"));
  };
  {
    const f = (await figma.getNodeByIdAsync("143:33884")).clone();
    f.name = "ST-41 Overlay / 撤銷兌獎確認(a 確認;b 已超過 30 分鐘)";
    fileIn("電腦 1440", f);
    const row = f.findOne((n) => n.name === "dialogs");
    const d0 = row.children[0];
    for (const st of ["a", "b"]) {
      const d = d0.clone();
      row.appendChild(d);
      d.name = "dialog:" + NAMES[st];
      for (const k of [...d.children]) k.remove();
      d.resize(400, d.height);
      await body(d, st, false);
    }
    d0.remove();
  }
  for (const st of ["a", "b"]) {
    {
      const f = (await figma.getNodeByIdAsync("143:34208")).clone();
      f.name = `ST-41${st} · 平板 ${NAMES[st]}`;
      fileIn("平板 1024", f);
      const d = f.findOne((n) => n.name === "dialog");
      for (const k of [...d.children]) k.remove();
      d.resize(400, d.height);
      await body(d, st, false);
    }
    {
      // 手機比照 ST-08:全螢幕,app-bar 標題 + 右上 [撤銷](b 沒有按鈕,用 ✕ 關閉)
      const f = (await figma.getNodeByIdAsync("143:34382")).clone();
      f.name = `ST-41${st} · 手機 ${NAMES[st]}`;
      fileIn("手機 390", f);
      const c = contentOf(f);
      for (const k of [...c.children]) k.remove();
      c.itemSpacing = 12;
      const bar = f.findOne((n) => n.name === "app-bar");
      await setT(
        bar.children.find(
          (x) => x.type === "TEXT" && x.characters.startsWith("拆本"),
        ),
        st === "a" ? "撤銷兌獎?" : "撤銷兌獎",
      );
      const ob = bar.children.find((x) => x.type === "INSTANCE");
      if (st === "a") {
        ob.setProperties({ Color: "Error" });
        await setT(
          ob.findOne((x) => x.type === "TEXT"),
          "撤銷",
        );
      } else ob.remove();
      await body(c, st, true);
    }
  }
}

if (PART === "20") {
  // ST-20 電腦:原本只有按鈕 + tooltip 的小框,改成和平板 / 手機一樣的畫面(從 ST-01 複製,只留頂部列與分頁),
  // [日結] 停用、滑過顯示 tooltip(三尺寸都列出還沒交班結帳的班);說明移到框外註解
  const old = await figma.getNodeByIdAsync("65:741");
  const f = (await figma.getNodeByIdAsync("65:15")).clone();
  f.name = old.name;
  old.parent.appendChild(f);
  const tip = old.findOne(
    (n) => n.type === "INSTANCE" && /Tooltip/.test(n.name),
  );
  const bars = [f];
  for (const id of ["124:26374", "124:26667"])
    bars.push(await figma.getNodeByIdAsync(id));
  for (const fr of bars) {
    const day = fr
      .findAll((n) => n.type === "INSTANCE" && /StoreTopBar/.test(n.name))[0]
      .findAll((n) => n.type === "INSTANCE" && n.name === "Button")
      .find((b) =>
        b.findOne((t) => t.type === "TEXT" && t.characters === "日結"),
      );
    day.setProperties({ State: "Disabled" });
  }
  const day = f
    .findOne((n) => /StoreTopBar/.test(n.name))
    .findAll((n) => n.type === "INSTANCE" && n.name === "Button")
    .find((b) =>
      b.findOne((t) => t.type === "TEXT" && t.characters === "日結"),
    );
  f.appendChild(tip);
  tip.layoutPositioning = "ABSOLUTE";
  const bb = day.absoluteBoundingBox,
    fb = f.absoluteBoundingBox;
  tip.x = bb.x + bb.width - fb.x - tip.width;
  tip.y = bb.y + bb.height - fb.y + 8;
  const cap = old.findOne((n) => n.type === "TEXT").characters;
  await note(
    f,
    cap.replace(/。滑過按鈕顯示:$/, "。滑過(手機長按)[日結] 顯示 tooltip。"),
  );
  old.remove();
}

if (PART === "wiz") {
  // 精靈 / 盤點頁的平板 / 手機:app-bar 右側補 [取消](電腦在頁首右側)
  for (const [id, label] of [
    ["124:26096", "取消"],
    ["124:26467", "取消"],
    ["124:26973", "取消"],
    ["124:27401", "取消"],
    ["124:25145", "取消(不保留)"],
    ["124:25604", "取消(不保留)"],
  ]) {
    const bar = (await figma.getNodeByIdAsync(id)).findOne(
      (n) => n.name === "app-bar",
    );
    if (bar.findOne((t) => t.type === "TEXT" && t.characters === label))
      continue;
    add(bar, await B(label, "Text", "Medium"));
  }
}

if (PART === "20") {
  // 接上段:電腦只留頂部列與分頁;tooltip 與平板 / 手機的提示框列出同樣的班(示範資料和 ST-01 看板一致)
  const f = figma.currentPage.findOne(
    (n) => n.type === "FRAME" && n.name.startsWith("ST-20 店面管理"),
  );
  const c = contentOf(f);
  for (const k of [...c.children])
    if (!/StoreTopBar|PageTabs/.test(k.name)) k.remove();
  const tip = f.findOne((n) => n.type === "INSTANCE" && /Tooltip/.test(n.name));
  await setT(
    tip.findOne((t) => t.type === "TEXT"),
    "還不能日結:\n店內櫃台還沒交班\n店外攤位還沒交班",
  );
  const day = f
    .findOne((n) => /StoreTopBar/.test(n.name))
    .findAll((n) => n.type === "INSTANCE" && n.name === "Button")
    .find((b) =>
      b.findOne((t) => t.type === "TEXT" && t.characters === "日結"),
    );
  const bb = day.absoluteBoundingBox,
    fb = f.absoluteBoundingBox;
  tip.x = Math.round(bb.x - fb.x + bb.width / 2 - tip.width / 2); // 箭頭對準 [日結]
  tip.y = Math.round(bb.y + bb.height - fb.y + 8);
  for (const id of ["124:26374", "124:26667"]) {
    const fr = await figma.getNodeByIdAsync(id);
    const bar = fr.findOne((n) => /StoreTopBar/.test(n.name));
    bar.setProperties({
      [Object.keys(bar.componentProperties).find((k) =>
        k.startsWith("MyShifts"),
      )]: true,
    });
    for (const t of fr.findAll((t) => t.type === "TEXT")) {
      if (t.characters.includes("店外攤位 · 陳大文"))
        await setT(t, "· 店內櫃台 · 王小明 08:02 開班");
      else if (t.characters.includes("彩券機旁 · 李小華"))
        await setT(t, "· 店外攤位 · 王小明 13:00 開班");
    }
  }
}

if (PART === "fix") {
  // audit-sync 列出的其他不一致(第十四輪):
  // 1. ST-34 電腦「切換後的看板」補頂部列(本機收銀點 = 店外攤位)
  {
    const first = await figma.getNodeByIdAsync("123:23156");
    const p = first.parent;
    if (!p.children.some((n) => /StoreTopBar/.test(n.name))) {
      const set = (await figma.getNodeByIdAsync("64:14")).findOne(
        (n) => n.name === "Draft/StoreTopBar",
      );
      const i = set.children
        .find((v) => v.name === "Size=Desktop")
        .createInstance();
      p.insertChild(p.children.indexOf(first), i);
      i.layoutSizingHorizontal = "FILL";
      await setT(
        i.findOne(
          (t) => t.type === "TEXT" && t.characters.startsWith("你開著的班"),
        ),
        "你開著的班:店內櫃台 · 店外攤位",
      );
      await setT(selValue(i), "店外攤位");
    }
  }
  // 2. 庫存 IN-03 平板 / 手機:本的詳情頁首叫 title(和電腦一致,[更正跳號] 在裡面)
  for (const t of (await figma.getNodeByIdAsync("91:14")).findAll(
    (n) => n.type === "TEXT" && n.characters === "更正跳號",
  )) {
    const chain = [];
    for (let a = t.parent; a && a.type !== "SECTION"; a = a.parent)
      chain.push(a);
    if (!/^IN-03 · /.test(chain[chain.length - 1].name)) continue;
    const head = chain.find((x) => x.name === "head");
    if (head) head.name = "title";
  }
  // 3. 叫貨與進貨 PU-06 / 07 / 10b 平板 / 手機:頁首(單號 + 動作按鈕)從電腦版複製,窄螢幕換行
  for (const [srcFrame, pick, targets] of [
    ["69:651", "title", ["127:26619", "127:26898"]],
    ["127:2714", "doc-head", ["127:26961", "127:27369"]],
    ["127:26050", "doc-head", ["127:27289", "127:27667"]],
  ]) {
    const src = contentOf(await figma.getNodeByIdAsync(srcFrame)).children.find(
      (n) => n.name === pick,
    );
    for (const id of targets) {
      const c = contentOf(await figma.getNodeByIdAsync(id));
      if (c.children.some((n) => n.name === pick)) continue;
      const h = src.clone();
      c.insertChild(0, h);
      h.layoutSizingHorizontal = "FILL";
      for (const fr of [h, ...h.findAll((n) => n.type === "FRAME")])
        if (fr.layoutMode === "HORIZONTAL") {
          fr.layoutWrap = "WRAP";
          fr.counterAxisSpacing = 8;
        }
    }
  }
  for (const id of ["127:27289", "127:27667"]) {
    const f = await figma.getNodeByIdAsync(id);
    f.name = f.name.replace(/^PU-10 /, "PU-10b ");
  }
  for (const id of ["127:26619", "127:26898"]) {
    const t = (await figma.getNodeByIdAsync(id))
      .findOne((n) => n.name === "app-bar")
      .findAll((x) => x.type === "TEXT")
      .find((x) => x.characters.includes("P-0031"));
    if (t) await setT(t, "進貨單 點收");
  }
  // 4. 班表 SC-03 平板 / 手機:篩選列 / 動作列命名;SC-07 平板 / 手機補分店、月份與 [套用範本] [自動排班] [發布](同一頁的分頁共用)
  for (const [s03, s07] of [
    ["130:29192", "130:29442"],
    ["130:29593", "130:29779"],
  ]) {
    const c3 = contentOf(await figma.getNodeByIdAsync(s03));
    const filt = c3.children[0],
      tb = c3.children[1];
    filt.name = "filters";
    tb.name = "toolbar";
    const c7 = contentOf(await figma.getNodeByIdAsync(s07));
    if (c7.children.some((n) => n.name === "toolbar")) continue;
    const a = filt.clone(),
      b = tb.clone();
    c7.insertChild(0, a);
    c7.insertChild(1, b);
    a.layoutSizingHorizontal = "FILL";
    b.layoutSizingHorizontal = "FILL";
  }
}

if (PART === "appbar") {
  // 第十五輪:平板 / 手機手畫的 app-bar(116 個,各頁)換成 Draft/ScratchLotAppBar 實例。
  // Kind 依開頭符號(✕ Dialog、← Back、其他 Page);spacer 之前的文字是 Title、之後的是 Org;右側按鈕的屬性(Label / Variant / Color…)照抄。
  const set = (await figma.getNodeByIdAsync("64:14")).findOne(
    (n) => n.name === "Draft/ScratchLotAppBar",
  );
  const V = {};
  for (const v of set.children) V[v.name] = v;
  const key = (p) =>
    Object.keys(set.componentPropertyDefinitions).find((k) => k.startsWith(p));
  const inI = (n) => {
    for (let a = n.parent; a; a = a.parent)
      if (a.type === "INSTANCE") return true;
    return false;
  };
  const top = (n) => {
    let f = n;
    while (f.parent && f.parent.type !== "SECTION") f = f.parent;
    return f;
  };
  for (const pid of [
    "65:14",
    "91:14",
    "69:14",
    "70:14",
    "93:14",
    "94:14",
    "95:14",
    "97:14",
  ]) {
    const p = await figma.getNodeByIdAsync(pid);
    await figma.setCurrentPageAsync(p);
    for (const b of p.findAll(
      (x) => x.type === "FRAME" && x.name === "app-bar" && !inI(x),
    )) {
      const size = top(b).width >= 1000 ? "Tablet" : "Mobile";
      const kids = b.children;
      const g =
        kids[0] &&
        kids[0].type === "TEXT" &&
        /^[✕←☰]$/.test(kids[0].characters)
          ? kids[0].characters
          : null;
      const kind = g === "✕" ? "Dialog" : g === "←" ? "Back" : "Page";
      const sp = kids.findIndex((k) => k.name === "spacer");
      const texts = kids.filter(
        (k) => k.type === "TEXT" && !/^[✕←☰]$/.test(k.characters),
      );
      const title = texts.find((t) => sp < 0 || kids.indexOf(t) < sp);
      const org = texts.find((t) => sp >= 0 && kids.indexOf(t) > sp);
      const btn = kids.find((k) => k.type === "INSTANCE");
      const i = V[`Size=${size}, Kind=${kind}`].createInstance();
      for (const t of i.findAll((x) => x.type === "TEXT")) await fnt(t);
      i.setProperties({
        [key("Title")]: title ? title.characters : "",
        [key("Org")]: !!org,
        [key("Action")]: !!btn,
      });
      if (org)
        await setT(
          i.findOne((x) => x.name === "org"),
          org.characters,
        );
      if (btn) {
        const pr = {};
        for (const [k, v] of Object.entries(btn.componentProperties))
          pr[k] = v.value;
        i.findOne((x) => x.name === "action").setProperties(pr);
      }
      b.parent.insertChild(b.parent.children.indexOf(b), i);
      i.layoutSizingHorizontal = "FILL";
      b.remove();
    }
  }
}

if (PART === "08") {
  // 第十五輪:ST-08 撤銷售出改成單張確認視窗(比照 ST-41):a 確認;b 超過 30 分鐘或之後有異動 → [送撤銷售出申請]。
  // 電腦一張兩個對話框(從 ST-41 複製),平板 / 手機各兩張;手機是置中小視窗(專案規格 16.0)。舊的清單版 ST-08 刪除(清單是 ST-35 的 [最近售出])。
  const A = [
    "撤銷這張售出?",
    "5164-056527-012 · 200 元 · 21:52 售出",
    "撤銷後 200 元從店內櫃台的抽屜應有金額扣除。",
  ];
  const Bt = [
    "不能當下撤銷",
    "5201-060112-044 · 100 元 · 21:12 售出",
    "已超過 30 分鐘(或之後有異動),請改送撤銷售出申請。",
  ];
  const fillDlg = async (d, [h, l1, l2], b) => {
    const ts = d.children.filter((k) => k.type === "TEXT");
    await setT(ts[0], h);
    await setT(ts[1], l1);
    await setT(ts[2], l2);
    if (!b) return;
    const a = d.findOne((n) => n.name === "actions");
    const last = a.children[a.children.length - 1];
    await setT(
      last.findOne((x) => x.type === "TEXT"),
      "送撤銷售出申請",
    );
    a.insertChild(a.children.indexOf(last), await B("取消", "Text", "Medium"));
  };
  for (const id of ["87:2346", "124:23951", "124:24300"]) {
    const n = await figma.getNodeByIdAsync(id);
    if (!n) continue;
    const cap = n.parent.children.find(
      (k) => k.type === "TEXT" && k.name === n.name + " · 註解",
    );
    if (cap) cap.remove();
    n.remove();
  }
  {
    const f = (await figma.getNodeByIdAsync("200:13351")).clone(); // ST-41 電腦
    f.name = "ST-08 Overlay / 撤銷售出確認(a 確認;b 超過條件改送撤銷售出申請)";
    fileIn("電腦 1440", f);
    const ds = f.findOne((n) => n.name === "dialogs").children;
    ds[0].name = "dialog:撤銷這張售出?";
    ds[1].name = "dialog:不能當下撤銷";
    await fillDlg(ds[0], A, false);
    await fillDlg(ds[1], Bt, true);
    centerDialogs(f);
  }
  for (const [st, src, txt, isB] of [
    ["a", "200:13477", A, false],
    ["b", "200:13566", Bt, true],
  ]) {
    const name = st === "a" ? "撤銷這張售出?" : "超過條件改送申請";
    const f = (await figma.getNodeByIdAsync(src)).clone(); // ST-41a / b 平板
    f.name = `ST-08${st} · 平板 ${name}`;
    fileIn("平板 1024", f);
    await fillDlg(
      f.findOne((n) => n.name === "dialog"),
      txt,
      isB,
    );
    centerDialogs(f);
    mobileDialog(f, `ST-08${st} · 手機 ${name}`);
  }
}

if (PART === "mdlg") {
  // 第十五輪:只有一兩句話、沒有表單欄位的確認,手機改成置中小視窗(從平板版複製,寬 342)。
  // ST-41 手機重畫;ST-05、ST-06、PU-11、SC-15 手機由全螢幕改小視窗。ST-15(明細清單)、ST-39a / c(詳情)維持全螢幕。
  for (const id of ["200:13351", "200:13477", "200:13566"])
    centerDialogs(await figma.getNodeByIdAsync(id));
  for (const id of ["200:13526", "200:13611"]) {
    const n = await figma.getNodeByIdAsync(id);
    if (n) n.remove();
  }
  mobileDialog(
    await figma.getNodeByIdAsync("200:13477"),
    "ST-41a · 手機 撤銷兌獎?",
  );
  mobileDialog(
    await figma.getNodeByIdAsync("200:13566"),
    "ST-41b · 手機 已超過 30 分鐘",
  );
  for (const [pid, tid, mid] of [
    ["65:14", "124:23673", "124:24027"], // ST-05
    ["65:14", "124:23701", "124:24052"], // ST-06
    ["69:14", "127:26671", "127:26937"], // PU-11
    ["70:14", "130:29502", "130:29827"], // SC-15
  ]) {
    await figma.setCurrentPageAsync(await figma.getNodeByIdAsync(pid));
    const m = await figma.getNodeByIdAsync(mid);
    const f = mobileDialog(await figma.getNodeByIdAsync(tid), m.name);
    f.x = m.x;
    f.y = m.y;
    m.remove();
  }
}

if (PART === "16") {
  // 第十六輪:撤銷兌獎改兩層(自己登記且班還開著不限時間;已結帳或別人登記要 store.undo-redeem + 原因),都不用審核。
  const g = (id) => figma.getNodeByIdAsync(id);
  const undoBtnIn = (root) =>
    root.findOne(
      (x) =>
        x.type === "INSTANCE" &&
        !!x.findOne((y) => y.type === "TEXT" && y.characters === "撤銷"),
    );
  // ST-38b 電腦 drawer:說明改寫、超過 30 分鐘那列改成 [撤銷]、拿掉「請店長」的 Alert 與和 ST-40 衝突的 #083 示範列
  await setT(await g("186:11232"), "自己在這一班登記、還在店內持有的兌獎。");
  {
    const t = await g("186:11277");
    const tbl = t.parent.parent.parent;
    t.parent.insertChild(
      t.parent.children.indexOf(t),
      undoBtnIn(
        tbl.children.find((r) => r !== t.parent.parent && undoBtnIn(r)),
      ).clone(),
    );
    t.remove();
    const dr = (await g("186:11194")).findOne((n) =>
      n.name.startsWith("drawer:"),
    );
    for (const a of dr.findAll(
      (n) => n.type === "INSTANCE" && /Alert/.test(n.name),
    ))
      a.remove();
    let row = dr.findOne(
      (x) => x.type === "TEXT" && x.characters === "5150 · 042210 · #083",
    );
    while (row.parent.name !== "table") row = row.parent;
    row.remove();
  }
  // ST-38b 平板 / 手機:標題、每列 [撤銷]、拿掉「請店長」那行
  for (const [head, lab, foot] of [
    ["186:11561", "186:11576", "186:23074"],
    ["186:11612", "186:11627", "186:11628"],
  ]) {
    await setT(await g(head), "最近兌獎 · 店內櫃台(自己在這一班登記的)");
    const t = await g(lab);
    t.parent.insertChild(
      t.parent.children.indexOf(t),
      undoBtnIn((await g(head)).parent).clone(),
    );
    t.remove();
    (await g(foot)).remove();
  }
  // ST-39:拿掉「由店長撤銷」、改名
  for (const id of ["186:23170", "186:23374", "186:23441"])
    (await g(id)).remove();
  for (const id of ["186:23450", "186:23518"]) {
    const f = await g(id);
    f.name = f.name.replace(
      "店長撤銷兌獎(原因、撤銷並重新登記)",
      "撤銷兌獎(已結帳或別人登記:原因、撤銷並重新登記)",
    );
  }
  (await g("186:23075")).name =
    "ST-39 Overlay / 兌獎紀錄:詳情、撤銷兌獎(已結帳或別人登記)、已送兌不能撤銷";
  // ST-41:拿掉 b(已超過 30 分鐘)三尺寸,a 改名 ST-41
  {
    const f = await g("200:13351");
    f.findOne((n) => n.name === "dialog:已超過 30 分鐘").remove();
    f.name = "ST-41 Overlay / 撤銷兌獎確認(自己登記、班還開著)";
    centerDialogs(f);
  }
  for (const id of ["200:13566", "209:27756"]) (await g(id)).remove();
  for (const id of ["200:13477", "209:27747"]) {
    const f = await g(id);
    f.name = f.name.replace("ST-41a", "ST-41");
  }
  // ST-40 平板 / 手機:移到對應 Section,補頂部列與分頁列(手機分頁換行)
  const tabsD = (await g("189:11585")).findOne((n) =>
    n.name.startsWith("PageTabs"),
  );
  for (const [id, src, label] of [
    ["189:17101", "124:5578", "平板 1024"],
    ["189:17232", "124:5927", "手機 390"],
  ]) {
    const f = await g(id);
    sec(label).appendChild(f);
    const c = contentOf(f);
    const bar = topBar(contentOf(await g(src))).clone();
    c.insertChild(0, bar);
    bar.layoutSizingHorizontal = "FILL";
    const tabs = tabsD.clone();
    c.insertChild(1, tabs);
    tabs.layoutSizingHorizontal = "FILL";
    if (label === "手機 390") {
      tabs.layoutWrap = "WRAP";
      tabs.counterAxisSpacing = 4;
    }
  }
}

if (PART === "17") {
  // 第十七輪:每張畫面 = 一個視窗尺寸。並排多個對話框的電腦畫面拆成 a / b / c(遮罩 + 一個對話框,置中),原框刪除(刪前截圖);
  // 精靈步驟並排的 ST-17 / ST-25 拆成完整的精靈畫面;ST-34c 改成完整看板。(班表管理頁的 SC-05 / 15 / 17 / 22 / 01 也在這一輪拆過,
  // 之後整頁交由另一個 agent 重做,這裡不再處理。)
  const L = "abcdefgh";
  const split = async (id) => {
    const src = await figma.getNodeByIdAsync(id);
    const code = /^([A-Z]{2}-\d\d)/.exec(src.name)[1];
    const row = src.children.find((k) => k.name === "dialogs");
    const sec = src.parent;
    const cap = sec.children.find(
      (k) => k.type === "TEXT" && k.name === src.name + " · 註解",
    );
    for (let i = 0; i < row.children.length; i++) {
      const d = row.children[i];
      const f = src.clone();
      sec.appendChild(f);
      const r = f.children.find((k) => k.name === "dialogs");
      r.children.filter((k, j) => j !== i).forEach((k) => k.remove());
      f.name = `${code}${L[i]} Overlay / ${d.name.replace(/^dialog:/, "")}`;
      f.resize(1440, Math.max(900, Math.ceil(r.height) + 128));
      r.x = Math.round((1440 - r.width) / 2);
      r.y = 64;
      if (i === 0 && cap) cap.name = f.name + " · 註解";
    }
    src.remove();
  };
  for (const [pid, ids] of Object.entries({
    "65:14": [
      "87:1777",
      "123:5106",
      "87:2466",
      "87:2521",
      "87:2592",
      "123:23114",
      "186:23075",
      "209:27764",
    ],
    "91:14": ["125:2089"],
    "93:14": ["93:693"],
    "95:14": ["96:1240"],
  })) {
    await figma.setCurrentPageAsync(await figma.getNodeByIdAsync(pid));
    for (const id of ids) await split(id);
  }
  // 拆完後:ST-34c(切換後的看板)從 ST-01 電腦複製,只留頂部列與分頁,放兩條收銀點標題列;
  // ST-17 / ST-25 的步驟面板各自放進 ST-18 / ST-24 電腦精靈(換掉 cols、Stepper 狀態、第一步 [上一步] 停用、最後一步 [送出結帳確認申請]),
  // 面板裡原本的按鈕刪除;ST-17 / ST-25 平板 / 手機 app-bar 顯示 [取消]。
  // RW-01b 篩選抽屜:平板右側(寬 360、滿高)、手機底部(可拉成全螢幕),欄位見簽狀態 / 距上次批購 / 證照 + [清除] [套用];DE-01 電腦補同一組篩選列。
  // 節點 id 見 nodes.md 第十七輪。
}

if (PART === "19") {
  // 第十九輪:遮罩畫面的背景放打開它的頁面(同尺寸 Section 的入口畫面副本,鎖定),再蓋 scrim(黑、不透明度 50%);
  // 畫面高度至少是背景頁的高度;畫面底色換成背景頁的底色。入口依 16.10 入口對照。各頁跑一次。
  const MAP = {
    "ST-03": "ST-02",
    "ST-04": "ST-01",
    "ST-05": "ST-01",
    "ST-06": "ST-40",
    "ST-07": "ST-36a",
    "ST-08": "ST-35",
    "ST-09": "ST-01",
    "ST-37": "ST-01",
    "ST-10": "ST-36a",
    "ST-11": "ST-01",
    "ST-12": "ST-01",
    "ST-15": "ST-14",
    "ST-16": "ST-01",
    "ST-26": "ST-01",
    "ST-34": "ST-01",
    "ST-39": "ST-40",
    "ST-41": "ST-38b",
    "IN-02": "IN-01",
    "IN-04": "IN-03",
    "PU-11": "PU-06",
    "SC-04": "SC-03",
    "SC-15": "SC-03",
    "SC-16": "SC-03",
    "SC-17": "SC-03",
    "SC-19": "SC-15b",
    "SC-20": "SC-03",
    "SC-21": "SC-03",
    "SC-34": "SC-03",
    "SC-36": "SC-20b",
    "SC-37": "SC-20b",
    "SC-22": "SC-09",
    "SC-24": "SC-06",
    "SC-26": "SC-08",
    "SC-27": "SC-10",
    "SC-28": "SC-07",
    "SC-29": "SC-11",
    "AC-07": "AC-06",
    "DE-06": "DE-04",
    "RW-04": "RW-03",
    "MD-05": "MD-05",
  };
  const AC03 = { a: "AC-01", b: "AC-02", c: "AC-02" };
  const isMask = (f) =>
    Array.isArray(f.fills) &&
    f.fills.some(
      (p) => p.type === "SOLID" && (p.opacity ?? 1) < 0.9 && p.color.r < 0.2,
    );
  const keyOf = (n) => {
    const m = /^([A-Z]{2}-\d\d)([a-f]?)/.exec(n.name);
    return m ? [m[1], m[2]] : [null, null];
  };
  for (const s of figma.currentPage.children.filter(
    (n) => n.type === "SECTION",
  )) {
    const frames = s.children.filter((f) => f.type === "FRAME");
    const entryOf = (key) =>
      frames.find((f) => {
        const [c, suf] = keyOf(f);
        return (
          c === key.slice(0, 5) &&
          (suf || "") === key.slice(5) &&
          !isMask(f) &&
          !f.children.some((k) => k.name.startsWith("背景:")) &&
          !/Overlay/.test(f.name)
        );
      });
    for (const f of frames) {
      if (!isMask(f) || f.children.some((k) => k.name.startsWith("背景:")))
        continue;
      const [c, suf] = keyOf(f);
      const e = entryOf(c === "AC-03" ? AC03[suf] : MAP[c] || "");
      if (!e) continue; // 入口畫面沒有這個尺寸:留給人判斷
      const bg = e.clone();
      f.insertChild(0, bg);
      bg.x = bg.y = 0;
      bg.name = "背景:" + e.name;
      bg.locked = true;
      const sc = figma.createRectangle();
      sc.name = "scrim";
      f.insertChild(1, sc);
      sc.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
      sc.opacity = 0.5;
      const H = Math.max(f.height, bg.height);
      f.resize(f.width, H);
      sc.resize(f.width, H);
      f.fills = e.fills;
    }
  }
}

if (PART === "20") {
  // 第二十輪(在 Figma 上直接改,這裡記做法):
  // 1. [最近售出] / [最近兌獎]:ST-35 拆成 a(售出提示)/ b(清單);ST-35b、ST-38b 三尺寸的清單改成
  //    電腦右側抽屜(加 ✕)、平板右側抽屜(寬 400、滿高)、手機底部面板(拉桿綁 divider + ✕,貼底),背後加 scrim;
  //    清單第二列改顯示「已撤銷」(灰字);ST-36 手機底部面板的 [收合] 換成 ✕。框外註解寫開關方式。
  // 2. 放不下的手機分頁列(ST-40 · 手機,以及 ST-06 · 手機背景裡的副本):外面包「PageTabs(可捲動)」(clip),
  //    分頁列單列 NO_WRAP,往左移到選到的分頁可見;有更多分頁的一側放 scroll-edge:start / end(漸層 + ‹ / ›)。
  // 3. 權限:全部專案頁(班表管理除外)掃按鈕,在畫面的框外註解加「- 權限:沒有 `<權限>` 權限時看不到 [按鈕]」。
}
