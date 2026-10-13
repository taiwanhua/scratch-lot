// ==== 畫面工具組(第二輪起的畫面腳本用;scratch-lot Screens 執行)====
// 用法:先宣告 `const PROJECT = true | false;`(true = 專案畫面:主色綁 scratch-lot Brand Library、側欄用 Draft/ScratchLotSideNav;
// false = 底座參考畫面:主色綁 wowgo-base、側欄用 Draft/AdminSideNav),再貼本檔,最後貼畫面腳本。
// 底座元件一律用 wowgo-base Library 遠端實例;本輪底座草稿與專案元件依節點 id 取(nodes.md)。
figma.skipInvisibleInstanceChildren = false;
const KV = {
  "bg/paper": "7875005cdf746478c3e17c225db9fce44ab90451",
  "bg/default": "f3cf90e5f836dd44d0124f96199feb7ce961d9fc",
  divider: "860a5dc497e0d365947731af9f273cd963ca1d04",
  "text/primary": "d55b27457c6f95c898e614be4c16cef386fe1f65",
  "text/secondary": "c11ac6a81b471a6a46f85602d056355c19fd4166",
  "text/disabled": "b8f6a2814dee4ecdbc02bb973690b11f2e43dc40",
  "error/main": "0d2b086b0de059122075ae1efcdf53c86d10497d",
  "success/main": "6e398ee88e62c802e89a1f46853dfda221b9d453",
  "warning/main": "c4795bb776010891dbb7e03790c05d403ac4c75a",
  "info/main": "54b394efe9085b0dbab1f981e282b66d1a5724cf",
  "action/selected": "37f80e5dfc92ba565ff5e53f7dd2c91ea8e4a323",
  "action/disabledBackground": "585480db6e01a4e2cb325bf38b8400dd5b0797ba",
  "radius/sm": "090b2c8aaafdc7c094af9a5115294468c5726601",
  "radius/md": "0f80284942703a107a0d15ce580a86d4172f7651",
  "grey/900": "9f38df4321b6550359ccdb9bf4a49242e242b4bb",
  "common/white": "7f4826a53bbae5113e7761bb3b54c5681f7c684d",
};
Object.assign(
  KV,
  PROJECT
    ? {
        "primary/main": "19ff85b8d50ac8532f0a2655b6f8f5ad4d01d1ed",
        "primary/lighter": "1303b01c541b1d24d104d836b0d64ee3c188c7a3",
        "primary/dark": "5e53a5328ebcc6c3e9e9be382460451c0b06e1f6",
        "primary/contrast": "29bd81f2011a58c4eb6acf2741f5c5a383913fd8",
      }
    : {
        "primary/main": "3666ac0c6b3d12e8e38f6be8270287eb55a5cce1",
        "primary/lighter": "910cd62c36bae23991a84c291f8b3a546df84384",
        "primary/dark": "c4d9e8d337cf252393a3cb8ec36da76e173ee699",
        "primary/contrast": "60e87705d77a858288a3c26b19399b632f333155",
      },
);
const KS = {
  "Heading/H6": "1be1d72d4db6f0630bc69d0fb1271637413e60f5",
  "Subtitle/1": "279cc15e98fb39161321012180207b27657910dd",
  "Subtitle/2": "10d300c90c1c0adee2e8665d86ade62c9d3a0d38",
  "Body/1": "f1cf218e9366639ba8b20a581a125d6dc8209847",
  "Body/2": "5fb1ba864f8fa1d388e29e66d1664b889e0a24ee",
  Caption: "cf4328c6d8830674997c8a3f7d6aa200f50eab70",
  "Caption/SemiBold": "7cfa2be1b685e1bf7c2d32270742cbf2e41d61d2",
  "Shadow/Dialog": "b1c64e5a1440659a32fb283906757a36ba9bc343",
};
// "=" 開頭 = 單一 component;其餘是 component set
const KC = {
  Button: "b3cc2937031e088ec1002079843a665540f0a2a6",
  Tag: "ab7a504856b03d0ae6d60aecfa9cd89bce1d40e2",
  Checkbox: "0f43bc3c9cb7d2b8bddee5c6e5259b687718911f",
  Radio: "cdf29d6eb4da90beb38e896a85e2df468eb38aba",
  Switch: "d60d8cff175215aac9403dee406bf8d23a7aaa4a",
  SelectField: "7565cb3914284d0a300c3f55e5c1aff84a57a408",
  TextField: "700a2b66cbc9de512532d2fd163b7c1e98823816",
  Alert: "43af792e455ff2e72054d1f1bc38a28177874ce3",
  Tab: "b8fe501f91145f150a3b88c487135446c7ecca61",
  Link: "e5ab1c3479391ac2a6507f9be7ac5f94a0da7f33",
  Badge: "643ac684f548a8f7e05334c6c39567319bdc637d",
  StatCard: "=85ad0a8698fcc1c0285719fce14a9113a9aa4f8c",
  AdminSideNav: "=13a24be1d3948435515fa6c7d2f5cc0c7592b0a1",
  AdminAppBar: "=471aba0f2558d59a459b88b25dcf531be908e940",
  AdminRouteTabs: "=14eb1d7575fe6f6cc39fe28163e6bbadcbb07bda",
};
const ND = {
  Section: "41:5932",
  AudiencePicker: "45:248",
  OrgTreeSelect: "47:409",
  MonthCalendar: "48:360",
  RosterGrid: "49:494",
  RosterCell: "49:493",
  Bell: "50:567",
  PrintButton: "51:625",
  StepperStep: "79:1325",
  Stepper: "79:1361",
  RcRow: "51:626",
  RcSign: "51:630",
  RcHeader: "80:1491",
  RcTable: "80:1508",
  RcRange: "80:1509",
  RcTotal: "80:1511",
  RcDivider: "80:1515",
  RcQR: "80:1517",
  SideNav: "64:15",
  TicketCell: "64:132",
  TicketGrid: "64:133",
  Denomination: "64:366",
  CashPointHeader: "64:512",
  BookCard: "64:558",
};
const _c = {};
const tok = async (n) =>
  (_c["v" + n] ||= await figma.variables.importVariableByKeyAsync(KV[n]));
