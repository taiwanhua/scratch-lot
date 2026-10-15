// ==== 第十九輪:班表管理頁(70:14)依討論決定重做 ====
// 用法(scratch-lot Screens):
//   1. 先把 r5-kit.js(與排班作業需要的 r5-roster.js)存進頁上的隱藏文字節點,或直接貼在本段前面。
//      本輪實際做法:kit 存在 70:14 頁的隱藏文字節點「_r5kit(用完刪)」、roster 存在「_r5roster(用完刪)」,
//      每段用 AsyncFunction 讀出執行(見下面的 load());畫完後兩個節點已刪除。
//   2. 依序執行 PART:my(本檔)→ dayoff → roster(r5-schedule-parts.js)。每段整段貼進 use_figma(把 PART 換成要跑的段)。
//      load() 讀的兩個隱藏文字節點已刪除;重跑前先把 r5-kit.js / r5-roster.js 存成隱藏文字節點,並換掉 load() 裡的 id。
// 殼(側欄 + 頁首)從班表頁既有畫面複製,r5-kit.js 的 SHELL 已指向本輪新畫面(SC-01 / SC-03 / SC-08 / SC-11 / SC-12)。
// 專案畫面以 Figma 為正本(README「以 Figma 為準的畫面」);本檔記錄本輪怎麼畫出來的,重跑會在 Section 裡新增一份。
const PART = "my";
const AF = Object.getPrototypeOf(async function () {}).constructor;
async function load(withRoster) {
  const KIT = (await figma.getNodeByIdAsync("261:57906")).characters; // _r5kit
  const RO = withRoster
    ? (await figma.getNodeByIdAsync("271:15918")).characters // _r5roster
    : "";
  return await new AF(
    KIT +
      "\n" +
      RO +
      "\nreturn {PAGE,P,fill,stroke,rad,T,TW,AL,add,sp,row,col,card,box,inst,btn,tag,setTxt,selF,tf,cb,rd,swi,tab,tabs,alert,section,chevron,pager,seg,pill,dot,divider,table,shell,fitShell,overlay,dlg,actions,drawerBox,sheetBox,fullDlg,monthGrid,nov,oct,rcell,headCell,tlBlock,sec,put,note,byName,del,W,H,legend,autoMark,punchMark" +
      (withRoster
        ? ",rosterGrid,legendRow,toolbar,checkPanelBody,ROSTER_LEGEND,STATS_W,NARROW_W"
        : "") +
      "};",
  )();
}

// ---------------------------------------------------------------------------
// PART base:Base Draft 頁(41:5914)最下方的底座草稿 Draft/ScheduleTimelineBlock、Draft/ScheduleTimeline、BS-22、BS-23。
// 只綁底座變數;表頭用現有 Draft/TableHeaderCell(14:1339);區塊文字不截斷、元件不裁切;示範文字中性(櫃台 A、早班)。
// 程式同本輪實際執行(見對話紀錄 259:4770 / 269:7083 / 269:7084 / 260:6356),要點:
//   - ScheduleTimelineBlock 變體:State = Normal / Short / Warning / Empty / Disabled × Auto = True / False(Disabled 沒有 Auto);
//     屬性 Title、Subtitle;Normal / Short 綁 primary/lighter + 左邊條 primary/main,Warning 綁 warning/lighter + warning/main,
//     Empty 綁 error/lighter + error/main,Disabled 綁 grey/200;圓角 radius/sm。
//   - ScheduleTimeline 變體:Mode=Day(列標題 120 + 06:00~24:00 每小時 48)、Mode=Week(7 天 × 150,08~22 每小時 40)。
if (PART === "base") {
  throw new Error(
    "PART base 的程式見本輪紀錄;Base Draft 由底座重做 agent 統一維護,重建時照 README 重建步驟。",
  );
}

