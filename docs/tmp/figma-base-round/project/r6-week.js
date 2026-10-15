// 第二十四輪後續之九 ~ 之十一:週檢視(SC-44 電腦 272:86970 / 平板 272:87566)的並排、缺額與收起(規格 14.5「並排與 +N」)。
// 在 scratch-lot Screens 的班表頁(70:14)執行,重畫 ScheduleTimeline(週模式,容器)的每一天;規則示範頁「Screen / 班表時間軸 · 各種情況」同一套規則。
// - 並排的容器寬度先每排給 1 條(標題直排 20 + 28),多的先補需要更多條的排,再依人數比例分;
//   容器可放條數 = floor((容器寬 − 20)/ 28)。人數超過可放條數時:
//   1) 可放條數 ≥ 2:畫(條數 − 1)人 +「+N 人」窄條(容器最後一條,和長條同寬、高度同容器,點了 = 那筆人力需求對話框);
//   2) 可放條數 = 1:畫 1 條長條(負責人優先,否則開始時間最早的人),長條底部內側放小「+N」徽章(ScheduleTimelineMore Size=Compact),
//      點了 = 那筆人力需求對話框。
//   只有第 3 筆起同時重疊的需求收進「+N 需求」(當天欄最右邊窄條,高度對齊被收起需求的時間;點了跳出清單浮層;資料的 H)。
// - 缺額也佔一條:Draft/ScheduleTimelineBlock State=MissingHelper(缺協同)/ MissingLead(缺負責)。
// - 窄條與徽章用底座 Draft/ScheduleTimelineMore(41:5914,408:8012;Size=Strip / Compact):
//   Neutral / Success 含負責人 / Warning 含缺協同 / Error 含缺負責;缺額優先。
// - 超出人力需求的時間:同一條長條延伸出容器(Extension 段接在長條前 / 後,相接側不畫框、不圓角)。
// 示範:11/10 早班 5/5(陳大文★、李小華、王小明、黃志明、吳佳玲)+ 補貨 1/1(周家豪)+ 晚班 2/2 → 電腦「陳大文、李小華 +「+3」」、
// 平板「陳大文 + 徽章 +4」;11/11 店慶加開收成「+1 需求」;11/14 晚班 3 人 + 缺協同 1。
const Y = (t) => 22 + (t - 8) * 36; // 08:00 在 y=22,每小時 36px
const P = (n, lead, o = {}) => ({ n, lead, ...o }); // o.s = 提早開始(延伸到前面)、o.e = 延後結束、o.a/o.b = 只上部分時段
const V = (k) => ({ vac: k });
const C = (s, a, b, lab, items, tone = "Normal") => ({
  s,
  a,
  b,
  lab,
  items,
  tone,
});
const DAYS = [
  {
    L: [
      C("早", 8.5, 14.5, "2/2", [P("王小明", 1), P("李小華")]),
      C("晚", 14.5, 22, "2/2", [P("陳大文", 1), P("林美麗")]),
    ],
  },
  {
    L: [
      C("早", 8.5, 14.5, "2/2", [P("林美麗", 1, { s: 8 }), P("張小芳")]),
      C("晚", 14.5, 22, "2/2", [P("王小明", 1), P("李小華")]),
    ],
  },
  {
    L: [
      C("早", 8.5, 14.5, "5/5", [
        P("陳大文", 1),
        P("李小華"),
        P("王小明"),
        P("黃志明"),
        P("吳佳玲"),
      ]),
      C("晚", 14.5, 22, "2/2", [P("林美麗", 1), P("張小芳")]),
    ],
    R: [C("補", 13, 17, "1/1", [P("周家豪")])],
  },
  {
    L: [
      C("早", 8.5, 14.5, "2/2", [P("王小明", 1), P("李小華")]),
      C("晚", 14.5, 22, "2/2", [P("陳大文", 1), P("林美麗")]),
    ],
    R: [C("補", 13, 17, "1/1", [P("張小芳", 0, { e: 18 })])],
    H: [{ a: 13, b: 18, n: 1, tone: "Error" }], // 店慶加開 13:00–18:00(缺負責),第 3 筆同時重疊
  },
  {
    L: [
      C("早", 8.5, 14.5, "2/2", [
        P("林美麗", 1),
        [P("張小芳", 0, { a: 8.5, b: 11 }), P("李小華", 0, { a: 11, b: 14.5 })],
      ]),
      C("晚", 14.5, 22, "2/2", [P("王小明", 1), P("陳大文")]),
    ],
  },
  {
    L: [
      C("早", 8.5, 14.5, "2/2", [P("陳大文", 1), P("李小華")]),
      C("晚", 14.5, 22, "2/2", [P("林美麗", 1), P("王小明")]),
    ],
    R: [C("補", 13, 17, "1/1", [P("張小芳")])],
  },
  {
    L: [
      C("早", 8.5, 14.5, "2/2", [P("林美麗", 1), P("李小華")]),
      C(
        "晚",
        14.5,
        22,
        "3/4",
        [P("陳大文", 1), P("王小明"), P("張小芳"), V("warn")],
        "Warning",
      ),
    ],
  },
];
const MIN = 28; // 一條最少寬度(規格:可用條數 = floor((容器寬 − 標題直排寬 20)/ 28))
const LBL = 23; // 容器左側班別 / 人數欄 + 右側 1px
const STRIP = 20; // 「+N 需求」窄條寬
const strips = await figma.getNodeByIdAsync("408:8012"); // Draft/ScheduleTimelineMore(底座)
const ST = (t) =>
  strips.children.find(
    (c) => c.name === `Tone=${t}, State=Default, Size=Strip`,
  );
