// ==== 專案畫面共用檔頭(只在 scratch-lot Screens 執行)====
// 專案畫面與專案元件不回收底座,所以只有 scratch 模式;資源 API 與底座的 _resolve.js 同名(tok / style / comp / draft / inst / setProps / txt / paint / radius / al / add)。
// 底座元件一律用 wowgo-base Library 遠端實例;本輪底座草稿用 baseDraft()(在「Base Draft / 本輪底座元件」頁依 id 取);專案元件用 projDraft()(在「Project Draft / 刮刮樂元件」頁依名稱取)。
figma.skipInvisibleInstanceChildren = false;
const K = {
  var: {
    "bg/paper": "7875005cdf746478c3e17c225db9fce44ab90451",
    "bg/default": "f3cf90e5f836dd44d0124f96199feb7ce961d9fc",
    divider: "860a5dc497e0d365947731af9f273cd963ca1d04",
    "text/primary": "d55b27457c6f95c898e614be4c16cef386fe1f65",
    "text/secondary": "c11ac6a81b471a6a46f85602d056355c19fd4166",
    "text/disabled": "b8f6a2814dee4ecdbc02bb973690b11f2e43dc40",
    "primary/main": "3666ac0c6b3d12e8e38f6be8270287eb55a5cce1",
    "primary/lighter": "910cd62c36bae23991a84c291f8b3a546df84384",
    "primary/dark": "c4d9e8d337cf252393a3cb8ec36da76e173ee699",
    "primary/contrast": "60e87705d77a858288a3c26b19399b632f333155",
    "error/main": "0d2b086b0de059122075ae1efcdf53c86d10497d",
    "success/main": "6e398ee88e62c802e89a1f46853dfda221b9d453",
    "warning/main": "c4795bb776010891dbb7e03790c05d403ac4c75a",
    "info/main": "54b394efe9085b0dbab1f981e282b66d1a5724cf",
    "info/contrast": "29501a48d324205161be70cc696fe3337af73631",
    "action/hover": "9d069b9ff19a0e0bb8e82e1205e9b20fa27eea47",
    "action/selected": "37f80e5dfc92ba565ff5e53f7dd2c91ea8e4a323",
    "action/disabledBackground": "585480db6e01a4e2cb325bf38b8400dd5b0797ba",
    "radius/sm": "090b2c8aaafdc7c094af9a5115294468c5726601",
    "radius/md": "0f80284942703a107a0d15ce580a86d4172f7651",
    "grey/300": "cc21f0a1f04bee50925591b9ed0af62b06dfbf44",
    "grey/100": "6a1782058955b5f1b570298844375dfdede51f73",
    "grey/900": "9f38df4321b6550359ccdb9bf4a49242e242b4bb",
    "common/white": "7f4826a53bbae5113e7761bb3b54c5681f7c684d",
  },
  style: {
    "Heading/H6": "1be1d72d4db6f0630bc69d0fb1271637413e60f5",
    "Subtitle/1": "279cc15e98fb39161321012180207b27657910dd",
    "Subtitle/2": "10d300c90c1c0adee2e8665d86ade62c9d3a0d38",
    "Body/1": "f1cf218e9366639ba8b20a581a125d6dc8209847",
    "Body/2": "5fb1ba864f8fa1d388e29e66d1664b889e0a24ee",
    Caption: "cf4328c6d8830674997c8a3f7d6aa200f50eab70",
    "Caption/SemiBold": "7cfa2be1b685e1bf7c2d32270742cbf2e41d61d2",
    "Shadow/Card": "50423901064568bafe3107fcdb477d2b3bea2e90",
    "Shadow/Dialog": "b1c64e5a1440659a32fb283906757a36ba9bc343",
  },
  comp: {
    Button: ["b3cc2937031e088ec1002079843a665540f0a2a6", true],
    "Draft/IconButton": ["edbcc00663e5f23f5938e0322765616b34c91f05", true],
    "Draft/Badge": ["643ac684f548a8f7e05334c6c39567319bdc637d", true],
    "Draft/Tag": ["ab7a504856b03d0ae6d60aecfa9cd89bce1d40e2", true],
    "Draft/Checkbox": ["0f43bc3c9cb7d2b8bddee5c6e5259b687718911f", true],
    "Draft/SelectField": ["7565cb3914284d0a300c3f55e5c1aff84a57a408", true],
    TextField: ["700a2b66cbc9de512532d2fd163b7c1e98823816", true],
    "Draft/Alert": ["43af792e455ff2e72054d1f1bc38a28177874ce3", true],
    "Draft/Tooltip": ["bd2762a43cd644fd271d0626866e79fb86ede120", true],
    "Draft/Tab": ["b8fe501f91145f150a3b88c487135446c7ecca61", true],
    "Draft/TableCell": ["7badb31de335380e5cb950dda0bdb30f5cc6aeb3", true],
    "Draft/TableHeaderCell": [
      "de43a4fa6f479324c70984502b4a53beb6903789",
      false,
    ],
    "Draft/Radio": ["cdf29d6eb4da90beb38e896a85e2df468eb38aba", true],
    Link: ["e5ab1c3479391ac2a6507f9be7ac5f94a0da7f33", true],
    "Draft/NavItem": ["3c962b9aa717c7fd99bea546659ec4251c945abb", false],
    "Draft/NavGroup": ["d5cefb7352a447529364d7b32037fefd86b1ac6b", true],
    "Draft/AdminAppBar": ["471aba0f2558d59a459b88b25dcf531be908e940", false],
    "Draft/AdminRouteTabs": ["14eb1d7575fe6f6cc39fe28163e6bbadcbb07bda", false],
    "Draft/StatCard": ["85ad0a8698fcc1c0285719fce14a9113a9aa4f8c", false],
  },
};
const BASE_DRAFT = {
  "Draft/ActionIcon+": "43:66",
  "Draft/Section": "41:5932",
  "Draft/OrgTreeSelect": "47:409",
  "Draft/MonthCalendar": "48:360",
  "Draft/RosterGrid": "49:494",
  "Draft/RosterCell": "49:493",
  "Draft/NotificationBell": "50:567",
  "Draft/PrintButton": "51:625",
  "Draft/Receipt58": "51:633",
  "Draft/Receipt58Row": "51:626",
  "Draft/Receipt58Signature": "51:630",
};
const _c = {};
async function tok(n) {
  if (!_c["v" + n])
    _c["v" + n] = await figma.variables.importVariableByKeyAsync(K.var[n]);
  return _c["v" + n];
}
async function style(n) {
  if (_c["s" + n]) return _c["s" + n];
  const s = await figma.importStyleByKeyAsync(K.style[n]);
  if (s.type === "TEXT") await figma.loadFontAsync(s.fontName);
  return (_c["s" + n] = s);
}
async function comp(n) {
  if (_c["c" + n]) return _c["c" + n];
  const [k, set] = K.comp[n];
  _c["c" + n] = set
    ? await figma.importComponentSetByKeyAsync(k)
    : await figma.importComponentByKeyAsync(k);
  return _c["c" + n];
}
async function baseDraft(n) {
  if (!_c["b" + n]) _c["b" + n] = await figma.getNodeByIdAsync(BASE_DRAFT[n]);
  return _c["b" + n];
}
let PROJ_PAGE = null; // 由呼叫端設定為「Project Draft / 刮刮樂元件」頁
function projDraft(n) {
  const x = PROJ_PAGE.findOne(
    (y) =>
      (y.type === "COMPONENT_SET" || y.type === "COMPONENT") && y.name === n,
  );
  if (!x) throw new Error("沒有專案元件 " + n);
  return x;
}
function variantOf(set, props) {
  if (set.type === "COMPONENT") return set;
  return (
    set.children.find((c) =>
      Object.entries(props).every(
        ([k, v]) => (c.variantProperties || {})[k] === v,
      ),
    ) || set.defaultVariant
  );
}
async function loadFontsIn(i) {
  // 空字串的文字節點(例:TextField 的 Label 設成 "")不能用 getRangeAllFontNames
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
  const cur = i.componentProperties;
  const out = {};
  for (const [n, v] of Object.entries(o)) {
    const k = Object.keys(cur).find((x) => x.split("#")[0] === n);
    if (k) out[k] = v;
  }
  if (Object.keys(out).length) {
    await loadFontsIn(i);
    i.setProperties(out);
  }
  return i;
}
async function instOf(setOrComp, props = {}, o = {}) {
  return setProps(variantOf(setOrComp, props).createInstance(), o);
}
const inst = async (n, p, o) => instOf(await comp(n), p, o);
const binst = async (n, p, o) => instOf(await baseDraft(n), p, o);
const pinst = async (n, p, o) => instOf(projDraft(n), p, o);
async function paint(n) {
  return figma.variables.setBoundVariableForPaint(
    { type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } },
    "color",
    await tok(n),
  );
}
async function txt(chars, s, color = "text/primary", name) {
  const t = figma.createText();
  await t.setTextStyleIdAsync((await style(s)).id);
  t.characters = chars;
  t.fills = [await paint(color)];
  if (name) t.name = name;
  return t;
}
async function radius(node, n) {
  const v = await tok(n);
  for (const k of [
    "topLeftRadius",
    "topRightRadius",
    "bottomLeftRadius",
    "bottomRightRadius",
  ])
    node.setBoundVariable(k, v);
}
function al(dir, props = {}) {
  const f = figma.createAutoLayout(dir, props);
  f.fills = [];
  return f;
}
function add(p, c, h, v) {
  p.appendChild(c);
  if (h) c.layoutSizingHorizontal = h;
  if (v) c.layoutSizingVertical = v;
  return c;
}
function spacer(p) {
  const s = add(p, al("HORIZONTAL", { name: "spacer" }), "FILL");
  s.resize(s.width, 1);
  return s;
}
// 改實例內某個文字節點(依目前文字或節點名比對)
async function setText(root, match, chars) {
  const t = root.findOne(
    (n) => n.type === "TEXT" && (n.name === match || n.characters === match),
  );
  if (!t) return null;
  await loadFontsIn({ findAll: () => [t] });
  t.characters = chars;
  return t;
}
const DESC_PROJECT = "【專案・scratch-lot 專屬,不回收底座】";
// ==== 檔頭結束 ====
