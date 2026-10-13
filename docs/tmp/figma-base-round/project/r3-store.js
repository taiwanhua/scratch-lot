// 第三輪「Screen / 店面管理」(65:14):電腦版重畫 / 補畫 + 平板、手機。專案規格 16.1。
// 前置:`const PROJECT = true;` + ../_kit.js + _r3.js + 本檔的某一段(每段一次呼叫,各段結尾 `return await finish();`)。
// 電腦版 ST-01 是就地修改既有畫面(65:15):店外攤位標題列換成 CashPointHeader State=Other + Mine、頂部加「你開著的班」、補說明。

// ---- 段 1:電腦 ST-13 盤點頁(取代 88:2189)----
async function deskST13() {
  await pageOf(null, "65:14");
  const sh = await shell(
    "ST-13 盤點頁:本清單、點格子 / 掃描、未拆的本、待查清單",
    "店面管理",
    "店面管理",
    "盤點 S-0032",
  );
  const c = sh.content;
  add(
    c,
    await titleRow("臨時盤點 · 全店", "S-0032 · 10/16 21:40 開始 · 王小明", [
      await tag("盤點中", "Warning"),
      await btn("取消盤點", "Text", "Error"),
    ]),
    "FILL",
  );
  const pr = add(c, H(12, { name: "progress" }), "FILL");
  add(pr, await T("已盤 12 / 18 本", "Subtitle/2"));
  const bar = add(pr, H(0, { name: "bar" }), "FILL");
  bar.fills = [await paint("action/disabledBackground")];
  bar.layoutSizingVertical = "FIXED";
  bar.resize(bar.width, 6);
  await rad(bar, "radius/sm");
  const fillb = figma.createRectangle();
  fillb.resize(560, 6);
  fillb.fills = [await paint("primary/main")];
  add(bar, fillb);
  add(pr, await T("差異 3 張", "Body/2", "warning/main"));
  const cols = add(
    c,
    H(16, { name: "columns", counterAxisAlignItems: "MIN" }),
    "FILL",
  );
  const left = add(cols, await card("本清單", 6, 12));
  left.resize(320, 100);
  left.layoutSizingVertical = "HUG";
  const book = async (g, no, st, tone, selected) => {
    const r = add(
      left,
      H(8, {
        name: "book",
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 8,
        paddingBottom: 8,
      }),
      "FILL",
    );
    if (selected) {
      r.fills = [await paint("action/selected")];
      await rad(r, "radius/sm");
    }
    const v = add(r, V(2), "FILL");
    add(v, await T(g, "Subtitle/2"));
    add(v, await T(no, "Caption", "text/secondary"));
    add(r, await tag(st, tone));
  };
  add(left, await T("店內櫃台", "Subtitle/1"));
  await book("5164 發大財", "本號 056527 · 檯面 35 張", "已盤", "Success");
  await book("5201 金好運", "本號 060112 · 檯面 35 張", "差異 1", "Warning");
  await book("5198 鼠來寶", "本號 088102 · 檯面 35 張", "盤點中", "Info", true);
  await book("5150 好運旺旺", "本號 042210 · 檯面 18 張", "未盤", "Grey");
  add(left, await T("店外攤位", "Subtitle/1"));
  await book("5164 發大財", "本號 056528 · 檯面 35 張", "已盤", "Success");
  await book("5133 招財貓", "本號 071204 · 檯面 10 張", "未盤", "Grey");
  const right = add(cols, V(16, { name: "right" }), "FILL");
  const pane = add(right, await card("選中的本", 12), "FILL");
  const h1 = add(pane, H(8), "FILL");
  add(h1, await T("5198 鼠來寶 · 本號 088102", "Subtitle/1"));
  add(h1, await T("店內櫃台 · 100 元", "Body/2", "text/secondary"));
  spacer(h1);
  add(h1, await tabs(["點格子", "掃描"], "點格子"));
  const st = {};
  for (let i = 1; i <= 65; i++) st[String(i).padStart(3, "0")] = "off";
  for (let i = 66; i <= 100; i++) st[String(i).padStart(3, "0")] = "sel";
  st["071"] = undefined;
  st["088"] = undefined;
  add(
    pane,
    await T(
      "點出實際還在檯面上的張(已選 = 在);系統數字是開始盤這本那一刻的數字。",
      "Body/2",
      "text/secondary",
    ),
  );
  add(
    pane,
    await legend([
      ["在(已點)", "primary/main"],
      ["系統未售、還沒點", "bg/default"],
      ["已售 / 跳號 / 報廢(不能選)", "action/disabledBackground"],
    ]),
  );
  add(pane, await ticketGrid(100, st, 20, 34));
  const sum = add(pane, H(32, { name: "sum" }), "FILL");
  for (const [k, v, col] of [
    ["系統(21:52)", "35 張 · #066~100"],
    ["實盤", "33 張"],
    ["差異", "2 張:#071、#088", "warning/main"],
  ]) {
    const x = add(sum, V(2));
    add(x, await T(k, "Caption", "text/secondary"));
    add(x, await T(v, "Subtitle/1", col || "text/primary"));
  }
  add(
    pane,
    await actions([await btn("下一本")], [await btn("上一本", "Text")]),
    "FILL",
  );
  const un = add(right, await card("未拆的本(在 / 不在)", 10), "FILL");
  add(un, await T("未拆的本(在 / 不在)", "Subtitle/1"));
  add(
    un,
    await table(
      [
        ["本", 140],
        ["遊戲", 200],
        ["張數", 80],
        ["在不在", 200],
      ],
      [
        [
          "071205",
          "5133 招財貓",
          "25",
          [await radio("在", true), await radio("不在")],
        ],
        [
          "088103",
          "5198 鼠來寶",
          "100",
          [await radio("在"), await radio("不在", true)],
        ],
      ],
    ),
    "FILL",
  );
  await cap(un, "不在的本:盤點完成時列為待查,責任分店 = 本店。");
  const lo = add(right, await card("待查清單", 10), "FILL");
  add(lo, await T("待查清單", "Subtitle/1"));
  add(
    lo,
    await table(
      [
        ["本 / 張", 180],
        ["原因", 220],
        ["處理", 220],
      ],
      [
        [
          "5164 · 056420 · 整本",
          "10/12 調貨在途刪除",
          await select("處理", "找到了(刷條碼)", 200),
        ],
        [
          "5201 · 060090 · #023",
          "10/05 盤點時不在",
          await select("處理", "確認遺失(原因必填)", 200),
        ],
      ],
    ),
    "FILL",
  );
  await cap(
    lo,
    "確認遺失需要權限 store.confirm-lost,原因必填;也可以「繼續待查」。",
  );
  add(
    c,
    await actions(
      [await btn("差異核對 →")],
      [
        await T(
          "盤點期間照常銷售;待核准的盤點不擋下一次盤點。",
          "Body/2",
          "text/secondary",
        ),
      ],
    ),
    "FILL",
  );
  doneIn("desk", sh);
  return await finish();
}

