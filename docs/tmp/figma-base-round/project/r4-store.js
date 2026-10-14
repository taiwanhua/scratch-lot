// 第四~六輪「Screen / 店面管理」(65:14):卡片原地展開 ST-36、拆本選本 ST-37、手動標記確認 ST-07、日結版結帳確認申請 ST-28b。
// 前置:r4-lib.js + 本檔,一次跑一段(PART = "36" | "36m" | "37" | "07" | "28b" | "09" | "18")。各段都從現有畫面複製(ST-01、ST-09、ST-28a)再改內容。
// 畫完跑 brand-rebind.js(複製的 Button 換變體會帶回底座主色),最後跑 r4-layout.js 排列。
await figma.setCurrentPageAsync(await figma.getNodeByIdAsync("65:14"));
const cardsIn = async (f) => {
  const r = [];
  for (const i of f.findAllWithCriteria({ types: ["INSTANCE"] })) {
    const mc = await i.getMainComponentAsync();
    if (mc && mc.parent && mc.parent.id === "64:558") r.push(i);
  }
  r.sort((a, b) => {
    const A = a.absoluteBoundingBox,
      Bx = b.absoluteBoundingBox;
    return A.y - Bx.y || A.x - Bx.x;
  });
  return r;
};
const metaOf = (k) => k.findOne((n) => n.name === "meta").characters;
const ST36_LEGEND = ["未售", "已售", "本班售出", "在別的收銀點", "已選"];
// 看板上 5164 056527 這本:001~040 已售、041~065 在店外攤位、066~077 本班售出、078~100 未售(剩 23)
const MODES = {
  a: {
    t: "卡片展開:本機收銀點,選未售",
    m: "底部面板:本機收銀點,選未售",
    book: "056527",
    where: "店內櫃台",
    left: "剩 23 / 100",
    sel: ["080", "081"],
    bar: "已選 2 張 #080、#081",
    btns: async () => [
      await B("標記售出", "Contained"),
      await B("移櫃"),
      await B("收回"),
      await B("取消選取", "Text"),
    ],
  },
  b: {
    t: "卡片展開:本機收銀點,選本班售出",
    m: "底部面板:本機收銀點,選本班售出",
    book: "056527",
    where: "店內櫃台",
    left: "剩 23 / 100",
    sel: ["076", "077"],
    bar: "已選 2 張 #076、#077(本班售出)",
    btns: async () => [
      await B("撤銷售出", "Outlined", "Small", "Error"),
      await B("取消選取", "Text"),
    ],
  },
  c: {
    t: "卡片展開:其他收銀點",
    m: "底部面板:其他收銀點",
    book: "056528",
    where: "店外攤位",
    left: "剩 35 / 100",
    sel: ["070"],
    bar: "已選 1 張 #070",
    btns: async () => [
      await B("移櫃"),
      await B("移櫃並售出", "Contained"),
      await B("取消選取", "Text"),
    ],
  },
};
const stOf = (m) =>
  m === "c"
    ? (no) => (MODES.c.sel.includes(no) ? "sel" : +no <= 65 ? "off" : null)
    : (no) =>
        MODES[m].sel.includes(no)
          ? "sel"
          : +no <= 40
            ? "off"
            : +no <= 65
              ? "other"
              : +no <= 77
                ? "shift"
                : null;
async function prepBoard(f, M) {
  const cards = await cardsIn(f);
  const target = cards.find((k) => metaOf(k).includes(M.book));
  const local = cards.find((k) => metaOf(k).includes("056527"));
  if (local) {
    await setT(
      local.findOne((n) => n.name === "left"),
      "剩 23 / 100",
    );
    const r = local.findOne((n) => n.type === "RECTANGLE");
    r.resize(Math.round(r.parent.width * 0.23), r.height);
  }
  target.strokes = [primaryPaint];
  target.strokeWeight = 2;
  return target;
}

