// ==== 第二十五輪:執行任務模型的兩個對話框(班表頁 70:14)====
// 用法:r5-kit.js 後面接本檔一起貼進 use_figma(把 PART 換成要跑的段)。畫好的畫面先放在各尺寸 Section 的遠處(put),之後跑 r4-layout.js 排版。
// 規格 14.5「兩種對話框」:只有人力需求對話框(SC-21a 新增 / SC-21b 編輯 / SC-21c 刪除確認)與排班對話框(SC-04a~f、已發布 SC-19)。
// 示範資料(和班表一致):11/2 晚班李小華負責、協同空著;11/4 李小華早班負責、王小明晚班負責(自動排入);11/5 王小明早班 + 3 張未對應打卡、
// 陳大文晚班兼櫃台 A / B;11/1 林美麗臨時代班 2 張打卡;11/6 補貨沒有人力需求(SC-63 點了開 SC-21a)。
const PART = "demand";
const SZN = { D: "Overlay / ", T: "· 平板 ", M: "· 手機 " };
const nameOf = (code, sz, t) => `${code} ${SZN[sz]}${t}`;
const BG = {
  "SC-03": { D: "290:83686", T: "290:87689", M: "290:90336" },
  "SC-45": { D: "272:87899", T: "272:88462", M: "272:88762" },
};
const bgOf = async (code, sz) => {
  if (BG[code]) return figma.getNodeByIdAsync(BG[code][sz]);
  return byName(new RegExp("^" + code + " (?!.*註解)"), sz);
};
const r2 = (a, b) => {
  const r = row(12, "fields", "MIN");
  add(r, a, "FILL");
  add(r, b, "FILL");
  return r;
};
const r3 = (a, b, c) => {
  const r = row(12, "fields", "MIN");
  add(r, a, "FILL");
  add(r, b, "FILL");
  add(r, c, "FILL");
  return r;
};
const fieldsTime = async (sz, a, b, br, brHelp = "") =>
  sz === "M"
    ? [
        r2(await tf("上班", a), await tf("下班", b)),
        await tf("休息(分)", br, brHelp),
      ]
    : [
        r3(
          await tf("上班", a),
          await tf("下班", b),
          await tf("休息(分)", br, brHelp),
        ),
      ];
