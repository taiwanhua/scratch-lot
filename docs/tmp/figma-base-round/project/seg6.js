// 第二輪:班表管理(SC)與 58mm 單據(RC)。專案規格 16.8~16.9。
// 前置:`const PROJECT = true; const PART = "SC1" | "SC2" | "RC";` + ../_kit.js + seg4.js 的 ovRow / dcard / docHead + 本檔。
const tabsMgr = ["排班表", "畫休總覽", "行事曆"];
const tabsSet = ["人力需求範本", "人力需求週範本", "排班人員", "規則"];
const tabsAtt = ["依人員(月)", "依分店(日)"];

if (PART === "SC1") {
  await figma.setCurrentPageAsync(await figma.getNodeByIdAsync("70:14"));
  const Y = await rowY("第二輪:班表管理(SC-01~06)");
  // SC-01 我的班表:班表 + 打卡(手機)
  {
    const d = await device(
      "SC-01 我的班表:班表 + 打卡(手機寬度)",
      390,
      844,
      "我的班表",
    );
    add(d.content, await tabs(["班表", "我的畫休"], "班表"), "FILL");
    add(
      d.content,
      await alert(
        "最近 7 天有 1 天打卡不完整(10/14 下班)。[申請補卡]",
        "Warning",
      ),
      "FILL",
    );
    const today = add(d.content, await card("today", 8, 16), "FILL");
    add(today, await T("今天 10/16(四)", "Subtitle/2", "text/secondary"));
    add(today, await T("中山店 09:00–17:00", "Subtitle/1"));
    add(today, await T("店內櫃台 · 負責人", "Body/2", "text/secondary"));
    await put(add(today, H(8), "FILL"), [
      await btn("上班 09:02 ✓", "Outlined", "Primary", "Disabled"),
      await btn("下班打卡"),
    ]);
    const y = add(d.content, await card("yesterday", 8, 16), "FILL");
    add(y, await T("昨天 10/15(三)未打下班卡", "Subtitle/2", "warning/main"));
    add(
      y,
      await T("新竹店 13:00–21:00 · 補貨 · 協同", "Body/2", "text/secondary"),
    );
    add(y, await btn("下班打卡", "Outlined"), "FILL");
    add(
      d.content,
      await section("沒有排班", [], {
        collapsed: true,
        summary: "今天有班時收合",
      }),
      "FILL",
    );
    await cap(
      d.content,
      "跨店不限;上班取最早、下班取最晚;缺卡不存,顯示時計算。",
    );
    done(d.s, Y);
  }
  // SC-02 我的畫休
  {
    const sh = await shell(
      "SC-02 我的班表:我的畫休",
      "我的班表",
      "我的班表",
      "我的班表",
    );
    add(sh.content, await tabs(["班表", "我的畫休"], "我的畫休"), "FILL");
    const body = add(
      sh.content,
      H(16, { name: "body", counterAxisAlignItems: "MIN" }),
      "FILL",
    );
    add(body, (await node("MonthCalendar")).createInstance());
    const r = add(body, await card("day-off-panel", 10), "FILL");
    add(r, await T("2026 年 11 月畫休", "Subtitle/1"));
    add(r, await kv("開放期間", "10/01 ~ 10/20(截止前一天會通知)"), "FILL");
    add(r, await kv("本月已畫", "3 / 最多 8 天(最少 4 天)"), "FILL");
    add(r, await kv("已選", "11/03、11/10、11/24"), "FILL");
    add(
      r,
      await alert("11/10 已有 2 人畫休(同日最多 2 人),不能再選。", "Warning"),
      "FILL",
    );
    await cap(
      r,
      "符合規則才存,不需要核准;截止後由有代改權限的人代改,原因必填。日曆格顯示每天已有幾人畫休。",
    );
    add(r, await actions([await btn("儲存")]), "FILL");
    done(sh, Y);
  }
  // SC-04 編輯排班 / 職責
  {
    const { ov, dlg } = await overlay(
      "SC-04 Overlay / 編輯排班與職責(發布後要選異動原因)",
      560,
    );
    await dhead(dlg, "編輯排班 · 李小華 10/14(三)");
    add(
      dlg,
      await grid(
        [
          await select("分店", "中山店", null),
          await field("上班", "09:00"),
          await field("下班", "17:00"),
          await field("休息(分)", "60"),
        ],
        4,
      ),
      "FILL",
    );
    add(dlg, await T("職責", "Subtitle/2"));
    add(
      dlg,
      await table(
        [
          ["人力需求", 220],
          ["崗位(收銀點)", 160],
          ["職責", 120],
        ],
        [
          ["08:00–16:00", "櫃台(店內櫃台)", await select("", "負責人", 110)],
          ["10:00–14:00", "補貨", await select("", "協同", 110)],
        ],
      ),
      "FILL",
    );
    add(
      dlg,
      await alert(
        "警告:李小華本月已連續上班 6 天(規則 最多連續上班 6 天)。",
        "Warning",
      ),
      "FILL",
    );
    add(dlg, await select("異動原因(已發布,必填)", "人員請假", null), "FILL");
    add(dlg, await field("說明", "原排的人臨時請假"), "FILL");
    add(
      dlg,
      await actions(
        [await btn("儲存")],
        [await btn("刪除這班", "Text", "Error"), await btn("取消", "Text")],
      ),
      "FILL",
    );
    fitOv(ov, dlg);
    done({ ov }, Y);
  }
  // SC-05 自動排班、發布
  {
    const { ov, row, fin } = await ovRow("SC-05 Overlay / 自動排班、發布");
    const a = await dcard(row, "自動排班 · 2026 年 11 月", 480);
    add(
      a,
      await T("條件(可勾選並排序;都不勾則隨機)", "Body/2", "text/secondary"),
    );
    for (const [l, on] of [
      ["1. 延續同一人的排班", true],
      ["2. 負責人次數多者優先", true],
      ["3. 本月班數平均", false],
    ])
      add(a, await check(l, on));
    add(a, await T("方式", "Body/2", "text/secondary"));
    for (const [l, on] of [
      ["只填空位", true],
      ["重排自動排入的人", false],
      ["全部重排(會再確認)", false],
    ])
      add(a, await radio(l, on));
    add(
      a,
      await alert(
        "填入 28 格;3 格填不滿:11/10 補貨(沒有可排的人:2 人畫休、1 人已連續上班 6 天)…",
        "Info",
      ),
      "FILL",
    );
    await cap(a, "只填人力需求;只能在草稿;畫休、店休、擋下的規則一定遵守。");
    add(
      a,
      await actions(
        [await btn("執行")],
        [await btn("清除自動排入的人", "Text", "Error")],
      ),
      "FILL",
    );
    const b = await dcard(row, "發布 · 2026 年 11 月", 420);
    add(b, await kv("擋下", "0"), "FILL");
    add(
      b,
      await kv("警告", "2(連續上班、人力不足)", { color: "warning/main" }),
      "FILL",
    );
    await cap(b, "發布後通知被排到的人;之後的異動要選原因並通知當事人。");
    add(
      b,
      await actions([await btn("取消", "Text"), await btn("發布")]),
      "FILL",
    );
    fin();
    done({ ov }, Y);
  }
  // SC-06 畫休總覽
  {
    const sh = await shell(
      "SC-06 排班作業:畫休總覽",
      "排班作業",
      "排班作業",
      "排班作業",
    );
    add(
      sh.content,
      await filters([
        await select("分店", "中山店", 220),
        await select("月份", "2026 年 11 月", 180),
      ]),
      "FILL",
    );
    add(sh.content, await tabs(tabsMgr, "畫休總覽"), "FILL");
    const days = [
      "11/03",
      "11/04",
      "11/05",
      "11/06",
      "11/07",
      "11/08",
      "11/09",
      "11/10",
    ];
    const off = (b) => (b ? tag("休", "Primary") : T(""));
    add(
      sh.content,
      await table(
        [["人員", 140], ...days.map((d) => [d, 80]), ["本月", 80]],
        [
          [
            "王小明 店長",
            await off(1),
            await off(0),
            await off(0),
            await off(0),
            await off(0),
            await off(1),
            await off(0),
            await off(0),
            "4 / 8",
          ],
          [
            "李小華 店員",
            await off(1),
            await off(0),
            await off(0),
            await off(0),
            await off(0),
            await off(0),
            await off(0),
            await off(1),
            "3 / 8",
          ],
          [
            "陳大文 店員",
            await off(0),
            await off(0),
            await off(1),
            await off(0),
            await off(0),
            await off(0),
            await off(0),
            await off(1),
            "5 / 8",
          ],
          [
            "當日畫休",
            "2",
            "0",
            "1",
            "0",
            "0",
            "1",
            "0",
            await T("2(上限)", "Body/2", "warning/main"),
            "",
          ],
        ],
      ),
      "FILL",
    );
    await cap(sh.content, "截止後由有代改權限的人點格子代改,原因必填。");
    done(sh, Y);
  }
}