if (PART === "36") {
  // 電腦(65:15 複製)、平板(124:5578 複製):在卡片那一列下面插入展開區,占滿整列
  for (const [src, label, suffix] of [
    ["65:15", "電腦 1440", ""],
    ["124:5578", "平板 1024", " · 平板"],
  ])
    for (const m of ["a", "b", "c"]) {
      const M = MODES[m];
      const f = (await figma.getNodeByIdAsync(src)).clone();
      f.name = `ST-36${m}${suffix} ${M.t}`;
      fileIn(label, f);
      // 電腦版的說明框是設計註解,不放在畫面裡
      for (const t of f.findAll(
        (x) => x.type === "TEXT" && x.characters.startsWith("本機收銀點 = "),
      )) {
        let inst = null;
        for (let p = t.parent; p && p !== f; p = p.parent)
          if (p.type === "INSTANCE") inst = p;
        (inst || t).remove();
      }
      const target = await prepBoard(f, M);
      const row = target.parent,
        host = row.parent;
      const p = await panel("card-expand(展開的張數格子)", 12, 16);
      host.insertChild(host.children.indexOf(row) + 1, p);
      p.layoutSizingHorizontal = "FILL";
      const h = add(
        p,
        AL("HORIZONTAL", {
          name: "head",
          itemSpacing: 8,
          counterAxisAlignItems: "CENTER",
        }),
        "FILL",
      );
      add(h, await T("h6", `5164 發大財 · 本號 ${M.book}`));
      add(h, await T("body2", `${M.where} · 200 元 · ${M.left}`));
      sp(h);
      add(h, await B("本的詳情"));
      add(h, await B("收合", "Text"));
      add(p, await selBar(M.bar, await M.btns()), "FILL");
      add(
        p,
        await withLegend(
          await grid(100, stOf(m), 10, suffix ? 36 : 40),
          ST36_LEGEND,
        ),
      );
      fitShell(f, f.height);
      if (m === "a" && !suffix) {
        // tooltip 示意:滑過虛線格子顯示收銀點名稱
        const set = await figma.importComponentSetByKeyAsync(
          "bd2762a43cd644fd271d0626866e79fb86ede120",
        );
        const cell = f.findOne(
          (n) =>
            n.type === "INSTANCE" &&
            n.findOne &&
            n.findOne((t) => t.type === "TEXT" && t.characters === "045"),
        );
        const tip = set.defaultVariant.createInstance();
        tip.name = "tooltip(滑過虛線格子)";
        for (const t of tip.findAll((x) => x.type === "TEXT"))
          await setT(t, "在店外攤位");
        f.appendChild(tip);
        tip.layoutPositioning = "ABSOLUTE";
        const fb = f.absoluteBoundingBox,
          cb = cell.absoluteBoundingBox;
        tip.x = Math.round(cb.x - fb.x + cb.width / 2 - tip.width / 2);
        tip.y = Math.round(cb.y - fb.y - tip.height - 6);
      }
    }
}

