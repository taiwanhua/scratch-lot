// 班表頁(70:14)的檢核按鈕換成底座 Draft/ToggleButton(Base Draft 497:8040)實例,拿掉 Library Button 上的手改(框色 / 字色 / 疊色)。
// 一次性替換;之後重畫班表頁時 r5-roster.js 直接用 ToggleButton。
// 顏色:「限制 0 · 提醒 n」Warning、「檢核 ✓」Neutral、其他「限制 n · 提醒 n」Error;名稱含「已選取」的(面板展開)State=Selected。
// 位置、版面設定(絕對定位 / auto layout 的 sizing)沿用原按鈕;原按鈕在別的實例裡面時不能換,列在 skipped。
figma.skipInvisibleInstanceChildren = false;
const PAGE_ID = "70:14";
const SET_ID = "497:8040"; // Draft/ToggleButton
const set = await figma.getNodeByIdAsync(SET_ID);
const variant = (color, state) =>
  set.children.find((v) => v.name === `Color=${color}, State=${state}`);
const page = await figma.getNodeByIdAsync(PAGE_ID);
await page.loadAsync();
const RE = /^(限制 \d+ · 提醒 \d+|檢核 ✓)$/;
const olds = [];
for (const n of page.findAllWithCriteria({ types: ["INSTANCE"] })) {
  const mc = await n.getMainComponentAsync();
  if (!mc || !mc.remote || (mc.parent?.name || mc.name) !== "Button") continue;
  const t = n.findOne((x) => x.type === "TEXT");
  if (t && RE.test(t.characters.trim()))
    olds.push([n, t.characters.trim(), mc]);
}
const inInstance = (n) => {
  for (let p = n.parent; p && p.type !== "PAGE"; p = p.parent)
    if (p.type === "INSTANCE") return true;
  return false;
};
const done = {},
  skipped = [],
  colorChange = [];
for (const [o, label, mc] of olds) {
  if (inInstance(o)) {
    skipped.push(o.id + " " + label);
    continue;
  }
  const color = /^限制 0 /.test(label)
    ? "Warning"
    : label === "檢核 ✓"
      ? "Neutral"
      : "Error";
  const was = mc.name.match(/Color=(\w+)/)[1];
  if ({ Error: "Error", Primary: "Warning", Success: "Neutral" }[was] !== color)
    colorChange.push(`${o.id} ${label} ${was}→${color}`);
  const state = /已選取/.test(o.name) ? "Selected" : "Default";
  const n = variant(color, state).createInstance();
  const p = o.parent;
  p.insertChild(p.children.indexOf(o), n);
  n.resetOverrides(); // 不留任何覆寫(疊色在主元件的 state-layer 圖層)
  const key = Object.keys(n.componentProperties).find((k) =>
    k.startsWith("Label#"),
  );
  n.setProperties({ [key]: label });
  n.name =
    `ToggleButton ${label}` + (state === "Selected" ? "(已選取:面板展開)" : "");
  const auto = "layoutMode" in p && p.layoutMode !== "NONE";
  n.layoutPositioning = o.layoutPositioning;
  if (auto && o.layoutPositioning !== "ABSOLUTE") {
    n.layoutAlign = o.layoutAlign;
    n.layoutGrow = o.layoutGrow;
  } else {
    n.constraints = o.constraints;
    n.x = o.x;
    n.y = o.y;
  }
  o.remove();
  const k = `${color}/${state}`;
  done[k] = (done[k] || 0) + 1;
}
return { found: olds.length, done, skipped, colorChange };