// ---------------------------------------------------------------------------
// PART my:我的班表 · 班表與打卡(SC-01 / 25 / 32 / 38 / 40)+ SC-39 當天詳情
if (PART === "my") {
  const K = await load(false);
  const {
    T,
    TW,
    add,
    sp,
    row,
    col,
    card,
    box,
    btn,
    alert,
    section,
    pager,
    seg,
    pill,
    monthGrid,
    nov,
    shell,
    fitShell,
    put,
    setTxt,
    overlay,
    dlg,
    sheetBox,
    actions,
  } = K;
  // 第二十四輪後續之九:和排班作業 11 月王小明的實際排班一致(班數 20、負責 12、畫休 2 天;11/2 08:00–14:30 比需求早 30 分)
  // [班別, 時間, 負責];11/3 店休、11/6 / 11/22 畫休
  const SHIFT = {
    1: ["早", "08:30–14:30", 1],
    2: ["早", "08:00–14:30", 1],
    4: ["晚", "14:30–22:00", 1],
    5: ["早", "08:30–14:30", 1],
    7: ["早", "08:30–14:30", 1],
    8: ["早", "08:30–14:30", 1],
    9: ["晚", "14:30–22:00", 1],
    10: ["早", "08:30–14:30"], // 11/10 早班 5 人之一(陳大文負責)
    11: ["早", "08:30–14:30", 1],
    12: ["晚", "14:30–22:00", 1],
    13: ["晚", "14:30–22:00"],
    14: ["晚", "14:30–22:00"],
    16: ["早", "08:30–14:30", 1],
    17: ["早", "08:30–14:30"],
    18: ["晚", "14:30–22:00"],
    19: ["早", "08:30–14:30", 1],
    21: ["晚", "14:30–22:00"],
    24: ["晚", "14:30–22:00"],
    26: ["早", "08:30–14:30"],
    30: ["早", "08:30–14:30", 1],
  };
  const CLOSED = { 3: true };
  // 打卡(遲到 / 早退依上面的時間判斷);11/2、11/4 缺下班卡
  const PUNCH = { 1: "08:24 / 14:36", 2: "07:56 / —", 4: "14:24 / —" };
  const PUNCH_PAST = {
    5: "08:26 / 14:33",
    7: "08:22 / 14:35",
    8: "08:25 / 14:40",
    9: "14:21 / —",
    10: "08:24 / 14:35",
    11: "08:27 / 14:31",
    12: "14:22 / 22:05",
    13: "14:25 / 22:03",
    14: "14:26 / —",
  };
  const OFF = { 9: true, 22: true };
  const days = (sz, noToday) =>
    nov((d) => {
      if (d < 0) return {};
      const o = { lines: [] };
      // SC-32「今天沒有排班」的今天是 11/15(王小明這天沒有班);11/5–11/14 已是過去,補上打卡(11/9、11/14 缺下班卡)
      if (d === (noToday ? 15 : 5)) o.today = true;
      if (OFF[d]) o.lines.push("畫休");
      if (CLOSED[d]) o.lines.push("店休");
      const s = SHIFT[d];
      // 負責的班用綠色班別標籤(Draft/LeadTag);手機只寫班別
      if (s) o.lines.push(sz === "M" ? s[0] : s[0] + " " + s[1]);
      if (s) o.lead = !!s[2];
      const pp = noToday ? { ...PUNCH, ...PUNCH_PAST } : PUNCH;
      if (pp[d] && sz !== "M") o.lines.push(pp[d]);
      if (d === 8 || d === 12) o.dot = "pm";
      if (d === 11) {
        o.bg = "sday"; // 特殊日:行事曆設定的顏色(tagPalettes cyan)
        if (sz !== "M") o.lines.push("店慶");
      }
      return o;
    });
  async function cal(sz, w, noToday) {
    const c = await card("月曆", sz === "M" ? 12 : 16, 12);
    const hd = row(8, "head");
    add(hd, await pager("2026 年 11 月", sz === "M" ? "sub2" : "sub1"));
    sp(hd);
    add(hd, await seg(["月曆", "條列"], 0, "月曆 | 條列"));
    add(c, hd, "FILL");
    const cw = Math.floor((w - (sz === "M" ? 24 : 32)) / 7);
    const ds = days(sz, noToday);
    // 缺卡:三尺寸都在日期右上角放紅點(error/main),圖例「● 缺卡」;點那一天打開 SC-39 當天詳情
    for (const x of ds)
      if ((x.d === "2" || x.d === "4") && !x.out) {
        const e = figma.createEllipse();
        e.resize(sz === "M" ? 6 : 8, sz === "M" ? 6 : 8);
        e.fills = [await K.P("em")];
        e.name = "dot-missed";
        x.badge = e;
      }
    add(
      c,
      await monthGrid(ds, cw, sz === "M" ? 54 : 64, {
        name: "MonthCalendar(組成)",
        hug: true,
      }),
    );
    const lg = row(12, "legend");
    lg.layoutWrap = "WRAP";
    lg.counterAxisSpacing = 4;
    const L =
      sz === "M"
        ? [
            "★ 負責人",
            "休 = 畫休",
            "● 有異動",
            "● 缺卡",
            "點一天看當天詳細資料",
          ]
        : [
            "★ 負責人",
            "休 = 畫休",
            "08:24 / 14:36 = 上班 / 下班打卡",
            "● 有異動",
            "● 缺卡",
            "底色 = 特殊日",
          ];
    for (const s of L)
      add(
        lg,
        await T(
          s,
          "cap",
          s === "● 缺卡" ? "em" : s === "● 有異動" ? "pm" : "ts",
        ),
      );
    add(c, lg, "FILL");
    return c;
  }
  async function banner(expanded) {
    const b = await box("最近異動", "il", 12, 8, "md");
    const r = row(8, "head");
    add(r, await T("你的班表有 2 項異動", "sub2", "idk"));
    sp(r);
    add(r, await btn(expanded ? "收合" : "展開", "Text"));
    add(b, r, "FILL");
    if (expanded)
      for (const [d, a, why] of [
        ["11/8(日)", "晚 14:30–22:00 → 早 08:30–14:30", "換班"],
        ["11/12(四)", "新增 晚 14:30–22:00", "臨時請假 · 補人"],
      ]) {
        const l = row(12, "change");
        l.layoutWrap = "WRAP";
        l.counterAxisSpacing = 4;
        add(l, await T(d, "sub2"));
        add(l, await T(a, "body2"));
        add(l, await T("原因:" + why, "cap", "ts"));
        add(b, l, "FILL");
      }
    return b;
  }
  async function todayCard(after) {
    const c = await card("今天的班", 16, 8);
    add(c, await T("今天 11/5(四)· 08:30–14:30", "sub1"));
    add(c, await T("中山店 · 店內櫃台 · ☕ 30 · 負責人", "body2", "ts"));
    if (after) add(c, await T("上班 08:26 已打卡", "cap", "sm"));
    const r = row(8, "buttons");
    add(
      r,
      await btn(
        "打上班卡",
        after ? "Outlined" : "Contained",
        "Medium",
        "Primary",
        after ? "Disabled" : "Default",
      ),
      "FILL",
    );
    add(
      r,
      await btn("打下班卡", after ? "Contained" : "Outlined", "Medium"),
      "FILL",
    );
    add(c, r, "FILL");
    return c;
  }
  async function yCard() {
    const c = await card("昨天未打下班卡", 16, 8);
    add(c, await T("昨天 11/4(三)未打下班卡", "sub2", "wd"));
    add(c, await T("中山店 晚 14:30–22:00 · 店內櫃台 · 負責人", "body2", "ts"));
    add(c, await btn("打下班卡", "Outlined", "Medium"), "FILL");
    return c;
  }
  async function noShift(expanded) {
    const s = await section(
      "沒有排班",
      expanded ? "臨時被叫來幫忙,可以在這裡打卡" : "沒有排到班但臨時來上班?",
      expanded ? "Expanded" : "Collapsed",
    );
    if (expanded) {
      const slot = s.findOne((n) => n.type === "SLOT");
      for (const k of [...slot.children]) k.remove(); // 拿掉 Section 預設的佔位文字
      const r = col(8, "punch");
      add(r, await T("分店:中山店", "body2", "ts"));
      const b = row(8, "buttons");
      add(b, await btn("打上班卡", "Contained", "Medium"), "FILL");
      add(b, await btn("打下班卡", "Outlined", "Medium"), "FILL");
      add(r, b, "FILL");
      slot.appendChild(r);
      r.layoutSizingHorizontal = "FILL";
    }
    return s;
  }
  async function remind() {
    const a = await alert(
      "最近 7 天有 2 班打卡不完整:11/2、11/4 缺下班卡",
      "Warning",
      true,
    );
    const t = a
      .findAll((x) => x.type === "TEXT")
      .find((x) => x.characters === "重試");
    if (t) await setTxt(a, t.name, "申請補卡");
    return a;
  }
  async function listMode() {
    const c = await card("條列", 12, 0);
    const hd = row(8, "head");
    add(hd, await pager("2026 年 11 月", "sub2"));
    sp(hd);
    add(hd, await seg(["月曆", "條列"], 1, "月曆 | 條列"));
    add(c, hd, "FILL");
    for (const [d, a, b2, bad] of [
      [
        "11/2(一)",
        "中山店 早 08:00–14:30 ☕ 30 · 負責人",
        "上班 07:56 · 下班 —",
        true,
      ],
      ["11/3(二)", "店休", "", false],
      [
        "11/4(三)",
        "中山店 晚 14:30–22:00 ☕ 30 · 負責人",
        "上班 14:24 · 下班 —",
        true,
      ],
      ["11/5(四)今天", "中山店 早 08:30–14:30 ☕ 30 · 負責人", "", false],
      ["11/6(五)", "畫休", "", false],
      ["11/7(六)", "中山店 早 08:30–14:30 ☕ 30 · 負責人", "", false],
      ["11/8(日)", "中山店 早 08:30–14:30 ☕ 30 · 負責人", "有異動", false],
    ]) {
      const r = row(8, "day-row", "MIN");
      r.paddingTop = r.paddingBottom = 10;
      r.strokes = [await K.P("divider")];
      r.strokeTopWeight = r.strokeLeftWeight = r.strokeRightWeight = 0;
      r.strokeBottomWeight = 1;
      const left = await T(d, "sub2", d.includes("今天") ? "pm" : "tp");
      left.textAutoResize = "HEIGHT";
      add(r, left);
      left.resize(96, left.height);
      const mid = col(2, "info");
      add(mid, await T(a, "body2"));
      if (b2) add(mid, await T(b2, "cap", b2 === "有異動" ? "pm" : "ts"));
      add(r, mid, "FILL");
      if (bad) add(r, await pill("缺下班卡"));
      add(c, r, "FILL");
    }
    return c;
  }
  const built = {};
  async function build(code, title, sz, v) {
    const nm =
      sz === "D"
        ? `${code} 我的班表:${title}`
        : `${code} · ${sz === "T" ? "平板" : "手機"} 我的班表:${title}`;
    const { f, c } = await shell("my", sz, nm);
    add(c, await K.tabs(["班表", "我的畫休"], 0), "FILL");
    if (v !== "list") add(c, await banner(v === "banner"), "FILL");
    const cards = [await remind()];
    if (v !== "noshift") cards.push(await todayCard(v === "after"));
    cards.push(await yCard());
    cards.push(await noShift(v === "noshift"));
    const innerW = sz === "D" ? 1152 : sz === "T" ? 926 : 358;
    const mainEl =
      v === "list"
        ? await listMode()
        : await cal(sz, sz === "D" ? 736 : innerW, v === "noshift");
    if (sz === "D") {
      const b = row(16, "body", "MIN");
      const L = col(12, "punch");
      for (const p of cards) add(L, p, "FILL");
      add(b, L);
      L.layoutSizingHorizontal = "FIXED";
      L.resize(400, L.height);
      add(b, mainEl, "FILL");
      add(c, b, "FILL");
    } else {
      for (const p of cards) add(c, p, "FILL");
      add(c, mainEl, "FILL");
    }
    fitShell(f, K.H[sz]);
    put(sz, f);
    built[code + sz] = f;
  }
  for (const sz of ["D", "T", "M"])
    for (const [code, title, v] of [
      ["SC-01", "班表與打卡(今天的班 + 月曆)", "base"],
      ["SC-25", "打上班卡之後", "after"],
      ["SC-32", "今天沒有排班", "noshift"],
      ["SC-38", "最近異動展開", "banner"],
      ["SC-40", "條列模式", "list"],
    ])
      await build(code, title, sz, v);
  for (const sz of ["D", "T", "M"]) {
    const body = async (d) => {
      add(
        d,
        await T("中山店 · 早 08:00–14:30 · 店內櫃台 · ☕ 30 · 負責人", "body2"),
        "FILL",
      );
      add(
        d,
        await K.table(
          [{ h: "打卡", w: 80 }, { h: "時間" }, { h: "", w: 96 }],
          [
            ["上班", "07:56"],
            ["下班", await T("—", "body2", "ts"), await pill("缺下班卡")],
          ],
          "打卡紀錄",
        ),
        "FILL",
      );
      add(
        d,
        await TW(
          "下班卡沒有打。可以申請補卡,由店長審核。",
          sz === "M" ? 326 : 400,
          "cap",
          "ts",
        ),
      );
    };
    let panel, kind;
    if (sz === "M") {
      panel = await sheetBox("11/2(一)當天詳情");
      await body(panel);
      add(panel, await btn("申請補卡", "Contained", "Medium"), "FILL");
      kind = "sheet";
    } else {
      panel = await dlg("11/2(一)當天詳情", 480);
      await body(panel);
      add(
        panel,
        await actions([
          await btn("關閉", "Text", "Medium"),
          await btn("申請補卡", "Contained", "Medium"),
        ]),
        "FILL",
      );
      kind = "dialog";
    }
    put(
      sz,
      await overlay(
        built["SC-01" + sz],
        sz === "D"
          ? "SC-39 Overlay / 月曆點一天:當天詳情"
          : `SC-39 · ${sz === "T" ? "平板" : "手機"} 月曆點一天:當天詳情`,
        panel,
        kind,
        sz,
      ),
    );
  }
}

// dayoff、roster 兩段在 r5-schedule-parts.js;views、dialogs、auto、manage、settings、att、store 與版面整理沒有存成可重跑的腳本,
// 以 Figma 為準(README「以 Figma 為準的畫面」列了原因)。畫完後跑 brand-rebind.js(PAGE_ID = "70:14")補綁專案色。
