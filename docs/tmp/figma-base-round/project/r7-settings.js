// 第二十五輪:設定類畫面(班表頁 70:14,三尺寸)跟著執行任務模型改,沿用畫面裡現有的節點複製改字,不另畫:
// - SC-20a 自動排班:條件清單最後加「允許同一人同時段填進多筆人力需求(兼多個崗位)」(預設不勾,可拖拉排序)。
// - SC-22a 人力需求範本 · 補貨:拿掉「預設休息」「負責人數 / 協同人數」,改成負責人 0~1、協同 0~10 兩塊執行任務(補貨:沒有負責人、協同 1 筆「店內事務」)。
// - SC-10 規則:加「同一時段兼多個崗位」(提醒,預設關閉)、「預設休息」(滿 4 小時 30 分、滿 8 小時 60 分)、「負責人 / 協同預設任務」。
figma.skipInvisibleInstanceChildren = false;
const page = await figma.getNodeByIdAsync("70:14");
await page.loadAsync();
const loaded = new Set();
const fonts = async (n) => {
  const ts = n.type === "TEXT" ? [n] : n.findAll((x) => x.type === "TEXT");
  for (const t of ts)
    for (const f of t.getRangeAllFontNames(
      0,
      Math.max(1, t.characters.length),
    )) {
      const k = JSON.stringify(f);
      if (!loaded.has(k)) {
        await figma.loadFontAsync(f);
        loaded.add(k);
      }
    }
};
const setT = async (t, s) => {
  await fonts(t);
  t.characters = s;
};
const btnLabel = (b, s, color) => {
  const k = Object.keys(b.componentProperties).find((x) =>
    x.startsWith("Label#"),
  );
  const p = { [k]: s };
  if (color) p.Color = color;
  b.setProperties(p);
  b.name = "Button " + s;
};
const screens = (re) =>
  page.children.flatMap((s) =>
    s.children.filter((f) => re.test(f.name) && !/註解/.test(f.name)),
  );
const panelOf = (f) =>
  f.children.find((c) => !c.name.startsWith("背景:") && c.name !== "scrim");
const out = [];
// SC-20a
for (const f of screens(/^SC-20a /)) {
  const p = panelOf(f);
  const conds = p.findAll((n) => n.name === "cond");
  const last = conds[conds.length - 1];
  if (p.findOne((n) => n.type === "TEXT" && /兼多個崗位/.test(n.characters)))
    continue;
  const c = last.clone();
  last.parent.insertChild(last.parent.children.indexOf(last) + 1, c);
  const cb = c.findOne((n) => n.type === "INSTANCE");
  cb.setProperties({ State: "Unchecked" });
  const t = c.findAll((n) => n.type === "TEXT").pop();
  await setT(t, "允許同一人同時段填進多筆人力需求(兼多個崗位)");
  out.push("SC-20a " + f.width);
}
// SC-22a
for (const f of screens(/^SC-22a /)) {
  const p = panelOf(f);
  const body = p.findOne((n) => n.name === "body") || p;
  const brk = body.findOne((n) => n.name === "TextField 預設休息(分)");
  if (!brk) continue;
  brk.remove();
  const lead = body.findOne((n) => n.name === "TextField 負責人數");
  const row = lead.parent;
  const sel = body.findOne((n) => n.name === "SelectField 崗位");
  const label = body.findOne(
    (n) => n.type === "TEXT" && n.characters === "顏色",
  );
  const cancel =
    p.findOne((n) => n.name === "Button 取消") ||
    p.findOne((n) => n.type === "INSTANCE" && /^Button/.test(n.name));
  const idx = row.parent.children.indexOf(row);
  const parent = row.parent;
  row.remove();
  const nodes = [];
  const head = async (s) => {
    const r = figma.createAutoLayout("HORIZONTAL", {
      name: "section-head",
      itemSpacing: 8,
      counterAxisAlignItems: "CENTER",
    });
    r.fills = [];
    const a = label.clone();
    await setT(a, s);
    r.appendChild(a);
    return r;
  };
  const button = async (s, color) => {
    const b = cancel.clone();
    await fonts(b);
    btnLabel(b, s, color);
    b.setProperties({ Size: "Small" });
    return b;
  };
  nodes.push(await head("負責人(0~1 筆)"));
  const none = label.clone();
  await setT(none, "沒有負責人");
  nodes.push(none);
  nodes.push(await button("+ 負責人"));
  nodes.push(await head("協同(0~10 筆)"));
  const tr = figma.createAutoLayout("HORIZONTAL", {
    name: "task-row",
    itemSpacing: 8,
    counterAxisAlignItems: "CENTER",
  });
  tr.fills = [];
  const s2 = sel.clone();
  await fonts(s2);
  const lt = s2.findOne((n) => n.type === "TEXT" && n.name === "label");
  const vt = s2.findOne((n) => n.type === "TEXT" && n.name === "value");
  if (lt) await setT(lt, "執行任務");
  if (vt) await setT(vt, "店內事務");
  s2.name = "SelectField 執行任務";
  tr.appendChild(s2);
  tr.appendChild(await button("移除", "Error"));
  nodes.push(tr);
  nodes.push(await button("+ 協同"));
  nodes.forEach((n, i) => parent.insertChild(idx + i, n));
  tr.layoutSizingHorizontal = "FILL";
  s2.layoutSizingHorizontal = "FILL";
  out.push("SC-22a " + f.width);
}
// SC-10
for (const f of screens(/^SC-10 /)) {
  if (f.findOne((n) => n.type === "TEXT" && n.characters === "預設休息"))
    continue;
  const byName = (s) =>
    f
      .findAll((n) => n.name === "rule")
      .find((r) => r.findOne((t) => t.type === "TEXT" && t.characters === s));
  const add = async (srcName, after, name, value) => {
    const src = byName(srcName);
    const a = byName(after);
    const r = src.clone();
    a.parent.insertChild(a.parent.children.indexOf(a) + 1, r);
    const nt = r.findOne((t) => t.type === "TEXT" && t.characters === srcName);
    await setT(nt, name);
    const vf = r.findOne((n) => n.name === "value");
    const vt = vf && vf.findOne((t) => t.type === "TEXT");
    if (vt) await setT(vt, value);
    return r;
  };
  await add("每天最多上班時數", "人力不足", "同一時段兼多個崗位", "關閉");
  const r2 = await add(
    "畫休開放期間",
    "畫休開放期間",
    "預設休息",
    "滿 4 小時 30 分、滿 8 小時 60 分",
  );
  await add(
    "畫休開放期間",
    "預設休息",
    "負責人 / 協同預設任務",
    "店內事務與帳目負責 / 店內事務",
  );
  out.push("SC-10 " + f.width + " " + !!r2);
}
return out;
