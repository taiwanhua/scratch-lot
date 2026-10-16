// 第五輪「Screen / 輸出報表」(94:14):營運報表 RE-04 的平板 / 手機(從電腦版 129:1186 複製 8 個區塊;依遊戲展開的表格改成卡片)。
// 前置:r4-lib.js + 本檔。殼從店面管理的 ST-01 平板 / 手機複製(跨頁複製後放進本頁的尺寸 Section)。
await figma.setCurrentPageAsync(await figma.getNodeByIdAsync("94:14"));
for (const nm of ["平板 1024", "手機 390"])
  if (!sec(nm)) {
    const s = figma.createSection();
    s.name = nm;
    s.resizeWithoutConstraints(2000, 1200);
  }
const src = await figma.getNodeByIdAsync("129:1186");
const c = src.children
  .find((n) => n.name === "main")
  .children.find((n) => n.name === "content");
const blocks = c.children
  .find((n) => n.name === "grid")
  .children.flatMap((r) => [...r.children]);
const games = [
  ["5164 發大財 · 200", "120", "1", "23,800"],
  ["5201 金好運 · 100", "60", "1", "5,900"],
  ["5150 好運旺旺 · 500", "25", "0", "12,500"],
];
for (const [shellId, label, suffix, minH, cols] of [
  ["124:5578", "平板 1024", " · 平板", 768, 2],
  ["124:5927", "手機 390", " · 手機", 844, 1],
]) {
  const { f: s, c: sc } = await shellOf(
    shellId,
    `RE-04${suffix} 營運報表 預覽`,
    "輸出報表",
  );
  fileIn(label, s);
  const W = sc.width - sc.paddingLeft - sc.paddingRight;
  const tt = c.children.find((n) => n.name === "title");
  const tr = add(
    sc,
    AL(cols > 1 ? "HORIZONTAL" : "VERTICAL", {
      name: "title",
      itemSpacing: 12,
      counterAxisAlignItems: cols > 1 ? "CENTER" : "MIN",
    }),
    "FILL",
  );
  const title = add(tr, tt.children[0].clone());
  if (cols > 1) sp(tr);
  else {
    title.textAutoResize = "HEIGHT";
    title.layoutSizingHorizontal = "FILL";
  }
  const sel = add(tr, tt.children[2].clone());
  if (cols === 1) {
    sel.layoutSizingHorizontal = "FILL";
    sel.layoutSizingVertical = "HUG";
  }
  add(tr, tt.children[3].clone());
  add(sc, c.children.find((n) => n.name === "Draft/Alert").clone(), "FILL");
  const g = add(
    sc,
    AL("HORIZONTAL", {
      name: "grid",
      itemSpacing: 12,
      counterAxisSpacing: 12,
      layoutWrap: "WRAP",
    }),
    "FILL",
  );
  const bw = Math.floor((W - 12 * (cols - 1)) / cols);
  for (const b of blocks) {
    const k = b.clone();
    g.appendChild(k);
    k.layoutSizingHorizontal = "FIXED";
    k.resize(bw, k.height);
    k.layoutSizingVertical = "HUG";
  }
  const ex = add(sc, await panel("依遊戲展開", 8, 16), "FILL");
  add(ex, await T("sub2", "1 銷售 · 依遊戲展開"));
  for (const [gname, sold, undo, net] of games) {
    const card = add(
      ex,
      AL("VERTICAL", {
        name: "game",
        itemSpacing: 4,
        paddingTop: 8,
        paddingBottom: 8,
      }),
      "FILL",
    );
    add(card, await T("body1", gname));
    add(card, await kv("售出(張) / 撤銷", sold + " / " + undo), "FILL");
    add(card, await kv("淨銷售(元)", net), "FILL");
  }
  fitShell(s, minH);
}