async function sty(n) {
  if (_c["s" + n]) return _c["s" + n];
  const s = await figma.importStyleByKeyAsync(KS[n]);
  if (s.type === "TEXT") await figma.loadFontAsync(s.fontName);
  return (_c["s" + n] = s);
}
async function comp(n) {
  if (_c["c" + n]) return _c["c" + n];
  const k = KC[n];
  return (_c["c" + n] =
    k[0] === "="
      ? await figma.importComponentByKeyAsync(k.slice(1))
      : await figma.importComponentSetByKeyAsync(k));
}
const node = async (n) => (_c["n" + n] ||= await figma.getNodeByIdAsync(ND[n]));
const paint = async (n) =>
  figma.variables.setBoundVariableForPaint(
    { type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } },
    "color",
    await tok(n),
  );
async function T(chars, s = "Body/2", color = "text/primary", name) {
  const t = figma.createText();
  await t.setTextStyleIdAsync((await sty(s)).id);
  t.characters = chars;
  t.fills = [await paint(color)];
  if (name) t.name = name;
  return t;
}
function al(dir, p = {}) {
  const f = figma.createAutoLayout(dir, p);
  f.fills = [];
  f.clipsContent = false; // 浮動標籤與陰影不被裁切(畫圖檢查清單 2);需要裁切的(表格、殼)另外設定
  return f;
}
const H = (gap = 8, p = {}) =>
  al("HORIZONTAL", { itemSpacing: gap, counterAxisAlignItems: "CENTER", ...p });
const V = (gap = 8, p = {}) => al("VERTICAL", { itemSpacing: gap, ...p });
function add(p, c, h, v) {
  p.appendChild(c);
  if (h) c.layoutSizingHorizontal = h;
  if (v) c.layoutSizingVertical = v;
  return c;
}
async function put(p, items, h) {
  for (const it of items)
    if (it != null) add(p, typeof it === "string" ? await T(it) : it, h);
  return p;
}
function spacer(p) {
  const s = add(p, al("HORIZONTAL", { name: "spacer" }), "FILL");
  s.layoutSizingVertical = "FIXED";
  s.resize(s.width, 1);
  return s;
}
async function rad(n, r = "radius/md") {
  const v = await tok(r);
  for (const k of [
    "topLeftRadius",
    "topRightRadius",
    "bottomLeftRadius",
    "bottomRightRadius",
  ])
    n.setBoundVariable(k, v);
}
async function fonts(i) {
  for (const t of i.findAll((n) => n.type === "TEXT")) {
    if (!t.characters.length) {
      if (t.fontName !== figma.mixed) await figma.loadFontAsync(t.fontName);
      continue;
    }
    for (const f of t.getRangeAllFontNames(0, t.characters.length))
      await figma.loadFontAsync(f);
  }
}
async function setProps(i, o) {
  const cur = i.componentProperties,
    out = {};
  for (const [n, v] of Object.entries(o)) {
    const k = Object.keys(cur).find((x) => x.split("#")[0] === n);
    if (k) out[k] = v;
  }
  if (Object.keys(out).length) {
    await fonts(i);
    i.setProperties(out);
  }
  return i;
}
const variantOf = (set, p) =>
  set.type === "COMPONENT"
    ? set
    : set.children.find((c) =>
        Object.entries(p).every(
          ([k, v]) => (c.variantProperties || {})[k] === v,
        ),
      ) || set.defaultVariant;
