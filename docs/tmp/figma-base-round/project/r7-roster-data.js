// 第二十五輪(執行任務模型)班表頁(70:14)資料修改,所有班表(RosterGrid(組成))與月檢視一起改,改完跑 audit-roster 確認逐格一致:
// 1. 拿掉「+1 超過人力需求」:11/7 早班「負1/1 協2/1 +1」→ 多一筆協同任務「負1/1 協2/2」(灰字 +1 刪掉);月檢視 11/7 標籤同步;
//    圖例「超過人力需求」整項刪掉。
// 2. 一人顧兩台(11/5 晚):晚班列 11/5 同一格上下兩個標籤,標籤前加崗位簡稱「A 負1/1 協1/1」「B 負1/1」(櫃台 A:陳大文負責、李小華協同;
//    櫃台 B:陳大文負責);晚班整列加高放得下兩個標籤;陳大文 11/5 格子「晚 ×2」(同一筆排班 14:30–22:00 填進兩筆)。
//    (王小明 11/5 已有早班 08:30–14:30 與未對應打卡示範,所以兼兩台用陳大文。)
figma.skipInvisibleInstanceChildren = false;
const page = await figma.getNodeByIdAsync("70:14");
await page.loadAsync();
const loaded = new Set();
const fonts = async (n) => {
  for (const t of n.findAll((x) => x.type === "TEXT" && x.characters.length))
    for (const f of t.getRangeAllFontNames(0, t.characters.length)) {
      const k = JSON.stringify(f);
      if (!loaded.has(k)) {
        await figma.loadFontAsync(f);
        loaded.add(k);
      }
    }
};
const labelKey = (i) =>
  Object.keys(i.componentProperties).find((k) => k.startsWith("Label#"));
const out = { grids: 0, d7: 0, d5: 0, cell: 0, legend: 0, month: 0 };
for (const g of page.findAll((n) => n.name === "RosterGrid(組成)")) {
  out.grids++;
  const hdr = g.children.find((r) => r.name === "header-row");
  const xOf = {};
  for (const c of hdr.children) {
    const t = c.findOne && c.findOne((n) => n.type === "TEXT");
    const m = t && /^11\/(\d+)/.exec(t.characters);
    if (m) xOf[m[1]] = c.x;
  }
  const cellAt = (row, d) =>
    xOf[d] === undefined
      ? null
      : row.children.find(
          (c) =>
            c.layoutPositioning !== "ABSOLUTE" && Math.abs(c.x - xOf[d]) < 2,
        );
  // 1. 11/7 早班
  const zao = g.children.find((r) => r.name === "demand-row 早班");
  const z7 = zao && cellAt(zao, "7");
  const over = z7 && z7.findOne((n) => n.name === "demand-over");
  if (over) {
    const chip = over.findOne((n) => n.name === "status-chip");
    await fonts(chip);
    chip.setProperties({ [labelKey(chip)]: "負1/1 協2/2" });
    z7.insertChild(z7.children.indexOf(over), chip);
    over.remove();
    out.d7++;
  }
  // 2. 11/5 晚班兩個標籤
  const wan = g.children.find((r) => r.name === "demand-row 晚班");
  const w5 = wan && cellAt(wan, "5");
  if (w5 && w5.children.length === 1) {
    const a = w5.children[0];
    await fonts(a);
    a.setProperties({ [labelKey(a)]: "A 負1/1 協1/1" });
    const b = a.clone();
    w5.appendChild(b);
    b.setProperties({ [labelKey(b)]: "B 負1/1" });
    w5.itemSpacing = 4;
    const h = w5.paddingTop + a.height + 4 + b.height + w5.paddingBottom;
    for (const c of wan.children)
      if (c.layoutPositioning !== "ABSOLUTE") c.resize(c.width, h);
    out.d5++;
  }
  // 陳大文 11/5「晚 ×2」
  const chen = g.children.find((r) =>
    r.children.some(
      (c) =>
        c.name === "head-cell" &&
        c.findOne((n) => n.type === "TEXT" && n.characters === "陳大文"),
    ),
  );
  const c5 = chen && cellAt(chen, "5");
  if (c5 && c5.type === "INSTANCE") {
    await fonts(c5);
    const k = Object.keys(c5.componentProperties).find((x) =>
      x.startsWith("LeadText#"),
    );
    if (c5.componentProperties[k].value === "晚") {
      c5.setProperties({ [k]: "晚 ×2" });
      out.cell++;
    }
  }
}
// 圖例「超過人力需求」整項刪掉
for (const n of page.findAll(
  (n) =>
    n.type === "INSTANCE" &&
    n.name === "Draft/LegendItem" &&
    Object.values(n.componentProperties).some(
      (p) => p.value === "超過人力需求",
    ),
)) {
  n.remove();
  out.legend++;
}
// 月檢視 11/7 標籤
for (const n of page.findAll(
  (n) =>
    n.type === "INSTANCE" &&
    n.name === "status-chip" &&
    Object.values(n.componentProperties).some(
      (p) => p.value === "早 08:30–14:30\n負1/1 協2/1",
    ),
)) {
  n.setProperties({ [labelKey(n)]: "早 08:30–14:30\n負1/1 協2/2" });
  out.month++;
}
return out;
