// 班表資料改動後(r7-roster-data.js:晚班列加高)讓畫面高度跟著內容:含 11/5 晚班兩個標籤的班表,往上找到它所在的殼(有 main 的框,
// 含 Overlay 裡的「背景:」複本)照 r5-kit fitShell 重算高度;殼在 Overlay 裡時再照 coverOverlay 讓遮罩 / 全螢幕 / 抽屜蓋滿、底部面板貼底。
figma.skipInvisibleInstanceChildren = false;
const page = await figma.getNodeByIdAsync("70:14");
await page.loadAsync();
const H = { 1440: 900, 1024: 768, 390: 844 };
const fitShell = (f) => {
  const m = f.children.find((n) => n.name === "main");
  const c = m.children.find((n) => n.name === "content");
  c.layoutSizingVertical = "HUG";
  m.layoutSizingVertical = "HUG";
  f.resize(f.width, Math.max(H[Math.round(f.width)] || 0, m.height));
  m.layoutSizingVertical = "FILL";
  c.layoutSizingVertical = "FILL";
};
const coverOverlay = (f) => {
  const bg = f.children.find((k) => k.name.startsWith("背景:"));
  if (bg && bg.height > f.height) f.resize(f.width, bg.height);
  const h = f.height;
  for (const k of f.children) {
    if (/bottom-sheet|底部面板/.test(k.name)) k.y = h - k.height;
    else if (
      k.name === "scrim" ||
      k.name.startsWith("背景:") ||
      /^(full-dialog|drawer)|全螢幕|抽屜/.test(k.name)
    ) {
      k.y = 0;
      k.resize(k.width, h);
    }
  }
};
const shells = new Set();
for (const g of page.findAll((n) => n.name === "RosterGrid(組成)")) {
  if (!g.findOne((n) => n.type === "TEXT" && n.characters === "B 負1/1"))
    continue;
  let s = g.parent;
  while (s && !(s.children && s.children.some((k) => k.name === "main")))
    s = s.parent;
  if (s) shells.add(s);
}
const out = [];
for (const s of shells) {
  const was = s.locked;
  s.locked = false;
  const h0 = s.height;
  fitShell(s);
  s.locked = was;
  if (s.name.startsWith("背景:") && s.parent) coverOverlay(s.parent);
  out.push(`${s.name.slice(0, 30)} ${Math.round(h0)}→${Math.round(s.height)}`);
}
return { n: shells.size, out };