if (PART === "36m") {
  // 手機(124:5927 複製):看板上蓋半透明遮罩 + 底部面板(可拉成全螢幕)
  for (const m of ["a", "b", "c"]) {
    const M = MODES[m];
    const f = (await figma.getNodeByIdAsync("124:5927")).clone();
    f.name = `ST-36${m} · 手機 ${M.m}`;
    fileIn("手機 390", f);
    const content = f.findOne(
      (n) => n.name === "content" && n.type === "FRAME",
    );
    const kids = [...content.children];
    const idx = (nm) => kids.findIndex((k) => k.name === nm);
    const iIn = idx("cash-point:店內櫃台"),
      iOut = idx("cash-point:店外攤位"),
      iMac = idx("cash-point:彩券機旁");
    // 只留一個畫面高度內的看板
    if (m === "c") {
      kids[iIn + 1].remove();
      if (iMac >= 0) kids[iMac].remove();
      const al = content.children.find((n) => n.name === "Draft/Alert");
      if (al) al.remove();
    } else for (let k = iOut; k < kids.length; k++) kids[k].remove();
    await prepBoard(f, M);
    f.resize(390, 844);
    f.clipsContent = true;
    f.findOne((n) => n.name === "main").layoutSizingVertical = "FILL";
    const scrim = figma.createRectangle();
    scrim.name = "scrim";
    scrim.resize(390, 844);
    scrim.fills = [
      { type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.5 },
    ];
    f.appendChild(scrim);
    scrim.layoutPositioning = "ABSOLUTE";
    const sh = await dbox("bottom-sheet(可拉成全螢幕)", 390, 12);
    sh.paddingLeft = sh.paddingRight = 16;
    sh.paddingTop = 8;
    sh.bottomLeftRadius = sh.bottomRightRadius = 0;
    f.appendChild(sh);
    sh.layoutPositioning = "ABSOLUTE";
    const hw = add(
      sh,
      AL("HORIZONTAL", {
        name: "drag-handle",
        primaryAxisAlignItems: "CENTER",
      }),
      "FILL",
    );
    const hb = figma.createRectangle();
    hb.resize(40, 4);
    hb.cornerRadius = 2;
    hb.fills = [cellV.Available.strokes[0]];
    hw.appendChild(hb);
    const h = add(
      sh,
      AL("HORIZONTAL", {
        name: "head",
        itemSpacing: 8,
        counterAxisAlignItems: "CENTER",
      }),
      "FILL",
    );
    const tv = add(
      h,
      AL("VERTICAL", { name: "title", itemSpacing: 2 }),
      "FILL",
    );
    add(tv, await T("sub2", `5164 發大財 · 本號 ${M.book}`));
    add(tv, await T("cap", `${M.where} · 200 元 · ${M.left}`));
    add(h, await B("本的詳情"));
    add(h, await B("收合", "Text"));
    add(
      sh,
      await selBar(m === "b" ? "已選 2 張(本班售出)" : M.bar, await M.btns()),
      "FILL",
    );
    add(
      sh,
      await withLegend(await grid(100, stOf(m), 10, 31), ST36_LEGEND),
      "FILL",
    );
    sh.x = 0;
    sh.y = Math.max(60, 844 - sh.height);
  }
}

