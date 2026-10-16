// 第二十四輪後續之十二:SC-60 拆兩張(scratch-lot Screens 班表頁 70:14 執行一次;之後跑 r4-layout.js 排位置、brand-rebind.js 補綁)。
// - SC-60(電腦 390:101986 / 平板 390:102620)只示範滑過排班長條:拿掉 11/10 08:00 的「+ 人力需求」淡色格子。
// - SC-60b(電腦 / 平板):從 SC-60 複製,拿掉 Tooltip、長條回到 Interaction=Default;時間軸往下捲成 07:00 起
//   (規格:時間軸 00:00–24:00 可捲動,進畫面自動捲到最早長條前 1 小時),在 11/10 07:00–08:00 空白格示範「+ 人力需求」。
//   時間軸框名加「可捲動」(audit-layout 對捲動內容不算裁切)。表頭、日期欄分隔線、特殊日底色不跟著捲。
// - SC-44 / SC-45 三尺寸框外註解補一句「時間軸 0–24 可捲動,進入時捲到最早排班前 1 小時」。
const page = await figma.getNodeByIdAsync("70:14");
await figma.setCurrentPageAsync(page);
const fnt = async (t) => {
  for (const f of t.getRangeAllFontNames(0, Math.max(1, t.characters.length)))
    await figma.loadFontAsync(f);
};
const blk = await figma.getNodeByIdAsync("259:4770");
const defMain = blk.children.find(
  (v) => v.name === "State=Normal, Auto=False, Interaction=Default",
);
const H = 36, // 每小時高度
  TOP = 22; // 08:00 的 y(表頭下緣)
const out = [];
for (const id of ["390:101986", "390:102620"]) {
  const f = await figma.getNodeByIdAsync(id);
  const sec = f.parent;
  const note = sec.children.find(
    (n) => n.type === "TEXT" && n.name === f.name + " · 註解",
  );
  const c = f.clone();
  sec.appendChild(c);
  c.x = f.x;
  c.y = f.y + f.height + 200;
  c.name = f.name
    .replace("SC-60", "SC-60b")
    .replace("滑過排班長條", "滑過空白時段");
  f.findOne((n) => n.name === "empty-hover + 人力需求").remove();
  c.findOne((n) => /^浮層 Tooltip/.test(n.name)).remove();
  for (const i of c.findAll(
    (n) =>
      n.type === "INSTANCE" &&
      n.componentProperties?.Interaction?.value === "Hover",
  )) {
    i.setProperties({ Interaction: "Default" });
    i.strokes = defMain.strokes; // 疊色在 Hover 變體的 state-layer 圖層,回到 Default 就沒有了
  }
  const tl = c.findOne((n) => n.name === "ScheduleTimeline(週模式,容器)");
  tl.name = "ScheduleTimeline(週模式,容器,可捲動)";
  const keep = (n) =>
    n.y < TOP - 0.5 ||
    n.name === "grid-v" ||
    /^special-day/.test(n.name) ||
    n.name === "empty-hover + 人力需求";
  let lab08 = null,
    grid08 = null;
  for (const n of [...tl.children]) {
    if (keep(n)) continue;
    if (
      n.type === "INSTANCE" &&
      /TableHeaderCell/.test(n.name) &&
      Math.abs(n.y - TOP) < 1 &&
      n.x < 1
    )
      lab08 = n;
    if (n.name === "grid-h" && Math.abs(n.y - TOP) < 1) grid08 = n;
    n.y += H;
    if (n.y >= tl.height - 1) n.remove(); // 捲出可視範圍的 21:00 列
  }
  const l7 = lab08.clone();
  tl.appendChild(l7);
  l7.x = lab08.x;
  l7.y = TOP;
  const t7 = l7.findOne((n) => n.type === "TEXT");
  await fnt(t7);
  t7.characters = "07:00";
  const g7 = grid08.clone();
  tl.appendChild(g7);
  g7.x = grid08.x;
  g7.y = TOP;
  const eh = c.findOne((n) => n.name === "empty-hover + 人力需求");
  eh.y = TOP + 1;
  eh.resize(eh.width, H - 2);
  await fnt(note);
  note.characters =
    "- 觸發:電腦 / 平板滑鼠滑過排班長條 → 長條 Hover(底色換深一階:primary/lighter → primary/light、框 primary/dark),下方 Tooltip 顯示「姓名 · 時間 · ☕ 休息 · 職責 · 崗位」;點長條開人力需求對話框(SC-21)。\n- 滑過沒有人力需求的空白時段見 SC-60b。\n- 手機:沒有滑過,按下時底色加深,內容看對話框(SC-21)。";
  const n2 = note.clone();
  sec.appendChild(n2);
  n2.name = c.name + " · 註解";
  n2.x = note.x;
  n2.y = c.y;
  n2.characters =
    "- 觸發:電腦 / 平板滑鼠滑過沒有人力需求的空白時段 → 淡色「+ 人力需求」格子(整點一小時),點了新增人力需求(SC-48),時段帶入滑過的時間。\n- 時間軸 00:00–24:00 可捲動,進入時捲到最早排班前 1 小時;本張捲到 07:00 起,示範 11/10 07:00–08:00 的空白格。\n- 手機:沒有滑過,用頁首 [+ 人力需求] 新增(SC-48)。";
  out.push({ orig: f.id, b: c.id, hover: eh.id, note: n2.id });
}
const add = "\n- 時間軸 0–24 可捲動,進入時捲到最早排班前 1 小時。";
for (const s of page.children.filter((n) => n.type === "SECTION"))
  for (const n of s.children)
    if (
      n.type === "TEXT" &&
      /^SC-4[45]( |$)/.test(n.name) &&
      n.name.endsWith(" · 註解") &&
      !n.characters.includes("0–24 可捲動")
    ) {
      await fnt(n);
      n.characters = n.characters.replace(/\s+$/, "") + add;
    }
return out;
