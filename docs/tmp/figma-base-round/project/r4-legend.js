// 第十輪:張數格子共用圖例(scratch-lot Screens)。用法:`const PAGE_ID = "91:14";` + 本檔,每頁跑一次(可重複跑)。
// 找出頁上每個張數格子(由 Draft/TicketCell 實例排成的列),做三件事:
//   1. 格子一律每列 10 格;用覆寫畫的狀態(主色框、紅虛線、橘框、淡灰虛線)換成 TicketCell 的狀態變體。
//   2. 拿掉格子旁的文字圖例與舊的圖例列。
//   3. 在格子正上方靠右放 Draft/TicketGridLegend,只打開用得到的狀態(看板展開、本的詳情、拆本有固定組合)。
// r4-store.js 新畫的格子已經直接用變體與圖例;本檔處理其他既有畫面(IN-03、IN-04、ST-13、PU-09 等)。
const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);
const set = await figma.getNodeByIdAsync("64:132"); // Draft/TicketCell
const V = (n) => set.children.find((v) => v.name === "State=" + n);
const legendC = await figma.getNodeByIdAsync("174:264"); // Draft/TicketGridLegend
const varOf = async (p) => {
  const id =
    p &&
    p.boundVariables &&
    p.boundVariables.color &&
    p.boundVariables.color.id;
  if (!id) return null;
  const v = await figma.variables.getVariableByIdAsync(id);
  return v && v.name;
};
const isCell = async (i) => {
  if (i.type !== "INSTANCE") return false;
  const mc = await i.getMainComponentAsync();
  return !!(mc && mc.parent && mc.parent.id === set.id);
};
const LABEL = {
  Available: "未售",
  Unavailable: "已售",
  Shift: "本班售出",
  Other: "在別的收銀點",
  Assigned: "已分配",
  Skipped: "跳號",
  Scrapped: "報廢",
  Lost: "待查·遺失",
  Selected: "已選",
};
const FIXED = [
  [/^ST-36/, ["未售", "已售", "本班售出", "在別的收銀點", "已選"]],
  [/^IN-03/, ["未售", "已售", "跳號", "報廢", "待查·遺失", "已選"]],
  [/^ST-09a/, ["未售", "已選"]],
  [/^ST-09c/, ["未分配", "跳號", "已選", "已分配"]],
];
const screens = page.children
  .flatMap((n) => (n.type === "SECTION" ? [...n.children] : [n]))
  .filter((n) => n.type === "FRAME");
const report = [];
for (const s of screens) {
  const grids = [];
  for (const g of s.findAll(
    (n) =>
      n.type === "FRAME" &&
      n.children.length >= 5 &&
      n.children.every(
        (r) =>
          r.type === "FRAME" &&
          r.children.length >= 1 &&
          r.children.every((c) => c.type === "INSTANCE"),
      ),
  )) {
    let inInst = false;
    for (let a = g.parent; a && a !== s; a = a.parent)
      if (a.type === "INSTANCE") inInst = true;
    if (!inInst && (await isCell(g.children[0].children[0]))) grids.push(g);
  }
  for (const g of grids) {
    const is09c = /^ST-09c/.test(s.name);
    const present = new Set();
    for (const r of g.children)
      for (const c of r.children) {
        const mc = await c.getMainComponentAsync();
        let st = mc.name.replace("State=", "");
        if (st === "Unavailable" || st === "Available") {
          const vn = await varOf(c.strokes[0]);
          const dashed = c.dashPattern && c.dashPattern.length;
          if (c.opacity < 1 || (dashed && vn !== "error/main"))
            st = is09c ? "Assigned" : "Other";
          else if (vn === "primary/main") st = "Shift";
          else if (vn === "error/main") st = dashed ? "Skipped" : "Scrapped";
          else if (vn === "warning/main") st = "Lost";
          else if (st === "Unavailable" && is09c) st = "Skipped";
        }
        present.add(st);
        if (
          mc.name !== "State=" + st ||
          c.opacity < 1 ||
          c.dashPattern.length
        ) {
          const no = c.findOne((x) => x.type === "TEXT").characters;
          const w = c.width,
            h = c.height;
          c.swapComponent(V(st));
          c.resetOverrides();
          const t = c.findOne((x) => x.type === "TEXT");
          await figma.loadFontAsync(t.fontName);
          t.characters = no;
          c.resize(w, h);
        }
      }
    // 每列 10 格
    if (g.children.some((r) => r.children.length > 10)) {
      const cells = g.children.flatMap((r) => [...r.children]);
      const gap = g.children[0].itemSpacing;
      const rows = [...g.children];
      for (let i = 0; i < cells.length; i += 10) {
        const r = figma.createAutoLayout("HORIZONTAL", {
          name: "grid-row",
          itemSpacing: gap,
        });
        r.fills = [];
        r.clipsContent = false;
        g.appendChild(r);
        for (const c of cells.slice(i, i + 10)) r.appendChild(c);
      }
      for (const r of rows) r.remove();
    }
    let on = new Set([...present].map((x) => LABEL[x]));
    for (const [re, list] of FIXED) if (re.test(s.name)) on = new Set(list);
    // 拿掉文字圖例
    const P = g.parent;
    for (const sib of [...P.children])
      if (sib !== g) {
        if (
          sib.type === "TEXT" &&
          /^灰 = |^已選 = 在|^實心灰 = /.test(sib.characters)
        )
          sib.remove();
        else if (sib.type === "FRAME" && /^legend/.test(sib.name)) sib.remove();
      }
    // 包一層「grid+legend」,圖例在上
    let W = P.name === "grid+legend" ? P : null;
    if (W) {
      const old = W.children.find((n) => n.type === "INSTANCE");
      if (old) old.remove();
    } else {
      W = figma.createAutoLayout("VERTICAL", {
        name: "grid+legend",
        itemSpacing: 8,
      });
      W.fills = [];
      W.clipsContent = false;
      P.insertChild(P.children.indexOf(g), W);
      if (P.layoutMode === "NONE") {
        W.x = g.x;
        W.y = g.y;
      }
      W.appendChild(g);
    }
    const L = legendC.createInstance();
    W.insertChild(0, L);
    L.layoutSizingHorizontal = "FILL";
    const props = {};
    for (const [k, d] of Object.entries(L.componentProperties)) {
      if (d.type === "BOOLEAN") props[k] = on.has(k.split("#")[0]);
      if (
        d.type === "TEXT" &&
        /^ST-13/.test(s.name) &&
        k.startsWith("已選 文字")
      )
        props[k] = "在(已點)";
    }
    L.setProperties(props);
    report.push(s.name.slice(0, 18) + " : " + [...on].join("/"));
  }
}
// 舊的圖例列(畫面裡其他位置)
for (const s of screens)
  if (s.findOne((n) => n.name === "grid+legend"))
    for (const l of s.findAll(
      (n) => n.type === "FRAME" && /^legend/.test(n.name),
    ))
      l.remove();
return report;
