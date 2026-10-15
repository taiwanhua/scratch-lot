// 第二十四輪後續之九 ~ 之十三:週檢視(SC-44 電腦 272:86970 / 平板 272:87566)的容器排版(底座規格 10.11「週模式排版」、規格 14.5「週檢視排版」)。
// 前置:先貼上 `_timeline-layout.js`(layoutTimeline 算位置,本檔不手填座標)。在 scratch-lot Screens 的班表頁(70:14)執行,
// 重畫 ScheduleTimeline(週模式,容器)的每一天;規則示範頁「Screen / 班表時間軸 · 各種情況」用同一個函式。
// - 收起的單位是整筆人力需求(排班長條不單獨收起);每筆佔條數 = max(需求人數, 已排人數),容器寬 = 20 + 28 × 條數。
// - 有收起時當天欄最右邊一條「+N」長條(底座 Draft/ScheduleTimelineMore,寬 20、高度佔滿可見時間軸),
//   Tone:收起的有缺負責 Error、有缺協同 Warning、否則 Neutral;點了 → 清單浮層(SC-62)。
// - 長條順序 負責 → 協同 → 缺額(虛線空位:Draft/ScheduleTimelineBlock State=MissingHelper / MissingLead)。
// - 超出人力需求的時間:同一條長條延伸出容器(Extension 段接在長條前 / 後,相接側不畫框、不圓角)。
// 結果(電腦 157 / 平板實際欄寬 125):11/10 電腦 早 5/5 收起、補 0–48、晚 48–124、「+1」灰;平板 補 0–48,早、晚收起「+2」灰;
// 11/11 電腦 早 0–76、補 76–124、晚 0–76、店慶加開收起「+1」紅;平板 補、店慶加開收起「+2」紅;
// 11/13 兩尺寸都放得下(平板若是 120 寬,補貨會收起);11/14 電腦 晚 4 條 132 寬;平板 晚收起「+1」橘。
const Y = (t) => 22 + (t - 8) * 36; // 08:00 在 y=22,每小時 36px
const P = (n, lead, o = {}) => ({ n, lead, ...o }); // o.s = 提早開始(延伸到前面)、o.e = 延後結束、o.a/o.b = 只上部分時段
const V = (k) => ({ vac: k });
const C = (id, s, a, b, lab, items, tone = "Normal", ord = 1, tmpl = 1) => ({
  id,
  s,
  a,
  b,
  lab,
  items,
  tone,
  ord, // 崗位排序(櫃台 1、補貨 2、店慶攤位 3)
  tmpl, // 範本排序(沒套範本的「臨」= 99)
  slots: items.length, // max(需求人數, 已排人數):items 含缺額空位
});
const DAYS = [
  [
    C("8a", "早", 8.5, 14.5, "2/2", [P("王小明", 1), P("李小華")]),
    C("8b", "晚", 14.5, 22, "2/2", [P("陳大文", 1), P("林美麗")]),
  ],
  [
    C("9a", "早", 8.5, 14.5, "2/2", [P("林美麗", 1, { s: 8 }), P("張小芳")]),
    C("9b", "晚", 14.5, 22, "2/2", [P("王小明", 1), P("李小華")]),
  ],
  [
    C("10a", "早", 8.5, 14.5, "5/5", [
      P("陳大文", 1),
      P("李小華"),
      P("王小明"),
      P("黃志明"),
      P("吳佳玲"),
    ]),
    C("10c", "補", 13, 17, "1/1", [P("周家豪")], "Normal", 2),
    C("10b", "晚", 14.5, 22, "2/2", [P("林美麗", 1), P("張小芳")]),
  ],
  [
    C("11a", "早", 8.5, 14.5, "2/2", [P("王小明", 1), P("李小華")]),
    C("11c", "補", 13, 17, "1/1", [P("張小芳", 0, { e: 18 })], "Normal", 2),
    C(
      "11d",
      "臨",
      13,
      18,
      "負0/1 協1/1",
      [V("err"), P("張小芳")],
      "Error",
      3,
      99,
    ), // 店慶加開
    C("11b", "晚", 14.5, 22, "2/2", [P("陳大文", 1), P("林美麗")]),
  ],
  [
    C("12a", "早", 8.5, 14.5, "2/2", [
      P("林美麗", 1),
      [P("張小芳", 0, { a: 8.5, b: 11 }), P("李小華", 0, { a: 11, b: 14.5 })],
    ]),
    C("12b", "晚", 14.5, 22, "2/2", [P("王小明", 1), P("陳大文")]),
  ],
  [
    C("13a", "早", 8.5, 14.5, "2/2", [P("陳大文", 1), P("李小華")]),
    C("13c", "補", 13, 17, "1/1", [P("張小芳")], "Normal", 2),
    C("13b", "晚", 14.5, 22, "2/2", [P("林美麗", 1), P("王小明")]),
  ],
  [
    C("14a", "早", 8.5, 14.5, "2/2", [P("林美麗", 1), P("李小華")]),
    C(
      "14b",
      "晚",
      14.5,
      22,
      "3/4",
      [P("陳大文", 1), P("王小明"), P("張小芳"), V("warn")],
      "Warning",
    ),
  ],
];
const more = await figma.getNodeByIdAsync("408:8012"); // Draft/ScheduleTimelineMore(底座)「+N」長條
const MORE = (t) =>
  more.children.find((c) => c.name === `Tone=${t}, State=Default`);
