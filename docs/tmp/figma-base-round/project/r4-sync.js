// 第十四輪「Screen / 店面管理」(65:14):三尺寸同步、最近兌獎規則、撤銷兌獎確認。前置:r4-lib.js + `const PART = "…";` + 本檔。
// 元件化(StoreTopBar / NavRail / CashPointHeader 的 Size 變體)見 components.js 第 5、9、10 節;手畫框換實例用 PART "swap"。
// 依序:swap → 34 → 35 → 38 → 41 → 20 → wiz → fix,最後跑 brand-rebind.js、r4-layout.js、audit.js、audit-sync.js。
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