const vi = async (set, p = {}, o = {}) =>
  setProps(variantOf(set, p).createInstance(), o);
const inst = async (n, p, o) => vi(await comp(n), p, o);
const dinst = async (n, p, o) => vi(await node(n), p, o);
async function setText(root, match, chars) {
  const t = root.findOne(
    (n) => n.type === "TEXT" && (n.name === match || n.characters === match),
  );
  if (!t) return null;
  await fonts({ findAll: () => [t] });
  t.characters = chars;
  return t;
}
// ---- 常用元件 ----
const btn = (
  l,
  v = "Contained",
  c = "Primary",
  st = "Default",
  sz = "Medium",
) =>
  inst("Button", { Variant: v, Size: sz, State: st, Color: c }, { Label: l });
const sbtn = (l, v = "Outlined", c = "Primary") =>
  btn(l, v, c, "Default", "Small");
const tag = (l, tone = "Grey") => inst("Tag", { Tone: tone }, { Label: l });
const alert = (m, sev = "Info") =>
  inst("Alert", { Severity: sev }, { Message: m, Action: false });
async function field(l, v, o = {}) {
  const f = await inst(
    "TextField",
    { Size: o.size || "Small", State: o.state || "Default" },
    { Label: l, Value: v, Helper: o.helper || "" },
  );
  if (o.w) f.resize(o.w, f.height);
  return f;
}
async function select(l, v, w, st = "Default") {
  const f = await inst("SelectField", { State: st });
  await fonts(f);
  const L = f.findOne((n) => n.type === "TEXT" && n.name === "label"),
    Vv = f.findOne((n) => n.type === "TEXT" && n.name === "value");
  if (L) L.characters = l;
  if (Vv) Vv.characters = v;
  if (w) f.resize(w, f.height);
  return f;
}
async function check(l, on = false, en = true) {
  const r = H(6);
  add(
    r,
    await inst("Checkbox", {
      State: on ? "Checked" : "Unchecked",
      Enabled: en ? "True" : "False",
    }),
  );
  if (l) add(r, await T(l, "Body/2", en ? "text/primary" : "text/disabled"));
  return r;
}
async function radio(l, on = false) {
  const r = H(6);
  add(r, await inst("Radio", { State: on ? "Selected" : "Default" }));
  add(r, await T(l));
  return r;
}
async function sw(l, on = true) {
  const r = H(8);
  add(r, await inst("Switch", { State: on ? "On" : "Off", Enabled: "True" }));
  if (l) add(r, await T(l));
  return r;
}
async function card(name = "card", gap = 12, pad = 20) {
  const c = V(gap, {
    name,
    paddingLeft: pad,
    paddingRight: pad,
    paddingTop: Math.max(0, pad - 4),
    paddingBottom: Math.max(0, pad - 4),
  });
  c.fills = [await paint("bg/paper")];
  c.clipsContent = false; // 浮動標籤(TextField / SelectField)不被裁切;表格另設 true
  await rad(c);
  return c;
}
async function kv(l, v, o = {}) {
  const r = H(12, { name: "kv" });
  add(r, await T(l, "Body/2", "text/secondary"));
  spacer(r);
  add(
    r,
    typeof v === "string"
      ? await T(
          v,
          o.strong ? "Subtitle/1" : "Body/1",
          o.color || "text/primary",
        )
      : v,
  );
  return r;
}
async function grid(items, n = 3, gap = 16) {
  const g = V(12, { name: "grid" });
  for (let i = 0; i < items.length; i += n) {
    const r = add(
      g,
      H(gap, { name: "grid-row", counterAxisAlignItems: "MIN" }),
    );
    for (const it of items.slice(i, i + n)) add(r, it, "FILL");
    r.layoutSizingHorizontal = "FILL";
  }
  return g;
}
async function tabs(labels, active) {
  const r = al("HORIZONTAL", { name: "PageTabs", itemSpacing: 0 });
  r.strokes = [await paint("divider")];
  r.strokeTopWeight = r.strokeLeftWeight = r.strokeRightWeight = 0;
  r.strokeBottomWeight = 1;
  for (const l of labels)
    add(
      r,
      await inst(
        "Tab",
        { State: l === active ? "Active" : "Default" },
        { Label: l, Badge: false },
      ),
    );
  return r;
}
// 表格:cols = [[標題, 寬], …];cell = 字串 / 節點 / 陣列;o.right = 靠右欄 index;o.selected = 選中列
async function table(cols, rows, o = {}) {
  const c = await card(o.name || "table", 0, 0);
  c.clipsContent = true;
  const mk = async (cells, head, i) => {
    const r = H(12, {
      name: head ? "thead" : "tr",
      paddingTop: head ? 8 : 10,
      paddingBottom: head ? 8 : 10,
      paddingLeft: 16,
      paddingRight: 16,
    });
    if (head) r.fills = [await paint("bg/default")];
    else if (o.selected && o.selected.includes(i))
      r.fills = [await paint("action/selected")];
    r.strokes = [await paint("divider")];
    r.strokeTopWeight = r.strokeLeftWeight = r.strokeRightWeight = 0;
    r.strokeBottomWeight = 1;
    for (let k = 0; k < cols.length; k++) {
      const b = H(6, { name: "td" });
      b.resize(cols[k][1], 20);
      b.primaryAxisSizingMode = "FIXED";
      b.counterAxisSizingMode = "AUTO";
      if (o.right && o.right.includes(k)) b.primaryAxisAlignItems = "MAX";
      for (const x of Array.isArray(cells[k]) ? cells[k] : [cells[k]]) {
        if (x == null || x === "") continue;
        add(
          b,
          typeof x === "string"
            ? await T(
                x,
                head ? "Subtitle/2" : "Body/2",
                head ? "text/secondary" : "text/primary",
              )
            : x,
        );
      }
      add(r, b);
    }
    return r;
  };
  add(
    c,
    await mk(
      cols.map((x) => x[0]),
      true,
    ),
    "FILL",
  );
  for (let i = 0; i < rows.length; i++)
    add(c, await mk(rows[i], false, i), "FILL");
  if (o.footer) {
    const f = H(12, {
      name: "footer",
      paddingTop: 10,
      paddingBottom: 10,
      paddingLeft: 16,
      paddingRight: 16,
    });
    spacer(f);
    add(f, await T(o.footer, "Body/2", "text/secondary"));
    add(c, f, "FILL");
  }
  return c;
}
const red = (s) => T(s, "Body/2", "error/main"),
  warn = (s) => T(s, "Body/2", "warning/main"),
  okc = (s) => T(s, "Body/2", "success/main"),
  muted = (s) => T(s, "Body/2", "text/secondary"),
  bold = (s, c = "text/primary") => T(s, "Subtitle/2", c);
