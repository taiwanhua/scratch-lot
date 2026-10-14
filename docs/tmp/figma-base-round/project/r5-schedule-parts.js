// ==== 第十九輪:班表管理頁重做的其餘段落(接 r5-schedule.js 的 load())====
// PART:dayoff → roster。其餘段落以 Figma 為準(見 r5-schedule.js 結尾)。
// 每段開頭的 load() 同 r5-schedule.js;roster / views / dialogs / auto 需要 r5-roster.js(load(true))。
// 示範資料:我的班表 11 月(今天 11/5)、我的畫休 12 月(開放 11/15–11/25)、排班作業中山店 11 月草稿(11/3、11/17 店休,11/11 特殊日)。
const PART = "dayoff";
const AF = Object.getPrototypeOf(async function () {}).constructor;
async function load(withRoster) {
  const KIT = (await figma.getNodeByIdAsync("261:57906")).characters;
  const RO = withRoster
    ? (await figma.getNodeByIdAsync("271:15918")).characters
    : "";
  return await new AF(
    KIT +
      "\n" +
      RO +
      "\nreturn {PAGE,P,fill,stroke,rad,T,TW,AL,add,sp,row,col,card,box,inst,btn,tag,setTxt,selF,tf,cb,rd,swi,tab,tabs,alert,section,chevron,pager,seg,pill,dot,divider,table,shell,fitShell,overlay,dlg,actions,drawerBox,sheetBox,fullDlg,monthGrid,nov,oct,rcell,headCell,tlBlock,sec,put,note,byName,del,W,H" +
      (withRoster ? ",rosterGrid,legendRow,toolbar,checkPanelBody" : "") +
      "};",
  )();
}
const SZN = { T: "平板", M: "手機" };
const r2 = (K, a, b) => {
  const r = K.row(12, "fields", "MIN");
  K.add(r, a, "FILL");
  K.add(r, b, "FILL");
  return r;
};
// 12 月(12/1 是星期二)
function dec(f) {
  const out = [];
  for (let i = 0; i < 35; i++) {
    const d = i - 1;
    if (d < 1) out.push({ d: String(29 + i), out: true });
    else if (d <= 31) out.push({ d: String(d), ...f(d) });
    else out.push({ d: String(d - 31), out: true });
  }
  return out;
}

