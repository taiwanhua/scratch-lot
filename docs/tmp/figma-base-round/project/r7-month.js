// 第二十五輪:月檢視(SC-43 三尺寸,含當背景的複本)11/5 晚班改成兩筆(櫃台 A、櫃台 B),標籤前加崗位簡稱;
// 電腦「A 晚 14:30–22:00 / 負1/1 協1/1」+「B 晚 14:30–22:00 / 負1/1」;平板「A 晚 2/2」+「B 晚 1/1」;手機多一顆實心點(灰,已滿)。
// 同一週的格子一樣高(依那週最多的一天)。
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
const out = [];
for (const f of page.findAll(
  (n) => n.type === "FRAME" && /SC-43/.test(n.name) && !/註解/.test(n.name),
)) {
  // 11/5 那一格:日期 5、前一格是 4(避開上個月的 5)
  const days = f.findAll((n) => n.name === "day");
  const num = (d) => d.findOne((x) => x.name === "day-number")?.characters;
  const i5 = days.findIndex(
    (d, i) => num(d) === "5" && num(days[i - 1]) === "4",
  );
  if (i5 < 0) continue;
  const d5 = days[i5];
  const chips = d5.children.filter((c) => c.name === "status-chip");
  const wan = chips.find((c) =>
    /^晚/.test(c.componentProperties[labelKey(c)].value),
  );
  if (wan) {
    await fonts(wan);
    const v = wan.componentProperties[labelKey(wan)].value;
    const b = wan.clone();
    d5.insertChild(d5.children.indexOf(wan) + 1, b);
    if (v.includes("\n")) {
      wan.setProperties({ [labelKey(wan)]: "A " + v });
      b.setProperties({ [labelKey(b)]: "B 晚 14:30–22:00\n負1/1" });
    } else {
      wan.setProperties({ [labelKey(wan)]: "A 晚 2/2" });
      b.setProperties({ [labelKey(b)]: "B 晚 1/1" });
    }
  }
  const dots = d5.findOne((n) => n.name === "dots");
  if (dots && dots.children.length === 3)
    dots.appendChild(dots.children[1].clone());
  // 同一週一樣高
  const wk = days.slice(i5 - (i5 % 7), i5 - (i5 % 7) + 7);
  // 格子內容高度(hug 算出來)取那週最高的
  const need = (d) =>
    d.paddingTop +
    d.paddingBottom +
    d.children.reduce((s, c) => s + c.height, 0) +
    d.itemSpacing * (d.children.length - 1);
  const h = Math.max(...wk.map((d) => Math.max(d.height, need(d))));
  for (const d of wk) d.resize(d.width, h);
  // 殼跟著內容長高
  const m = f.children.find((n) => n.name === "main");
  if (m) {
    const c = m.children.find((n) => n.name === "content");
    c.layoutSizingVertical = "HUG";
    m.layoutSizingVertical = "HUG";
    if (m.height > f.height) f.resize(f.width, m.height);
    m.layoutSizingVertical = "FILL";
    c.layoutSizingVertical = "FILL";
  }
  out.push(`${f.name.slice(0, 26)} h${Math.round(h)}`);
}
return out;
