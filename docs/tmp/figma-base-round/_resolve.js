// ==== 共用解析檔頭(每支元件腳本執行前都貼在最前面)====
// MODE = 'scratch':在 scratch-lot Screens 執行,一律從 wowgo-base Design System Library 依 key 匯入。
// MODE = 'base'   :在 wowgo-base Design System 本檔執行,依同一個 key 找本檔的 local 變數 / 樣式;
//                   元件依 BASE_NODE(FIGMA-09 節點表的 node id)取得。
// 本輪草稿元件(Draft/ActionIcon+、Draft/Section…)兩種模式都在「目前頁」依名稱找(local)。
// 元件本體只能透過 tok() / style() / comp() / draft() 取資源,不直接寫 key。
const MODE = "scratch";

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
    "primary/light": "1b0f30e799e398578bc1fd757c2ba7931e87abe1",
    "primary/dark": "c4d9e8d337cf252393a3cb8ec36da76e173ee699",
    "primary/contrast": "60e87705d77a858288a3c26b19399b632f333155",
    "error/main": "0d2b086b0de059122075ae1efcdf53c86d10497d",
    "success/main": "6e398ee88e62c802e89a1f46853dfda221b9d453",
    "warning/main": "c4795bb776010891dbb7e03790c05d403ac4c75a",
    "info/main": "54b394efe9085b0dbab1f981e282b66d1a5724cf",
    "success/lighter": "ac46db2e85d7432f8264076a65ac59b30d3c3df5",
    "success/darker": "ac8c30c7ab66719184ca649b28ae7a18bf1a4303",
    "action/hover": "9d069b9ff19a0e0bb8e82e1205e9b20fa27eea47",
    "action/selected": "37f80e5dfc92ba565ff5e53f7dd2c91ea8e4a323",
    "action/disabled": "0a2d364f0914dc6806f251b04b3fee8dbeb9f830",
    "action/disabledBackground": "585480db6e01a4e2cb325bf38b8400dd5b0797ba",
    "radius/sm": "090b2c8aaafdc7c094af9a5115294468c5726601",
    "radius/md": "0f80284942703a107a0d15ce580a86d4172f7651",
    "radius/lg": "01e922b59587582538054db097868efcdbac5730",
    "grey/700": "038b0dd75cf6a8e57d9dcd959b7a8c61d6779f15",
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
    "Shadow/Dropdown": "5f6fb8fd430e5a57b2fe73bd4f77fda6914fe14a",
    "Shadow/Card": "50423901064568bafe3107fcdb477d2b3bea2e90",
    "Shadow/Dialog": "b1c64e5a1440659a32fb283906757a36ba9bc343",
    "Shadow/z8": "7a21f8ab0c82ae53c891318c990dd7489ffcbaf4",
  },
  // component set(set: true)或單一 component
  comp: {
    Button: {
      key: "b3cc2937031e088ec1002079843a665540f0a2a6",
      set: true,
      baseNode: "2001:111",
    },
    "Draft/IconButton": {
      key: "edbcc00663e5f23f5938e0322765616b34c91f05",
      set: true,
      baseNode: "2001:538",
    },
    "Draft/ActionIcon": {
      key: "a491aeba877eac49ffcb0e39a589837c77eca4cd",
      set: true,
      baseNode: "2001:68",
    },
    "Draft/Badge": {
      key: "643ac684f548a8f7e05334c6c39567319bdc637d",
      set: true,
      baseNode: "2001:478",
    },
    "Draft/Tag": {
      key: "ab7a504856b03d0ae6d60aecfa9cd89bce1d40e2",
      set: true,
      baseNode: "2001:463",
    },
    "Draft/Checkbox": {
      key: "0f43bc3c9cb7d2b8bddee5c6e5259b687718911f",
      set: true,
    },
    "Draft/Select": {
      key: "3fc29f6f9084c597dff396222e9731fcfdd3e8a0",
      set: true,
    },
    "Draft/SelectField": {
      key: "7565cb3914284d0a300c3f55e5c1aff84a57a408",
      set: true,
    },
    TextField: { key: "700a2b66cbc9de512532d2fd163b7c1e98823816", set: true },
    // 現有組織樹列(選擇所屬組織等對話框用的那個);OrgTreeSelect 的樹沿用它(第十九輪)
    "Draft/OrgTreeItem": {
      key: "abfc25a6adf89900f5855cec32278badeeb2c6b4",
      set: true,
    },
    "Draft/Autocomplete": {
      key: "5c38eec3f628b810495609e04fb1e9830726c2c1",
      set: true,
      baseNode: "2001:391",
    },
    "Draft/Alert": {
      key: "43af792e455ff2e72054d1f1bc38a28177874ce3",
      set: true,
      baseNode: "2001:942",
    },
    "Draft/Tooltip": {
      key: "bd2762a43cd644fd271d0626866e79fb86ede120",
      set: true,
      baseNode: "2001:980",
    },
    "Draft/Tab": {
      key: "b8fe501f91145f150a3b88c487135446c7ecca61",
      set: true,
      baseNode: "2001:599",
    },
    "Draft/Tabs": {
      key: "56be097b82189e9888b828366b55ea281c6ad8ee",
      set: false,
      baseNode: "2001:610",
    },
    "Draft/Snackbar": {
      key: "1a48435131b2c4acd8e4555aef6da483980c6252",
      set: true,
    },
    "Draft/TableCell": {
      key: "7badb31de335380e5cb950dda0bdb30f5cc6aeb3",
      set: true,
      baseNode: "2001:632",
    },
    "Draft/TableHeaderCell": {
      key: "de43a4fa6f479324c70984502b4a53beb6903789",
      set: false,
      baseNode: "2001:630",
    },
    "Draft/Switch": {
      key: "d60d8cff175215aac9403dee406bf8d23a7aaa4a",
      set: true,
      baseNode: "2001:369",
    },
    "Draft/MenuItem": {
      key: "017428bc0a69de621e4d33784458d8890393dd91",
      set: true,
      baseNode: "2001:1004",
    },
    "Draft/ListItem": {
      key: "5d4f059831e3a6d2324d54247d60a88f0fd3863b",
      set: true,
      baseNode: "2001:1100",
    },
    Link: { key: "e5ab1c3479391ac2a6507f9be7ac5f94a0da7f33", set: true },
    "Draft/Radio": {
      key: "cdf29d6eb4da90beb38e896a85e2df468eb38aba",
      set: true,
    },
    "Draft/SegmentedControl": {
      key: "b2802133e71ea722a7ab42238bb8f7cfdba34f11",
      set: false,
      baseNode: "2001:521",
    },
    "Draft/Popover": {
      key: "ca3a578b09cca4e7cac93a81536a6c9100636f2d",
      set: false,
    },
    "Draft/CircularProgress": {
      key: "da1d7ddcda1dead54ebae11808b5ffb81e2d0907",
      set: false,
      baseNode: "2001:529",
    },
    "Draft/AdminSideNav": {
      key: "13a24be1d3948435515fa6c7d2f5cc0c7592b0a1",
      set: false,
      baseNode: "2001:1214",
    },
    "Draft/AdminAppBar": {
      key: "471aba0f2558d59a459b88b25dcf531be908e940",
      set: false,
      baseNode: "2001:1248",
    },
    "Draft/AdminRouteTabs": {
      key: "14eb1d7575fe6f6cc39fe28163e6bbadcbb07bda",
      set: false,
    },
    "Draft/ConfirmDialog": {
      key: "5b037167a3e719472e1a3bc08192a892254e31b9",
      set: false,
    },
  },
};

