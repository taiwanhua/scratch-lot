// ==== 第十九輪:班表管理頁重做用的小工具(scratch-lot Screens 執行)====
// 用法:整段貼在 r5-schedule.js 某一段(PART)前面一起執行。只綁底座語意色;按鈕 / 標籤的 primary 由 brand-rebind.js 補綁專案色。
// 元件都用實例(Button、Tag、SelectField、TextField、Checkbox、Radio、Switch、Tab、Alert、IconButton、Section、
// RosterCell、MonthCalendarCell 版面、ScheduleTimelineBlock、ScratchLotSideNav / NavRail / AppBar、AdminAppBar / RouteTabs)。
// 殼(側欄 + 頁首)從既有畫面複製(第十九輪第一次跑時用舊畫面,舊畫面刪除後改成本輪新畫面):
// 我的班表 SC-01、排班作業 SC-03、排班設定 SC-08、出勤紀錄 SC-11 / SC-12(各尺寸)。
const PAGE = await figma.getNodeByIdAsync("70:14");
await figma.setCurrentPageAsync(PAGE);
const VID = {
  paper: "VariableID:7875005cdf746478c3e17c225db9fce44ab90451/6:194",
  def: "VariableID:f3cf90e5f836dd44d0124f96199feb7ce961d9fc/6:189",
  divider: "VariableID:860a5dc497e0d365947731af9f273cd963ca1d04/6:214",
  tp: "VariableID:d55b27457c6f95c898e614be4c16cef386fe1f65/6:199",
  ts: "VariableID:c11ac6a81b471a6a46f85602d056355c19fd4166/6:204",
  tdis: "VariableID:b8f6a2814dee4ecdbc02bb973690b11f2e43dc40/6:209",
  pl: "VariableID:910cd62c36bae23991a84c291f8b3a546df84384/2106:7",
  pm: "VariableID:3666ac0c6b3d12e8e38f6be8270287eb55a5cce1/2106:9",
  pc: "VariableID:60e87705d77a858288a3c26b19399b632f333155/2106:12",
  sel: "VariableID:37f80e5dfc92ba565ff5e53f7dd2c91ea8e4a323/6:224",
  wl: "VariableID:15f96b616735c06dd4034cd95ca8dc525c66977a/6:115",
  wm: "VariableID:c4795bb776010891dbb7e03790c05d403ac4c75a/6:264",
  wd: "VariableID:39797cd1b142124ac07aa6fee4d0d09437d1f01e/6:131",
  el: "VariableID:bf0c706be97615148e026899f796626275e5d07a/6:135",
  em: "VariableID:0d2b086b0de059122075ae1efcdf53c86d10497d/6:274",
  ed: "VariableID:d4fc0e5cb1a056c4bb694852fc2b93df0c0fa62d/6:151",
  il: "VariableID:9a48fc22194750b6e314f3d4e2efc0abaccd05ec/6:75",
  im: "VariableID:54b394efe9085b0dbab1f981e282b66d1a5724cf/6:244",
  idk: "VariableID:3866235bc61eafb29708a06128ef7a7506b8b170/6:91",
  sl: "VariableID:ac46db2e85d7432f8264076a65ac59b30d3c3df5/6:95",
  sm: "VariableID:6e398ee88e62c802e89a1f46853dfda221b9d453/6:254",
  g200: "VariableID:ff65fc9dfea7c90e278a7909f54de2fea8d50137/6:43",
  g300: "VariableID:cc21f0a1f04bee50925591b9ed0af62b06dfbf44/6:47",
  g700: "VariableID:038b0dd75cf6a8e57d9dcd959b7a8c61d6779f15/6:63",
  dis: "VariableID:585480db6e01a4e2cb325bf38b8400dd5b0797ba/6:239",
};
const RID = {
  md: "VariableID:0f80284942703a107a0d15ce580a86d4172f7651/6:286",
  sm: "VariableID:090b2c8aaafdc7c094af9a5115294468c5726601/6:283",
};
const TS = {
  h6: "S:1be1d72d4db6f0630bc69d0fb1271637413e60f5,6:386",
  sub1: "S:279cc15e98fb39161321012180207b27657910dd,6:392",
  sub2: "S:10d300c90c1c0adee2e8665d86ade62c9d3a0d38,6:398",
  body1: "S:f1cf218e9366639ba8b20a581a125d6dc8209847,6:404",
  body2: "S:5fb1ba864f8fa1d388e29e66d1664b889e0a24ee,6:410",
  cap: "S:cf4328c6d8830674997c8a3f7d6aa200f50eab70,6:415",
  capSB: "S:7cfa2be1b685e1bf7c2d32270742cbf2e41d61d2,286:5",
};
const SHADOW = "S:b1c64e5a1440659a32fb283906757a36ba9bc343,6:330";
const _v = {};
async function vr(k) {
  if (!_v[k])
    _v[k] = await figma.variables.getVariableByIdAsync(VID[k] || RID[k]);
  return _v[k];
}
async function P(k, op = 1) {
  const p = figma.variables.setBoundVariableForPaint(
    { type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: op },
    "color",
    await vr(k),
  );
  return p;
}
async function fill(n, k, op = 1) {
  n.fills = k ? [await P(k, op)] : [];
  return n;
}
async function stroke(n, k, w = 1, align = "INSIDE") {
  n.strokes = [await P(k)];
  n.strokeWeight = w;
  n.strokeAlign = align;
  return n;
}
async function rad(n, k = "md") {
  for (const c of [
    "topLeftRadius",
    "topRightRadius",
    "bottomLeftRadius",
    "bottomRightRadius",
  ])
    n.setBoundVariable(c, await figma.variables.getVariableByIdAsync(RID[k]));
  return n;
}
const _ts = {};
async function style(k) {
  if (!_ts[k]) {
    const s = await figma.getStyleByIdAsync(TS[k]);
    await figma.loadFontAsync(s.fontName);
    _ts[k] = s;
  }
  return _ts[k];
}
await figma
  .loadFontAsync({ family: "Noto Sans TC", style: "Regular" })
  .catch(() => {});