async function cap(p, s) {
  const t = add(p, await T(s, "Caption", "text/secondary"), "FILL");
  t.textAutoResize = "HEIGHT";
  return t;
}
async function para(p, s, st = "Body/2", c = "text/primary") {
  const t = add(p, await T(s, st, c), "FILL");
  t.textAutoResize = "HEIGHT";
  return t;
}
async function section(title, children, o = {}) {
  const s = await dinst(
    "Section",
    { State: o.collapsed ? "Collapsed" : "Expanded" },
    { Title: title, Summary: o.summary || "" },
  );
  if (!o.collapsed) {
    const slot = s.findAllWithCriteria({ types: ["SLOT"] })[0];
    for (const ch of [...slot.children]) ch.remove();
    for (const ch of children)
      add(slot, typeof ch === "string" ? await T(ch) : ch, "FILL");
  }
  return s;
}
async function stepper(labels, cur, err = -1) {
  const r = H(12, { name: "Stepper" });
  const set = await node("StepperStep");
  for (let i = 0; i < labels.length; i++) {
    if (i) {
      const ln = figma.createRectangle();
      ln.name = "connector";
      ln.resize(28, 2);
      ln.fills = [await paint(i <= cur ? "primary/main" : "divider")];
      add(r, ln);
    }
    add(
      r,
      await vi(
        set,
        {
          State:
            i === err
              ? "Error"
              : i < cur
                ? "Done"
                : i === cur
                  ? "Current"
                  : "Todo",
        },
        { Index: String(i + 1), Label: labels[i] },
      ),
    );
  }
  return r;
}
async function actions(right, left = []) {
  const f = H(8, { name: "actions" });
  for (const x of left) add(f, x);
  spacer(f);
  for (const x of right) add(f, x);
  return f;
}
async function titleRow(title, sub, right = []) {
  const r = H(12, { name: "title" });
  add(r, await T(title, "Heading/H6"));
  if (sub) add(r, await T(sub, "Body/2", "text/secondary"));
  spacer(r);
  for (const x of right) add(r, x);
  return r;
}
async function filters(items) {
  const r = H(12, { name: "filters", counterAxisAlignItems: "MAX" });
  for (const x of items) add(r, x);
  return r;
}
// ---- 殼 ----
async function shell(name, title, nav, tab, w = 1440) {
  const s = figma.createFrame();
  s.name = name;
  s.layoutMode = "HORIZONTAL";
  s.resize(w, 900);
  s.primaryAxisSizingMode = "FIXED";
  s.counterAxisSizingMode = "FIXED";
  s.fills = [await paint("bg/default")];
  s.clipsContent = true;
  let sn;
  if (PROJECT) {
    sn = (await node("SideNav")).createInstance();
    const it = sn.findOne((n) => n.name === "nav:" + nav);
    if (it) {
      it.fills = [await paint("primary/lighter")];
      await fonts(it);
      const t = it.findOne((n) => n.type === "TEXT" && n.characters === nav);
      if (t) t.fills = [await paint("primary/dark")];
    }
  } else sn = await inst("AdminSideNav");
  add(s, sn, null, "FILL");
  const main = al("VERTICAL", { name: "main" });
  add(s, main, "FILL", "FILL");
  const bar = await inst("AdminAppBar", {}, { Title: title });
  if (PROJECT) await setText(bar, "wowgo-base", "中山店");
  add(main, bar, "FILL");
  const rt = await inst("AdminRouteTabs");
  for (const t of rt.findAll(
    (x) => x.type === "INSTANCE" && /^tab-/.test(x.name),
  )) {
    if (t.name === "tab-1") await setProps(t, { Label: tab || title });
    else t.visible = false;
  }
  add(main, rt, "FILL");
  const content = al("VERTICAL", {
    name: "content",
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 20,
    paddingBottom: 24,
    itemSpacing: 16,
  });
  add(main, content, "FILL", "FILL");
  const bell = (await node("Bell")).children
    .find((v) => v.name === "Unread=True")
    .createInstance();
  bell.name = "notification-bell(待 AppBar 加槽)";
  main.appendChild(bell);
  bell.layoutPositioning = "ABSOLUTE";
  bell.x = w - 240 - 432;
  bell.y = 12;
  return { s, content, main };
}
// 依內容撐高(最少 900)
function fit(sh) {
  const { s, content } = sh;
  for (const c of content.children)
    if (c.layoutSizingVertical === "FILL") c.layoutSizingVertical = "HUG";
  content.layoutSizingVertical = "HUG";
  s.resize(
    s.width,
    Math.max(900, Math.ceil((content.y + content.height) / 10) * 10),
  );
  content.layoutSizingVertical = "FILL";
}
// 手機 / 平板(無側欄)
async function device(name, w, h, title) {
  const s = V(0, { name });
  s.resize(w, h);
  s.primaryAxisSizingMode = "FIXED";
  s.counterAxisSizingMode = "FIXED";
  s.fills = [await paint("bg/default")];
  s.clipsContent = true;
  const bar = add(
    s,
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
  await put(bar, [await T("☰", "Subtitle/1"), await T(title, "Subtitle/1")]);
  const content = add(
    s,
    V(12, {
      name: "content",
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 16,
      paddingBottom: 16,
    }),
    "FILL",
    "FILL",
  );
  return { s, content, bar };
}
async function overlay(name, width) {
  const ov = figma.createFrame();
  ov.name = name;
  ov.resize(1440, 900);
  ov.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }];
  ov.clipsContent = true; // FIGMA-06 Overlay 慣例
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
  dlg.resize(width, 100);
  dlg.primaryAxisSizingMode = "AUTO";
  dlg.x = (1440 - width) / 2;
  dlg.y = 64;
  return { ov, dlg };
}
async function dhead(dlg, title, sub) {
  const r = add(dlg, H(8, { name: "head" }), "FILL");
  add(r, await T(title, "Heading/H6"));
  spacer(r);
  if (sub) add(r, await T(sub, "Body/2", "text/secondary"));
  return r;
}
// 對話框太高時,遮罩跟著撐高
function fitOv(ov, dlg) {
  if (dlg.y + dlg.height + 40 > ov.height)
    ov.resize(ov.width, dlg.y + dlg.height + 64);
}
async function drawer(sh, title, w = 520) {
  const d = V(16, {
    name: "drawer:" + title,
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 20,
    paddingBottom: 20,
  });
  d.fills = [await paint("bg/paper")];
  d.effectStyleId = (await sty("Shadow/Dialog")).id;
  sh.s.appendChild(d);
  d.layoutPositioning = "ABSOLUTE";
  d.counterAxisSizingMode = "FIXED";
  d.resize(w, sh.s.height);
  d.primaryAxisSizingMode = "FIXED";
  d.x = sh.s.width - w;
  d.y = 0;
  await dhead(d, title);
  return d;
}
// 頁面上同一列往右排
function place(n, y, gap = 120) {
  const same = figma.currentPage.children.filter(
    (x) => x !== n && Math.abs(x.y - y) < 1,
  );
  n.x = same.reduce((m, x) => Math.max(m, x.x + x.width + gap), 0);
  n.y = y;
}
const bottomY = (gap = 400) =>
  figma.currentPage.children.reduce((m, x) => Math.max(m, x.y + x.height), 0) +
  gap;