// ---- 段 2:電腦 ST-14 差異核對、ST-15 送出確認(取代 88:2589、88:2880)----
async function deskST14() {
  await pageOf(null, "65:14");
  const sh = await shell(
    "ST-14 盤點頁:差異核對(逐張處理、多選套用、整本重新盤點)",
    "店面管理",
    "店面管理",
    "盤點 S-0032",
  );
  const c = sh.content;
  add(
    c,
    await titleRow("差異核對", "臨時盤點 · 全店 · S-0032", [
      await tag("盤點中", "Warning"),
    ]),
    "FILL",
  );
  add(
    c,
    await alert(
      "每一張各自處理,可以多選後一次套用。[補登售出] 當場生效:那個收銀點有開著的班 → 算進那一班;已結帳 → 記成那個收銀點最近一班的事後更正。",
      "Info",
    ),
    "FILL",
  );
  const bulk = add(
    c,
    H(12, {
      name: "bulk-bar",
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 10,
      paddingBottom: 10,
    }),
    "FILL",
  );
  bulk.fills = [await paint("primary/lighter")];
  await rad(bulk, "radius/sm");
  add(bulk, await T("已選 2 張", "Subtitle/2", "primary/dark"));
  spacer(bulk);
  await put(bulk, [
    await sbtn("補登售出", "Contained"),
    await sbtn("待查"),
    await sbtn("取消選取", "Text"),
  ]);
  const grp = async (title, sub, rows, note) => {
    const g = add(c, await card("book-group", 10), "FILL");
    const h = add(g, H(8), "FILL");
    add(h, await T(title, "Subtitle/1"));
    add(h, await T(sub, "Body/2", "text/secondary"));
    spacer(h);
    add(h, await sbtn("重新盤點這本", "Text"));
    add(
      g,
      await table(
        [
          ["", 40],
          ["張號", 90],
          ["系統", 110],
          ["實際", 110],
          ["處理", 360],
          ["結果", 300],
        ],
        rows,
      ),
      "FILL",
    );
    if (note) await cap(g, note);
  };
  const cb = (on) =>
    inst("Checkbox", { State: on ? "Checked" : "Unchecked", Enabled: "True" });
  await grp(
    "店內櫃台 · 5198 鼠來寶 · 本號 088102",
    "100 元 · 店內櫃台開著的班:王小明 08:02",
    [
      [
        await cb(true),
        "#071",
        "未售",
        "不在",
        await chips([
          ["補登售出", true],
          ["待查", false],
        ]),
        "售出算進店內櫃台這一班,應有現金 +100",
      ],
      [
        await cb(true),
        "#088",
        "未售",
        "不在",
        await chips([
          ["補登售出", false],
          ["待查", true],
        ]),
        "待查,責任分店 = 中山店",
      ],
    ],
  );
  await grp(
    "店內櫃台 · 5201 金好運 · 本號 060112",
    "200 元",
    [
      [
        await cb(false),
        "#045",
        "已售",
        "還在",
        await chips([["標記異常", true]]),
        "之後用撤銷售出申請「盤點錯誤」更正",
      ],
    ],
    "系統已售、實際還在:只能標記異常。",
  );
  await grp(
    "店外攤位 · 5164 發大財 · 本號 056528",
    "200 元 · 13:00 的班已結帳",
    [
      [
        await cb(false),
        "#090",
        "未售",
        "不在",
        await chips([
          ["補登售出", true],
          ["待查", false],
        ]),
        "記成店外攤位 13:00 班的事後更正 +200",
      ],
    ],
  );
  const ft = add(c, await card("summary", 8), "FILL");
  const r = add(ft, H(32), "FILL");
  for (const [k, v, col] of [
    ["補登售出", "2 張 · 300 元"],
    ["新增待查", "1 張"],
    ["標記異常", "1 張", "warning/main"],
    ["未處理", "0 張", "success/main"],
  ]) {
    const x = add(r, V(2));
    add(x, await T(k, "Caption", "text/secondary"));
    add(x, await T(v, "Subtitle/1", col || "text/primary"));
  }
  add(
    ft,
    await actions([await btn("送出 →")], [await btn("返回盤點", "Text")]),
    "FILL",
  );
  doneIn("desk", sh);
  const o = await ovRow("ST-15 盤點頁:補登售出後應有現金的變化、送出確認");
  const d = await dcard(o.row, "送出盤點?", 560, "臨時盤點 S-0032");
  add(
    d,
    await T(
      "送出後明細鎖定,送「盤點確認申請」給店長核准;盤點期間照常銷售。",
      "Body/2",
      "text/secondary",
    ),
    "FILL",
  ).textAutoResize = "HEIGHT";
  add(
    d,
    await table(
      [
        ["收銀點 / 班", 200],
        ["補登售出", 90],
        ["應有現金", 160],
      ],
      [
        ["店內櫃台 · 王小明 08:02(開著)", "1 張", "12,350 → 12,450"],
        ["店外攤位 · 王小明 13:00(已結帳)", "1 張", "事後更正 +200"],
      ],
      { right: [1, 2] },
    ),
    "FILL",
  );
  for (const [k, v] of [
    ["新增待查", "1 張(#088)"],
    ["標記異常", "1 張(#045)"],
    ["未拆的本不在", "1 本(088103)→ 待查"],
    ["確認遺失", "1 張(5201 · #023,批購成本 184 元)"],
  ])
    add(d, await kv(k, v), "FILL");
  add(
    d,
    await actions([await btn("送出盤點確認申請")], [await btn("返回", "Text")]),
    "FILL",
  );
  doneIn("desk", o);
  return await finish();
}