const tlb = await figma.getNodeByIdAsync("259:4770"); // Draft/ScheduleTimelineBlock
const VAC = {
  warn: tlb.children.find(
    (c) => c.name === "State=MissingHelper, Auto=False, Interaction=Default",
  ),
  err: tlb.children.find(
    (c) => c.name === "State=MissingLead, Auto=False, Interaction=Default",
  ),
};
const pk = (i, p) =>
  Object.keys(i.componentProperties).find((k) => k.startsWith(p + "#"));
const vert = (s) => s.split("").join("\n");
const out = [];
for (const [tlid, CW] of [
  ["293:258", 157],
  ["293:518", 125],
]) {
  const tl = await figma.getNodeByIdAsync(tlid);
  const find = (fn) => tl.children.find(fn);
  const isLead = (c) =>
    Object.entries(c.componentProperties).find(([k]) =>
      k.startsWith("Lead#"),
    )[1].value;
  // 範本:現有的容器 / 標籤 / 長條 / 延伸段
  const tDem = find(
    (c) =>
      /^demand /.test(c.name) && c.componentProperties.Tone.value === "Normal",
  ).clone();
  const tDemW = find(
    (c) =>
      /^demand /.test(c.name) && c.componentProperties.Tone.value === "Warning",
  ).clone();
  const tLab = find((c) => c.name === "demand-label").clone();
  const tLead = find((c) => /^bar /.test(c.name) && isLead(c)).clone();
  const tBar = find((c) => /^bar /.test(c.name) && !isLead(c)).clone();
  const tExt = find((c) => /^ext /.test(c.name)).clone();
  for (const t of [tDem, tDemW, tLab, tLead, tBar, tExt]) t.visible = false;
  for (const c of [...tl.children])
    if (
      c.visible &&
      /^(demand|demand-label|bar |ext |more|vacancy)/.test(c.name)
    )
      c.remove();
  await figma.loadFontAsync(tLab.fontName);
  const mkBar = (p, x, w, y, h) => {
    const b = (p.lead ? tLead : tBar).clone();
    b.visible = true;
    tl.appendChild(b);
    b.name = "bar " + p.n;
    const pr = {};
    if (p.lead) {
      pr[pk(b, "LeadText")] = vert(p.n);
      pr[pk(b, "Title")] = "";
    } else {
      pr[pk(b, "Title")] = vert(p.n);
      pr[pk(b, "Lead")] = false;
    }
    b.setProperties(pr);
    b.resize(w, h);
    b.x = x;
    b.y = y;
    b.paddingLeft = w < 40 ? 5 : 8;
    b.paddingRight = w < 40 ? 3 : 6;
    b.topLeftRadius =
      b.topRightRadius =
      b.bottomLeftRadius =
      b.bottomRightRadius =
        8;
    return b;
  };
  const mkExt = (b, before, y0, y1) => {
    const e = tExt.clone();
    e.visible = true;
    tl.insertChild(tl.children.indexOf(b) + 1, e);
    e.name = "ext " + b.name.slice(4);
    e.resize(b.width, y1 - y0);
    e.x = b.x;
    e.y = y0;
    e.strokeLeftWeight = b.strokeLeftWeight;
    e.strokeTopWeight = e.strokeBottomWeight = e.strokeRightWeight = 1;
    e.topLeftRadius =
      e.topRightRadius =
      e.bottomLeftRadius =
      e.bottomRightRadius =
        8;
    if (before) {
      b.topLeftRadius = b.topRightRadius = 0;
      e.bottomLeftRadius = e.bottomRightRadius = 0;
      e.strokeBottomWeight = 0;
    } else {
      b.bottomLeftRadius = b.bottomRightRadius = 0;
      e.topLeftRadius = e.topRightRadius = 0;
      e.strokeTopWeight = 0;
    }
  };
  // 容器:位置與寬度由 layoutTimeline 算好傳入;每條寬 26、間隔 2(容器寬 20 + 28 × 條數)
  const mkCont = (c, x, w) => {
    const n = c.slots;
    const sw = (w - 22 - 2 * (n - 1)) / n;
    const y = Y(c.a),
      h = Y(c.b) - Y(c.a);
    const d = (c.tone === "Warning" ? tDemW : tDem).clone();
    d.visible = true;
    tl.appendChild(d);
    d.name = `demand ${c.s} ${c.lab}`;
    d.resize(w, h);
    d.x = x;
    d.y = y;
    const l = tLab.clone();
    l.visible = true;
    tl.appendChild(l);
    l.characters = c.s + "\n" + c.lab;
    l.x = x + 1;
    l.y = y + 3;
    tlOrder(c.items).forEach((it, i) => {
      const x0 = x + 22 + i * (sw + 2);
      for (const p of Array.isArray(it) ? it : [it]) {
        if (p.vac) {
          const v = VAC[p.vac].createInstance();
          tl.appendChild(v);
          v.name = p.vac === "err" ? "vacancy 缺負責" : "vacancy 缺協同";
          v.setProperties({
            [pk(v, "Title")]: p.vac === "err" ? "缺\n負\n責" : "缺\n協\n同",
            [pk(v, "Subtitle")]: "",
          });
          v.resize(sw, h - 2);
          v.x = x0;
          v.y = y + 1;
          continue;
        }
        const a = p.a ?? c.a,
          bb = p.b ?? c.b;
        const b = mkBar(p, x0, sw, Y(a) + 1, Y(bb) - Y(a) - 2);
        if (p.s !== undefined) mkExt(b, true, Y(p.s), b.y);
        if (p.e !== undefined) mkExt(b, false, b.y + b.height, Y(p.e));
      }
    });
  };
  const res = [];
  DAYS.forEach((groups, i) => {
    const cx = 48 + i * CW;
    const r = layoutTimeline(groups, CW);
    for (const p of r.placed) mkCont(p.g, cx + 1 + p.x, p.w);
    if (r.hidden.length) {
      // 當天欄最右邊一條「+N」長條,高度佔滿可見時間軸
      const s = MORE(tlMoreTone(r.hidden)).createInstance();
      tl.appendChild(s);
      s.name = "more +" + r.hidden.length;
      s.setProperties({ "Label#408:0": "+" + r.hidden.length });
      s.resize(20, tl.height - 24);
      s.x = cx + 1 + CW - TL_MORE + 2;
      s.y = 23;
    }
    res.push(
      `11/${8 + i}` +
        " " +
        r.placed.map((p) => `${p.g.s} ${p.x}–${p.x + p.w}`).join("、") +
        (r.hidden.length
          ? ` | 收起 ${r.hidden.map((g) => g.s).join("、")}`
          : ""),
    );
  });
  out.push({ CW, res });
  for (const t of [tDem, tDemW, tLab, tLead, tBar, tExt]) t.remove();
}
return out;
