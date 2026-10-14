// 「Screen / 班表管理」(scratch-lot Screens 70:14)。前置:project/_header.js + project/_screen-helpers.js。
// 依專案規格 14.5 排班作業(排班表、行事曆分頁)、14.1 行事曆、13 特殊日類別。
PROJ_PAGE = await figma.getNodeByIdAsync("64:14");
let page = figma.root.children.find((p) => p.name === "Screen / 班表管理");
if (!page) {
  page = figma.createPage();
  page.name = "Screen / 班表管理";
}
await figma.setCurrentPageAsync(page);
const out = {};
async function toolbar(content) {
  const tb = add(
    content,
    al("HORIZONTAL", {
      name: "toolbar",
      itemSpacing: 12,
      counterAxisAlignItems: "CENTER",
    }),
    "FILL",
  );
  const ots = await binst("Draft/OrgTreeSelect", {
    State: "Closed",
    Mode: "Single",
  });
  add(tb, ots);
  await setText(ots, "label", "分店");
  await setText(ots, "value", "中山店");
  add(tb, await select("月份", "2026 年 10 月", 170));
  add(tb, await tag("草稿", "Warning"));
  spacer(tb);
  add(tb, await btn("套用範本", "Outlined"));
  add(tb, await btn("自動排班", "Outlined"));
  add(tb, await btn("發布"));
  return tb;
}

// ---- 排班表 ----
{
  const { s, content } = await pshell(
    "班表管理 / 排班作業(排班表)",
    "排班作業",
    "排班作業",
    "排班作業",
  );
  await toolbar(content);
  add(
    content,
    await tabsRow(["排班表", "畫休總覽", "行事曆"], "排班表"),
    "FILL",
  );
  add(
    content,
    await inst(
      "Draft/Alert",
      { Severity: "Error" },
      {
        Message:
          "人力不足:10/14(三)補貨 需 3、可排 2;10/16(五)店內櫃台 負責人 需 1、可排 0。",
        Action: false,
      },
    ),
    "FILL",
  );
  // 每日需求列:對齊 RosterGrid 的日期欄(RosterGrid 沒有每日彙總列,先在外面畫;見回報)
  const rg = await binst("Draft/RosterGrid");
  // 底座 RosterCell 的示範文字是中性的(櫃台 A),專案畫面改成「崗位 · 職責」
  for (const t of rg.findAll((x) => x.type === "TEXT" && x.name === "line-2")) {
    await figma.loadFontAsync(t.fontName);
    t.characters = "店內櫃台 · 負責人";
  }
  const hdr = rg.children.find((c) => c.name === "header-row");
  const strip = add(
    content,
    al("HORIZONTAL", { name: "每日人力(需 / 可排)", paddingLeft: hdr.x }),
  );
  const f0 = add(
    strip,
    al("HORIZONTAL", {
      name: "label",
      paddingLeft: 12,
      counterAxisAlignItems: "CENTER",
    }),
  );
  f0.resize(hdr.children[0].width, 28);
  f0.primaryAxisSizingMode = "FIXED";
  add(f0, await txt("需 / 已排", "Caption", "text/secondary"));
  const days = [
    [3, 3],
    [4, 4],
    [4, 4],
    [5, 4],
    [4, 4],
    [5, 4],
    [4, 4],
  ];
  for (let i = 0; i < days.length; i++) {
    const [need, got] = days[i];
    const d = add(
      strip,
      al("HORIZONTAL", {
        name: "day",
        primaryAxisAlignItems: "CENTER",
        counterAxisAlignItems: "CENTER",
      }),
    );
    d.resize(hdr.children[i + 1].width, 28);
    d.primaryAxisSizingMode = "FIXED";
    add(
      d,
      await txt(
        `需 ${need} / 已排 ${got}`,
        "Caption",
        got < need ? "error/main" : "text/secondary",
      ),
    );
  }
  add(content, rg);
  const row = add(
    content,
    al("HORIZONTAL", { name: "panels", itemSpacing: 16 }),
    "FILL",
  );
  const dm = add(row, await card("人力需求(10/14 週三)", 6), "FILL");
  add(dm, await txt("人力需求 · 10/14(三)", "Subtitle/1"));
  const W = [120, 110, 70, 70, 110];
  add(
    dm,
    await tableRow(["時段", "崗位(收銀點)", "負責人", "協同", "已排"], W, true),
    "FILL",
  );
  for (const r of [
    ["08:00–16:00", "店內櫃台(店內櫃台)", "1", "1", "王小明、李小華"],
    ["13:00–21:00", "店外攤位(店外攤位)", "1", "0", "陳大文"],
    ["10:00–14:00", "補貨", "0", "2", "林美麗"],
  ])
    add(dm, await tableRow(r, W, false), "FILL");
  const ck = add(row, await card("檢核", 8), "FILL");
  add(ck, await txt("檢核(草稿)", "Subtitle/1"));
  for (const [tone, lab, msg] of [
    ["Error", "擋下", "林美麗 10/12 已畫休,不能排班"],
    ["Error", "擋下", "10/16 店內櫃台缺負責人"],
    ["Warning", "警告", "陳大文 本月已連續上班 6 天"],
    ["Warning", "警告", "10/14 補貨 需 3、可排 2"],
  ]) {
    const r = add(
      ck,
      al("HORIZONTAL", { itemSpacing: 8, counterAxisAlignItems: "CENTER" }),
      "FILL",
    );
    add(r, await tag(lab, tone));
    add(r, await txt(msg, "Body/2"));
  }
  await wrapCaption(
    ck,
    "畫休、店休與「擋下」的規則一定遵守;其他分店的班以灰色顯示(看不到那家店時只顯示「已排於其他分店」)。發布後的異動要選原因。",
  );
  page.appendChild(s);
  fitHeight(s);
  out.roster = s.id;
}

// ---- 行事曆分頁 ----
{
  const { s, content } = await pshell(
    "班表管理 / 排班作業(行事曆)",
    "排班作業",
    "排班作業",
    "排班作業",
  );
  await toolbar(content);
  add(
    content,
    await tabsRow(["排班表", "畫休總覽", "行事曆"], "行事曆"),
    "FILL",
  );
  const row = add(
    content,
    al("HORIZONTAL", { name: "cal", itemSpacing: 16 }),
    "FILL",
  );
  add(row, await binst("Draft/MonthCalendar"));
  const side = add(row, await card("說明", 10), "FILL");
  const lg = add(
    side,
    al("HORIZONTAL", { itemSpacing: 8, counterAxisAlignItems: "CENTER" }),
  );
  add(lg, await tag("店休", "Error"));
  add(lg, await tag("特殊日", "Warning"));
  await wrapCaption(
    side,
    "店休擋下排班;特殊日只做背景色(類別:國定假日、颱風假、活動日、其他)。行事曆沿組織樹繼承,以最接近的那一層為準:最上層組織設的國定假日,分店可以再加自己的店休或活動日。",
  );
  add(side, await txt("10/10(六)國慶日", "Subtitle/2"));
  add(
    side,
    await txt(
      "特殊日 · 國定假日 · 由最上層組織設定",
      "Caption",
      "text/secondary",
    ),
  );
  add(side, await btn("新增店休 / 特殊日", "Outlined"));
  page.appendChild(s);
  s.x = 1560;
  fitHeight(s);
  out.calendar = s.id;
}
return out;