// ---- 段 3:電腦 ST-05 刷到票、ST-09 拆本(取代 87:1850、87:2404)----
// 對話框:自己開的班直接售出 / 別人的班移櫃並售出 / 選遊戲 / 未拆詢問拆本 / 不能銷售 / 待查尋回;
// 拆本:點選收銀點、跳號在張數格子多選(數量 = 待標註張數)、[略過,之後標註];分放:選張後點收銀點分配。
// (程式同第三輪工作紀錄;結構與段 2 相同,用 ovRow + dcard + ticketInfo + chips + ticketGrid。)

// ---- 段 4:電腦 ST-34 一人兩班、ST-35 售出提示與最近售出 ----
// ST-34:ovRow 三張卡(本機收銀點選單、切換確認、切換後的兩條標題列 CashPointHeader Open / Other+Mine);
// ST-35:storeShell + CashPointHeader + BookCard,右上 toast「已售出 … [撤銷]」,右側 drawer「最近售出 · 店內櫃台」。

// ---- 段 5~9:平板、手機 ----
// 共同做法:`for (const key of ["tab", "mob"])`;一般畫面用 dev(),彈窗用 devDialog()(手機全螢幕、平板置中 560);
// 精靈的頁尾用 dev() 的 bottomBar(左次要、右主要),手機的步驟改成「第 2 / 5 步 · 名稱」。
// 段 5:ST-01、02、34、35(看板:storeTopDev + 收銀點卡 + BookCard,手機一欄、平板換行排列)
// 段 6:ST-03~08 彈窗;段 7:ST-09~12、16、26 彈窗;段 8:ST-13~15 盤點;段 9:ST-17~25 交班 / 日結精靈。