if (PART === "37" || PART === "07") {
  // 對話框:電腦從 ST-09(123:5225)複製、平板從 ST-09 平板(124:24322)、手機從 ST-09 手機(124:24739)
  const is37 = PART === "37";
  const rSel = await figma.getNodeByIdAsync("87:2479"),
    rDef = await figma.getNodeByIdAsync("87:2482");
  const head = async (host, title, sub) => {
    const h = AL("HORIZONTAL", {
      name: "head",
      itemSpacing: 8,
      counterAxisAlignItems: "CENTER",
    });
    host.insertChild(0, h);
    h.layoutSizingHorizontal = "FILL";
    add(h, await T("h6", title));
    sp(h);
    if (sub) add(h, await T("body2", sub));
  };
  const actions = async (host) => {
    const a = add(
      host,
      AL("HORIZONTAL", {
        name: "actions",
        itemSpacing: 8,
        counterAxisAlignItems: "CENTER",
      }),
      "FILL",
    );
    add(a, await B("取消", "Text", "Medium"));
    sp(a);
    add(a, await B(is37 ? "下一步" : "確認售出", "Contained", "Medium"));
  };
  const body37 = async (host, W) => {
    const tf = add(host, N.tf.clone(), "FILL");
    for (const t of tf.findAll((x) => x.type === "TEXT")) {
      if (t.name === "label") await setT(t, "刷條碼或輸入本號");
      if (t.name === "value") await setT(t, "060116");
    }
    add(
      host,
      await T("body2", "本店還沒拆的本(4 本);刷條碼會直接選中那一本。"),
    );
    const list = add(
      host,
      AL("VERTICAL", { name: "unopened-books", itemSpacing: 0 }),
      "FILL",
    );
    for (const [on, a, b] of [
      [
        true,
        "5201 金好運 · 本號 060116",
        "100 元 · 張號 001~102 · 待標註 2 張(拆本時要標好)",
      ],
      [false, "5198 鼠來寶 · 本號 088104", "100 元 · 100 張"],
      [false, "5133 招財貓 · 本號 071205", "1,000 元 · 25 張"],
      [false, "5164 發大財 · 本號 056531", "200 元 · 100 張"],
    ]) {
      const r = add(
        list,
        AL("HORIZONTAL", {
          name: "book-row",
          itemSpacing: 12,
          paddingTop: 10,
          paddingBottom: 10,
          paddingLeft: 8,
          paddingRight: 8,
          counterAxisAlignItems: "CENTER",
        }),
        "FILL",
      );
      if (on) {
        r.fills = N.bar.fills;
        r.cornerRadius = 4;
      }
      add(r, (on ? rSel : rDef).clone());
      const v = add(
        r,
        AL("VERTICAL", { name: "text", itemSpacing: 2 }),
        "FILL",
      );
      add(v, await T("body1", a));
      add(v, await TW("cap", b, Math.max(160, W - 60)), "FILL");
    }
  };
  const body07 = async (host, W) => {
    add(host, await kv("收銀點", "店內櫃台(王小明 08:02 開的班)"), "FILL");
    add(host, await kv("張號", "#080~081(2 張)"), "FILL");
    add(host, await kv("單張金額", "200 元"), "FILL");
    add(host, await kv("合計", "400 元"), "FILL");
    const s = add(host, N.sel.clone(), "FILL");
    for (const t of s.findAll((x) => x.type === "TEXT")) {
      if (t.name === "label") await setT(t, "原因");
      if (t.name === "value") await setT(t, "刷不到條碼");
    }
    add(
      host,
      await TW("body2", "售出算進店內櫃台這一班,應有現金 +400。", W),
      "FILL",
    );
  };
  const body = is37 ? body37 : body07;
  const title = is37 ? "拆本 · 選要拆的本" : "標記售出";
  const sub = is37 ? "放到本機收銀點:店內櫃台" : "5164 發大財 · 本號 056527";
  {
    const f = (await figma.getNodeByIdAsync("123:5225")).clone();
    f.name = is37
      ? "ST-37 Overlay / 拆本:先選要拆的本(本店未拆的本、可刷條碼)"
      : "ST-07 Overlay / 手動標記售出確認(原因必選)";
    fileIn("電腦 1440", f);
    const row = f.findOne((n) => n.name === "dialogs");
    row.children[1].remove();
    const d = row.children[0];
    d.name = "dialog:" + title;
    for (const k of [...d.children]) k.remove();
    if (!is37) d.resize(480, d.height);
    await body(d, d.width - 48);
    await actions(d);
    await head(d, title, sub);
  }
  {
    const f = (await figma.getNodeByIdAsync("124:24322")).clone();
    f.name = is37 ? "ST-37 · 平板 拆本:選要拆的本" : "ST-07 · 平板 標記售出";
    fileIn("平板 1024", f);
    const d = f.findOne((n) => n.name === "dialog");
    for (const k of [...d.children]) k.remove();
    await body(d, d.width - 48);
    await actions(d);
    await head(d, title, is37 ? "放到:店內櫃台" : sub);
    f.resize(f.width, Math.max(768, d.y + d.height + 48));
  }
  {
    const f = (await figma.getNodeByIdAsync("124:24739")).clone();
    f.name = is37 ? "ST-37 · 手機 拆本:選要拆的本" : "ST-07 · 手機 標記售出";
    fileIn("手機 390", f);
    const c = f.findOne((n) => n.name === "content" && n.type === "FRAME");
    for (const k of [...c.children]) k.remove();
    const bar = f.findOne((n) => n.name === "app-bar");
    await setT(
      bar.children.find(
        (x) => x.type === "TEXT" && x.characters.startsWith("拆本"),
      ),
      title,
    );
    const ob = bar.children.find((x) => x.type === "INSTANCE");
    bar.insertChild(
      bar.children.indexOf(ob),
      await B(is37 ? "下一步" : "確認售出", "Text", "Medium"),
    );
    ob.remove();
    if (!is37) add(c, await T("body2", sub));
    await body(c, 358);
  }
}

