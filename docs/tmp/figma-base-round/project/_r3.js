// ==== 第三輪工具(三種尺寸)====
// 前置:`const PROJECT = true;` + ../_kit.js + 本檔 + 畫面腳本。
// 每個模組頁由上到下三個 Section:電腦 1440 / 平板 1024 / 手機 390;框名以畫面編號開頭(例「ST-13 · 手機」),
// 三區的畫面順序與編號相同(relayoutSizes() 依名稱排序)。
const SIZES = {
  desk: ["電腦 1440", 1440],
  tab: ["平板 1024", 1024],
  mob: ["手機 390", 390],
};
async function pageOf(name, id) {
  let p = id
    ? await figma.getNodeByIdAsync(id)
    : figma.root.children.find((x) => x.name === name);
  if (!p) {
    p = figma.createPage();
    p.name = name;
  }
  await figma.setCurrentPageAsync(p);
  return p;
}
function sizeSection(key) {
  const label = SIZES[key][0];
  let s = figma.currentPage.children.find(
    (n) => n.type === "SECTION" && n.name === label,
  );
  if (!s) {
    s = figma.createSection();
    s.name = label;
    const ys = figma.currentPage.children
      .filter((n) => n !== s)
      .map((n) => n.y + n.height);
    s.x = 0;
    s.y = ys.length ? Math.max(...ys) + 400 : 0;
    s.resizeWithoutConstraints(2000, 1200);
  }
  return s;
}
// 放進尺寸區塊(先放最右邊;最後 relayoutSizes() 統一排序)
function fileIn(key, n) {
  const s = sizeSection(key);
  const right = s.children.reduce((m, c) => Math.max(m, c.x + c.width), 0);
  s.appendChild(n);
  n.x = right ? right + 120 : 120;
  n.y = 120;
  return n;
}
const idKey = (name) => {
  const m = /^([A-Z]{2})-(\d\d)/.exec(name);
  return m ? m[1] + m[2] + name.slice(5) : "ZZ" + name;
};
function relayoutSizes() {
  let y = 0;
  for (const key of ["desk", "tab", "mob"]) {
    const s = figma.currentPage.children.find(
      (n) => n.type === "SECTION" && n.name === SIZES[key][0],
    );
    if (!s) continue;
    const kids = [...s.children].sort((a, b) =>
      idKey(a.name) < idKey(b.name) ? -1 : 1,
    );
    let x = 120,
      h = 0;
    for (const k of kids) {
      k.x = x;
      k.y = 160;
      x += k.width + 120;
      h = Math.max(h, k.height);
    }
    s.x = 0;
    s.y = y;
    s.resizeWithoutConstraints(Math.max(x, 2000), h + 280);
    y += s.height + 400;
  }
  // 其他區塊(例:58mm 單據)接在三種尺寸之後
  const labels = Object.values(SIZES).map((v) => v[0]);
  for (const s of figma.currentPage.children.filter(
    (n) => n.type === "SECTION" && !labels.includes(n.name),
  )) {
    s.x = 0;
    s.y = y;
    y += s.height + 400;
  }
}
// 撐高後放進尺寸區塊
function doneIn(key, x) {
  const isNode = typeof x.type === "string";
  if (!isNode && x.content) (x.dev ? fitDev : fit)(x);
  if (!isNode && x.fin) x.fin();
  const n = isNode ? x : x.s || x.ov;
  fileIn(key, n);
  made.push([n.name, n.id]);
  return n;
}
// ---- 平板 / 手機殼 ----
// 平板 1024(橫放):左側收合的圖示列 + 頂列;手機 390:頂列(☰ + 標題)
async function dev(name, key, title, o = {}) {
  const w = SIZES[key][1],
    h = key === "tab" ? 768 : 844;
  const s = figma.createFrame();
  s.name = name;
  s.layoutMode = "HORIZONTAL";
  s.resize(w, h);
  s.primaryAxisSizingMode = "FIXED";
  s.counterAxisSizingMode = "FIXED";
  s.fills = [await paint("bg/default")];
  s.clipsContent = true;
  if (key === "tab") {
    const rail = V(4, {
      name: "nav-rail(收合側欄)",
      paddingTop: 16,
      paddingLeft: 12,
      paddingRight: 12,
    });
    rail.fills = [await paint("bg/paper")];
    rail.strokes = [await paint("divider")];
    rail.strokeTopWeight = rail.strokeLeftWeight = rail.strokeBottomWeight = 0;
    rail.strokeRightWeight = 1;
    for (const ic of ["≡", "◧", "▤", "⇄", "$", "▦", "☰"]) {
      const b = H(0, {
        name: "rail-item",
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 10,
        paddingBottom: 10,
      });
      add(b, await T(ic, "Subtitle/1", "text/secondary"));
      add(rail, b);
    }
    add(s, rail, null, "FILL");
  }
  const main = add(s, V(0, { name: "main" }), "FILL", "FILL");
  main.clipsContent = true;
  const bar = add(
    main,
    H(8, {
      name: "app-bar",
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 12,
      paddingBottom: 12,
    }),
    "FILL",
  );
  bar.fills = [await paint("bg/paper")];
  bar.strokes = [await paint("divider")];
  bar.strokeTopWeight = bar.strokeLeftWeight = bar.strokeRightWeight = 0;
  bar.strokeBottomWeight = 1;
  if (o.back) add(bar, await T("←", "Subtitle/1"));
  else if (key === "mob") add(bar, await T("☰", "Subtitle/1"));
  add(bar, await T(title, "Subtitle/1"));
  spacer(bar);
  for (const x of o.right || []) add(bar, x);
  if (!o.right) add(bar, await T("中山店 ▾", "Body/2", "text/secondary"));
  const content = add(
    main,
    V(12, {
      name: "content",
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 16,
      paddingBottom: o.bottomBar ? 88 : 16,
    }),
    "FILL",
    "FILL",
  );
  let bottom = null;
  if (o.bottomBar) {
    bottom = H(8, {
      name: "bottom-bar(固定在底部)",
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 12,
      paddingBottom: 12,
    });
    bottom.fills = [await paint("bg/paper")];
    bottom.strokes = [await paint("divider")];
    bottom.strokeTopWeight = 1;
    bottom.strokeLeftWeight =
      bottom.strokeRightWeight =
      bottom.strokeBottomWeight =
        0;
    main.appendChild(bottom);
    bottom.layoutPositioning = "ABSOLUTE";
    bottom.primaryAxisSizingMode = "FIXED";
    bottom.primaryAxisAlignItems = "SPACE_BETWEEN"; // 左右兩端:次要動作在左、主要動作在右
    for (const x of o.bottomBar) add(bottom, x);
  }
  return { s, main, content, bar, bottom, dev: true, h };
}
function fitDev(sh) {
  const { s, content, main, bottom, h } = sh;
  content.layoutSizingVertical = "HUG";
  const need = content.y + content.height;
  s.resize(s.width, Math.max(h, Math.ceil(need / 10) * 10));
  content.layoutSizingVertical = "FILL";
  if (bottom) {
    bottom.resize(main.width, bottom.height);
    bottom.x = 0;
    bottom.y = s.height - bottom.height;
  }
}
// 手機 / 平板的彈窗:手機全螢幕(頂列 ✕ + 標題 + 主要按鈕),平板置中卡片
async function devDialog(name, key, title, primary) {
  if (key === "mob") {
    const sh = await dev(name, "mob", title, {
      back: true,
      right: primary ? [await btn(primary, "Text")] : [],
    });
    await setText(sh.bar, "←", "✕");
    return sh;
  }
  const w = 1024,
    h = 768;
  const ov = figma.createFrame();
  ov.name = name;
  ov.resize(w, h);
  ov.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }];
  ov.clipsContent = true;
  const dlg = V(16, {
    name: "dialog",
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 20,
    paddingBottom: 20,
  });
  dlg.fills = [await paint("bg/paper")];
  dlg.effectStyleId = (await sty("Shadow/Dialog")).id;
  await rad(dlg);
  ov.appendChild(dlg);
  dlg.counterAxisSizingMode = "FIXED";
  dlg.resize(560, 100);
  dlg.primaryAxisSizingMode = "AUTO";
  dlg.x = (w - 560) / 2;
  dlg.y = 48;
  await dhead(dlg, title);
  return {
    ov,
    content: null,
    dlg,
    fin: () => {
      if (dlg.y + dlg.height + 48 > ov.height)
        ov.resize(ov.width, dlg.y + dlg.height + 48);
    },
  };
}
// ---- 單據 / 彈窗 ----
async function docHead(sh, title, status, tone, sub, right = []) {
  const c = add(sh.content, await card("doc-head", 8), "FILL");
  const r = add(c, H(12), "FILL");
  await put(r, [await T(title, "Heading/H6"), await tag(status, tone)]);
  spacer(r);
  for (const x of right) add(r, x);
  if (sub) {
    const t = add(c, await T(sub, "Body/2", "text/secondary"), "FILL");
    t.textAutoResize = "HEIGHT";
  }
  return c;
}
async function review(parent, steps, btns) {
  const c = add(parent, await card("review(審核區塊)", 10), "FILL");
  add(c, await T("審核", "Subtitle/1"));
  for (const [a, b, tone] of steps) {
    const r = add(c, H(12), "FILL");
    add(r, await tag(a, tone));
    add(r, await T(b));
  }
  if (btns) add(c, await actions(btns), "FILL");
  return c;
}
async function ovRow(name) {
  const ov = figma.createFrame();
  ov.name = name;
  ov.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }];
  ov.clipsContent = true;
  const row = H(24, {
    name: "dialogs",
    counterAxisAlignItems: "MIN",
    paddingLeft: 64,
    paddingRight: 64,
    paddingTop: 64,
    paddingBottom: 64,
  });
  ov.appendChild(row);
  return {
    ov,
    row,
    fin: () => {
      ov.resize(Math.max(1440, row.width), Math.max(900, row.height));
      row.x = 0;
      row.y = 0;
    },
  };
}
async function dcard(row, title, w = 440, sub) {
  const d = V(14, {
    name: "dialog:" + title,
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 20,
    paddingBottom: 20,
  });
  d.fills = [await paint("bg/paper")];
  d.effectStyleId = (await sty("Shadow/Dialog")).id;
  await rad(d);
  add(row, d);
  d.counterAxisSizingMode = "FIXED";
  d.resize(w, 100);
  d.primaryAxisSizingMode = "AUTO";
  await dhead(d, title, sub);
  return d;
}
// 結算區塊(SettlementPanel):上方金額列 + 提示,下方收付歷程(規格第 9 章)
async function settlement(parent, o) {
  const c = add(parent, await card("SettlementPanel", 12), "FILL");
  const h = add(c, H(12), "FILL");
  add(h, await T("結算", "Subtitle/1"));
  spacer(h);
  for (const b of o.buttons || []) add(h, b);
  const g = add(
    c,
    H(32, { name: "sums", layoutWrap: "WRAP", counterAxisSpacing: 12 }),
    "FILL",
  );
  for (const [k, v, col] of o.sums) {
    const x = add(g, V(2));
    add(x, await T(k, "Caption", "text/secondary"));
    add(x, await T(v, "Subtitle/1", col || "text/primary"));
  }
  if (o.hint) add(c, await alert(o.hint, "Warning"), "FILL");
  add(c, await T("收付歷程", "Subtitle/2", "text/secondary"));
  add(
    c,
    await table(
      o.cols || [
        ["時間", 110],
        ["哪一店", 80],
        ["類型", 90],
        ["方式", 70],
        ["金額", 80],
        ["經手 / 收款人", 120],
        ["登記人", 80],
        ["", 90],
      ],
      o.rows,
      { right: [4] },
    ),
    "FILL",
  );
  return c;
}
// 店面管理殼:分店、本機收銀點(可切換)、你開著的班、連線、上次日結、[盤點] [存銀行] [日結]
async function storeShell(name, tab = "看板", o = {}) {
  const sh = await shell(name, "店面管理", "店面管理", "店面管理");
  const top = add(
    sh.content,
    H(12, { name: "store-top", counterAxisAlignItems: "CENTER" }),
    "FILL",
  );
  await put(top, [
    await select("分店", "中山店", 200),
    await select("本機收銀點", o.local || "店內櫃台", 180),
  ]);
  if (o.mine)
    add(top, await T("你開著的班:" + o.mine, "Body/2", "primary/dark"));
  const dot = H(6, { name: "conn" });
  const d = figma.createEllipse();
  d.resize(8, 8);
  d.fills = [await paint("success/main")];
  add(dot, d);
  add(dot, await T("即時", "Caption", "text/secondary"));
  add(top, dot);
  spacer(top);
  await put(top, [
    await T("上次日結:10/13(已 3 天)", "Body/2", "warning/main"),
    await btn("盤點", "Outlined"),
    await btn("存銀行", "Outlined"),
    await btn("日結"),
  ]);
  add(
    sh.content,
    await tabs(
      [
        "看板",
        "班次結帳歷史紀錄",
        "盤點紀錄",
        "撤銷售出",
        "現金更正",
        "其他申請",
      ],
      tab,
    ),
    "FILL",
  );
  return sh;
}
// 手機 / 平板的店面管理頂部(精簡)
async function storeTopDev(sh, o = {}) {
  const top = add(sh.content, await card("store-top", 8, 12), "FILL");
  const r1 = add(top, H(8), "FILL");
  add(r1, await select("本機收銀點", o.local || "店內櫃台"), "FILL");
  const r2 = add(
    top,
    H(8, { layoutWrap: "WRAP", counterAxisSpacing: 8 }),
    "FILL",
  );
  if (o.mine)
    add(r2, await T("你開著的班:" + o.mine, "Caption", "primary/dark"));
  add(r2, await T("上次日結:10/13(已 3 天)", "Caption", "warning/main"));
  const r3 = add(top, H(8), "FILL");
  for (const l of ["盤點", "存銀行", "日結"])
    add(r3, await sbtn(l, l === "日結" ? "Contained" : "Outlined"), "FILL");
  return top;
}
async function ticketInfo(
  game = "5164 發大財",
  price = "200 元",
  book = "056527",
  no = "012",
  where,
) {
  const c = V(4, {
    name: "ticket-info",
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 10,
    paddingBottom: 10,
  });
  c.fills = [await paint("bg/default")];
  await rad(c, "radius/sm");
  const r = add(c, H(8), "FILL");
  add(r, await T(game, "Subtitle/1"));
  spacer(r);
  add(r, await T(price, "Body/2", "text/secondary"));
  add(
    c,
    await T(
      `本號 ${book} · 張號 ${no}${where ? " · " + where : ""}`,
      "Body/2",
      "text/secondary",
    ),
  );
  return c;
}
// 卡片列表(手機版的表格):每列一張卡,第一欄當標題,其餘「標籤 值」
async function cardList(cols, rows, o = {}) {
  const box = V(8, { name: o.name || "card-list" });
  for (const r of rows) {
    const c = add(box, await card("row-card", 6, 14), "FILL");
    const h = add(c, H(8), "FILL");
    const head = Array.isArray(r[0]) ? r[0] : [r[0]];
    for (const x of head)
      add(h, typeof x === "string" ? await T(x, "Subtitle/2") : x);
    spacer(h);
    if (o.badge != null && r[o.badge] != null) {
      const b = r[o.badge];
      add(h, typeof b === "string" ? await T(b) : b);
    }
    for (let k = 1; k < cols.length; k++) {
      if (k === o.badge || r[k] == null || r[k] === "" || !cols[k][0]) continue;
      const v = r[k];
      add(c, await kv(cols[k][0], Array.isArray(v) ? v[0] : v), "FILL");
    }
  }
  return box;
}
// 色票標籤(底座 tagPalettes 草稿示意,暫用色碼)
const PAL = {
  藍: ["#E3F2FD", "#0D47A1"],
  綠: ["#E8F5E9", "#1B5E20"],
  黃: ["#FFF8E1", "#7A5B00"],
  紅: ["#FFEBEE", "#B71C1C"],
  紫: ["#F3E5F5", "#4A148C"],
  橘: ["#FFF3E0", "#9A3B00"],
  灰: ["#F5F5F5", "#424242"],
};
const hex = (h) => ({
  r: parseInt(h.slice(1, 3), 16) / 255,
  g: parseInt(h.slice(3, 5), 16) / 255,
  b: parseInt(h.slice(5, 7), 16) / 255,
});
async function chip(name, label) {
  const p = PAL[name];
  const c = H(0, {
    name: "tag:" + name,
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 2,
    paddingBottom: 2,
  });
  c.fills = [{ type: "SOLID", color: hex(p[0]) }];
  c.cornerRadius = 4;
  const t = await T(label || name, "Caption/SemiBold");
  t.fills = [{ type: "SOLID", color: hex(p[1]) }];
  add(c, t);
  return c;
}
async function chips(list, small = true) {
  const r = H(8, { name: "chips", layoutWrap: "WRAP", counterAxisSpacing: 8 });
  for (const [l, on] of list)
    add(
      r,
      await btn(
        l,
        on ? "Contained" : "Outlined",
        "Primary",
        "Default",
        small ? "Small" : "Medium",
      ),
    );
  return r;
}
// 張數格子(本機版):從 001 起,state:{ no: "sel" | "off" | "lost" | "skip" | "sold" }
async function ticketGrid(total, state = {}, cols = 10, cell = 40) {
  const g = V(4, { name: "ticket-grid" });
  const set = await node("TicketCell");
  for (let i = 1; i <= total; i += cols) {
    const r = add(g, H(4, { name: "grid-row" }));
    for (let k = i; k < Math.min(i + cols, total + 1); k++) {
      const no = String(k).padStart(3, "0");
      const st = state[no];
      const c = await vi(
        set,
        { State: st === "sel" ? "Selected" : st ? "Unavailable" : "Available" },
        { No: no },
      );
      c.resize(cell, cell);
      if (st === "lost" || st === "skip") {
        c.strokes = [
          await paint(st === "lost" ? "warning/main" : "error/main"),
        ];
        c.strokeWeight = 2;
        c.dashPattern = st === "skip" ? [4, 3] : [];
      }
      add(r, c);
    }
  }
  return g;
}
async function legend(items) {
  const r = H(16, {
    name: "legend",
    layoutWrap: "WRAP",
    counterAxisSpacing: 6,
  });
  for (const [l, col] of items) {
    const x = H(6);
    const d = figma.createRectangle();
    d.resize(12, 12);
    d.cornerRadius = 3;
    d.fills = [await paint(col)];
    add(x, d);
    add(x, await T(l, "Caption", "text/secondary"));
    add(r, x);
  }
  return r;
}
// 收尾:新畫面補綁專案色、重新排列尺寸區塊
// 表格欄寬總和超過可用寬度時等比例縮小(避免欄位超出卡片)
function fitTables(root) {
  for (const r of root.findAll(
    (n) => n.type === "FRAME" && (n.name === "tr" || n.name === "thead"),
  )) {
    const avail =
      r.width -
      r.paddingLeft -
      r.paddingRight -
      r.itemSpacing * (r.children.length - 1);
    const total = r.children.reduce((m, c) => m + c.width, 0);
    if (total <= avail + 1) continue;
    const k = avail / total;
    for (const c of r.children) c.resize(Math.floor(c.width * k), c.height);
  }
}
async function finish() {
  const nodes = [];
  for (const [, id] of made) nodes.push(await figma.getNodeByIdAsync(id));
  for (const n of nodes) fitTables(n);
  const rebound = await rebindPage(nodes);
  relayoutSizes();
  return { made, rebound };
}
// ==== 第三輪工具結束 ====
