// 第十三輪「Screen / 叫貨與進貨」(69:14):草稿。前置:r4-lib.js + 本檔。
// 1. 叫貨單 / 進貨單 / 調貨單新增頁(三種尺寸)在 [送出] 前加 [存草稿];平板 / 手機底部列把兩個按鈕包成一組靠右。
// 2. 三張列表(電腦)加一列「草稿」狀態的示範,進貨單、調貨單補篩選列(分店、狀態、期間)。
await figma.setCurrentPageAsync(await figma.getNodeByIdAsync("69:14"));
// 各新增頁的 [送出] 按鈕(電腦 / 平板 / 手機)
const SUBMIT = [
  "69:649",
  "127:26384",
  "127:26698",
  "127:2708",
  "127:26491",
  "127:26789",
  "127:27023",
  "127:27416",
];
for (const id of SUBMIT) {
  const b = await figma.getNodeByIdAsync(id);
  const p = b.parent;
  if (p.findOne((n) => n.type === "TEXT" && n.characters === "存草稿"))
    continue;
  const nb = b.clone();
  nb.setProperties({ Variant: "Outlined" });
  p.insertChild(p.children.indexOf(b), nb);
  await setT(
    nb.findOne((x) => x.type === "TEXT"),
    "存草稿",
  );
  if (p.primaryAxisAlignItems === "SPACE_BETWEEN") {
    const g = AL("HORIZONTAL", {
      name: "buttons",
      itemSpacing: 8,
      counterAxisAlignItems: "CENTER",
    });
    p.insertChild(p.children.indexOf(nb), g);
    g.appendChild(nb);
    g.appendChild(b);
  }
}
// 調貨單電腦版原本的「儲存草稿」統一叫「存草稿」
await setT(await figma.getNodeByIdAsync("I69:1614;2001:129"), "存草稿");
// 列表:草稿列 + 篩選
const filtersSrc = (await figma.getNodeByIdAsync("92:1017")).findOne(
  (n) => n.name === "filters",
);
const LISTS = {
  "92:1017": [["R-0024", "中山店", "10/20", "5", "草稿", "王小明"], null],
  "92:1625": [
    ["P-0034", "中山店", "林大同 #87654321", "—", "—", "—", "—", "草稿"],
    ["進貨分店", "狀態", "期間"],
  ],
  "92:2540": [
    ["T-0009", "中山店 → 新竹店", "1 本", "18,400", "—", "—", "草稿"],
    ["出貨店", "狀態", "期間"],
  ],
};
for (const [id, [vals, flabels]] of Object.entries(LISTS)) {
  const f = await figma.getNodeByIdAsync(id);
  const tbl = f.findOne((n) => n.name === "table");
  const r = tbl.children[1].clone();
  tbl.insertChild(1, r);
  for (let i = 0; i < r.children.length && i < vals.length; i++) {
    const cell = r.children[i];
    const tag =
      cell.type === "INSTANCE"
        ? cell
        : cell.findOne &&
          cell.findOne((n) => n.type === "INSTANCE" && /Tag/.test(n.name));
    if (tag && /Tag/.test(tag.name)) tag.setProperties({ Tone: "Grey" });
    const t =
      (tag || cell).type === "TEXT"
        ? cell
        : (tag || cell).findOne((x) => x.type === "TEXT");
    if (t) await setT(t, vals[i]);
  }
  if (flabels) {
    const c = f.findOne((n) => n.name === "content" && n.type === "FRAME");
    const fl = filtersSrc.clone();
    c.insertChild(c.children.findIndex((n) => n.name === "title") + 1, fl);
    fl.layoutSizingHorizontal = "FILL";
    for (let i = 0; i < fl.children.length; i++) {
      const lab = fl.children[i]
        .findAll((x) => x.type === "TEXT")
        .find((x) => x.name === "label");
      if (lab) await setT(lab, flabels[i]);
    }
  }
  fitShell(f, 900);
}