if (PART === "28b") {
  // 日結版結帳確認申請:複製 ST-28a(90:3362)改內容;平板 / 手機把各區塊依序疊成一欄
  const D = [1000, 500, 100, 50, 10, 5, 1];
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const denoms = async (inst, counts) => {
    const ts = inst.findAll((t) => t.type === "TEXT");
    let k = 0;
    for (let i = 0; i < ts.length; i++)
      if (ts[i].name === "value") {
        await setT(ts[i], String(counts[k]));
        await setT(ts[i + 2], fmt(D[k] * counts[k]));
        k++;
      }
    await setT(
      ts[ts.length - 1],
      fmt(counts.reduce((s, c, j) => s + c * D[j], 0)),
    );
  };
  const f = (await figma.getNodeByIdAsync("90:3362")).clone();
  f.name = "ST-28b 結帳確認申請 檢視頁(日結)";
  fileIn("電腦 1440", f);
  const c = f.children
    .find((n) => n.name === "main")
    .children.find((n) => n.name === "content");
  const headF = c.children.find((n) => n.name === "doc-head");
  await setT(
    headF.findOne(
      (t) => t.type === "TEXT" && t.characters.startsWith("結帳確認申請"),
    ),
    "結帳確認申請 · 日結 C-0043",
  );
  await setT(
    headF.findOne(
      (t) => t.type === "TEXT" && t.characters.startsWith("申請人"),
    ),
    "申請人 李小華 · 送出 10/16 22:30",
  );
  const det = c.findOne((n) => n.name === "checkout-detail");
  const kvs = det.children.filter((n) => n.name === "kv");
  const rows = [
    ["類型", "日結"],
    ["涵蓋計算期間", "10/16 09:02 ~ 10/16 22:30"],
    ["涵蓋計算的班", "3 班(C-0040、C-0041、C-0042,全部已核准)"],
    ["全店盤點", "沿用 21:40 全店盤點 S-0032"],
    ["小金庫期初", "20,000"],
    ["投庫(3 筆)", "+ 8,000"],
    ["出庫(1 筆)", "− 3,000"],
    ["小金庫應有", "25,000"],
    ["實點", "25,000"],
    ["差額", "0"],
    ["存入銀行", "20,000 → 台銀 ·····12345"],
    ["存入後小金庫", "5,000"],
  ];
  while (kvs.length < rows.length) {
    const n = kvs[kvs.length - 1].clone();
    det.insertChild(det.children.indexOf(kvs[kvs.length - 1]) + 1, n);
    kvs.push(n);
  }
  for (let i = 0; i < rows.length; i++) {
    const ts = kvs[i].findAll((t) => t.type === "TEXT");
    await setT(ts[0], rows[i][0]);
    await setT(ts[ts.length - 1], rows[i][1]);
  }
  const normal = kvs[0].findAll((t) => t.type === "TEXT").pop().fills;
  for (const i of [8, 9])
    kvs[i].findAll((t) => t.type === "TEXT").pop().fills = normal;
  await setT(
    det.findOne((t) => t.type === "TEXT" && t.characters.startsWith("每一項")),
    "每一項可以點開原本的單據。",
  );
  await denoms(
    c.findOne(
      (n) => n.type === "INSTANCE" && n.name === "Draft/DenominationCount",
    ),
    [20, 6, 18, 2, 10, 0, 0],
  );
  const rv = c.findOne((n) => n.name === "review(審核區塊)");
  await setT(
    rv.findOne((t) => t.type === "TEXT" && t.characters.startsWith("李小華")),
    "李小華 22:30",
  );
  await setT(
    rv.findOne((t) => t.type === "TEXT" && t.characters.startsWith("店長限定")),
    "店長限定「中山店」,照常審核",
  );
  // 底部那行審核規則是設計註解,不放在畫面裡
  const note = c.children.find(
    (n) => n.type === "TEXT" && n.characters.startsWith("駁回、作廢"),
  );
  if (note) note.remove();
  for (const [src, label, suffix, minH] of [
    ["124:5578", "平板 1024", " · 平板", 768],
    ["124:5927", "手機 390", " · 手機", 844],
  ]) {
    const { f: s, c: sc } = await shellOf(
      src,
      `ST-28b${suffix} 結帳確認申請(日結)`,
      "店面管理",
    );
    fileIn(label, s);
    sc.itemSpacing = 12;
    for (const part of c.children) {
      const list = part.name === "body" ? part.children : [part];
      for (const p of list) {
        const k = p.clone();
        add(sc, k, "FILL");
        if (k.type === "TEXT") k.textAutoResize = "HEIGHT";
        else k.layoutSizingVertical = "HUG";
      }
    }
    const dh = sc.children.find((n) => n.name === "doc-head");
    const r = dh.children[0];
    r.layoutWrap = "WRAP";
    r.counterAxisSpacing = 8;
    if (suffix === " · 手機") {
      const spx = r.children.find((x) => x.name === "spacer");
      if (spx) spx.remove();
      for (const t of s.findAll(
        (x) => x.type === "TEXT" && x.characters.startsWith("3 班("),
      ))
        await setT(t, "3 班,全部已核准");
      for (const t of s.findAll(
        (x) => x.type === "TEXT" && x.characters.startsWith("20,000 → 台銀"),
      ))
        await setT(t, "20,000(台銀 ·····12345)");
    }
    fitShell(s, minH);
  }
}