async function head(t, sub) {
  const r = row(8, "section-head");
  add(r, await T(t, "sub2"));
  if (sub) add(r, await T(sub, "cap", "ts"));
  return r;
}
// 人力需求對話框的一列執行任務:任務內容下拉 + 誰填進 + [移除]
async function taskRow(sz, task, who, whoK = "ts") {
  const r = row(8, "task-row");
  add(r, await selF("執行任務", task), "FILL");
  if (sz !== "M" && who) add(r, await T(who, "body2", whoK, "filled-by"));
  add(r, await btn("移除", "Text", "Small", "Error"));
  if (sz !== "M" || !who) return r;
  const c = col(4, "task-row");
  add(c, r, "FILL");
  add(c, await T(who, "cap", whoK, "filled-by"));
  return c;
}
// 排班對話框「加入這天的人力需求」的一列:人力需求 + 職責 · 執行任務 + [移除]
async function demandRow(sz, demand, roleTask) {
  const a = await selF("人力需求", demand);
  const b = await selF("職責 · 執行任務", roleTask);
  b.name = "SelectField 職責 · 執行任務";
  const x = await btn("移除", "Text", "Small", "Error");
  if (sz !== "M") {
    const r = row(8, "demand-row");
    add(r, a, "FILL");
    add(r, b, "FILL");
    add(r, x);
    return r;
  }
  const c = col(8, "demand-row");
  add(c, a, "FILL");
  const r = row(8, "role");
  add(r, b, "FILL");
  add(r, x);
  add(c, r, "FILL");
  return c;
}
// 「加入這天的人力需求」清單底部:從當天已有的挑 / 就地新增一筆(沒有套用範本,顯示「臨」)
async function listActions() {
  const r = row(8, "list-actions");
  add(r, await btn("+ 加入人力需求", "Text", "Small"));
  add(r, await btn("新增一筆人力需求", "Text", "Small"));
  return r;
}
// 就地新增的人力需求(臨時代班):時間預設 = 排班時間、崗位必選、自動建一筆任務給這個人並填進
async function newDemandBlock(sz, a, b, roleTask) {
  const c = await card("新增一筆人力需求", 12, 8);
  const hd = row(8, "head");
  add(hd, await T("新增一筆人力需求", "sub2"));
  add(hd, await tag("臨", "Primary"));
  sp(hd);
  add(hd, await btn("移除", "Text", "Small", "Error"));
  add(c, hd, "FILL");
  add(c, await selF("崗位 *", "店內櫃台"), "FILL");
  add(c, r2(await tf("開始", a), await tf("結束", b)), "FILL");
  add(c, await selF("職責 · 執行任務", roleTask), "FILL");
  return c;
}
// 未對應排班的打卡區塊
async function punchBlock(sz, title, items, usePunch) {
  const c = await card("未對應排班的打卡", 12, 8);
  await fill(c, "wl");
  add(c, await T(title, "sub2"), "FILL");
  for (const [on, label] of items) add(c, await cb(on, label));
  add(c, await divider(sz === "M" ? 310 : 480), "FILL");
  add(c, await cb(usePunch, "上下班時間改用打卡時間"));
  return c;
}
// 對話框(電腦 / 平板置中、手機全螢幕)
async function dialog(sz, title, action, build, opts = {}) {
  if (sz === "M" && !opts.small) {
    const { f, body } = await fullDlg(title, action);
    await build(body, sz);
    if (opts.danger)
      add(body, await btn(opts.danger, "Text", "Medium", "Error"));
    return { panel: f, kind: "full" };
  }
  const d = await dlg(title, sz === "M" ? 342 : opts.w || 600);
  await build(d, sz);
  const right = [await btn("取消", "Text", "Medium")];
  if (action)
    right.push(
      await btn(action, "Contained", "Medium", opts.actionColor || "Primary"),
    );
  add(
    d,
    await actions(
      right,
      opts.danger ? [await btn(opts.danger, "Text", "Medium", "Error")] : [],
    ),
    "FILL",
  );
  if (sz === "M") {
    const a = d.findOne((n) => n.name === "actions");
    a.layoutWrap = "WRAP";
    a.counterAxisSpacing = 8;
  }
  return { panel: d, kind: "dialog" };
}
const made = [];
async function screen(code, title, bgCode, action, build, opts = {}) {
  for (const sz of ["D", "T", "M"]) {
    const { panel, kind } = await dialog(sz, title, action, build, opts);
    const bg = await bgOf(bgCode, sz);
    const f = await overlay(bg, nameOf(code, sz, title), panel, kind, sz);
    put(sz, f);
    made.push(f);
    if (opts.after) await opts.after(f, sz);
  }
}
// 下拉選單打開(SC-04a 示範:同一筆其他空的執行任務;已被別人填的停用)
async function menuUnder(f, selName, items) {
  const s = f.findOne((n) => n.name === selName && !n.name.startsWith("背景"));
  const m = await card("menu 職責 · 執行任務", 4, 0);
  m.effectStyleId = SHADOW;
  for (const [t, k, bg] of items) {
    const r = row(8, "menu-item");
    r.paddingLeft = r.paddingRight = 12;
    r.paddingTop = r.paddingBottom = 10;
    if (bg) await fill(r, bg);
    add(r, await T(t, "body2", k));
    add(m, r, "FILL");
  }
  f.appendChild(m);
  m.layoutSizingHorizontal = "FIXED";
  const sb = s.absoluteBoundingBox;
  const fb = f.absoluteBoundingBox;
  m.resize(Math.max(sb.width, 280), m.height);
  m.x = sb.x - fb.x;
  m.y = sb.y - fb.y + sb.height + 4;
}