async function T(s, k = "body2", c = "tp", name) {
  const st = await style(k);
  const t = figma.createText();
  t.fontName = st.fontName;
  await t.setTextStyleIdAsync(st.id);
  t.characters = String(s);
  t.fills = [await P(c)];
  t.name = name || String(s).slice(0, 24);
  return t;
}
async function TW(s, w, k = "body2", c = "tp") {
  const t = await T(s, k, c);
  t.textAutoResize = "HEIGHT";
  t.resize(w, t.height);
  return t;
}
function AL(d = "VERTICAL", p = {}) {
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
function row(gap = 8, name = "row", align = "CENTER") {
  return AL("HORIZONTAL", {
    name,
    itemSpacing: gap,
    counterAxisAlignItems: align,
  });
}
function col(gap = 8, name = "col") {
  return AL("VERTICAL", { name, itemSpacing: gap });
}
async function card(name, pad = 16, gap = 12, border = true) {
  const f = AL("VERTICAL", {
    name,
    itemSpacing: gap,
    paddingLeft: pad,
    paddingRight: pad,
    paddingTop: pad,
    paddingBottom: pad,
  });
  await fill(f, "paper");
  if (border) await stroke(f, "divider");
  await rad(f, "md");
  return f;
}
async function box(name, k, pad = 8, gap = 6, r = "sm") {
  const f = AL("VERTICAL", {
    name,
    itemSpacing: gap,
    paddingLeft: pad,
    paddingRight: pad,
    paddingTop: pad,
    paddingBottom: pad,
  });
  await fill(f, k);
  await rad(f, r);
  return f;
}
// ---- 元件實例 ----
const _m = {};
// 第二十三輪起傳主元件 id(舊畫面的實例已刪除);仍相容實例 id 與元件集合 id
async function main(id) {
  if (!_m[id]) {
    const n = await figma.getNodeByIdAsync(id);
    _m[id] =
      n.type === "INSTANCE"
        ? await n.getMainComponentAsync()
        : n.type === "COMPONENT_SET"
          ? n.defaultVariant
          : n;
  }
  return _m[id];
}
// 圖例項目:專案元件 Draft/LegendItem(64:14 頁,289:88348)
async function legend(kind, tone, label, symbol) {
  const set = await figma.getNodeByIdAsync("289:88348");
  const v = set.children.find((c) => c.name === `Kind=${kind}, Tone=${tone}`);
  const i = v.createInstance();
  const p = { "Label#289:0": label };
  if (symbol) p["Symbol#289:32"] = symbol;
  i.setProperties(p);
  i.name = "Draft/LegendItem";
  return i;
}
// 未對應排班的打卡:Draft/UnmatchedPunchMark(64:14 頁,290:97643),時鐘 + 張數
async function punchMark(count) {
  const i = (await figma.getNodeByIdAsync("290:97643")).createInstance();
  i.setProperties({ "Count#290:0": String(count) });
  i.name = "punch-mark";
  return i;
}
// 自動排入圖示:底座草稿 Draft/ScheduleAutoMark(286:77901)
async function autoMark() {
  const m = await figma.getNodeByIdAsync("286:77901");
  const i = (
    m.type === "COMPONENT_SET" ? m.defaultVariant : m
  ).createInstance();
  i.name = "auto-mark";
  return i;
}
async function inst(instId, props = {}) {
  const i = (await main(instId)).createInstance();
  if (Object.keys(props).length) i.setProperties(props);
  return i;
}
async function btn(
  label,
  v = "Outlined",
  size = "Small",
  color = "Primary",
  st = "Default",
) {
  const b = await inst("15:40", {
    Variant: v,
    Size: size,
    Color: color,
    State: st,
  });
  b.setProperties({ "Label#8:0": label });
  b.name = "Button " + label;
  return b;
}
async function tag(label, tone = "Default") {
  const t = await inst("20:7");
  try {
    t.setProperties({ Tone: tone });
  } catch (e) {}
  t.setProperties({ "Label#76:8": label });
  return t;
}
async function setTxt(n, name, s) {
  const t = n.findOne((x) => x.type === "TEXT" && x.name === name);
  if (!t) return;
  for (const f of t.getRangeAllFontNames(0, Math.max(1, t.characters.length)))
    await figma.loadFontAsync(f);
  t.characters = s;
}
async function selF(label, value, state = "Default") {
  const s = await inst("65:370", { State: state });
  await setTxt(s, "label", label);
  await setTxt(s, "value", value);
  s.name = "SelectField " + label;
  return s;
}
async function tf(label, value, helper = "", size = "Medium", st = "Default") {
  const t = await inst("15:132", { Size: size, State: st });
  t.setProperties({
    "Label#11:0": label,
    "Value#11:9": value,
    "Helper#11:18": helper,
  });
  t.name = "TextField " + label;
  return t;
}
async function cb(checked, label, k = "body2") {
  const r = row(8, "checkbox");
  add(r, await inst("14:525", { State: checked ? "Checked" : "Unchecked" }));
  if (label) add(r, await T(label, k));
  return r;
}
async function rd(on, label, k = "body2") {
  const r = row(8, "radio");
  add(r, await inst("14:1328", { State: on ? "Selected" : "Default" }));
  if (label) add(r, await T(label, k));
  return r;
}
async function swi(on, label) {
  const r = row(8, "switch");
  add(r, await inst("14:574", { State: on ? "On" : "Off" }));
  if (label) add(r, await T(label));
  return r;
}
async function tab(label, active, badge = false) {
  const t = await inst("14:537", { State: active ? "Active" : "Default" });
  t.setProperties({ "Label#69:0": label, "Badge#288:0": badge });
  return t;
}
async function tabs(labels, ai = 0, name = "PageTabs") {
  const r = AL("HORIZONTAL", { name, itemSpacing: 0 });
  for (let i = 0; i < labels.length; i++)
    add(r, await tab(labels[i], i === ai));
  return r;
}
async function alert(msg, sev = "Info", action = false) {
  const a = await inst("22:434", { Severity: sev });
  a.setProperties({ "Message#289:0": msg, "Action#311:0": action });
  return a;
}
async function section(title, summary, st = "Collapsed") {
  const s = await inst("41:5925", { State: st });
  s.setProperties({ "Title#41:0": title, "Summary#41:3": summary });
  return s;
}
// ◀ ▶:MonthCalendar 工具列裡的 IconButton
async function chevron(dir) {
  const src = await figma.getNodeByIdAsync(dir < 0 ? "48:362" : "48:368");
  const c = (await src.getMainComponentAsync()).createInstance();
  c.setProperties({ Variant: "Outlined", Size: "Small" });
  try {
    const sw = src.componentProperties["Icon#312:0"];
    if (sw) c.setProperties({ "Icon#312:0": sw.value });
  } catch (e) {}
  c.name = dir < 0 ? "上一個" : "下一個";
  return c;
}
async function pager(label, k = "sub1") {
  const r = row(8, "pager");
  add(r, await chevron(-1));
  add(r, await T(label, k));
  add(r, await chevron(1));
  return r;
}
// 分段切換(檢視切換、[月曆 | 條列]、單一 / 週範本)
async function seg(labels, ai = 0, name = "segmented") {
  const r = AL("HORIZONTAL", { name, itemSpacing: 0 });
  for (let i = 0; i < labels.length; i++)
    add(r, await btn(labels[i], i === ai ? "Contained" : "Outlined", "Small"));
  return r;
}
// 徽章(數字或小圓點)
async function pill(s, bg = "em", fg = "pc", name = "badge") {
  const b = AL("HORIZONTAL", {
    name,
    paddingLeft: 6,
    paddingRight: 6,
    paddingTop: 1,
    paddingBottom: 1,
    counterAxisAlignItems: "CENTER",
  });
  await fill(b, bg);
  b.cornerRadius = 10;
  add(b, await T(s, "capSB", fg));
  return b;
}
async function dot(k = "pm", size = 6) {
  const e = figma.createEllipse();
  e.resize(size, size);
  e.fills = [await P(k)];
  e.name = "dot";
  return e;
}
async function divider(w) {
  const r = figma.createRectangle();
  r.resize(w || 100, 1);
  r.fills = [await P("divider")];
  r.name = "divider";
  return r;
}
// 表格(簡單):cols = [{h, w}],rows = [[cell...]];cell 可以是字串或節點
async function table(cols, rows, name = "table") {
  const t = AL("VERTICAL", { name, itemSpacing: 0 });
  const hr = row(12, "thead");
  hr.paddingLeft = hr.paddingRight = 12;
  hr.paddingTop = hr.paddingBottom = 10;
  await fill(hr, "def");
  for (const c of cols) {
    const x = await T(c.h, "sub2", "ts");
    add(hr, x);
    if (c.w) {
      x.textAutoResize = "HEIGHT";
      x.resize(c.w, x.height);
    } else x.layoutSizingHorizontal = "FILL";
  }
  add(t, hr, "FILL");
  for (const r of rows) {
    const tr = row(12, "tr");
    tr.paddingLeft = tr.paddingRight = 12;
    tr.paddingTop = tr.paddingBottom = 10;
    tr.strokes = [await P("divider")];
    tr.strokeTopWeight = 0;
    tr.strokeLeftWeight = 0;
    tr.strokeRightWeight = 0;
    tr.strokeBottomWeight = 1;
    for (let i = 0; i < cols.length; i++) {
      let c = r[i];
      if (c === undefined || c === null) c = "";
      let node = typeof c === "string" ? await T(c, "body2") : c;
      // 元件(勾選框、標籤、圓點)包一層固定寬的格子,元件本身維持原尺寸
      if (node.type !== "TEXT" && !/^Button/.test(node.name)) {
        const wr = row(0, "cell");
        add(wr, node);
        node = wr;
      }
      add(tr, node);
      if (cols[i].w) {
        if (node.type === "TEXT") {
          node.textAutoResize = "HEIGHT";
          node.resize(cols[i].w, node.height);
        } else {
          node.layoutSizingHorizontal = "FIXED";
          node.resize(cols[i].w, node.height);
        }
      } else node.layoutSizingHorizontal = "FILL";
    }
    add(t, tr, "FILL");
  }
  return t;
}
// ---- 殼 ----
const SHELL = {
  my: { D: "263:14824", T: "265:17214", M: "265:19263", title: "我的班表" },
  manage: { D: "290:83686", T: "290:87689", M: "290:90336", title: "排班作業" },
  settings: {
    D: "275:32624",
    T: "275:34439",
    M: "275:36003",
    title: "排班設定",
  },
  att: { D: "276:34809", T: "276:35606", M: "276:35972", title: "出勤紀錄" },
};
const W = { D: 1440, T: 1024, M: 390 };
const H = { D: 900, T: 768, M: 844 };
async function shell(mod, sz, name) {
  const src = await figma.getNodeByIdAsync(SHELL[mod][sz]);
  const f = src.clone();
  f.name = name;
  f.locked = false;
  const m = f.children.find((n) => n.name === "main");
  const c = m.children.find((n) => n.name === "content");
  for (const k of [...c.children]) k.remove();
  // 去掉殼上疊加的東西(例:舊的覆蓋層),只留 main 與側欄
  for (const k of [...f.children])
    if (k.name !== "main" && !/SideNav|NavRail/.test(k.name)) k.remove();
  const title = SHELL[mod].title;
  for (const a of m.findAll(
    (x) =>
      x.type === "INSTANCE" &&
      /AdminAppBar|ScratchLotAppBar/.test(x.name) &&
      x.parent === m,
  )) {
    const key = Object.keys(a.componentProperties).find((k) =>
      k.startsWith("Title#"),
    );
    if (key) a.setProperties({ [key]: title });
  }
  if (sz === "D") {
    const rt = m.children.find((x) => /AdminRouteTabs/.test(x.name));
    if (rt) {
      const ts = rt.findAll((x) => x.type === "TEXT");
      const t0 = ts.find((x) =>
        /我的班表|排班作業|排班設定|出勤紀錄/.test(x.characters),
      );
      if (t0) {
        for (const fnt of t0.getRangeAllFontNames(0, t0.characters.length))
          await figma.loadFontAsync(fnt);
        t0.characters = title;
      }
    }
  }
  c.itemSpacing = sz === "M" ? 12 : 16;
  return { f, m, c };
}
function fitShell(f, minH) {
  const m = f.children.find((n) => n.name === "main");
  const c = m.children.find((n) => n.name === "content");
  c.layoutSizingVertical = "HUG";
  m.layoutSizingVertical = "HUG";
  f.resize(f.width, Math.max(minH, m.height));
  m.layoutSizingVertical = "FILL";
  c.layoutSizingVertical = "FILL";
}
// ---- 遮罩 + 對話框 / 抽屜 / 底部面板 ----
// bg:入口畫面(會複製並鎖定);kind:"dialog" 置中、"drawer" 右側、"sheet" 底部、"full" 手機全螢幕
async function overlay(bg, name, panel, kind = "dialog", sz = "D") {
  const w = W[sz];
  const h = Math.max(H[sz], bg ? bg.height : H[sz]);
  const f = figma.createFrame();
  f.name = name;
  f.resize(w, h);
  await fill(f, "def");
  f.clipsContent = true;
  if (bg) {
    const b = bg.clone();
    b.name = "背景:" + bg.name;
    b.locked = true;
    f.appendChild(b);
    b.x = 0;
    b.y = 0;
  }
  if (kind !== "full") {
    const s = figma.createRectangle();
    s.name = "scrim";
    s.resize(w, h);
    s.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
    s.opacity = 0.5;
    f.appendChild(s);
  }
  f.appendChild(panel);
  if (kind === "dialog") {
    panel.x = Math.round((w - panel.width) / 2);
    panel.y = Math.max(40, Math.round((Math.min(h, H[sz]) - panel.height) / 2));
  } else if (kind === "drawer") {
    panel.resize(panel.width, h);
    panel.x = w - panel.width;
    panel.y = 0;
  } else if (kind === "sheet") {
    panel.x = 0;
    panel.y = Math.max(80, h - panel.height);
    if (panel.y + panel.height < h) panel.resize(panel.width, h - panel.y);
  } else {
    panel.resize(w, h);
    panel.x = 0;
    panel.y = 0;
  }
  return f;
}
async function dlg(title, w, gap = 16) {
  const d = AL("VERTICAL", {
    name: "dialog",
    itemSpacing: gap,
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 20,
    paddingBottom: 20,
  });
  await fill(d, "paper");
  await rad(d, "md");
  d.effectStyleId = SHADOW;
  d.counterAxisSizingMode = "FIXED";
  d.resize(w, 100);
  d.primaryAxisSizingMode = "AUTO";
  if (title) add(d, await T(title, "h6", "tp", "title"), "FILL");
  return d;
}
async function actions(btns, left = []) {
  const r = row(8, "actions");
  for (const b of left) add(r, b);
  sp(r);
  for (const b of btns) add(r, b);
  return r;
}
// 右側抽屜 / 側邊面板(有標題列與 ✕)
async function drawerBox(title, w, gap = 16) {
  const d = AL("VERTICAL", {
    name: "drawer",
    itemSpacing: gap,
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 20,
    paddingBottom: 20,
  });
  await fill(d, "paper");
  d.effectStyleId = SHADOW;
  d.counterAxisSizingMode = "FIXED";
  d.resize(w, 100);
  d.primaryAxisSizingMode = "FIXED";
  const hd = row(8, "head");
  add(hd, await T(title, "h6", "tp", "title"));
  sp(hd);
  add(hd, await T("✕", "sub1", "ts", "close"));
  add(d, hd, "FILL");
  return d;
}
// 手機底部面板(拉桿 + 標題 + ✕)
async function sheetBox(title, gap = 12) {
  const d = AL("VERTICAL", {
    name: "bottom-sheet",
    itemSpacing: gap,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 8,
    paddingBottom: 24,
  });
  await fill(d, "paper");
  d.topLeftRadius = 16;
  d.topRightRadius = 16;
  d.effectStyleId = SHADOW;
  d.counterAxisSizingMode = "FIXED";
  d.resize(390, 100);
  d.primaryAxisSizingMode = "AUTO";
  const hdl = row(0, "handle");
  hdl.primaryAxisAlignItems = "CENTER";
  const bar = figma.createRectangle();
  bar.resize(36, 4);
  bar.cornerRadius = 2;
  bar.fills = [await P("g300")];
  bar.name = "grab";
  add(hdl, bar);
  add(d, hdl, "FILL");
  const hd = row(8, "head");
  add(hd, await T(title, "sub1", "tp", "title"));
  sp(hd);
  add(hd, await T("✕", "sub1", "ts", "close"));
  add(d, hd, "FILL");
  return d;
}
// 手機全螢幕對話框(app-bar Kind=Dialog)
async function fullDlg(title, action) {
  const f = AL("VERTICAL", { name: "full-dialog", itemSpacing: 0 });
  await fill(f, "def");
  f.counterAxisSizingMode = "FIXED";
  f.resize(390, 844);
  f.primaryAxisSizingMode = "FIXED";
  const ab = await inst("209:366", { Size: "Mobile", Kind: "Dialog" });
  const pr = ab.componentProperties;
  const p = {};
  for (const k of Object.keys(pr)) {
    if (k.startsWith("Title#")) p[k] = title;
    if (k.startsWith("Org#")) p[k] = false;
    if (k.startsWith("Action#")) p[k] = !!action;
  }
  ab.setProperties(p);
  if (action) {
    const t = ab
      .findAll((x) => x.type === "TEXT" && x.visible && x.characters !== title)
      .pop();
    if (t) {
      for (const fnt of t.getRangeAllFontNames(0, t.characters.length))
        await figma.loadFontAsync(fnt);
      t.characters = action;
    }
  }
  add(f, ab, "FILL");
  const body = AL("VERTICAL", {
    name: "body",
    itemSpacing: 16,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 16,
    paddingBottom: 16,
  });
  add(f, body, "FILL", "FILL");
  return { f, body };
}
// ---- 月曆格(我的班表、畫休、行事曆、月檢視、套用範本的多選)----
// days: [{d:"1", out:false, today:false, sel:false, off:false(停用), bg:"wl"(背景色 key), lines:[node|字串], badge:node, dot:"pm"}]
async function monthGrid(days, cellW, cellH, opts = {}) {
  const g = AL("VERTICAL", {
    name: opts.name || "MonthCalendar(組成)",
    itemSpacing: 0,
  });
  const wk = ["日", "一", "二", "三", "四", "五", "六"];
  const hr = row(0, "weekdays");
  if (opts.weekCheck) {
    const s = row(0, "week-check-h");
    s.resize(32, 24);
    s.layoutSizingHorizontal = "FIXED";
    add(hr, s);
  }
  for (const w of wk) {
    const c = row(0, "weekday");
    c.primaryAxisAlignItems = "CENTER";
    c.paddingTop = c.paddingBottom = 4;
    add(c, await T(w, "capSB", "ts"));
    add(hr, c);
    c.layoutSizingHorizontal = "FIXED";
    c.resize(cellW, c.height);
  }
  add(g, hr);
  for (let i = 0; i < days.length; i += 7) {
    const wr = row(0, "week", "MIN");
    if (opts.weekCheck) {
      const s = AL("VERTICAL", { name: "week-check", paddingTop: 8 });
      s.counterAxisAlignItems = "CENTER";
      add(
        s,
        await inst("14:525", {
          State: opts.weekCheck[i / 7] ? "Checked" : "Unchecked",
        }),
      );
      add(wr, s);
      s.layoutSizingHorizontal = "FIXED";
      s.resize(32, s.height);
      s.layoutSizingVertical = "FILL";
    }
    for (const d of days.slice(i, i + 7)) {
      const c = AL("VERTICAL", {
        name: "day",
        itemSpacing: 3,
        paddingLeft: 6,
        paddingRight: 6,
        paddingTop: 4,
        paddingBottom: 6,
      });
      await fill(
        c,
        d.off ? "dis" : d.sel ? "pl" : d.bg || "paper",
        d.bg && !d.off && !d.sel ? 0.6 : 1,
      );
      await stroke(c, d.today ? "pm" : "divider", d.today ? 2 : 1);
      const top = row(4, "day-head");
      add(
        top,
        await T(
          d.d,
          d.today ? "capSB" : "cap",
          d.out || d.off ? "tdis" : "tp",
          "day-number",
        ),
      );
      sp(top);
      if (d.dot) add(top, await dot(d.dot));
      if (d.badge) add(top, d.badge);
      add(c, top, "FILL");
      for (const l of d.lines || []) {
        const n =
          typeof l === "string" ? await T(l, "cap", d.out ? "tdis" : "tp") : l;
        add(c, n);
        if (n.type === "TEXT") {
          n.textAutoResize = "HEIGHT";
          n.layoutSizingHorizontal = "FILL";
        }
      }
      add(wr, c);
      c.layoutSizingHorizontal = "FIXED";
      c.resize(cellW, Math.max(cellH, 10));
      c.layoutSizingVertical = opts.hug ? "HUG" : "FIXED";
      if (!opts.hug) c.resize(cellW, cellH);
    }
    add(g, wr);
    if (opts.hug)
      for (const c of wr.children)
        if (c.name === "day") c.layoutSizingVertical = "FILL";
  }
  return g;
}
// 2026 年 11 月(11/1 是星期日)的 35 格日期;f(day) 回傳要合併的屬性
function nov(f = () => ({})) {
  const out = [];
  for (let i = 0; i < 35; i++) {
    const d = i + 1;
    if (d <= 30) out.push({ d: String(d), ...f(d, i) });
    else out.push({ d: String(d - 30), out: true, ...f(-1, i) });
  }
  return out;
}
function oct(f = () => ({})) {
  // 2026 年 10 月:10/1 是星期四;前面補 9/27~9/30
  const out = [];
  for (let i = 0; i < 35; i++) {
    const d = i - 3;
    if (d < 1) out.push({ d: String(30 + d), out: true, ...f(-1, i) });
    else out.push({ d: String(d), ...f(d, i) });
  }
  return out;
}
// ---- 排班格(班表檢視):用 Draft/RosterCell 實例 ----
async function rcell(state, l1, l2, opts = {}) {
  const c = await inst("49:484", { State: state });
  if (state !== "Empty") {
    await setTxt(c, "line-1", l1 || "");
    await setTxt(c, "line-2", l2 || "");
  }
  if (opts.bg) {
    c.fills = [await P(opts.bg, opts.op || 1)];
    // 格子內容底色一起換(店休 / 其他分店 / 不可排灰、畫休淡藍)
    const slot = c.findOne((n) => n.name.startsWith("slot"));
    if (slot) slot.fills = [await P(opts.bg, opts.op || 1)];
  }
  return c;
}
async function headCell(t1, t2, w, k = "capSB", c = "ts", bg) {
  const h = AL("VERTICAL", {
    name: "head-cell",
    itemSpacing: 0,
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 6,
    paddingBottom: 6,
  });
  if (bg) await fill(h, bg);
  await stroke(h, "divider");
  add(h, await T(t1, k, c));
  if (t2) add(h, await T(t2, "cap", "ts"));
  h.layoutSizingHorizontal = "FIXED";
  h.resize(w, h.height);
  return h;
}
// ---- 時間軸區塊:Draft/ScheduleTimelineBlock(Base Draft 的底座草稿元件)----
let TLB = null;
async function tlBlock(state, title, sub, w, h, auto = false) {
  if (!TLB) {
    const b = await figma.getNodeByIdAsync("41:5914");
    await b.loadAsync();
    TLB = b.findOne(
      (n) =>
        n.type === "COMPONENT_SET" && n.name === "Draft/ScheduleTimelineBlock",
    );
  }
  const v =
    TLB.children.find(
      (c) =>
        c.name === "State=" + state + ", Auto=" + (auto ? "True" : "False"),
    ) || TLB.children[0];
  const i = v.createInstance();
  const pr = i.componentProperties;
  const p = {};
  for (const k of Object.keys(pr)) {
    if (k.startsWith("Title#")) p[k] = title;
    if (k.startsWith("Subtitle#")) p[k] = sub || "";
  }
  i.setProperties(p);
  i.resize(Math.max(24, w), h);
  return i;
}
// ---- 放置與註解 ----
function sec(label) {
  return PAGE.children.find((n) => n.type === "SECTION" && n.name === label);
}
const SEC = { D: "電腦 1440", T: "平板 1024", M: "手機 390" };
function put(sz, n) {
  const s = sec(SEC[sz]);
  s.appendChild(n);
  n.x = 100000;
  n.y = 100000;
  return n;
}
async function note(frame, lines) {
  const t = await TW(lines.join("\n"), 320, "cap", "ts");
  t.name = frame.name + " · 註解";
  frame.parent.appendChild(t);
  t.x = frame.x + frame.width + 24;
  t.y = frame.y;
  return t;
}
async function byName(re, sz) {
  const s = sec(SEC[sz]);
  return s.children.find((n) => re.test(n.name));
}
async function del(re, sz) {
  const s = sec(SEC[sz]);
  const out = [];
  for (const n of [...s.children])
    if (re.test(n.name)) {
      out.push(n.id + " " + n.name);
      n.remove();
    }
  return out;
}