if (PART === "09") {
  // 拆本兩步(第八輪):a ① 標跳號、b ② 全部放到本機收銀點(預設)、c ② 分放到多個收銀點(分配到一半 + 表格)。
  // 從 ST-37 的三種尺寸複製(電腦 / 平板是遮罩 + 對話框,手機全螢幕);格子每列 10 格。
  const stepSet = await figma.getNodeByIdAsync("79:1325");
  const narrowV = (await figma.getNodeByIdAsync("79:1361")).children.find(
    (v) => v.name === "Width=Narrow",
  );
  const rSel = await figma.getNodeByIdAsync("87:2479"),
    rDef = await figma.getNodeByIdAsync("87:2482");
  const stepper = async (cur, narrow) => {
    if (narrow) {
      const n = narrowV.createInstance();
      for (const t of n.findAll((x) => x.type === "TEXT"))
        await setT(
          t,
          cur === 1 ? "第 1 / 2 步 · 標跳號" : "第 2 / 2 步 · 放到哪個收銀點",
        );
      return n;
    }
    const r = AL("HORIZONTAL", {
      name: "stepper",
      itemSpacing: 12,
      counterAxisAlignItems: "CENTER",
    });
    for (const [i, l] of [
      [1, "標跳號"],
      [2, "放到哪個收銀點"],
    ]) {
      if (i === 2) {
        const ln = figma.createRectangle();
        ln.name = "connector";
        ln.resize(48, 2);
        ln.fills = [cellV.Available.strokes[0]];
        r.appendChild(ln);
      }
      const s = stepSet.children
        .find(
          (v) =>
            v.name ===
            "State=" + (i < cur ? "Done" : i === cur ? "Current" : "Todo"),
        )
        .createInstance();
      s.setProperties({ "Index#79:0": String(i), "Label#79:5": l });
      r.appendChild(s);
    }
    return r;
  };
  const radioRow = async (host, on, label) => {
    const r = add(
      host,
      AL("HORIZONTAL", {
        name: "option",
        itemSpacing: 10,
        counterAxisAlignItems: "CENTER",
      }),
      "FILL",
    );
    add(r, (on ? rSel : rDef).clone());
    add(r, await T("body1", label));
    return r;
  };
  const table = async (host) => {
    const t = add(
      host,
      AL("VERTICAL", { name: "table", itemSpacing: 0 }),
      "FILL",
    );
    for (const [a, b, c, h] of [
      ["收銀點", "張號", "張數", true],
      ["店外攤位", "#001~050(不含跳號 #037)", "49"],
      ["未分配", "#051~102(不含跳號 #064)", "51"],
    ]) {
      const r = add(
        t,
        AL("HORIZONTAL", {
          name: h ? "thead" : "tr",
          itemSpacing: 12,
          paddingTop: 8,
          paddingBottom: 8,
          counterAxisAlignItems: "CENTER",
        }),
        "FILL",
      );
      add(r, await TW(h ? "body2" : "body1", a, 100));
      const m = add(r, await T(h ? "body2" : "body1", b), "FILL");
      m.textAutoResize = "HEIGHT";
      const z = await TW(h ? "body2" : "body1", c, 48);
      z.textAlignHorizontal = "RIGHT";
      add(r, z);
      if (h) r.fills = N.bar.fills;
    }
  };
  const body = async (host, step, W, cell, mobile) => {
    if (!mobile) {
      const h = add(
        host,
        AL("HORIZONTAL", {
          name: "head",
          itemSpacing: 8,
          counterAxisAlignItems: "CENTER",
        }),
        "FILL",
      );
      add(h, await T("h6", "拆本 · 5201 金好運 · 本號 060116"));
      sp(h);
      add(h, await T("body2", "100 元 · 張號 001~102"));
    } else add(host, await T("body2", "本號 060116 · 100 元 · 張號 001~102"));
    add(
      host,
      await stepper(step === "a" ? 1 : 2, mobile),
      mobile ? "FILL" : null,
    );
    if (step === "a") {
      add(
        host,
        await TW(
          "body2",
          "迄號 102 比標準張數多 2 張,有 2 個號碼不存在。點出不存在的號碼:",
          W,
        ),
        "FILL",
      );
      add(
        host,
        await withLegend(
          await grid(
            102,
            (no) => (["037", "064"].includes(no) ? "sel" : null),
            10,
            cell,
          ),
          ["未售", "已選"],
        ),
      );
      add(host, await kv("已選", "2 / 2:#037、#064"), "FILL");
    } else if (step === "b") {
      const s = N.sel.clone();
      for (const t of s.findAll((x) => x.type === "TEXT")) {
        if (t.name === "label") await setT(t, "收銀點");
        if (t.name === "value") await setT(t, "店內櫃台(本機)");
      }
      add(await radioRow(host, true, "全部放到"), s, "FILL");
      await radioRow(host, false, "分放到多個收銀點");
      add(host, await kv("張數", "100 張(不含跳號 #037、#064)"), "FILL");
    } else {
      await radioRow(host, false, "全部放到店內櫃台(本機)");
      await radioRow(host, true, "分放到多個收銀點");
      add(host, await TW("body2", "在格子選張,再點要放的收銀點:", W), "FILL");
      const ch = add(
        host,
        AL("HORIZONTAL", {
          name: "cash-points",
          itemSpacing: 8,
          layoutWrap: "WRAP",
          counterAxisSpacing: 8,
        }),
        "FILL",
      );
      add(ch, await B("店內櫃台(本機)"));
      add(ch, await B("店外攤位", "Contained"));
      add(ch, await B("彩券機旁"));
      add(host, await T("sub2", "已選 10 張 #051~060"));
      add(
        host,
        await withLegend(
          await grid(
            102,
            (no) =>
              ["037", "064"].includes(no)
                ? "skip"
                : +no <= 50
                  ? "assigned"
                  : +no <= 60
                    ? "sel"
                    : null,
            10,
            cell,
          ),
          ["未分配", "跳號", "已選", "已分配"],
        ),
      );
      await table(host);
      add(
        host,
        await TW("body2", "還有 51 張沒分配,全部分配完才能確認拆本。", W),
        "FILL",
      );
    }
    const a = add(
      host,
      AL("HORIZONTAL", {
        name: "actions",
        itemSpacing: 8,
        counterAxisAlignItems: "CENTER",
      }),
      "FILL",
    );
    add(a, await B(step === "a" ? "取消" : "上一步", "Text", "Medium"));
    sp(a);
    add(
      a,
      await B(
        step === "a" ? "下一步" : "確認拆本",
        "Contained",
        "Medium",
        "Primary",
        step === "c" ? "Disabled" : "Default",
      ),
    );
  };
  const NAMES = {
    a: "① 標跳號",
    b: "② 全部放到本機收銀點",
    c: "② 分放到多個收銀點",
  };
  for (const st of ["a", "b", "c"]) {
    {
      const f = (await figma.getNodeByIdAsync("143:33884")).clone(); // ST-37 電腦
      f.name = `ST-09${st} Overlay / 拆本 ${NAMES[st]}`;
      fileIn("電腦 1440", f);
      const d = f.findOne((n) => n.name.startsWith("dialog:"));
      d.name = "dialog:拆本";
      for (const k of [...d.children]) k.remove();
      d.resize(560, d.height);
      await body(d, st, 512, 40, false);
      f.resize(Math.max(1440, f.width), Math.max(900, d.height + 128));
    }
    {
      const f = (await figma.getNodeByIdAsync("143:34208")).clone(); // ST-37 平板
      f.name = `ST-09${st} · 平板 拆本 ${NAMES[st]}`;
      fileIn("平板 1024", f);
      const d = f.findOne((n) => n.name === "dialog");
      for (const k of [...d.children]) k.remove();
      await body(d, st, d.width - 48, 40, false);
      f.resize(f.width, Math.max(768, d.y + d.height + 48));
    }
    {
      const f = (await figma.getNodeByIdAsync("143:34382")).clone(); // ST-37 手機
      f.name = `ST-09${st} · 手機 拆本 ${NAMES[st]}`;
      fileIn("手機 390", f);
      const c = f.findOne((n) => n.name === "content" && n.type === "FRAME");
      for (const k of [...c.children]) k.remove();
      const bar = f.findOne((n) => n.name === "app-bar");
      await setT(
        bar.children.find(
          (x) => x.type === "TEXT" && x.characters.startsWith("拆本"),
        ),
        "拆本 · 5201 金好運",
      );
      const ob = bar.children.find((x) => x.type === "INSTANCE");
      if (ob) ob.remove();
      await body(c, st, 358, 31, true);
      fitShell(f, 844);
    }
  }
}

if (PART === "18") {
  // ST-18 交班結帳 ③ 平板 / 手機:面額清點合計對上實點 4,800(1,000×4、500×1、100×2、50×1、10×4、5×2)
  const D = [1000, 500, 100, 50, 10, 5, 1];
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  for (const id of ["124:26174", "124:26507"]) {
    const inst = await figma.getNodeByIdAsync(id);
    const cnt = [4, 1, 2, 1, 4, 2, 0];
    const ts = inst.findAll((t) => t.type === "TEXT");
    let k = 0;
    for (let i = 0; i < ts.length; i++)
      if (ts[i].name === "value") {
        await setT(ts[i], String(cnt[k]));
        await setT(ts[i + 2], fmt(D[k] * cnt[k]));
        k++;
      }
    await setT(ts[ts.length - 1], "4,800");
  }
}