if (PART === "SC2") {
  await figma.setCurrentPageAsync(await figma.getNodeByIdAsync("70:14"));
  const Y = await rowY("第二輪:排班設定與出勤(SC-08~14)");
  // SC-08 排班人員
  {
    const sh = await shell(
      "SC-08 排班設定:排班人員",
      "排班設定",
      "排班設定",
      "排班設定",
    );
    add(sh.content, await tabs(tabsSet, "排班人員"), "FILL");
    add(
      sh.content,
      await actions(
        [await btn("加入排班(2)")],
        [
          await field("關鍵字", "", { w: 240 }),
          await select("狀態", "全部", 140),
        ],
      ),
      "FILL",
    );
    const cb = (on) =>
      inst("Checkbox", {
        State: on ? "Checked" : "Unchecked",
        Enabled: "True",
      });
    add(
      sh.content,
      await table(
        [
          ["", 40],
          ["姓名", 120],
          ["僱用類型", 90],
          ["主要分店", 110],
          ["可以排的分店", 360],
          ["狀態", 100],
        ],
        [
          [
            await cb(0),
            "王小明",
            "正職",
            "中山店",
            "中山店(可擔任負責人)、新竹店",
            await tag("已加入", "Success"),
          ],
          [
            await cb(0),
            "李小華",
            "兼職",
            "中山店",
            "中山店",
            await tag("已加入", "Success"),
          ],
          [await cb(1), "林新人", "—", "—", "—", await tag("未加入")],
          [await cb(1), "張工讀", "—", "—", "—", await tag("未加入")],
        ],
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "有排班檔案、且可以排的分店包含這家店的人才是候選人(手動與自動同一份名單)。點一人設定僱用類型、可以排的分店(可擔任負責人、主要分店)。",
    );
    done(sh, Y);
  }
  // SC-09 人力需求範本、週範本
  {
    const sh = await shell(
      "SC-09 排班設定:人力需求範本、人力需求週範本",
      "排班設定",
      "排班設定",
      "排班設定",
    );
    add(sh.content, await tabs(tabsSet, "人力需求範本"), "FILL");
    add(
      sh.content,
      await titleRow("人力需求範本", "總部建立的範本所有分店可用、不能改", [
        await btn("+ 新增範本"),
      ]),
      "FILL",
    );
    add(
      sh.content,
      await table(
        [
          ["名稱", 140],
          ["簡稱", 70],
          ["時段", 130],
          ["崗位(收銀點)", 160],
          ["負責人", 70],
          ["協同", 70],
          ["休息", 70],
          ["建立於", 100],
        ],
        [
          [
            "早班櫃台",
            "早",
            "08:00–16:00",
            "櫃台(店內櫃台)",
            "1",
            "1",
            "60",
            "最上層組織",
          ],
          [
            "晚班攤位",
            "晚",
            "13:00–21:00",
            "攤位(店外攤位)",
            "1",
            "0",
            "60",
            "中山店",
          ],
          ["補貨", "補", "10:00–14:00", "補貨", "0", "2", "0", "中山店"],
        ],
      ),
      "FILL",
    );
    add(sh.content, await T("人力需求週範本(另一個分頁)", "Subtitle/1"));
    add(
      sh.content,
      await table(
        [
          ["週範本", 140],
          ["日", 110],
          ["一", 110],
          ["二", 110],
          ["三", 110],
          ["四", 110],
          ["五", 110],
          ["六", 110],
        ],
        [
          [
            "平日標準",
            "早、晚",
            "早、晚、補",
            "早、晚",
            "早、晚、補",
            "早、晚",
            "早、晚、補",
            "早、晚",
          ],
        ],
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "套用:單一範本照常加入(略過同日同崗位同時間);週範本與自動排班只補完全沒有人力需求的日子。",
    );
    done(sh, Y);
  }
  // SC-10 規則
  {
    const sh = await shell(
      "SC-10 排班設定:規則(總部預設 / 分店覆寫)",
      "排班設定",
      "排班設定",
      "排班設定",
    );
    add(
      sh.content,
      await filters([await select("分店", "中山店", 220)]),
      "FILL",
    );
    add(sh.content, await tabs(tabsSet, "規則"), "FILL");
    add(
      sh.content,
      await table(
        [
          ["規則", 240],
          ["值", 120],
          ["來源", 180],
          ["層級", 90],
          ["", 100],
        ],
        [
          [
            "每月最多畫休",
            "8 天",
            await T("沿用總部:8 天", "Body/2", "text/secondary"),
            await tag("擋下", "Error"),
            await btn("覆寫", "Text", "Primary", "Default", "Small"),
          ],
          [
            "最多連續上班",
            "6 天",
            await T("本店自訂:6 天(總部 7 天)", "Body/2", "primary/dark"),
            await tag("警告", "Warning"),
            await btn("改回總部", "Text", "Primary", "Default", "Small"),
          ],
          [
            "兩班之間最少休息",
            "10 小時",
            "沿用總部:10 小時",
            await tag("擋下", "Error"),
            await btn("覆寫", "Text", "Primary", "Default", "Small"),
          ],
          [
            "同日最多畫休人數",
            "2 人",
            "本店自訂:2 人",
            await tag("擋下", "Error"),
            await btn("改回總部", "Text", "Primary", "Default", "Small"),
          ],
          [
            "開班對應容許時間",
            "60 分",
            "沿用總部:60 分",
            "—",
            await btn("覆寫", "Text", "Primary", "Default", "Small"),
          ],
          [
            "遲到 / 早退寬限",
            "5 / 5 分",
            "沿用總部",
            "—",
            await btn("覆寫", "Text", "Primary", "Default", "Small"),
          ],
        ],
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "人的規則用主要分店、店的規則用那家店。改總部預設需要 edit-default-rules;改分店覆寫需要 edit-org-rules。",
    );
    done(sh, Y);
  }
  // SC-11 出勤紀錄 依人員(月)
  {
    const sh = await shell(
      "SC-11 出勤紀錄:依人員(月)",
      "出勤紀錄",
      "出勤紀錄",
      "出勤紀錄",
    );
    add(
      sh.content,
      await actions(
        [await btn("匯出 Excel", "Outlined"), await btn("補打卡申請")],
        [
          await select("人員", "李小華", 200),
          await select("月份", "2026 年 10 月", 180),
        ],
      ),
      "FILL",
    );
    add(sh.content, await tabs(tabsAtt, "依人員(月)"), "FILL");
    add(
      sh.content,
      await table(
        [
          ["日期", 90],
          ["分店", 80],
          ["排班", 110],
          ["上班", 70],
          ["下班", 70],
          ["在班", 70],
          ["休息", 60],
          ["實際工時", 80],
          ["遲到", 60],
          ["早退", 60],
          ["註記", 120],
        ],
        [
          [
            "10/13(一)",
            "中山店",
            "09:00–17:00",
            "08:56",
            "17:05",
            "8.2",
            "1.0",
            "7.2",
            "—",
            "—",
            "",
          ],
          [
            "10/14(二)",
            "中山店",
            "09:00–17:00",
            "09:12",
            await red("缺卡"),
            "—",
            "1.0",
            "—",
            await red("12 分"),
            "—",
            await btn("補打卡", "Text", "Primary", "Default", "Small"),
          ],
          [
            "10/15(三)",
            "新竹店",
            "13:00–21:00",
            "12:58",
            "21:02",
            "8.1",
            "1.0",
            "7.1",
            "—",
            "—",
            "補卡",
          ],
        ],
      ),
      "FILL",
    );
    await cap(
      sh.content,
      "沒有 view-all 只看自己。Excel 每家分店一個工作表;不做薪資計算。",
    );
    done(sh, Y);
  }
  // SC-12 出勤紀錄 依分店(日)
  {
    const sh = await shell(
      "SC-12 出勤紀錄:依分店(日)",
      "出勤紀錄",
      "出勤紀錄",
      "出勤紀錄",
    );
    add(
      sh.content,
      await actions(
        [await btn("匯出 Excel", "Outlined")],
        [
          await select("分店", "中山店", 200),
          await field("日期", "2026-10-14", { w: 180 }),
        ],
      ),
      "FILL",
    );
    add(sh.content, await tabs(tabsAtt, "依分店(日)"), "FILL");
    add(
      sh.content,
      await table(
        [
          ["人員", 120],
          ["排班", 120],
          ["上班", 80],
          ["下班", 80],
          ["實際工時", 90],
          ["遲到", 70],
          ["早退", 70],
          ["特殊日", 100],
        ],
        [
          ["王小明", "09:00–17:00", "08:50", "17:01", "7.2", "—", "—", "—"],
          [
            "李小華",
            "09:00–17:00",
            "09:12",
            await red("缺卡"),
            "—",
            await red("12 分"),
            "—",
            "—",
          ],
          ["陳大文", "(沒有排班)", "13:05", "18:00", "4.9", "—", "—", "—"],
        ],
      ),
      "FILL",
    );
    done(sh, Y);
  }
  // SC-13 補打卡申請
  {
    const sh = await shell(
      "SC-13 補打卡申請 新增頁",
      "出勤紀錄",
      "出勤紀錄",
      "新增補打卡申請",
    );
    const c = add(sh.content, await card("form", 14), "FILL");
    add(
      c,
      await grid(
        [
          await field("日期", "2026-10-14"),
          await select("分店", "中山店", null),
        ],
        2,
      ),
      "FILL",
    );
    await put(add(c, H(16)), [
      await T("類型"),
      await radio("上班"),
      await radio("下班", true),
    ]);
    add(
      c,
      await grid(
        [await field("時間", "17:03"), await select("原因", "忘記打卡", null)],
        2,
      ),
      "FILL",
    );
    add(
      sh.content,
      await actions([await btn("送出")], [await btn("取消", "Text")]),
      "FILL",
    );
    done(sh, Y);
  }
  // SC-14 支援需求單
  {
    const sh = await shell(
      "SC-14 支援需求單 新增頁",
      "排班作業",
      "排班作業",
      "新增支援需求單",
    );
    const c = add(sh.content, await card("form", 14), "FILL");
    add(
      c,
      await grid(
        [
          await field("日期", "2026-11-10"),
          await field("時段", "10:00–14:00"),
          await select("崗位", "補貨", null),
          await field("需要人數", "1"),
        ],
        4,
      ),
      "FILL",
    );
    add(c, await field("說明", "兩人畫休,補貨缺一人"), "FILL");
    await cap(
      c,
      "分店人力不足時請總部協助。流程:一關,審核者 = 人員條件「角色 店長 且 所屬組織屬於 最上層組織」;總部在排班作業排好人後核准。",
    );
    add(
      sh.content,
      await actions([await btn("送出")], [await btn("取消", "Text")]),
      "FILL",
    );
    done(sh, Y);
  }
}

if (PART === "RC") {
  await figma.setCurrentPageAsync(await figma.getNodeByIdAsync("65:14"));
  const Y = await rowY("第二輪:58mm 單據(RC-01~09)");
  // 用底座 58mm 版面零件組一張單據
  async function receipt(name, title, parts) {
    const r = V(6, {
      name,
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 20,
      paddingBottom: 20,
      counterAxisAlignItems: "CENTER",
    });
    r.fills = [await paint("common/white")];
    r.counterAxisSizingMode = "FIXED";
    r.resize(384, 100);
    r.primaryAxisSizingMode = "AUTO";
    const put1 = async (n, props, variant) =>
      add(r, await dinst(n, variant || {}, props || {}), "FILL");
    await put1("RcHeader", {
      Org: "好運彩券行",
      Title: title.t,
      No: title.no,
      Time: title.time,
      Reprint: !!title.reprint,
      ReprintText: title.reprint || "",
    });
    for (const p of parts) {
      if (p === "-") await put1("RcDivider");
      else if (p[0] === "row")
        await put1("RcRow", { Label: p[1], Value: p[2] });
      else if (p[0] === "head")
        await put1(
          "RcTable",
          { Col1: p[1], Col2: p[2], Col3: p[3] },
          { Kind: "Head" },
        );
      else if (p[0] === "tr")
        await put1(
          "RcTable",
          { Col1: p[1], Col2: p[2], Col3: p[3] },
          { Kind: "Body" },
        );
      else if (p[0] === "range") await put1("RcRange", { Text: p[1] });
      else if (p[0] === "total")
        await put1("RcTotal", { Label: p[1], Value: p[2] });
      else if (p[0] === "qr") await put1("RcQR");
      else if (p[0] === "sign") await put1("RcSign", { Role: p[1] });
    }
    return r;
  }
  const docs = [
    [
      "RC-01 58mm / 投庫單",
      { t: "投庫單", no: "單號 D-0018", time: "2026-10-16 21:30" },
      [
        "-",
        ["row", "分店", "中山店"],
        ["row", "收銀點", "店內櫃台"],
        ["row", "抽屜 → 小金庫", ""],
        ["total", "金額", "3,000"],
        "-",
        ["qr"],
        ["sign", "投庫人簽名"],
        ["sign", "見證人簽名"],
      ],
    ],
    [
      "RC-02 58mm / 出庫單",
      { t: "出庫單", no: "單號 W-0013", time: "2026-10-16 13:00" },
      [
        "-",
        ["row", "分店", "中山店"],
        ["row", "小金庫 → 抽屜", "店外攤位"],
        ["row", "原因", "開班零用金"],
        ["total", "金額", "2,000"],
        "-",
        ["qr"],
        ["sign", "領取人簽名"],
        ["sign", "見證人簽名"],
      ],
    ],
    [
      "RC-05 58mm / 日結單",
      { t: "日結單", no: "單號 C-0043", time: "2026-10-16 22:40" },
      [
        "-",
        ["row", "涵蓋計算期間", "10/14 09:02 ~ 10/16 22:40"],
        ["row", "盤點", "沿用 S-0032"],
        "-",
        ["head", "收銀點", "班數", "差額"],
        ["tr", "店內櫃台", "4", "−100"],
        ["tr", "店外攤位", "3", "0"],
        "-",
        ["row", "小金庫 應有", "48,200"],
        ["row", "小金庫 實點", "48,200"],
        ["row", "存入銀行", "40,000(末 34521)"],
        ["total", "小金庫 留存", "8,200"],
        "-",
        ["qr"],
        ["sign", "店長簽名"],
      ],
    ],
    [
      "RC-06 58mm / 調貨出貨單",
      { t: "調貨出貨單", no: "單號 T-0008", time: "2026-10-16 18:30" },
      [
        "-",
        ["row", "出貨店 → 收貨店", "中山店 → 新竹店"],
        "-",
        ["head", "遊戲 / 本", "張數", "金額"],
        ["tr", "5164 · 056527", "10", "2,000"],
        ["range", "號碼:#090~099(10 張)"],
        ["total", "調貨金額", "1,840"],
        "-",
        ["qr"],
        ["sign", "出貨人簽名"],
        ["sign", "送貨人簽名"],
        ["sign", "收貨人簽名"],
      ],
    ],
    [
      "RC-07 58mm / 調貨付款收據",
      { t: "調貨付款收據", no: "單號 T-0008", time: "2026-10-16 19:05" },
      [
        "-",
        ["row", "付款店", "新竹店 · 店內櫃台抽屜"],
        ["row", "收款人", "王小明(送貨人)"],
        ["total", "現金", "1,840"],
        "-",
        ["qr"],
        ["sign", "送貨人簽收"],
      ],
    ],
    [
      "RC-08 58mm / 進貨點收單",
      { t: "進貨點收單", no: "單號 P-0031", time: "2026-10-12 14:05" },
      [
        "-",
        ["row", "進貨分店", "中山店"],
        ["row", "甲類", "陳志明 12345678"],
        "-",
        ["head", "遊戲", "本數", "點收"],
        ["tr", "5201 金好運", "3", "3 / 3"],
        ["tr", "5164 發大財", "1", "1 / 1"],
        ["range", "本號:060113~060115、056529"],
        "-",
        ["qr"],
        ["sign", "點收人簽名"],
      ],
    ],
    [
      "RC-09 58mm / 退貨退款收據",
      {
        t: "退貨退款收據",
        no: "單號 R-008",
        time: "2026-10-16 15:50",
        reprint: "待核准",
      },
      [
        "-",
        ["row", "收銀點", "店內櫃台"],
        ["row", "原因", "客人退貨"],
        ["head", "遊戲", "張數", "金額"],
        ["tr", "5164 發大財", "2", "400"],
        ["range", "號碼:#031~032(2 張)"],
        ["total", "退款", "400"],
        "-",
        ["qr"],
        ["sign", "經手人簽名"],
      ],
    ],
  ];
  for (const [name, title, parts] of docs)
    done(await receipt(name, title, parts), Y);
}
return { made };
