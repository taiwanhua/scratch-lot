// ==== 第二十五輪:滑過 / 按下與補齊三尺寸的狀態畫面(班表頁 70:14)====
// 用法:r5-kit.js + r5-roster.js 後面接本檔一起貼進 use_figma。畫好的畫面先 put 到各尺寸 Section 的遠處,之後跑 r4-layout.js。
// - SC-63 班表檢視:滑過人力需求區「補貨」列 11/6 空白格,淡色「+ 人力需求」(電腦 / 平板);手機在人力需求區展開後按下(班表捲到 11/6–11/7)。
//   (11/9 週檢視已有晚班,班表 11/1–11/7 裡沒有空的晚班格,改用補貨 11/6;點了開 SC-21a,帶入補貨範本。)
// - SC-46 電腦 / 平板:點工具列日期標題彈出月曆(和手機同一套)。
// - 手機的按下畫面(手機沒有滑過,按下時底色加深、放開打開對應畫面):
//   SC-60 日檢視卡片按下人 → SC-04b;SC-60b 日檢視按下「+ 人力需求」→ SC-21a;SC-61 班表按下格子 → SC-04b;SC-62 週清單按下一天 → 那天的日檢視。
const made = [];
const g500 = await figma.variables.importVariableByKeyAsync(
  "c84c76fe3426c8a7433557941dff0bed92c7d2bb",
);
// 按下 / 滑過的疊色:state layer(同色系 main,白底用 grey/500,8%),和底座互動狀態同一做法
function pressLayer(target, host) {
  const r = figma.createRectangle();
  r.name = "state-layer 按下";
  r.fills = [
    figma.variables.setBoundVariableForPaint(
      { type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } },
      "color",
      g500,
    ),
  ];
  r.opacity = 0.08;
  host.appendChild(r);
  if ("layoutMode" in host && host.layoutMode !== "NONE")
    r.layoutPositioning = "ABSOLUTE";
  const tb = target.absoluteBoundingBox;
  const hb = host.absoluteBoundingBox;
  r.resize(tb.width, tb.height);
  r.x = tb.x - hb.x;
  r.y = tb.y - hb.y;
  r.cornerRadius =
    typeof target.cornerRadius === "number" ? target.cornerRadius : 0;
  return r;
}
const hoverSrc = await figma.getNodeByIdAsync("426:52138"); // SC-60b 的淡色「+ 人力需求」格子
const cellOf = (g, rowName, day) => {
  const hdr = g.children.find((r) => r.name === "header-row");
  const h = hdr.children.find((c) =>
    c.findOne((t) => t.type === "TEXT" && t.characters.startsWith(day + " ")),
  );
  const r = g.children.find((x) => x.name === rowName);
  return r.children.find((c) => Math.abs(c.x - h.x) < 2);
};
function hoverIn(cell) {
  const h = hoverSrc.clone();
  cell.appendChild(h);
  h.layoutPositioning = "ABSOLUTE";
  h.resize(cell.width - 4, cell.height - 4);
  h.x = 2;
  h.y = 2;
  return h;
}
const clone = (id, name) =>
  figma.getNodeByIdAsync(id).then((n) => {
    const c = n.clone();
    c.name = name;
    return c;
  });

