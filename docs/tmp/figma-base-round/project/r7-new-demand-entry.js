// ==== 第二十五輪後續:排班對話框的 [新增一筆人力需求] 入口與 SC-04e 三步流程(班表頁 70:14)====
// 用法:r5-kit.js + r7-dialogs.js(刪掉 `if (PART === "demand") {` 起到檔尾)+ 本檔一起貼進 use_figma;之後跑 r4-layout.js 排版。
// 規格 14.5「排班對話框」:新增人力需求的入口在「加入這天的人力需求」區塊標題那一行最右邊(文字按鈕 [新增一筆人力需求]),
// 疊開共用的人力需求對話框(新增模式);清單最下面的 [+ 加入人力需求] 只做「從這天已有的人力需求加一列」。
// 1. 既有排班對話框(SC-04a~d、SC-04f、SC-19,含 SC-34a / b 背景裡的 SC-04b 複本):拿掉中間版的勾選項(temp-demand)、
//    清單旁的 [新增一筆人力需求];區塊標題列加上入口按鈕;對話框高度改變時 Overlay 跟著重算。
// 2. 舊 SC-04e(單張)與註解刪掉,改畫 SC-04e ①②③(三尺寸)並加註解。
const out = { removedOld: 0, entries: 0, deleted: [], made: [], notes: 0 };
for (const n of PAGE.findAll(
  (n) => n.name === "temp-demand" || n.name === "new-demand-entry",
)) {
  n.remove();
  out.removedOld++;
}
for (const sz of ["D", "T", "M"])
  out.deleted.push(...(await del(/^SC-04e /, sz)));
const touched = [];
for (const la of PAGE.findAll(
  (n) => n.type === "FRAME" && n.name === "list-actions",
))
  for (const b of la.children.filter(
    (k) =>
      k.type === "INSTANCE" &&
      k.findOne(
        (t) => t.type === "TEXT" && t.characters === "新增一筆人力需求",
      ),
  ))
    b.remove();
for (const h of PAGE.findAll(
  (n) =>
    n.type === "FRAME" &&
    n.name === "section-head" &&
    n.children.some(
      (k) => k.type === "TEXT" && k.characters === "加入這天的人力需求",
    ),
)) {
  if (h.children.some((k) => k.type === "INSTANCE")) continue;
  const t = h.children.find((k) => k.type === "TEXT");
  await figma.loadFontAsync(t.fontName);
  t.layoutSizingHorizontal = "FILL";
  t.textAutoResize = "HEIGHT";
  add(h, await btn("新增一筆人力需求", "Text", "Small"));
  out.entries++;
  touched.push(h);
}
const isOverlay = (f) =>
  f.type === "FRAME" &&
  f.children.some((k) => k.name === "scrim" || k.name.startsWith("背景:"));
for (const la of touched)
  for (let f = la.parent; f && f.type !== "SECTION"; f = f.parent) {
    if (!isOverlay(f)) continue;
    const panel = f.children.find(
      (k) => k.name !== "scrim" && !k.name.startsWith("背景:"),
    );
    if (!panel) continue;
    const was = f.locked;
    f.locked = false;
    if (/^full-dialog|全螢幕/.test(panel.name)) {
      const body = panel.children.find((k) => k.name === "body");
      if (body) {
        body.layoutSizingVertical = "HUG";
        const need = Math.ceil(body.y + body.height);
        body.layoutSizingVertical = "FILL";
        if (need > f.height) f.resize(f.width, need);
      }
    } else if (panel.y + panel.height + 40 > f.height)
      f.resize(f.width, Math.ceil(panel.y + panel.height + 40));
    coverOverlay(f);
    f.locked = was;
  }
await sc04eFlow();
const NOTES = {
  "SC-04e ①": [
    "- 規格 14.4、14.5:臨時代班 — 那天沒有排班,從班表格子的時鐘圖示打開新增排班(人員、日期帶入,同一個打卡區塊);上下班時間由店長輸入(未勾改用打卡時間;示範 09:00–15:00,和打卡 09:02 / 15:10 不同);勾「上下班時間改用打卡時間」(有權限時)才用打卡時間帶入。",
    "- 當天沒有合適的人力需求:清單位置顯示「這天沒有合適的人力需求」;新增入口在「加入這天的人力需求」標題那一行最右邊 [新增一筆人力需求] → 疊開人力需求對話框(SC-04e ②)。",
  ],
  "SC-04e ②": [
    "- 規格 14.5:排班對話框標題列右邊的 [新增一筆人力需求] 疊開共用的人力需求對話框(新增模式,同 SC-21a),不是對話框裡的子表單。",
    "- 日期鎖定為這筆排班那天;開始 / 結束預設帶入這筆排班的上下班時間(可改);崗位、負責人 / 協同任務照一般新增;「同時存成人力需求範本」照樣可用。",
    "- [新增] 成功 → 關閉、回到排班對話框(SC-04e ③);[取消] → 回到排班對話框,什麼都不變。",
  ],
  "SC-04e ③": [
    "- 規格 14.5:新的人力需求立刻出現在「加入這天的人力需求」選項裡並自動加一列,依規則填第一個空的任務(還缺負責且這個人可以負責 → 負責,否則協同),可再改;沒有套用範本顯示「臨」。",
    "- 人力需求在對話框按 [新增] 時就獨立存檔:之後排班按 [取消],人力需求保留不刪;Snackbar 提示「已新增人力需求 …」。",
  ],
};
for (const f of made) {
  out.made.push(f.id + " " + f.name);
  const k = Object.keys(NOTES).find((c) => f.name.startsWith(c + " "));
  if (k) {
    await note(f, NOTES[k]);
    out.notes++;
  }
}
return out;
