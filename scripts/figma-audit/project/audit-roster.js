// 班表檢視一致性稽核:同月同店的所有班表(RosterGrid(組成),含背景複本、三尺寸)逐格比對 SC-03 電腦(290:83686)。
// 比對:人員列格子(State / 負責 / 休息 / 文字)、格子右上角的自動排入與未對應打卡徽章、人力需求區每一列、人員欄與統計欄。
// 只比對兩邊都有的日期與欄位(平板 / 手機顯示的天數較少、統計欄收成窄欄)。狀態標籤與工具列不在比對範圍(已發布規則不同)。
// 結果 total 必須是 0(互動狀態 Hover / Focus 視同 Filled)。在 scratch-lot Screens 執行;整份貼進 use_figma,不需要先貼 config.js。
const PAGE_ID = "70:14";
const REF = "290:83686";
const pg = await figma.getNodeByIdAsync(PAGE_ID);
// 先切到班表頁:目前頁是別頁時,基準班表裡實例的文字可能讀不到,差異會整片出現
await figma.setCurrentPageAsync(pg);
const ref = (await figma.getNodeByIdAsync(REF)).findOne(
  (n) => n.name === "RosterGrid(組成)",
);
const sig = (g) => {
  const hr = g.children.find((r) => r.name === "header-row");
  const days = hr.children
    .filter(
      (c) =>
        c.findOne &&
        c.findOne((t) => t.type === "TEXT" && /^11\/\d/.test(t.characters)),
    )
    .map((c) => ({
      d: c.findOne((t) => t.type === "TEXT").characters.split(" ")[0],
      x: c.x,
      w: c.width,
    }));
  const S = {};
  for (const r of g.children) {
    const nm = r.name;
    if (!/^(row-|demand-row|demand-area)/.test(nm)) continue;
    for (const dd of days) {
      const cell = r.children.find(
        (c) => c.layoutPositioning !== "ABSOLUTE" && Math.abs(c.x - dd.x) < 2,
      );
      let v = "";
      if (cell) {
        const txt = cell
          .findAll((t) => t.type === "TEXT" && t.visible)
          .map((t) => t.characters)
          .join("/");
        if (cell.type === "INSTANCE") {
          const p = cell.componentProperties;
          v = [
            // 互動狀態(SC-61 滑過格子)不是資料差異
            p.State.value.replace(/^(Hover|Focus)$/, "Filled"),
            ...Object.entries(p)
              .filter(([k]) => /Lead|Break/.test(k))
              .map(([k, x]) => k.split("#")[0] + "=" + x.value)
              .sort(),
            txt,
          ].join("|");
        } else v = txt;
        // 互動狀態的底色(滑過 grey/100)也不是資料差異
        const ix =
          cell.type === "INSTANCE" &&
          /^(Hover|Focus)$/.test(cell.componentProperties.State.value);
        v +=
          "|fill:" +
          (ix ? "*" : cell.fills?.[0]?.boundVariables?.color?.id || "");
      }
      const marks = r.children
        .filter(
          (c) =>
            c.layoutPositioning === "ABSOLUTE" &&
            c.x >= dd.x &&
            c.x < dd.x + dd.w,
        )
        .map(
          (c) =>
            c.name +
            ":" +
            (c.findAll
              ? c
                  .findAll((t) => t.type === "TEXT")
                  .map((t) => t.characters)
                  .join("")
              : ""),
        )
        .sort()
        .join(",");
      S[nm + "@" + dd.d] = v + "#" + marks;
    }
    const sc = r.children.filter(
      // 人員欄 / 統計欄(排除日期欄裡的人力需求格)
      (c) =>
        (c.name === "head-cell" || /畫休超過/.test(c.name)) &&
        !days.some((dd) => Math.abs(c.x - dd.x) < 2),
    );
    S[nm + "@name"] = sc[0]
      ?.findAll((t) => t.type === "TEXT")
      .map((t) => t.characters)
      .join("/");
    const stats = sc
      .slice(1)
      .map((c) => c.findOne((t) => t.type === "TEXT")?.characters)
      .filter((x) => x && x.trim())
      .join(",");
    if (stats) S[nm + "@stats"] = stats;
  }
  return S;
};
const R = sig(ref);
let total = 0;
const res = [];
for (const g of pg.findAll((n) => n.name === "RosterGrid(組成)")) {
  if (g === ref) continue;
  const s = sig(g);
  let top = g;
  while (top.parent.type !== "SECTION") top = top.parent;
  // 背景複本沿用來源畫面的名稱(「背景:SC-63 …」),例外跟著來源算
  const names = [top.name];
  for (let x = g.parent; x && x !== top; x = x.parent)
    if (x.name.startsWith("背景:")) names.push(x.name.slice(3));
  const diffs = [];
  for (const [k, v] of Object.entries(s)) {
    if (R[k] === undefined) continue;
    // 統計欄收成窄欄時欄數不同,不比
    if (k.endsWith("@stats") && v.split(",").length !== R[k].split(",").length)
      continue;
    // 「fill:*」= 互動狀態的格子,底色不比
    const strip = (x) => x.replace(/\|fill:[^#]*/, "");
    const same = v.includes("|fill:*") ? strip(v) === strip(R[k]) : R[k] === v;
    // 刻意例外:SC-63 / SC-21a 滑過人力需求區空白格,格子多一個淡色「+ 人力需求」(含以它們為背景的對話框)
    const hoverAdd =
      k.startsWith("demand-row") &&
      names.some((nm) => /^SC-(63|21a)/.test(nm)) &&
      v.replace("/+ 人力需求", "") === R[k];
    if (!same && !hoverAdd) diffs.push(`${k}: ${v} ≠ ${R[k]}`);
  }
  total += diffs.length;
  if (diffs.length)
    res.push(
      `${top.name.slice(0, 30)}(${g.id}):${diffs.slice(0, 3).join(" ; ")}`,
    );
}
return {
  grids: pg.findAll((n) => n.name === "RosterGrid(組成)").length,
  total,
  res,
};