// SC-63 電腦 / 平板
for (const [sz, id] of [
  ["D", "290:83686"],
  ["T", "290:87689"],
]) {
  const f = await clone(
    id,
    sz === "D"
      ? "SC-63 排班作業:排班表:滑過人力需求區空白格"
      : "SC-63 · 平板 排班作業:排班表:滑過人力需求區空白格",
  );
  put(sz, f);
  let g = f.findOne((n) => n.name === "RosterGrid(組成)");
  // 平板放不下 7 天:班表捲到最後幾天,讓 11/6 出現(日期區左右捲動)
  const hdr = g.children.find((r) => r.name === "header-row");
  const days = hdr.children.filter((c) =>
    c.findOne((t) => t.type === "TEXT" && /^11\//.test(t.characters)),
  );
  if (days.length < 7) {
    const ng = await rosterGrid(
      days[0].width,
      hdr.children[0].width,
      days.length,
      "full",
      {
        from: 7 - days.length,
      },
    );
    g.parent.insertChild(g.parent.children.indexOf(g), ng);
    g.remove();
    g = ng;
  }
  hoverIn(cellOf(g, "demand-row 補貨", "11/6"));
  // 電腦版的畫休 hover 明細是 SC-03 的示範,這張拿掉
  const tip = f.findOne((n) => n.name === "tooltip 畫休明細");
  if (tip) tip.remove();
  made.push(f);
}
// SC-63 手機:SC-59(人力需求區展開)的班表捲到 11/6–11/7,按下補貨 11/6
{
  const f = await clone(
    "355:118321",
    "SC-63 · 手機 排班作業:排班表:按下人力需求區空白格",
  );
  put("M", f);
  const old = f.findOne((n) => n.name === "RosterGrid(組成)");
  const hdr = old.children.find((r) => r.name === "header-row");
  const colW = hdr.children[1].width;
  const g = await rosterGrid(colW, 80, 2, "narrow", {
    from: 5,
    demandOpen: true,
  });
  old.parent.insertChild(old.parent.children.indexOf(old), g);
  old.remove();
  const cell = cellOf(g, "demand-row 補貨", "11/6");
  pressLayer(cell, cell);
  made.push(f);
}
// SC-46 電腦 / 平板:日檢視點工具列日期標題,彈出同一個月曆
{
  const m = await figma.getNodeByIdAsync("272:89150");
  const pop = m.children.find(
    (n) => !n.name.startsWith("背景:") && n.name !== "scrim",
  );
  for (const [sz, id] of [
    ["D", "272:87899"],
    ["T", "272:88462"],
  ]) {
    const f = await clone(
      id,
      sz === "D"
        ? "SC-46 Overlay / 選日期:彈出月曆"
        : "SC-46 · 平板 選日期:彈出月曆",
    );
    put(sz, f);
    const pg = f.findOne((n) => n.name === "pager" || /^pager/.test(n.name));
    const p = pop.clone();
    f.appendChild(p);
    p.layoutPositioning = "ABSOLUTE";
    const pb = pg.absoluteBoundingBox;
    const fb = f.absoluteBoundingBox;
    p.x = pb.x - fb.x;
    p.y = pb.y - fb.y + pb.height + 4;
    made.push(f);
  }
}
// 手機按下畫面
{
  // SC-60 手機:日檢視卡片按下李小華(晚班)
  const f = await clone("272:88762", "SC-60 · 手機 日檢視:按下排班(人)");
  put("M", f);
  const card = f.findOne((n) => n.type === "FRAME" && /^晚班/.test(n.name));
  const person = card.findOne((n) => n.name === "person");
  pressLayer(person, card);
  made.push(f);
}
{
  // SC-60b 手機:日檢視按下最後一列「+ 人力需求」
  const f = await clone("272:88762", "SC-60b · 手機 日檢視:按下「+ 人力需求」");
  put("M", f);
  const a = f.findOne((n) => n.name === "add-demand");
  pressLayer(a, a);
  made.push(f);
}
{
  // SC-61 手機:班表按下李小華 11/2 格子
  const f = await clone("290:90336", "SC-61 · 手機 排班作業:排班表:按下格子");
  put("M", f);
  const g = f.findOne((n) => n.name === "RosterGrid(組成)");
  const c = cellOf(g, "row-2", "11/2");
  c.setProperties({ State: "Hover" });
  made.push(f);
}
{
  // SC-62 手機:週清單按下 11/11(手機沒有 +N,點一天到日檢視)
  const f = await clone("296:80787", "SC-62 · 手機 排班作業:週檢視:按下一天");
  put("M", f);
  const t = f.findOne((n) => n.type === "TEXT" && /^11\/11/.test(n.characters));
  let r = t.parent;
  while (r.parent && r.parent.layoutMode !== "VERTICAL") r = r.parent;
  pressLayer(r, r);
  made.push(f);
}
return made.map((f) => f.id + " " + f.name);
