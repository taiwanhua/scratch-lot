// ==== 第四輪起的小工具(scratch-lot Screens 執行)====
// 用法:貼在 r4-*.js 前面一起執行(或存在暫存頁的文字節點裡,用 AsyncFunction 讀出來執行)。
// 做法:從現有畫面「複製樣板節點」組新畫面,所以字型樣式、顏色綁定(scratch-lot 品牌色 / 底座語意色)都沿用樣板。
// 樣板節點(都在 scratch-lot Screens,刪改前先換掉這裡的 id):
//   sub2 / body2 / body1 / cap / h6:庫存管理 IN-03 / IN-04 的文字;btn:IN-04 的 Button(用 setProperties 換變體);
//   card:店面管理 ST-01 平板的收銀點卡片;dlg:IN-04 的對話框;bar:IN-03 的選張操作列;
//   cellSet:Draft/TicketCell;tf:IN-04 的 TextField;sel:IN-04 的 Draft/SelectField。
// 注意:複製的 Button 換變體後會帶回底座主色,畫完要跑 brand-rebind.js(或 r4-store.js 結尾的 rebindPage())。
const S = {
  sub2: "125:1392",
  body2: "125:2097",
  body1: "125:2099",
  cap: "125:2104",
  h6: "125:2093",
  btn: "125:2105",
  card: "124:5628",
  dlg: "125:2091",
  bar: "125:1391",
  cellSet: "64:132",
  tf: "125:2116",
  sel: "125:2138",
};
const N = {};
for (const k in S) N[k] = await figma.getNodeByIdAsync(S[k]);
const cellV = {};
for (const v of N.cellSet.children) cellV[v.name.replace("State=", "")] = v;
const primaryPaint = cellV.Selected.fills[0];
async function fnt(t) {
  for (const f of t.getRangeAllFontNames(0, Math.max(1, t.characters.length)))
    await figma.loadFontAsync(f);
}
async function setT(t, s) {
  await fnt(t);
  t.characters = s;
}
async function T(k, s, colorK) {
  const t = N[k].clone();
  await fnt(t);
  t.characters = s;
  t.textAutoResize = "WIDTH_AND_HEIGHT";
  if (colorK) t.fills = N[colorK].fills;
  return t;
}
async function TW(k, s, w, colorK) {
  const t = await T(k, s, colorK);
  t.textAutoResize = "HEIGHT";
  t.resize(w, t.height);
  return t;
}
async function B(
  l,
  v = "Outlined",
  sz = "Small",
  c = "Primary",
  st = "Default",
) {
  const b = N.btn.clone();
  b.setProperties({ Variant: v, Size: sz, Color: c, State: st });
  await setT(
    b.findOne((x) => x.type === "TEXT"),
    l,
  );
  return b;
}
function AL(d, p = {}) {
  const f = figma.createAutoLayout(d, p);
  f.fills = [];
  f.clipsContent = false;
  return f;
}
function add(p, c, h, v) {
  p.appendChild(c);
  if (h) c.layoutSizingHorizontal = h;
  if (v) c.layoutSizingVertical = v;
  return c;
}
function sp(p) {
  const s = AL("HORIZONTAL", { name: "spacer" });
  add(p, s, "FILL");
  s.layoutSizingVertical = "FIXED";
  s.resize(s.width, 1);
  return s;
}
async function rad(src, f) {
  for (const k of [
    "topLeftRadius",
    "topRightRadius",
    "bottomLeftRadius",
    "bottomRightRadius",
  ]) {
    f[k] = src[k];
    const bv = src.boundVariables && src.boundVariables[k];
    if (bv)
      f.setBoundVariable(k, await figma.variables.getVariableByIdAsync(bv.id));
  }
}
async function panel(name, gap = 12, pad = 16) {
  const f = AL("VERTICAL", {
    name,
    itemSpacing: gap,
    paddingLeft: pad,
    paddingRight: pad,
    paddingTop: pad,
    paddingBottom: pad,
  });
  f.fills = N.card.fills;
  f.strokes = [cellV.Available.strokes[0]];
  f.strokeWeight = 1;
  await rad(N.card, f);
  return f;
}
async function dbox(name, w, gap = 14) {
  const f = AL("VERTICAL", {
    name,
    itemSpacing: gap,
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 20,
    paddingBottom: 20,
  });
  f.fills = N.dlg.fills;
  f.effectStyleId = N.dlg.effectStyleId;
  await rad(N.dlg, f);
  f.counterAxisSizingMode = "FIXED";
  f.resize(w, 100);
  f.primaryAxisSizingMode = "AUTO";
  return f;
}
async function selBar(text, btns) {
  const b = AL("HORIZONTAL", {
    name: "selection-bar",
    itemSpacing: 8,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 8,
    paddingBottom: 8,
    counterAxisAlignItems: "CENTER",
    layoutWrap: "WRAP",
    counterAxisSpacing: 8,
  });
  b.fills = N.bar.fills;
  await rad(N.bar, b);
  add(b, await T("sub2", text));
  sp(b);
  for (const x of btns) add(b, x);
  return b;
}
// 張數格子(每列 10 格):st(no) 回傳 "sel" 已選 / "off" 已售或不能選 / "shift" 本班售出 / "other" 在別的收銀點 /
// "assigned" 已分配 / "skip" 跳號 / "scrap" 報廢 / "lost" 待查·遺失 / null 未售;每種狀態都是 Draft/TicketCell 的變體
const CELL_STATE = {
  sel: "Selected",
  off: "Unavailable",
  shift: "Shift",
  other: "Other",
  assigned: "Assigned",
  skip: "Skipped",
  scrap: "Scrapped",
  lost: "Lost",
};
async function grid(total, st, cols = 10, cell = 40) {
  const g = AL("VERTICAL", { name: "ticket-grid", itemSpacing: 4 });
  for (let i = 1; i <= total; i += cols) {
    const r = add(g, AL("HORIZONTAL", { name: "grid-row", itemSpacing: 4 }));
    for (let k = i; k < Math.min(i + cols, total + 1); k++) {
      const no = String(k).padStart(3, "0");
      const c = cellV[CELL_STATE[st(no)] || "Available"].createInstance();
      await setT(
        c.findOne((x) => x.type === "TEXT"),
        no,
      );
      c.resize(cell, cell);
      add(r, c);
    }
  }
  return g;
}
// 共用圖例:格子正上方靠右,寬度跟格子一樣;on = 要打開的狀態(圖例上的文字),rename = 覆寫文字
const LEGEND_ID = "174:264"; // Draft/TicketGridLegend
async function withLegend(g, on, rename = {}) {
  const w = AL("VERTICAL", { name: "grid+legend", itemSpacing: 8 });
  w.appendChild(g);
  const L = (await figma.getNodeByIdAsync(LEGEND_ID)).createInstance();
  w.insertChild(0, L);
  L.layoutSizingHorizontal = "FILL";
  const props = {};
  for (const [k, d] of Object.entries(L.componentProperties)) {
    const lab = k.split("#")[0];
    if (d.type === "BOOLEAN") props[k] = on.includes(lab);
    if (d.type === "TEXT" && rename[lab.replace(" 文字", "")])
      props[k] = rename[lab.replace(" 文字", "")];
  }
  L.setProperties(props);
  return w;
}
async function kv(l, v, vk = "body1") {
  const r = AL("HORIZONTAL", {
    name: "kv",
    itemSpacing: 8,
    counterAxisAlignItems: "CENTER",
  });
  add(r, await T("body2", l));
  sp(r);
  add(r, await T(vk, v));
  return r;
}
// 平板 / 手機殼:複製既有殼(ST-01 平板 124:5578、手機 124:5927),清空 content
async function shellOf(srcId, name, title) {
  const f = (await figma.getNodeByIdAsync(srcId)).clone();
  f.name = name;
  const m = f.children.find((n) => n.name === "main");
  const c = m.children.find((n) => n.name === "content");
  for (const k of [...c.children]) k.remove();
  const at = m.children
    .find((n) => n.name === "app-bar")
    .findAll((t) => t.type === "TEXT")
    .find((t) => t.characters === "店面管理");
  if (at) await setT(at, title);
  return { f, c };
}
// 畫面高度貼合內容(殼的 main / content 改 HUG 量高度,再改回 FILL)
function fitShell(f, minH) {
  const m = f.children.find((n) => n.name === "main");
  const c = m.children.find((n) => n.name === "content");
  c.layoutSizingVertical = "HUG";
  m.layoutSizingVertical = "HUG";
  f.resize(f.width, Math.max(minH, m.height));
  m.layoutSizingVertical = "FILL";
  c.layoutSizingVertical = "FILL";
}
function sec(label) {
  return figma.currentPage.children.find(
    (n) => n.type === "SECTION" && n.name === label,
  );
}
function fileIn(label, n) {
  const s = sec(label);
  const right = s.children.reduce((m, c) => Math.max(m, c.x + c.width), 0);
  s.appendChild(n);
  n.x = right + 120;
  n.y = 160;
  return n;
}