async function rowLabel(text, y) {
  const t = await T(text, "Heading/H6", "text/secondary", "row-label");
  figma.currentPage.appendChild(t);
  t.x = 0;
  t.y = y - 80;
  return t;
}
// 取得(或建立)某一列的 y:同名 row-label 已存在就沿用
async function rowY(label) {
  const ex = figma.currentPage.findChild(
    (n) =>
      n.name === "row-label" && n.type === "TEXT" && n.characters === label,
  );
  if (ex) return ex.y + 80;
  const y = bottomY(400);
  await rowLabel(label, y);
  return y;
}
const made = [];
const done = (x, y) => {
  const isNode = typeof x.type === "string";
  if (!isNode && x.content) fit(x);
  const n = isNode ? x : x.s || x.ov;
  place(n, y);
  made.push([n.name, n.id]);
  return n;
};
// ==== 工具組結束 ====
// 整頁補綁專案色(同 project/brand-rebind.js;只在專案頁用)
async function rebindPage(roots) {
  const cols =
    await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
  const map = new Map();
  for (const side of ["Brand", "Color"]) {
    const s = cols.find(
      (c) => c.libraryName === "wowgo-base Design System" && c.name === side,
    );
    const t = cols.find(
      (c) => c.libraryName === "scratch-lot Brand Library" && c.name === side,
    );
    const sv = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(
      s.key,
    );
    const tv = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(
      t.key,
    );
    for (const r of ["lighter", "light", "main", "dark", "darker", "contrast"])
      map.set(
        sv.find((v) => v.name === "primary/" + r).key,
        tv.find((v) => v.name === "primary/" + r).key,
      );
  }
  const vc = new Map(),
    im = new Map();
  let changed = 0;
  const all = roots
    ? roots.flatMap((r) => [r, ...r.findAll(() => true)])
    : figma.currentPage.findAll(() => true);
  for (const nd of all)
    for (const prop of ["fills", "strokes"]) {
      if (!(prop in nd) || !Array.isArray(nd[prop]) || !nd[prop].length)
        continue;
      let dirty = false;
      const next = [];
      for (const p of nd[prop]) {
        const id = p.boundVariables?.color?.id;
        if (id && !vc.has(id))
          vc.set(id, await figma.variables.getVariableByIdAsync(id));
        const v = id ? vc.get(id) : null;
        if (!v || !map.has(v.key)) {
          next.push(p);
          continue;
        }
        const k = map.get(v.key);
        if (!im.has(k))
          im.set(k, await figma.variables.importVariableByKeyAsync(k));
        next.push(
          figma.variables.setBoundVariableForPaint(p, "color", im.get(k)),
        );
        dirty = true;
        changed++;
      }
      if (dirty) {
        if (nd.type === "TEXT") await fonts({ findAll: () => [nd] });
        nd[prop] = next;
      }
    }
  return changed;
}