// ---------------------------------------------------------------------------
// PART dayoff:我的畫休 SC-02(開放期間內)/ SC-23(開放期間外)/ SC-41 時段不可排 / SC-42 當天畫休詳細
if (PART === "dayoff") {
  const K = await load(false);
  const {
    T,
    TW,
    add,
    sp,
    row,
    box,
    btn,
    alert,
    seg,
    monthGrid,
    shell,
    fitShell,
    put,
    overlay,
    dlg,
    sheetBox,
    actions,
    fullDlg,
    tf,
  } = K;
  const MINE = { 7: 1, 14: 1, 21: 1 };
  const COUNT = {
    5: "1/2",
    7: "1/2",
    12: "2/2",
    14: "1/2",
    19: "1/2",
    21: "2/2",
    24: "2/2",
    25: "1/2",
  };
  const SLOT = { 10: "09–13 不可排" };
  async function band(k, w) {
    const r = figma.createRectangle();
    r.resize(w, 4);
    r.cornerRadius = 2;
    r.fills = [await K.P(k)];
    r.name = "rule-band";
    return r;
  }
  async function cal(sz, w, ro) {
    const c = await K.card("月曆", sz === "M" ? 12 : 16, 12);
    const hd = row(8, "head");
    add(hd, await T("2026 年 12 月", sz === "M" ? "sub2" : "sub1"));
    sp(hd);
    if (!ro) add(hd, await seg(["整天畫休", "時段不可排"], 0, "點日期"));
    add(c, hd, "FILL");
    const cw = Math.floor((w - (sz === "M" ? 24 : 32)) / 7);
    const ds = dec((d) => {
      const o = { lines: [] };
      if (MINE[d]) {
        o.sel = true;
        o.lines.push("休");
      }
      if (SLOT[d]) o.lines.push(sz === "M" ? "不可排" : SLOT[d]);
      if (COUNT[d]) o.cnt = COUNT[d];
      if (d >= 13 && d <= 18) o.bandK = "wm";
      if (d === 24) o.bandK = "em";
      if (d === 25) o.bg = "il";
      return o;
    });
    for (const x of ds)
      if (x.cnt)
        x.lines.push(
          await T(x.cnt, "capSB", x.cnt === "2/2" ? "wd" : "ts", "count"),
        );
    if (sz !== "M")
      for (const x of ds)
        if (x.d === "24" && !x.out) x.badge = await T("ⓘ", "cap", "ts", "info");
    const g = await monthGrid(ds, cw, sz === "M" ? 54 : 70, {
      name: "MonthCalendar(組成)",
      hug: true,
    });
    let i = 0;
    for (const d of g.findAll((n) => n.name === "day")) {
      const x = ds[i++];
      if (x && x.bandK) add(d, await band(x.bandK, cw - 12), "FILL");
    }
    add(c, g);
    const lg = row(12, "legend");
    lg.layoutWrap = "WRAP";
    lg.counterAxisSpacing = 4;
    for (const s of [
      "休 = 我的畫休",
      "2/2 = 同日畫休人數(滿了橘色)",
      "底部色帶:橘 = 警告、紅 = 擋下",
      "不可排 = 時段不可排",
      "ⓘ 看當天誰畫休",
    ])
      add(lg, await T(s, "cap", "ts"));
    add(c, lg, "FILL");
    return c;
  }
  async function stats(ro) {
    const b = await box("統計列", ro ? "def" : "il", 12, 6, "md");
    const r = row(16, "row");
    r.layoutWrap = "WRAP";
    r.counterAxisSpacing = 4;
    add(
      r,
      await T(
        ro
          ? "12 月的畫休 · 登記期間 11/15–11/25 已結束"
          : "登記 12 月的畫休 · 開放中 11/15–11/25(剩 6 天)",
        "sub2",
        ro ? "ts" : "idk",
      ),
    );
    add(r, await T("已畫 3 天 · 上限 8 · 下限 4", "body2"));
    add(b, r, "FILL");
    return b;
  }
  async function vio() {
    const c = await K.card("違反規則", 16, 8);
    add(c, await T("違反規則(2)", "sub2"));
    for (const [t, lv, k] of [
      ["12/13–12/18 最多連續上班 6 天:這段會連續上 7 天", "警告", "Warning"],
      ["12/24 同日最多畫休 2 人:已滿,不能再畫", "擋下", "Error"],
    ]) {
      const r = row(8, "item");
      add(r, await K.tag(lv, k));
      const tx = await T(t, "body2");
      add(r, tx, "FILL");
      tx.textAutoResize = "HEIGHT";
      add(r, await btn("定位", "Text"));
      add(c, r, "FILL");
    }
    return c;
  }
  const built = {};
  for (const sz of ["D", "T", "M"])
    for (const [code, title, ro] of [
      ["SC-02", "我的畫休(開放期間內)", false],
      ["SC-23", "我的畫休(開放期間外)", true],
    ]) {
      const nm =
        sz === "D"
          ? `${code} 我的班表:${title}`
          : `${code} · ${SZN[sz]} 我的班表:${title}`;
      const { f, c } = await shell("my", sz, nm);
      add(c, await K.tabs(["班表", "我的畫休"], 1), "FILL");
      if (ro)
        add(
          c,
          await alert(
            "畫休登記期間(11/15~11/25)已結束,不能自己修改。要調整請聯絡店長或排班負責人。",
            "Info",
            false,
          ),
          "FILL",
        );
      add(c, await stats(ro), "FILL");
      const innerW = sz === "D" ? 1152 : sz === "T" ? 926 : 358;
      if (sz === "D") {
        const b = row(16, "body", "MIN");
        add(b, await cal(sz, 800, ro));
        add(b, await vio(), "FILL");
        add(c, b, "FILL");
      } else {
        add(c, await cal(sz, innerW, ro), "FILL");
        add(c, await vio(), "FILL");
      }
      fitShell(f, K.H[sz]);
      put(sz, f);
      built[code + sz] = f;
    }
  for (const sz of ["D", "T", "M"]) {
    const bg = built["SC-02" + sz];
    const fields = async (p) => {
      add(
        p,
        await TW(
          "時段不可排只讓排班避開這段時間,不算畫休天數,也不算同日畫休人數。",
          sz === "M" ? 326 : 432,
          "cap",
          "ts",
        ),
      );
      const r1 = row(8, "segment");
      add(r1, await T("已登記 09:00–13:00", "body2"));
      sp(r1);
      add(r1, await btn("刪除", "Text", "Small", "Error"));
      add(p, r1, "FILL");
      add(
        p,
        r2(K, await tf("開始", "18:00"), await tf("結束", "22:00")),
        "FILL",
      );
      add(p, await btn("+ 再加一段", "Text"));
    };
    if (sz === "M") {
      const { f, body } = await fullDlg("12/10(四)時段不可排", "儲存");
      await fields(body);
      put("M", await overlay(bg, "SC-41 · 手機 時段不可排", f, "full", "M"));
    } else {
      const d = await dlg("12/10(四)時段不可排", 480);
      await fields(d);
      add(
        d,
        await actions([
          await btn("取消", "Text", "Medium"),
          await btn("儲存", "Contained", "Medium"),
        ]),
        "FILL",
      );
      put(
        sz,
        await overlay(
          bg,
          sz === "D" ? "SC-41 Overlay / 時段不可排" : "SC-41 · 平板 時段不可排",
          d,
          "dialog",
          sz,
        ),
      );
    }
    const info = async (p) => {
      add(p, await T("畫休(2/2 已滿)", "sub2"));
      add(p, await T("李小華、陳大文", "body2"));
      add(p, await T("時段不可排", "sub2"));
      add(p, await T("王小明 18:00–22:00", "body2"));
      add(p, await T("涉及的規則", "sub2"));
      const r = row(8, "rule");
      add(r, await K.tag("擋下", "Error"));
      add(r, await T("同日最多畫休 2 人", "body2"));
      add(p, r);
    };
    if (sz === "M") {
      const s = await sheetBox("12/24(四)");
      await info(s);
      put("M", await overlay(bg, "SC-42 · 手機 當天畫休詳細", s, "sheet", "M"));
    } else {
      const d = await dlg("12/24(四)", 400, 10);
      await info(d);
      add(d, await actions([await btn("關閉", "Text", "Medium")]), "FILL");
      put(
        sz,
        await overlay(
          bg,
          sz === "D"
            ? "SC-42 Overlay / 當天畫休詳細"
            : "SC-42 · 平板 當天畫休詳細",
          d,
          "dialog",
          sz,
        ),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// PART roster:排班表頁(SC-03 班表檢視、SC-18 檢核面板、SC-33 只能檢視、SC-35 沒有人力需求、SC-15b 已發布、SC-20b 自動排班完成)
// 電腦凍結欄 138、7 天 × 108 + 統計欄 4 × 64;檢核面板開著時只放 6 天(× 106),面板寬 360。
// 平板凍結欄 112、7 天 × 116(面板開著時 4 天);手機凍結欄 80(顯示「需求 / 已排」)、3 天 × 92,左右捲動。
// 手機的檢核面板是不遮擋的底部面板,直接疊在班表檢視上(SC-18 / SC-20b · 手機 …(底部面板,不遮擋))。
if (PART === "roster") {
  const K = await load(true);
  const {
    T,
    TW,
    add,
    sp,
    row,
    col,
    card,
    btn,
    shell,
    fitShell,
    put,
    sheetBox,
    rosterGrid,
    legendRow,
    toolbar,
    checkPanelBody,
  } = K;
  const TABS = ["排班表", "畫休總覽", "行事曆", "支援需求單"];
  const LEG = [
    "★ 負責人",
    "臨 = 一次性的人力需求",
    "自動 = 自動排入(手動改過就消失)",
    "灰底 = 店休 / 已排於其他分店 / 時段不可排",
    "藍字 +1 = 超過人力需求",
    "淡藍底 = 畫休",
  ];
  const V = {
    "SC-03": { t: "排班表:班表檢視(草稿)", o: {} },
    "SC-18": { t: "排班表:檢核面板展開", o: { panel: true } },
    "SC-33": { t: "排班表:只能檢視(沒有編輯權限)", o: { readonly: true } },
    "SC-35": {
      t: "排班表:這個月還沒有人力需求",
      o: { empty: true, checkLabel: "檢核 ✓", checkOk: true },
    },
    "SC-15b": { t: "排班表:已發布", o: { published: true } },
    "SC-20b": {
      t: "自動排班完成:檢核面板自動展開",
      o: { panel: true, auto: true },
    },
  };
  let mob03 = null;
  for (const sz of ["D", "T", "M"])
    for (const [code, v] of Object.entries(V)) {
      const o = v.o;
      if (sz === "M" && o.panel) {
        const f = mob03.clone();
        f.name = `${code} · 手機 ${o.auto ? "自動排班完成:檢核面板(底部面板,不遮擋)" : "檢核面板(底部面板,不遮擋)"}`;
        for (const b of f.findAll(
          (n) => n.type === "INSTANCE" && n.name.startsWith("Button 檢核"),
        ))
          b.setProperties({ Variant: "Contained" });
        const s = await sheetBox(o.auto ? "檢核(自動排班完成)" : "檢核");
        await checkPanelBody(s, { auto: o.auto });
        f.appendChild(s);
        s.layoutPositioning = "ABSOLUTE";
        s.x = 0;
        s.y = Math.max(240, f.height - s.height);
        s.resize(390, f.height - s.y);
        put("M", f);
        continue;
      }
      const nm =
        sz === "D"
          ? `${code} 排班作業:${v.t}`
          : `${code} · ${SZN[sz]} 排班作業:${v.t}`;
      const { f, c } = await shell("manage", sz, nm);
      add(c, await K.tabs(TABS, 0), "FILL");
      add(c, await toolbar(sz, o), "FILL");
      let mainEl;
      if (o.empty) {
        mainEl = await card("沒有人力需求", 32, 12);
        mainEl.counterAxisAlignItems = "CENTER";
        add(mainEl, await T("11 月還沒有人力需求", "h6"));
        add(
          mainEl,
          await TW(
            "先套用人力需求範本或週範本建立這個月的人力需求,再排人或使用自動排班。",
            sz === "M" ? 290 : 420,
            "body2",
            "ts",
          ),
        );
        add(mainEl, await btn("套用範本", "Contained", "Medium"));
      } else {
        let frozen, colW, days, stats;
        if (sz === "D") {
          frozen = 138;
          stats = !o.panel;
          days = o.panel ? 6 : 7;
          colW = o.panel ? 106 : 108;
        } else if (sz === "T") {
          frozen = 112;
          stats = false;
          days = o.panel ? 4 : 7;
          colW = o.panel ? 119 : 116;
        } else {
          frozen = 80;
          stats = false;
          days = 3;
          colW = 92;
        }
        const g = await rosterGrid(colW, frozen, days, stats, {
          published: o.published,
        });
        const left = col(8, "roster");
        add(left, g);
        if (sz !== "D" || o.panel)
          add(left, await T("← 左右捲動看整個月 →", "cap", "ts"));
        add(left, await legendRow(sz === "M" ? LEG.slice(0, 4) : LEG), "FILL");
        if (o.panel) {
          const b = row(16, "body", "MIN");
          add(b, left, "FILL");
          const p = await card("檢核面板", 16, 12);
          const hd = row(8, "head");
          add(hd, await T("檢核", "h6"));
          sp(hd);
          add(hd, await T("✕", "sub1", "ts", "close"));
          add(p, hd, "FILL");
          await checkPanelBody(p, { auto: o.auto });
          add(b, p);
          p.layoutSizingHorizontal = "FIXED";
          p.resize(sz === "D" ? 360 : 320, p.height);
          mainEl = b;
        } else mainEl = left;
      }
      add(c, mainEl, "FILL");
      fitShell(f, K.H[sz]);
      put(sz, f);
      if (sz === "M" && code === "SC-03") mob03 = f;
    }
}
