// ==== 精簡檔頭(第二輪起的腳本用)====
// MODE = 'scratch':在 scratch-lot Screens 執行,依 key 從 wowgo-base Library 匯入;
// MODE = 'base'   :在 wowgo-base Design System 本檔執行,依同一個 key 找本檔 local 變數 / 樣式。
// 與 _resolve.js 同一組 key,只留常用的 API:tok / style / paint / txt / al / add / setProps / radius。
// 底座草稿腳本(Base Draft 頁)用 BASE 色;專案腳本另外在 project/_compact.js 覆蓋 primary/* 為專案色。
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
    "action/hover": "9d069b9ff19a0e0bb8e82e1205e9b20fa27eea47",
    "action/selected": "37f80e5dfc92ba565ff5e53f7dd2c91ea8e4a323",
    "action/disabledBackground": "585480db6e01a4e2cb325bf38b8400dd5b0797ba",
    "radius/sm": "090b2c8aaafdc7c094af9a5115294468c5726601",
    "radius/md": "0f80284942703a107a0d15ce580a86d4172f7651",
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
};
const MODE = "scratch";
// 本輪草稿元件所在頁(兩種模式都在這一頁依名稱找草稿元件)
const DRAFT_PAGE =
  MODE === "base" ? "Draft / 本輪" : "Base Draft / 本輪底座元件";
const _c = {};
async function tok(n) {
  if (_c["v" + n]) return _c["v" + n];
  const key = K.var[n];
  if (!key) throw new Error("未登記的 token " + n);
  const v =
    MODE === "base"
      ? (await figma.variables.getLocalVariablesAsync()).find(
          (x) => x.key === key,
        )
      : await figma.variables.importVariableByKeyAsync(key);
  if (!v) throw new Error("找不到 token " + n);
  return (_c["v" + n] = v);
}
async function style(n) {
  if (_c["s" + n]) return _c["s" + n];
  const key = K.style[n];
  const s =
    MODE === "base"
      ? [
          ...(await figma.getLocalTextStylesAsync()),
          ...(await figma.getLocalEffectStylesAsync()),
        ].find((x) => x.key === key)
      : await figma.importStyleByKeyAsync(key);
  if (!s) throw new Error("找不到 style " + n);
  if (s.type === "TEXT") await figma.loadFontAsync(s.fontName);
  return (_c["s" + n] = s);
}
const paint = async (n) =>
  figma.variables.setBoundVariableForPaint(
    { type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } },
    "color",
    await tok(n),
  );
async function txt(chars, s, color = "text/primary", name) {
  const t = figma.createText();
  await t.setTextStyleIdAsync((await style(s)).id);
  t.characters = chars;
  t.fills = [await paint(color)];
  if (name) t.name = name;
  return t;
}
function al(dir, props = {}) {
  const f = figma.createAutoLayout(dir, props);
  f.fills = [];
  f.clipsContent = false;
  return f;
}
// 切到草稿頁(use_figma 每次呼叫都回到第一頁)
async function toDraftPage() {
  const p = figma.root.children.find((x) => x.name === DRAFT_PAGE);
  if (!p) throw new Error("找不到草稿頁 " + DRAFT_PAGE);
  await figma.setCurrentPageAsync(p);
  return p;
}
function draft(name) {
  const n = figma.currentPage.findOne(
    (x) =>
      (x.type === "COMPONENT_SET" || x.type === "COMPONENT") && x.name === name,
  );
  if (!n) throw new Error("目前頁沒有草稿元件 " + name);
  return n;
}
function add(p, c, h, v) {
  p.appendChild(c);
  if (h) c.layoutSizingHorizontal = h;
  if (v) c.layoutSizingVertical = v;
  return c;
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
async function setProps(i, o) {
  const cur = i.componentProperties;
  const out = {};
  for (const [n, v] of Object.entries(o)) {
    const k = Object.keys(cur).find((x) => x.split("#")[0] === n);
    if (k) out[k] = v;
  }
  if (Object.keys(out).length) {
    for (const t of i.findAll((n) => n.type === "TEXT"))
      if (t.characters.length)
        for (const f of t.getRangeAllFontNames(0, t.characters.length))
          await figma.loadFontAsync(f);
    i.setProperties(out);
  }
  return i;
}
const DESC_PREFIX = "【底座・本輪草稿,完成後搬回 wowgo-base Design System】";
// ==== 精簡檔頭結束 ====
