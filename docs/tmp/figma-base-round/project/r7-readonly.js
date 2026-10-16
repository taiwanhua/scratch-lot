// ==== 定稿總核對:唯讀對話框 SC-33a / SC-33b(班表頁 70:14,三尺寸)====
// 用法:r5-kit.js + r7-dialogs.js(刪掉 `if (PART === "demand") {` 起到檔尾)+ 本檔一起貼進 use_figma;之後跑 r4-layout.js 排版。
// 規格 14.5「其他狀態與權限差異」:沒有 `edit` 的人點格子 / 長條 / 人力需求 → 開同一個對話框(排班或人力需求),
// 所有欄位停用、按鈕只剩 [關閉](手機全螢幕對話框:標題列只有關閉,沒有動作)。背景是 SC-33(只能檢視)。
const RO = "Disabled";
async function roDialog(sz, title, build) {
  if (sz === "M") {
    const { f, body } = await fullDlg(title, null);
    await build(body, sz);
    return { panel: f, kind: "full" };
  }
  const d = await dlg(title, 600);
  await build(d, sz);
  add(d, await actions([await btn("關閉", "Text", "Medium")]), "FILL");
  return { panel: d, kind: "dialog" };
}
async function roScreen(code, title, build) {
  for (const sz of ["D", "T", "M"]) {
    const { panel, kind } = await roDialog(sz, title, build);
    const bg = await bgOf("SC-33", sz);
    const f = await overlay(bg, nameOf(code, sz, title), panel, kind, sz);
    put(sz, f);
    made.push(f);
  }
}
const roTime = async (sz, a, b, br) =>
  sz === "M"
    ? [
        r2(
          await tf("上班", a, "", "Medium", RO),
          await tf("下班", b, "", "Medium", RO),
        ),
        await tf("休息(分)", br, "", "Medium", RO),
      ]
    : [
        r3(
          await tf("上班", a, "", "Medium", RO),
          await tf("下班", b, "", "Medium", RO),
          await tf("休息(分)", br, "", "Medium", RO),
        ),
      ];
async function roDemandRow(sz, demand, roleTask) {
  const a = await selF("人力需求", demand, RO);
  const b = await selF("職責 · 執行任務", roleTask, RO);
  const r = sz === "M" ? col(8, "demand-row") : row(8, "demand-row");
  add(r, a, "FILL");
  add(r, b, "FILL");
  return r;
}
async function roTaskRow(sz, task, who, whoK = "ts") {
  const r = row(8, "task-row");
  add(r, await selF("執行任務", task, RO), "FILL");
  if (sz !== "M") {
    add(r, await T(who, "body2", whoK, "filled-by"));
    return r;
  }
  const c = col(4, "task-row");
  add(c, r, "FILL");
  add(c, await T(who, "cap", whoK, "filled-by"));
  return c;
}
await roScreen("SC-33a", "排班 · 李小華 11/4(三)", async (p, sz) => {
  for (const x of await roTime(sz, "08:30", "14:30", "30")) add(p, x, "FILL");
  add(p, await head("填進的人力需求"), "FILL");
  add(
    p,
    await roDemandRow(
      sz,
      "早班 08:30–14:30 · 店內櫃台",
      "負責 · 店內事務與帳目負責",
    ),
    "FILL",
  );
});
await roScreen("SC-33b", "人力需求 · 11/2(一)晚班", async (p, sz) => {
  add(
    p,
    r2(
      await tf("日期", "11/2(一)", "", "Medium", RO),
      await selF("崗位", "店內櫃台", RO),
    ),
    "FILL",
  );
  add(
    p,
    r2(
      await tf("開始", "14:30", "", "Medium", RO),
      await tf("結束", "22:00", "", "Medium", RO),
    ),
    "FILL",
  );
  add(p, await head("負責人", "0–1 筆"), "FILL");
  add(p, await roTaskRow(sz, "店內事務與帳目負責", "李小華 填進"), "FILL");
  add(p, await head("協同", "0–10 筆"), "FILL");
  add(p, await roTaskRow(sz, "店內事務", "還沒有人填", "wd"), "FILL");
});
const NOTES = {
  "SC-33a": [
    "- 規格 14.5「其他狀態與權限差異」:沒有 `edit` 的人點格子 / 長條 → 開同一個排班對話框,所有欄位停用,按鈕只剩 [關閉];沒有 [刪除這筆排班]、[新增一筆人力需求]、[+ 加入人力需求]、[移除]。",
    "- 手機是全螢幕對話框,標題列只有關閉、沒有 [儲存]。",
  ],
  "SC-33b": [
    "- 規格 14.5:沒有 `edit` 的人點人數標籤 / 容器標題 / 月檢視標籤 → 開同一個人力需求對話框,所有欄位停用,按鈕只剩 [關閉];沒有 [+ 負責人] [+ 協同]、[移除]、[刪除人力需求]。",
  ],
};
const res = [];
for (const f of made) {
  const k = Object.keys(NOTES).find((c) => f.name.startsWith(c + " "));
  if (k) await note(f, NOTES[k]);
  res.push(f.id + " " + f.name);
}
return res;