if (PART === "demand") {
  // SC-21a 新增人力需求(從班表人力需求區點「補貨」列 11/6 空白格,帶入補貨範本)
  await screen("SC-21a", "新增人力需求", "SC-63", "新增", async (p, sz) => {
    add(
      p,
      await alert("已帶入「補貨」範本的時間、崗位與執行任務", "Info"),
      "FILL",
    );
    add(
      p,
      r2(await tf("日期", "11/6(五)"), await selF("崗位", "補貨")),
      "FILL",
    );
    add(p, r2(await tf("開始", "13:00"), await tf("結束", "17:00")), "FILL");
    add(p, await head("負責人", "0~1 筆"), "FILL");
    add(p, await T("沒有負責人", "body2", "ts", "empty"));
    add(p, await btn("+ 負責人", "Text", "Small"));
    add(p, await head("協同", "0~10 筆"), "FILL");
    add(p, await taskRow(sz, "店內事務", null), "FILL");
    add(p, await btn("+ 協同", "Text", "Small"));
    add(p, await cb(false, "同時存成人力需求範本"));
  });
  // SC-21b 編輯人力需求(從日檢視點晚班容器標題)
  await screen(
    "SC-21b",
    "人力需求 · 11/2(一)晚班",
    "SC-45",
    "儲存",
    async (p, sz) => {
      add(
        p,
        r2(await tf("日期", "11/2(一)"), await selF("崗位", "店內櫃台")),
        "FILL",
      );
      add(p, r2(await tf("開始", "14:30"), await tf("結束", "22:00")), "FILL");
      add(p, await head("負責人", "0~1 筆"), "FILL");
      add(p, await taskRow(sz, "店內事務與帳目負責", "李小華 填進"), "FILL");
      add(p, await btn("+ 負責人", "Text", "Small", "Primary", "Disabled"));
      add(p, await head("協同", "0~10 筆"), "FILL");
      add(p, await taskRow(sz, "店內事務", "還沒有人填", "wd"), "FILL");
      add(p, await btn("+ 協同", "Text", "Small"));
    },
    { danger: "刪除人力需求" },
  );
  // SC-21c 刪除人力需求確認:列出會解除的人,變成零筆的排班一起刪
  await screen(
    "SC-21c",
    "刪除 11/2(一)晚班?",
    "SC-45",
    "刪除人力需求並刪除這 1 筆排班",
    async (p, sz) => {
      add(p, await T("會解除下面的人:", "body2"));
      const b = await box("解除的人", "def", 12, 6, "sm");
      add(b, await T("李小華 · 負責 · 店內事務與帳目負責", "body2"));
      add(p, b, "FILL");
      add(
        p,
        await TW(
          "李小華 11/2 的排班只填了這一筆,會一起刪除(每筆排班至少要填進一筆人力需求)。",
          sz === "M" ? 294 : 392,
          "body2",
          "ts",
        ),
      );
    },
    { w: 440, small: true, actionColor: "Error" },
  );
}