const _cache = {};
async function tok(name) {
  if (_cache["v:" + name]) return _cache["v:" + name];
  const key = K.var[name];
  if (!key) throw new Error("未登記的 token " + name);
  let v;
  if (MODE === "scratch")
    v = await figma.variables.importVariableByKeyAsync(key);
  else
    v = (await figma.variables.getLocalVariablesAsync()).find(
      (x) => x.key === key,
    );
  if (!v) throw new Error("找不到 token " + name);
  return (_cache["v:" + name] = v);
}
async function style(name) {
  if (_cache["s:" + name]) return _cache["s:" + name];
  const key = K.style[name];
  if (!key) throw new Error("未登記的 style " + name);
  let s;
  if (MODE === "scratch") s = await figma.importStyleByKeyAsync(key);
  else {
    const all = [
      ...(await figma.getLocalTextStylesAsync()),
      ...(await figma.getLocalEffectStylesAsync()),
    ];
    s = all.find((x) => x.key === key);
  }
  if (!s) throw new Error("找不到 style " + name);
  if (s.type === "TEXT") await figma.loadFontAsync(s.fontName);
  return (_cache["s:" + name] = s);
}
// 回傳 component set 或 component(底座既有元件)
async function comp(name) {
  if (_cache["c:" + name]) return _cache["c:" + name];
  const e = K.comp[name];
  if (!e) throw new Error("未登記的元件 " + name);
  let c;
  if (MODE === "scratch")
    c = e.set
      ? await figma.importComponentSetByKeyAsync(e.key)
      : await figma.importComponentByKeyAsync(e.key);
  else c = await figma.getNodeByIdAsync(e.baseNode);
  if (!c) throw new Error("找不到元件 " + name);
  return (_cache["c:" + name] = c);
}
// 本輪草稿元件:目前頁依名稱找
function draft(name) {
  const n = figma.currentPage.findOne(
    (x) =>
      (x.type === "COMPONENT_SET" || x.type === "COMPONENT") && x.name === name,
  );
  if (!n) throw new Error("目前頁沒有草稿元件 " + name);
  return n;
}
// 取 set 的某個變體:props 例 { Variant: 'Text', Size: 'Small' }
function variantOf(set, props) {
  if (set.type === "COMPONENT") return set;
  const want = Object.entries(props);
  const v = set.children.find((c) =>
    want.every(([k, val]) => (c.variantProperties || {})[k] === val),
  );
  return v || set.defaultVariant;
}
async function inst(name, props = {}, overrides = {}) {
  const c = await comp(name);
  const i = variantOf(c, props).createInstance();
  await setProps(i, overrides);
  return i;
}
// overrides 用屬性的「顯示名」(不含 #id),例 { Label: '儲存' }
async function setProps(i, overrides) {
  const cur = i.componentProperties;
  const out = {};
  for (const [name, val] of Object.entries(overrides)) {
    const k = Object.keys(cur).find(
      (x) => x === name || x.split("#")[0] === name,
    );
    if (k) out[k] = val;
  }
  if (Object.keys(out).length) {
    for (const t of i.findAll((n) => n.type === "TEXT")) {
      for (const f of t.getRangeAllFontNames(0, t.characters.length))
        await figma.loadFontAsync(f);
    }
    i.setProperties(out);
  }
  return i;
}
const SOLID = { r: 0.5, g: 0.5, b: 0.5 };
async function paint(name) {
  return figma.variables.setBoundVariableForPaint(
    { type: "SOLID", color: SOLID },
    "color",
    await tok(name),
  );
}
async function txt(chars, styleName, colorName = "text/primary", name) {
  const t = figma.createText();
  const s = await style(styleName);
  await t.setTextStyleIdAsync(s.id);
  t.characters = chars;
  t.fills = [await paint(colorName)];
  if (name) t.name = name;
  return t;
}
async function radius(node, name) {
  const v = await tok(name);
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
  f.clipsContent = false; // 浮動標籤、陰影不被裁切(畫圖檢查清單 2);需要裁切的另外設定
  return f;
}
function add(parent, child, h, v) {
  parent.appendChild(child);
  if (h) child.layoutSizingHorizontal = h;
  if (v) child.layoutSizingVertical = v;
  return child;
}
const DESC_PREFIX = "【底座・本輪草稿,完成後搬回 wowgo-base Design System】";
// ==== 檔頭結束 ====

// 框外註解(畫圖檢查清單 9):開發用說明不放在畫面裡,寫成畫面右邊的「<畫面名> · 註解」;位置由 project/r4-layout.js 排
async function noteOut(node, s) {
  let f = node;
  while (f.parent && f.parent.type !== "PAGE" && f.parent.type !== "SECTION")
    f = f.parent;
  const nm = f.name + " · 註解";
  let c = f.parent.children.find((n) => n.type === "TEXT" && n.name === nm);
  if (!c) {
    c = await txt("註解(不在畫面內)", "Caption", "text/secondary");
    f.parent.appendChild(c);
    c.name = nm;
    c.textAutoResize = "HEIGHT";
    c.resize(320, c.height);
    c.x = f.x + f.width + 24;
    c.y = f.y;
  }
  await figma.loadFontAsync(c.fontName);
  c.characters = c.characters + "\n- " + s;
  return c;
}