const STC = (t) =>
  strips.children.find(
    (c) => c.name === `Tone=${t}, State=Default, Size=Compact`,
  );
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
const toneOf = (items) =>
  items.some((h) => h.vac === "err")
    ? "Error"
    : items.some((h) => h.vac)
      ? "Warning"
      : items.some((h) => h.lead)
        ? "Success"
        : "Neutral";
// 一天的版面:回傳每排容器的寬度與條數 k(含「+N 人」那條),以及要收進「+N 需求」的需求
// 並排寬度依長條數分配:每排先給 1 條寬,剩下的寬度先補給需要更多條的排(到放得下全部為止),再依人數比例分;
// 同時重疊的第 3 筆起(資料的 H)收進「+N 需求」。只有 2 筆重疊時一律並排,不收。
function plan(d, CW) {
  const lanes = [d.L, ...(d.R ? [d.R] : [])];
  const H = [...(d.H || [])];
  const A = CW - 2 - (H.length ? STRIP + 2 : 0) - (lanes.length - 1) * 2;
  const n = lanes.map((ln) => Math.max(...ln.map((c) => c.items.length)));
  const base = 20 + MIN;
  const W = lanes.map(() => base);
  let extra = A - base * lanes.length;
  const need = n.map((x) => (x - 1) * (MIN + 2));
  const tot = need.reduce((a, b) => a + b, 0);
  if (extra > 0 && tot > 0) {
    const give = Math.min(extra, tot);
    need.forEach((x, i) => (W[i] += (give * x) / tot));
    extra -= give;
  }
  if (extra > 0) {
    const s = n.reduce((a, b) => a + b, 0);
    n.forEach((x, i) => (W[i] += (extra * x) / s));
  }
  return { H, lanes: lanes.map((ln, i) => ({ ln, W: W[i] })) };
}
// 容器可放的條數 = floor((容器寬 − 標題直排寬 20)/ 28);人數超過時畫(條數 − 1)人 +「+N 人」,窄條和長條同寬
const slotsOf = (w) => Math.max(1, Math.floor((w - 20) / MIN));
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
  // 同一排的容器寬度相同,各自依自己的條數平均分配(人少的容器長條較寬)
  const mkCont = (c, x, w) => {
    const k = slotsOf(w);
    const kc = Math.min(c.items.length, k);
    const sw = (w - 22 - 2 * (kc - 1)) / kc;
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
    let shown = c.items,
      hidden = [],
      compact = false;
    if (c.items.length > k) {
      if (k === 1) {
        // 只放得下 1 條:畫 1 條長條(負責人優先,否則開始時間最早),長條底部內側放小「+N」徽章(Size=Compact)
        const people = c.items.filter(
          (p) => !p.vac && !p.dis && !Array.isArray(p),
        );
        const pick =
          people.find((p) => p.lead) ||
          [...people].sort((a, b) => (a.a ?? c.a) - (b.a ?? c.a))[0] ||
          c.items[0];
        shown = [pick];
        hidden = c.items.filter((p) => p !== pick);
        compact = true;
      } else {
        shown = c.items.slice(0, k - 1);
        hidden = c.items.slice(k - 1);
      }
    }
    shown.forEach((it, i) => {
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
    if (hidden.length && compact) {
      const bar = [...tl.children]
        .reverse()
        .find((n) => /^(bar |vacancy)/.test(n.name));
      const s = STC(toneOf(hidden)).createInstance();
      tl.appendChild(s);
      s.name = `more-people +${hidden.length}(徽章)`;
      s.setProperties({ "Label#408:0": "+" + hidden.length });
      s.x = bar.x + (bar.width - s.width) / 2;
      s.y = bar.y + bar.height - s.height - 4;
    } else if (hidden.length) {
      const s = ST(toneOf(hidden)).createInstance();
      tl.appendChild(s);
      s.name = `more-people +${hidden.length}`;
      s.setProperties({ "Label#408:0": "+" + hidden.length });
      s.resize(sw, h - 2);
      s.x = x + 22 + shown.length * (sw + 2);
      s.y = y + 1;
    }
  };
  DAYS.forEach((d, i) => {
    const cx = 48 + i * CW;
    const pl = plan(d, CW);
    let x = cx + 1;
    for (const ln of pl.lanes) {
      for (const c of ln.ln) mkCont(c, x, ln.W);
      x += ln.W + 2;
    }
    if (pl.H.length) {
      // 同一天收起的需求合成一條,高度涵蓋最早開始到最晚結束;顏色取最嚴重
      const a = Math.min(...pl.H.map((h) => h.a)),
        b = Math.max(...pl.H.map((h) => h.b));
      const tone = ["Error", "Warning", "Success", "Neutral"].find((t) =>
        pl.H.some((h) => h.tone === t),
      );
      const n = pl.H.reduce((s, h) => s + h.n, 0);
      const s = ST(tone).createInstance();
      tl.appendChild(s);
      s.name = "more-demand +" + n;
      s.setProperties({ "Label#408:0": "+" + n });
      s.resize(STRIP, Y(b) - Y(a));
      s.x = cx + CW - 1 - STRIP;
      s.y = Y(a);
    }
  });
  for (const t of [tDem, tDemW, tLab, tLead, tBar, tExt]) t.remove();
}
return "ok";