if (PART === "entry") {
  // SC-04a 新增排班(週 / 日點缺額空位:帶好那筆人力需求與執行任務;下拉打開看同一筆其他任務)
  await screen(
    "SC-04a",
    "新增排班 · 11/2(一)",
    "SC-45",
    "新增",
    async (p, sz) => {
      add(p, await selF("人員", "黃志明"), "FILL");
      for (const x of await fieldsTime(
        sz,
        "14:30",
        "22:00",
        "30",
        "預設休息:滿 4 小時 30 分",
      ))
        add(p, x, "FILL");
      add(p, await head("加入這天的人力需求"), "FILL");
      add(
        p,
        await demandRow(sz, "晚班 14:30–22:00 · 店內櫃台", "協同 · 店內事務"),
        "FILL",
      );
      add(p, await listActions(), "FILL");
    },
    {
      after: (f) =>
        menuUnder(f, "SelectField 職責 · 執行任務", [
          ["負責 · 店內事務與帳目負責(李小華)", "tdis"],
          ["協同 · 店內事務", "tp", "sel"],
        ]),
    },
  );
  // SC-04b 編輯排班(班表點格子 / 週日點長條)
  await screen(
    "SC-04b",
    "排班 · 李小華 11/4(三)",
    "SC-03",
    "儲存",
    async (p, sz) => {
      for (const x of await fieldsTime(sz, "08:30", "14:30", "30"))
        add(p, x, "FILL");
      add(p, await head("加入這天的人力需求"), "FILL");
      add(
        p,
        await demandRow(
          sz,
          "早班 08:30–14:30 · 店內櫃台",
          "負責 · 店內事務與帳目負責",
        ),
        "FILL",
      );
      add(p, await listActions(), "FILL");
    },
    { danger: "刪除這筆排班" },
  );
  // SC-04c 負責人的上下班時間沒涵蓋人力需求 → 延長按鈕
  await screen(
    "SC-04c",
    "排班 · 王小明 11/4(三)",
    "SC-03",
    "儲存",
    async (p, sz) => {
      for (const x of await fieldsTime(sz, "14:30", "18:00", "30"))
        add(p, x, "FILL");
      add(p, await head("加入這天的人力需求"), "FILL");
      add(
        p,
        await demandRow(
          sz,
          "晚班 14:30–22:00 · 店內櫃台",
          "負責 · 店內事務與帳目負責",
        ),
        "FILL",
      );
      const w = await card("時間涵蓋提示", 12, 8, false);
      await fill(w, "wl");
      add(w, await T("上下班時間沒有涵蓋晚班 18:00–22:00", "body2", "wd"));
      add(w, await btn("往後延長到 22:00", "Outlined", "Small"));
      add(p, w, "FILL");
      add(p, await listActions(), "FILL");
    },
    { danger: "刪除這筆排班" },
  );
  // SC-04d 未對應排班的打卡區塊
  await screen(
    "SC-04d",
    "排班 · 王小明 11/5(四)",
    "SC-03",
    "儲存",
    async (p, sz) => {
      for (const x of await fieldsTime(sz, "08:30", "14:30", "30"))
        add(p, x, "FILL");
      add(p, await head("加入這天的人力需求"), "FILL");
      add(
        p,
        await demandRow(
          sz,
          "早班 08:30–14:30 · 店內櫃台",
          "負責 · 店內事務與帳目負責",
        ),
        "FILL",
      );
      add(p, await listActions(), "FILL");
      add(
        p,
        await punchBlock(
          sz,
          "王小明 11/5 有 3 張未對應排班的打卡",
          [
            [true, "08:27 上班"],
            [false, "08:31 上班 · 重複打卡"],
            [true, "14:36 下班"],
          ],
          false,
        ),
        "FILL",
      );
    },
    { danger: "刪除這筆排班" },
  );
  // SC-04e 臨時代班:那天沒有排班,從格子的時鐘圖示打開;上下班自己填(勾「改用打卡時間」才帶入),
  // 當天沒有合適的人力需求 → 清單底部 [新增一筆人力需求] 就地建一筆「臨」並填進
  await screen(
    "SC-04e",
    "新增排班 · 林美麗 11/1(日)",
    "SC-03",
    "新增",
    async (p, sz) => {
      for (const x of await fieldsTime(sz, "09:00", "15:10", "30"))
        add(p, x, "FILL");
      add(
        p,
        await punchBlock(
          sz,
          "林美麗 11/1 有 2 張未對應排班的打卡",
          [
            [true, "09:02 上班"],
            [true, "15:10 下班"],
          ],
          false,
        ),
        "FILL",
      );
      add(p, await head("加入這天的人力需求"), "FILL");
      add(
        p,
        await newDemandBlock(sz, "09:00", "15:10", "負責 · 店內事務與帳目負責"),
        "FILL",
      );
      add(p, await listActions(), "FILL");
    },
  );
  // SC-04f 一人顧兩台
  await screen(
    "SC-04f",
    "排班 · 陳大文 11/5(四)",
    "SC-03",
    "儲存",
    async (p, sz) => {
      for (const x of await fieldsTime(sz, "14:30", "22:00", "30"))
        add(p, x, "FILL");
      add(p, await head("加入這天的人力需求"), "FILL");
      add(
        p,
        await demandRow(
          sz,
          "晚班 14:30–22:00 · 櫃台 A",
          "負責 · 店內事務與帳目負責",
        ),
        "FILL",
      );
      add(
        p,
        await demandRow(
          sz,
          "晚班 14:30–22:00 · 櫃台 B",
          "負責 · 店內事務與帳目負責",
        ),
        "FILL",
      );
      add(p, await listActions(), "FILL");
    },
    { danger: "刪除這筆排班" },
  );
  // SC-19 編輯已發布的排班(異動原因必填)
  await screen(
    "SC-19",
    "排班 · 李小華 11/4(三)",
    "SC-15b",
    "儲存",
    async (p, sz) => {
      for (const x of await fieldsTime(sz, "08:30", "14:30", "30"))
        add(p, x, "FILL");
      add(p, await head("加入這天的人力需求"), "FILL");
      add(
        p,
        await demandRow(
          sz,
          "早班 08:30–14:30 · 店內櫃台",
          "負責 · 店內事務與帳目負責",
        ),
        "FILL",
      );
      add(p, await listActions(), "FILL");
      add(p, await selF("異動原因 *", "換班"), "FILL");
    },
    { danger: "刪除這筆排班" },
  );
}
return made.map((f) => f.id + " " + f.name);
